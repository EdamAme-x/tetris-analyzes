import { describe, expect, test } from "bun:test";
import { Mino } from "tetris-fumen";
import { createOpenerFumenPages } from "../src/application/create-opener-fumen";
import { searchOpenerBeamWithPlacements } from "../src/application/search-opener";
import type { FumenCellRow, FumenMino, FumenOperation, FumenRotation } from "../src/domain/fumen";
import type { NativeBeamPlacement, NativeBeamSearchNode, NativePlacementCell } from "../src/infrastructure/native/binding-types";
import { TetrisFumenCodec } from "../src/infrastructure/fumen/tetris-fumen-codec";

describe("opener fumen preview pages", () => {
  test("renders native placement history as colored multi-page fumen", () => {
    const [node] = searchOpenerBeamWithPlacements({
      queue: "TI",
      hold: false,
      beamWidth: 1,
      maxDepth: 2,
      kickTable: "SRS+",
      spinMode: "T-SPINS",
      comboTable: "MULTIPLIER"
    });
    expect(node).toBeDefined();

    const pages = createOpenerFumenPages(node!, { title: "candidate" });
    expect(pages).toHaveLength(2);
    expect(pages[0]?.fieldRows?.join("")).not.toContain("T");
    expect(pages[0]?.operation?.type).toBe("T");
    expect(pages[1]?.fieldRows?.join("")).toContain("T");
    expect(pages[1]?.fieldRows?.join("")).not.toContain("I");
    expect(pages[1]?.operation?.type).toBe("I");
    expect(pages[1]?.comment).toContain("step 2/2");

    const codec = new TetrisFumenCodec();
    const decoded = codec.decode(codec.encodePages(pages));
    expect(decoded).toHaveLength(2);
    expect(decoded[0]?.comment).toContain("candidate step 1/2");
    expect(decoded[0]?.operation?.type).toBe("T");
    expect(decoded[1]?.fieldRows.join("")).toContain("T");
    expect(decoded[1]?.operation?.type).toBe("I");
  });

  test("uses the pre-lock field when a fumen operation is emitted", () => {
    const placement = placementFromOperation({ type: "L", rotation: "right", x: 4, y: 1 });
    const node = nodeWithPlacements([placement]);

    const [page] = createOpenerFumenPages(node, { title: "single L" });
    expect(page?.fieldRows?.join("")).not.toContain("L");
    expect(page?.operation).toEqual({ type: "L", rotation: "right", x: 4, y: 1 });
    expect(canonicalCells(Mino.from(page!.operation!).positions())).toBe(canonicalCells(placement.cells));

    const [lockedPage] = createOpenerFumenPages(node, { title: "single L", includeOperations: false });
    expect(lockedPage?.fieldRows?.join("")).toContain("L");
    expect(lockedPage?.operation).toBeUndefined();
  });

  test("carries line clears into the next operation page without double-locking", () => {
    const node = nodeWithPlacements([
      placementFromOperation({ type: "O", rotation: "spawn", x: 0, y: 0 }),
      placementFromOperation({ type: "I", rotation: "spawn", x: 3, y: 0 }),
      placementFromOperation({ type: "O", rotation: "spawn", x: 6, y: 0 }),
      placementFromOperation({ type: "O", rotation: "spawn", x: 8, y: 0 }),
      placementFromOperation({ type: "T", rotation: "spawn", x: 4, y: 1 })
    ]);

    const pages = createOpenerFumenPages(node, { title: "line clear carry" });
    expect(bottomRow(pages[3])).toBe("OOIIIIOO__");
    expect(pages[3]?.operation).toEqual({ type: "O", rotation: "spawn", x: 8, y: 0 });
    expect(bottomRow(pages[4])).toBe("OO____OOOO");
    expect(pages[4]?.fieldRows?.join("")).not.toContain("I");
    expect(pages[4]?.fieldRows?.join("")).not.toContain("T");

    const codec = new TetrisFumenCodec();
    const decoded = codec.decode(codec.encodePages(pages));
    expect(bottomRow(decoded[4])).toBe("OO____OOOO");
    expect(decoded[4]?.operation?.type).toBe("T");
  });

  test("native placement shapes match tetris-fumen SRS geometry", () => {
    for (const piece of PIECES) {
      const placements = representativeNativePlacements(piece);
      expect([...placements.keys()].sort((left, right) => left - right)).toEqual([...EXPECTED_NATIVE_ROTATIONS[piece]]);

      for (const [rotationIndex, placement] of placements) {
        const rotation = fumenRotation(rotationIndex);
        const expected = normalizedFumenShape({ type: piece, rotation, x: 0, y: 0 });
        expect(normalizedCells(placement.cells)).toBe(expected);
      }
    }
  });

  test("every representative native placement becomes an exact fumen operation", () => {
    for (const piece of PIECES) {
      for (const [rotationIndex, placement] of representativeNativePlacements(piece)) {
        const [page] = createOpenerFumenPages(nodeWithPlacements([placement]), { title: `${piece}${rotationIndex}` });
        const operation = page?.operation;
        expect(operation?.type).toBe(piece);
        expect(operation?.rotation).toBe(fumenRotation(rotationIndex));
        expect(canonicalCells(Mino.from(operation!).positions())).toBe(canonicalCells(placement.cells));
      }
    }
  });

  test("real native hold and clear histories remain exact fumen operations", () => {
    const [node] = searchOpenerBeamWithPlacements({
      queue: "JLSTZIOT",
      beamWidth: 64,
      hold: true,
      maxDepth: 5,
      kickTable: "SRS-X",
      spinMode: "ALL-SPINS",
      comboTable: "MULTIPLIER"
    });
    expect(node?.placements.some((placement) => placement.usedHold)).toBe(true);
    expect(node?.placements.some((placement) => placement.clearedLines > 0)).toBe(true);

    const pages = createOpenerFumenPages(node!, { title: "real native" });
    expect(pages).toHaveLength(node!.placements.length);
    for (const [index, placement] of node!.placements.entries()) {
      const operation = pages[index]?.operation;
      expect(operation?.type).toBe(assertFumenMino(placement.piece));
      expect(canonicalCells(Mino.from(operation!).positions())).toBe(canonicalCells(placement.cells));
    }

    const codec = new TetrisFumenCodec();
    const decoded = codec.decode(codec.encodePages(pages));
    for (const [index, placement] of node!.placements.entries()) {
      const operation = decoded[index]?.operation;
      expect(operation?.type).toBe(assertFumenMino(placement.piece));
      expect(canonicalCells(Mino.from(operation!).positions())).toBe(canonicalCells(placement.cells));
    }

    const lockedPages = createOpenerFumenPages(node!, { title: "real native", includeOperations: false });
    const decodedLocked = codec.decode(codec.encodePages(lockedPages));
    expect(fieldRowsToBitRows(decodedLocked.at(-1)?.fieldRows ?? [])).toEqual(node!.rows);
  });
});

