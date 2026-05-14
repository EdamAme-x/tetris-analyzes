use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::OnceLock;

const BOARD_WIDTH: usize = 10;
const BOARD_HEIGHT: usize = 20;
const BOARD_EVALUATION_STRIDE: usize = 5;
const FUMEN_FIELD_HEIGHT: usize = 23;
const ROW_MASK: u16 = (1 << BOARD_WIDTH) - 1;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum Piece {
    I,
    O,
    T,
    S,
    Z,
    J,
    L,
}

#[derive(Clone, Copy)]
struct Cell {
    x: i8,
    y: i8,
}

#[derive(Clone, Copy)]
struct Shape {
    rotation: u8,
    width: i8,
    height: i8,
    cells: &'static [Cell],
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct MovementState {
    shape_index: usize,
    x: i8,
    y: i8,
}

#[derive(Clone)]
struct SearchState {
    rows: [u16; BOARD_HEIGHT],
    hold: Option<Piece>,
    queue_index: usize,
    path: Vec<String>,
    placements: Vec<Placement>,
    score: f64,
    metrics: [u32; BOARD_EVALUATION_STRIDE],
}

#[derive(Eq, Hash, PartialEq)]
struct SearchKey {
    rows: [u16; BOARD_HEIGHT],
    hold: Option<Piece>,
    queue_index: usize,
}

#[napi(object)]
pub struct BeamSearchNode {
    pub score: f64,
    pub depth: u32,
    pub queue_index: u32,
    pub hold: Option<String>,
    pub rows: Vec<u16>,
    pub path: Vec<String>,
    pub placements: Vec<BeamPlacement>,
    pub occupied_cells: u32,
    pub cleared_lines: u32,
    pub aggregate_height: u32,
    pub holes: u32,
    pub bumpiness: u32,
}

#[derive(Clone)]
struct Placement {
    piece: Piece,
    rotation: u8,
    x: i8,
    y: i8,
    used_hold: bool,
    cells: Vec<Cell>,
}

struct PlacedBoard {
    rows: [u16; BOARD_HEIGHT],
    y: i8,
    placement: Option<Placement>,
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
}

#[derive(Clone, Copy)]
struct PieceChoice {
    piece: Piece,
    hold: Option<Piece>,
    queue_index: usize,
    used_hold: bool,
}

#[napi(js_name = "createEmptyBoard")]
pub fn create_empty_board() -> Uint16Array {
    vec![0_u16; BOARD_HEIGHT].into()
}

#[napi(js_name = "copyBoardRows")]
pub fn copy_board_rows(rows: Uint16Array) -> Result<Uint16Array> {
    let rows = rows.as_ref();
    validate_single_board(rows)?;
    Ok(rows.to_vec().into())
}

#[napi(js_name = "isPerfectClear")]
pub fn is_perfect_clear(rows: Uint16Array) -> Result<bool> {
    let rows = rows.as_ref();
    validate_single_board_shape(rows)?;

    for (index, row) in rows.iter().copied().enumerate() {
        validate_row(row, index)?;
        if row != 0 {
            return Ok(false);
        }
    }

    Ok(true)
}

#[napi(js_name = "countOccupiedCells")]
pub fn count_occupied_cells(rows: Uint16Array) -> Result<u32> {
    let rows = rows.as_ref();
    validate_single_board_shape(rows)?;
    count_occupied_cells_in_rows(rows, 0)
}

#[napi(js_name = "clearFullLines")]
pub fn clear_full_lines(rows: Uint16Array) -> Result<Uint16Array> {
    let rows = rows.as_ref();
    validate_single_board_shape(rows)?;

    let mut output = vec![0_u16; BOARD_HEIGHT];
    clear_full_lines_into(rows, &mut output, 0)?;

    Ok(output.into())
}

#[napi(js_name = "batchCountOccupiedCells")]
pub fn batch_count_occupied_cells(rows: Uint16Array, board_count: u32) -> Result<Uint32Array> {
    let rows = rows.as_ref();
    let board_count = board_count as usize;
    validate_board_shape(rows, board_count)?;

    let mut counts = Vec::with_capacity(board_count);
    for board_index in 0..board_count {
        let offset = board_index * BOARD_HEIGHT;
        counts.push(count_occupied_cells_in_rows(
            &rows[offset..offset + BOARD_HEIGHT],
            offset,
        )?);
    }

    Ok(counts.into())
}

#[napi(js_name = "batchClearFullLines")]
pub fn batch_clear_full_lines(rows: Uint16Array, board_count: u32) -> Result<Uint16Array> {
    let rows = rows.as_ref();
    let board_count = board_count as usize;
    validate_board_shape(rows, board_count)?;

    let mut output = vec![0_u16; rows.len()];
    for board_index in 0..board_count {
        let offset = board_index * BOARD_HEIGHT;
        clear_full_lines_into(
            &rows[offset..offset + BOARD_HEIGHT],
            &mut output[offset..offset + BOARD_HEIGHT],
            offset,
        )?;
    }

    Ok(output.into())
}

#[napi(js_name = "batchEvaluateBoards")]
pub fn batch_evaluate_boards(rows: Uint16Array, board_count: u32) -> Result<Uint32Array> {
    let rows = rows.as_ref();
    let board_count = board_count as usize;
    validate_board_shape(rows, board_count)?;

    let mut evaluations = Vec::with_capacity(board_count * BOARD_EVALUATION_STRIDE);
    for board_index in 0..board_count {
        let offset = board_index * BOARD_HEIGHT;
        evaluations.extend_from_slice(&evaluate_board(
            &rows[offset..offset + BOARD_HEIGHT],
            offset,
        )?);
    }

    Ok(evaluations.into())
}

#[napi(js_name = "createGarbageRows")]
pub fn create_garbage_rows(holes: Uint8Array) -> Result<Uint16Array> {
    let holes = holes.as_ref();
    validate_garbage_holes(holes)?;

    let rows = holes
        .iter()
        .map(|hole| ROW_MASK ^ (1_u16 << *hole))
        .collect::<Vec<u16>>();
    Ok(rows.into())
}

#[napi(js_name = "applyGarbage")]
pub fn apply_garbage(rows: Uint16Array, holes: Uint8Array) -> Result<Uint16Array> {
    let rows = rows.as_ref();
    let holes = holes.as_ref();
    validate_single_board_shape(rows)?;
    for (index, row) in rows.iter().copied().enumerate() {
        validate_row(row, index)?;
    }
    validate_garbage_holes(holes)?;

    if holes.len() > BOARD_HEIGHT {
        return Err(Error::from_reason(format!(
            "Cannot apply more than {BOARD_HEIGHT} garbage rows, got {}.",
            holes.len()
        )));
    }

    let mut output = vec![0_u16; BOARD_HEIGHT];
    for (index, hole) in holes.iter().copied().enumerate() {
        output[index] = ROW_MASK ^ (1_u16 << hole);
    }
    for y in holes.len()..BOARD_HEIGHT {
        output[y] = rows[y - holes.len()];
    }

    Ok(output.into())
}

#[napi(js_name = "rowsToFumenField")]
pub fn rows_to_fumen_field(rows: Uint16Array) -> Result<String> {
    let rows = rows.as_ref();
    validate_single_board_shape(rows)?;
    rows_to_fumen_field_string(rows)
}

#[napi(js_name = "batchRowsToFumenFields")]
pub fn batch_rows_to_fumen_fields(rows: Uint16Array, board_count: u32) -> Result<Vec<String>> {
    let rows = rows.as_ref();
    let board_count = board_count as usize;
    validate_board_shape(rows, board_count)?;

    let mut fields = Vec::with_capacity(board_count);
    for board_index in 0..board_count {
        let offset = board_index * BOARD_HEIGHT;
        fields.push(rows_to_fumen_field_string(
            &rows[offset..offset + BOARD_HEIGHT],
        )?);
    }

    Ok(fields)
}

#[napi(js_name = "canReachOpenerPlacement")]
pub fn can_reach_opener_placement(
    rows: Uint16Array,
    piece: String,
    rotation: u32,
    x: i32,
    y: i32,
) -> Result<bool> {
    let rows = rows.as_ref();
    validate_single_board(rows)?;
    let board = rows_to_array(rows)?;
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
    let initial_metrics = evaluate_board_unchecked(&empty_rows);
    let mut beam = vec![SearchState {
        rows: empty_rows,
        hold: None,
        queue_index: 0,
        path: Vec::new(),
        placements: Vec::new(),
        score: score_metrics(initial_metrics),
        metrics: initial_metrics,
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
                            let metrics = evaluate_board_unchecked(&rows);
                            let score = score_metrics(metrics);
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
                                if let Some(placement) = placed.placement {
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
                            };
                            let key = SearchKey {
                                rows,
                                hold: choice.hold,
                                queue_index: choice.queue_index,
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

fn validate_board_shape(rows: &[u16], board_count: usize) -> Result<()> {
    let expected_rows = board_count.checked_mul(BOARD_HEIGHT).ok_or_else(|| {
        Error::from_reason(format!(
            "boardCount is too large to fit {BOARD_HEIGHT}-row boards."
        ))
    })?;
    if rows.len() != expected_rows {
        return Err(Error::from_reason(format!(
            "Expected {expected_rows} row values, got {}.",
            rows.len()
        )));
    }

    Ok(())
}

fn validate_single_board(rows: &[u16]) -> Result<()> {
    validate_single_board_shape(rows)?;
    for (index, row) in rows.iter().copied().enumerate() {
        validate_row(row, index)?;
    }
    Ok(())
}

fn rows_to_array(rows: &[u16]) -> Result<[u16; BOARD_HEIGHT]> {
    validate_single_board(rows)?;
    let mut output = [0_u16; BOARD_HEIGHT];
    output.copy_from_slice(rows);
    Ok(output)
}

fn validate_single_board_shape(rows: &[u16]) -> Result<()> {
    validate_board_shape(rows, 1)
}

fn validate_row(row: u16, index: usize) -> Result<()> {
    if row & !ROW_MASK != 0 {
        return Err(Error::from_reason(format!(
            "Row {index} must fit in {BOARD_WIDTH} bits, got {row}."
        )));
    }
    Ok(())
}

fn validate_garbage_holes(holes: &[u8]) -> Result<()> {
    for (index, hole) in holes.iter().copied().enumerate() {
        if usize::from(hole) >= BOARD_WIDTH {
            return Err(Error::from_reason(format!(
                "Garbage hole {index} must be between 0 and {}, got {hole}.",
                BOARD_WIDTH - 1
            )));
        }
    }
    Ok(())
}

fn count_occupied_cells_in_rows(rows: &[u16], row_offset: usize) -> Result<u32> {
    let mut count = 0;
    for (index, row) in rows.iter().copied().enumerate() {
        validate_row(row, row_offset + index)?;
        count += row.count_ones();
    }
    Ok(count)
}

fn clear_full_lines_into(rows: &[u16], output: &mut [u16], row_offset: usize) -> Result<()> {
    let mut write_y = 0;
    for (index, row) in rows.iter().copied().enumerate() {
        validate_row(row, row_offset + index)?;
        if row != ROW_MASK {
            output[write_y] = row;
            write_y += 1;
        }
    }
    Ok(())
}

fn evaluate_board(rows: &[u16], row_offset: usize) -> Result<[u32; BOARD_EVALUATION_STRIDE]> {
    let mut occupied_cells = 0;
    let mut cleared_lines = 0;
    let mut column_masks = [0_u32; BOARD_WIDTH];

    for (y, row) in rows.iter().copied().enumerate() {
        validate_row(row, row_offset + y)?;
        occupied_cells += row.count_ones();
        if row == ROW_MASK {
            cleared_lines += 1;
        }
        for (x, column_mask) in column_masks.iter_mut().enumerate() {
            if row & (1_u16 << x) != 0 {
                *column_mask |= 1_u32 << y;
            }
        }
    }

    let mut aggregate_height = 0;
    let mut holes = 0;
    let mut previous_height: Option<u32> = None;
    let mut bumpiness = 0;
    for column_mask in column_masks {
        let height = if column_mask == 0 {
            0
        } else {
            u32::BITS - column_mask.leading_zeros()
        };
        aggregate_height += height;
        holes += height - column_mask.count_ones();
        if let Some(previous) = previous_height {
            bumpiness += previous.abs_diff(height);
        }
        previous_height = Some(height);
    }

    Ok([
        occupied_cells,
        cleared_lines,
        aggregate_height,
        holes,
        bumpiness,
    ])
}

fn evaluate_board_unchecked(rows: &[u16; BOARD_HEIGHT]) -> [u32; BOARD_EVALUATION_STRIDE] {
    let mut occupied_cells = 0;
    let mut cleared_lines = 0;
    let mut column_masks = [0_u32; BOARD_WIDTH];

    for (y, row) in rows.iter().copied().enumerate() {
        occupied_cells += row.count_ones();
        if row == ROW_MASK {
            cleared_lines += 1;
        }
        for (x, column_mask) in column_masks.iter_mut().enumerate() {
            if row & (1_u16 << x) != 0 {
                *column_mask |= 1_u32 << y;
            }
        }
    }

    let mut aggregate_height = 0;
    let mut holes = 0;
    let mut previous_height: Option<u32> = None;
    let mut bumpiness = 0;
    for column_mask in column_masks {
        let height = if column_mask == 0 {
            0
        } else {
            u32::BITS - column_mask.leading_zeros()
        };
        aggregate_height += height;
        holes += height - column_mask.count_ones();
        if let Some(previous) = previous_height {
            bumpiness += previous.abs_diff(height);
        }
        previous_height = Some(height);
    }

    [
        occupied_cells,
        cleared_lines,
        aggregate_height,
        holes,
        bumpiness,
    ]
}

fn score_metrics(metrics: [u32; BOARD_EVALUATION_STRIDE]) -> f64 {
    let cleared_lines = metrics[1] as f64;
    let aggregate_height = metrics[2] as f64;
    let holes = metrics[3] as f64;
    let bumpiness = metrics[4] as f64;
    cleared_lines * 120.0 - holes * 90.0 - aggregate_height * 2.2 - bumpiness * 7.0
}

fn compare_search_state(left: &SearchState, right: &SearchState) -> std::cmp::Ordering {
    right
        .score
        .total_cmp(&left.score)
        .then_with(|| left.path.len().cmp(&right.path.len()))
        .then_with(|| left.queue_index.cmp(&right.queue_index))
}

fn parse_queue(queue: &str) -> Result<Vec<Piece>> {
    let mut pieces = Vec::new();
    for char in queue
        .chars()
        .filter(|char| !char.is_whitespace() && *char != ',')
    {
        pieces.push(parse_piece(char)?);
    }
    if pieces.is_empty() {
        return Err(Error::from_reason(
            "queue must contain at least one tetromino.",
        ));
    }
    Ok(pieces)
}

fn parse_piece(char: char) -> Result<Piece> {
    match char.to_ascii_uppercase() {
        'I' => Ok(Piece::I),
        'O' => Ok(Piece::O),
        'T' => Ok(Piece::T),
        'S' => Ok(Piece::S),
        'Z' => Ok(Piece::Z),
        'J' => Ok(Piece::J),
        'L' => Ok(Piece::L),
        _ => Err(Error::from_reason(format!("Unknown tetromino {char}."))),
    }
}

fn parse_piece_string(input: &str) -> Result<Piece> {
    let mut chars = input.chars().filter(|char| !char.is_whitespace());
    let Some(char) = chars.next() else {
        return Err(Error::from_reason("piece must contain one tetromino."));
    };
    if chars.next().is_some() {
        return Err(Error::from_reason(format!(
            "piece must contain one tetromino, got {input}."
        )));
    }
    parse_piece(char)
}

fn piece_name(piece: Piece) -> &'static str {
    match piece {
        Piece::I => "I",
        Piece::O => "O",
        Piece::T => "T",
        Piece::S => "S",
        Piece::Z => "Z",
        Piece::J => "J",
        Piece::L => "L",
    }
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

fn format_placement(piece: Piece, rotation: u8, x: i8, y: i8, used_hold: bool) -> String {
    let prefix = if used_hold { "hold:" } else { "" };
    format!("{prefix}{}@r{},x{},y{}", piece_name(piece), rotation, x, y)
}

fn place_and_clear(
    rows: &[u16; BOARD_HEIGHT],
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

            let mut placed = *rows;
            let mut cells = if include_placement {
                Some(Vec::with_capacity(shape.cells.len()))
            } else {
                None
            };
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
            return Some(PlacedBoard {
                rows: clear_full_lines_array(placed),
                y,
                placement: cells.map(|cells| Placement {
                    piece: choice.piece,
                    rotation: shape.rotation,
                    x,
                    y,
                    used_hold: choice.used_hold,
                    cells,
                }),
            });
        }
    }
    None
}

fn is_reachable_placement(
    rows: &[u16; BOARD_HEIGHT],
    piece: Piece,
    target_shape_index: usize,
    target_x: i8,
    target_y: i8,
) -> bool {
    let shapes = piece_shapes(piece);
    let spawn_shape = shapes[0];
    let spawn = MovementState {
        shape_index: 0,
        x: (BOARD_WIDTH as i8 - spawn_shape.width) / 2,
        y: BOARD_HEIGHT as i8 - spawn_shape.height,
    };

    if !can_place(rows, spawn_shape, spawn.x, spawn.y) {
        return false;
    }

    let target = MovementState {
        shape_index: target_shape_index,
        x: target_x,
        y: target_y,
    };
    if has_clear_vertical_drop(rows, shapes[target_shape_index], target_x, target_y) {
        return true;
    }

    let mut visited = HashSet::new();
    let mut queue = VecDeque::from([spawn]);
    visited.insert(spawn);

    while let Some(state) = queue.pop_front() {
        if state == target {
            return true;
        }

        push_movement_state(
            rows,
            shapes,
            state,
            state.shape_index,
            state.x - 1,
            state.y,
            &mut visited,
            &mut queue,
        );
        push_movement_state(
            rows,
            shapes,
            state,
            state.shape_index,
            state.x + 1,
            state.y,
            &mut visited,
            &mut queue,
        );
        push_movement_state(
            rows,
            shapes,
            state,
            state.shape_index,
            state.x,
            state.y - 1,
            &mut visited,
            &mut queue,
        );
        push_rotation_states(rows, piece, shapes, state, 1, &mut visited, &mut queue);
        push_rotation_states(rows, piece, shapes, state, -1, &mut visited, &mut queue);
    }

    false
}

fn has_clear_vertical_drop(rows: &[u16; BOARD_HEIGHT], shape: Shape, x: i8, target_y: i8) -> bool {
    let spawn_y = BOARD_HEIGHT as i8 - shape.height;
    if target_y > spawn_y {
        return false;
    }
    for y in target_y..=spawn_y {
        if !can_place(rows, shape, x, y) {
            return false;
        }
    }
    true
}

fn push_movement_state(
    rows: &[u16; BOARD_HEIGHT],
    shapes: &[Shape],
    _from: MovementState,
    shape_index: usize,
    x: i8,
    y: i8,
    visited: &mut HashSet<MovementState>,
    queue: &mut VecDeque<MovementState>,
) {
    if y < 0 {
        return;
    }
    let shape = shapes[shape_index];
    if !can_place(rows, shape, x, y) {
        return;
    }

    let next = MovementState { shape_index, x, y };
    if visited.insert(next) {
        queue.push_back(next);
    }
}

fn push_rotation_states(
    rows: &[u16; BOARD_HEIGHT],
    piece: Piece,
    shapes: &[Shape],
    state: MovementState,
    direction: i8,
    visited: &mut HashSet<MovementState>,
    queue: &mut VecDeque<MovementState>,
) {
    if shapes.len() <= 1 {
        return;
    }

    let next_shape_index = if direction > 0 {
        (state.shape_index + 1) % shapes.len()
    } else {
        (state.shape_index + shapes.len() - 1) % shapes.len()
    };
    let from_rotation = shapes[state.shape_index].rotation;
    let to_rotation = shapes[next_shape_index].rotation;
    let next_shape = shapes[next_shape_index];

    for kick in srs_plus_kicks(piece, from_rotation, to_rotation) {
        let x = state.x + kick.x;
        let y = state.y + kick.y;
        if can_place(rows, next_shape, x, y) {
            let next = MovementState {
                shape_index: next_shape_index,
                x,
                y,
            };
            if visited.insert(next) {
                queue.push_back(next);
            }
        }
    }
}

fn can_place(rows: &[u16; BOARD_HEIGHT], shape: Shape, x: i8, y: i8) -> bool {
    for cell in shape.cells {
        let board_x = x + cell.x;
        let board_y = y + cell.y;
        if board_x < 0
            || board_x >= BOARD_WIDTH as i8
            || board_y < 0
            || board_y >= BOARD_HEIGHT as i8
        {
            return false;
        }
        if rows[board_y as usize] & (1_u16 << board_x) != 0 {
            return false;
        }
    }
    true
}

fn srs_plus_kicks(piece: Piece, from_rotation: u8, to_rotation: u8) -> &'static [Cell] {
    if piece == Piece::I {
        match (from_rotation, to_rotation) {
            (0, 1) => I_KICKS_01,
            (1, 0) => I_KICKS_10,
            _ => BASIC_KICKS,
        }
    } else {
        match (from_rotation, to_rotation) {
            (0, 1) | (2, 1) => JLSTZ_KICKS_01,
            (1, 0) | (1, 2) => JLSTZ_KICKS_10,
            (2, 3) | (0, 3) => JLSTZ_KICKS_23,
            (3, 2) | (3, 0) => JLSTZ_KICKS_32,
            _ => BASIC_KICKS,
        }
    }
}

const BASIC_KICKS: &[Cell] = &[Cell { x: 0, y: 0 }];
const JLSTZ_KICKS_01: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: -1, y: 0 },
    Cell { x: -1, y: -1 },
    Cell { x: 0, y: 2 },
    Cell { x: -1, y: 2 },
];
const JLSTZ_KICKS_10: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: 1, y: 0 },
    Cell { x: 1, y: 1 },
    Cell { x: 0, y: -2 },
    Cell { x: 1, y: -2 },
];
const JLSTZ_KICKS_23: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: 1, y: 0 },
    Cell { x: 1, y: -1 },
    Cell { x: 0, y: 2 },
    Cell { x: 1, y: 2 },
];
const JLSTZ_KICKS_32: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: -1, y: 0 },
    Cell { x: -1, y: 1 },
    Cell { x: 0, y: -2 },
    Cell { x: -1, y: -2 },
];
const I_KICKS_01: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: 1, y: 0 },
    Cell { x: -2, y: 0 },
    Cell { x: -2, y: 1 },
    Cell { x: 1, y: -2 },
];
const I_KICKS_10: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: -1, y: 0 },
    Cell { x: 2, y: 0 },
    Cell { x: -1, y: 2 },
    Cell { x: 2, y: -1 },
];

