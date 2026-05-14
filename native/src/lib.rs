use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::HashMap;

mod bag;
mod board;
mod firepower;
mod fumen;
mod movement;
mod pieces;
mod spin;
mod tetrio_tables;

use bag::{evaluate_opener_bag_internal, OpenerBagEvaluation};
use board::{BoardEvaluation, BoardRows, BOARD_HEIGHT, BOARD_WIDTH};
use firepower::{
    advance_firepower_for_clear_with_combo_table, advance_firepower_with_combo_table,
    clear_kind_cleared_lines, clear_kind_name, estimate_t_spin_potential,
    estimate_t_spin_surface_potential, firepower_score, parse_clear_kind, parse_combo_table,
    score_state, FirepowerEvent, FirepowerState,
};
use movement::{can_place, is_reachable_placement, lock_shape, parse_kick_table};
use pieces::{
    format_placement, parse_piece_string, parse_queue, piece_name, piece_shapes,
    placement_shape_indices, Cell, Piece, Shape,
};
use spin::{
    apply_spin_mode, detect_spin, parse_spin_mode, spin_kind_name, SpinDetection, SpinMode,
};
use tetrio_tables::{ComboTable, KickTable};

#[derive(Clone)]
pub(crate) struct SearchState {
    rows: BoardRows,
    hold: Option<Piece>,
    queue_index: usize,
    pub(crate) path: Vec<String>,
    placements: Vec<Placement>,
    pub(crate) score: f64,
    pub(crate) metrics: BoardEvaluation,
    pub(crate) firepower: FirepowerState,
    pub(crate) t_spin_potential: u32,
}

#[derive(Eq, Hash, PartialEq)]
struct SearchKey {
    rows: BoardRows,
    hold: Option<Piece>,
    queue_index: usize,
    combo: u32,
    back_to_back_chain: u32,
}

#[derive(Clone)]
struct Placement {
    piece: Piece,
    rotation: u8,
    x: i8,
    y: i8,
    used_hold: bool,
    cells: Vec<Cell>,
    spin: SpinDetection,
    firepower: FirepowerEvent,
}

struct PlacedBoard {
    rows: BoardRows,
    y: i8,
    spin: SpinDetection,
    placement: Option<Placement>,
}

#[derive(Clone, Copy)]
struct PieceChoice {
    piece: Piece,
    hold: Option<Piece>,
    queue_index: usize,
    used_hold: bool,
}

#[napi(object)]
pub struct BeamSearchNode {
    pub score: f64,
    pub firepower_score: f64,
    pub depth: u32,
    pub queue_index: u32,
    pub hold: Option<String>,
    pub rows: Vec<u16>,
    pub path: Vec<String>,
    pub placements: Vec<BeamPlacement>,
    pub attack: u32,
    pub points: u32,
    pub max_combo: u32,
    pub back_to_back_chain: u32,
    pub all_clears: u32,
    pub difficult_clears: u32,
    pub t_spin_clears: u32,
    pub t_spin_attack: u32,
    pub t_spin_potential: u32,
    pub occupied_cells: u32,
    pub cleared_lines: u32,
    pub aggregate_height: u32,
    pub holes: u32,
    pub bumpiness: u32,
}

#[napi(object)]
pub struct BeamPlacementCell {
    pub x: i32,
    pub y: i32,
}

#[napi(object)]
pub struct BeamPlacement {
    pub piece: String,
    pub rotation: u32,
    pub x: i32,
    pub y: i32,
    pub used_hold: bool,
    pub cells: Vec<BeamPlacementCell>,
    pub path: String,
    pub spin_kind: String,
    pub spin: bool,
    pub mini: bool,
    pub immobile: bool,
    pub occupied_corners: u32,
    pub cleared_lines: u32,
    pub clear_name: String,
    pub attack: u32,
    pub base_attack: u32,
    pub points: u32,
    pub combo: u32,
    pub back_to_back: bool,
    pub back_to_back_bonus: f64,
    pub all_clear: bool,
    pub all_clear_bonus: u32,
}

#[napi(object)]
pub struct BeamSpinDetection {
    pub kind: String,
    pub spin: bool,
    pub mini: bool,
    pub immobile: bool,
    pub occupied_corners: u32,
    pub cleared_lines: u32,
}

