export const HOLD_MODES = ["ON", "OFF"] as const;

export const SPIN_OPTIONS = [
  {
    value: "T-SPINS",
    tetrioValue: "T-spins",
    title: "Receive bonuses for spinning T-pieces.",
    rewards: "t-spins"
  },
  {
    value: "T-SPINS+",
    tetrioValue: "T-spins+",
    title: "Receive bonuses for spinning T-pieces. Allows immobile T-piece to count as a Mini.",
    rewards: "t-spins",
    immobileTMini: true
  },
  {
    value: "ALL-SPINS+",
    tetrioValue: "all+",
    title: "Receive bonuses for spinning all pieces. Allows immobile T-piece to count as a Mini.",
    rewards: "all-spins",
    immobileTMini: true
  },
  {
    value: "ALL-SPINS",
    tetrioValue: "all",
    title: "Receive bonuses for spinning all pieces.",
    rewards: "all-spins"
  },
  {
    value: "ALL-MINI+",
    tetrioValue: "all-mini+",
    title:
      "Receive bonuses for spinning T-pieces, receive Back-to-Back for spinning all other pieces. Allows immobile T-piece to count as a Mini.",
    rewards: "t-spins-with-non-t-b2b",
    immobileTMini: true
  },
  {
    value: "ALL-MINI",
    tetrioValue: "all-mini",
    title: "Receive bonuses for spinning T-pieces, receive Back-to-Back for spinning all other pieces.",
    rewards: "t-spins-with-non-t-b2b"
  },
  {
    value: "MINI-ONLY",
    tetrioValue: "mini-only",
    title: "Receive Back-to-Back for spinning all other pieces.",
    rewards: "non-t-b2b-only"
  },
  {
    value: "HANDHELD",
    tetrioValue: "handheld",
    title: "Receive bonuses for spinning all pieces. Non T-Spin attacks are halved. Pieces use 4-corner detection.",
    rewards: "all-spins",
    nonTAttackMultiplier: 0.5,
    fourCornerDetection: true
  },
  {
    value: "STUPID",
    tetrioValue: "stupid",
    title: "Everything is a spin because YEAH WHY NOT (O-spin SUPPORTED!).",
    rewards: "everything"
  },
  {
    value: "NONE",
    tetrioValue: "none",
    title: "Receive no spin bonuses.",
    rewards: "none"
  }
] as const;

export const COMBO_TABLE_OPTIONS = [
  { value: "MULTIPLIER", tetrioValue: "multiplier", title: "TETR.IO's combo multiplier." },
  { value: "CLASSIC GUIDELINE", tetrioValue: "classic guideline", title: "Classic guideline combo table." },
  { value: "MODERN GUIDELINE", tetrioValue: "modern guideline", title: "Modern guideline combo table." },
  { value: "NONE", tetrioValue: "none", title: "Disable combo chaining." }
] as const;

export const KICK_TABLE_OPTIONS = [
  { value: "SRS+", tetrioValue: "SRS+", title: "The default natural rotation system with symmetric I-piece rotation." },
  { value: "SRS", tetrioValue: "SRS", title: "The standard natural rotation system." },
  { value: "SRS-X", tetrioValue: "SRS-X", title: "SRS with more powerful 180 spins." },
  { value: "TETRA-X", tetrioValue: "TETRA-X", title: "Novel rotation system by DR OCELOT." },
  { value: "NRS", tetrioValue: "NRS", title: "The classic rotation system." },
  { value: "ARS", tetrioValue: "ARS", title: "Rotation system used in arcade games." },
  { value: "ASC", tetrioValue: "ASC", title: "Permissive rotation system by WINTERNEBS." },
  { value: "NONE", tetrioValue: "none", title: "No kicks possible." }
] as const;

export const GRAVITY_OPTIONS = [
  { value: "SUBZERO", tetrioValue: "subzero", title: "No gravity and infinite movement." },
  { value: "OFF", tetrioValue: "off", title: "No gravity." },
  { value: "RELAXED", tetrioValue: "relaxed", title: "Relaxing, low gravity that increases a little throughout the level." },
  { value: "ENGAGING", tetrioValue: "engaging", title: "Engaging, medium level gravity that increases throughout the level." },
  { value: "SPICY", tetrioValue: "spicy", title: "Fast gravity that increases throughout the level." },
  { value: "STATIC", tetrioValue: "static", title: "Static custom gravity." }
] as const;