fn clear_full_lines_array(rows: [u16; BOARD_HEIGHT]) -> [u16; BOARD_HEIGHT] {
    let mut output = [0_u16; BOARD_HEIGHT];
    let mut write_y = 0;
    for row in rows {
        if row != ROW_MASK {
            output[write_y] = row;
            write_y += 1;
        }
    }
    output
}

impl From<SearchState> for BeamSearchNode {
    fn from(state: SearchState) -> Self {
        Self {
            score: state.score,
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
        }
    }
}

const I0: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: 1, y: 0 },
    Cell { x: 2, y: 0 },
    Cell { x: 3, y: 0 },
];
const I1: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: 0, y: 1 },
    Cell { x: 0, y: 2 },
    Cell { x: 0, y: 3 },
];
const O0: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: 1, y: 0 },
    Cell { x: 0, y: 1 },
    Cell { x: 1, y: 1 },
];
const T0: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: 1, y: 0 },
    Cell { x: 2, y: 0 },
    Cell { x: 1, y: 1 },
];
const T1: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: 0, y: 1 },
    Cell { x: 0, y: 2 },
    Cell { x: 1, y: 1 },
];
const T2: &[Cell] = &[
    Cell { x: 0, y: 1 },
    Cell { x: 1, y: 1 },
    Cell { x: 2, y: 1 },
    Cell { x: 1, y: 0 },
];
const T3: &[Cell] = &[
    Cell { x: 1, y: 0 },
    Cell { x: 1, y: 1 },
    Cell { x: 1, y: 2 },
    Cell { x: 0, y: 1 },
];
const S0: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: 1, y: 0 },
    Cell { x: 1, y: 1 },
    Cell { x: 2, y: 1 },
];
const S1: &[Cell] = &[
    Cell { x: 1, y: 0 },
    Cell { x: 0, y: 1 },
    Cell { x: 1, y: 1 },
    Cell { x: 0, y: 2 },
];
const Z0: &[Cell] = &[
    Cell { x: 1, y: 0 },
    Cell { x: 2, y: 0 },
    Cell { x: 0, y: 1 },
    Cell { x: 1, y: 1 },
];
const Z1: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: 0, y: 1 },
    Cell { x: 1, y: 1 },
    Cell { x: 1, y: 2 },
];
const J0: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: 1, y: 0 },
    Cell { x: 2, y: 0 },
    Cell { x: 0, y: 1 },
];
const J1: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: 0, y: 1 },
    Cell { x: 0, y: 2 },
    Cell { x: 1, y: 0 },
];
const J2: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: 0, y: 1 },
    Cell { x: 1, y: 1 },
    Cell { x: 2, y: 1 },
];
const J3: &[Cell] = &[
    Cell { x: 1, y: 0 },
    Cell { x: 1, y: 1 },
    Cell { x: 1, y: 2 },
    Cell { x: 0, y: 2 },
];
const L0: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: 1, y: 0 },
    Cell { x: 2, y: 0 },
    Cell { x: 2, y: 1 },
];
const L1: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: 0, y: 1 },
    Cell { x: 0, y: 2 },
    Cell { x: 1, y: 2 },
];
const L2: &[Cell] = &[
    Cell { x: 0, y: 1 },
    Cell { x: 1, y: 1 },
    Cell { x: 2, y: 1 },
    Cell { x: 0, y: 0 },
];
const L3: &[Cell] = &[
    Cell { x: 1, y: 0 },
    Cell { x: 1, y: 1 },
    Cell { x: 1, y: 2 },
    Cell { x: 0, y: 0 },
];