#[napi(object)]
pub struct BeamFirepowerInput {
    pub clear_name: String,
    pub all_clear: Option<bool>,
    pub combo_table: Option<String>,
}

#[napi(object)]
pub struct BeamFirepowerEvent {
    pub clear_name: String,
    pub attack: u32,
    pub base_attack: u32,
    pub points: u32,
    pub combo: u32,
    pub back_to_back: bool,
    pub back_to_back_bonus: f64,
    pub all_clear: bool,
    pub all_clear_bonus: u32,
}

#[napi(object)]
pub struct BeamFirepowerSummary {
    pub attack: u32,
    pub points: u32,
    pub combo: u32,
    pub max_combo: u32,
    pub back_to_back_chain: u32,
    pub all_clears: u32,
    pub firepower_score: f64,
    pub events: Vec<BeamFirepowerEvent>,
}

#[napi(js_name = "createEmptyBoard")]
pub fn create_empty_board() -> Uint16Array {
    board::create_empty_board().into()
}

#[napi(js_name = "copyBoardRows")]
pub fn copy_board_rows(rows: Uint16Array) -> Result<Uint16Array> {
    Ok(board::copy_board_rows(rows.as_ref())?.into())
}

#[napi(js_name = "isPerfectClear")]
pub fn is_perfect_clear(rows: Uint16Array) -> Result<bool> {
    board::is_perfect_clear(rows.as_ref())
}

#[napi(js_name = "countOccupiedCells")]
pub fn count_occupied_cells(rows: Uint16Array) -> Result<u32> {
    board::count_occupied_cells(rows.as_ref())
}

#[napi(js_name = "clearFullLines")]
pub fn clear_full_lines(rows: Uint16Array) -> Result<Uint16Array> {
    Ok(board::clear_full_lines(rows.as_ref())?.into())
}

#[napi(js_name = "batchCountOccupiedCells")]
pub fn batch_count_occupied_cells(rows: Uint16Array, board_count: u32) -> Result<Uint32Array> {
    Ok(board::batch_count_occupied_cells(rows.as_ref(), board_count)?.into())
}

#[napi(js_name = "batchClearFullLines")]
pub fn batch_clear_full_lines(rows: Uint16Array, board_count: u32) -> Result<Uint16Array> {
    Ok(board::batch_clear_full_lines(rows.as_ref(), board_count)?.into())
}

#[napi(js_name = "batchEvaluateBoards")]
pub fn batch_evaluate_boards(rows: Uint16Array, board_count: u32) -> Result<Uint32Array> {
    Ok(board::batch_evaluate_boards(rows.as_ref(), board_count)?.into())
}

#[napi(js_name = "createGarbageRows")]
pub fn create_garbage_rows(holes: Uint8Array) -> Result<Uint16Array> {
    Ok(board::create_garbage_rows(holes.as_ref())?.into())
}

#[napi(js_name = "applyGarbage")]
pub fn apply_garbage(rows: Uint16Array, holes: Uint8Array) -> Result<Uint16Array> {
    Ok(board::apply_garbage(rows.as_ref(), holes.as_ref())?.into())
}

#[napi(js_name = "rowsToFumenField")]
pub fn rows_to_fumen_field(rows: Uint16Array) -> Result<String> {
    fumen::rows_to_fumen_field(rows.as_ref())
}

#[napi(js_name = "batchRowsToFumenFields")]
pub fn batch_rows_to_fumen_fields(rows: Uint16Array, board_count: u32) -> Result<Vec<String>> {
    fumen::batch_rows_to_fumen_fields(rows.as_ref(), board_count)
}

#[napi(js_name = "canReachOpenerPlacement")]
pub fn can_reach_opener_placement(
    rows: Uint16Array,
    piece: String,
    rotation: u32,
    x: i32,
    y: i32,
    kick_table: Option<String>,
) -> Result<bool> {
    let board = board::rows_to_array(rows.as_ref())?;
    let piece = parse_piece_string(&piece)?;
    let rotation = u8::try_from(rotation)
        .map_err(|_| Error::from_reason(format!("rotation must fit in u8, got {rotation}.")))?;
    let shape_index = piece_shapes(piece)
        .iter()
        .position(|shape| shape.rotation == rotation)
        .ok_or_else(|| {
            Error::from_reason(format!(
                "Piece {} has no rotation {rotation}.",
                piece_name(piece)
            ))
        })?;
    let x =
        i8::try_from(x).map_err(|_| Error::from_reason(format!("x must fit in i8, got {x}.")))?;
    let y =
        i8::try_from(y).map_err(|_| Error::from_reason(format!("y must fit in i8, got {y}.")))?;
    let shape = piece_shapes(piece)[shape_index];
    let kick_table = parse_optional_kick_table(kick_table.as_deref())?;

    Ok(can_place(&board, shape, x, y)
        && (y == 0 || !can_place(&board, shape, x, y - 1))
        && is_reachable_placement(&board, piece, shape_index, x, y, kick_table))
}

