use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::{hash_map::Entry, HashMap, HashSet};
use std::hash::{BuildHasherDefault, Hash, Hasher};

mod bag;
mod board;
mod firepower;
mod fumen;
mod movement;
mod pieces;
mod spin;
mod tetrio_tables;

use bag::{
    evaluate_opener_bag_internal, mine_opener_bag_templates_internal, OpenerBagEvaluation,
    OpenerBagTemplateMining,
};
use board::{BoardEvaluation, BoardRows, BOARD_HEIGHT, BOARD_WIDTH};
use firepower::{
    advance_firepower_for_clear_with_combo_table, advance_firepower_with_combo_table,
    clear_kind_cleared_lines, clear_kind_name, estimate_quad_well_potential,
    estimate_t_spin_potential, firepower_score, parse_clear_kind, parse_combo_table,
    quad_well_continuation_score, score_state, FirepowerEvent, FirepowerState,
};
use movement::{
    can_place, can_place_in_bounds, is_reachable_placement, is_reachable_placement_with_cache,
    lock_shape, parse_kick_table, resolve_rotation_state, MovementState, ReachabilityCache,
};
use pieces::{
    format_placement, parse_piece_string, parse_queue, piece_name, piece_shapes,
    placement_shape_indices, Piece, Shape,
};
use spin::{
    detect_spin, detect_spin_for_mode, parse_spin_mode, spin_kind_name, SpinDetection, SpinMode,
};
use tetrio_tables::{ComboTable, KickTable};

pub(crate) type FastHashMap<K, V> = HashMap<K, V, BuildHasherDefault<FastHasher>>;
pub(crate) type FastHashSet<K> = HashSet<K, BuildHasherDefault<FastHasher>>;
pub(crate) const DEFAULT_SETUP_CANDIDATE_POOL_MULTIPLIER: usize = 14;
const MAX_SETUP_CANDIDATE_POOL_MULTIPLIER: usize = 64;

#[derive(Default)]
pub(crate) struct FastHasher {
    hash: u64,
}

impl FastHasher {
    fn write_word(&mut self, value: u64) {
        self.hash ^= value;
        self.hash = self.hash.rotate_left(5).wrapping_mul(0x517c_c1b7_2722_0a95);
    }
}

impl Hasher for FastHasher {
    fn finish(&self) -> u64 {
        self.hash
    }

    fn write(&mut self, bytes: &[u8]) {
        let mut chunks = bytes.chunks_exact(8);
        for chunk in &mut chunks {
            self.write_word(u64::from_ne_bytes(
                chunk.try_into().expect("chunk is 8 bytes"),
            ));
        }
        let mut tail = 0_u64;
        for (index, byte) in chunks.remainder().iter().copied().enumerate() {
            tail |= u64::from(byte) << (index * 8);
        }
        self.write_word(tail);
    }

    fn write_u8(&mut self, value: u8) {
        self.write_word(u64::from(value));
    }

    fn write_u16(&mut self, value: u16) {
        self.write_word(u64::from(value));
    }

    fn write_u32(&mut self, value: u32) {
        self.write_word(u64::from(value));
    }

    fn write_u64(&mut self, value: u64) {
        self.write_word(value);
    }

    fn write_usize(&mut self, value: usize) {
        self.write_word(value as u64);
    }
}

#[derive(Clone)]
pub(crate) struct SearchState {
    pub(crate) rows: BoardRows,
    pub(crate) hold: Option<Piece>,
    pub(crate) queue_index: usize,
    pub(crate) depth: usize,
    pub(crate) path: Vec<PlacementStep>,
    pub(crate) path_tie_breaker: u64,
    placements: Vec<Placement>,
    pub(crate) score: f64,
    pub(crate) metrics: BoardEvaluation,
    pub(crate) firepower: FirepowerState,
    pub(crate) t_spin_potential: u32,
    phase_family_key: u64,
}

#[derive(Eq, PartialEq)]
struct SearchKey {
    rows: BoardRows,
    hold: Option<Piece>,
    queue_index: usize,
    combo: u32,
    back_to_back_chain: u32,
}

impl Hash for SearchKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        for chunk in self.rows.chunks_exact(4) {
            let packed = u64::from(chunk[0])
                | (u64::from(chunk[1]) << 16)
                | (u64::from(chunk[2]) << 32)
                | (u64::from(chunk[3]) << 48);
            state.write_u64(packed);
        }
        state.write_u8(self.hold.map(piece_hash_code).unwrap_or(7));
        state.write_usize(self.queue_index);
        state.write_u32(self.combo);
        state.write_u32(self.back_to_back_chain);
    }
}

fn piece_hash_code(piece: Piece) -> u8 {
    match piece {
        Piece::I => 0,
        Piece::O => 1,
        Piece::T => 2,
        Piece::S => 3,
        Piece::Z => 4,
        Piece::J => 5,
        Piece::L => 6,
    }
}

#[derive(Clone, Copy, Default)]
struct FuturePieces {
    next_i_offset: Option<u16>,
    next_t_offset: Option<u16>,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub(crate) struct PlacementStep {
    piece: Piece,
    rotation: u8,
    x: i8,
    y: i8,
    used_hold: bool,
}

impl PlacementStep {
    pub(crate) fn format(self) -> String {
        format_placement(self.piece, self.rotation, self.x, self.y, self.used_hold)
    }
}

impl Ord for PlacementStep {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.used_hold
            .cmp(&other.used_hold)
            .then_with(|| {
                placement_piece_order(self.piece).cmp(&placement_piece_order(other.piece))
            })
            .then_with(|| self.rotation.cmp(&other.rotation))
            .then_with(|| self.x.cmp(&other.x))
            .then_with(|| self.y.cmp(&other.y))
    }
}