const I_SHAPES: &[Shape] = &[
    Shape {
        rotation: 0,
        width: 4,
        height: 1,
        cells: I0,
    },
    Shape {
        rotation: 1,
        width: 1,
        height: 4,
        cells: I1,
    },
];
const O_SHAPES: &[Shape] = &[Shape {
    rotation: 0,
    width: 2,
    height: 2,
    cells: O0,
}];
const T_SHAPES: &[Shape] = &[
    Shape {
        rotation: 0,
        width: 3,
        height: 2,
        cells: T0,
    },
    Shape {
        rotation: 1,
        width: 2,
        height: 3,
        cells: T1,
    },
    Shape {
        rotation: 2,
        width: 3,
        height: 2,
        cells: T2,
    },
    Shape {
        rotation: 3,
        width: 2,
        height: 3,
        cells: T3,
    },
];
const S_SHAPES: &[Shape] = &[
    Shape {
        rotation: 0,
        width: 3,
        height: 2,
        cells: S0,
    },
    Shape {
        rotation: 1,
        width: 2,
        height: 3,
        cells: S1,
    },
];
const Z_SHAPES: &[Shape] = &[
    Shape {
        rotation: 0,
        width: 3,
        height: 2,
        cells: Z0,
    },
    Shape {
        rotation: 1,
        width: 2,
        height: 3,
        cells: Z1,
    },
];
const J_SHAPES: &[Shape] = &[
    Shape {
        rotation: 0,
        width: 3,
        height: 2,
        cells: J0,
    },
    Shape {
        rotation: 1,
        width: 2,
        height: 3,
        cells: J1,
    },
    Shape {
        rotation: 2,
        width: 3,
        height: 2,
        cells: J2,
    },
    Shape {
        rotation: 3,
        width: 2,
        height: 3,
        cells: J3,
    },
];
const L_SHAPES: &[Shape] = &[
    Shape {
        rotation: 0,
        width: 3,
        height: 2,
        cells: L0,
    },
    Shape {
        rotation: 1,
        width: 2,
        height: 3,
        cells: L1,
    },
    Shape {
        rotation: 2,
        width: 3,
        height: 2,
        cells: L2,
    },
    Shape {
        rotation: 3,
        width: 2,
        height: 3,
        cells: L3,
    },
];

