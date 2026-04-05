import assert from "node:assert/strict";
import test from "node:test";

import { buildCellInsights, buildPredictionDecision, pickSuggestedCells } from "../src/lib/predictor";
import type { HoldoutEvaluation } from "../src/lib/contracts";

function supportedEvaluation(): HoldoutEvaluation {
  return {
    truthKnownRounds: 10,
    truthCoverage: 0.8,
    holdoutRounds: 8,
    trainingRounds: 6,
    reliable: true,
    status: "SUPPORTED",
    minimumKnownRounds: 8,
    minimumTrainingRounds: 6,
    minimumTruthRounds: 3,
    note: "Supported",
    provisionalReasons: [],
    currentModel: {
      label: "Current model",
      averageSafeRate: 0.8,
      averageSafeRateLower: 0.7,
      averageSafeRateUpper: 0.9,
      fullSurvivalRate: 0.5,
      fullSurvivalRateLower: 0.4,
      fullSurvivalRateUpper: 0.6,
      averageMineHits: 0.2,
      brierScore: 0.12,
      precisionAtK: 0.8,
      precisionAtKLower: 0.7,
      precisionAtKUpper: 0.9,
      precisionK: 3,
      topCellSafeRate: 0.85,
      topCellSafeRateLower: 0.75,
      topCellSafeRateUpper: 0.95,
    },
    frequencyBaseline: {
      label: "Mine-frequency baseline",
      averageSafeRate: 0.72,
      averageSafeRateLower: 0.6,
      averageSafeRateUpper: 0.8,
      fullSurvivalRate: 0.42,
      fullSurvivalRateLower: 0.3,
      fullSurvivalRateUpper: 0.5,
      averageMineHits: 0.28,
      brierScore: 0.15,
      precisionAtK: 0.72,
      precisionAtKLower: 0.6,
      precisionAtKUpper: 0.82,
      precisionK: 3,
      topCellSafeRate: 0.75,
      topCellSafeRateLower: 0.64,
      topCellSafeRateUpper: 0.85,
    },
    randomBaseline: {
      label: "Random baseline",
      averageSafeRate: 0.6,
      averageSafeRateLower: 0.6,
      averageSafeRateUpper: 0.6,
      fullSurvivalRate: 0.32,
      fullSurvivalRateLower: 0.32,
      fullSurvivalRateUpper: 0.32,
      averageMineHits: 0.4,
      brierScore: 0.24,
      precisionAtK: 0.6,
      precisionAtKLower: 0.6,
      precisionAtKUpper: 0.6,
      precisionK: 3,
      topCellSafeRate: 0.6,
      topCellSafeRateLower: 0.6,
      topCellSafeRateUpper: 0.6,
    },
    safeRateLiftVsRandom: { value: 0.2, lower: 0.08, upper: 0.3 },
    safeRateLiftVsFrequency: { value: 0.08, lower: 0.01, upper: 0.15 },
    fullSurvivalLiftVsRandom: { value: 0.18, lower: 0.04, upper: 0.28 },
    fullSurvivalLiftVsFrequency: { value: 0.08, lower: -0.02, upper: 0.16 },
  };
}

test("CONFIDENT mode suggestions are deterministic", () => {
  const rounds = Array.from({ length: 14 }, (_, index) => ({
    predictionCount: 2,
    predictedCells: [1, 2],
    playedCells: [1],
    result: "WON" as const,
    hitCell: null,
    mineLocations: [20 + (index % 3), 24, 25],
  }));
  const insights = buildCellInsights({ mineCount: 3, rounds });
  const first = pickSuggestedCells(insights, 2, [[1, 2]], "CONFIDENT");
  const second = pickSuggestedCells(insights, 2, [[1, 2]], "CONFIDENT");

  assert.deepEqual(first, second);
});

test("tiny datasets force ABSTAIN even if evaluation data is mocked as strong", () => {
  const rounds = [
    {
      predictionCount: 1,
      predictedCells: [1],
      playedCells: [1],
      result: "WON" as const,
      hitCell: null,
      mineLocations: [20, 24, 25],
    },
    {
      predictionCount: 1,
      predictedCells: [1],
      playedCells: [1],
      result: "WON" as const,
      hitCell: null,
      mineLocations: [19, 24, 25],
    },
  ];
  const insights = buildCellInsights({ mineCount: 3, rounds });
  const decision = buildPredictionDecision({
    mineCount: 3,
    insights,
    predictionCount: 1,
    totalRounds: rounds.length,
    truthKnownRounds: rounds.length,
    evaluation: supportedEvaluation(),
  });

  assert.equal(decision.predictionMode, "ABSTAIN");
});
