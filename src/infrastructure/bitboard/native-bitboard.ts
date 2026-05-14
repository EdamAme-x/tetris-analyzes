import { BOARD_HEIGHT, BOARD_WIDTH, ROW_MASK } from "../../domain/board";
import { loadNativeBinding } from "../native/load-native-binding";

export const BOARD_EVALUATION_STRIDE = 5;
export const BOARD_EVALUATION_OFFSET = {
  occupiedCells: 0,
  clearedLines: 1,
  aggregateHeight: 2,
  holes: 3,
  bumpiness: 4
} as const;

export function createEmptyBitBoard(): Uint16Array {
  return loadNativeBinding().createEmptyBoard();
}

export function bitBoardFromRows(rows: ArrayLike<number>): Uint16Array {
  if (rows.length !== BOARD_HEIGHT) {
    throw new Error(`Expected ${BOARD_HEIGHT} rows, got ${rows.length}.`);
  }

  const normalized = new Uint16Array(BOARD_HEIGHT);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined || !Number.isInteger(row) || row < 0) {
      throw new Error(`Row ${index} must be a non-negative integer.`);
    }
    if (row > ROW_MASK) {
      throw new Error(`Row ${index} must fit in ${BOARD_WIDTH} bits, got ${row}.`);
    }
    normalized[index] = row;
  }

  return loadNativeBinding().copyBoardRows(normalized);
}

export function isPerfectClear(rows: Uint16Array): boolean {
  return loadNativeBinding().isPerfectClear(rows);
}

export function countOccupiedCells(rows: Uint16Array): number {
  return loadNativeBinding().countOccupiedCells(rows);
}

export function clearFullLines(rows: Uint16Array): Uint16Array {
  return loadNativeBinding().clearFullLines(rows);
}

export function batchCountOccupiedCells(rows: Uint16Array, boardCount: number): Uint32Array {
  assertBoardBatchShape(rows, boardCount);
  return loadNativeBinding().batchCountOccupiedCells(rows, boardCount);
}

export function batchClearFullLines(rows: Uint16Array, boardCount: number): Uint16Array {
  assertBoardBatchShape(rows, boardCount);
  return loadNativeBinding().batchClearFullLines(rows, boardCount);
}

export function batchEvaluateBoards(rows: Uint16Array, boardCount: number): Uint32Array {
  assertBoardBatchShape(rows, boardCount);
  return loadNativeBinding().batchEvaluateBoards(rows, boardCount);
}

export function createGarbageRows(holes: ArrayLike<number>): Uint16Array {
  return loadNativeBinding().createGarbageRows(toUint8Array(holes));
}

export function applyGarbage(rows: Uint16Array, holes: ArrayLike<number>): Uint16Array {
  return loadNativeBinding().applyGarbage(rows, toUint8Array(holes));
}

function toUint8Array(values: ArrayLike<number>): Uint8Array {
  const normalized = new Uint8Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined || !Number.isInteger(value) || value < 0) {
      throw new Error(`Value ${index} must be a non-negative integer.`);
    }
    if (value >= BOARD_WIDTH) {
      throw new Error(`Value ${index} must be less than ${BOARD_WIDTH}, got ${value}.`);
    }
    normalized[index] = value;
  }
  return normalized;
}

function assertBoardBatchShape(rows: Uint16Array, boardCount: number): void {
  if (!Number.isSafeInteger(boardCount) || boardCount < 0) {
    throw new Error(`boardCount must be a non-negative safe integer, got ${boardCount}.`);
  }
  const expectedLength = boardCount * BOARD_HEIGHT;
  if (rows.length !== expectedLength) {
    throw new Error(`Expected ${expectedLength} row values, got ${rows.length}.`);
  }
}