#[napi(js_name = "detectOpenerSpin")]
pub fn detect_opener_spin(
    rows: Uint16Array,
    piece: String,
    rotation: u32,
    x: i32,
    y: i32,
    spin_mode: Option<String>,
) -> Result<BeamSpinDetection> {
    let board = board::rows_to_array(rows.as_ref())?;
    let piece = parse_piece_string(&piece)?;
    let rotation = u8::try_from(rotation)
        .map_err(|_| Error::from_reason(format!("rotation must fit in u8, got {rotation}.")))?;
    let shape = piece_shapes(piece)
        .iter()
        .find(|shape| shape.rotation == rotation)
        .copied()
        .ok_or_else(|| {
            Error::from_reason(format!(
                "Piece {} has no rotation {rotation}.",
                piece_name(piece)
            ))
        })?;
    let x =
        i8::try_from(x).map_err(|_| Error::from_reason(format!("x must fit in i8, got {x}.")))?;
    let y =
        i8::try_from(y).map_err(|_| Error::from_reason(format!("y must fit in i8, got {y}.")))?;
    let Some(locked) = lock_shape(&board, shape, x, y) else {
        return Err(Error::from_reason(format!(
            "Cannot place {} rotation {rotation} at x={x}, y={y}.",
            piece_name(piece)
        )));
    };
    let detected = detect_spin(
        &locked,
        piece,
        shape,
        x,
        y,
        board::count_full_lines_array(&locked),
    );
    let spin = match spin_mode {
        Some(spin_mode) => apply_spin_mode(detected, piece, parse_spin_mode(&spin_mode)?),
        None => detected,
    };
    Ok(BeamSpinDetection::from(spin))
}

#[napi(js_name = "estimateOpenerTSpinPotential")]
pub fn estimate_opener_t_spin_potential(
    rows: Uint16Array,
    kick_table: Option<String>,
) -> Result<u32> {
    let board = board::rows_to_array(rows.as_ref())?;
    let kick_table = parse_optional_kick_table(kick_table.as_deref())?;
    Ok(estimate_t_spin_potential(&board, kick_table))
}

#[napi(js_name = "evaluateOpenerFirepower")]
pub fn evaluate_opener_firepower(events: Vec<BeamFirepowerInput>) -> Result<BeamFirepowerSummary> {
    let mut state = FirepowerState::empty();
    let mut output_events = Vec::with_capacity(events.len());

    for event in events {
        let clear_kind = parse_clear_kind(&event.clear_name)?;
        let cleared_lines = clear_kind_cleared_lines(clear_kind);
        let combo_table = event
            .combo_table
            .as_deref()
            .map(parse_combo_table)
            .transpose()?
            .unwrap_or(crate::tetrio_tables::ComboTable::Multiplier);
        let (next_state, firepower_event) = advance_firepower_for_clear_with_combo_table(
            state,
            clear_kind,
            cleared_lines,
            cleared_lines > 0 && event.all_clear.unwrap_or(false),
            combo_table,
        );
        state = next_state;
        output_events.push(BeamFirepowerEvent::from(firepower_event));
    }

    Ok(BeamFirepowerSummary {
        attack: state.attack,
        points: state.points,
        combo: state.combo,
        max_combo: state.max_combo,
        back_to_back_chain: state.back_to_back_chain,
        all_clears: state.all_clears,
        firepower_score: firepower_score(state),
        events: output_events,
    })
}

#[napi(js_name = "searchOpenerBeam")]
pub fn search_opener_beam(
    queue: String,
    beam_width: u32,
    hold_enabled: bool,
    max_depth: u32,
    combo_table: Option<String>,
    kick_table: Option<String>,
    spin_mode: Option<String>,
) -> Result<Vec<BeamSearchNode>> {
    search_opener_beam_internal(
        queue,
        beam_width,
        hold_enabled,
        max_depth,
        false,
        combo_table,
        kick_table,
        spin_mode,
    )
}

