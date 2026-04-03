import { cellLabel, getAllCells, BOARD_CELL_COUNT } from "@/lib/board";
import type { CellInsight, PredictionMode, RoundResult } from "@/lib/contracts";

export interface RawCellStat {
  cellIndex: number;
  timesPredicted: number;
  timesPlayed: number;
  mineReports: number;
  winCount: number;
  lossCount: number;
}

export interface ModelHistoryRound {
  predictionCount: number;
  predictedCells: number[];
  playedCells: number[];
  result: RoundResult;
  hitCell: number | null;
  mineLocations: number[];
}

export interface PredictionDecision {
  predictionMode: PredictionMode;
  signalScore: number;
  averageTopCellConfidence: number;
  minimumRoundsForSignal: number;
  abstainReason: string | null;
}

interface InsightContext {
  mineCount: number;
  totalRounds: number;
  totalLosses: number;
  truthKnownRounds: number;
  stats: RawCellStat[];
}

const ABSOLUTE_MINIMUM_ROUNDS = 5;
export const MINIMUM_ROUNDS_FOR_SIGNAL = 12;
const MINIMUM_TRUTH_ROUNDS_FOR_SIGNAL = 4;
const MINIMUM_AVERAGE_CONFIDENCE = 0.18;

const COLD_START_ORDER = [
  13, 7, 19, 1, 5, 21, 25, 3, 11, 15, 23, 9, 17, 2, 4, 6, 10, 16, 20, 22, 24, 8, 12, 14, 18,
];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function coldStartRank(cellIndex: number) {
  return COLD_START_ORDER.indexOf(cellIndex);
}

function wilsonInterval(successes: number, trials: number, z = 1.96) {
  if (trials === 0) {
    return {
      lower: 0,
      upper: 1,
    };
  }

  const phat = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = phat + (z * z) / (2 * trials);
  const spread = z * Math.sqrt((phat * (1 - phat)) / trials + (z * z) / (4 * trials * trials));

  return {
    lower: clamp((center - spread) / denominator, 0, 1),
    upper: clamp((center + spread) / denominator, 0, 1),
  };
}

function toCellSetKey(cells: number[]) {
  return [...cells].sort((left, right) => left - right).join(",");
}

function getRepeatPenalty(cellIndex: number, recentPredictions: number[][]) {
  const appearances = recentPredictions.filter((cells) => cells.includes(cellIndex)).length;
  let streak = 0;

  for (const cells of recentPredictions) {
    if (!cells.includes(cellIndex)) {
      break;
    }

    streak += 1;
  }

  return appearances * 0.025 + streak * 0.08;
}

function getCandidateScore(cells: number[], recentPredictions: number[][], effectiveRiskByCell: Map<number, number>) {
  const selectedCells = [...cells].sort((left, right) => left - right);
  const recentSetKeys = new Set(recentPredictions.map(toCellSetKey));
  const latestPrediction = recentPredictions[0] ?? [];
  const overlapWithLatest =
    latestPrediction.length === 0
      ? 0
      : selectedCells.filter((cell) => latestPrediction.includes(cell)).length / selectedCells.length;
  const baseRisk = selectedCells.reduce((sum, cell) => sum + (effectiveRiskByCell.get(cell) ?? 1), 0);
  const exactRepeatPenalty = recentSetKeys.has(toCellSetKey(selectedCells)) ? 3 : 0;

  return baseRisk + overlapWithLatest * 0.35 + exactRepeatPenalty;
}

function sampleCells(
  candidatePool: Array<{ cellIndex: number; effectiveRisk: number }>,
  predictionCount: number,
): number[] {
  const available = [...candidatePool];
  const selected: number[] = [];

  while (selected.length < predictionCount && available.length > 0) {
    const weights = available.map((cell) => 1 / Math.max(cell.effectiveRisk, 0.05));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = Math.random() * totalWeight;
    let chosenIndex = 0;

    for (let index = 0; index < available.length; index += 1) {
      roll -= weights[index] ?? 0;

      if (roll <= 0) {
        chosenIndex = index;
        break;
      }
    }

    const [chosen] = available.splice(chosenIndex, 1);

    if (!chosen) {
      break;
    }

    selected.push(chosen.cellIndex);
  }

  return selected;
}