export const GARBAGE_OPTIONS = [
  { value: "OFF", tetrioValue: "off", title: "No garbage.", multiplier: 0 },
  { value: "BACKFIRE 0.5X", tetrioValue: "backfire_half", title: "Half your attack power is sent back to you.", multiplier: 0.5 },
  { value: "BACKFIRE 1X", tetrioValue: "backfire_full", title: "All your attack power is sent back to you.", multiplier: 1 },
  { value: "BACKFIRE 2X", tetrioValue: "backfire_double", title: "Double your attack power is sent back to you.", multiplier: 2 },
  {
    value: "UNCLEAR 0.5X",
    tetrioValue: "unclear_half",
    title: "Half your attack power is immediately pushed onto your board.",
    multiplier: 0.5
  },
  {
    value: "UNCLEAR 1X",
    tetrioValue: "unclear_full",
    title: "All your attack power is immediately pushed onto your board.",
    multiplier: 1
  },
  {
    value: "UNCLEAR 2X",
    tetrioValue: "unclear_double",
    title: "Double your attack power is immediately pushed onto your board.",
    multiplier: 2
  },
  { value: "CHEESE LAYER", tetrioValue: "cheeselayer", title: "A static layer of cheese is added onto your board." },
  { value: "CHEESE TIMER", tetrioValue: "cheesetimer", title: "One line of cheese is sent periodically." }
] as const;

export const STATIC_GRAVITY_LIMITS = {
  min: 0,
  max: 20,
  step: 0.1,
  default: 20
} as const;

export const CHEESE_LIMITS = {
  layerHeight: { min: 0, max: 20, default: 6 },
  timerInterval: { min: 0.1, max: 60, step: 0.1, default: 4 },
  messinessPercent: { min: 0, max: 100, default: 100 }
} as const;

export type HoldMode = (typeof HOLD_MODES)[number];
export type SpinMode = (typeof SPIN_OPTIONS)[number]["value"];
export type ComboTable = (typeof COMBO_TABLE_OPTIONS)[number]["value"];
export type KickTable = (typeof KICK_TABLE_OPTIONS)[number]["value"];
export type GravityMode = (typeof GRAVITY_OPTIONS)[number]["value"];
export type GarbageMode = (typeof GARBAGE_OPTIONS)[number]["value"];

export interface HoldRules {
  readonly mode: HoldMode;
  readonly infinite: HoldMode;
}

export interface GravityRules {
  readonly mode: GravityMode;
  readonly staticGravity: number;
}

export interface GarbageRules {
  readonly mode: GarbageMode;
  readonly cheeseLayerHeight: number;
  readonly cheeseTimerInterval: number;
  readonly cheeseMessinessPercent: number;
}

export interface Ruleset {
  readonly baseBoard: Uint16Array;
  readonly hold: HoldRules;
  readonly spins: SpinMode;
  readonly comboTable: ComboTable;
  readonly kickTable: KickTable;
  readonly gravity: GravityRules;
  readonly garbage: GarbageRules;
}

export interface RulesetInput {
  readonly baseBoard?: ArrayLike<number>;
  readonly hold?: HoldMode | boolean | HoldRulesInput;
  readonly infiniteHold?: HoldMode | boolean;
  readonly spins?: SpinMode | string;
  readonly comboTable?: ComboTable | string;
  readonly kickTable?: KickTable | string;
  readonly gravity?: GravityMode | string | GravityRulesInput;
  readonly garbage?: GarbageMode | string | boolean | GarbageRulesInput;
}

export interface HoldRulesInput {
  readonly mode?: HoldMode | boolean;
  readonly infinite?: HoldMode | boolean;
}

export interface GravityRulesInput {
  readonly mode?: GravityMode | string;
  readonly staticGravity?: number;
}

export interface GarbageRulesInput {
  readonly mode?: GarbageMode | string;
  readonly cheeseLayerHeight?: number;
  readonly cheeseTimerInterval?: number;
  readonly cheeseMessinessPercent?: number;
}

export interface TetrioConfig {
  readonly hold: "on" | "off";
  readonly infinite_hold: "on" | "off";
  readonly spins: string;
  readonly combotable: string;
  readonly kickset: string;
  readonly gravitymode: string;
  readonly gravitystatic: number;
  readonly garbagemode: string;
  readonly cheeselayer_height: number;
  readonly cheesetimer_interval: number;
  readonly cheesemessiness: number;
}
