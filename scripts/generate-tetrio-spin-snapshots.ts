import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { format, resolveConfig } from "prettier";
import { TETRIO_TABLE_SOURCE } from "../src/generated/tetrio-tables.generated";
import type { NativeKickTable, NativeSpinKind, NativeSpinMode } from "../src/infrastructure/native/binding-types";

const DEFAULT_OUTPUT = "tests/fixtures/tetrio-spin.generated.ts";
const DEFAULT_CASE_COUNT = 2048;
const BOARD_WIDTH = 10;
const VISIBLE_HEIGHT = 20;
const BOARD_BUFFER = 20;
const TOTAL_HEIGHT = VISIBLE_HEIGHT + BOARD_BUFFER;
const PIECES = ["i", "o", "t", "s", "z", "j", "l"] as const;
const DIRECTIONS = [-1, 1, 2] as const;
const SPIN_MODES = [
  "T-SPINS",
  "T-SPINS+",
  "ALL-SPINS+",
  "ALL-SPINS",
  "ALL-MINI+",
  "ALL-MINI",
  "MINI-ONLY",
  "HANDHELD",
  "STUPID",
  "NONE"
] as const satisfies readonly NativeSpinMode[];
const ZERO_OFFSETS: Offsets = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0]
];

type Piece = (typeof PIECES)[number];
type Direction = (typeof DIRECTIONS)[number];
type Offset = readonly [number, number];
type Offsets = readonly [Offset, Offset, Offset, Offset];
type TetrioSpinResult = false | "mini" | "normal";

interface GenerateOptions {
  readonly input?: string;
  readonly asset?: string;
  readonly output: string;
  readonly caseCount: number;
  readonly check: boolean;
}

interface TetrioPiece {
  readonly matrix: {
    readonly dx: number;
    readonly dy: number;
    readonly data: readonly (readonly (readonly [number, number, number?])[])[];
  };
  readonly kickset_special?: string;
  readonly disallow_kick?: boolean;
  readonly spinbonus_override?: {
    readonly rule?: string;
    readonly mini?: boolean;
  };
}

interface TetrioKickset {
  readonly kicks: Record<string, readonly Offset[]>;
  readonly i_kicks?: Record<string, readonly Offset[]>;
  readonly allow_o_kick?: boolean;
  readonly additional_offsets?: Partial<Record<Piece, Offsets>>;
  readonly spawn_rotation?: Partial<Record<Piece, number>>;
}

interface SpinBonusRule {
  readonly types?: readonly string[];
  readonly types_mini?: readonly string[];
}

type Corner = readonly [number, number, number?, number?];
type CornerTable = Partial<Record<Piece, readonly (readonly Corner[])[]>>;

interface NativeState {
  readonly rotation: number;
  readonly x: number;
  readonly y: number;
}

interface NativeSpinDetectionSnapshot {
  readonly kind: NativeSpinKind;
  readonly spin: boolean;
  readonly mini: boolean;
  readonly immobile: boolean;
  readonly occupiedCorners: number;
  readonly clearedLines: number;
}

interface SnapshotCase {
  readonly name: string;
  readonly kickTable: NativeKickTable;
  readonly spinMode: NativeSpinMode;
  readonly piece: Uppercase<Piece>;
  readonly rows: readonly number[];
  readonly from: NativeState;
  readonly direction: Direction;
  readonly expected:
    | { readonly success: false; readonly spin: NativeSpinDetectionSnapshot }
    | {
        readonly success: true;
        readonly rotation: number;
        readonly x: number;
        readonly y: number;
        readonly kickIndex: number | null;
        readonly spin: NativeSpinDetectionSnapshot;
      };
}

interface Snapshot {
  readonly source: {
    readonly asset: string;
    readonly boardWidth: number;
    readonly visibleHeight: number;
    readonly boardBuffer: number;
    readonly generator: string;
  };
  readonly cases: readonly SnapshotCase[];
}