#[napi(js_name = "searchOpenerBeamWithPlacements")]
pub fn search_opener_beam_with_placements(
    queue: String,
    beam_width: u32,
    hold_enabled: bool,
    max_depth: u32,
    combo_table: Option<String>,
    kick_table: Option<String>,
    spin_mode: Option<String>,
) -> Result<Vec<BeamSearchNode>> {
    search_opener_beam_internal(
        queue,
        beam_width,
        hold_enabled,
        max_depth,
        true,
        combo_table,
        kick_table,
        spin_mode,
    )
}

#[napi(js_name = "evaluateOpenerBag")]
pub fn evaluate_opener_bag(
    bag: String,
    beam_width: u32,
    hold_enabled: bool,
    max_depth: u32,
    max_queues: u32,
    top_queue_count: u32,
    combo_table: Option<String>,
    kick_table: Option<String>,
    spin_mode: Option<String>,
) -> Result<OpenerBagEvaluation> {
    let combo_table = parse_optional_combo_table(combo_table.as_deref())?;
    let kick_table = parse_optional_kick_table(kick_table.as_deref())?;
    let spin_mode = parse_optional_spin_mode(spin_mode.as_deref())?;
    evaluate_opener_bag_internal(
        &bag,
        beam_width,
        hold_enabled,
        max_depth,
        max_queues,
        top_queue_count,
        combo_table,
        kick_table,
        spin_mode,
    )
}

fn search_opener_beam_internal(
    queue: String,
    beam_width: u32,
    hold_enabled: bool,
    max_depth: u32,
    include_placements: bool,
    combo_table: Option<String>,
    kick_table: Option<String>,
    spin_mode: Option<String>,
) -> Result<Vec<BeamSearchNode>> {
    let pieces = parse_queue(&queue)?;
    let max_depth = usize::min(max_depth as usize, pieces.len());
    let beam_width = validate_beam_width(beam_width)?;
    let combo_table = parse_optional_combo_table(combo_table.as_deref())?;
    let kick_table = parse_optional_kick_table(kick_table.as_deref())?;
    let spin_mode = parse_optional_spin_mode(spin_mode.as_deref())?;

    Ok(search_opener_states(
        &pieces,
        beam_width,
        hold_enabled,
        max_depth,
        include_placements,
        combo_table,
        kick_table,
        spin_mode,
    )
    .into_iter()
    .map(BeamSearchNode::from)
    .collect())
}

