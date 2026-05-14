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
  spinKind: NativeSpinKind;
  spin: boolean;
  mini: boolean;
  immobile: boolean;
  occupiedCorners: number;
  clearedLines: number;
  clearName: NativeClearName;
  attack: number;
  baseAttack: number;
  points: number;
  combo: number;
  backToBack: boolean;
  backToBackBonus: number;
  allClear: boolean;
  allClearBonus: number;
}

export type NativeSpinKind = "NONE" | "T_SPIN" | "T_SPIN_MINI" | "IMMOBILE_SPIN";
export type NativeSpinMode =
  | "T-SPINS"
  | "T-SPINS+"
  | "ALL-SPINS+"
  | "ALL-SPINS"
  | "ALL-MINI+"
  | "ALL-MINI"
  | "MINI-ONLY"
  | "HANDHELD"
  | "STUPID"
  | "NONE";
export type NativeComboTable = "MULTIPLIER" | "NONE" | "CLASSIC GUIDELINE" | "MODERN GUIDELINE";
export type NativeKickTable = "SRS+" | "SRS" | "SRS-X" | "TETRA-X" | "NRS" | "ARS" | "ASC" | "NONE";
export type NativeClearName =
  | "NONE"
  | "SINGLE"
  | "DOUBLE"
  | "TRIPLE"
  | "QUAD"
  | "PENTA"
  | "TSPIN"
  | "TSPIN_MINI"
  | "TSPIN_MINI_SINGLE"
  | "TSPIN_SINGLE"
  | "TSPIN_MINI_DOUBLE"
  | "TSPIN_DOUBLE"
  | "TSPIN_MINI_TRIPLE"
  | "TSPIN_TRIPLE"
  | "TSPIN_MINI_QUAD"
  | "TSPIN_QUAD"
  | "TSPIN_PENTA";

export interface NativeSpinDetection {
  kind: NativeSpinKind;
  spin: boolean;
  mini: boolean;
  immobile: boolean;
  occupiedCorners: number;
  clearedLines: number;
}

export interface NativeFirepowerInput {
  clearName: NativeClearName;
  allClear?: boolean | undefined;
  comboTable?: NativeComboTable | undefined;
}

export interface NativeFirepowerEvent {
  clearName: NativeClearName;
  attack: number;
  baseAttack: number;
  points: number;
  combo: number;
  backToBack: boolean;
  backToBackBonus: number;
  allClear: boolean;
  allClearBonus: number;
}

export interface NativeFirepowerSummary {
  attack: number;
  points: number;
  combo: number;
  maxCombo: number;
  backToBackChain: number;
  allClears: number;
  firepowerScore: number;
  events: NativeFirepowerEvent[];
}

export interface NativeBeamSearchNode {
  score: number;
  firepowerScore: number;
  depth: number;
  queueIndex: number;
  hold?: string | null;
  rows: number[];
  path: string[];
  placements: NativeBeamPlacement[];
  attack: number;
  points: number;
  maxCombo: number;
  backToBackChain: number;
  allClears: number;
  difficultClears: number;
  tSpinClears: number;
  tSpinAttack: number;
  tSpinPotential: number;
  occupiedCells: number;
  clearedLines: number;
  aggregateHeight: number;
  holes: number;
  bumpiness: number;
}

export interface NativeOpenerQueueEvaluation {
  queue: string;
  buildable: boolean;
  paretoFront: boolean;
  dominatedBy: number;
  weightedScore: number;
  topScore: number;
  firepowerScore: number;
  attack: number;
  points: number;
  allClears: number;
  depth: number;
  holes: number;
  bumpiness: number;
}

export interface NativeOpenerBagEvaluation {
  bag: string;
  totalQueues: number;
  searchedQueues: number;
  exact: boolean;
  buildableQueues: number;
  buildRate: number;
  averageScore: number;
  averageAttack: number;
  averageFirepowerScore: number;
  averageHoles: number;
  averageBumpiness: number;
  worstScore: number;
  bestScore: number;
  paretoFront: NativeOpenerQueueEvaluation[];
  topQueues: NativeOpenerQueueEvaluation[];
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
  canReachOpenerPlacement(rows: Uint16Array, piece: string, rotation: number, x: number, y: number, kickTable?: NativeKickTable): boolean;
  detectOpenerSpin(
    rows: Uint16Array,
    piece: string,
    rotation: number,
    x: number,
    y: number,
    spinMode?: NativeSpinMode
  ): NativeSpinDetection;
  estimateOpenerTSpinPotential(rows: Uint16Array, kickTable?: NativeKickTable): number;
  evaluateOpenerFirepower(events: NativeFirepowerInput[]): NativeFirepowerSummary;
  searchOpenerBeam(
    queue: string,
    beamWidth: number,
    holdEnabled: boolean,
    maxDepth: number,
    comboTable?: NativeComboTable,
    kickTable?: NativeKickTable,
    spinMode?: NativeSpinMode
  ): NativeBeamSearchNode[];
  searchOpenerBeamWithPlacements(
    queue: string,
    beamWidth: number,
    holdEnabled: boolean,
    maxDepth: number,
    comboTable?: NativeComboTable,
    kickTable?: NativeKickTable,
    spinMode?: NativeSpinMode
  ): NativeBeamSearchNode[];
  evaluateOpenerBag(
    bag: string,
    beamWidth: number,
    holdEnabled: boolean,
    maxDepth: number,
    maxQueues: number,
    topQueueCount: number,
    comboTable?: NativeComboTable,
    kickTable?: NativeKickTable,
    spinMode?: NativeSpinMode
  ): NativeOpenerBagEvaluation;
}
