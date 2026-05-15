import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  comboGarbageAttack,
  comboTableAttackBonus,
  createRuleset,
  isHoldEnabled,
  multiplierComboAttack,
  toTetrioConfig,
  usesStaticGravity
} from "../src/application/create-ruleset";
import {
  CHEESE_LIMITS,
  COMBO_TABLE_OPTIONS,
  GARBAGE_OPTIONS,
  GRAVITY_OPTIONS,
  HOLD_MODES,
  KICK_TABLE_OPTIONS,
  SPIN_OPTIONS,
  STATIC_GRAVITY_LIMITS
} from "../src/domain/rules";
import {
  TETRIO_COMBO_ATTACK_TABLES,
  TETRIO_GARBAGE_ATTACK_TABLE,
  TETRIO_KICK_TABLES,
  TETRIO_SPIN_BONUS_RULES,
  TETRIO_TABLE_SOURCE,
  TETRIO_TL_OPTIONS
} from "../src/domain/tetrio-tables";

describe("TETR.IO-derived ruleset helpers", () => {
  test("keeps researched option labels and TETR.IO internal values together", () => {
    expect(HOLD_MODES).toEqual(["ON", "OFF"]);
    expect(SPIN_OPTIONS.map((option) => [option.value, option.tetrioValue])).toEqual([
      ["T-SPINS", "T-spins"],
      ["T-SPINS+", "T-spins+"],
      ["ALL-SPINS+", "all+"],
      ["ALL-SPINS", "all"],
      ["ALL-MINI+", "all-mini+"],
      ["ALL-MINI", "all-mini"],
      ["MINI-ONLY", "mini-only"],
      ["HANDHELD", "handheld"],
      ["STUPID", "stupid"],
      ["NONE", "none"]
    ]);
    expect(COMBO_TABLE_OPTIONS.map((option) => [option.value, option.tetrioValue])).toEqual([
      ["MULTIPLIER", "multiplier"],
      ["CLASSIC GUIDELINE", "classic guideline"],
      ["MODERN GUIDELINE", "modern guideline"],
      ["NONE", "none"]
    ]);
    expect(KICK_TABLE_OPTIONS.map((option) => [option.value, option.tetrioValue])).toEqual([
      ["SRS+", "SRS+"],
      ["SRS", "SRS"],
      ["SRS-X", "SRS-X"],
      ["TETRA-X", "TETRA-X"],
      ["NRS", "NRS"],
      ["ARS", "ARS"],
      ["ASC", "ASC"],
      ["NONE", "none"]
    ]);
    expect(GRAVITY_OPTIONS.map((option) => [option.value, option.tetrioValue])).toEqual([
      ["SUBZERO", "subzero"],
      ["OFF", "off"],
      ["RELAXED", "relaxed"],
      ["ENGAGING", "engaging"],
      ["SPICY", "spicy"],
      ["STATIC", "static"]
    ]);
    expect(GARBAGE_OPTIONS.map((option) => [option.value, option.tetrioValue])).toEqual([
      ["OFF", "off"],
      ["BACKFIRE 0.5X", "backfire_half"],
      ["BACKFIRE 1X", "backfire_full"],
      ["BACKFIRE 2X", "backfire_double"],
      ["UNCLEAR 0.5X", "unclear_half"],
      ["UNCLEAR 1X", "unclear_full"],
      ["UNCLEAR 2X", "unclear_double"],
      ["CHEESE LAYER", "cheeselayer"],
      ["CHEESE TIMER", "cheesetimer"]
    ]);
    expect(STATIC_GRAVITY_LIMITS).toEqual({ min: 0, max: 20, step: 0.1, default: 20 });
    expect(CHEESE_LIMITS).toEqual({
      layerHeight: { min: 0, max: 20, default: 6 },
      timerInterval: { min: 0.1, max: 60, step: 0.1, default: 4 },
      messinessPercent: { min: 0, max: 100, default: 100 }
    });
  });

  test("creates the base board and requested default helpers through native bitboard storage", () => {
    const ruleset = createRuleset();

    expect([...ruleset.baseBoard]).toEqual(new Array(20).fill(0));
    expect(isHoldEnabled(ruleset)).toBe(true);
    expect(usesStaticGravity(ruleset)).toBe(true);
    expect(ruleset).toMatchObject({
      hold: { mode: "ON", infinite: "OFF" },
      allow180: true,
      spins: "ALL-MINI+",
      comboTable: "MULTIPLIER",
      kickTable: "SRS+",
      gravity: { mode: "STATIC", staticGravity: 20 },
      garbage: { mode: "OFF", cheeseLayerHeight: 6, cheeseTimerInterval: 4, cheeseMessinessPercent: 100 }
    });
    expect(toTetrioConfig(ruleset)).toMatchObject({
      allow180: "on",
      spins: TETRIO_TL_OPTIONS.spinbonuses,
      combotable: TETRIO_TL_OPTIONS.combotable,
      kickset: TETRIO_TL_OPTIONS.kickset
    });
  });

  test("returns isolated default gravity and garbage objects", () => {
    const first = createRuleset();
    const second = createRuleset();

    expect(first.gravity).not.toBe(second.gravity);
    expect(first.garbage).not.toBe(second.garbage);

    (first.gravity as { staticGravity: number }).staticGravity = 0;
    (first.garbage as { cheeseLayerHeight: number }).cheeseLayerHeight = 0;

    expect(createRuleset().gravity.staticGravity).toBe(20);
    expect(createRuleset().garbage.cheeseLayerHeight).toBe(6);
  });

  test("accepts TETR.IO internal values and exports custom-room config keys", () => {
    const ruleset = createRuleset({
      hold: { mode: "ON", infinite: "ON" },
      allow180: false,
      spins: "all-mini+",
      comboTable: "classic guideline",
      kickTable: "SRS-X",
      gravity: { mode: "static", staticGravity: 12.5 },
      garbage: {
        mode: "cheesetimer",
        cheeseLayerHeight: 2,
        cheeseTimerInterval: 4,
        cheeseMessinessPercent: 75
      }
    });

    expect(toTetrioConfig(ruleset)).toEqual({
      hold: "on",
      infinite_hold: "on",
      allow180: "off",
      spins: "all-mini+",
      combotable: "classic guideline",
      kickset: "SRS-X",
      gravitymode: "static",
      gravitystatic: 12.5,
      garbagemode: "cheesetimer",
      cheeselayer_height: 2,
      cheesetimer_interval: 4,
      cheesemessiness: 75
    });
  });

  test("bounds gravity and garbage helper values to the live UI limits", () => {
    expect(() => createRuleset({ gravity: { mode: "STATIC", staticGravity: 20.1 } })).toThrow("between 0 and 20");
    expect(() => createRuleset({ garbage: { mode: "CHEESE LAYER", cheeseLayerHeight: 21 } })).toThrow("between 0 and 20");
    expect(() => createRuleset({ garbage: { mode: "CHEESE TIMER", cheeseTimerInterval: 0 } })).toThrow("between 0.1 and 60");
    expect(() => createRuleset({ garbage: { mode: "CHEESE TIMER", cheeseMessinessPercent: 101 } })).toThrow("between 0 and 100");
  });

  test("models TETR.IO combo garbage from the extracted client tables", () => {
    expect(TETRIO_TABLE_SOURCE.asset).toContain("/js/tetrio.js?hv=7eebfc9cd.987f91854aad.20260504T210001");
    expect(TETRIO_TL_OPTIONS).toMatchObject({
      allow180: true,
      spinbonuses: "all-mini+",
      kickset: "SRS+",
      combotable: "multiplier",
      b2bchaining: false,
      b2bcharging: true,
      allclear_garbage: 5,
      allclear_b2b: 1,
      roundmode: "down"
    });
    expect(TETRIO_COMBO_ATTACK_TABLES["classic guideline"]).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5]);
    expect(TETRIO_COMBO_ATTACK_TABLES["modern guideline"]).toEqual([0, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4]);

    expect(multiplierComboAttack(4, 3)).toBe(6);
    expect(multiplierComboAttack(0, 2)).toBe(0);
    expect(multiplierComboAttack(0, 3, "RAW")).toBe(Math.log1p(2.5));
    expect(comboTableAttackBonus("CLASSIC GUIDELINE", 12)).toBe(5);
    expect(comboTableAttackBonus("MODERN GUIDELINE", 12)).toBe(3);
    expect(comboGarbageAttack("CLASSIC GUIDELINE", 4, 12)).toBe(9);
  });

  test("rejects invalid combo garbage inputs before short-circuiting", () => {
    expect(() => comboGarbageAttack("MULTIPLIER", -1, 1)).toThrow("baseAttack must be a non-negative integer");
    expect(() => comboGarbageAttack("CLASSIC GUIDELINE", 4, 0.5)).toThrow("tetrioCombo must be a non-negative integer");
    expect(() => comboGarbageAttack("MODERN GUIDELINE", 1.5, 0)).toThrow("baseAttack must be a non-negative integer");
    expect(() => comboGarbageAttack("NONE", 0, -1)).toThrow("tetrioCombo must be a non-negative integer");
  });

  test("pins exact TETR.IO spin, garbage, and kick tables extracted from tetrio.js", () => {
    expect(TETRIO_SPIN_BONUS_RULES.handheld.types).toEqual(["t", "s", "z", "l", "j"]);
    expect(TETRIO_SPIN_BONUS_RULES["all-mini+"].types).toContain("oo");
    expect(TETRIO_GARBAGE_ATTACK_TABLE.TSPIN_QUAD).toBe(10);
    expect(TETRIO_GARBAGE_ATTACK_TABLE.COMBO_BONUS).toBe(0.25);
    expect(TETRIO_KICK_TABLES["SRS-X"].kicks["02"]).toEqual([
      [1, 0],
      [2, 0],
      [1, 1],
      [2, 1],
      [-1, 0],
      [-2, 0],
      [-1, 1],
      [-2, 1],
      [0, -1],
      [3, 0],
      [-3, 0]
    ]);
    expect(TETRIO_KICK_TABLES["TETRA-X"].color_overrides).toMatchObject({ i1: "l", o: "s", s: "i" });
    expect(TETRIO_KICK_TABLES.ASC.allow_o_kick).toBe(true);
  });

  test("pins the full extracted TETR.IO table payload", () => {
    const payload = JSON.stringify({
      combo: TETRIO_COMBO_ATTACK_TABLES,
      garbage: TETRIO_GARBAGE_ATTACK_TABLE,
      spins: TETRIO_SPIN_BONUS_RULES,
      kicks: TETRIO_KICK_TABLES,
      tl: TETRIO_TL_OPTIONS
    });

    expect(createHash("sha256").update(payload).digest("hex")).toBe("a63a33ab6e64345e1d0275c6f19b2a0f72e67659ae2bf265c3a6c9999d675f1d");
  });
});