export function buildCellInsights({ mineCount, totalRounds, truthKnownRounds, stats }: InsightContext) {
  const statsByCell = new Map(stats.map((entry) => [entry.cellIndex, entry]));
  const baselineMineRate = mineCount / BOARD_CELL_COUNT;

  return getAllCells().map((cellIndex) => {
    const stat = statsByCell.get(cellIndex) ?? {
      cellIndex,
      timesPredicted: 0,
      timesPlayed: 0,
      mineReports: 0,
      winCount: 0,
      lossCount: 0,
    };

    const mineRate = (stat.mineReports + baselineMineRate * 4) / (truthKnownRounds + 4);
    const playWinRate = (stat.winCount + 1) / (stat.timesPlayed + 2);
    const predictionFailureRate = (stat.lossCount + 1) / (stat.timesPredicted + 2);
    const explorationBuffer = stat.timesPredicted === 0 ? 0.04 : 0;
    const exposurePenalty = totalRounds === 0 ? 0 : Math.min(stat.timesPredicted / totalRounds, 0.08);
    const mineRateBand = wilsonInterval(stat.mineReports, truthKnownRounds);

    const riskScore = clamp(
      mineRate * 0.72 + predictionFailureRate * 0.2 + exposurePenalty - playWinRate * 0.12 - explorationBuffer,
      0.02,
      0.98,
    );

    const confidence = clamp(
      (stat.timesPredicted + stat.timesPlayed + stat.mineReports) / Math.max(totalRounds * 2, 8),
      0,
      1,
    );

    const insight: CellInsight = {
      cellIndex,
      label: cellLabel(cellIndex),
      riskScore,
      safetyScore: 1 - riskScore,
      confidence,
      mineRate,
      playWinRate,
      predictionFailureRate,
      mineRateLowerBound: mineRateBand.lower,
      mineRateUpperBound: mineRateBand.upper,
      timesPredicted: stat.timesPredicted,
      timesPlayed: stat.timesPlayed,
      mineReports: stat.mineReports,
    };

    return insight;
  });
}

export function pickSuggestedCells(insights: CellInsight[], predictionCount: number, recentPredictions: number[][] = []) {
  const rankedInsights = insights
    .slice()
    .sort((left, right) => {
      if (left.riskScore !== right.riskScore) {
        return left.riskScore - right.riskScore;
      }

      if (left.playWinRate !== right.playWinRate) {
        return right.playWinRate - left.playWinRate;
      }

      if (left.mineReports !== right.mineReports) {
        return left.mineReports - right.mineReports;
      }

      return coldStartRank(left.cellIndex) - coldStartRank(right.cellIndex);
    });

  const candidatePool = rankedInsights
    .map((insight) => ({
      ...insight,
      effectiveRisk: insight.riskScore + getRepeatPenalty(insight.cellIndex, recentPredictions),
    }))
    .sort((left, right) => {
      if (left.effectiveRisk !== right.effectiveRisk) {
        return left.effectiveRisk - right.effectiveRisk;
      }

      if (left.riskScore !== right.riskScore) {
        return left.riskScore - right.riskScore;
      }

      return coldStartRank(left.cellIndex) - coldStartRank(right.cellIndex);
    })
    .slice(0, Math.min(rankedInsights.length, Math.max(predictionCount + 6, predictionCount * 3)));

  const effectiveRiskByCell = new Map(candidatePool.map((cell) => [cell.cellIndex, cell.effectiveRisk]));
  const attempts = new Map<string, { cells: number[]; score: number }>();

  const baselineCells = candidatePool.slice(0, predictionCount).map((cell) => cell.cellIndex);
  const baselineKey = toCellSetKey(baselineCells);
  attempts.set(baselineKey, {
    cells: baselineCells,
    score: getCandidateScore(baselineCells, recentPredictions, effectiveRiskByCell),
  });

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const sampledCells = sampleCells(candidatePool, predictionCount);

    if (sampledCells.length !== predictionCount) {
      continue;
    }

    const key = toCellSetKey(sampledCells);
    const score = getCandidateScore(sampledCells, recentPredictions, effectiveRiskByCell);
    const existing = attempts.get(key);

    if (!existing || score < existing.score) {
      attempts.set(key, {
        cells: sampledCells,
        score,
      });
    }
  }

  const recentSetKeys = new Set(recentPredictions.map(toCellSetKey));
  const candidates = Array.from(attempts.values()).sort((left, right) => left.score - right.score);
  const preferredCandidate = candidates.find((candidate) => !recentSetKeys.has(toCellSetKey(candidate.cells)));

  return (preferredCandidate ?? candidates[0] ?? { cells: [] }).cells.sort((left, right) => left - right);
}

export function buildFrequencyBaselineCells(insights: CellInsight[], predictionCount: number) {
  return insights
    .slice()
    .sort((left, right) => {
      if (left.mineRate !== right.mineRate) {
        return left.mineRate - right.mineRate;
      }

      if (left.mineReports !== right.mineReports) {
        return left.mineReports - right.mineReports;
      }

      return coldStartRank(left.cellIndex) - coldStartRank(right.cellIndex);
    })
    .slice(0, predictionCount)
    .map((cell) => cell.cellIndex);
}

