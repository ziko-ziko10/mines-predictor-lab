import assert from "node:assert/strict";
import test from "node:test";

import { buildHoldoutEvaluation } from "../src/lib/evaluation";

test("walk-forward evaluation does not use future information", () => {
  const rounds = [
    { id: "1", createdAt: new Date("2024-01-01T00:00:00Z"), predictionCount: 1, predictedCells: [1], playedCells: [1], result: "WON" as const, hitCell: null, mineLocations: [2] },
    { id: "2", createdAt: new Date("2024-01-02T00:00:00Z"), predictionCount: 1, predictedCells: [1], playedCells: [1], result: "WON" as const, hitCell: null, mineLocations: [2] },
    { id: "3", createdAt: new Date("2024-01-03T00:00:00Z"), predictionCount: 1, predictedCells: [1], playedCells: [1], result: "WON" as const, hitCell: null, mineLocations: [2] },
    { id: "4", createdAt: new Date("2024-01-04T00:00:00Z"), predictionCount: 1, predictedCells: [1], playedCells: [1], result: "WON" as const, hitCell: null, mineLocations: [2] },
    { id: "5", createdAt: new Date("2024-01-05T00:00:00Z"), predictionCount: 1, predictedCells: [1], playedCells: [1], result: "WON" as const, hitCell: null, mineLocations: [2] },
    { id: "6", createdAt: new Date("2024-01-06T00:00:00Z"), predictionCount: 1, predictedCells: [1], playedCells: [1], result: "WON" as const, hitCell: null, mineLocations: [2] },
    { id: "7", createdAt: new Date("2024-01-07T00:00:00Z"), predictionCount: 1, predictedCells: [1], playedCells: [1], result: "WON" as const, hitCell: null, mineLocations: [2] },
    { id: "8", createdAt: new Date("2024-01-08T00:00:00Z"), predictionCount: 1, predictedCells: [1], playedCells: [1], result: "LOST" as const, hitCell: 1, mineLocations: [1] },
  ];
  const evaluation = buildHoldoutEvaluation(1, rounds);

  assert.equal(evaluation.holdoutRounds, 2);
  assert.equal(evaluation.currentModel.averageSafeRate, 0.5);
});

test("evaluation stays in insufficient coverage when truth-known rounds are too sparse", () => {
  const evaluation = buildHoldoutEvaluation(3, [
    {
      id: "1",
      createdAt: new Date("2024-01-01T00:00:00Z"),
      predictionCount: 2,
      predictedCells: [1, 2],
      playedCells: [1],
      result: "WON" as const,
      hitCell: null,
      mineLocations: [],
    },
    {
      id: "2",
      createdAt: new Date("2024-01-02T00:00:00Z"),
      predictionCount: 2,
      predictedCells: [1, 2],
      playedCells: [1],
      result: "WON" as const,
      hitCell: null,
      mineLocations: [3, 4, 5],
    },
  ]);

  assert.equal(evaluation.status, "INSUFFICIENT_COVERAGE");
  assert.equal(evaluation.holdoutRounds, 0);
});
