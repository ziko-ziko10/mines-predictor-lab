import { BOARD_CELL_COUNT } from "@/lib/board";
import type { BenchmarkMetrics, HoldoutEvaluation } from "@/lib/contracts";
import {
  buildCellInsights,
  rankInsightsForFrequencyBaseline,
  rankInsightsForPrediction,
} from "@/lib/predictor";
import { isTruthKnownRound, normalizeHistoryRound, type ModelHistoryRound } from "@/lib/round-stats";

interface EvaluationRound extends ModelHistoryRound {
  id: string;
  createdAt: Date;
}

interface AggregateTracker {
  safeSuccesses: number;
  predictionTrials: number;
  fullSurvivalSuccesses: number;
  totalMineHits: number;
  brierTotal: number;
  brierTrials: number;
  precisionSuccesses: number;
  precisionTrials: number;
  topCellSafeSuccesses: number;
  topCellTrials: number;
}

interface RoundSample {
  safeRate: number;
  fullSurvival: number;
  averageMineHits: number;
  brierScore: number | null;
  precisionAtK: number | null;
  topCellSafe: number | null;
}

const MINIMUM_KNOWN_ROUNDS_FOR_EVALUATION = 8;
const MINIMUM_TRAINING_ROUNDS = 6;
const MINIMUM_TRAINING_TRUTH_ROUNDS = 3;
const MINIMUM_WALK_FORWARD_ROUNDS = 6;
const PRECISION_K = 3;
const BOOTSTRAP_ITERATIONS = 1200;

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

function mulberry32(seed: number) {
  let state = seed >>> 0;

  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let result = Math.imul(state ^ (state >>> 15), 1 | state);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function bootstrapMeanInterval(values: number[], seed: number) {
  if (values.length === 0) {
    return { value: 0, lower: 0, upper: 0 };
  }

  const value = values.reduce((sum, entry) => sum + entry, 0) / values.length;

  if (values.length === 1) {
    return { value, lower: value, upper: value };
  }

  const random = mulberry32(seed);
  const samples: number[] = [];

  for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration += 1) {
    let total = 0;

    for (let index = 0; index < values.length; index += 1) {
      total += values[Math.floor(random() * values.length)] ?? 0;
    }

    samples.push(total / values.length);
  }

  samples.sort((left, right) => left - right);

  return {
    value,
    lower: samples[Math.floor(BOOTSTRAP_ITERATIONS * 0.025)] ?? value,
    upper: samples[Math.floor(BOOTSTRAP_ITERATIONS * 0.975)] ?? value,
  };
}

function evaluatePrediction(
  predictedCells: number[],
  mineLocations: number[],
  safeProbabilityByCell: Map<number, number>,
) {
  const mineSet = new Set(mineLocations);
  const safeCount = predictedCells.filter((cell) => !mineSet.has(cell)).length;
  const mineHits = predictedCells.length - safeCount;
  const brierScore =
    predictedCells.length === 0
      ? null
      : predictedCells.reduce((sum, cell) => {
          const safeProbability = safeProbabilityByCell.get(cell) ?? 0.5;
          const outcome = mineSet.has(cell) ? 0 : 1;
          return sum + (safeProbability - outcome) ** 2;
        }, 0) / predictedCells.length;
  const precisionCount = Math.min(PRECISION_K, predictedCells.length);
  const precisionSafeCount = predictedCells.slice(0, precisionCount).filter((cell) => !mineSet.has(cell)).length;

  return {
    safeCount,
    mineHits,
    fullSurvival: mineHits === 0,
    brierScore,
    precisionAtK: precisionCount === 0 ? null : precisionSafeCount / precisionCount,
    topCellSafe: predictedCells.length === 0 ? null : mineSet.has(predictedCells[0]) ? 0 : 1,
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
    brierScore: null,
    precisionAtK: 0,
    precisionAtKLower: 0,
    precisionAtKUpper: 0,
    precisionK: PRECISION_K,
    topCellSafeRate: 0,
    topCellSafeRateLower: 0,
    topCellSafeRateUpper: 0,
  };
}

