export const BOARD_SIZE = 5;
export const BOARD_CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

export const MINE_COUNT_OPTIONS = Array.from(
  { length: BOARD_CELL_COUNT - 1 },
  (_, index) => index + 1,
);

export function getAllCells() {
  return Array.from({ length: BOARD_CELL_COUNT }, (_, index) => index + 1);
}

export function isValidCell(cellIndex: number) {
  return Number.isInteger(cellIndex) && cellIndex >= 1 && cellIndex <= BOARD_CELL_COUNT;
}

export function normalizeCells(cells: number[]) {
  return Array.from(new Set(cells.filter(isValidCell))).sort((left, right) => left - right);
}

export function serializeCells(cells: number[]) {
  return JSON.stringify(normalizeCells(cells));
}

export function parseCells(serialized: string | null | undefined) {
  if (!serialized) {
    return [];
  }

  try {
    const parsed = JSON.parse(serialized);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeCells(parsed.map((value) => Number(value)));
  } catch {
    return [];
  }
}

export function toRowCol(cellIndex: number) {
  const zeroBased = cellIndex - 1;

  return {
    row: Math.floor(zeroBased / BOARD_SIZE) + 1,
    col: (zeroBased % BOARD_SIZE) + 1,
  };
}

export function cellLabel(cellIndex: number) {
  const { row, col } = toRowCol(cellIndex);

  return `R${row}C${col}`;
}

export function clampPredictionCount(mineCount: number, predictionCount: number) {
  return Math.min(Math.max(predictionCount, 1), BOARD_CELL_COUNT - mineCount);
}

export function isSubset(candidate: number[], source: number[]) {
  const sourceSet = new Set(source);
  return candidate.every((cell) => sourceSet.has(cell));
}