const options = parseArgs(process.argv.slice(2));
const bundle = await loadBundle(options);
const tetrominoes = evaluateObject(extractObjectLiteralAfterKey(bundle, "tetrominoes")) as Record<string, TetrioPiece>;
const kicksets = evaluateObject(extractObjectLiteralAfterKey(bundle, "kicksets")) as Record<string, TetrioKickset>;
const cornerTable = evaluateObject(extractObjectLiteralAfterKey(bundle, "cornerTable")) as CornerTable;
const spinbonusRules = evaluateObject(extractObjectLiteralAfterKey(bundle, "spinbonuses_rules")) as Record<string, SpinBonusRule>;
const outputPath = resolve(options.output);
const snapshot = createSnapshot(options.asset ?? TETRIO_TABLE_SOURCE.asset);
const content = await formatSnapshot(snapshot, outputPath);

if (options.check) {
  const current = await Bun.file(outputPath).text();
  if (current !== content) {
    throw new Error(`${options.output} is out of date. Run bun run generate:tetrio-spin-snapshots.`);
  }
  console.log(`${options.output} is up to date.`);
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, content);
  console.log(`Generated ${options.output} with ${snapshot.cases.length} TETR.IO spin-state cases.`);
}

function parseArgs(args: readonly string[]): GenerateOptions {
  const parsed: { input?: string; asset?: string; output: string; caseCount: number; check: boolean } = {
    output: DEFAULT_OUTPUT,
    caseCount: DEFAULT_CASE_COUNT,
    check: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--input":
        parsed.input = readValue(args, ++index, arg);
        break;
      case "--asset":
        parsed.asset = readValue(args, ++index, arg);
        break;
      case "--output":
        parsed.output = readValue(args, ++index, arg);
        break;
      case "--cases":
        parsed.caseCount = readPositiveInteger(readValue(args, ++index, arg), arg);
        break;
      case "--check":
        parsed.check = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function readValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function readPositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

async function loadBundle(generateOptions: GenerateOptions): Promise<string> {
  if (generateOptions.input !== undefined) {
    return await Bun.file(generateOptions.input).text();
  }

  const response = await fetch(generateOptions.asset ?? TETRIO_TABLE_SOURCE.asset);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${response.url}: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

function createSnapshot(asset: string): Snapshot {
  const cases: SnapshotCase[] = [];
  for (const [kickTable] of Object.entries(kicksets)) {
    for (const piece of PIECES) {
      for (let rotation = 0; rotation < 4; rotation += 1) {
        for (const direction of DIRECTIONS) {
          const from = centralState(piece, rotation);
          const rows = emptyRows();
          const spinMode = SPIN_MODES[cases.length % SPIN_MODES.length]!;
          cases.push(
            createCase(
              `empty-${kickTable}-${piece}-${rotation}-${direction}-${spinMode}`,
              kickTable,
              spinMode,
              piece,
              rows,
              from,
              direction
            )
          );
        }
      }
    }
  }

  const rng = createXorshift32(0x5917_2026);
  const coverage = emptyCoverage();
  for (const fixture of cases) {
    addCoverage(coverage, fixture);
  }

  let attempts = 0;
  while (!hasCoverage(coverage) || cases.length < options.caseCount) {
    attempts += 1;
    if (attempts > options.caseCount * 1_500) {
      throw new Error(`Could not generate enough TETR.IO spin-state coverage after ${attempts} attempts: ${JSON.stringify(coverage)}.`);
    }

    const kickTable = pick(Object.keys(kicksets), rng);
    const spinMode = pick(SPIN_MODES, rng);
    const piece = pick(PIECES, rng);
    const rotation = Math.floor(rng() * 4);
    const direction = pick(DIRECTIONS, rng);
    const from = randomState(piece, rotation, rng);
    const rows = randomRows(rng);
    clearNativeCells(rows, piece, from);
    if (!isLegalAtNativeState(rows, piece, from)) {
      continue;
    }

    const fixture = createCase(`random-${cases.length.toString().padStart(4, "0")}`, kickTable, spinMode, piece, rows, from, direction);
    cases.push(fixture);
    addCoverage(coverage, fixture);
  }

  return {
    source: {
      asset,
      boardWidth: BOARD_WIDTH,
      visibleHeight: VISIBLE_HEIGHT,
      boardBuffer: BOARD_BUFFER,
      generator: "scripts/generate-tetrio-spin-snapshots.ts"
    },
    cases: cases.slice(0, Math.max(options.caseCount, cases.length))
  };
}

function createCase(
  name: string,
  kickTable: string,
  spinMode: NativeSpinMode,
  piece: Piece,
  rows: readonly number[],
  from: NativeState,
  direction: Direction
): SnapshotCase {
  return {
    name,
    kickTable: toNativeKickTable(kickTable),
    spinMode,
    piece: piece.toUpperCase() as Uppercase<Piece>,
    rows: [...rows],
    from,
    direction,
    expected: resolveTetrioSpinAfterRotation(rows, kickTable, spinMode, piece, from, direction)
  };
}

function resolveTetrioSpinAfterRotation(
  rows: readonly number[],
  kickTableKey: string,
  spinMode: NativeSpinMode,
  piece: Piece,
  from: NativeState,
  direction: Direction
): SnapshotCase["expected"] {
  const resolution = resolveTetrioRotation(rows, kickTableKey, piece, from, direction);
  if (!resolution.success) {
    return { success: false, spin: noneSpin(0) };
  }

  const lockedRows = lockNativePlacement(rows, piece, resolution);
  const clearedLines = countFullLines(lockedRows);
  const spin = detectTetrioSpin(rows, lockedRows, spinMode, piece, resolution, resolution.kickIndex);
  return {
    success: true,
    rotation: resolution.rotation,
    x: resolution.x,
    y: resolution.y,
    kickIndex: resolution.kickIndex,
    spin: { ...spin, clearedLines }
  };
}

function resolveTetrioRotation(
  rows: readonly number[],
  kickTableKey: string,
  piece: Piece,
  from: NativeState,
  direction: Direction
):
  | { readonly success: false }
  | { readonly success: true; readonly rotation: number; readonly x: number; readonly y: number; readonly kickIndex: number | null } {
  const kickset = readKickset(kickTableKey);
  const tetrioFrom = nativeToTetrioState(piece, from);
  const toRotation = mod4(from.rotation + direction);
  const offsets = kickset.additional_offsets?.[piece] ?? ZERO_OFFSETS;
  const fromOffset = offsets[from.rotation] ?? [0, 0];
  const toOffset = offsets[toRotation] ?? [0, 0];
  const offsetDeltaX = toOffset[0] - fromOffset[0];
  const offsetDeltaY = toOffset[1] - fromOffset[1];

  const direct = {
    x: tetrioFrom.x + offsetDeltaX,
    y: tetrioFrom.y + offsetDeltaY,
    rotation: toRotation
  };
  if (isLegalAtTetrioPos(rows, piece, direct.x, direct.y, direct.rotation)) {
    return { success: true, ...tetrioToNativeState(piece, direct.rotation, direct.x, direct.y), kickIndex: null };
  }

  const kickRecord = getPieceKickRecord(kickset, piece);
  if (kickRecord === undefined) {
    return { success: false };
  }

  const kicks = kickRecord[`${from.rotation}${toRotation}`] ?? [];
  for (const [kickIndex, [kickX, kickY]] of kicks.entries()) {
    const kicked = {
      x: tetrioFrom.x + kickX + offsetDeltaX,
      y: Math.floor(tetrioFrom.y) + 0.1 + kickY + offsetDeltaY,
      rotation: toRotation
    };
    if (isLegalAtTetrioPos(rows, piece, kicked.x, kicked.y, kicked.rotation)) {
      return { success: true, ...tetrioToNativeState(piece, kicked.rotation, kicked.x, kicked.y), kickIndex };
    }
  }

  return { success: false };
}

function detectTetrioSpin(
  rowsBeforeLock: readonly number[],
  lockedRows: readonly number[],
  spinMode: NativeSpinMode,
  piece: Piece,
  state: NativeState,
  kickIndex: number | null
): NativeSpinDetectionSnapshot {
  const immobile = isPlacementImmobile(rowsBeforeLock, piece, state);
  const mode = toTetrioSpinMode(spinMode);
  if (mode === "none" || !isGrounded(rowsBeforeLock, piece, state)) {
    return { ...noneSpin(0), immobile };
  }

  const rule = spinRuleForPiece(piece, mode);
  const occupiedCorners = countTetrioOccupiedCorners(rowsBeforeLock, piece, state);
  const result = evaluateTetrioSpinRule(rowsBeforeLock, lockedRows, rule, mode, piece, state, kickIndex);
  if (result === false) {
    return { ...noneSpin(0), immobile, occupiedCorners };
  }
  return {
    kind: result === "mini" ? "T_SPIN_MINI" : "T_SPIN",
    spin: true,
    mini: result === "mini",
    immobile,
    occupiedCorners,
    clearedLines: 0
  };
}

function evaluateTetrioSpinRule(
  rowsBeforeLock: readonly number[],
  lockedRows: readonly number[],
  rule: string,
  setSpinMode: string,
  piece: Piece,
  state: NativeState,
  kickIndex: number | null
): TetrioSpinResult {
  switch (rule) {
    case "stupid":
      return isGrounded(rowsBeforeLock, piece, state) ? "normal" : false;
    case "all":
    case "all+":
    case "all-mini":
    case "all-mini+":
    case "mini-only": {
      if (pieceHasMiniSpin(piece, setSpinMode)) {
        const cornerSpin = detectTetrioCornerSpin(rowsBeforeLock, setSpinMode, piece, state, kickIndex);
        if (cornerSpin && rule === "mini-only") {
          return "mini";
        }
        if (cornerSpin || rule === "all-mini" || rule === "all") {
          return cornerSpin;
        }
      }
      const mini = rule === "mini-only" || rule === "all-mini" || rule === "all-mini+" || (rule === "all+" && piece === "t");
      return isPlacementImmobileFromLocked(lockedRows, piece, state) ? (mini ? "mini" : "normal") : false;
    }
    case "handheld":
    case "T-spins":
      return detectTetrioCornerSpin(rowsBeforeLock, setSpinMode, piece, state, kickIndex);
    case "T-spins+":
      return (
        detectTetrioCornerSpin(rowsBeforeLock, setSpinMode, piece, state, kickIndex) ||
        (isPlacementImmobileFromLocked(lockedRows, piece, state) && "mini")
      );
    default:
      return false;
  }
}

function detectTetrioCornerSpin(
  rowsBeforeLock: readonly number[],
  setSpinMode: string,
  piece: Piece,
  state: NativeState,
  kickIndex: number | null
): TetrioSpinResult {
  if (!isGrounded(rowsBeforeLock, piece, state)) {
    return false;
  }
  const corners = readCornerTable(piece, state.rotation);
  if (corners.length === 0) {
    return false;
  }

  let occupied = 0;
  let front = 0;
  for (const corner of corners) {
    const cell = nativeCornerCell(piece, state, corner);
    if (isOccupiedOrWallNative(rowsBeforeLock, cell.x, cell.y)) {
      occupied += 1;
      if (state.rotation === corner[2] || state.rotation === corner[3]) {
        front += 1;
      }
    }
  }
  if (occupied < 3) {
    return false;
  }

  let result: TetrioSpinResult = "normal";
  if (pieceHasMiniSpin(piece, setSpinMode) && front !== 2) {
    result = "mini";
  }
  if (kickIndex === 3) {
    result = "normal";
  }
  return result;
}

function spinRuleForPiece(piece: Piece, spinMode: string): string {
  const override = readPiece(piece).spinbonus_override?.rule;
  if (override !== undefined) {
    return override;
  }
  return spinbonusRules[spinMode]?.types?.includes(piece) === true ? spinMode : "none";
}

function pieceHasMiniSpin(piece: Piece, spinMode: string): boolean {
  const override = readPiece(piece).spinbonus_override?.mini;
  if (override !== undefined) {
    return override;
  }
  return spinbonusRules[spinMode]?.types_mini?.includes(piece) === true;
}

function toTetrioSpinMode(spinMode: NativeSpinMode): string {
  switch (spinMode) {
    case "T-SPINS":
      return "T-spins";
    case "T-SPINS+":
      return "T-spins+";
    case "ALL-SPINS+":
      return "all+";
    case "ALL-SPINS":
      return "all";
    case "ALL-MINI+":
      return "all-mini+";
    case "ALL-MINI":
      return "all-mini";
    case "MINI-ONLY":
      return "mini-only";
    case "HANDHELD":
      return "handheld";
    case "STUPID":
      return "stupid";
    case "NONE":
      return "none";
  }
}

function toNativeKickTable(kickTable: string): NativeKickTable {
  return (kickTable === "none" ? "NONE" : kickTable) as NativeKickTable;
}

function getPieceKickRecord(kickset: TetrioKickset, piece: Piece): Record<string, readonly Offset[]> | undefined {
  const tetromino = readPiece(piece);
  if (tetromino.disallow_kick === true && kickset.allow_o_kick !== true) {
    return undefined;
  }
  if (tetromino.kickset_special !== undefined) {
    const special = kickset[`${tetromino.kickset_special}_kicks` as keyof TetrioKickset];
    if (isKickRecord(special)) {
      return special;
    }
  }
  return kickset.kicks;
}

function isKickRecord(value: unknown): value is Record<string, readonly Offset[]> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function centralState(piece: Piece, rotation: number): NativeState {
  const bounds = nativeBounds(piece, rotation);
  return {
    rotation,
    x: Math.max(0, Math.min(BOARD_WIDTH - bounds.width, 4 - Math.floor(bounds.width / 2))),
    y: 3
  };
}

function randomState(piece: Piece, rotation: number, rng: () => number): NativeState {
  const bounds = nativeBounds(piece, rotation);
  return {
    rotation,
    x: Math.floor(rng() * (BOARD_WIDTH - bounds.width + 1)),
    y: Math.floor(rng() * Math.min(10, VISIBLE_HEIGHT - bounds.height + 1))
  };
}

function nativeBounds(piece: Piece, rotation: number): { readonly width: number; readonly height: number } {
  const cells = tetrioCells(piece, rotation);
  const nativeYs = cells.map(([, y]) => -y);
  return {
    width: Math.max(...cells.map(([x]) => x)) - Math.min(...cells.map(([x]) => x)) + 1,
    height: Math.max(...nativeYs) - Math.min(...nativeYs) + 1
  };
}

function nativeToTetrioState(piece: Piece, state: NativeState): { readonly x: number; readonly y: number } {
  const tetromino = readPiece(piece);
  const cells = tetromino.matrix.data[state.rotation] ?? [];
  const minRelativeX = Math.min(...cells.map(([cellX]) => cellX - tetromino.matrix.dx));
  const maxRelativeY = Math.max(...cells.map(([, cellY]) => cellY - tetromino.matrix.dy));
  const ceilY = TOTAL_HEIGHT - 1 - state.y - maxRelativeY;
  return {
    x: state.x - minRelativeX,
    y: ceilY - 0.999999
  };
}

function tetrioToNativeState(piece: Piece, rotation: number, x: number, y: number): NativeState {
  const cells = tetrioBoardCells(piece, rotation, x, y);
  return {
    rotation,
    x: Math.min(...cells.map((cell) => cell.x)),
    y: Math.min(...cells.map((cell) => TOTAL_HEIGHT - 1 - cell.y))
  };
}

function isLegalAtNativeState(rows: readonly number[], piece: Piece, state: NativeState): boolean {
  const tetrio = nativeToTetrioState(piece, state);
  return isLegalAtTetrioPos(rows, piece, tetrio.x, tetrio.y, state.rotation);
}

function isLegalAtTetrioPos(rows: readonly number[], piece: Piece, x: number, y: number, rotation: number): boolean {
  for (const cell of tetrioBoardCells(piece, rotation, x, y)) {
    if (isOccupiedOrWallTetrio(rows, cell.x, cell.y)) {
      return false;
    }
  }
  return true;
}

function tetrioBoardCells(piece: Piece, rotation: number, x: number, y: number): Array<{ readonly x: number; readonly y: number }> {
  const tetromino = readPiece(piece);
  const ceilY = Math.ceil(y);
  return (tetromino.matrix.data[rotation] ?? []).map(([cellX, cellY]) => ({
    x: x + (cellX - tetromino.matrix.dx),
    y: ceilY + (cellY - tetromino.matrix.dy)
  }));
}

function tetrioCells(piece: Piece, rotation: number): readonly (readonly [number, number])[] {
  const tetromino = readPiece(piece);
  return (tetromino.matrix.data[rotation] ?? []).map(([cellX, cellY]) => [cellX - tetromino.matrix.dx, cellY - tetromino.matrix.dy]);
}

function isOccupiedOrWallTetrio(rows: readonly number[], x: number, y: number): boolean {
  if (!Number.isInteger(x) || x < 0 || x >= BOARD_WIDTH || y < 0 || y >= TOTAL_HEIGHT) {
    return true;
  }
  if (y < BOARD_BUFFER) {
    return false;
  }
  const nativeY = TOTAL_HEIGHT - 1 - y;
  return ((rows[nativeY] ?? 0) & (1 << x)) !== 0;
}

function isOccupiedOrWallNative(rows: readonly number[], x: number, y: number): boolean {
  if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= VISIBLE_HEIGHT) {
    return true;
  }
  return ((rows[y] ?? 0) & (1 << x)) !== 0;
}

function lockNativePlacement(rows: readonly number[], piece: Piece, state: NativeState): number[] {
  const output = [...rows];
  for (const cell of nativeCells(piece, state)) {
    output[cell.y] = (output[cell.y] ?? 0) | (1 << cell.x);
  }
  return output;
}

function nativeCells(piece: Piece, state: NativeState): Array<{ readonly x: number; readonly y: number }> {
  const tetrio = nativeToTetrioState(piece, state);
  return tetrioBoardCells(piece, state.rotation, tetrio.x, tetrio.y).map((cell) => ({
    x: cell.x,
    y: TOTAL_HEIGHT - 1 - cell.y
  }));
}

function countFullLines(rows: readonly number[]): number {
  return rows.filter((row) => row === 0b1111111111).length;
}

function canPlaceNative(rows: readonly number[], piece: Piece, state: NativeState): boolean {
  for (const cell of nativeCells(piece, state)) {
    if (isOccupiedOrWallNative(rows, cell.x, cell.y)) {
      return false;
    }
  }
  return true;
}

function isGrounded(rowsBeforeLock: readonly number[], piece: Piece, state: NativeState): boolean {
  return !canPlaceNative(rowsBeforeLock, piece, { ...state, y: state.y - 1 });
}

function isPlacementImmobile(rowsBeforeLock: readonly number[], piece: Piece, state: NativeState): boolean {
  const lockedRows = lockNativePlacement(rowsBeforeLock, piece, state);
  return isPlacementImmobileFromLocked(lockedRows, piece, state);
}

function isPlacementImmobileFromLocked(lockedRows: readonly number[], piece: Piece, state: NativeState): boolean {
  const rowsWithoutPiece = removeNativeCells(lockedRows, piece, state);
  return (
    !canPlaceNative(rowsWithoutPiece, piece, { ...state, x: state.x - 1 }) &&
    !canPlaceNative(rowsWithoutPiece, piece, { ...state, x: state.x + 1 }) &&
    !canPlaceNative(rowsWithoutPiece, piece, { ...state, y: state.y - 1 }) &&
    !canPlaceNative(rowsWithoutPiece, piece, { ...state, y: state.y + 1 })
  );
}

function removeNativeCells(rows: readonly number[], piece: Piece, state: NativeState): number[] {
  const output = [...rows];
  for (const cell of nativeCells(piece, state)) {
    if (cell.y >= 0 && cell.y < VISIBLE_HEIGHT && cell.x >= 0 && cell.x < BOARD_WIDTH) {
      output[cell.y] = (output[cell.y] ?? 0) & ~(1 << cell.x);
    }
  }
  return output;
}

function countTetrioOccupiedCorners(rows: readonly number[], piece: Piece, state: NativeState): number {
  return readCornerTable(piece, state.rotation).filter((corner) => {
    const cell = nativeCornerCell(piece, state, corner);
    return isOccupiedOrWallNative(rows, cell.x, cell.y);
  }).length;
}

function nativeCornerCell(piece: Piece, state: NativeState, corner: Corner): { readonly x: number; readonly y: number } {
  const tetrio = nativeToTetrioState(piece, state);
  const tetrioY = Math.ceil(tetrio.y) + corner[1];
  return {
    x: tetrio.x + corner[0],
    y: TOTAL_HEIGHT - 1 - tetrioY
  };
}

function readCornerTable(piece: Piece, rotation: number): readonly Corner[] {
  return cornerTable[piece]?.[rotation] ?? [];
}

function randomRows(rng: () => number): number[] {
  const rows = emptyRows();
  const height = 1 + Math.floor(rng() * 10);
  for (let y = 0; y < height; y += 1) {
    let mask = 0;
    const density = 0.16 + rng() * 0.5;
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      if (rng() < density) {
        mask |= 1 << x;
      }
    }
    rows[y] = mask;
  }
  return rows;
}

function clearNativeCells(rows: number[], piece: Piece, state: NativeState): void {
  for (const cell of nativeCells(piece, state)) {
    if (cell.y >= 0 && cell.y < VISIBLE_HEIGHT && cell.x >= 0 && cell.x < BOARD_WIDTH) {
      rows[cell.y] = (rows[cell.y] ?? 0) & ~(1 << cell.x);
    }
  }
}

function emptyRows(): number[] {
  return new Array(VISIBLE_HEIGHT).fill(0) as number[];
}

function noneSpin(clearedLines: number): NativeSpinDetectionSnapshot {
  return {
    kind: "NONE",
    spin: false,
    mini: false,
    immobile: false,
    occupiedCorners: 0,
    clearedLines
  };
}

function emptyCoverage(): {
  direct: number;
  kicked: number;
  failed: number;
  normal: number;
  mini: number;
  nonT: number;
  kickIndex3FullT: number;
  none: number;
  lineClear: number;
  modes: Set<NativeSpinMode>;
} {
  return {
    direct: 0,
    kicked: 0,
    failed: 0,
    normal: 0,
    mini: 0,
    nonT: 0,
    kickIndex3FullT: 0,
    none: 0,
    lineClear: 0,
    modes: new Set()
  };
}

function addCoverage(coverage: ReturnType<typeof emptyCoverage>, fixture: SnapshotCase): void {
  coverage.modes.add(fixture.spinMode);
  if (!fixture.expected.success) {
    coverage.failed += 1;
    return;
  }
  if (fixture.expected.kickIndex === null) {
    coverage.direct += 1;
  } else {
    coverage.kicked += 1;
  }
  if (fixture.expected.spin.kind === "T_SPIN") {
    coverage.normal += 1;
  } else if (fixture.expected.spin.kind === "T_SPIN_MINI") {
    coverage.mini += 1;
  } else {
    coverage.none += 1;
  }
  if (fixture.expected.spin.spin && fixture.piece !== "T") {
    coverage.nonT += 1;
  }
  if (fixture.piece === "T" && fixture.expected.kickIndex === 3 && fixture.expected.spin.kind === "T_SPIN") {
    coverage.kickIndex3FullT += 1;
  }
  if (fixture.expected.spin.clearedLines > 0) {
    coverage.lineClear += 1;
  }
}

function hasCoverage(coverage: ReturnType<typeof emptyCoverage>): boolean {
  return (
    coverage.direct >= 180 &&
    coverage.kicked >= 120 &&
    coverage.failed >= 180 &&
    coverage.normal >= 24 &&
    coverage.mini >= 24 &&
    coverage.nonT >= 12 &&
    coverage.kickIndex3FullT >= 1 &&
    coverage.none >= 180 &&
    coverage.lineClear >= 24 &&
    coverage.modes.size === SPIN_MODES.length
  );
}

function readPiece(piece: Piece): TetrioPiece {
  const value = tetrominoes[piece];
  if (value === undefined) {
    throw new Error(`Missing TETR.IO tetromino ${piece}.`);
  }
  return value;
}

function readKickset(key: string): TetrioKickset {
  const value = kicksets[key];
  if (value === undefined) {
    throw new Error(`Missing TETR.IO kickset ${key}.`);
  }
  return value;
}

function pick<T>(values: readonly T[], rng: () => number): T {
  const value = values[Math.floor(rng() * values.length)];
  if (value === undefined) {
    throw new Error("Cannot pick from an empty array.");
  }
  return value;
}

function createXorshift32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function mod4(value: number): number {
  return ((value % 4) + 4) % 4;
}

function extractObjectLiteralAfterKey(input: string, key: string): string {
  const keyIndex = input.indexOf(`${key}:`);
  if (keyIndex === -1) {
    throw new Error(`Could not find ${key} in the client bundle.`);
  }

  const start = input.indexOf("{", keyIndex + key.length + 1);
  if (start === -1) {
    throw new Error(`Could not find ${key} object start.`);
  }

  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return input.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Could not find ${key} object end.`);
}

function evaluateObject(source: string): Record<string, unknown> {
  const value = Function(`"use strict"; return (${source});`)() as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Extracted source did not evaluate to an object.");
  }
  return value as Record<string, unknown>;
}

async function formatSnapshot(snapshot: Snapshot, outputPath: string): Promise<string> {
  const config = (await resolveConfig(outputPath)) ?? {};
  return await format(
    [
      "// Generated by scripts/generate-tetrio-spin-snapshots.ts. Do not edit by hand.",
      "",
      `export const TETRIO_SPIN_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)} as const;`,
      ""
    ].join("\n"),
    { ...config, parser: "typescript" }
  );
}