function toObservedBenchmark(label: string, aggregate: AggregateTracker, roundCount: number): BenchmarkMetrics {
  if (aggregate.predictionTrials === 0 || roundCount === 0) {
    return emptyBenchmark(label);
  }

  const safeRateBand = wilsonInterval(aggregate.safeSuccesses, aggregate.predictionTrials);
  const fullSurvivalBand = wilsonInterval(aggregate.fullSurvivalSuccesses, roundCount);
  const precisionBand = wilsonInterval(aggregate.precisionSuccesses, aggregate.precisionTrials);
  const topCellBand = wilsonInterval(aggregate.topCellSafeSuccesses, aggregate.topCellTrials);

  return {
    label,
    averageSafeRate: aggregate.safeSuccesses / aggregate.predictionTrials,
    averageSafeRateLower: safeRateBand.lower,
    averageSafeRateUpper: safeRateBand.upper,
    fullSurvivalRate: aggregate.fullSurvivalSuccesses / roundCount,
    fullSurvivalRateLower: fullSurvivalBand.lower,
    fullSurvivalRateUpper: fullSurvivalBand.upper,
    averageMineHits: aggregate.totalMineHits / roundCount,
    brierScore: aggregate.brierTrials === 0 ? null : aggregate.brierTotal / aggregate.brierTrials,
    precisionAtK: aggregate.precisionTrials === 0 ? 0 : aggregate.precisionSuccesses / aggregate.precisionTrials,
    precisionAtKLower: precisionBand.lower,
    precisionAtKUpper: precisionBand.upper,
    precisionK: PRECISION_K,
    topCellSafeRate: aggregate.topCellTrials === 0 ? 0 : aggregate.topCellSafeSuccesses / aggregate.topCellTrials,
    topCellSafeRateLower: topCellBand.lower,
    topCellSafeRateUpper: topCellBand.upper,
  };
}

function toExpectedBenchmark(
  label: string,
  totalPredictionTrials: number,
  totalExpectedSafeSuccesses: number,
  holdoutRounds: number,
  totalExpectedFullSurvival: number,
  totalExpectedMineHits: number,
  totalExpectedBrier: number,
  totalExpectedPrecisionSuccesses: number,
  totalExpectedPrecisionTrials: number,
) {
  if (totalPredictionTrials === 0 || holdoutRounds === 0) {
    return emptyBenchmark(label);
  }

  const averageSafeRate = totalExpectedSafeSuccesses / totalPredictionTrials;
  const fullSurvivalRate = totalExpectedFullSurvival / holdoutRounds;
  const precisionAtK = totalExpectedPrecisionTrials === 0 ? 0 : totalExpectedPrecisionSuccesses / totalExpectedPrecisionTrials;

  return {
    label,
    averageSafeRate,
    averageSafeRateLower: averageSafeRate,
    averageSafeRateUpper: averageSafeRate,
    fullSurvivalRate,
    fullSurvivalRateLower: fullSurvivalRate,
    fullSurvivalRateUpper: fullSurvivalRate,
    averageMineHits: totalExpectedMineHits / holdoutRounds,
    brierScore: totalExpectedBrier / holdoutRounds,
    precisionAtK,
    precisionAtKLower: precisionAtK,
    precisionAtKUpper: precisionAtK,
    precisionK: PRECISION_K,
    topCellSafeRate: averageSafeRate,
    topCellSafeRateLower: averageSafeRate,
    topCellSafeRateUpper: averageSafeRate,
  };
}

function addSample(aggregate: AggregateTracker, sample: RoundSample, predictionCount: number) {
  aggregate.safeSuccesses += sample.safeRate * predictionCount;
  aggregate.predictionTrials += predictionCount;
  aggregate.fullSurvivalSuccesses += sample.fullSurvival;
  aggregate.totalMineHits += sample.averageMineHits;

  if (sample.brierScore !== null) {
    aggregate.brierTotal += sample.brierScore;
    aggregate.brierTrials += 1;
  }

  if (sample.precisionAtK !== null) {
    const precisionTrials = Math.min(PRECISION_K, predictionCount);
    aggregate.precisionSuccesses += sample.precisionAtK * precisionTrials;
    aggregate.precisionTrials += precisionTrials;
  }

  if (sample.topCellSafe !== null) {
    aggregate.topCellSafeSuccesses += sample.topCellSafe;
    aggregate.topCellTrials += 1;
  }
}

function zeroDelta() {
  return { value: 0, lower: 0, upper: 0 };
}

