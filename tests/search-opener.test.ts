import { describe, expect, test } from "bun:test";
import {
  canReachOpenerPlacement,
  detectOpenerSpin,
  evaluateOpenerFirepower,
  searchOpenerBeam,
  searchOpenerBeamWithPlacements
} from "../src/application/search-opener";
import { ROW_MASK } from "../src/domain/board";
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

  test("filters placements that are geometrically possible but unreachable from spawn", () => {
    const empty = bitBoardFromRows(new Array(20).fill(0));
    const sealedCave = new Array(20).fill(0);
    sealedCave[1] = ROW_MASK;

    expect(canReachOpenerPlacement({ rows: empty, piece: "I", rotation: 0, x: 3, y: 0 })).toBe(true);
    expect(canReachOpenerPlacement({ rows: bitBoardFromRows(sealedCave), piece: "I", rotation: 0, x: 3, y: 0 })).toBe(false);
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

  test("rejects invalid queues before searching", () => {
    expect(() => searchOpenerBeam({ queue: "TX", beamWidth: 8 })).toThrow("Unknown tetromino");
  });
});
