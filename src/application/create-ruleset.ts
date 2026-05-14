import {
  CHEESE_LIMITS,
  COMBO_TABLE_OPTIONS,
  GARBAGE_OPTIONS,
  GRAVITY_OPTIONS,
  HOLD_MODES,
  KICK_TABLE_OPTIONS,
  SPIN_OPTIONS,
  STATIC_GRAVITY_LIMITS,
  type ComboTable,
  type GarbageMode,
  type GarbageRules,
  type GravityMode,
  type GravityRules,
  type HoldMode,
  type HoldRules,
  type KickTable,
  type Ruleset,
  type RulesetInput,
  type SpinMode,
  type TetrioConfig
} from "../domain/rules";
import { bitBoardFromRows, createEmptyBitBoard } from "../infrastructure/bitboard/native-bitboard";

type TetrioTables = typeof import("../domain/tetrio-tables");
type TetrioComboTableKey = keyof TetrioTables["TETRIO_COMBO_ATTACK_TABLES"];

const DEFAULT_HOLD: HoldRules = { mode: "ON", infinite: "OFF" };
const DEFAULT_GRAVITY: GravityRules = {
  mode: "STATIC",
  staticGravity: STATIC_GRAVITY_LIMITS.default
};
const DEFAULT_GARBAGE: GarbageRules = {
  mode: "OFF",
  cheeseLayerHeight: CHEESE_LIMITS.layerHeight.default,
  cheeseTimerInterval: CHEESE_LIMITS.timerInterval.default,
  cheeseMessinessPercent: CHEESE_LIMITS.messinessPercent.default
};
let cachedTetrioTables: TetrioTables | undefined;

export function createRuleset(input: RulesetInput = {}): Ruleset {
  return {
    baseBoard: input.baseBoard === undefined ? createEmptyBitBoard() : bitBoardFromRows(input.baseBoard),
    hold: normalizeHold(input.hold, input.infiniteHold),
    spins: normalizeOption(input.spins ?? "T-SPINS", SPIN_OPTIONS, "spins"),
    comboTable: normalizeOption(input.comboTable ?? "MULTIPLIER", COMBO_TABLE_OPTIONS, "comboTable"),
    kickTable: normalizeOption(input.kickTable ?? "SRS+", KICK_TABLE_OPTIONS, "kickTable"),
    gravity: normalizeGravity(input.gravity),
    garbage: normalizeGarbage(input.garbage)
  };
}

export function isHoldEnabled(ruleset: Pick<Ruleset, "hold">): boolean {
  return ruleset.hold.mode === "ON";
}

export function usesStaticGravity(ruleset: Pick<Ruleset, "gravity">): boolean {
  return ruleset.gravity.mode === "STATIC";
}

export function toTetrioConfig(ruleset: Ruleset): TetrioConfig {
  return {
    hold: toOnOffValue(ruleset.hold.mode),
    infinite_hold: toOnOffValue(ruleset.hold.infinite),
    spins: getTetrioValue(ruleset.spins, SPIN_OPTIONS, "spins"),
    combotable: getTetrioValue(ruleset.comboTable, COMBO_TABLE_OPTIONS, "comboTable"),
    kickset: getTetrioValue(ruleset.kickTable, KICK_TABLE_OPTIONS, "kickTable"),
    gravitymode: getTetrioValue(ruleset.gravity.mode, GRAVITY_OPTIONS, "gravity.mode"),
    gravitystatic: ruleset.gravity.staticGravity,
    garbagemode: getTetrioValue(ruleset.garbage.mode, GARBAGE_OPTIONS, "garbage.mode"),
    cheeselayer_height: ruleset.garbage.cheeseLayerHeight,
    cheesetimer_interval: ruleset.garbage.cheeseTimerInterval,
    cheesemessiness: ruleset.garbage.cheeseMessinessPercent
  };
}

export function comboGarbageAttack(comboTable: ComboTable, baseAttack: number, tetrioCombo: number, rounding: "DOWN" | "RAW" = "DOWN"): number {
  assertNonNegativeInteger(baseAttack, "baseAttack");
  assertNonNegativeInteger(tetrioCombo, "tetrioCombo");

  if (tetrioCombo <= 1) {
    return baseAttack;
  }
  if (comboTable === "MULTIPLIER") {
    return multiplierComboAttack(baseAttack, tetrioCombo, rounding);
  }
  return roundAttack(baseAttack + comboTableAttackBonus(comboTable, tetrioCombo), rounding);
}

export function comboTableAttackBonus(comboTable: Exclude<ComboTable, "MULTIPLIER">, tetrioCombo: number): number {
  assertNonNegativeInteger(tetrioCombo, "tetrioCombo");
  if (tetrioCombo <= 1) {
    return 0;
  }

  const table = loadTetrioTables().TETRIO_COMBO_ATTACK_TABLES[toComboTableKey(comboTable)];
  const index = Math.max(0, Math.min(tetrioCombo - 2, table.length - 1));
  return table[index] ?? 0;
}

export function multiplierComboAttack(baseAttack: number, tetrioCombo: number, rounding: "DOWN" | "RAW" = "DOWN"): number {
  assertNonNegativeInteger(baseAttack, "baseAttack");
  assertNonNegativeInteger(tetrioCombo, "tetrioCombo");

  let attack = baseAttack;
  const garbageAttackTable = loadTetrioTables().TETRIO_GARBAGE_ATTACK_TABLE;
  if (tetrioCombo > 1) {
    attack *= 1 + garbageAttackTable.COMBO_BONUS * (tetrioCombo - 1);
  }
  if (tetrioCombo > 2) {
    attack = Math.max(
      Math.log1p(garbageAttackTable.COMBO_MINIFIER * (tetrioCombo - 1) * garbageAttackTable.COMBO_MINIFIER_LOG),
      attack
    );
  }

  return roundAttack(attack, rounding);
}