export function buildHoldoutEvaluation(mineCount: number, rounds: EvaluationRound[]): HoldoutEvaluation {
  const chronologicalRounds = rounds
    .map((round) => ({
      ...round,
      ...normalizeHistoryRound(round),
    }))
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  const totalRounds = chronologicalRounds.length;
  const truthKnownRounds = chronologicalRounds.filter((round) => isTruthKnownRound(round, mineCount));
  const truthCoverage = totalRounds === 0 ? 0 : truthKnownRounds.length / totalRounds;

  if (truthKnownRounds.length < MINIMUM_KNOWN_ROUNDS_FOR_EVALUATION) {
    return {
      truthKnownRounds: truthKnownRounds.length,
      truthCoverage,
      holdoutRounds: 0,
      trainingRounds: totalRounds,
      reliable: false,
      status: "INSUFFICIENT_COVERAGE",
      minimumKnownRounds: MINIMUM_KNOWN_ROUNDS_FOR_EVALUATION,
      minimumTrainingRounds: MINIMUM_TRAINING_ROUNDS,
      minimumTruthRounds: MINIMUM_TRAINING_TRUTH_ROUNDS,
      note: "Not enough full-board truth is logged yet to run a meaningful walk-forward evaluation.",
      provisionalReasons: [
        `Only ${truthKnownRounds.length} truth-known rounds are available; at least ${MINIMUM_KNOWN_ROUNDS_FOR_EVALUATION} are needed.`,
      ],
      currentModel: emptyBenchmark("Current model"),
      frequencyBaseline: emptyBenchmark("Mine-frequency baseline"),
      randomBaseline: emptyBenchmark("Random baseline"),
      safeRateLiftVsRandom: zeroDelta(),
      safeRateLiftVsFrequency: zeroDelta(),
      fullSurvivalLiftVsRandom: zeroDelta(),
      fullSurvivalLiftVsFrequency: zeroDelta(),
    };
  }

  const currentAggregate: AggregateTracker = {
    safeSuccesses: 0,
    predictionTrials: 0,
    fullSurvivalSuccesses: 0,
    totalMineHits: 0,
    brierTotal: 0,
    brierTrials: 0,
    precisionSuccesses: 0,
    precisionTrials: 0,
    topCellSafeSuccesses: 0,
    topCellTrials: 0,
  };
  const frequencyAggregate: AggregateTracker = {
    safeSuccesses: 0,
    predictionTrials: 0,
    fullSurvivalSuccesses: 0,
    totalMineHits: 0,
    brierTotal: 0,
    brierTrials: 0,
    precisionSuccesses: 0,
    precisionTrials: 0,
    topCellSafeSuccesses: 0,
    topCellTrials: 0,
  };
  const currentSafeRates: number[] = [];
  const frequencySafeRates: number[] = [];
  const randomSafeRates: number[] = [];
  const currentFullSurvivals: number[] = [];
  const frequencyFullSurvivals: number[] = [];
  const randomFullSurvivals: number[] = [];
  let holdoutRounds = 0;
  let totalExpectedSafeSuccesses = 0;
  let totalExpectedFullSurvival = 0;
  let totalExpectedMineHits = 0;
  let totalExpectedBrier = 0;
  let totalExpectedPrecisionSuccesses = 0;
  let totalExpectedPrecisionTrials = 0;
  let firstHoldoutIndex = chronologicalRounds.length;

  for (let index = 0; index < chronologicalRounds.length; index += 1) {
    const round = chronologicalRounds[index];

    if (!isTruthKnownRound(round, mineCount)) {
      continue;
    }

    const trainingRounds = chronologicalRounds.slice(0, index);
    const trainingTruthKnownRounds = trainingRounds.filter((entry) => isTruthKnownRound(entry, mineCount)).length;

    if (trainingRounds.length < MINIMUM_TRAINING_ROUNDS || trainingTruthKnownRounds < MINIMUM_TRAINING_TRUTH_ROUNDS) {
      continue;
    }

    const insights = buildCellInsights({
      mineCount,
      rounds: trainingRounds,
    });
    const recentPredictions = trainingRounds
      .slice(Math.max(0, trainingRounds.length - 8))
      .reverse()
      .map((entry) => entry.predictedCells);
    const currentRanking = rankInsightsForPrediction(insights, recentPredictions, "CONFIDENT");
    const frequencyRanking = rankInsightsForFrequencyBaseline(insights);
    const currentPrediction = currentRanking.slice(0, round.predictionCount).map((entry) => entry.cellIndex);
    const frequencyPrediction = frequencyRanking.slice(0, round.predictionCount).map((entry) => entry.cellIndex);
    const currentSafeProbabilityByCell = new Map(
      currentRanking.map((entry) => [entry.cellIndex, entry.estimatedSafeProbability]),
    );
    const frequencySafeProbabilityByCell = new Map(
      frequencyRanking.map((entry) => [entry.cellIndex, entry.truthOnlySafeProbability]),
    );
    const currentResult = evaluatePrediction(currentPrediction, round.mineLocations, currentSafeProbabilityByCell);
    const frequencyResult = evaluatePrediction(frequencyPrediction, round.mineLocations, frequencySafeProbabilityByCell);
    const safeCellRate = (BOARD_CELL_COUNT - mineCount) / BOARD_CELL_COUNT;
    const randomMineRate = mineCount / BOARD_CELL_COUNT;
    const randomFullSurvival =
      combination(BOARD_CELL_COUNT - mineCount, round.predictionCount) / combination(BOARD_CELL_COUNT, round.predictionCount);
    const precisionTrials = Math.min(PRECISION_K, round.predictionCount);
    const randomBrier = safeCellRate * randomMineRate;

    firstHoldoutIndex = Math.min(firstHoldoutIndex, index);
    holdoutRounds += 1;
    addSample(
      currentAggregate,
      {
        safeRate: currentResult.safeCount / round.predictionCount,
        fullSurvival: currentResult.fullSurvival ? 1 : 0,
        averageMineHits: currentResult.mineHits,
        brierScore: currentResult.brierScore,
        precisionAtK: currentResult.precisionAtK,
        topCellSafe: currentResult.topCellSafe,
      },
      round.predictionCount,
    );
    addSample(
      frequencyAggregate,
      {
        safeRate: frequencyResult.safeCount / round.predictionCount,
        fullSurvival: frequencyResult.fullSurvival ? 1 : 0,
        averageMineHits: frequencyResult.mineHits,
        brierScore: frequencyResult.brierScore,
        precisionAtK: frequencyResult.precisionAtK,
        topCellSafe: frequencyResult.topCellSafe,
      },
      round.predictionCount,
    );
    currentSafeRates.push(currentResult.safeCount / round.predictionCount);
    frequencySafeRates.push(frequencyResult.safeCount / round.predictionCount);
    randomSafeRates.push(safeCellRate);
    currentFullSurvivals.push(currentResult.fullSurvival ? 1 : 0);
    frequencyFullSurvivals.push(frequencyResult.fullSurvival ? 1 : 0);
    randomFullSurvivals.push(randomFullSurvival);
    totalExpectedSafeSuccesses += round.predictionCount * safeCellRate;
    totalExpectedMineHits += round.predictionCount * randomMineRate;
    totalExpectedFullSurvival += randomFullSurvival;
    totalExpectedBrier += randomBrier;
    totalExpectedPrecisionSuccesses += precisionTrials * safeCellRate;
    totalExpectedPrecisionTrials += precisionTrials;
  }

  if (holdoutRounds === 0) {
    return {
      truthKnownRounds: truthKnownRounds.length,
      truthCoverage,
      holdoutRounds: 0,
      trainingRounds: totalRounds,
      reliable: false,
      status: "INSUFFICIENT_COVERAGE",
      minimumKnownRounds: MINIMUM_KNOWN_ROUNDS_FOR_EVALUATION,
      minimumTrainingRounds: MINIMUM_TRAINING_ROUNDS,
      minimumTruthRounds: MINIMUM_TRAINING_TRUTH_ROUNDS,
      note: "Truth-known rounds exist, but not enough earlier history was available to evaluate them without leaking future information.",
      provisionalReasons: [
        `A round is only scored once at least ${MINIMUM_TRAINING_ROUNDS} prior rounds and ${MINIMUM_TRAINING_TRUTH_ROUNDS} prior truth-known rounds exist.`,
      ],
      currentModel: emptyBenchmark("Current model"),
      frequencyBaseline: emptyBenchmark("Mine-frequency baseline"),
      randomBaseline: emptyBenchmark("Random baseline"),
      safeRateLiftVsRandom: zeroDelta(),
      safeRateLiftVsFrequency: zeroDelta(),
      fullSurvivalLiftVsRandom: zeroDelta(),
      fullSurvivalLiftVsFrequency: zeroDelta(),
    };
  }

  const safeRateLiftVsRandom = bootstrapMeanInterval(
    currentSafeRates.map((value, index) => value - (randomSafeRates[index] ?? 0)),
    mineCount * 1000 + holdoutRounds * 11 + 1,
  );
  const safeRateLiftVsFrequency = bootstrapMeanInterval(
    currentSafeRates.map((value, index) => value - (frequencySafeRates[index] ?? 0)),
    mineCount * 1000 + holdoutRounds * 11 + 2,
  );
  const fullSurvivalLiftVsRandom = bootstrapMeanInterval(
    currentFullSurvivals.map((value, index) => value - (randomFullSurvivals[index] ?? 0)),
    mineCount * 1000 + holdoutRounds * 11 + 3,
  );
  const fullSurvivalLiftVsFrequency = bootstrapMeanInterval(
    currentFullSurvivals.map((value, index) => value - (frequencyFullSurvivals[index] ?? 0)),
    mineCount * 1000 + holdoutRounds * 11 + 4,
  );
  const currentModel = toObservedBenchmark("Current model", currentAggregate, holdoutRounds);
  const frequencyBaseline = toObservedBenchmark("Mine-frequency baseline", frequencyAggregate, holdoutRounds);
  const randomBaseline = toExpectedBenchmark(
    "Random baseline",
    currentAggregate.predictionTrials,
    totalExpectedSafeSuccesses,
    holdoutRounds,
    totalExpectedFullSurvival,
    totalExpectedMineHits,
    totalExpectedBrier,
    totalExpectedPrecisionSuccesses,
    totalExpectedPrecisionTrials,
  );
  const provisionalReasons: string[] = [];
  let status: HoldoutEvaluation["status"] = "SUPPORTED";

  if (holdoutRounds < MINIMUM_WALK_FORWARD_ROUNDS) {
    status = "PROVISIONAL";
    provisionalReasons.push(
      `Only ${holdoutRounds} walk-forward rounds were scored; at least ${MINIMUM_WALK_FORWARD_ROUNDS} are preferred before trusting deltas.`,
    );
  }

  if (truthCoverage < 0.35) {
    status = "PROVISIONAL";
    provisionalReasons.push("Full-board truth coverage is still low, so the walk-forward backtest should be treated as provisional.");
  }

  if (
    status === "SUPPORTED" &&
    (safeRateLiftVsRandom.lower <= 0 || safeRateLiftVsFrequency.value <= 0 ||
      (currentModel.brierScore !== null && randomBaseline.brierScore !== null && currentModel.brierScore >= randomBaseline.brierScore))
  ) {
    status = "WEAK_SIGNAL";
    provisionalReasons.push("The walk-forward model is not yet showing durable, calibration-aware lift over the simpler baselines.");
  }

  const note =
    status === "PROVISIONAL"
      ? "Walk-forward evaluation is available, but the current truth coverage or evaluation window is still too small for strong trust."
      : status === "WEAK_SIGNAL"
        ? "Walk-forward evaluation has enough coverage to judge the model, and it currently does not beat the baselines reliably enough for strong confidence."
        : "Walk-forward evaluation is using only prior data and the current model is showing durable lift over the simpler baselines.";

  return {
    truthKnownRounds: truthKnownRounds.length,
    truthCoverage,
    holdoutRounds,
    trainingRounds: firstHoldoutIndex === chronologicalRounds.length ? totalRounds : firstHoldoutIndex,
    reliable: status === "SUPPORTED" || status === "WEAK_SIGNAL",
    status,
    minimumKnownRounds: MINIMUM_KNOWN_ROUNDS_FOR_EVALUATION,
    minimumTrainingRounds: MINIMUM_TRAINING_ROUNDS,
    minimumTruthRounds: MINIMUM_TRAINING_TRUTH_ROUNDS,
    note,
    provisionalReasons,
    currentModel,
    frequencyBaseline,
    randomBaseline,
    safeRateLiftVsRandom,
    safeRateLiftVsFrequency,
    fullSurvivalLiftVsRandom,
    fullSurvivalLiftVsFrequency,
  };
}
