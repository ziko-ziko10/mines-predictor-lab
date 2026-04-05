import { isValidCell, normalizeCells } from "@/lib/board";
import type { RoundResult } from "@/lib/contracts";

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

export type CellStatDelta = Omit<RawCellStat, "cellIndex">;

const EMPTY_DELTA: CellStatDelta = {
  timesPredicted: 0,
  timesPlayed: 0,
  mineReports: 0,
  winCount: 0,
  lossCount: 0,
};

export function emptyRawCellStat(cellIndex: number): RawCellStat {
  return {
    cellIndex,
    ...EMPTY_DELTA,
  };
}

export function emptyCellStatDelta(): CellStatDelta {
  return { ...EMPTY_DELTA };
}

export function isTruthKnownRound(round: Pick<ModelHistoryRound, "mineLocations">, mineCount: number) {
  return normalizeCells(round.mineLocations).length === mineCount;
}

export function normalizeHistoryRound(round: ModelHistoryRound): ModelHistoryRound {
  const predictedCells = normalizeCells(round.predictedCells);
  const mineLocations = normalizeCells(round.mineLocations);
  const normalizedHitCell = round.hitCell && isValidCell(round.hitCell) ? round.hitCell : null;
  const playedCells = normalizeCells(
    round.result === "LOST" && normalizedHitCell ? [...round.playedCells, normalizedHitCell] : round.playedCells,
  );

  return {
    predictionCount: round.predictionCount,
    predictedCells,
    playedCells,
    result: round.result,
    hitCell: normalizedHitCell,
    mineLocations,
  };
}

export function deriveRoundStatDelta(round: ModelHistoryRound, mineCount: number) {
  const normalizedRound = normalizeHistoryRound(round);
  const deltas = new Map<number, RawCellStat>();

  function bump(cellIndex: number, update: Partial<CellStatDelta>) {
    const existing = deltas.get(cellIndex) ?? emptyRawCellStat(cellIndex);

    deltas.set(cellIndex, {
      cellIndex,
      timesPredicted: existing.timesPredicted + (update.timesPredicted ?? 0),
      timesPlayed: existing.timesPlayed + (update.timesPlayed ?? 0),
      mineReports: existing.mineReports + (update.mineReports ?? 0),
      winCount: existing.winCount + (update.winCount ?? 0),
      lossCount: existing.lossCount + (update.lossCount ?? 0),
    });
  }

  for (const cell of normalizedRound.predictedCells) {
    bump(cell, { timesPredicted: 1 });
  }

  for (const cell of normalizedRound.playedCells) {
    bump(cell, {
      timesPlayed: 1,
      winCount: normalizedRound.result === "WON" ? 1 : 0,
    });
  }

  if (normalizedRound.result === "LOST" && normalizedRound.hitCell) {
    bump(normalizedRound.hitCell, { lossCount: 1 });
  }

  if (isTruthKnownRound(normalizedRound, mineCount)) {
    for (const cell of normalizedRound.mineLocations) {
      bump(cell, { mineReports: 1 });
    }
  }

  return Array.from(deltas.values()).sort((left, right) => left.cellIndex - right.cellIndex);
}

export function deriveStatsFromHistoryRounds(rounds: ModelHistoryRound[], mineCount: number): RawCellStat[] {
  const stats = new Map<number, RawCellStat>();

  for (const round of rounds) {
    for (const delta of deriveRoundStatDelta(round, mineCount)) {
      const existing = stats.get(delta.cellIndex) ?? emptyRawCellStat(delta.cellIndex);

      stats.set(delta.cellIndex, {
        cellIndex: delta.cellIndex,
        timesPredicted: existing.timesPredicted + delta.timesPredicted,
        timesPlayed: existing.timesPlayed + delta.timesPlayed,
        mineReports: existing.mineReports + delta.mineReports,
        winCount: existing.winCount + delta.winCount,
        lossCount: existing.lossCount + delta.lossCount,
      });
    }
  }

  return Array.from(stats.values()).sort((left, right) => left.cellIndex - right.cellIndex);
}