fn piece_shapes(piece: Piece) -> &'static [Shape] {
    match piece {
        Piece::I => I_SHAPES,
        Piece::O => O_SHAPES,
        Piece::T => T_SHAPES,
        Piece::S => S_SHAPES,
        Piece::Z => Z_SHAPES,
        Piece::J => J_SHAPES,
        Piece::L => L_SHAPES,
    }
}

fn rows_to_fumen_field_string(rows: &[u16]) -> Result<String> {
    let mut field = String::with_capacity(FUMEN_FIELD_HEIGHT * BOARD_WIDTH);
    let lookup = fumen_row_lookup();

    for y in (0..FUMEN_FIELD_HEIGHT).rev() {
        let row = if y < BOARD_HEIGHT { rows[y] } else { 0 };
        validate_row(row, y)?;
        field.push_str(&lookup[usize::from(row)]);
    }

    Ok(field)
}

fn fumen_row_lookup() -> &'static Vec<String> {
    static ROWS: OnceLock<Vec<String>> = OnceLock::new();
    ROWS.get_or_init(|| {
        (0..=ROW_MASK)
            .map(|row| {
                let mut text = String::with_capacity(BOARD_WIDTH);
                for x in 0..BOARD_WIDTH {
                    if row & (1_u16 << x) == 0 {
                        text.push('_');
                    } else {
                        text.push('X');
                    }
                }
                text
            })
            .collect()
    })
}
