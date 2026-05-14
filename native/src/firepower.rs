use napi::bindgen_prelude::{Error, Result};

use crate::board::{self, BoardEvaluation, BoardRows};
use crate::spin::{SpinDetection, SpinKind};
use crate::tetrio_tables::{self, ClearKind, ComboTable};

#[derive(Clone, Copy)]
pub(crate) struct FirepowerState {
    pub(crate) attack: u32,
    pub(crate) points: u32,
    pub(crate) combo: u32,
    pub(crate) max_combo: u32,
    pub(crate) back_to_back_chain: u32,
    pub(crate) all_clears: u32,
}

#[derive(Clone, Copy)]
pub(crate) struct FirepowerEvent {
    pub(crate) clear_kind: ClearKind,
    pub(crate) attack: u32,
    pub(crate) base_attack: u32,
    pub(crate) points: u32,
    pub(crate) combo: u32,
    pub(crate) back_to_back: bool,
    pub(crate) back_to_back_bonus: f64,
    pub(crate) all_clear: bool,
    pub(crate) all_clear_bonus: u32,
}

impl FirepowerState {
    pub(crate) fn empty() -> Self {
        Self {
            attack: 0,
            points: 0,
            combo: 0,
            max_combo: 0,
            back_to_back_chain: 0,
            all_clears: 0,
        }
    }
}

impl FirepowerEvent {
    pub(crate) fn empty() -> Self {
        Self {
            clear_kind: ClearKind::None,
            attack: 0,
            base_attack: 0,
            points: 0,
            combo: 0,
            back_to_back: false,
            back_to_back_bonus: 0.0,
            all_clear: false,
            all_clear_bonus: 0,
        }
    }
}

pub(crate) fn score_state(metrics: BoardEvaluation, firepower: FirepowerState) -> f64 {
    firepower_score(firepower) + board_shape_score(metrics)
}

pub(crate) fn firepower_score(firepower: FirepowerState) -> f64 {
    firepower.attack as f64 * 1_000.0
        + firepower.points as f64 * 0.05
        + firepower.max_combo as f64 * 20.0
        + firepower.back_to_back_chain as f64 * 25.0
        + firepower.all_clears as f64 * 500.0
}

pub(crate) fn board_shape_score(metrics: BoardEvaluation) -> f64 {
    let cleared_lines = metrics[1] as f64;
    let aggregate_height = metrics[2] as f64;
    let holes = metrics[3] as f64;
    let bumpiness = metrics[4] as f64;
    cleared_lines * 120.0 - holes * 90.0 - aggregate_height * 2.2 - bumpiness * 7.0
}

pub(crate) fn advance_firepower(
    previous: FirepowerState,
    spin: SpinDetection,
    rows_after_clear: &BoardRows,
) -> (FirepowerState, FirepowerEvent) {
    let clear_kind = classify_clear(spin.kind, spin.cleared_lines);
    let all_clear = spin.cleared_lines > 0 && board::is_empty_rows(rows_after_clear);
    advance_firepower_for_clear(previous, clear_kind, spin.cleared_lines, all_clear)
}

pub(crate) fn advance_firepower_for_clear(
    previous: FirepowerState,
    clear_kind: ClearKind,
    cleared_lines: u32,
    all_clear: bool,
) -> (FirepowerState, FirepowerEvent) {
    advance_firepower_for_clear_with_combo_table(
        previous,
        clear_kind,
        cleared_lines,
        all_clear,
        ComboTable::Multiplier,
    )
}

pub(crate) fn advance_firepower_for_clear_with_combo_table(
    previous: FirepowerState,
    clear_kind: ClearKind,
    cleared_lines: u32,
    all_clear: bool,
    combo_table: ComboTable,
) -> (FirepowerState, FirepowerEvent) {
    let base_attack = clear_kind_attack(clear_kind);
    let mut attack = base_attack as f64;
    let mut points = clear_kind_points(clear_kind);
    let combo = if cleared_lines > 0 {
        previous.combo + 1
    } else {
        0
    };
    let max_combo = previous.max_combo.max(combo);
    let difficult = is_back_to_back_clear(clear_kind);
    let back_to_back_chain = if difficult {
        previous.back_to_back_chain + 1
    } else if cleared_lines > 0 {
        0
    } else {
        previous.back_to_back_chain
    };
    let back_to_back = difficult && back_to_back_chain > 1;
    let back_to_back_bonus = if back_to_back {
        back_to_back_chain_bonus(back_to_back_chain)
    } else {
        0.0
    };

    if back_to_back {
        attack += back_to_back_bonus;
        points = (points as f64 * tetrio_tables::BACK_TO_BACK_SCORE_MULTIPLIER).floor() as u32;
    }
    if combo > 1 {
        points += tetrio_tables::COMBO_SCORE * (combo - 1);
        attack = tetrio_tables::combo_table_attack(combo_table, attack, combo);
    }

    let all_clear_bonus = if all_clear {
        tetrio_tables::ALL_CLEAR_ATTACK
    } else {
        0
    };
    let all_clear_points = if all_clear {
        tetrio_tables::ALL_CLEAR_POINTS
    } else {
        0
    };
    let event_attack = attack.floor() as u32 + all_clear_bonus;
    let event_points = points + all_clear_points;
    let all_clears = previous.all_clears + u32::from(all_clear);

    (
        FirepowerState {
            attack: previous.attack + event_attack,
            points: previous.points + event_points,
            combo,
            max_combo,
            back_to_back_chain,
            all_clears,
        },
        FirepowerEvent {
            clear_kind,
            attack: event_attack,
            base_attack,
            points: event_points,
            combo,
            back_to_back,
            back_to_back_bonus,
            all_clear,
            all_clear_bonus,
        },
    )
}

