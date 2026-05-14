export interface NativeBinding {
  createEmptyBoard(): Uint16Array;
  copyBoardRows(rows: Uint16Array): Uint16Array;
  isPerfectClear(rows: Uint16Array): boolean;
  countOccupiedCells(rows: Uint16Array): number;
  clearFullLines(rows: Uint16Array): Uint16Array;
  batchCountOccupiedCells(rows: Uint16Array, boardCount: number): Uint32Array;
  batchClearFullLines(rows: Uint16Array, boardCount: number): Uint16Array;
  createGarbageRows(holes: Uint8Array): Uint16Array;
  applyGarbage(rows: Uint16Array, holes: Uint8Array): Uint16Array;
  rowsToFumenField(rows: Uint16Array): string;
  batchRowsToFumenFields(rows: Uint16Array, boardCount: number): string[];
}