export function deriveStatsFromHistoryRounds(rounds: ModelHistoryRound[]): RawCellStat[] {
  const stats = new Map<number, RawCellStat>();

  function ensure(cellIndex: number) {
    const existing = stats.get(cellIndex) ?? {
      cellIndex,
      timesPredicted: 0,
      timesPlayed: 0,
      mineReports: 0,
      winCount: 0,
      lossCount: 0,
    };

    stats.set(cellIndex, existing);
    return existing;
  }

  for (const round of rounds) {
    for (const cell of round.predictedCells) {
      ensure(cell).timesPredicted += 1;
    }

    for (const cell of round.playedCells) {
      const stat = ensure(cell);
      stat.timesPlayed += 1;

      if (round.result === "WON") {
        stat.winCount += 1;
      }
    }

    for (const cell of round.mineLocations) {
      ensure(cell).mineReports += 1;
    }

    if (round.result === "LOST" && round.hitCell) {
      const stat = ensure(round.hitCell);
      stat.lossCount += 1;
      stat.timesPlayed += 1;
    }
  }

  return Array.from(stats.values()).sort((left, right) => left.cellIndex - right.cellIndex);
}

export function buildPredictionDecision(
  insights: CellInsight[],
  predictionCount: number,
  totalRounds: number,
  truthKnownRounds: number,
): PredictionDecision {
  const minimumRoundsForSignal = MINIMUM_ROUNDS_FOR_SIGNAL;
  const topCells = insights
    .slice()
    .sort((left, right) => left.riskScore - right.riskScore)
    .slice(0, predictionCount);
  const averageTopCellConfidence =
    topCells.length === 0 ? 0 : topCells.reduce((sum, cell) => sum + cell.confidence, 0) / topCells.length;
  const historyProgress = clamp(totalRounds / minimumRoundsForSignal, 0, 1);
  const truthProgress = clamp(truthKnownRounds / Math.max(MINIMUM_TRUTH_ROUNDS_FOR_SIGNAL, predictionCount), 0, 1);
  const confidenceProgress = clamp(averageTopCellConfidence / 0.35, 0, 1);
  const signalScore = clamp(historyProgress * 0.45 + truthProgress * 0.25 + confidenceProgress * 0.3, 0, 1);

  if (totalRounds < ABSOLUTE_MINIMUM_ROUNDS) {
    return {
      predictionMode: "ABSTAIN",
      signalScore,
      averageTopCellConfidence,
      minimumRoundsForSignal,
      abstainReason: "The model does not have enough rounds yet to make even an exploratory call.",
    };
  }

  if (totalRounds < minimumRoundsForSignal) {
    return {
      predictionMode: "EXPLORATORY",
      signalScore,
      averageTopCellConfidence,
      minimumRoundsForSignal,
      abstainReason: `Only ${totalRounds} rounds are logged for this mine count. Keep collecting results before treating predictions as strong.`,
    };
  }

  if (truthKnownRounds < MINIMUM_TRUTH_ROUNDS_FOR_SIGNAL) {
    return {
      predictionMode: "EXPLORATORY",
      signalScore,
      averageTopCellConfidence,
      minimumRoundsForSignal,
      abstainReason: "The model needs more rounds with full board truth to judge whether its safe-looking cells are actually staying safe.",
    };
  }

  if (averageTopCellConfidence < MINIMUM_AVERAGE_CONFIDENCE || signalScore < 0.45) {
    return {
      predictionMode: "EXPLORATORY",
      signalScore,
      averageTopCellConfidence,
      minimumRoundsForSignal,
      abstainReason: "Signal quality is still weak for this mine count, so these cells should be treated as exploratory rather than trusted.",
    };
  }

  return {
    predictionMode: "CONFIDENT",
    signalScore,
    averageTopCellConfidence,
    minimumRoundsForSignal,
    abstainReason: null,
  };
}

export function buildPredictorNote(totalRounds: number, totalLosses: number) {
  if (totalRounds === 0) {
    return "No history yet. These picks use a balanced cold-start spread until you log results.";
  }

  if (totalRounds < 10) {
    return "Small dataset. Treat these predictions as directional while the tracker gathers more rounds.";
  }

  if (totalLosses === 0) {
    return "Only wins are logged so far. Loss reports will make the risk model more useful.";
  }

  return "Predictions are using the current round history for this mine count, weighted toward cells with fewer mine reports, better played win rates, and less repetition from recent picks.";
}
