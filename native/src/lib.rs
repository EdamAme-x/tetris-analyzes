use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::HashMap;

mod board;
mod firepower;
mod fumen;
mod movement;
mod pieces;
mod spin;
mod tetrio_tables;

use board::{BoardEvaluation, BoardRows, BOARD_HEIGHT, BOARD_WIDTH};
use firepower::{
    advance_firepower, advance_firepower_for_clear_with_combo_table, clear_kind_cleared_lines,
    clear_kind_name, firepower_score, parse_clear_kind, parse_combo_table, score_state,
    FirepowerEvent, FirepowerState,
};
use movement::{can_place, is_reachable_placement, lock_shape};
use pieces::{
    format_placement, parse_piece_string, parse_queue, piece_name, piece_shapes, Cell, Piece, Shape,
};
use spin::{detect_spin, spin_kind_name, SpinDetection};

#[derive(Clone)]
struct SearchState {
    rows: BoardRows,
    hold: Option<Piece>,
    queue_index: usize,
    path: Vec<String>,
    placements: Vec<Placement>,
    score: f64,
    metrics: BoardEvaluation,
    firepower: FirepowerState,
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

    Ok(can_place(&board, shape, x, y)
        && (y == 0 || !can_place(&board, shape, x, y - 1))
        && is_reachable_placement(&board, piece, shape_index, x, y))
}

#[napi(js_name = "detectOpenerSpin")]
pub fn detect_opener_spin(
    rows: Uint16Array,
    piece: String,
    rotation: u32,
    x: i32,
    y: i32,
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
    Ok(BeamSpinDetection::from(detect_spin(
        &locked,
        piece,
        shape,
        x,
        y,
        board::count_full_lines_array(&locked),
    )))
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
) -> Result<Vec<BeamSearchNode>> {
    search_opener_beam_internal(queue, beam_width, hold_enabled, max_depth, false)
}

#[napi(js_name = "searchOpenerBeamWithPlacements")]
pub fn search_opener_beam_with_placements(
    queue: String,
    beam_width: u32,
    hold_enabled: bool,
    max_depth: u32,
) -> Result<Vec<BeamSearchNode>> {
    search_opener_beam_internal(queue, beam_width, hold_enabled, max_depth, true)
}

fn search_opener_beam_internal(
    queue: String,
    beam_width: u32,
    hold_enabled: bool,
    max_depth: u32,
    include_placements: bool,
) -> Result<Vec<BeamSearchNode>> {
    let pieces = parse_queue(&queue)?;
    let max_depth = usize::min(max_depth as usize, pieces.len());
    let beam_width = usize::try_from(beam_width)
        .ok()
        .filter(|width| *width > 0)
        .ok_or_else(|| {
            Error::from_reason(format!("beamWidth must be positive, got {beam_width}."))
        })?;

    let empty_rows = [0_u16; BOARD_HEIGHT];
    let initial_metrics = board::evaluate_board_unchecked(&empty_rows);
    let initial_firepower = FirepowerState::empty();
    let mut beam = vec![SearchState {
        rows: empty_rows,
        hold: None,
        queue_index: 0,
        path: Vec::new(),
        placements: Vec::new(),
        score: score_state(initial_metrics, initial_firepower),
        metrics: initial_metrics,
        firepower: initial_firepower,
    }];

    for _depth in 0..max_depth {
        let mut next_by_key = HashMap::<SearchKey, SearchState>::new();

        for state in &beam {
            for choice in piece_choices(&pieces, state, hold_enabled) {
                for (shape_index, shape) in piece_shapes(choice.piece).iter().copied().enumerate() {
                    for x in 0..=(BOARD_WIDTH as i8 - shape.width) {
                        if let Some(placed) = place_and_clear(
                            &state.rows,
                            choice,
                            shape_index,
                            shape,
                            x,
                            include_placements,
                        ) {
                            let rows = placed.rows;
                            let metrics = board::evaluate_board_unchecked(&rows);
                            let (firepower, firepower_event) =
                                advance_firepower(state.firepower, placed.spin, &rows);
                            let score = score_state(metrics, firepower);
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
                            };
                            let key = SearchKey {
                                rows,
                                hold: choice.hold,
                                queue_index: choice.queue_index,
                                combo: firepower.combo,
                                back_to_back_chain: firepower.back_to_back_chain,
                            };
                            match next_by_key.get(&key) {
                                Some(existing) if existing.score >= next_state.score => {}
                                _ => {
                                    next_by_key.insert(key, next_state);
                                }
                            }
                        }
                    }
                }
            }
        }

        if next_by_key.is_empty() {
            break;
        }

        beam = next_by_key.into_values().collect();
        beam.sort_by(compare_search_state);
        beam.truncate(beam_width);
    }

    beam.sort_by(compare_search_state);
    Ok(beam.into_iter().map(BeamSearchNode::from).collect())
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

fn place_and_clear(
    rows: &BoardRows,
    choice: PieceChoice,
    shape_index: usize,
    shape: Shape,
    x: i8,
    include_placement: bool,
) -> Option<PlacedBoard> {
    for y in 0..=(BOARD_HEIGHT as i8 - shape.height) {
        if can_place(rows, shape, x, y) && (y == 0 || !can_place(rows, shape, x, y - 1)) {
            if !is_reachable_placement(rows, choice.piece, shape_index, x, y) {
                continue;
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
            let spin = detect_spin(&placed, choice.piece, shape, x, y, cleared_lines);
            return Some(PlacedBoard {
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
            });
        }
    }
    None
}

fn compare_search_state(left: &SearchState, right: &SearchState) -> std::cmp::Ordering {
    right
        .score
        .total_cmp(&left.score)
        .then_with(|| left.path.len().cmp(&right.path.len()))
        .then_with(|| left.queue_index.cmp(&right.queue_index))
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