function normalizeHold(value: RulesetInput["hold"], infiniteHold: RulesetInput["infiniteHold"]): HoldRules {
  if (value === undefined || typeof value === "boolean" || typeof value === "string") {
    return {
      mode: normalizeHoldMode(value ?? DEFAULT_HOLD.mode, "hold"),
      infinite: normalizeHoldMode(infiniteHold ?? DEFAULT_HOLD.infinite, "infiniteHold")
    };
  }

  return {
    mode: normalizeHoldMode(value.mode ?? DEFAULT_HOLD.mode, "hold.mode"),
    infinite: normalizeHoldMode(infiniteHold ?? value.infinite ?? DEFAULT_HOLD.infinite, "hold.infinite")
  };
}

function normalizeHoldMode(value: HoldMode | boolean, label: string): HoldMode {
  if (typeof value === "boolean") {
    return value ? "ON" : "OFF";
  }
  return normalizeOption(value, HOLD_MODES.map((mode) => ({ value: mode, tetrioValue: toOnOffValue(mode) })), label);
}

function normalizeGravity(value: RulesetInput["gravity"]): GravityRules {
  if (value === undefined) {
    return { ...DEFAULT_GRAVITY };
  }
  if (typeof value === "string") {
    return {
      mode: normalizeOption(value, GRAVITY_OPTIONS, "gravity"),
      staticGravity: DEFAULT_GRAVITY.staticGravity
    };
  }

  const mode = normalizeOption(value.mode ?? DEFAULT_GRAVITY.mode, GRAVITY_OPTIONS, "gravity.mode");
  const staticGravity = value.staticGravity ?? DEFAULT_GRAVITY.staticGravity;
  assertInRange(staticGravity, STATIC_GRAVITY_LIMITS.min, STATIC_GRAVITY_LIMITS.max, "gravity.staticGravity");
  return { mode, staticGravity };
}

function normalizeGarbage(value: RulesetInput["garbage"]): GarbageRules {
  if (value === undefined) {
    return { ...DEFAULT_GARBAGE };
  }
  if (typeof value === "boolean") {
    return { ...DEFAULT_GARBAGE, mode: value ? "UNCLEAR 1X" : "OFF" };
  }
  if (typeof value === "string") {
    return { ...DEFAULT_GARBAGE, mode: normalizeOption(value, GARBAGE_OPTIONS, "garbage") };
  }

  const mode = normalizeOption(value.mode ?? DEFAULT_GARBAGE.mode, GARBAGE_OPTIONS, "garbage.mode");
  const cheeseLayerHeight = value.cheeseLayerHeight ?? DEFAULT_GARBAGE.cheeseLayerHeight;
  const cheeseTimerInterval = value.cheeseTimerInterval ?? DEFAULT_GARBAGE.cheeseTimerInterval;
  const cheeseMessinessPercent = value.cheeseMessinessPercent ?? DEFAULT_GARBAGE.cheeseMessinessPercent;
  assertInRange(cheeseLayerHeight, CHEESE_LIMITS.layerHeight.min, CHEESE_LIMITS.layerHeight.max, "garbage.cheeseLayerHeight");
  assertInRange(cheeseTimerInterval, CHEESE_LIMITS.timerInterval.min, CHEESE_LIMITS.timerInterval.max, "garbage.cheeseTimerInterval");
  assertInRange(cheeseMessinessPercent, CHEESE_LIMITS.messinessPercent.min, CHEESE_LIMITS.messinessPercent.max, "garbage.cheeseMessinessPercent");
  return { mode, cheeseLayerHeight, cheeseTimerInterval, cheeseMessinessPercent };
}

function normalizeOption<T extends string>(
  value: string,
  options: readonly { readonly value: T; readonly tetrioValue: string }[],
  label: string
): T {
  const normalized = value.toLowerCase();
  const option = options.find((candidate) => {
    return candidate.value.toLowerCase() === normalized || candidate.tetrioValue.toLowerCase() === normalized;
  });
  if (option !== undefined) {
    return option.value;
  }
  throw new Error(`${label} must be one of ${options.map((candidate) => candidate.value).join(", ")}, got ${value}.`);
}

function getTetrioValue<T extends string>(
  value: T,
  options: readonly { readonly value: T; readonly tetrioValue: string }[],
  label: string
): string {
  const option = options.find((candidate) => candidate.value === value);
  if (option === undefined) {
    throw new Error(`Unknown ${label} value ${value}.`);
  }
  return option.tetrioValue;
}

function toOnOffValue(value: HoldMode): "on" | "off" {
  return value === "ON" ? "on" : "off";
}

function toComboTableKey(comboTable: Exclude<ComboTable, "MULTIPLIER">): TetrioComboTableKey {
  switch (comboTable) {
    case "CLASSIC GUIDELINE":
      return "classic guideline";
    case "MODERN GUIDELINE":
      return "modern guideline";
    case "NONE":
      return "none";
  }
}

function loadTetrioTables(): TetrioTables {
  cachedTetrioTables ??= require("../domain/tetrio-tables") as TetrioTables;
  return cachedTetrioTables;
}

function roundAttack(attack: number, rounding: "DOWN" | "RAW"): number {
  return rounding === "RAW" ? attack : Math.floor(attack);
}

function assertInRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}, got ${value}.`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer, got ${value}.`);
  }
}