const PIECES = ["I", "O", "T", "S", "Z", "J", "L"] as const satisfies readonly FumenMino[];
const FUMEN_ROTATIONS = ["spawn", "right", "reverse", "left"] as const satisfies readonly FumenRotation[];
const EXPECTED_NATIVE_ROTATIONS = {
  I: [0, 1],
  O: [0],
  T: [0, 1, 2, 3],
  S: [0, 1],
  Z: [0, 1],
  J: [0, 1, 2, 3],
  L: [0, 1, 2, 3]
} as const satisfies Record<FumenMino, readonly number[]>;

function representativeNativePlacements(piece: FumenMino): Map<number, NativeBeamPlacement> {
  const placements = new Map<number, NativeBeamPlacement>();
  const nodes = searchOpenerBeamWithPlacements({
    queue: piece,
    hold: false,
    beamWidth: 256,
    maxDepth: 1,
    kickTable: "SRS+",
    spinMode: "T-SPINS",
    comboTable: "MULTIPLIER"
  });
  for (const node of nodes) {
    const placement = node.placements[0];
    if (placement !== undefined && placement.piece === piece && !placements.has(placement.rotation)) {
      placements.set(placement.rotation, placement);
    }
  }
  return placements;
}

function fumenRotation(rotationIndex: number): FumenRotation {
  const rotation = FUMEN_ROTATIONS[rotationIndex];
  if (rotation === undefined) {
    throw new Error(`Unsupported native rotation index ${rotationIndex}.`);
  }
  return rotation;
}

function assertFumenMino(piece: string): FumenMino {
  if ((PIECES as readonly string[]).includes(piece)) {
    return piece as FumenMino;
  }
  throw new Error(`Unsupported fumen mino ${piece}.`);
}

function placementFromOperation(operation: FumenOperation): NativeBeamPlacement {
  return {
    piece: operation.type,
    rotation: FUMEN_ROTATIONS.indexOf(operation.rotation),
    x: operation.x,
    y: operation.y,
    usedHold: false,
    cells: Mino.from(operation).positions(),
    path: `${operation.type}@r${FUMEN_ROTATIONS.indexOf(operation.rotation)},x${operation.x},y${operation.y}`,
    spinKind: "NONE",
    spin: false,
    mini: false,
    immobile: false,
    occupiedCorners: 0,
    clearedLines: 0,
    clearName: "NONE",
    attack: 0,
    baseAttack: 0,
    points: 0,
    combo: 0,
    backToBackChain: 0,
    backToBack: false,
    backToBackBonus: 0,
    allClear: false,
    allClearBonus: 0
  };
}

function nodeWithPlacements(placements: readonly NativeBeamPlacement[]): NativeBeamSearchNode {
  return {
    score: 0,
    firepowerScore: 0,
    depth: placements.length,
    queueIndex: placements.length,
    rows: new Array(20).fill(0),
    path: placements.map((placement) => placement.path),
    placements: [...placements],
    attack: 0,
    points: 0,
    combo: 0,
    maxCombo: 0,
    backToBackChain: 0,
    allClears: 0,
    difficultClears: 0,
    difficultAttack: 0,
    tSpinClears: 0,
    tSpinAttack: 0,
    tSpinPotential: 0,
    occupiedCells: placements.length * 4,
    clearedLines: 0,
    aggregateHeight: 0,
    holes: 0,
    bumpiness: 0
  };
}

function normalizedFumenShape(operation: FumenOperation): string {
  return normalizedCells(Mino.from(operation).positions());
}

function normalizedCells(cells: readonly NativePlacementCell[]): string {
  const minX = Math.min(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  return canonicalCells(cells.map((cell) => ({ x: cell.x - minX, y: cell.y - minY })));
}

function canonicalCells(cells: readonly NativePlacementCell[]): string {
  return cells
    .map((cell) => `${cell.x},${cell.y}`)
    .sort()
    .join(" ");
}

function bottomRow(page: { readonly fieldRows?: readonly FumenCellRow[] } | undefined): string | undefined {
  const row = page?.fieldRows?.at(-1);
  return typeof row === "string" || row === undefined ? row : row.join("");
}

function fieldRowsToBitRows(fieldRows: readonly string[]): number[] {
  const rows: number[] = [];
  for (let y = 0; y < 20; y += 1) {
    const row = fieldRows[fieldRows.length - 1 - y] ?? "";
    let mask = 0;
    for (let x = 0; x < 10; x += 1) {
      if (row[x] !== "_") {
        mask |= 1 << x;
      }
    }
    rows.push(mask);
  }
  return rows;
}
