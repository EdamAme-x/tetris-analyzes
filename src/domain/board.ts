export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 20;
export const ROW_MASK = (1 << BOARD_WIDTH) - 1;

export interface BoardBatch {
  readonly rows: Uint16Array;
  readonly boardCount: number;
}

export function createBoardBatch(boards: readonly Uint16Array[]): BoardBatch {
  const rows = new Uint16Array(boards.length * BOARD_HEIGHT);
  boards.forEach((board, boardIndex) => {
    assertSingleBoardRows(board);
    rows.set(board, boardIndex * BOARD_HEIGHT);
  });
  return { rows, boardCount: boards.length };
}

export function assertBoardBatchRows(rows: Uint16Array, boardCount: number): void {
  if (!Number.isInteger(boardCount) || boardCount < 0) {
    throw new Error(`boardCount must be a non-negative integer, got ${boardCount}.`);
  }
  const expectedLength = boardCount * BOARD_HEIGHT;
  if (rows.length !== expectedLength) {
    throw new Error(`Expected ${expectedLength} row values, got ${rows.length}.`);
  }
  for (let index = 0; index < rows.length; index += 1) {
    assertRowMask(rows[index] ?? 0, index);
  }
}

function assertSingleBoardRows(rows: Uint16Array): void {
  if (rows.length !== BOARD_HEIGHT) {
    throw new Error(`Expected ${BOARD_HEIGHT} rows, got ${rows.length}.`);
  }
  for (let index = 0; index < rows.length; index += 1) {
    assertRowMask(rows[index] ?? 0, index);
  }
}

function assertRowMask(row: number, index: number): void {
  if (!Number.isInteger(row) || row < 0 || (row & ~ROW_MASK) !== 0) {
    throw new Error(`Row ${index} must fit in ${BOARD_WIDTH} bits, got ${row}.`);
  }
}
