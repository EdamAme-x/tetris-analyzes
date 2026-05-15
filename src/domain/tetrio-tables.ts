export {
  TETRIO_COMBO_ATTACK_TABLES,
  TETRIO_GARBAGE_ATTACK_TABLE,
  TETRIO_KICK_TABLES,
  TETRIO_SCORING_TABLE,
  TETRIO_SPIN_BONUS_RULES,
  TETRIO_TABLE_SOURCE,
  TETRIO_TL_OPTIONS
} from "../generated/tetrio-tables.generated";

export type TetrioComboTableKey = keyof typeof import("../generated/tetrio-tables.generated").TETRIO_COMBO_ATTACK_TABLES;
export type TetrioSpinBonusRuleKey = keyof typeof import("../generated/tetrio-tables.generated").TETRIO_SPIN_BONUS_RULES;
export type TetrioKickTableKey = keyof typeof import("../generated/tetrio-tables.generated").TETRIO_KICK_TABLES;
export type TetrioTlOptionKey = keyof typeof import("../generated/tetrio-tables.generated").TETRIO_TL_OPTIONS;
