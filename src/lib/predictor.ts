import { BOARD_CELL_COUNT, cellLabel, getAllCells } from "@/lib/board";
import type { CellInsight, HoldoutEvaluation, PredictionMode } from "@/lib/contracts";
import {
  deriveStatsFromHistoryRounds,
  emptyRawCellStat,
  isTruthKnownRound,
  normalizeHistoryRound,
  type ModelHistoryRound,
  type RawCellStat,
} from "@/lib/round-stats";

export const MODEL_VERSION = "bayes-recency-v2";

export interface PredictionDecision {
  predictionMode: PredictionMode;
  signalScore: number;
  averageTopCellConfidence: number;
  averageTopSafeProbability: number;
  averageTopCellUncertainty: number;
  minimumRoundsForSignal: number;
  abstainReason: string | null;
  reasons: string[];
  deterministic: boolean;
}

interface InsightContext {
  mineCount: number;
  rounds: ModelHistoryRound[];
}

interface CellEvidence {
  truthWeight: number;
  truthWeightSquared: number;
  truthMineWeight: number;
  playedWeight: number;
  playedWeightSquared: number;
  playedMineWeight: number;
  playedSafeCount: number;
  playedMineCount: number;
}

const ABSOLUTE_MINIMUM_ROUNDS = 5;
export const MINIMUM_ROUNDS_FOR_SIGNAL = 12;
const MINIMUM_TRUTH_ROUNDS_FOR_SIGNAL = 6;
const MAX_CONFIDENT_TOP_CELL_UNCERTAINTY = 0.22;
const MAX_CONFIDENT_TOP_CELL_DRIFT = 0.12;

const COLD_START_ORDER = [
  13, 7, 19, 1, 5, 21, 25, 3, 11, 15, 23, 9, 17, 2, 4, 6, 10, 16, 20, 22, 24, 8, 12, 14, 18,
];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function coldStartRank(cellIndex: number) {
  return COLD_START_ORDER.indexOf(cellIndex);
}

function betaMean(successes: number, trials: number, priorMean: number, priorStrength: number) {
  return (successes + priorMean * priorStrength) / (trials + priorStrength);
}