pub(crate) fn search_opener_states(
    pieces: &[Piece],
    beam_width: usize,
    hold_enabled: bool,
    max_depth: usize,
    include_placements: bool,
    combo_table: ComboTable,
    kick_table: KickTable,
    spin_mode: SpinMode,
) -> Vec<SearchState> {
    let empty_rows = [0_u16; BOARD_HEIGHT];
    let initial_metrics = board::evaluate_board_unchecked(&empty_rows);
    let initial_firepower = FirepowerState::empty();
    let initial_t_spin_potential = 0;
    let mut beam = vec![SearchState {
        rows: empty_rows,
        hold: None,
        queue_index: 0,
        path: Vec::new(),
        placements: Vec::new(),
        score: score_state(initial_metrics, initial_firepower, initial_t_spin_potential),
        metrics: initial_metrics,
        firepower: initial_firepower,
        t_spin_potential: initial_t_spin_potential,
    }];

    for _depth in 0..max_depth {
        let mut next_by_key = HashMap::<SearchKey, SearchState>::new();

        for state in &beam {
            for choice in piece_choices(&pieces, state, hold_enabled) {
                let shapes = piece_shapes(choice.piece);
                for shape_index in placement_shape_indices(choice.piece).iter().copied() {
                    let shape = shapes[shape_index];
                    for x in 0..=(BOARD_WIDTH as i8 - shape.width) {
                        let mut can_place_below = false;
                        for y in 0..=(BOARD_HEIGHT as i8 - shape.height) {
                            let can_place_here = can_place(&state.rows, shape, x, y);
                            if can_place_here && !can_place_below {
                                let Some(placed) = place_grounded_at_y(
                                    &state.rows,
                                    choice,
                                    shape_index,
                                    shape,
                                    x,
                                    y,
                                    include_placements,
                                    kick_table,
                                    spin_mode,
                                ) else {
                                    can_place_below = can_place_here;
                                    continue;
                                };
                                let rows = placed.rows;
                                let metrics = board::evaluate_board_unchecked(&rows);
                                let (firepower, firepower_event) =
                                    advance_firepower_with_combo_table(
                                        state.firepower,
                                        placed.spin,
                                        &rows,
                                        combo_table,
                                    );
                                let t_spin_potential = 0;
                                let score = score_state(metrics, firepower, t_spin_potential);
                                let key = SearchKey {
                                    rows,
                                    hold: choice.hold,
                                    queue_index: choice.queue_index,
                                    combo: firepower.combo,
                                    back_to_back_chain: firepower.back_to_back_chain,
                                };
                                let should_insert = match next_by_key.get(&key) {
                                    Some(existing) => {
                                        compare_search_state_to_candidate(
                                            existing,
                                            score,
                                            firepower,
                                            state.path.len() + 1,
                                        ) == std::cmp::Ordering::Greater
                                    }
                                    None => true,
                                };

                                if should_insert {
                                    let mut path = state.path.clone();
                                    path.push(format_placement(
                                        choice.piece,
                                        shape.rotation,
                                        x,
                                        placed.y,
                                        choice.used_hold,
                                    ));
                                    let placements = if include_placements {
                                        let mut placements = state.placements.clone();
                                        if let Some(mut placement) = placed.placement {
                                            placement.firepower = firepower_event;
                                            placements.push(placement);
                                        }
                                        placements
                                    } else {
                                        Vec::new()
                                    };
                                    let next_state = SearchState {
                                        rows,
                                        hold: choice.hold,
                                        queue_index: choice.queue_index,
                                        path,
                                        placements,
                                        score,
                                        metrics,
                                        firepower,
                                        t_spin_potential,
                                    };
                                    next_by_key.insert(key, next_state);
                                }
                            }
                            can_place_below = can_place_here;
                        }
                    }
                }
            }
        }

        if next_by_key.is_empty() {
            break;
        }

        beam = next_by_key.into_values().collect();
        retain_best_search_states(&mut beam, setup_candidate_pool_width(beam_width));
        score_t_spin_setup_potential(&mut beam, pieces);
        retain_best_search_states(&mut beam, beam_width);
    }

    beam.sort_by(compare_search_state);
    beam
}

fn retain_best_search_states(beam: &mut Vec<SearchState>, beam_width: usize) {
    if beam.len() <= beam_width {
        beam.sort_by(compare_search_state);
        return;
    }

    {
        let (retained, _, _) = beam.select_nth_unstable_by(beam_width, compare_search_state);
        retained.sort_by(compare_search_state);
    }
    beam.truncate(beam_width);
}

fn setup_candidate_pool_width(beam_width: usize) -> usize {
    beam_width.saturating_mul(16).max(beam_width)
}

fn score_t_spin_setup_potential(beam: &mut [SearchState], pieces: &[Piece]) {
    for state in beam {
        state.t_spin_potential = if has_future_t_piece(state, pieces) {
            estimate_t_spin_surface_potential(&state.rows)
        } else {
            0
        };
        state.score = score_state(state.metrics, state.firepower, state.t_spin_potential);
    }
}

fn has_future_t_piece(state: &SearchState, pieces: &[Piece]) -> bool {
    state.hold == Some(Piece::T)
        || pieces
            .get(state.queue_index..)
            .is_some_and(|remaining| remaining.contains(&Piece::T))
}

fn piece_choices(pieces: &[Piece], state: &SearchState, hold_enabled: bool) -> Vec<PieceChoice> {
    let Some(current) = pieces.get(state.queue_index).copied() else {
        return Vec::new();
    };

    let mut choices = vec![PieceChoice {
        piece: current,
        hold: state.hold,
        queue_index: state.queue_index + 1,
        used_hold: false,
    }];

    if hold_enabled {
        match state.hold {
            Some(held) => choices.push(PieceChoice {
                piece: held,
                hold: Some(current),
                queue_index: state.queue_index + 1,
                used_hold: true,
            }),
            None => {
                if let Some(next) = pieces.get(state.queue_index + 1).copied() {
                    choices.push(PieceChoice {
                        piece: next,
                        hold: Some(current),
                        queue_index: state.queue_index + 2,
                        used_hold: true,
                    });
                }
            }
        }
    }

    choices
}

