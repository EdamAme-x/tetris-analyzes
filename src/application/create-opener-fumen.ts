import { BOARD_HEIGHT, BOARD_WIDTH } from "../domain/board";
import type { FumenCell, FumenMino, FumenOperation, FumenPageInput, FumenRotation } from "../domain/fumen";
import type { NativeBeamPlacement, NativeBeamSearchNode, NativePlacementCell } from "../infrastructure/native/binding-types";

interface OpenerFumenOptions {
  readonly title?: string;
  readonly includeOperations?: boolean;
}

interface RelativeCell {
  readonly x: number;
  readonly y: number;
}

type ColoredBoard = FumenCell[][];

const EMPTY_CELL: FumenCell = "_";
const FUMEN_ROTATIONS = ["spawn", "right", "reverse", "left"] as const satisfies readonly FumenRotation[];
const SPAWN_BLOCKS = {
  I: [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 }
  ],
  T: [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 }
  ],
  O: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 }
  ],
  L: [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 }
  ],
  J: [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: -1, y: 1 }
  ],
  S: [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 }
  ],
  Z: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 1 }
  ]
} satisfies Record<FumenMino, readonly RelativeCell[]>;

export function createOpenerFumenPages(node: NativeBeamSearchNode, options: OpenerFumenOptions = {}): FumenPageInput[] {
  if (node.placements.length === 0) {
    return [
      {
        rows: Uint16Array.from(node.rows),
        comment: formatCandidateTitle(node, options.title)
      }
    ];
  }

  let board = createEmptyBoard();
  return node.placements.map((placement, index) => {
    const piece = assertPlacementPiece(placement);
    board = lockPlacement(board, placement, piece);
    const operation = options.includeOperations === false ? undefined : inferFumenOperation(placement, piece);
    return {
      fieldRows: boardToFieldRows(board),
      comment: `${formatCandidateTitle(node, options.title)} step ${index + 1}/${node.placements.length}: ${formatPlacementSummary(placement)}`,
      flags: { lock: true, colorize: true, mirror: false, rise: false },
      ...(operation === undefined ? {} : { operation })
    };
  });
}

function formatCandidateTitle(node: NativeBeamSearchNode, title: string | undefined): string {
  return title ?? `attack=${node.attack} score=${node.score.toFixed(1)} depth=${node.depth}`;
}

function createEmptyBoard(): ColoredBoard {
  return Array.from({ length: BOARD_HEIGHT }, createEmptyRow);
}

function createEmptyRow(): FumenCell[] {
  return new Array<FumenCell>(BOARD_WIDTH).fill(EMPTY_CELL);
}

function lockPlacement(board: ColoredBoard, placement: NativeBeamPlacement, piece: FumenMino): ColoredBoard {
  const next = board.map((row) => [...row]);
  for (const cell of placement.cells) {
    assertCellInBoard(cell, placement.path);
    next[cell.y]![cell.x] = piece;
  }
  return clearFullRows(next);
}

function clearFullRows(board: ColoredBoard): ColoredBoard {
  const rows = board.filter((row) => row.some((cell) => cell === EMPTY_CELL));
  while (rows.length < BOARD_HEIGHT) {
    rows.push(createEmptyRow());
  }
  return rows;
}

function boardToFieldRows(board: ColoredBoard): string[] {
  return [...board].reverse().map((row) => row.join(""));
}

function formatPlacementSummary(placement: NativeBeamPlacement): string {
  const suffixes = [];
  if (placement.clearName !== "NONE") {
    suffixes.push(placement.clearName);
  }
  if (placement.clearName === "NONE" && placement.spinKind !== "NONE") {
    suffixes.push(placement.spinKind);
  }
  if (placement.clearedLines > 0) {
    suffixes.push(`${placement.clearedLines}L`);
  }
  if (placement.attack > 0) {
    suffixes.push(`${placement.attack}A`);
  }
  if (placement.allClear) {
    suffixes.push("PC");
  }
  return suffixes.length === 0 ? placement.path : `${placement.path} ${suffixes.join(" ")}`;
}

function inferFumenOperation(placement: NativeBeamPlacement, piece: FumenMino): FumenOperation | undefined {
  const target = new Set(placement.cells.map(cellKey));
  for (const rotation of FUMEN_ROTATIONS) {
    const blocks = rotatedBlocks(piece, rotation);
    for (const cell of placement.cells) {
      for (const block of blocks) {
        const origin = { x: cell.x - block.x, y: cell.y - block.y };
        if (blocks.every((candidate) => target.has(cellKey({ x: origin.x + candidate.x, y: origin.y + candidate.y })))) {
          return {
            type: piece,
            rotation,
            x: origin.x,
            y: origin.y
          };
        }
      }
    }
  }
  return undefined;
}

function rotatedBlocks(piece: FumenMino, rotation: FumenRotation): readonly RelativeCell[] {
  const blocks = SPAWN_BLOCKS[piece];
  switch (rotation) {
    case "spawn":
      return blocks;
    case "right":
      return blocks.map((cell) => ({ x: cell.y, y: -cell.x }));
    case "reverse":
      return blocks.map((cell) => ({ x: -cell.x, y: -cell.y }));
    case "left":
      return blocks.map((cell) => ({ x: -cell.y, y: cell.x }));
  }
}

function assertPlacementPiece(placement: NativeBeamPlacement): FumenMino {
  if (isFumenMino(placement.piece)) {
    return placement.piece;
  }
  throw new Error(`Placement ${placement.path} contains unsupported fumen piece "${placement.piece}".`);
}

function isFumenMino(value: string): value is FumenMino {
  return value === "I" || value === "L" || value === "O" || value === "Z" || value === "T" || value === "J" || value === "S";
}

function assertCellInBoard(cell: NativePlacementCell, path: string): void {
  if (
    !Number.isInteger(cell.x) ||
    cell.x < 0 ||
    cell.x >= BOARD_WIDTH ||
    !Number.isInteger(cell.y) ||
    cell.y < 0 ||
    cell.y >= BOARD_HEIGHT
  ) {
    throw new Error(`Placement ${path} has out-of-board cell (${cell.x}, ${cell.y}).`);
  }
}

function cellKey(cell: NativePlacementCell | RelativeCell): string {
  return `${cell.x},${cell.y}`;
}
