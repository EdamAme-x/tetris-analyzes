import { describe, expect, test } from "bun:test";
import { createBoardBatch, ROW_MASK } from "../src/domain/board";
import {
  applyGarbage,
  batchClearFullLines,
  batchCountOccupiedCells,
  bitBoardFromRows,
  clearFullLines,
  countOccupiedCells,
  createEmptyBitBoard,
  createGarbageRows,
  isPerfectClear
} from "../src/infrastructure/bitboard/native-bitboard";

describe("native bitboard helpers", () => {
  test("creates, copies, counts, clears lines, and checks perfect clears", () => {
    const empty = createEmptyBitBoard();
    expect([...empty]).toEqual(new Array(20).fill(0));
    expect(isPerfectClear(empty)).toBe(true);

    const rows = new Array(20).fill(0);
    rows[0] = ROW_MASK;
    rows[1] = 0b1;
    const board = bitBoardFromRows(rows);

    expect(countOccupiedCells(board)).toBe(11);
    expect(isPerfectClear(board)).toBe(false);
    expect([...clearFullLines(board).slice(0, 4)]).toEqual([1, 0, 0, 0]);
  });

  test("batches count and line clear across flattened board rows", () => {
    const firstRows = new Array(20).fill(0);
    firstRows[0] = ROW_MASK;
    firstRows[1] = 0b101;
    const secondRows = new Array(20).fill(0);
    secondRows[0] = 0b111;
    secondRows[1] = ROW_MASK;
    secondRows[2] = 0b1000000000;
    const batch = createBoardBatch([bitBoardFromRows(firstRows), bitBoardFromRows(secondRows)]);

    expect([...batchCountOccupiedCells(batch.rows, batch.boardCount)]).toEqual([12, 14]);
    expect([...batchClearFullLines(batch.rows, batch.boardCount)]).toEqual([
      0b101,
      ...new Array(19).fill(0),
      0b111,
      0b1000000000,
      ...new Array(18).fill(0)
    ]);
  });

  test("creates and applies garbage rows by hole columns", () => {
    expect([...createGarbageRows([0, 9])]).toEqual([ROW_MASK ^ 1, ROW_MASK ^ (1 << 9)]);

    const rows = new Array(20).fill(0);
    rows[0] = 0b11;
    const board = bitBoardFromRows(rows);
    const pushed = applyGarbage(board, [0, 9]);

    expect([...pushed.slice(0, 4)]).toEqual([ROW_MASK ^ 1, ROW_MASK ^ (1 << 9), 0b11, 0]);
  });

  test("rejects rows and garbage holes outside the 10-column board", () => {
    const rows = new Array(20).fill(0);
    rows[0] = ROW_MASK + 1;
    expect(() => bitBoardFromRows(rows)).toThrow("10 bits");
    rows[0] = 65536;
    expect(() => bitBoardFromRows(rows)).toThrow("10 bits");
    rows[0] = 2 ** 40;
    expect(() => bitBoardFromRows(rows)).toThrow("10 bits");
    expect(() => createGarbageRows([10])).toThrow("less than 10");
  });
});