fn place_grounded_at_y(
    rows: &BoardRows,
    choice: PieceChoice,
    shape_index: usize,
    shape: Shape,
    x: i8,
    y: i8,
    include_placement: bool,
    kick_table: KickTable,
    spin_mode: SpinMode,
) -> Option<PlacedBoard> {
    if !is_reachable_placement(rows, choice.piece, shape_index, x, y, kick_table) {
        return None;
    }

    let mut cells = if include_placement {
        Some(Vec::with_capacity(shape.cells.len()))
    } else {
        None
    };
    let mut placed = *rows;
    for cell in shape.cells {
        let absolute = Cell {
            x: x + cell.x,
            y: y + cell.y,
        };
        let row_index = usize::try_from(absolute.y).ok()?;
        let column = u32::try_from(absolute.x).ok()?;
        placed[row_index] |= 1_u16 << column;
        if let Some(cells) = &mut cells {
            cells.push(absolute);
        }
    }
    let cleared_lines = board::count_full_lines_array(&placed);
    let spin = apply_spin_mode(
        detect_spin(&placed, choice.piece, shape, x, y, cleared_lines),
        choice.piece,
        spin_mode,
    );
    Some(PlacedBoard {
        rows: board::clear_full_lines_array(placed),
        y,
        spin,
        placement: cells.map(|cells| Placement {
            piece: choice.piece,
            rotation: shape.rotation,
            x,
            y,
            used_hold: choice.used_hold,
            cells,
            spin,
            firepower: FirepowerEvent::empty(),
        }),
    })
}

fn compare_search_state(left: &SearchState, right: &SearchState) -> std::cmp::Ordering {
    right
        .firepower
        .t_spin_clears
        .cmp(&left.firepower.t_spin_clears)
        .then_with(|| {
            right
                .firepower
                .t_spin_attack
                .cmp(&left.firepower.t_spin_attack)
        })
        .then_with(|| {
            right
                .firepower
                .difficult_clears
                .cmp(&left.firepower.difficult_clears)
        })
        .then_with(|| {
            right
                .firepower
                .difficult_attack
                .cmp(&left.firepower.difficult_attack)
        })
        .then_with(|| {
            right
                .firepower
                .back_to_back_chain
                .cmp(&left.firepower.back_to_back_chain)
        })
        .then_with(|| right.t_spin_potential.cmp(&left.t_spin_potential))
        .then_with(|| right.firepower.attack.cmp(&left.firepower.attack))
        .then_with(|| right.score.total_cmp(&left.score))
        .then_with(|| right.firepower.points.cmp(&left.firepower.points))
        .then_with(|| left.path.len().cmp(&right.path.len()))
        .then_with(|| left.path.cmp(&right.path))
}

fn compare_search_state_to_candidate(
    left: &SearchState,
    right_score: f64,
    right_firepower: FirepowerState,
    right_path_len: usize,
) -> std::cmp::Ordering {
    right_firepower
        .t_spin_clears
        .cmp(&left.firepower.t_spin_clears)
        .then_with(|| {
            right_firepower
                .t_spin_attack
                .cmp(&left.firepower.t_spin_attack)
        })
        .then_with(|| {
            right_firepower
                .difficult_clears
                .cmp(&left.firepower.difficult_clears)
        })
        .then_with(|| {
            right_firepower
                .difficult_attack
                .cmp(&left.firepower.difficult_attack)
        })
        .then_with(|| {
            right_firepower
                .back_to_back_chain
                .cmp(&left.firepower.back_to_back_chain)
        })
        .then_with(|| right_firepower.attack.cmp(&left.firepower.attack))
        .then_with(|| right_score.total_cmp(&left.score))
        .then_with(|| right_firepower.points.cmp(&left.firepower.points))
        .then_with(|| left.path.len().cmp(&right_path_len))
}

pub(crate) fn validate_beam_width(beam_width: u32) -> Result<usize> {
    usize::try_from(beam_width)
        .ok()
        .filter(|width| *width > 0)
        .ok_or_else(|| Error::from_reason(format!("beamWidth must be positive, got {beam_width}.")))
}

