import { describe, expect, test } from "bun:test";
import {
  canReachOpenerPlacement,
  detectOpenerSpin,
  estimateOpenerTSpinPotential,
  evaluateOpenerBag,
  evaluateOpenerFirepower,
  searchOpenerBeam,
  searchOpenerBeamWithPlacements,
  type SearchPiece
} from "../src/application/search-opener";
import { TETRIO_COMBO_ATTACK_TABLES, TETRIO_GARBAGE_ATTACK_TABLE, TETRIO_SCORING_TABLE } from "../src/domain/tetrio-tables";
import { bitBoardFromRows } from "../src/infrastructure/bitboard/native-bitboard";
import type { NativeClearName } from "../src/infrastructure/native/binding-types";

describe("native opener beam search", () => {
  test("searches placements in native code and returns scored beam nodes without detail payload by default", () => {
    const nodes = searchOpenerBeam({ queue: "TILJSZO", beamWidth: 16, hold: true, maxDepth: 4 });

    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.length).toBeLessThanOrEqual(16);
    expect(nodes[0]?.depth).toBe(4);
    expect(nodes[0]?.rows).toHaveLength(20);
    expect(nodes[0]?.path).toHaveLength(4);
    expect(nodes[0]?.placements).toHaveLength(0);
    expect(nodes[0]?.firepowerScore).toBeGreaterThanOrEqual(0);
    expect(nodes[0]?.attack).toBeGreaterThanOrEqual(0);
    expect(nodes[0]?.points).toBeGreaterThanOrEqual(0);
    expect(nodes[0]?.occupiedCells ?? 0).toBeGreaterThan(0);
    expect(nodes[0]?.occupiedCells ?? 0).toBeLessThanOrEqual(16);
    for (let index = 1; index < nodes.length; index += 1) {
      expect(nodes[index - 1]?.score ?? 0).toBeGreaterThanOrEqual(nodes[index]?.score ?? 0);
    }
  });

  test("returns placement details for fumen preview generation when requested", () => {
    const nodes = searchOpenerBeamWithPlacements({ queue: "TILJSZO", beamWidth: 16, hold: true, maxDepth: 4 });

    expect(nodes[0]?.placements).toHaveLength(4);
    expect(nodes[0]?.placements[0]?.cells).toHaveLength(4);
    expect(nodes[0]?.placements[0]?.path).toContain(",y");
    expect(nodes[0]?.placements[0]?.spinKind).toBeDefined();
    expect(nodes[0]?.placements[0]?.clearName).toBeDefined();
    expect(nodes[0]?.placements[0]?.attack).toBeGreaterThanOrEqual(0);
    expect(nodes[0]?.placements[0]?.clearedLines).toBeGreaterThanOrEqual(0);
  });

  test("models hold inside the native search brancher", () => {
    const nodes = searchOpenerBeamWithPlacements({ queue: "ZI", beamWidth: 128, hold: true, maxDepth: 1 });

    expect(nodes.some((node) => node.hold === "Z" && node.path[0]?.startsWith("hold:I@") && node.placements[0]?.usedHold === true)).toBe(
      true
    );
  });

  test("consumes the next queue piece when holding from an empty hold slot", () => {
    const twoPieceNodes = searchOpenerBeamWithPlacements({ queue: "ZI", beamWidth: 128, hold: true, maxDepth: 1 });
    const heldFromEmpty = twoPieceNodes.find((node) => node.hold === "Z" && node.path[0]?.startsWith("hold:I@"));

    expect(heldFromEmpty).toMatchObject({
      queueIndex: 2,
      depth: 1,
      hold: "Z"
    });
    expect(heldFromEmpty?.placements[0]).toMatchObject({
      piece: "I",
      usedHold: true
    });

    const onePieceNodes = searchOpenerBeamWithPlacements({ queue: "Z", beamWidth: 128, hold: true, maxDepth: 1 });
    expect(onePieceNodes.every((node) => node.queueIndex === 1)).toBe(true);
    expect(onePieceNodes.some((node) => node.path[0]?.startsWith("hold:"))).toBe(false);
  });

  test("filters placements that are geometrically possible but unreachable from spawn", () => {
    const empty = bitBoardFromRows(new Array(20).fill(0));
    const blockedLateralEntry = new Array(20).fill(1 << 3);
    const sealedCave = new Array(20).fill(0);
    sealedCave[0] = 660;
    sealedCave[1] = 553;
    sealedCave[2] = 832;
    sealedCave[3] = 964;
    sealedCave[4] = 68;
    sealedCave[5] = 588;
    sealedCave[6] = 32;
    sealedCave[7] = 496;

    expect(canReachOpenerPlacement({ rows: empty, piece: "I", rotation: 0, x: 3, y: 0 })).toBe(true);
    expect(canReachOpenerPlacement({ rows: empty, piece: "I", rotation: 0, x: 3, y: 5 })).toBe(false);
    expect(
      canReachOpenerPlacement({ rows: bitBoardFromRows(blockedLateralEntry), piece: "O", rotation: 0, x: 0, y: 0, kickTable: "NONE" })
    ).toBe(false);
    expect(canReachOpenerPlacement({ rows: bitBoardFromRows(sealedCave), piece: "T", rotation: 0, x: 6, y: 1 })).toBe(false);
  });

  test("applies native kick table options during reachability and search", () => {
    const kickRequiredRows = new Array(20).fill(0);
    kickRequiredRows[0] = 33;
    kickRequiredRows[1] = 25;
    kickRequiredRows[2] = 9;
    kickRequiredRows[3] = 8;
    kickRequiredRows[4] = 462;
    kickRequiredRows[5] = 33;
    const board = bitBoardFromRows(kickRequiredRows);

    expect(canReachOpenerPlacement({ rows: board, piece: "T", rotation: 0, x: 4, y: 2, kickTable: "SRS+" })).toBe(true);
    expect(canReachOpenerPlacement({ rows: board, piece: "T", rotation: 0, x: 4, y: 2, kickTable: "NONE" })).toBe(false);
    const parserSmoke = { queue: "TIL", beamWidth: 4, maxDepth: 1 } as const;
    expect(() => searchOpenerBeam({ ...parserSmoke, kickTable: "SRS-X" })).not.toThrow();
    expect(() => searchOpenerBeam({ ...parserSmoke, kickTable: "TETRA-X" })).not.toThrow();
    expect(() => searchOpenerBeam({ ...parserSmoke, kickTable: "NRS" })).not.toThrow();
    expect(() => searchOpenerBeam({ ...parserSmoke, kickTable: "ARS" })).not.toThrow();
    expect(() => searchOpenerBeam({ ...parserSmoke, kickTable: "ASC" })).not.toThrow();
    expect(() => evaluateOpenerBag({ bag: "TIO", beamWidth: 4, maxDepth: 1, kickTable: "NONE", maxQueues: 2 })).not.toThrow();
    expect(() => searchOpenerBeam({ queue: "TIL", kickTable: "BAD KICKS" as "SRS" })).toThrow("Unsupported native opener kick table");
  });

  test("detects T-spin, T-spin mini, and immobile spin primitives in native code", () => {
    const fullTSpinRows = new Array(20).fill(0);
    fullTSpinRows[1] = (1 << 3) | (1 << 5);
    const miniTSpinRows = new Array(20).fill(0);
    miniTSpinRows[1] = 1 << 3;
    const immobileIRows = new Array(20).fill(0);
    immobileIRows[0] = (1 << 2) | (1 << 7);

    expect(detectOpenerSpin({ rows: bitBoardFromRows(fullTSpinRows), piece: "T", rotation: 0, x: 3, y: 0 })).toMatchObject({
      kind: "T_SPIN",
      spin: true,
      mini: false,
      occupiedCorners: 4
    });
    expect(detectOpenerSpin({ rows: bitBoardFromRows(miniTSpinRows), piece: "T", rotation: 0, x: 3, y: 0 })).toMatchObject({
      kind: "T_SPIN_MINI",
      spin: true,
      mini: true,
      occupiedCorners: 3
    });
    expect(detectOpenerSpin({ rows: bitBoardFromRows(immobileIRows), piece: "I", rotation: 0, x: 3, y: 0 })).toMatchObject({
      kind: "IMMOBILE_SPIN",
      spin: true,
      immobile: true
    });
  });

  test("estimates T-spin slot potential before the clearing T is placed", () => {
    const empty = bitBoardFromRows(new Array(20).fill(0));
    const readyRows = new Array(20).fill(0);
    readyRows[1] = (1 << 3) | (1 << 5);
    const unreachableRows = new Array(20).fill(0);
    unreachableRows[0] = 660;
    unreachableRows[1] = 553;
    unreachableRows[2] = 832;
    unreachableRows[3] = 964;
    unreachableRows[4] = 68;
    unreachableRows[5] = 588;
    unreachableRows[6] = 32;
    unreachableRows[7] = 496;

    expect(estimateOpenerTSpinPotential(empty)).toBe(0);
    expect(estimateOpenerTSpinPotential(bitBoardFromRows(readyRows))).toBeGreaterThanOrEqual(1);
    expect(estimateOpenerTSpinPotential(bitBoardFromRows(unreachableRows))).toBe(0);
  });

  test("applies native spin mode options before firepower scoring", () => {
    const fullTSpinRows = new Array(20).fill(0);
    fullTSpinRows[1] = (1 << 3) | (1 << 5);
    const immobileIRows = new Array(20).fill(0);
    immobileIRows[0] = (1 << 2) | (1 << 7);
    const handheldCornerRows = new Array(20).fill(0);
    handheldCornerRows[1] = 1 << 2;

    expect(
      detectOpenerSpin({ rows: bitBoardFromRows(fullTSpinRows), piece: "T", rotation: 0, x: 3, y: 0, spinMode: "NONE" })
    ).toMatchObject({
      kind: "NONE",
      spin: false
    });
    expect(
      detectOpenerSpin({ rows: bitBoardFromRows(immobileIRows), piece: "I", rotation: 0, x: 3, y: 0, spinMode: "ALL-SPINS" })
    ).toMatchObject({
      kind: "T_SPIN",
      spin: true,
      mini: false
    });
    expect(
      detectOpenerSpin({ rows: bitBoardFromRows(immobileIRows), piece: "I", rotation: 0, x: 3, y: 0, spinMode: "T-SPINS" })
    ).toMatchObject({
      kind: "NONE",
      spin: false,
      mini: false
    });
    expect(
      detectOpenerSpin({ rows: bitBoardFromRows(immobileIRows), piece: "I", rotation: 0, x: 3, y: 0, spinMode: "ALL-MINI" })
    ).toMatchObject({
      kind: "T_SPIN_MINI",
      spin: true,
      mini: true
    });
    expect(
      detectOpenerSpin({ rows: bitBoardFromRows(handheldCornerRows), piece: "I", rotation: 0, x: 3, y: 0, spinMode: "ALL-SPINS" })
    ).toMatchObject({
      kind: "NONE",
      spin: false
    });
    expect(
      detectOpenerSpin({ rows: bitBoardFromRows(handheldCornerRows), piece: "I", rotation: 0, x: 3, y: 0, spinMode: "HANDHELD" })
    ).toMatchObject({
      kind: "T_SPIN",
      spin: true,
      occupiedCorners: 3
    });
    expect(() => searchOpenerBeam({ queue: "TIL", spinMode: "HANDHELD" })).not.toThrow();
    expect(() => searchOpenerBeam({ queue: "TIL", spinMode: "BAD SPINS" as "T-SPINS" })).toThrow("Unsupported native opener spin mode");
  });

  test("evaluates TETR.IO-style opener firepower in native code", () => {
    expect(evaluateOpenerFirepower([{ clearName: "SINGLE", allClear: true }])).toMatchObject({
      attack: 10,
      points: 3600,
      combo: 1,
      allClears: 1
    });

    const b2b = evaluateOpenerFirepower([{ clearName: "QUAD" }, { clearName: "QUAD" }]);
    expect(b2b.attack).toBe(10);
    expect(b2b.points).toBe(2050);
    expect(b2b.maxCombo).toBe(2);
    expect(b2b.backToBackChain).toBe(2);
    expect(b2b.events[1]).toMatchObject({
      clearName: "QUAD",
      baseAttack: 4,
      attack: 6,
      backToBack: true
    });

    expect(evaluateOpenerFirepower([{ clearName: "TSPIN_DOUBLE" }]).events[0]).toMatchObject({
      clearName: "TSPIN_DOUBLE",
      attack: 4,
      points: 1200,
      combo: 1
    });
  });

  test("preserves B2B through no-line setup moves and resets it on ordinary clears", () => {
    const setupBetweenQuads = evaluateOpenerFirepower([{ clearName: "QUAD" }, { clearName: "NONE" }, { clearName: "QUAD" }]);
    expect(setupBetweenQuads).toMatchObject({
      backToBackChain: 2,
      maxCombo: 1
    });
    expect(setupBetweenQuads.events[2]).toMatchObject({
      clearName: "QUAD",
      backToBack: true
    });

    const singleBetweenQuads = evaluateOpenerFirepower([{ clearName: "QUAD" }, { clearName: "SINGLE" }, { clearName: "QUAD" }]);
    expect(singleBetweenQuads).toMatchObject({
      backToBackChain: 1,
      maxCombo: 3
    });
    expect(singleBetweenQuads.events[2]).toMatchObject({
      clearName: "QUAD",
      backToBack: false
    });
  });

  test("weights B2B-capable T-spin and difficult clear chains above plain line clears", () => {
    const tSpinSingle = evaluateOpenerFirepower([{ clearName: "TSPIN_SINGLE" }]);
    const doubleChain = evaluateOpenerFirepower([{ clearName: "DOUBLE" }, { clearName: "DOUBLE" }]);
    const quad = evaluateOpenerFirepower([{ clearName: "QUAD" }]);
    const b2bQuads = evaluateOpenerFirepower([{ clearName: "QUAD" }, { clearName: "QUAD" }]);

    expect(tSpinSingle.firepowerScore).toBeGreaterThan(doubleChain.firepowerScore * 3);
    expect(b2bQuads.firepowerScore).toBeGreaterThan(quad.firepowerScore * 2);
  });

  test("keeps native firepower clear tables aligned with extracted TETR.IO tables", () => {
    const clearNames = [
      "SINGLE",
      "DOUBLE",
      "TRIPLE",
      "QUAD",
      "PENTA",
      "TSPIN_MINI",
      "TSPIN",
      "TSPIN_MINI_SINGLE",
      "TSPIN_SINGLE",
      "TSPIN_MINI_DOUBLE",
      "TSPIN_DOUBLE",
      "TSPIN_MINI_TRIPLE",
      "TSPIN_TRIPLE",
      "TSPIN_MINI_QUAD",
      "TSPIN_QUAD",
      "TSPIN_PENTA"
    ] as const satisfies readonly NativeClearName[];

    for (const clearName of clearNames) {
      const [event] = evaluateOpenerFirepower([{ clearName }]).events;
      expect(event?.baseAttack).toBe(TETRIO_GARBAGE_ATTACK_TABLE[clearName]);
      expect(event?.points).toBe(TETRIO_SCORING_TABLE[clearName]);
    }

    const allClearSingle = evaluateOpenerFirepower([{ clearName: "SINGLE", allClear: true }]).events[0];
    expect(allClearSingle?.attack).toBe(TETRIO_GARBAGE_ATTACK_TABLE.SINGLE + TETRIO_GARBAGE_ATTACK_TABLE.ALL_CLEAR);
    expect(allClearSingle?.points).toBe(TETRIO_SCORING_TABLE.SINGLE + TETRIO_SCORING_TABLE.ALL_CLEAR);
  });

  test("uses extracted TETR.IO combo tables in native firepower evaluation", () => {
    const classicDoubles = Array.from({ length: 12 }, () => ({
      clearName: "DOUBLE",
      comboTable: "CLASSIC GUIDELINE"
    })) satisfies Array<{ clearName: NativeClearName; comboTable: "CLASSIC GUIDELINE" }>;
    const modernDoubles = Array.from({ length: 12 }, () => ({
      clearName: "DOUBLE",
      comboTable: "MODERN GUIDELINE"
    })) satisfies Array<{ clearName: NativeClearName; comboTable: "MODERN GUIDELINE" }>;
    const noComboDoubles = Array.from({ length: 12 }, () => ({
      clearName: "DOUBLE",
      comboTable: "NONE"
    })) satisfies Array<{ clearName: NativeClearName; comboTable: "NONE" }>;

    expect(evaluateOpenerFirepower(classicDoubles).events.at(-1)?.attack).toBe(
      TETRIO_GARBAGE_ATTACK_TABLE.DOUBLE + TETRIO_COMBO_ATTACK_TABLES["classic guideline"][10]!
    );
    expect(evaluateOpenerFirepower(modernDoubles).events.at(-1)?.attack).toBe(
      TETRIO_GARBAGE_ATTACK_TABLE.DOUBLE + TETRIO_COMBO_ATTACK_TABLES["modern guideline"][10]!
    );
    expect(evaluateOpenerFirepower(noComboDoubles).events.at(-1)?.attack).toBe(TETRIO_GARBAGE_ATTACK_TABLE.DOUBLE);
  });

  test("ignores impossible all clear markers on no-line firepower events", () => {
    expect(evaluateOpenerFirepower([{ clearName: "NONE", allClear: true }])).toMatchObject({
      attack: 0,
      points: 0,
      combo: 0,
      allClears: 0
    });
    expect(evaluateOpenerFirepower([{ clearName: "NONE", allClear: true }]).events[0]).toMatchObject({
      clearName: "NONE",
      allClear: false,
      allClearBonus: 0
    });
  });

  test("aggregates buildability and Pareto ranking over bag permutations in native code", () => {
    const evaluation = evaluateOpenerBag({ bag: "TIO", beamWidth: 16, hold: true, maxDepth: 3, topQueueCount: 4 });

    expect(evaluation.bag).toBe("TIO");
    expect(evaluation.totalQueues).toBe(6);
    expect(evaluation.searchedQueues).toBe(6);
    expect(evaluation.exact).toBe(true);
    expect(evaluation.buildableQueues).toBe(6);
    expect(evaluation.buildRate).toBe(1);
    expect(evaluation.averageScore).toBeGreaterThan(Number.NEGATIVE_INFINITY);
    expect(evaluation.topQueues).toHaveLength(4);
    expect(evaluation.paretoFront.length).toBeGreaterThan(0);
    expect(evaluation.topQueues[0]?.paretoFront).toBe(true);
    expect(evaluation.topQueues[0]?.dominatedBy).toBe(0);
    expect(typeof evaluation.topQueues[0]?.difficultAttack).toBe("number");
    expect(typeof evaluation.topQueues[0]?.difficultClears).toBe("number");
    expect(typeof evaluation.topQueues[0]?.tSpinClears).toBe("number");
    expect(typeof evaluation.topQueues[0]?.tSpinAttack).toBe("number");
    expect(typeof evaluation.topQueues[0]?.backToBackChain).toBe("number");
    expect(typeof evaluation.topQueues[0]?.tSpinPotential).toBe("number");
  });

  test("can sample a capped number of 7-bag queue branches", () => {
    const evaluation = evaluateOpenerBag({ bag: "TIJLOSZ", beamWidth: 8, hold: true, maxDepth: 3, maxQueues: 12, topQueueCount: 12 });
    const sampledFirstPieces = new Set(evaluation.topQueues.map((queue) => queue.queue[0]));

    expect(evaluation.totalQueues).toBe(5040);
    expect(evaluation.searchedQueues).toBe(12);
    expect(evaluation.exact).toBe(false);
    expect(evaluation.buildableQueues).toBeGreaterThan(0);
    expect(evaluation.topQueues).toHaveLength(12);
    expect(sampledFirstPieces.size).toBeGreaterThan(1);
  });

  test("passes combo table rules into native search and bag evaluation", () => {
    expect(() => searchOpenerBeam({ queue: "TIL", comboTable: "MODERN GUIDELINE" })).not.toThrow();
    expect(() => evaluateOpenerBag({ bag: "TIO", comboTable: "CLASSIC GUIDELINE", maxQueues: 2 })).not.toThrow();
    expect(() => searchOpenerBeam({ queue: "TIL", comboTable: "BAD TABLE" as "MODERN GUIDELINE" })).toThrow(
      "Unknown opener firepower combo table"
    );
    expect(() => evaluateOpenerBag({ bag: "TIO", comboTable: "BAD TABLE" as "MODERN GUIDELINE" })).toThrow(
      "Unknown opener firepower combo table"
    );
  });

  test("matches wide-beam spin objective under tight native pruning", () => {
    const input = {
      queue: "JLSTZIOT",
      hold: true,
      maxDepth: 5,
      kickTable: "SRS-X",
      spinMode: "ALL-SPINS",
      comboTable: "MULTIPLIER"
    } as const;
    const [tightTop] = searchOpenerBeamWithPlacements({ ...input, beamWidth: 8 });
    const [wideTop] = searchOpenerBeamWithPlacements({ ...input, beamWidth: 64 });

    expect(tightTop).toMatchObject({
      tSpinClears: 1,
      tSpinAttack: 2,
      difficultClears: 1,
      backToBackChain: 1,
      attack: 2
    });
    expect(wideTop).toMatchObject({
      tSpinClears: tightTop?.tSpinClears,
      tSpinAttack: tightTop?.tSpinAttack,
      difficultClears: tightTop?.difficultClears,
      backToBackChain: tightTop?.backToBackChain,
      attack: tightTop?.attack
    });
    expect(tightTop?.placements.some((placement) => placement.clearName === "TSPIN_SINGLE")).toBe(true);
  });

  test("keeps medium-depth TL pruning on B2B T-spin lines", () => {
    const input = {
      queue: "SZILOJTSTOZLJI",
      hold: true,
      maxDepth: 14,
      comboTable: "MULTIPLIER",
      kickTable: "SRS+",
      spinMode: "T-SPINS"
    } as const;
    const [mediumTop] = searchOpenerBeam({ ...input, beamWidth: 256 });
    const [wideTop] = searchOpenerBeam({ ...input, beamWidth: 512 });

    expect(mediumTop).toMatchObject({
      queueIndex: 14,
      tSpinClears: 2,
      tSpinAttack: 5,
      backToBackChain: 2,
      difficultClears: 2,
      holes: 0
    });
    expect(wideTop).toMatchObject({
      queueIndex: 14,
      tSpinClears: 2,
      tSpinAttack: 9,
      backToBackChain: 2,
      difficultClears: 2,
      holes: 0
    });
    expect(wideTop?.attack ?? 0).toBeGreaterThanOrEqual(mediumTop?.attack ?? 0);
  });

  test("only emits placement histories reachable from each intermediate board", () => {
    const input = {
      queue: "JLSTZIOT",
      beamWidth: 32,
      hold: true,
      maxDepth: 5,
      kickTable: "SRS-X",
      spinMode: "ALL-SPINS",
      comboTable: "MULTIPLIER"
    } as const;
    const nodes = searchOpenerBeamWithPlacements(input);

    for (const node of nodes.slice(0, 8)) {
      let rows = new Array<number>(20).fill(0);
      for (const placement of node.placements) {
        expect(
          canReachOpenerPlacement({
            rows: bitBoardFromRows(rows),
            piece: placement.piece as SearchPiece,
            rotation: placement.rotation,
            x: placement.x,
            y: placement.y,
            kickTable: input.kickTable
          })
        ).toBe(true);

        rows = clearFullRows(lockCells(rows, placement.cells));
      }
    }
  });

  test("rejects invalid queues before searching", () => {
    expect(() => searchOpenerBeam({ queue: "TX", beamWidth: 8 })).toThrow("Unknown tetromino");
    expect(() => evaluateOpenerBag({ bag: "TT" })).toThrow("must not repeat");
    expect(() => searchOpenerBeam({ queue: "TIL", setupPoolMultiplier: 26 })).not.toThrow();
    expect(() => searchOpenerBeam({ queue: "TIL", setupPoolMultiplier: 0 })).toThrow("setupPoolMultiplier");
  });
});

function lockCells(rows: readonly number[], cells: readonly { readonly x: number; readonly y: number }[]): number[] {
  const output = [...rows];
  for (const cell of cells) {
    output[cell.y] = (output[cell.y] ?? 0) | (1 << cell.x);
  }
  return output;
}

function clearFullRows(rows: readonly number[]): number[] {
  const output = rows.filter((row) => row !== 0b1111111111);
  while (output.length < 20) {
    output.push(0);
  }
  return output;
}
