export interface NativePlacementCell {
  x: number;
  y: number;
}

export interface NativeBeamPlacement {
  piece: string;
  rotation: number;
  x: number;
  y: number;
  usedHold: boolean;
  cells: NativePlacementCell[];
  path: string;
}

export interface NativeBeamSearchNode {
  score: number;
  depth: number;
  queueIndex: number;
  hold?: string | null;
  rows: number[];
  path: string[];
  placements: NativeBeamPlacement[];
  occupiedCells: number;
  clearedLines: number;
  aggregateHeight: number;
  holes: number;
  bumpiness: number;
}

export interface NativeBinding {
  createEmptyBoard(): Uint16Array;
  copyBoardRows(rows: Uint16Array): Uint16Array;
  isPerfectClear(rows: Uint16Array): boolean;
  countOccupiedCells(rows: Uint16Array): number;
  clearFullLines(rows: Uint16Array): Uint16Array;
  batchCountOccupiedCells(rows: Uint16Array, boardCount: number): Uint32Array;
  batchClearFullLines(rows: Uint16Array, boardCount: number): Uint16Array;
  batchEvaluateBoards(rows: Uint16Array, boardCount: number): Uint32Array;
  createGarbageRows(holes: Uint8Array): Uint16Array;
  applyGarbage(rows: Uint16Array, holes: Uint8Array): Uint16Array;
  rowsToFumenField(rows: Uint16Array): string;
  batchRowsToFumenFields(rows: Uint16Array, boardCount: number): string[];
  searchOpenerBeam(queue: string, beamWidth: number, holdEnabled: boolean, maxDepth: number): NativeBeamSearchNode[];
}
