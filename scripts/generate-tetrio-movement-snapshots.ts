import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { TETRIO_TABLE_SOURCE } from "../src/generated/tetrio-tables.generated";

const DEFAULT_OUTPUT = "tests/fixtures/tetrio-movement.generated.ts";
const DEFAULT_CASE_COUNT = 1536;
const BOARD_WIDTH = 10;
const VISIBLE_HEIGHT = 20;
const BOARD_BUFFER = 20;
const TOTAL_HEIGHT = VISIBLE_HEIGHT + BOARD_BUFFER;
const PIECES = ["i", "o", "t", "s", "z", "j", "l"] as const;
const DIRECTIONS = [-1, 1, 2] as const;
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
}

interface TetrioKickset {
  readonly kicks: Record<string, readonly Offset[]>;
  readonly i_kicks?: Record<string, readonly Offset[]>;
  readonly allow_o_kick?: boolean;
  readonly additional_offsets?: Partial<Record<Piece, Offsets>>;
  readonly spawn_rotation?: Partial<Record<Piece, number>>;
}

interface NativeState {
  readonly rotation: number;
  readonly x: number;
  readonly y: number;
}

interface SnapshotCase {
  readonly name: string;
  readonly kickTable: string;
  readonly piece: Uppercase<Piece>;
  readonly rows: readonly number[];
  readonly from: NativeState;
  readonly direction: Direction;
  readonly expected:
    | { readonly success: false }
    | { readonly success: true; readonly rotation: number; readonly x: number; readonly y: number; readonly kickIndex: number | null };
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
const snapshot = createSnapshot(options.asset ?? TETRIO_TABLE_SOURCE.asset);
const content = formatSnapshot(snapshot);
const outputPath = resolve(options.output);

if (options.check) {
  const current = await Bun.file(outputPath).text();
  if (current !== content) {
    throw new Error(`${options.output} is out of date. Run bun run generate:tetrio-movement-snapshots.`);
  }
  console.log(`${options.output} is up to date.`);
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, content);
  console.log(`Generated ${options.output} with ${snapshot.cases.length} TETR.IO movement cases.`);
}

function parseArgs(args: readonly string[]): GenerateOptions {
  const options: { input?: string; asset?: string; output: string; caseCount: number; check: boolean } = {
    output: DEFAULT_OUTPUT,
    caseCount: DEFAULT_CASE_COUNT,
    check: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--input":
        options.input = readValue(args, ++index, arg);
        break;
      case "--asset":
        options.asset = readValue(args, ++index, arg);
        break;
      case "--output":
        options.output = readValue(args, ++index, arg);
        break;
      case "--cases":
        options.caseCount = readPositiveInteger(readValue(args, ++index, arg), arg);
        break;
      case "--check":
        options.check = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
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

async function loadBundle(options: GenerateOptions): Promise<string> {
  if (options.input !== undefined) {
    return await Bun.file(options.input).text();
  }

  const response = await fetch(options.asset ?? TETRIO_TABLE_SOURCE.asset);
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
          cases.push(createCase(`empty-${kickTable}-${piece}-${rotation}-${direction}`, kickTable, piece, rows, from, direction));
        }
      }
    }
  }

  const rng = createXorshift32(0x715e_2026);
  const coverage = { direct: 0, kicked: 0, failed: 0 };
  for (const fixture of cases) {
    addCoverage(coverage, fixture);
  }

  let attempts = 0;
  while (cases.length < options.caseCount || coverage.kicked < 180 || coverage.failed < 180 || coverage.direct < 180) {
    attempts += 1;
    if (attempts > options.caseCount * 300) {
      throw new Error(`Could not generate enough TETR.IO movement coverage after ${attempts} attempts.`);
    }

    const kickTable = pick(Object.keys(kicksets), rng);
    const piece = pick(PIECES, rng);
    const rotation = Math.floor(rng() * 4);
    const direction = pick(DIRECTIONS, rng);
    const from = randomState(piece, rotation, rng);
    const rows = randomRows(rng);
    clearNativeCells(rows, piece, from);
    if (!isLegalAtNativeState(rows, piece, from)) {
      continue;
    }

    const fixture = createCase(`random-${cases.length.toString().padStart(4, "0")}`, kickTable, piece, rows, from, direction);
    cases.push(fixture);
    addCoverage(coverage, fixture);
  }

  return {
    source: {
      asset,
      boardWidth: BOARD_WIDTH,
      visibleHeight: VISIBLE_HEIGHT,
      boardBuffer: BOARD_BUFFER,
      generator: "scripts/generate-tetrio-movement-snapshots.ts"
    },
    cases: cases.slice(0, Math.max(options.caseCount, cases.length))
  };
}

function createCase(
  name: string,
  kickTable: string,
  piece: Piece,
  rows: readonly number[],
  from: NativeState,
  direction: Direction
): SnapshotCase {
  return {
    name,
    kickTable: toNativeKickTable(kickTable),
    piece: piece.toUpperCase() as Uppercase<Piece>,
    rows: [...rows],
    from,
    direction,
    expected: resolveTetrioRotation(rows, kickTable, piece, from, direction)
  };
}

function toNativeKickTable(kickTable: string): string {
  return kickTable === "none" ? "NONE" : kickTable;
}

function resolveTetrioRotation(
  rows: readonly number[],
  kickTableKey: string,
  piece: Piece,
  from: NativeState,
  direction: Direction
): SnapshotCase["expected"] {
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
    y: Math.floor(rng() * Math.min(8, VISIBLE_HEIGHT - bounds.height + 1))
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
    if (isOccupiedOrWall(rows, cell.x, cell.y)) {
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

function isOccupiedOrWall(rows: readonly number[], x: number, y: number): boolean {
  if (!Number.isInteger(x) || x < 0 || x >= BOARD_WIDTH || y < 0 || y >= TOTAL_HEIGHT) {
    return true;
  }
  if (y < BOARD_BUFFER) {
    return false;
  }
  const nativeY = TOTAL_HEIGHT - 1 - y;
  return ((rows[nativeY] ?? 0) & (1 << x)) !== 0;
}

function randomRows(rng: () => number): number[] {
  const rows = emptyRows();
  const height = 1 + Math.floor(rng() * 8);
  for (let y = 0; y < height; y += 1) {
    let mask = 0;
    const density = 0.12 + rng() * 0.38;
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
  const tetrio = nativeToTetrioState(piece, state);
  for (const cell of tetrioBoardCells(piece, state.rotation, tetrio.x, tetrio.y)) {
    const nativeY = TOTAL_HEIGHT - 1 - cell.y;
    if (nativeY >= 0 && nativeY < VISIBLE_HEIGHT && cell.x >= 0 && cell.x < BOARD_WIDTH) {
      rows[nativeY] = (rows[nativeY] ?? 0) & ~(1 << cell.x);
    }
  }
}

function emptyRows(): number[] {
  return new Array(VISIBLE_HEIGHT).fill(0) as number[];
}

function addCoverage(coverage: { direct: number; kicked: number; failed: number }, fixture: SnapshotCase): void {
  if (!fixture.expected.success) {
    coverage.failed += 1;
  } else if (fixture.expected.kickIndex === null) {
    coverage.direct += 1;
  } else {
    coverage.kicked += 1;
  }
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

function formatSnapshot(snapshot: Snapshot): string {
  return [
    "// Generated by scripts/generate-tetrio-movement-snapshots.ts. Do not edit by hand.",
    "",
    `export const TETRIO_MOVEMENT_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)} as const;`,
    ""
  ].join("\n");
}
