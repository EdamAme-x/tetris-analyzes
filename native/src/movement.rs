use std::collections::{HashSet, VecDeque};

use napi::bindgen_prelude::{Error, Result};

use crate::board::{BoardRows, BOARD_HEIGHT, BOARD_WIDTH};
use crate::pieces::{piece_shapes, Cell, Piece, Shape};

#[derive(Clone, Copy, Eq, PartialEq)]
pub(crate) enum KickTable {
    SrsPlus,
    Srs,
    None,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) struct MovementState {
    pub(crate) shape_index: usize,
    pub(crate) x: i8,
    pub(crate) y: i8,
}

pub(crate) fn is_reachable_placement(
    rows: &BoardRows,
    piece: Piece,
    target_shape_index: usize,
    target_x: i8,
    target_y: i8,
    kick_table: KickTable,
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
        push_rotation_states(
            rows,
            piece,
            shapes,
            state,
            1,
            kick_table,
            &mut visited,
            &mut queue,
        );
        push_rotation_states(
            rows,
            piece,
            shapes,
            state,
            -1,
            kick_table,
            &mut visited,
            &mut queue,
        );
    }

    false
}

pub(crate) fn has_clear_vertical_drop(rows: &BoardRows, shape: Shape, x: i8, target_y: i8) -> bool {
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

pub(crate) fn push_movement_state(
    rows: &BoardRows,
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

pub(crate) fn push_rotation_states(
    rows: &BoardRows,
    piece: Piece,
    shapes: &[Shape],
    state: MovementState,
    direction: i8,
    kick_table: KickTable,
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

    for kick in kicks_for(kick_table, piece, from_rotation, to_rotation) {
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

pub(crate) fn parse_kick_table(input: &str) -> Result<KickTable> {
    let normalized = input.trim().to_ascii_uppercase();
    match normalized.as_str() {
        "SRS+" | "SRS PLUS" | "SRS_PLUS" => Ok(KickTable::SrsPlus),
        "SRS" => Ok(KickTable::Srs),
        "NONE" => Ok(KickTable::None),
        _ => Err(Error::from_reason(format!(
            "Unsupported native opener kick table {input}. Supported tables are SRS+, SRS, and NONE."
        ))),
    }
}

pub(crate) fn kicks_for(
    kick_table: KickTable,
    piece: Piece,
    from_rotation: u8,
    to_rotation: u8,
) -> &'static [Cell] {
    if kick_table == KickTable::None {
        return BASIC_KICKS;
    }

    if piece == Piece::I {
        return match (kick_table, from_rotation, to_rotation) {
            (KickTable::SrsPlus, 0, 1) => SRS_PLUS_I_KICKS_01,
            (KickTable::SrsPlus, 1, 0) => SRS_PLUS_I_KICKS_10,
            (KickTable::Srs, 0, 1) => SRS_I_KICKS_01,
            (KickTable::Srs, 1, 0) => SRS_I_KICKS_10,
            _ => BASIC_KICKS,
        };
    }

    match (from_rotation, to_rotation) {
        (0, 1) | (2, 1) => JLSTZ_KICKS_01,
        (1, 0) | (1, 2) => JLSTZ_KICKS_10,
        (2, 3) | (0, 3) => JLSTZ_KICKS_23,
        (3, 2) | (3, 0) => JLSTZ_KICKS_32,
        _ => BASIC_KICKS,
    }
}

pub(crate) fn can_place(rows: &BoardRows, shape: Shape, x: i8, y: i8) -> bool {
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

pub(crate) fn lock_shape(rows: &BoardRows, shape: Shape, x: i8, y: i8) -> Option<BoardRows> {
    if !can_place(rows, shape, x, y) {
        return None;
    }

    let mut output = *rows;
    for cell in shape.cells {
        let board_x = x + cell.x;
        let board_y = y + cell.y;
        let row_index = usize::try_from(board_y).ok()?;
        let column = u32::try_from(board_x).ok()?;
        output[row_index] |= 1_u16 << column;
    }
    Some(output)
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
const SRS_PLUS_I_KICKS_01: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: 1, y: 0 },
    Cell { x: -2, y: 0 },
    Cell { x: -2, y: 1 },
    Cell { x: 1, y: -2 },
];
const SRS_PLUS_I_KICKS_10: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: -1, y: 0 },
    Cell { x: 2, y: 0 },
    Cell { x: -1, y: 2 },
    Cell { x: 2, y: -1 },
];
const SRS_I_KICKS_01: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: -2, y: 0 },
    Cell { x: 1, y: 0 },
    Cell { x: -2, y: 1 },
    Cell { x: 1, y: -2 },
];
const SRS_I_KICKS_10: &[Cell] = &[
    Cell { x: 0, y: 0 },
    Cell { x: 2, y: 0 },
    Cell { x: -1, y: 0 },
    Cell { x: 2, y: -1 },
    Cell { x: -1, y: 2 },
];