impl PartialOrd for PlacementStep {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

fn placement_piece_order(piece: Piece) -> u8 {
    match piece {
        Piece::I => 0,
        Piece::J => 1,
        Piece::L => 2,
        Piece::O => 3,
        Piece::S => 4,
        Piece::T => 5,
        Piece::Z => 6,
    }
}

fn next_path_tie_breaker(current: u64, step: PlacementStep) -> u64 {
    let used_hold = u64::from(step.used_hold);
    let piece = u64::from(placement_piece_order(step.piece));
    let rotation = u64::from(step.rotation);
    let x = u64::from(step.x as u8);
    let y = u64::from(step.y as u8);
    let rank = (((used_hold * 7 + piece) * 4 + rotation) * 32 + x) * 32 + y;
    current.wrapping_mul(16_384).wrapping_add(rank + 1)
}

#[derive(Clone)]
struct Placement {
    piece: Piece,
    rotation: u8,
    x: i8,
    y: i8,
    used_hold: bool,
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
    pub combo: u32,
    pub max_combo: u32,
    pub back_to_back_chain: u32,
    pub all_clears: u32,
    pub difficult_clears: u32,
    pub difficult_attack: u32,
    pub spin_clears: u32,
    pub spin_attack: u32,
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
    pub back_to_back_chain: u32,
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
pub struct BeamRotationResolution {
    pub success: bool,
    pub rotation: Option<u32>,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub kick_index: Option<u32>,
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

#[napi(js_name = "resolveOpenerRotation")]
pub fn resolve_opener_rotation(
    rows: Uint16Array,
    piece: String,
    rotation: u32,
    x: i32,
    y: i32,
    direction: i32,
    kick_table: Option<String>,
) -> Result<BeamRotationResolution> {
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
    let direction = i8::try_from(direction)
        .map_err(|_| Error::from_reason(format!("direction must fit in i8, got {direction}.")))?;
    if !matches!(direction, -1 | 1 | 2) {
        return Err(Error::from_reason(format!(
            "Unsupported native opener rotation direction {direction}. Supported directions are -1, 1, and 2."
        )));
    }
    let kick_table = parse_optional_kick_table(kick_table.as_deref())?;
    let shapes = piece_shapes(piece);
    let state = MovementState { shape_index, x, y };

    let Some(resolution) =
        resolve_rotation_state(&board, piece, shapes, state, direction, kick_table)
    else {
        return Ok(BeamRotationResolution {
            success: false,
            rotation: None,
            x: None,
            y: None,
            kick_index: None,
        });
    };

    Ok(BeamRotationResolution {
        success: true,
        rotation: Some(u32::from(shapes[resolution.state.shape_index].rotation)),
        x: Some(i32::from(resolution.state.x)),
        y: Some(i32::from(resolution.state.y)),
        kick_index: resolution.kick_index.map(|index| index as u32),
    })
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
    let cleared_lines = board::count_full_lines_array(&locked);
    let spin = match spin_mode {
        Some(spin_mode) => detect_spin_for_mode(
            &locked,
            piece,
            shape,
            x,
            y,
            cleared_lines,
            parse_spin_mode(&spin_mode)?,
        ),
        None => detect_spin(&locked, piece, shape, x, y, cleared_lines),
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
            None,
            combo_table,
            false,
            false,
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
    setup_pool_multiplier: Option<u32>,
) -> Result<Vec<BeamSearchNode>> {
    search_opener_beam_internal(
        queue,
        beam_width,
        hold_enabled,
        max_depth,
        false,
        true,
        combo_table,
        kick_table,
        spin_mode,
        setup_pool_multiplier,
    )
}

#[napi(js_name = "searchOpenerBeamCompact")]
pub fn search_opener_beam_compact(
    queue: String,
    beam_width: u32,
    hold_enabled: bool,
    max_depth: u32,
    combo_table: Option<String>,
    kick_table: Option<String>,
    spin_mode: Option<String>,
    setup_pool_multiplier: Option<u32>,
) -> Result<Vec<BeamSearchNode>> {
    search_opener_beam_internal(
        queue,
        beam_width,
        hold_enabled,
        max_depth,
        false,
        false,
        combo_table,
        kick_table,
        spin_mode,
        setup_pool_multiplier,
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
    setup_pool_multiplier: Option<u32>,
) -> Result<Vec<BeamSearchNode>> {
    search_opener_beam_internal(
        queue,
        beam_width,
        hold_enabled,
        max_depth,
        true,
        true,
        combo_table,
        kick_table,
        spin_mode,
        setup_pool_multiplier,
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

#[napi(js_name = "mineOpenerBagTemplates")]
pub fn mine_opener_bag_templates(
    bag: String,
    beam_width: u32,
    hold_enabled: bool,
    max_depth: u32,
    max_queues: u32,
    top_template_count: u32,
    include_paths: bool,
    combo_table: Option<String>,
    kick_table: Option<String>,
    spin_mode: Option<String>,
) -> Result<OpenerBagTemplateMining> {
    let combo_table = parse_optional_combo_table(combo_table.as_deref())?;
    let kick_table = parse_optional_kick_table(kick_table.as_deref())?;
    let spin_mode = parse_optional_spin_mode(spin_mode.as_deref())?;
    mine_opener_bag_templates_internal(
        &bag,
        beam_width,
        hold_enabled,
        max_depth,
        max_queues,
        top_template_count,
        include_paths,
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
    include_path: bool,
    combo_table: Option<String>,
    kick_table: Option<String>,
    spin_mode: Option<String>,
    setup_pool_multiplier: Option<u32>,
) -> Result<Vec<BeamSearchNode>> {
    let pieces = parse_queue(&queue)?;
    let max_depth = usize::min(max_depth as usize, pieces.len());
    let beam_width = validate_beam_width(beam_width)?;
    let combo_table = parse_optional_combo_table(combo_table.as_deref())?;
    let kick_table = parse_optional_kick_table(kick_table.as_deref())?;
    let spin_mode = parse_optional_spin_mode(spin_mode.as_deref())?;
    let setup_pool_multiplier = validate_setup_candidate_pool_multiplier(setup_pool_multiplier)?;

    Ok(search_opener_states(
        &pieces,
        beam_width,
        hold_enabled,
        max_depth,
        include_placements,
        include_path,
        combo_table,
        kick_table,
        spin_mode,
        setup_pool_multiplier,
    )
    .into_iter()
    .map(|state| BeamSearchNode::from_search_state(state, include_path))
    .collect())
}

pub(crate) fn search_opener_states(
    pieces: &[Piece],
    beam_width: usize,
    hold_enabled: bool,
    max_depth: usize,
    include_placements: bool,
    store_path: bool,
    combo_table: ComboTable,
    kick_table: KickTable,
    spin_mode: SpinMode,
    setup_pool_multiplier: usize,
) -> Vec<SearchState> {
    let future_pieces_by_queue_index = build_future_pieces_by_queue_index(pieces);
    let empty_rows = [0_u16; BOARD_HEIGHT];
    let initial_metrics = board::evaluate_board_unchecked(&empty_rows);
    let initial_firepower = FirepowerState::empty();
    let initial_t_spin_potential = 0;
    let mut beam = vec![SearchState {
        rows: empty_rows,
        hold: None,
        queue_index: 0,
        depth: 0,
        path: Vec::new(),
        path_tie_breaker: 0,
        placements: Vec::new(),
        score: score_state(initial_metrics, initial_firepower, initial_t_spin_potential),
        metrics: initial_metrics,
        firepower: initial_firepower,
        t_spin_potential: initial_t_spin_potential,
        phase_family_key: 0,
    }];

    let phase_diversity_start_depth = phase_diversity_start_depth(max_depth);
    let holeless_diversity_start_depth = holeless_diversity_start_depth(max_depth);
    for depth in 0..max_depth {
        let mut next_by_key = FastHashMap::<SearchKey, SearchState>::with_capacity_and_hasher(
            next_search_map_capacity(beam.len(), beam_width, hold_enabled, setup_pool_multiplier),
            BuildHasherDefault::<FastHasher>::default(),
        );

        for state in &beam {
            for choice in piece_choices(pieces, state, hold_enabled)
                .into_iter()
                .flatten()
            {
                let shapes = piece_shapes(choice.piece);
                let mut reachable_cache =
                    ReachabilityCache::new(&state.rows, choice.piece, kick_table);
                for shape_index in placement_shape_indices(choice.piece).iter().copied() {
                    let shape = shapes[shape_index];
                    for x in 0..=(BOARD_WIDTH as i8 - shape.width) {
                        let mut can_place_below = false;
                        for y in 0..=(BOARD_HEIGHT as i8 - shape.height) {
                            let can_place_here = can_place_in_bounds(&state.rows, shape, x, y);
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
                                    &mut reachable_cache,
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
                                        choice.piece,
                                        placed.spin,
                                        &rows,
                                        combo_table,
                                    );
                                let t_spin_potential = 0;
                                let score = score_state(metrics, firepower, t_spin_potential);
                                let phase_family_key = next_phase_family_key(
                                    state.phase_family_key,
                                    &rows,
                                    state.depth + 1,
                                    choice.hold,
                                    firepower.back_to_back_chain,
                                );
                                let key = SearchKey {
                                    rows,
                                    hold: choice.hold,
                                    queue_index: choice.queue_index,
                                    combo: firepower.combo,
                                    back_to_back_chain: firepower.back_to_back_chain,
                                };
                                match next_by_key.entry(key) {
                                    Entry::Occupied(mut entry) => {
                                        if compare_search_state_to_candidate(
                                            entry.get(),
                                            score,
                                            firepower,
                                            state.depth + 1,
                                        ) == std::cmp::Ordering::Greater
                                        {
                                            entry.insert(build_next_search_state(
                                                state,
                                                choice,
                                                shape,
                                                x,
                                                placed,
                                                metrics,
                                                firepower,
                                                firepower_event,
                                                score,
                                                phase_family_key,
                                                store_path,
                                            ));
                                        }
                                    }
                                    Entry::Vacant(entry) => {
                                        entry.insert(build_next_search_state(
                                            state,
                                            choice,
                                            shape,
                                            x,
                                            placed,
                                            metrics,
                                            firepower,
                                            firepower_event,
                                            score,
                                            phase_family_key,
                                            store_path,
                                        ));
                                    }
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
        retain_best_search_states(
            &mut beam,
            setup_candidate_pool_width(beam_width, setup_pool_multiplier),
        );
        score_t_spin_setup_potential(
            &mut beam,
            &future_pieces_by_queue_index,
            max_depth,
            kick_table,
            spin_mode,
        );
        let preserve_holeless = matches!(
            holeless_diversity_start_depth,
            Some(start_depth) if depth + 1 >= start_depth
        );
        match phase_diversity_start_depth {
            Some(start_depth) if depth + 1 >= start_depth => {
                retain_phase_diverse_search_states(&mut beam, beam_width, preserve_holeless);
            }
            _ if preserve_holeless => retain_holeless_diverse_search_states(&mut beam, beam_width),
            _ => {
                retain_best_search_states(&mut beam, beam_width);
            }
        }
    }

    beam.sort_by(compare_search_state);
    beam
}

fn build_next_search_state(
    state: &SearchState,
    choice: PieceChoice,
    shape: Shape,
    x: i8,
    placed: PlacedBoard,
    metrics: BoardEvaluation,
    firepower: FirepowerState,
    firepower_event: FirepowerEvent,
    score: f64,
    phase_family_key: u64,
    store_path: bool,
) -> SearchState {
    let step = PlacementStep {
        piece: choice.piece,
        rotation: shape.rotation,
        x,
        y: placed.y,
        used_hold: choice.used_hold,
    };
    let path = if store_path {
        let mut path = Vec::with_capacity(state.depth + 1);
        path.extend_from_slice(&state.path);
        path.push(step);
        path
    } else {
        Vec::new()
    };

    let mut placements = Vec::new();
    if let Some(mut placement) = placed.placement {
        placements = Vec::with_capacity(state.placements.len() + 1);
        placements.extend_from_slice(&state.placements);
        placement.firepower = firepower_event;
        placements.push(placement);
    }

    SearchState {
        rows: placed.rows,
        hold: choice.hold,
        queue_index: choice.queue_index,
        depth: state.depth + 1,
        path,
        path_tie_breaker: if store_path {
            0
        } else {
            next_path_tie_breaker(state.path_tie_breaker, step)
        },
        placements,
        score,
        metrics,
        firepower,
        t_spin_potential: 0,
        phase_family_key,
    }
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

fn setup_candidate_pool_width(beam_width: usize, multiplier: usize) -> usize {
    beam_width.saturating_mul(multiplier).max(beam_width)
}

fn retain_phase_diverse_search_states(
    beam: &mut Vec<SearchState>,
    beam_width: usize,
    preserve_holeless_diversity: bool,
) {
    retain_diverse_search_states(beam, beam_width, true, preserve_holeless_diversity);
}

fn retain_holeless_diverse_search_states(beam: &mut Vec<SearchState>, beam_width: usize) {
    if !should_reserve_holeless_search_states(beam, beam_width) {
        retain_best_search_states(beam, beam_width);
        return;
    }
    retain_diverse_search_states(beam, beam_width, false, true);
}

fn retain_diverse_search_states(
    beam: &mut Vec<SearchState>,
    beam_width: usize,
    preserve_phase_diversity: bool,
    preserve_holeless_diversity: bool,
) {
    let phase_reserve_width = phase_diversity_reserve_width(beam_width);
    let holeless_reserve_width = holeless_diversity_reserve_width(beam_width);
    let reserve_holeless =
        preserve_holeless_diversity && should_reserve_holeless_search_states(beam, beam_width);
    if ((phase_reserve_width == 0 || !preserve_phase_diversity) && !reserve_holeless)
        || beam.len() <= beam_width
    {
        retain_best_search_states(beam, beam_width);
        return;
    }

    beam.sort_by(compare_search_state);
    let sorted = std::mem::take(beam);
    let mut selected_flags = vec![false; sorted.len()];
    let best_state = &sorted[0];
    let mut seen_phase_keys = FastHashMap::<u64, ()>::with_capacity_and_hasher(
        phase_reserve_width,
        BuildHasherDefault::<FastHasher>::default(),
    );
    let mut reserved = 0;
    if preserve_phase_diversity {
        for (index, state) in sorted.iter().enumerate() {
            if reserved >= phase_reserve_width {
                break;
            }
            if state.phase_family_key == 0 || !is_phase_diversity_candidate(state, best_state) {
                continue;
            }
            if seen_phase_keys.insert(state.phase_family_key, ()).is_none() {
                selected_flags[index] = true;
                reserved += 1;
            }
        }
    }

    let mut seen_holeless_keys = FastHashMap::<u64, ()>::with_capacity_and_hasher(
        holeless_reserve_width,
        BuildHasherDefault::<FastHasher>::default(),
    );
    let mut holeless_reserved = 0;
    if reserve_holeless {
        for (index, state) in sorted.iter().enumerate() {
            if holeless_reserved >= holeless_reserve_width {
                break;
            }
            if selected_flags[index] || !is_holeless_diversity_candidate(state, best_state) {
                continue;
            }
            if seen_holeless_keys
                .insert(holeless_diversity_key(state), ())
                .is_none()
            {
                selected_flags[index] = true;
                holeless_reserved += 1;
            }
        }
    }

    let total_reserved = reserved + holeless_reserved;
    let mut remaining_global = beam_width.saturating_sub(total_reserved);
    beam.reserve(beam_width);
    for (index, state) in sorted.into_iter().enumerate() {
        if selected_flags[index] {
            beam.push(state);
        } else if remaining_global > 0 {
            beam.push(state);
            remaining_global -= 1;
        }
    }
}

fn should_reserve_holeless_search_states(beam: &[SearchState], beam_width: usize) -> bool {
    if holeless_diversity_reserve_width(beam_width) == 0 || beam.len() <= beam_width {
        return false;
    }
    let Some(best_state) = beam
        .iter()
        .min_by(|left, right| compare_search_state(left, right))
    else {
        return false;
    };
    best_state.metrics[3] > 0
        && beam
            .iter()
            .any(|state| is_holeless_diversity_candidate(state, best_state))
}

fn phase_diversity_reserve_width(beam_width: usize) -> usize {
    if beam_width < 32 {
        0
    } else {
        (beam_width / 8).clamp(4, 32).min(beam_width)
    }
}

fn holeless_diversity_reserve_width(beam_width: usize) -> usize {
    if beam_width < 32 {
        0
    } else {
        (beam_width / 64).clamp(1, 4).min(beam_width)
    }
}

fn phase_diversity_start_depth(max_depth: usize) -> Option<usize> {
    if max_depth < 21 {
        None
    } else {
        Some(((max_depth - 1) / 7) * 7)
    }
}

fn holeless_diversity_start_depth(max_depth: usize) -> Option<usize> {
    if max_depth < 14 {
        None
    } else {
        Some(((max_depth - 1) / 7) * 7)
    }
}

fn is_phase_diversity_candidate(state: &SearchState, best: &SearchState) -> bool {
    state.firepower.t_spin_clears.saturating_add(1) >= best.firepower.t_spin_clears
        && state.firepower.t_spin_attack.saturating_add(4) >= best.firepower.t_spin_attack
        && state.firepower.spin_clears.saturating_add(1) >= best.firepower.spin_clears
        && state.firepower.spin_attack.saturating_add(4) >= best.firepower.spin_attack
        && state.firepower.difficult_attack.saturating_add(4) >= best.firepower.difficult_attack
        && state.firepower.back_to_back_chain.saturating_add(1) >= best.firepower.back_to_back_chain
}

fn is_holeless_diversity_candidate(state: &SearchState, best: &SearchState) -> bool {
    state.metrics[3] == 0
        && state.firepower.spin_clears == best.firepower.spin_clears
        && state.firepower.spin_attack == best.firepower.spin_attack
        && state.firepower.difficult_clears == best.firepower.difficult_clears
        && state.firepower.difficult_attack == best.firepower.difficult_attack
        && state.firepower.back_to_back_chain == best.firepower.back_to_back_chain
        && state.firepower.attack == best.firepower.attack
}

fn holeless_diversity_key(state: &SearchState) -> u64 {
    let mut hasher = FastHasher::default();
    hasher.write_u64(state.phase_family_key);
    hasher.write_u8(state.hold.map(piece_hash_code).unwrap_or(7));
    hasher.write_usize(state.queue_index);
    hasher.write_u32(state.firepower.back_to_back_chain);
    hash_canonical_rows(&state.rows, &mut hasher);
    hasher.finish()
}

fn next_phase_family_key(
    previous_key: u64,
    rows: &BoardRows,
    depth: usize,
    hold: Option<Piece>,
    back_to_back_chain: u32,
) -> u64 {
    if depth == 0 || depth % 7 != 0 {
        return previous_key;
    }

    let mut hasher = FastHasher::default();
    hasher.write_u64(previous_key);
    hasher.write_usize(depth);
    hasher.write_u8(hold.map(piece_hash_code).unwrap_or(7));
    hasher.write_u32(back_to_back_chain.min(4));
    hash_canonical_rows(rows, &mut hasher);
    hasher.finish()
}

fn hash_canonical_rows(rows: &BoardRows, hasher: &mut FastHasher) {
    let use_direct = rows
        .iter()
        .copied()
        .cmp(rows.iter().copied().map(mirror_row_mask))
        != std::cmp::Ordering::Greater;
    if use_direct {
        for row in rows {
            hasher.write_u16(*row);
        }
    } else {
        for row in rows.iter().copied().map(mirror_row_mask) {
            hasher.write_u16(row);
        }
    }
}

fn mirror_row_mask(row: u16) -> u16 {
    let mut mirrored = 0_u16;
    for x in 0..BOARD_WIDTH {
        if row & (1 << x) != 0 {
            mirrored |= 1 << (BOARD_WIDTH - 1 - x);
        }
    }
    mirrored
}

fn next_search_map_capacity(
    active_states: usize,
    beam_width: usize,
    hold_enabled: bool,
    setup_pool_multiplier: usize,
) -> usize {
    let choices_per_state = if hold_enabled { 2 } else { 1 };
    let state_expansion_hint = active_states.saturating_mul(choices_per_state * 40);
    let prune_pool_hint =
        setup_candidate_pool_width(beam_width, setup_pool_multiplier).saturating_mul(8);
    state_expansion_hint.min(prune_pool_hint).max(beam_width)
}

fn score_t_spin_setup_potential(
    beam: &mut [SearchState],
    future_pieces_by_queue_index: &[FuturePieces],
    max_depth: usize,
    kick_table: KickTable,
    spin_mode: SpinMode,
) {
    let mut potential_by_rows = FastHashMap::<BoardRows, u32>::default();
    let mut quad_well_by_rows = FastHashMap::<BoardRows, u32>::default();
    let allows_t_spin_potential = spin_mode_allows_t_spin_potential(spin_mode);
    let pruning_baseline = if max_depth >= 21 {
        setup_potential_pruning_baseline(beam)
    } else {
        SetupPotentialPruningBaseline::default()
    };
    for state in beam {
        let future_pieces = future_pieces_by_queue_index
            .get(state.queue_index)
            .copied()
            .unwrap_or_default();
        let remaining_depth = max_depth.saturating_sub(state.depth);
        let has_future_t = allows_t_spin_potential
            && can_access_future_piece(state, future_pieces, Piece::T, remaining_depth);
        let has_b2b_i_continuation = state.firepower.back_to_back_chain > 0
            && can_access_future_piece(state, future_pieces, Piece::I, remaining_depth);
        if !has_future_t && !has_b2b_i_continuation {
            state.t_spin_potential = 0;
            continue;
        }

        let should_score_t_spin_potential =
            has_future_t && should_score_exact_t_spin_potential(state.firepower, pruning_baseline);
        state.t_spin_potential = if should_score_t_spin_potential {
            *potential_by_rows
                .entry(state.rows)
                .or_insert_with(|| estimate_t_spin_potential(&state.rows, kick_table))
        } else {
            0
        };
        let quad_well_potential = if has_b2b_i_continuation {
            *quad_well_by_rows
                .entry(state.rows)
                .or_insert_with(|| estimate_quad_well_potential(&state.rows))
        } else {
            0
        };
        state.score = score_state(state.metrics, state.firepower, state.t_spin_potential)
            + quad_well_continuation_score(quad_well_potential, state.firepower.back_to_back_chain);
    }
}

#[derive(Clone, Copy, Default)]
struct SetupPotentialPruningBaseline {
    t_spin_clears: u32,
    t_spin_attack: u32,
    difficult_attack: u32,
    back_to_back_chain: u32,
    all_clears: u32,
}

fn setup_potential_pruning_baseline(beam: &[SearchState]) -> SetupPotentialPruningBaseline {
    let mut baseline = SetupPotentialPruningBaseline::default();
    let min_all_clears = beam
        .iter()
        .map(|state| state.firepower.all_clears)
        .min()
        .unwrap_or(0);
    baseline.all_clears = min_all_clears;
    for state in beam {
        if state.firepower.all_clears != min_all_clears {
            continue;
        }
        baseline.t_spin_clears = baseline.t_spin_clears.max(state.firepower.t_spin_clears);
        baseline.t_spin_attack = baseline.t_spin_attack.max(state.firepower.t_spin_attack);
        baseline.difficult_attack = baseline
            .difficult_attack
            .max(state.firepower.difficult_attack);
        baseline.back_to_back_chain = baseline
            .back_to_back_chain
            .max(state.firepower.back_to_back_chain);
    }
    baseline
}

fn should_score_exact_t_spin_potential(
    firepower: FirepowerState,
    baseline: SetupPotentialPruningBaseline,
) -> bool {
    baseline.t_spin_clears == 0
        || (firepower.all_clears <= baseline.all_clears
            && firepower.t_spin_clears.saturating_add(1) >= baseline.t_spin_clears
            && firepower.t_spin_attack.saturating_add(4) >= baseline.t_spin_attack
            && firepower.difficult_attack.saturating_add(4) >= baseline.difficult_attack
            && firepower.back_to_back_chain.saturating_add(1) >= baseline.back_to_back_chain)
}

fn build_future_pieces_by_queue_index(pieces: &[Piece]) -> Vec<FuturePieces> {
    let mut output = vec![FuturePieces::default(); pieces.len() + 1];
    let mut next_i_offset = None;
    let mut next_t_offset = None;
    for (index, piece) in pieces.iter().copied().enumerate().rev() {
        next_i_offset = next_i_offset.map(|offset: u16| offset.saturating_add(1));
        next_t_offset = next_t_offset.map(|offset: u16| offset.saturating_add(1));
        match piece {
            Piece::I => next_i_offset = Some(0),
            Piece::T => next_t_offset = Some(0),
            _ => {}
        }
        output[index] = FuturePieces {
            next_i_offset,
            next_t_offset,
        };
    }
    output
}

fn can_access_future_piece(
    state: &SearchState,
    future_pieces: FuturePieces,
    piece: Piece,
    remaining_depth: usize,
) -> bool {
    if remaining_depth == 0 {
        return false;
    }
    if state.hold == Some(piece) {
        return true;
    }

    let offset = match piece {
        Piece::I => future_pieces.next_i_offset,
        Piece::T => future_pieces.next_t_offset,
        Piece::O | Piece::S | Piece::Z | Piece::J | Piece::L => None,
    };
    let Some(offset) = offset.map(usize::from) else {
        return false;
    };
    let placements_to_access = if offset == 0 {
        1
    } else if state.hold.is_none() {
        offset
    } else {
        offset + 1
    };
    placements_to_access <= remaining_depth
}

fn spin_mode_allows_t_spin_potential(spin_mode: SpinMode) -> bool {
    spin_mode != SpinMode::None
}

fn piece_choices(
    pieces: &[Piece],
    state: &SearchState,
    hold_enabled: bool,
) -> [Option<PieceChoice>; 2] {
    let Some(current) = pieces.get(state.queue_index).copied() else {
        return [None, None];
    };

    let first = Some(PieceChoice {
        piece: current,
        hold: state.hold,
        queue_index: state.queue_index + 1,
        used_hold: false,
    });
    let second = if hold_enabled {
        match state.hold {
            Some(held) => Some(PieceChoice {
                piece: held,
                hold: Some(current),
                queue_index: state.queue_index + 1,
                used_hold: true,
            }),
            None => pieces
                .get(state.queue_index + 1)
                .copied()
                .map(|next| PieceChoice {
                    piece: next,
                    hold: Some(current),
                    queue_index: state.queue_index + 2,
                    used_hold: true,
                }),
        }
    } else {
        None
    };

    [first, second]
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
    reachable_cache: &mut ReachabilityCache,
    spin_mode: SpinMode,
) -> Option<PlacedBoard> {
    if !is_reachable_placement_with_cache(
        rows,
        choice.piece,
        shape_index,
        x,
        y,
        kick_table,
        reachable_cache,
    ) {
        return None;
    }

    let mut placed = *rows;
    let x_shift = u32::try_from(x).ok()?;
    let base_y = usize::try_from(y).ok()?;
    for dy in 0..shape.height as usize {
        placed[base_y + dy] |= shape.row_masks[dy] << x_shift;
    }
    let (cleared_rows, cleared_lines) = board::clear_full_lines_array_with_count(placed);
    let spin = detect_spin_for_mode(&placed, choice.piece, shape, x, y, cleared_lines, spin_mode);
    Some(PlacedBoard {
        rows: cleared_rows,
        y,
        spin,
        placement: include_placement.then_some(Placement {
            piece: choice.piece,
            rotation: shape.rotation,
            x,
            y,
            used_hold: choice.used_hold,
            spin,
            firepower: FirepowerEvent::empty(),
        }),
    })
}

fn compare_search_state(left: &SearchState, right: &SearchState) -> std::cmp::Ordering {
    let ordering = left.firepower.all_clears.cmp(&right.firepower.all_clears);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right.firepower.spin_clears.cmp(&left.firepower.spin_clears);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right.firepower.spin_attack.cmp(&left.firepower.spin_attack);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right
        .firepower
        .t_spin_clears
        .cmp(&left.firepower.t_spin_clears);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right
        .firepower
        .t_spin_attack
        .cmp(&left.firepower.t_spin_attack);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right
        .firepower
        .difficult_clears
        .cmp(&left.firepower.difficult_clears);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right
        .firepower
        .difficult_attack
        .cmp(&left.firepower.difficult_attack);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right
        .firepower
        .back_to_back_chain
        .cmp(&left.firepower.back_to_back_chain);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right.t_spin_potential.cmp(&left.t_spin_potential);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right.firepower.attack.cmp(&left.firepower.attack);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right.score.total_cmp(&left.score);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right.firepower.points.cmp(&left.firepower.points);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = left.depth.cmp(&right.depth);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    if !left.path.is_empty() || !right.path.is_empty() {
        return left.path.cmp(&right.path);
    }
    left.path_tie_breaker.cmp(&right.path_tie_breaker)
}

fn compare_search_state_to_candidate(
    left: &SearchState,
    right_score: f64,
    right_firepower: FirepowerState,
    right_path_len: usize,
) -> std::cmp::Ordering {
    let ordering = left.firepower.all_clears.cmp(&right_firepower.all_clears);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right_firepower.spin_clears.cmp(&left.firepower.spin_clears);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right_firepower.spin_attack.cmp(&left.firepower.spin_attack);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right_firepower
        .t_spin_clears
        .cmp(&left.firepower.t_spin_clears);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right_firepower
        .t_spin_attack
        .cmp(&left.firepower.t_spin_attack);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right_firepower
        .difficult_clears
        .cmp(&left.firepower.difficult_clears);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right_firepower
        .difficult_attack
        .cmp(&left.firepower.difficult_attack);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right_firepower
        .back_to_back_chain
        .cmp(&left.firepower.back_to_back_chain);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right_firepower.attack.cmp(&left.firepower.attack);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right_score.total_cmp(&left.score);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    let ordering = right_firepower.points.cmp(&left.firepower.points);
    if ordering != std::cmp::Ordering::Equal {
        return ordering;
    }
    left.depth.cmp(&right_path_len)
}

pub(crate) fn validate_beam_width(beam_width: u32) -> Result<usize> {
    usize::try_from(beam_width)
        .ok()
        .filter(|width| *width > 0)
        .ok_or_else(|| Error::from_reason(format!("beamWidth must be positive, got {beam_width}.")))
}

fn validate_setup_candidate_pool_multiplier(multiplier: Option<u32>) -> Result<usize> {
    let multiplier = multiplier.unwrap_or(DEFAULT_SETUP_CANDIDATE_POOL_MULTIPLIER as u32);
    usize::try_from(multiplier)
        .ok()
        .filter(|value| (1..=MAX_SETUP_CANDIDATE_POOL_MULTIPLIER).contains(value))
        .ok_or_else(|| {
            Error::from_reason(format!(
                "setupPoolMultiplier must be between 1 and {MAX_SETUP_CANDIDATE_POOL_MULTIPLIER}, got {multiplier}."
            ))
        })
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
        Self::from_search_state(state, true)
    }
}

impl BeamSearchNode {
    fn from_search_state(state: SearchState, include_path: bool) -> Self {
        Self {
            score: state.score,
            firepower_score: firepower_score(state.firepower),
            depth: state.depth as u32,
            queue_index: state.queue_index as u32,
            hold: state.hold.map(piece_name).map(String::from),
            rows: state.rows.to_vec(),
            path: if include_path {
                state.path.into_iter().map(PlacementStep::format).collect()
            } else {
                Vec::new()
            },
            placements: state
                .placements
                .into_iter()
                .map(BeamPlacement::from)
                .collect(),
            attack: state.firepower.attack,
            points: state.firepower.points,
            combo: state.firepower.combo,
            max_combo: state.firepower.max_combo,
            back_to_back_chain: state.firepower.back_to_back_chain,
            all_clears: state.firepower.all_clears,
            difficult_clears: state.firepower.difficult_clears,
            difficult_attack: state.firepower.difficult_attack,
            spin_clears: state.firepower.spin_clears,
            spin_attack: state.firepower.spin_attack,
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
        let shape = piece_shapes(placement.piece)
            .iter()
            .find(|shape| shape.rotation == placement.rotation)
            .expect("placement rotation must match a declared shape");
        Self {
            piece: piece_name(placement.piece).to_string(),
            rotation: u32::from(placement.rotation),
            x: i32::from(placement.x),
            y: i32::from(placement.y),
            used_hold: placement.used_hold,
            cells: shape
                .cells
                .iter()
                .map(|cell| BeamPlacementCell {
                    x: i32::from(placement.x + cell.x),
                    y: i32::from(placement.y + cell.y),
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
            back_to_back_chain: placement.firepower.back_to_back_chain,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn search_state_with_rows(
        queue_index: usize,
        hold: Option<Piece>,
        rows: BoardRows,
        firepower: FirepowerState,
    ) -> SearchState {
        let metrics = board::evaluate_board_unchecked(&rows);
        SearchState {
            rows,
            hold,
            queue_index,
            depth: 0,
            path: Vec::new(),
            path_tie_breaker: 0,
            placements: Vec::new(),
            score: score_state(metrics, firepower, 0),
            metrics,
            firepower,
            t_spin_potential: 0,
            phase_family_key: 0,
        }
    }

    fn hash_search_key(key: &SearchKey) -> u64 {
        let mut hasher = FastHasher::default();
        key.hash(&mut hasher);
        hasher.finish()
    }

    #[test]
    fn search_key_hash_includes_packed_rows_and_state_fields() {
        let base = SearchKey {
            rows: [0_u16; BOARD_HEIGHT],
            hold: None,
            queue_index: 0,
            combo: 0,
            back_to_back_chain: 0,
        };
        let base_hash = hash_search_key(&base);

        let mut high_row = base.rows;
        high_row[BOARD_HEIGHT - 1] = 1;
        assert_ne!(
            hash_search_key(&SearchKey {
                rows: high_row,
                ..base
            }),
            base_hash
        );
        assert_ne!(
            hash_search_key(&SearchKey {
                hold: Some(Piece::T),
                ..base
            }),
            base_hash
        );
        assert_ne!(
            hash_search_key(&SearchKey {
                queue_index: 1,
                ..base
            }),
            base_hash
        );
        assert_ne!(hash_search_key(&SearchKey { combo: 1, ..base }), base_hash);
        assert_ne!(
            hash_search_key(&SearchKey {
                back_to_back_chain: 1,
                ..base
            }),
            base_hash
        );
    }

    #[test]
    fn phase_family_key_updates_only_at_seven_placement_boundaries() {
        let mut rows = [0_u16; BOARD_HEIGHT];
        rows[0] = 0b1110000000;
        let mut mirrored_rows = [0_u16; BOARD_HEIGHT];
        mirrored_rows[0] = 0b0000000111;
        let mirror_key = next_phase_family_key(0, &mirrored_rows, 7, Some(Piece::T), 2);
        let direct_key = next_phase_family_key(0, &rows, 7, Some(Piece::T), 2);

        assert_eq!(next_phase_family_key(0, &rows, 6, Some(Piece::T), 2), 0);
        assert_ne!(direct_key, 0);
        assert_eq!(direct_key, mirror_key);
        assert_ne!(
            next_phase_family_key(direct_key, &rows, 14, Some(Piece::T), 2),
            direct_key
        );
        assert_ne!(
            next_phase_family_key(0, &rows, 7, Some(Piece::I), 2),
            direct_key
        );
        assert_ne!(
            next_phase_family_key(0, &rows, 7, Some(Piece::T), 0),
            direct_key
        );
    }

    #[test]
    fn row_mirroring_keeps_only_board_width_bits() {
        assert_eq!(mirror_row_mask(0b0000000001), 0b1000000000);
        assert_eq!(mirror_row_mask(0b1000000000), 0b0000000001);
        assert_eq!(mirror_row_mask(0b1011000001), 0b1000001101);
    }

    #[test]
    fn phase_diverse_retention_keeps_alternate_bag_scaffolds() {
        let mut beam = Vec::new();
        for index in 0..40 {
            let mut state =
                search_state_with_rows(14, None, [0_u16; BOARD_HEIGHT], FirepowerState::empty());
            state.phase_family_key = 1;
            state.score = 1000.0 - index as f64;
            beam.push(state);
        }
        for index in 0..4 {
            let mut state =
                search_state_with_rows(14, None, [0_u16; BOARD_HEIGHT], FirepowerState::empty());
            state.phase_family_key = 10 + index;
            state.score = 100.0 - index as f64;
            beam.push(state);
        }

        retain_phase_diverse_search_states(&mut beam, 32, true);

        assert_eq!(beam.len(), 32);
        assert!(beam.iter().any(|state| state.phase_family_key == 1));
        assert!(beam.iter().any(|state| state.phase_family_key == 10));
        assert!(beam.iter().any(|state| state.phase_family_key == 11));
    }

    #[test]
    fn holeless_retention_keeps_equivalent_firepower_candidates() {
        let mut holey_rows = [0_u16; BOARD_HEIGHT];
        holey_rows[1] = 1;
        let mut holeless_rows = [0_u16; BOARD_HEIGHT];
        holeless_rows[0] = 1;
        let mut firepower = FirepowerState::empty();
        firepower.attack = 14;
        firepower.difficult_attack = 14;
        firepower.difficult_clears = 3;
        firepower.spin_attack = 14;
        firepower.spin_clears = 3;
        firepower.t_spin_attack = 14;
        firepower.t_spin_clears = 3;
        firepower.back_to_back_chain = 3;
        let mut beam = Vec::new();
        for index in 0..40 {
            let mut state = search_state_with_rows(21, Some(Piece::I), holey_rows, firepower);
            state.score = 20_000.0 - index as f64;
            beam.push(state);
        }
        for index in 0..4 {
            let mut rows = holeless_rows;
            rows[0] |= 1 << (index + 1);
            let mut state = search_state_with_rows(21, Some(Piece::I), rows, firepower);
            state.score = 1_000.0 - index as f64;
            beam.push(state);
        }

        retain_holeless_diverse_search_states(&mut beam, 32);

        assert_eq!(beam.len(), 32);
        assert!(beam.iter().any(|state| state.metrics[3] == 0));
    }

    #[test]
    fn future_piece_table_tracks_remaining_t_and_i_access() {
        let future_by_index =
            build_future_pieces_by_queue_index(&[Piece::S, Piece::Z, Piece::I, Piece::T, Piece::O]);

        assert_eq!(future_by_index[0].next_i_offset, Some(2));
        assert_eq!(future_by_index[0].next_t_offset, Some(3));
        assert_eq!(future_by_index[2].next_i_offset, Some(0));
        assert_eq!(future_by_index[2].next_t_offset, Some(1));
        assert_eq!(future_by_index[3].next_i_offset, None);
        assert_eq!(future_by_index[3].next_t_offset, Some(0));
        assert_eq!(future_by_index[4].next_i_offset, None);
        assert_eq!(future_by_index[4].next_t_offset, None);
    }

    #[test]
    fn future_piece_access_is_limited_by_remaining_depth() {
        let future_by_index =
            build_future_pieces_by_queue_index(&[Piece::S, Piece::Z, Piece::I, Piece::T, Piece::O]);
        let state = search_state_with_rows(
            0,
            Some(Piece::O),
            [0_u16; BOARD_HEIGHT],
            FirepowerState::empty(),
        );

        assert!(!can_access_future_piece(
            &state,
            future_by_index[0],
            Piece::I,
            2
        ));
        assert!(can_access_future_piece(
            &state,
            future_by_index[0],
            Piece::I,
            3
        ));
    }

    #[test]
    fn setup_scoring_keeps_hold_available_after_queue_end() {
        let future_by_index = build_future_pieces_by_queue_index(&[Piece::S, Piece::Z]);
        let mut rows = [0_u16; BOARD_HEIGHT];
        for row in rows.iter_mut().take(4) {
            *row = 0b1111111111 ^ (1 << 9);
        }
        let mut firepower = FirepowerState::empty();
        firepower.back_to_back_chain = 2;
        let base_score = score_state(board::evaluate_board_unchecked(&rows), firepower, 0);
        let mut beam = vec![search_state_with_rows(2, Some(Piece::I), rows, firepower)];

        score_t_spin_setup_potential(
            &mut beam,
            &future_by_index,
            1,
            KickTable::SrsPlus,
            SpinMode::TSpins,
        );

        assert!(beam[0].score > base_score);
    }

    #[test]
    fn setup_potential_pruning_keeps_nearby_b2b_t_spin_states() {
        let baseline = SetupPotentialPruningBaseline {
            t_spin_clears: 3,
            t_spin_attack: 12,
            difficult_attack: 12,
            back_to_back_chain: 3,
            all_clears: 0,
        };
        let mut near = FirepowerState::empty();
        near.spin_clears = 2;
        near.spin_attack = 8;
        near.t_spin_clears = 2;
        near.t_spin_attack = 8;
        near.difficult_attack = 8;
        near.back_to_back_chain = 2;
        let mut far = FirepowerState::empty();
        far.spin_clears = 1;
        far.spin_attack = 4;
        far.t_spin_clears = 1;
        far.t_spin_attack = 4;
        far.difficult_attack = 4;
        far.back_to_back_chain = 1;

        assert!(should_score_exact_t_spin_potential(near, baseline));
        assert!(!should_score_exact_t_spin_potential(far, baseline));
        assert!(should_score_exact_t_spin_potential(
            FirepowerState::empty(),
            SetupPotentialPruningBaseline::default(),
        ));
    }

    #[test]
    fn setup_potential_pruning_baseline_ignores_all_clear_boosted_attack() {
        let mut clean = search_state_with_rows(
            21,
            Some(Piece::T),
            [0_u16; BOARD_HEIGHT],
            FirepowerState::empty(),
        );
        clean.firepower.t_spin_clears = 3;
        clean.firepower.t_spin_attack = 14;
        clean.firepower.difficult_attack = 14;
        clean.firepower.back_to_back_chain = 3;

        let mut boosted = clean.clone();
        boosted.firepower.all_clears = 1;
        boosted.firepower.t_spin_attack = 24;
        boosted.firepower.difficult_attack = 24;

        let baseline = setup_potential_pruning_baseline(&[boosted.clone(), clean.clone()]);

        assert_eq!(baseline.all_clears, 0);
        assert_eq!(baseline.t_spin_attack, 14);
        assert!(should_score_exact_t_spin_potential(
            clean.firepower,
            baseline
        ));
        assert!(!should_score_exact_t_spin_potential(
            boosted.firepower,
            baseline
        ));
    }
}
