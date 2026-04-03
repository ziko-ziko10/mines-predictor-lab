import { BOARD_CELL_COUNT } from "@/lib/board";
import type { BenchmarkMetrics, HoldoutEvaluation, RoundResult } from "@/lib/contracts";
import {
  buildCellInsights,
  buildFrequencyBaselineCells,
  deriveStatsFromHistoryRounds,
  pickSuggestedCells,
} from "@/lib/predictor";

interface EvaluationRound {
  id: string;
  predictionCount: number;
  predictedCells: number[];
  playedCells: number[];
  result: RoundResult;
  hitCell: number | null;
  mineLocations: number[];
  createdAt: Date;
}

interface AggregateTracker {
  safeSuccesses: number;
  predictionTrials: number;
  fullSurvivalSuccesses: number;
  totalMineHits: number;
}

const MINIMUM_KNOWN_ROUNDS_FOR_EVALUATION = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function wilsonInterval(successes: number, trials: number, z = 1.96) {
  if (trials === 0) {
    return { lower: 0, upper: 0 };
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

function combination(n: number, k: number) {
  if (k < 0 || k > n) {
    return 0;
  }

  if (k === 0 || k === n) {
    return 1;
  }

  const effectiveK = Math.min(k, n - k);
  let result = 1;

  for (let step = 1; step <= effectiveK; step += 1) {
    result = (result * (n - effectiveK + step)) / step;
  }

  return result;
}

function evaluatePrediction(predictedCells: number[], mineLocations: number[]) {
  const mineSet = new Set(mineLocations);
  const safeCells = predictedCells.filter((cell) => !mineSet.has(cell));
  const mineHits = predictedCells.length - safeCells.length;

  return {
    safeCount: safeCells.length,
    mineHits,
    fullSurvival: mineHits === 0,
  };
}

function emptyBenchmark(label: string): BenchmarkMetrics {
  return {
    label,
    averageSafeRate: 0,
    averageSafeRateLower: 0,
    averageSafeRateUpper: 0,
    fullSurvivalRate: 0,
    fullSurvivalRateLower: 0,
    fullSurvivalRateUpper: 0,
    averageMineHits: 0,
  };
}

function toObservedBenchmark(label: string, aggregate: AggregateTracker, roundCount: number): BenchmarkMetrics {
  if (aggregate.predictionTrials === 0 || roundCount === 0) {
    return emptyBenchmark(label);
  }

  const safeRateBand = wilsonInterval(aggregate.safeSuccesses, aggregate.predictionTrials);
  const fullSurvivalBand = wilsonInterval(aggregate.fullSurvivalSuccesses, roundCount);

  return {
    label,
    averageSafeRate: aggregate.safeSuccesses / aggregate.predictionTrials,
    averageSafeRateLower: safeRateBand.lower,
    averageSafeRateUpper: safeRateBand.upper,
    fullSurvivalRate: aggregate.fullSurvivalSuccesses / roundCount,
    fullSurvivalRateLower: fullSurvivalBand.lower,
    fullSurvivalRateUpper: fullSurvivalBand.upper,
    averageMineHits: aggregate.totalMineHits / roundCount,
  };
}

function toExpectedBenchmark(
  label: string,
  totalPredictionTrials: number,
  totalExpectedSafeSuccesses: number,
  holdoutRounds: number,
  totalExpectedFullSurvival: number,
  totalExpectedMineHits: number,
): BenchmarkMetrics {
  if (totalPredictionTrials === 0 || holdoutRounds === 0) {
    return emptyBenchmark(label);
  }

  const averageSafeRate = totalExpectedSafeSuccesses / totalPredictionTrials;
  const fullSurvivalRate = totalExpectedFullSurvival / holdoutRounds;

  return {
    label,
    averageSafeRate,
    averageSafeRateLower: averageSafeRate,
    averageSafeRateUpper: averageSafeRate,
    fullSurvivalRate,
    fullSurvivalRateLower: fullSurvivalRate,
    fullSurvivalRateUpper: fullSurvivalRate,
    averageMineHits: totalExpectedMineHits / holdoutRounds,
  };
}

export function buildHoldoutEvaluation(mineCount: number, rounds: EvaluationRound[]): HoldoutEvaluation {
  const totalRounds = rounds.length;
  const truthKnownRounds = rounds.filter((round) => round.mineLocations.length === mineCount);
  const truthCoverage = totalRounds === 0 ? 0 : truthKnownRounds.length / totalRounds;

  if (truthKnownRounds.length < MINIMUM_KNOWN_ROUNDS_FOR_EVALUATION) {
    return {
      truthKnownRounds: truthKnownRounds.length,
      truthCoverage,
      holdoutRounds: 0,
      trainingRounds: totalRounds,
      reliable: false,
      minimumKnownRounds: MINIMUM_KNOWN_ROUNDS_FOR_EVALUATION,
      note: "Not enough rounds with full board truth yet. Log full mine layouts more often before trusting the backtest.",
      currentModel: emptyBenchmark("Current model"),
      frequencyBaseline: emptyBenchmark("Mine-frequency baseline"),
      randomBaseline: emptyBenchmark("Random baseline"),
    };
  }

  const chronologicalRounds = rounds.slice().sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  const knownTruthIds = new Set(
    truthKnownRounds
      .slice()
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(-Math.max(5, Math.ceil(truthKnownRounds.length * 0.2)))
      .map((round) => round.id),
  );

  const currentAggregate: AggregateTracker = {
    safeSuccesses: 0,
    predictionTrials: 0,
    fullSurvivalSuccesses: 0,
    totalMineHits: 0,
  };
  const frequencyAggregate: AggregateTracker = {
    safeSuccesses: 0,
    predictionTrials: 0,
    fullSurvivalSuccesses: 0,
    totalMineHits: 0,
  };
  let holdoutRounds = 0;
  let totalExpectedSafeSuccesses = 0;
  let totalExpectedFullSurvival = 0;
  let totalExpectedMineHits = 0;
  let firstHoldoutIndex = chronologicalRounds.length;

  for (let index = 0; index < chronologicalRounds.length; index += 1) {
    const round = chronologicalRounds[index];

    if (!knownTruthIds.has(round.id)) {
      continue;
    }

    const trainingRounds = chronologicalRounds.slice(0, index);

    if (trainingRounds.length === 0) {
      continue;
    }

    firstHoldoutIndex = Math.min(firstHoldoutIndex, index);

    const stats = deriveStatsFromHistoryRounds(trainingRounds);
    const totalLosses = trainingRounds.filter((entry) => entry.result === "LOST").length;
    const trainingTruthKnownRounds = trainingRounds.filter((entry) => entry.mineLocations.length === mineCount).length;
    const insights = buildCellInsights({
      mineCount,
      totalRounds: trainingRounds.length,
      totalLosses,
      truthKnownRounds: trainingTruthKnownRounds,
      stats,
    });
    const recentPredictions = trainingRounds
      .slice(Math.max(0, trainingRounds.length - 8))
      .reverse()
      .map((entry) => entry.predictedCells);
    const currentPrediction = pickSuggestedCells(insights, round.predictionCount, recentPredictions);
    const frequencyPrediction = buildFrequencyBaselineCells(insights, round.predictionCount);
    const currentResult = evaluatePrediction(currentPrediction, round.mineLocations);
    const frequencyResult = evaluatePrediction(frequencyPrediction, round.mineLocations);

    currentAggregate.safeSuccesses += currentResult.safeCount;
    currentAggregate.predictionTrials += round.predictionCount;
    currentAggregate.fullSurvivalSuccesses += currentResult.fullSurvival ? 1 : 0;
    currentAggregate.totalMineHits += currentResult.mineHits;

    frequencyAggregate.safeSuccesses += frequencyResult.safeCount;
    frequencyAggregate.predictionTrials += round.predictionCount;
    frequencyAggregate.fullSurvivalSuccesses += frequencyResult.fullSurvival ? 1 : 0;
    frequencyAggregate.totalMineHits += frequencyResult.mineHits;

    holdoutRounds += 1;

    const safeCellRate = (BOARD_CELL_COUNT - mineCount) / BOARD_CELL_COUNT;
    totalExpectedSafeSuccesses += round.predictionCount * safeCellRate;
    totalExpectedMineHits += round.predictionCount * (mineCount / BOARD_CELL_COUNT);
    totalExpectedFullSurvival +=
      combination(BOARD_CELL_COUNT - mineCount, round.predictionCount) / combination(BOARD_CELL_COUNT, round.predictionCount);
  }

  if (holdoutRounds === 0) {
    return {
      truthKnownRounds: truthKnownRounds.length,
      truthCoverage,
      holdoutRounds: 0,
      trainingRounds: totalRounds,
      reliable: false,
      minimumKnownRounds: MINIMUM_KNOWN_ROUNDS_FOR_EVALUATION,
      note: "The current dataset has truth-known rounds, but none of them were usable as holdout rounds with prior training history.",
      currentModel: emptyBenchmark("Current model"),
      frequencyBaseline: emptyBenchmark("Mine-frequency baseline"),
      randomBaseline: emptyBenchmark("Random baseline"),
    };
  }

  return {
    truthKnownRounds: truthKnownRounds.length,
    truthCoverage,
    holdoutRounds,
    trainingRounds: firstHoldoutIndex === chronologicalRounds.length ? totalRounds : firstHoldoutIndex,
    reliable: holdoutRounds >= 5,
    minimumKnownRounds: MINIMUM_KNOWN_ROUNDS_FOR_EVALUATION,
    note:
      truthCoverage < 0.4
        ? "Backtest uses the latest truth-known rounds only. Coverage is still low, so treat model-vs-baseline results as provisional."
        : "Backtest uses the latest truth-known rounds as a holdout window and compares the live model against simpler baselines.",
    currentModel: toObservedBenchmark("Current model", currentAggregate, holdoutRounds),
    frequencyBaseline: toObservedBenchmark("Mine-frequency baseline", frequencyAggregate, holdoutRounds),
    randomBaseline: toExpectedBenchmark(
      "Random baseline",
      currentAggregate.predictionTrials,
      totalExpectedSafeSuccesses,
      holdoutRounds,
      totalExpectedFullSurvival,
      totalExpectedMineHits,
    ),
  };
}
