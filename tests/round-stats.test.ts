import assert from "node:assert/strict";
import test from "node:test";

import { deriveRoundStatDelta, deriveStatsFromHistoryRounds } from "../src/lib/round-stats";

test("deriveRoundStatDelta counts won rounds consistently", () => {
  const delta = deriveRoundStatDelta(
    {
      predictionCount: 3,
      predictedCells: [1, 2, 3],
      playedCells: [1, 2],
      result: "WON",
      hitCell: null,
      mineLocations: [],
    },
    3,
  );

  assert.deepEqual(delta, [
    { cellIndex: 1, timesPredicted: 1, timesPlayed: 1, mineReports: 0, winCount: 1, lossCount: 0 },
    { cellIndex: 2, timesPredicted: 1, timesPlayed: 1, mineReports: 0, winCount: 1, lossCount: 0 },
    { cellIndex: 3, timesPredicted: 1, timesPlayed: 0, mineReports: 0, winCount: 0, lossCount: 0 },
  ]);
});

test("deriveRoundStatDelta does not double count the losing hit cell in timesPlayed", () => {
  const delta = deriveRoundStatDelta(
    {
      predictionCount: 3,
      predictedCells: [1, 2, 3],
      playedCells: [1, 2],
      result: "LOST",
      hitCell: 2,
      mineLocations: [2, 9, 10],
    },
    3,
  );
  const hitCell = delta.find((entry) => entry.cellIndex === 2);

  assert.deepEqual(hitCell, {
    cellIndex: 2,
    timesPredicted: 1,
    timesPlayed: 1,
    mineReports: 1,
    winCount: 0,
    lossCount: 1,
  });
});

test("deriveRoundStatDelta treats the hit cell as played even in legacy rows that omitted it", () => {
  const delta = deriveRoundStatDelta(
    {
      predictionCount: 3,
      predictedCells: [1, 2, 3],
      playedCells: [1],
      result: "LOST",
      hitCell: 2,
      mineLocations: [2, 9, 10],
    },
    3,
  );
  const hitCell = delta.find((entry) => entry.cellIndex === 2);

  assert.deepEqual(hitCell, {
    cellIndex: 2,
    timesPredicted: 1,
    timesPlayed: 1,
    mineReports: 1,
    winCount: 0,
    lossCount: 1,
  });
});

test("mineReports only use full-truth rounds, not partial mine lists", () => {
  const stats = deriveStatsFromHistoryRounds(
    [
      {
        predictionCount: 2,
        predictedCells: [1, 2],
        playedCells: [1],
        result: "WON",
        hitCell: null,
        mineLocations: [4, 5, 6],
      },
      {
        predictionCount: 2,
        predictedCells: [1, 3],
        playedCells: [1],
        result: "WON",
        hitCell: null,
        mineLocations: [4, 5],
      },
    ],
    3,
  );
  const mineCells = stats.filter((entry) => entry.mineReports > 0).map((entry) => entry.cellIndex);

  assert.deepEqual(mineCells, [4, 5, 6]);
});