pub(crate) fn classify_clear(spin_kind: SpinKind, cleared_lines: u32) -> ClearKind {
    match (spin_kind, cleared_lines) {
        (SpinKind::TSpinMini, 0) => ClearKind::TSpinMini,
        (SpinKind::TSpin, 0) => ClearKind::TSpin,
        (SpinKind::TSpinMini, 1) => ClearKind::TSpinMiniSingle,
        (SpinKind::TSpin, 1) => ClearKind::TSpinSingle,
        (SpinKind::TSpinMini, 2) => ClearKind::TSpinMiniDouble,
        (SpinKind::TSpin, 2) => ClearKind::TSpinDouble,
        (SpinKind::TSpinMini, 3) => ClearKind::TSpinMiniTriple,
        (SpinKind::TSpin, 3) => ClearKind::TSpinTriple,
        (SpinKind::TSpinMini, 4) => ClearKind::TSpinMiniQuad,
        (SpinKind::TSpin, 4) => ClearKind::TSpinQuad,
        (SpinKind::TSpin, _) if cleared_lines >= 5 => ClearKind::TSpinPenta,
        (_, 0) => ClearKind::None,
        (_, 1) => ClearKind::Single,
        (_, 2) => ClearKind::Double,
        (_, 3) => ClearKind::Triple,
        (_, 4) => ClearKind::Quad,
        _ => ClearKind::Penta,
    }
}

pub(crate) fn parse_clear_kind(input: &str) -> Result<ClearKind> {
    let normalized = input.trim().to_ascii_uppercase().replace(['-', ' '], "_");
    match normalized.as_str() {
        "NONE" => Ok(ClearKind::None),
        "SINGLE" => Ok(ClearKind::Single),
        "DOUBLE" => Ok(ClearKind::Double),
        "TRIPLE" => Ok(ClearKind::Triple),
        "QUAD" => Ok(ClearKind::Quad),
        "PENTA" => Ok(ClearKind::Penta),
        "TSPIN" | "T_SPIN" => Ok(ClearKind::TSpin),
        "TSPIN_MINI" | "T_SPIN_MINI" => Ok(ClearKind::TSpinMini),
        "TSPIN_MINI_SINGLE" | "T_SPIN_MINI_SINGLE" => Ok(ClearKind::TSpinMiniSingle),
        "TSPIN_SINGLE" | "T_SPIN_SINGLE" => Ok(ClearKind::TSpinSingle),
        "TSPIN_MINI_DOUBLE" | "T_SPIN_MINI_DOUBLE" => Ok(ClearKind::TSpinMiniDouble),
        "TSPIN_DOUBLE" | "T_SPIN_DOUBLE" => Ok(ClearKind::TSpinDouble),
        "TSPIN_MINI_TRIPLE" | "T_SPIN_MINI_TRIPLE" => Ok(ClearKind::TSpinMiniTriple),
        "TSPIN_TRIPLE" | "T_SPIN_TRIPLE" => Ok(ClearKind::TSpinTriple),
        "TSPIN_MINI_QUAD" | "T_SPIN_MINI_QUAD" => Ok(ClearKind::TSpinMiniQuad),
        "TSPIN_QUAD" | "T_SPIN_QUAD" => Ok(ClearKind::TSpinQuad),
        "TSPIN_PENTA" | "T_SPIN_PENTA" => Ok(ClearKind::TSpinPenta),
        _ => Err(Error::from_reason(format!(
            "Unknown opener firepower clear name {input}."
        ))),
    }
}

pub(crate) fn parse_combo_table(input: &str) -> Result<ComboTable> {
    let key = normalize_table_key(input);
    tetrio_tables::combo_table_from_key(&key)
        .ok_or_else(|| Error::from_reason(format!("Unknown opener firepower combo table {input}.")))
}

pub(crate) fn clear_kind_cleared_lines(kind: ClearKind) -> u32 {
    tetrio_tables::clear_kind_cleared_lines(kind)
}

pub(crate) fn clear_kind_name(kind: ClearKind) -> &'static str {
    tetrio_tables::clear_kind_name(kind)
}

fn clear_kind_attack(kind: ClearKind) -> u32 {
    tetrio_tables::clear_kind_attack(kind)
}

fn clear_kind_points(kind: ClearKind) -> u32 {
    tetrio_tables::clear_kind_points(kind)
}

fn is_back_to_back_clear(kind: ClearKind) -> bool {
    tetrio_tables::is_back_to_back_clear(kind)
}

fn back_to_back_chain_bonus(back_to_back_chain: u32) -> f64 {
    if back_to_back_chain <= 1 {
        return 0.0;
    }
    let chain = back_to_back_chain - 1;
    let value = 1.0 + ((chain as f64) * tetrio_tables::BACK_TO_BACK_BONUS_LOG).ln_1p();
    tetrio_tables::BACK_TO_BACK_BONUS
        * (value.floor() + if chain == 1 { 0.0 } else { value.fract() / 3.0 })
}

fn normalize_table_key(input: &str) -> String {
    input
        .trim()
        .to_ascii_lowercase()
        .replace(['-', '_'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
