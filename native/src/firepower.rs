use napi::bindgen_prelude::{Error, Result};

use crate::board::{self, BoardEvaluation, BoardRows, BOARD_HEIGHT, BOARD_WIDTH};
use crate::movement::{can_place, is_reachable_placement_with_cache, lock_shape, ReachabilityCache};
use crate::pieces::{piece_shapes, placement_shape_indices, Piece};
use crate::spin::{detect_spin, SpinDetection, SpinKind};
use crate::tetrio_tables::KickTable;
use crate::tetrio_tables::{self, ClearKind, ComboTable};

#[derive(Clone, Copy)]
pub(crate) struct FirepowerState {
    pub(crate) attack: u32,
    pub(crate) points: u32,
    pub(crate) combo: u32,
    pub(crate) max_combo: u32,
    pub(crate) back_to_back_chain: u32,
    pub(crate) all_clears: u32,
    pub(crate) difficult_clears: u32,
    pub(crate) difficult_attack: u32,
    pub(crate) t_spin_clears: u32,
    pub(crate) t_spin_attack: u32,
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
            difficult_clears: 0,
            difficult_attack: 0,
            t_spin_clears: 0,
            t_spin_attack: 0,
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

pub(crate) fn score_state(
    metrics: BoardEvaluation,
    firepower: FirepowerState,
    t_spin_potential: u32,
) -> f64 {
    firepower_score(firepower)
        + t_spin_setup_score(t_spin_potential, firepower.back_to_back_chain)
        + board_shape_score(metrics)
}

pub(crate) fn firepower_score(firepower: FirepowerState) -> f64 {
    firepower.attack as f64 * 1_000.0
        + firepower.difficult_attack as f64 * 900.0
        + firepower.t_spin_attack as f64 * 1_500.0
        + firepower.t_spin_clears as f64 * 3_000.0
        + firepower.difficult_clears as f64 * 1_750.0
        + firepower.points as f64 * 0.05
        + firepower.max_combo as f64 * 20.0
        + b2b_chain_score(firepower.back_to_back_chain)
        + firepower.all_clears as f64 * 500.0
}

pub(crate) fn quad_well_continuation_score(quad_well_potential: u32, back_to_back_chain: u32) -> f64 {
    if quad_well_potential == 0 || back_to_back_chain == 0 {
        return 0.0;
    }

    f64::from(quad_well_potential) * (650.0 + f64::from(back_to_back_chain.min(5)) * 220.0)
}

pub(crate) fn board_shape_score(metrics: BoardEvaluation) -> f64 {
    let cleared_lines = metrics[1] as f64;
    let aggregate_height = metrics[2] as f64;
    let holes = metrics[3] as f64;
    let bumpiness = metrics[4] as f64;
    cleared_lines * 120.0 - holes * 90.0 - aggregate_height * 2.2 - bumpiness * 7.0
}

fn t_spin_setup_score(t_spin_potential: u32, back_to_back_chain: u32) -> f64 {
    if t_spin_potential == 0 {
        return 0.0;
    }

    let potential = f64::from(t_spin_potential);
    let base = potential * 2_200.0;
    if back_to_back_chain == 0 {
        return base;
    }

    let chain_bonus = f64::from(back_to_back_chain.min(5)) * 450.0;
    base + potential * (1_800.0 + chain_bonus)
}

pub(crate) fn estimate_t_spin_potential(rows: &BoardRows, kick_table: KickTable) -> u32 {
    let mut best = 0_u32;
    let shapes = piece_shapes(Piece::T);
    let mut reachable_cache = ReachabilityCache::new(rows, Piece::T);
    for shape_index in placement_shape_indices(Piece::T).iter().copied() {
        let shape = shapes[shape_index];
        for x in 0..=(BOARD_WIDTH as i8 - shape.width) {
            let mut can_place_below = false;
            for y in 0..=(BOARD_HEIGHT as i8 - shape.height) {
                let can_place_here = can_place(rows, shape, x, y);
                if !can_place_here || can_place_below {
                    can_place_below = can_place_here;
                    continue;
                }
                let Some(placed) = lock_shape(rows, shape, x, y) else {
                    can_place_below = can_place_here;
                    continue;
                };
                let cleared_lines = board::count_full_lines_array(&placed);
                let spin = detect_spin(&placed, Piece::T, shape, x, y, cleared_lines);
                let value = match spin.kind {
                    SpinKind::TSpin => 1 + cleared_lines,
                    SpinKind::TSpinMini if cleared_lines > 0 => 1,
                    SpinKind::None | SpinKind::TSpinMini | SpinKind::ImmobileSpin => 0,
                };
                if value > best
                    && is_reachable_placement_with_cache(
                        rows,
                        Piece::T,
                        shape_index,
                        x,
                        y,
                        kick_table,
                        &mut reachable_cache,
                    )
                {
                    best = value;
                }
                can_place_below = can_place_here;
            }
        }
    }
    best
}

pub(crate) fn estimate_quad_well_potential(rows: &BoardRows) -> u32 {
    let mut best = 0_u32;
    for well_x in 0..BOARD_WIDTH {
        let well_mask = 1_u16 << well_x;
        let mut clean_rows = 0_u32;
        for row in rows.iter().take(4).copied() {
            if row & well_mask == 0 && (row & !well_mask).count_ones() >= 6 {
                clean_rows += 1;
            }
        }
        best = best.max(clean_rows);
    }
    best
}

pub(crate) fn advance_firepower_with_combo_table(
    previous: FirepowerState,
    spin: SpinDetection,
    rows_after_clear: &BoardRows,
    combo_table: ComboTable,
) -> (FirepowerState, FirepowerEvent) {
    let clear_kind = classify_clear(spin.kind, spin.cleared_lines);
    let all_clear = spin.cleared_lines > 0 && board::is_empty_rows(rows_after_clear);
    advance_firepower_for_clear_with_combo_table(
        previous,
        clear_kind,
        spin.cleared_lines,
        all_clear,
        combo_table,
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
    let difficult_clear = is_back_to_back_clear(clear_kind) && cleared_lines > 0;
    let t_spin_clear = is_real_t_spin_line_clear(clear_kind);

    (
        FirepowerState {
            attack: previous.attack + event_attack,
            points: previous.points + event_points,
            combo,
            max_combo,
            back_to_back_chain,
            all_clears,
            difficult_clears: previous.difficult_clears + u32::from(difficult_clear),
            difficult_attack: previous.difficult_attack
                + if difficult_clear { event_attack } else { 0 },
            t_spin_clears: previous.t_spin_clears + u32::from(t_spin_clear),
            t_spin_attack: previous.t_spin_attack + if t_spin_clear { event_attack } else { 0 },
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

fn is_real_t_spin_line_clear(kind: ClearKind) -> bool {
    matches!(
        kind,
        ClearKind::TSpinSingle
            | ClearKind::TSpinDouble
            | ClearKind::TSpinTriple
            | ClearKind::TSpinQuad
            | ClearKind::TSpinPenta
    )
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

fn b2b_chain_score(back_to_back_chain: u32) -> f64 {
    let continuations = back_to_back_chain.saturating_sub(1) as f64;
    continuations * 900.0 + continuations * continuations * 100.0
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

#[cfg(test)]
mod tests {
    use super::*;

    fn flat_metrics() -> BoardEvaluation {
        [0, 0, 0, 0, 0]
    }

    #[test]
    fn tracks_difficult_attack_separately_from_plain_attack() {
        let (double_state, double_event) = advance_firepower_for_clear_with_combo_table(
            FirepowerState::empty(),
            ClearKind::Double,
            2,
            false,
            ComboTable::Multiplier,
        );
        let (quad_state, quad_event) = advance_firepower_for_clear_with_combo_table(
            FirepowerState::empty(),
            ClearKind::Quad,
            4,
            false,
            ComboTable::Multiplier,
        );

        assert_eq!(double_event.attack, 1);
        assert_eq!(double_state.difficult_attack, 0);
        assert_eq!(quad_event.attack, 4);
        assert_eq!(quad_state.difficult_attack, 4);
        assert!(firepower_score(quad_state) > firepower_score(double_state) * 4.0);
    }

    #[test]
    fn active_b2b_chain_increases_t_spin_setup_value() {
        let quiet = FirepowerState::empty();
        let mut b2b_ready = FirepowerState::empty();
        b2b_ready.back_to_back_chain = 1;

        let quiet_setup_delta =
            score_state(flat_metrics(), quiet, 2) - score_state(flat_metrics(), quiet, 0);
        let b2b_setup_delta =
            score_state(flat_metrics(), b2b_ready, 2) - score_state(flat_metrics(), b2b_ready, 0);

        assert!(b2b_setup_delta > quiet_setup_delta * 1.8);
    }

    #[test]
    fn scores_quad_wells_only_as_b2b_continuation() {
        let mut rows = [0_u16; BOARD_HEIGHT];
        for row in rows.iter_mut().take(4) {
            *row = 0b1111111111 ^ (1 << 9);
        }

        assert_eq!(estimate_quad_well_potential(&rows), 4);
        assert_eq!(quad_well_continuation_score(4, 0), 0.0);
        assert!(quad_well_continuation_score(4, 2) > quad_well_continuation_score(2, 2));
    }
}