fn parse_optional_combo_table(input: Option<&str>) -> Result<ComboTable> {
    input
        .map(parse_combo_table)
        .transpose()
        .map(|combo_table| combo_table.unwrap_or(ComboTable::Multiplier))
}

fn parse_optional_kick_table(input: Option<&str>) -> Result<KickTable> {
    input
        .map(parse_kick_table)
        .transpose()
        .map(|kick_table| kick_table.unwrap_or(KickTable::SrsPlus))
}

fn parse_optional_spin_mode(input: Option<&str>) -> Result<SpinMode> {
    input
        .map(parse_spin_mode)
        .transpose()
        .map(|spin_mode| spin_mode.unwrap_or(SpinMode::TSpins))
}

impl From<SearchState> for BeamSearchNode {
    fn from(state: SearchState) -> Self {
        Self {
            score: state.score,
            firepower_score: firepower_score(state.firepower),
            depth: state.path.len() as u32,
            queue_index: state.queue_index as u32,
            hold: state.hold.map(piece_name).map(String::from),
            rows: state.rows.to_vec(),
            path: state.path,
            placements: state
                .placements
                .into_iter()
                .map(BeamPlacement::from)
                .collect(),
            attack: state.firepower.attack,
            points: state.firepower.points,
            max_combo: state.firepower.max_combo,
            back_to_back_chain: state.firepower.back_to_back_chain,
            all_clears: state.firepower.all_clears,
            difficult_clears: state.firepower.difficult_clears,
            t_spin_clears: state.firepower.t_spin_clears,
            t_spin_attack: state.firepower.t_spin_attack,
            t_spin_potential: state.t_spin_potential,
            occupied_cells: state.metrics[0],
            cleared_lines: state.metrics[1],
            aggregate_height: state.metrics[2],
            holes: state.metrics[3],
            bumpiness: state.metrics[4],
        }
    }
}

impl From<Placement> for BeamPlacement {
    fn from(placement: Placement) -> Self {
        let path = format_placement(
            placement.piece,
            placement.rotation,
            placement.x,
            placement.y,
            placement.used_hold,
        );
        Self {
            piece: piece_name(placement.piece).to_string(),
            rotation: u32::from(placement.rotation),
            x: i32::from(placement.x),
            y: i32::from(placement.y),
            used_hold: placement.used_hold,
            cells: placement
                .cells
                .into_iter()
                .map(|cell| BeamPlacementCell {
                    x: i32::from(cell.x),
                    y: i32::from(cell.y),
                })
                .collect(),
            path,
            spin_kind: spin_kind_name(placement.spin.kind).to_string(),
            spin: placement.spin.spin,
            mini: placement.spin.mini,
            immobile: placement.spin.immobile,
            occupied_corners: placement.spin.occupied_corners,
            cleared_lines: placement.spin.cleared_lines,
            clear_name: clear_kind_name(placement.firepower.clear_kind).to_string(),
            attack: placement.firepower.attack,
            base_attack: placement.firepower.base_attack,
            points: placement.firepower.points,
            combo: placement.firepower.combo,
            back_to_back: placement.firepower.back_to_back,
            back_to_back_bonus: placement.firepower.back_to_back_bonus,
            all_clear: placement.firepower.all_clear,
            all_clear_bonus: placement.firepower.all_clear_bonus,
        }
    }
}

impl From<SpinDetection> for BeamSpinDetection {
    fn from(spin: SpinDetection) -> Self {
        Self {
            kind: spin_kind_name(spin.kind).to_string(),
            spin: spin.spin,
            mini: spin.mini,
            immobile: spin.immobile,
            occupied_corners: spin.occupied_corners,
            cleared_lines: spin.cleared_lines,
        }
    }
}

impl From<FirepowerEvent> for BeamFirepowerEvent {
    fn from(event: FirepowerEvent) -> Self {
        Self {
            clear_name: clear_kind_name(event.clear_kind).to_string(),
            attack: event.attack,
            base_attack: event.base_attack,
            points: event.points,
            combo: event.combo,
            back_to_back: event.back_to_back,
            back_to_back_bonus: event.back_to_back_bonus,
            all_clear: event.all_clear,
            all_clear_bonus: event.all_clear_bonus,
        }
    }
}