function wilsonInterval(successes: number, trials: number, z = 1.96) {
  if (trials <= 0) {
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

function posteriorInterval(successes: number, trials: number, priorMean: number, priorStrength: number) {
  return wilsonInterval(successes + priorMean * priorStrength, trials + priorStrength);
}

function decayWeight(ageFromNewest: number, halfLife = 8) {
  return Math.pow(0.5, ageFromNewest / halfLife);
}

function effectiveSampleSize(totalWeight: number, totalWeightSquared: number) {
  if (totalWeight <= 0 || totalWeightSquared <= 0) {
    return 0;
  }

  return (totalWeight * totalWeight) / totalWeightSquared;
}

function recentSmoothedProbability(
  weightedSuccesses: number,
  weightedTrials: number,
  weightSquared: number,
  priorMean: number,
  priorStrength: number,
) {
  const effectiveTrials = effectiveSampleSize(weightedTrials, weightSquared);

  if (effectiveTrials === 0) {
    return {
      probability: priorMean,
      effectiveTrials: 0,
    };
  }

  const scaledSuccesses = weightedSuccesses * (effectiveTrials / weightedTrials);

  return {
    probability: betaMean(scaledSuccesses, effectiveTrials, priorMean, priorStrength),
    effectiveTrials,
  };
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

  return appearances * 0.004 + streak * 0.012;
}

function getHeuristicFallbackRisk(
  stat: RawCellStat,
  totalRounds: number,
  baselineMineRate: number,
  truthOnlyMineProbability: number,
) {
  const playWinRate = (stat.winCount + 1) / (stat.timesPlayed + 2);
  const predictionFailureRate = (stat.lossCount + 1) / (stat.timesPredicted + 2);
  const explorationBuffer = stat.timesPredicted === 0 ? 0.04 : 0;
  const exposurePenalty = totalRounds === 0 ? 0 : Math.min(stat.timesPredicted / totalRounds, 0.08);

  return clamp(
    truthOnlyMineProbability * 0.7 + predictionFailureRate * 0.18 + exposurePenalty - playWinRate * 0.12 - explorationBuffer,
    Math.max(0.02, baselineMineRate * 0.35),
    0.98,
  );
}

export function countTruthKnownRounds(rounds: ModelHistoryRound[], mineCount: number) {
  return rounds.filter((round) => isTruthKnownRound(round, mineCount)).length;
}

function buildEvidenceByCell(rounds: ModelHistoryRound[], mineCount: number) {
  const normalizedRounds = rounds.map(normalizeHistoryRound);
  const evidenceByCell = new Map<number, CellEvidence>();

  for (const cellIndex of getAllCells()) {
    evidenceByCell.set(cellIndex, {
      truthWeight: 0,
      truthWeightSquared: 0,
      truthMineWeight: 0,
      playedWeight: 0,
      playedWeightSquared: 0,
      playedMineWeight: 0,
      playedSafeCount: 0,
      playedMineCount: 0,
    });
  }

  for (let index = 0; index < normalizedRounds.length; index += 1) {
    const round = normalizedRounds[index];
    const weight = decayWeight(normalizedRounds.length - 1 - index);

    if (isTruthKnownRound(round, mineCount)) {
      const mineSet = new Set(round.mineLocations);

      for (const cellIndex of getAllCells()) {
        const evidence = evidenceByCell.get(cellIndex);

        if (!evidence) {
          continue;
        }

        evidence.truthWeight += weight;
        evidence.truthWeightSquared += weight * weight;

        if (mineSet.has(cellIndex)) {
          evidence.truthMineWeight += weight;
        }
      }
    }

    for (const cellIndex of round.playedCells) {
      const evidence = evidenceByCell.get(cellIndex);

      if (!evidence) {
        continue;
      }

      evidence.playedWeight += weight;
      evidence.playedWeightSquared += weight * weight;

      if (round.result === "LOST" && round.hitCell === cellIndex) {
        evidence.playedMineCount += 1;
        evidence.playedMineWeight += weight;
      } else {
        evidence.playedSafeCount += 1;
      }
    }
  }

  return {
    normalizedRounds,
    evidenceByCell,
  };
}

export function buildCellInsights({ mineCount, rounds }: InsightContext) {
  const baselineMineRate = mineCount / BOARD_CELL_COUNT;
  const { normalizedRounds, evidenceByCell } = buildEvidenceByCell(rounds, mineCount);
  const stats = deriveStatsFromHistoryRounds(normalizedRounds, mineCount);
  const statsByCell = new Map(stats.map((entry) => [entry.cellIndex, entry]));
  const totalRounds = normalizedRounds.length;
  const truthKnownRounds = countTruthKnownRounds(normalizedRounds, mineCount);

  return getAllCells().map((cellIndex) => {
    const stat = statsByCell.get(cellIndex) ?? emptyRawCellStat(cellIndex);
    const evidence = evidenceByCell.get(cellIndex);

    if (!evidence) {
      throw new Error(`Missing evidence for cell ${cellIndex}.`);
    }

    const playWinRate = (stat.winCount + 1) / (stat.timesPlayed + 2);
    const predictionFailureRate = (stat.lossCount + 1) / (stat.timesPredicted + 2);
    const truthOnlyMineProbability = betaMean(stat.mineReports, truthKnownRounds, baselineMineRate, 18);
    const truthOnlyBand = posteriorInterval(stat.mineReports, truthKnownRounds, baselineMineRate, 18);
    const playedMineProbability = betaMean(stat.lossCount, stat.timesPlayed, baselineMineRate, 12);
    const playedSafeRate = betaMean(evidence.playedSafeCount, stat.timesPlayed, 1 - baselineMineRate, 8);
    const playedMineRate = 1 - playedSafeRate;
    const recentTruth = recentSmoothedProbability(
      evidence.truthMineWeight,
      evidence.truthWeight,
      evidence.truthWeightSquared,
      truthOnlyMineProbability,
      8,
    );
    const recentPlayed = recentSmoothedProbability(
      evidence.playedMineWeight,
      evidence.playedWeight,
      evidence.playedWeightSquared,
      playedMineProbability,
      6,
    );
    const truthSupport = truthKnownRounds;
    const playedSupport = stat.timesPlayed;
    const truthSupportScore = clamp(truthSupport / 12, 0, 1);
    const playedSupportScore = clamp(playedSupport / 10, 0, 1);
    const truthWeight = 0.72 * truthSupportScore;
    const playedWeight = 0.28 * playedSupportScore * (1 - truthWeight * 0.35);
    const baselineWeight = Math.max(0, 1 - truthWeight - playedWeight);
    const historyMineProbability =
      baselineWeight * baselineMineRate + truthWeight * truthOnlyMineProbability + playedWeight * playedMineProbability;
    const recentMineProbability = clamp(
      baselineWeight * baselineMineRate + truthWeight * recentTruth.probability + playedWeight * recentPlayed.probability,
      0.02,
      0.98,
    );
    const driftScore = recentMineProbability - historyMineProbability;
    const driftStrength = clamp((recentTruth.effectiveTrials + recentPlayed.effectiveTrials) / 10, 0, 1);
    const estimatedMineProbability = clamp(historyMineProbability + driftScore * 0.35 * driftStrength, 0.02, 0.98);
    const combinedEffectiveSupport = recentTruth.effectiveTrials + recentPlayed.effectiveTrials * 0.65 + 6;
    const combinedBand = wilsonInterval(estimatedMineProbability * combinedEffectiveSupport, combinedEffectiveSupport);
    const uncertaintyWidth = combinedBand.upper - combinedBand.lower;
    const supportScore = clamp((truthSupport + playedSupport * 0.75) / 18, 0, 1);
    const confidence = clamp(supportScore * 0.65 + clamp((0.4 - uncertaintyWidth) / 0.4, 0, 1) * 0.35, 0, 1);
    const heuristicRiskScore = getHeuristicFallbackRisk(
      stat,
      totalRounds,
      baselineMineRate,
      truthOnlyMineProbability,
    );
    const supportTier =
      truthSupport >= 6 && truthSupport >= playedSupport * 0.8
        ? "TRUTH"
        : truthSupport >= 3 && playedSupport >= 4
          ? "MIXED"
          : playedSupport >= 4
            ? "PLAYED"
            : "WEAK";

    const insight: CellInsight = {
      cellIndex,
      label: cellLabel(cellIndex),
      riskScore: estimatedMineProbability,
      safetyScore: 1 - estimatedMineProbability,
      confidence,
      mineRate: truthOnlyMineProbability,
      playWinRate,
      predictionFailureRate,
      mineRateLowerBound: truthOnlyBand.lower,
      mineRateUpperBound: truthOnlyBand.upper,
      timesPredicted: stat.timesPredicted,
      timesPlayed: stat.timesPlayed,
      mineReports: stat.mineReports,
      estimatedMineProbability,
      estimatedSafeProbability: 1 - estimatedMineProbability,
      uncertaintyWidth,
      supportScore,
      truthSupport,
      playedSupport,
      playedSafeRate,
      playedMineRate,
      truthOnlyMineProbability,
      truthOnlySafeProbability: 1 - truthOnlyMineProbability,
      recentMineProbability,
      recentSafeProbability: 1 - recentMineProbability,
      recentTruthMineProbability: recentTruth.probability,
      recentPlayedMineProbability: recentPlayed.probability,
      driftScore,
      heuristicRiskScore,
      supportedMostlyByTruth: truthSupport >= playedSupport,
      supportTier,
    };

    return insight;
  });
}

function compareConfidentInsights(left: CellInsight, right: CellInsight) {
  if (left.estimatedSafeProbability !== right.estimatedSafeProbability) {
    return right.estimatedSafeProbability - left.estimatedSafeProbability;
  }

  if (left.uncertaintyWidth !== right.uncertaintyWidth) {
    return left.uncertaintyWidth - right.uncertaintyWidth;
  }

  if (left.truthSupport !== right.truthSupport) {
    return right.truthSupport - left.truthSupport;
  }

  if (left.playedSupport !== right.playedSupport) {
    return right.playedSupport - left.playedSupport;
  }

  if (left.heuristicRiskScore !== right.heuristicRiskScore) {
    return left.heuristicRiskScore - right.heuristicRiskScore;
  }

  return coldStartRank(left.cellIndex) - coldStartRank(right.cellIndex);
}

export function rankInsightsForPrediction(
  insights: CellInsight[],
  recentPredictions: number[][] = [],
  predictionMode: PredictionMode = "CONFIDENT",
) {
  if (predictionMode === "CONFIDENT") {
    return insights.slice().sort(compareConfidentInsights);
  }

  return insights
    .slice()
    .sort((left, right) => {
      const leftScore = left.estimatedMineProbability + getRepeatPenalty(left.cellIndex, recentPredictions);
      const rightScore = right.estimatedMineProbability + getRepeatPenalty(right.cellIndex, recentPredictions);

      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }

      return compareConfidentInsights(left, right);
    });
}

export function pickSuggestedCells(
  insights: CellInsight[],
  predictionCount: number,
  recentPredictions: number[][] = [],
  predictionMode: PredictionMode = "CONFIDENT",
) {
  return rankInsightsForPrediction(insights, recentPredictions, predictionMode)
    .slice(0, predictionCount)
    .map((cell) => cell.cellIndex)
    .sort((left, right) => left - right);
}

export function buildFrequencyBaselineCells(insights: CellInsight[], predictionCount: number) {
  return rankInsightsForFrequencyBaseline(insights)
    .slice(0, predictionCount)
    .map((cell) => cell.cellIndex);
}

export function rankInsightsForFrequencyBaseline(insights: CellInsight[]) {
  return insights.slice().sort((left, right) => {
    if (left.truthOnlyMineProbability !== right.truthOnlyMineProbability) {
      return left.truthOnlyMineProbability - right.truthOnlyMineProbability;
    }

    if (left.mineReports !== right.mineReports) {
      return left.mineReports - right.mineReports;
    }

    if (left.heuristicRiskScore !== right.heuristicRiskScore) {
      return left.heuristicRiskScore - right.heuristicRiskScore;
    }

    return coldStartRank(left.cellIndex) - coldStartRank(right.cellIndex);
  });
}

export function buildPredictionDecision({
  mineCount,
  insights,
  predictionCount,
  totalRounds,
  truthKnownRounds,
  evaluation,
}: {
  mineCount: number;
  insights: CellInsight[];
  predictionCount: number;
  totalRounds: number;
  truthKnownRounds: number;
  evaluation: HoldoutEvaluation;
}): PredictionDecision {
  const minimumRoundsForSignal = MINIMUM_ROUNDS_FOR_SIGNAL;
  const topCells = rankInsightsForPrediction(insights, [], "CONFIDENT").slice(0, predictionCount);
  const averageTopCellConfidence =
    topCells.length === 0 ? 0 : topCells.reduce((sum, cell) => sum + cell.confidence, 0) / topCells.length;
  const averageTopSafeProbability =
    topCells.length === 0 ? 0 : topCells.reduce((sum, cell) => sum + cell.estimatedSafeProbability, 0) / topCells.length;
  const averageTopCellUncertainty =
    topCells.length === 0 ? 1 : topCells.reduce((sum, cell) => sum + cell.uncertaintyWidth, 0) / topCells.length;
  const averageTopDrift = topCells.length === 0 ? 0 : topCells.reduce((sum, cell) => sum + Math.abs(cell.driftScore), 0) / topCells.length;
  const baselineSafeRate = (BOARD_CELL_COUNT - mineCount) / BOARD_CELL_COUNT;
  const safeEdge = averageTopSafeProbability - baselineSafeRate;
  const signalScore = clamp(
    clamp(totalRounds / 24, 0, 1) * 0.2 +
      clamp(truthKnownRounds / 10, 0, 1) * 0.2 +
      clamp((0.35 - averageTopCellUncertainty) / 0.2, 0, 1) * 0.15 +
      clamp(safeEdge / 0.08, 0, 1) * 0.1 +
      clamp(evaluation.safeRateLiftVsRandom.lower / 0.03, 0, 1) * 0.2 +
      clamp((evaluation.safeRateLiftVsFrequency.value + 0.01) / 0.03, 0, 1) * 0.15,
    0,
    1,
  );
  const reasons: string[] = [];

  if (totalRounds < ABSOLUTE_MINIMUM_ROUNDS) {
    reasons.push(`Only ${totalRounds} rounds are logged for this mine count, which is below the minimum needed for even exploratory ranking.`);

    return {
      predictionMode: "ABSTAIN",
      signalScore,
      averageTopCellConfidence,
      averageTopSafeProbability,
      averageTopCellUncertainty,
      minimumRoundsForSignal,
      abstainReason: reasons[0],
      reasons,
      deterministic: true,
    };
  }

  if (truthKnownRounds < Math.min(3, MINIMUM_TRUTH_ROUNDS_FOR_SIGNAL)) {
    reasons.push("There are not enough full-board truth rounds yet to estimate mine probabilities with useful calibration.");
  }

  if (totalRounds < minimumRoundsForSignal) {
    reasons.push(`Only ${totalRounds} rounds are logged; the model needs at least ${minimumRoundsForSignal} rounds before strong confidence is even considered.`);
  }

  if (evaluation.status === "INSUFFICIENT_COVERAGE") {
    reasons.push("Walk-forward evaluation does not have enough truth-known coverage yet, so the model cannot justify a confident claim.");
  }

  if (evaluation.status === "PROVISIONAL") {
    reasons.push("Walk-forward evaluation is still provisional because the usable truth-known window is small or unstable.");
  }

  if (evaluation.status === "WEAK_SIGNAL") {
    reasons.push("Walk-forward testing is not showing durable lift over the random and frequency baselines for this mine count.");

    return {
      predictionMode: "ABSTAIN",
      signalScore,
      averageTopCellConfidence,
      averageTopSafeProbability,
      averageTopCellUncertainty,
      minimumRoundsForSignal,
      abstainReason: reasons[reasons.length - 1],
      reasons,
      deterministic: true,
    };
  }

  if (averageTopCellUncertainty > MAX_CONFIDENT_TOP_CELL_UNCERTAINTY) {
    reasons.push("The top-ranked cells still have wide uncertainty bands, so the ranking stays exploratory.");
  }

  if (averageTopDrift > MAX_CONFIDENT_TOP_CELL_DRIFT) {
    reasons.push("Recent cell behavior is drifting too far from the full-history estimate to treat the ranking as stable.");
  }

  if (safeEdge < 0.03) {
    reasons.push("The top-ranked cells are not separated far enough from the board-wide safe baseline to justify confident mode.");
  }

  if (reasons.length > 0) {
    return {
      predictionMode: "EXPLORATORY",
      signalScore,
      averageTopCellConfidence,
      averageTopSafeProbability,
      averageTopCellUncertainty,
      minimumRoundsForSignal,
      abstainReason: reasons[0],
      reasons,
      deterministic: true,
    };
  }

  return {
    predictionMode: "CONFIDENT",
    signalScore,
    averageTopCellConfidence,
    averageTopSafeProbability,
    averageTopCellUncertainty,
    minimumRoundsForSignal,
    abstainReason: null,
    reasons: [
      "Walk-forward evaluation is currently beating the baselines with enough truth-known support.",
      "The top-ranked cells have comparatively tight uncertainty and limited recent drift.",
    ],
    deterministic: true,
  };
}

export function buildPredictorNote(totalRounds: number, totalLosses: number) {
  if (totalRounds === 0) {
    return "No history yet. These picks use a conservative cold start until the tracker has enough real rounds to estimate cell risk.";
  }

  if (totalRounds < 10) {
    return "Small dataset. Treat these probabilities as directional while the tracker gathers more truth-known rounds and played outcomes.";
  }

  if (totalLosses === 0) {
    return "Only wins are logged so far. Loss reports and full-board truth are still needed to calibrate mine probabilities honestly.";
  }

  return "Predictions now rank cells by Bayesian-smoothed safe probability, with recent drift and uncertainty used to avoid overstating weak signal.";
}
