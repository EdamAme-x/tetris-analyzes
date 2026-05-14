use napi::bindgen_prelude::{Error, Result};

use crate::board::{BoardRows, BOARD_HEIGHT, BOARD_WIDTH};
use crate::pieces::{piece_shapes, Piece, Shape};
use crate::tetrio_tables::{kick_table_from_key, kick_table_offsets, Kick, KickGroup, KickTable};

const MOVEMENT_ROTATION_CAPACITY: usize = 4;
const MOVEMENT_STATE_CAPACITY: usize = MOVEMENT_ROTATION_CAPACITY * BOARD_WIDTH * BOARD_HEIGHT;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) struct MovementState {
    pub(crate) shape_index: usize,
    pub(crate) x: i8,
    pub(crate) y: i8,
}

pub(crate) struct ReachablePlacementSet {
    visited: [bool; MOVEMENT_STATE_CAPACITY],
}

pub(crate) struct ReachabilityCache {
    spawn_open: bool,
    reachable: Option<ReachablePlacementSet>,
}

impl ReachabilityCache {
    pub(crate) fn new(rows: &BoardRows, piece: Piece) -> Self {
        let shapes = piece_shapes(piece);
        let spawn_shape = shapes[0];
        let spawn_x = (BOARD_WIDTH as i8 - spawn_shape.width) / 2;
        let spawn_y = BOARD_HEIGHT as i8 - spawn_shape.height;
        Self {
            spawn_open: can_place(rows, spawn_shape, spawn_x, spawn_y),
            reachable: None,
        }
    }
}

impl ReachablePlacementSet {
    fn contains(
        &self,
        piece: Piece,
        shapes: &[Shape],
        target_shape_index: usize,
        target_x: i8,
        target_y: i8,
    ) -> bool {
        let target_rotation = shapes[target_shape_index].rotation;
        equivalent_shape_indices(piece, target_rotation)
            .iter()
            .copied()
            .any(|shape_index| {
                movement_state_index(MovementState {
                    shape_index,
                    x: target_x,
                    y: target_y,
                })
                .is_some_and(|index| self.visited[index])
            })
    }
}

pub(crate) fn is_reachable_placement(
    rows: &BoardRows,
    piece: Piece,
    target_shape_index: usize,
    target_x: i8,
    target_y: i8,
    kick_table: KickTable,
) -> bool {
    let mut reachable_cache = ReachabilityCache::new(rows, piece);
    is_reachable_placement_with_cache(
        rows,
        piece,
        target_shape_index,
        target_x,
        target_y,
        kick_table,
        &mut reachable_cache,
    )
}

pub(crate) fn is_reachable_placement_with_cache(
    rows: &BoardRows,
    piece: Piece,
    target_shape_index: usize,
    target_x: i8,
    target_y: i8,
    kick_table: KickTable,
    reachable_cache: &mut ReachabilityCache,
) -> bool {
    if !reachable_cache.spawn_open {
        return false;
    }

    let shapes = piece_shapes(piece);
    let target_shape = shapes[target_shape_index];
    if has_clear_horizontal_entry_drop(rows, target_shape, target_x, target_y) {
        return true;
    }

    if reachable_cache.reachable.is_none() {
        reachable_cache.reachable = Some(build_reachable_placement_set(rows, piece, kick_table));
    }
    reachable_cache.reachable.as_ref().is_some_and(|reachable| {
        reachable.contains(piece, shapes, target_shape_index, target_x, target_y)
    })
}

fn build_reachable_placement_set(
    rows: &BoardRows,
    piece: Piece,
    kick_table: KickTable,
) -> ReachablePlacementSet {
    let shapes = piece_shapes(piece);
    let spawn_shape = shapes[0];
    let spawn = MovementState {
        shape_index: 0,
        x: (BOARD_WIDTH as i8 - spawn_shape.width) / 2,
        y: BOARD_HEIGHT as i8 - spawn_shape.height,
    };

    let mut visited = [false; MOVEMENT_STATE_CAPACITY];
    let mut queue = [spawn; MOVEMENT_STATE_CAPACITY];
    let mut head = 0_usize;
    let mut tail = 0_usize;
    push_known_movement_state(spawn, &mut visited, &mut queue, &mut tail);

    while head < tail {
        let state = queue[head];
        head += 1;

        push_movement_state(
            rows,
            shapes,
            state.shape_index,
            state.x - 1,
            state.y,
            &mut visited,
            &mut queue,
            &mut tail,
        );
        push_movement_state(
            rows,
            shapes,
            state.shape_index,
            state.x + 1,
            state.y,
            &mut visited,
            &mut queue,
            &mut tail,
        );
        push_movement_state(
            rows,
            shapes,
            state.shape_index,
            state.x,
            state.y - 1,
            &mut visited,
            &mut queue,
            &mut tail,
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
            &mut tail,
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
            &mut tail,
        );
        push_rotation_states(
            rows,
            piece,
            shapes,
            state,
            2,
            kick_table,
            &mut visited,
            &mut queue,
            &mut tail,
        );
    }

    ReachablePlacementSet { visited }
}

fn equivalent_shape_indices(piece: Piece, rotation: u8) -> &'static [usize] {
    match piece {
        Piece::O => &[0, 1, 2, 3],
        Piece::I | Piece::S | Piece::Z => match rotation {
            0 | 2 => &[0, 2],
            1 | 3 => &[1, 3],
            _ => &[],
        },
        Piece::T | Piece::J | Piece::L => match rotation {
            0 => &[0],
            1 => &[1],
            2 => &[2],
            3 => &[3],
            _ => &[],
        },
    }
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

fn has_clear_horizontal_entry_drop(
    rows: &BoardRows,
    shape: Shape,
    target_x: i8,
    target_y: i8,
) -> bool {
    let spawn_y = BOARD_HEIGHT as i8 - shape.height;
    let spawn_x = (BOARD_WIDTH as i8 - shape.width) / 2;
    let (left, right) = if spawn_x <= target_x {
        (spawn_x, target_x)
    } else {
        (target_x, spawn_x)
    };
    for x in left..=right {
        if !can_place(rows, shape, x, spawn_y) {
            return false;
        }
    }
    has_clear_vertical_drop(rows, shape, target_x, target_y)
}

pub(crate) fn push_movement_state(
    rows: &BoardRows,
    shapes: &[Shape],
    shape_index: usize,
    x: i8,
    y: i8,
    visited: &mut [bool; MOVEMENT_STATE_CAPACITY],
    queue: &mut [MovementState; MOVEMENT_STATE_CAPACITY],
    tail: &mut usize,
) {
    let next = MovementState { shape_index, x, y };
    let Some(index) = movement_state_index(next) else {
        return;
    };
    if visited[index] || *tail >= queue.len() {
        return;
    }

    let shape = shapes[shape_index];
    if !can_place(rows, shape, x, y) {
        return;
    }

    push_indexed_movement_state(next, index, visited, queue, tail);
}

pub(crate) fn push_rotation_states(
    rows: &BoardRows,
    piece: Piece,
    shapes: &[Shape],
    state: MovementState,
    direction: i8,
    kick_table: KickTable,
    visited: &mut [bool; MOVEMENT_STATE_CAPACITY],
    queue: &mut [MovementState; MOVEMENT_STATE_CAPACITY],
    tail: &mut usize,
) {
    if shapes.len() <= 1 {
        return;
    }

    let from_rotation = shapes[state.shape_index].rotation;
    let to_rotation = (i16::from(from_rotation) + i16::from(direction)).rem_euclid(4) as u8;
    let next_shape_index = to_rotation as usize;
    let next_shape = shapes[next_shape_index];

    for kick in kicks_for(kick_table, piece, from_rotation, to_rotation) {
        let x = state.x + kick.x;
        let y = state.y + kick.y;
        let next = MovementState {
            shape_index: next_shape_index,
            x,
            y,
        };
        let Some(index) = movement_state_index(next) else {
            continue;
        };
        if visited[index] || *tail >= queue.len() {
            continue;
        }
        if can_place(rows, next_shape, x, y) {
            push_indexed_movement_state(next, index, visited, queue, tail);
        }
    }
}

fn push_known_movement_state(
    state: MovementState,
    visited: &mut [bool; MOVEMENT_STATE_CAPACITY],
    queue: &mut [MovementState; MOVEMENT_STATE_CAPACITY],
    tail: &mut usize,
) {
    let Some(index) = movement_state_index(state) else {
        return;
    };
    if visited[index] || *tail >= queue.len() {
        return;
    }
    push_indexed_movement_state(state, index, visited, queue, tail);
}

fn push_indexed_movement_state(
    state: MovementState,
    index: usize,
    visited: &mut [bool; MOVEMENT_STATE_CAPACITY],
    queue: &mut [MovementState; MOVEMENT_STATE_CAPACITY],
    tail: &mut usize,
) {
    visited[index] = true;
    queue[*tail] = state;
    *tail += 1;
}

fn movement_state_index(state: MovementState) -> Option<usize> {
    if state.shape_index >= MOVEMENT_ROTATION_CAPACITY
        || state.x < 0
        || state.x >= BOARD_WIDTH as i8
        || state.y < 0
        || state.y >= BOARD_HEIGHT as i8
    {
        return None;
    }

    Some(
        state.shape_index * BOARD_WIDTH * BOARD_HEIGHT
            + state.y as usize * BOARD_WIDTH
            + state.x as usize,
    )
}

pub(crate) fn parse_kick_table(input: &str) -> Result<KickTable> {
    let normalized = input.trim().to_ascii_uppercase().replace('_', "-");
    let key = if normalized == "NONE" {
        "none"
    } else if normalized == "SRS-PLUS" || normalized == "SRS PLUS" {
        "SRS+"
    } else {
        normalized.as_str()
    };
    kick_table_from_key(key).ok_or_else(|| {
        Error::from_reason(format!(
            "Unsupported native opener kick table {input}. Supported tables are SRS+, SRS, SRS-X, TETRA-X, NRS, ARS, ASC, and NONE."
        ))
    })
}

pub(crate) fn kicks_for(
    kick_table: KickTable,
    piece: Piece,
    from_rotation: u8,
    to_rotation: u8,
) -> &'static [Kick] {
    kick_table_offsets(
        kick_table,
        kick_group_for(piece),
        from_rotation,
        to_rotation,
    )
}

fn kick_group_for(piece: Piece) -> KickGroup {
    match piece {
        Piece::I => KickGroup::I,
        Piece::O => KickGroup::O,
        Piece::T | Piece::S | Piece::Z | Piece::J | Piece::L => KickGroup::Default,
    }
}

pub(crate) fn can_place(rows: &BoardRows, shape: Shape, x: i8, y: i8) -> bool {
    if x < 0
        || y < 0
        || x + shape.width > BOARD_WIDTH as i8
        || y + shape.height > BOARD_HEIGHT as i8
    {
        return false;
    }

    can_place_in_bounds(rows, shape, x, y)
}

pub(crate) fn can_place_in_bounds(rows: &BoardRows, shape: Shape, x: i8, y: i8) -> bool {
    let x_shift = x as u32;
    let base_y = y as usize;
    for dy in 0..shape.height as usize {
        let mask = shape.row_masks[dy] << x_shift;
        if rows[base_y + dy] & mask != 0 {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_drop_reachability_does_not_build_bfs_cache() {
        let rows = [0_u16; BOARD_HEIGHT];
        let mut cache = ReachabilityCache::new(&rows, Piece::I);

        assert!(is_reachable_placement_with_cache(
            &rows,
            Piece::I,
            0,
            3,
            0,
            KickTable::SrsPlus,
            &mut cache,
        ));
        assert!(cache.reachable.is_none());
    }

    #[test]
    fn reachability_cache_is_built_only_after_direct_drop_misses() {
        let mut rows = [0_u16; BOARD_HEIGHT];
        rows[BOARD_HEIGHT - 1] = 1;
        let mut cache = ReachabilityCache::new(&rows, Piece::I);

        assert!(is_reachable_placement_with_cache(
            &rows,
            Piece::I,
            0,
            0,
            0,
            KickTable::SrsPlus,
            &mut cache,
        ));
        assert!(cache.reachable.is_some());
    }

    #[test]
    fn reachable_set_checks_equivalent_rotation_membership_directly() {
        let rows = [0_u16; BOARD_HEIGHT];
        let reachable = build_reachable_placement_set(&rows, Piece::I, KickTable::SrsPlus);
        let shapes = piece_shapes(Piece::I);

        assert!(reachable.contains(Piece::I, shapes, 0, 3, 0));
        assert!(reachable.contains(Piece::I, shapes, 2, 3, 0));
        assert!(!reachable.contains(Piece::I, shapes, 2, 10, 0));
    }
}

pub(crate) fn lock_shape(rows: &BoardRows, shape: Shape, x: i8, y: i8) -> Option<BoardRows> {
    if !can_place(rows, shape, x, y) {
        return None;
    }

    let mut output = *rows;
    let x_shift = u32::try_from(x).ok()?;
    let base_y = usize::try_from(y).ok()?;
    for dy in 0..shape.height as usize {
        output[base_y + dy] |= shape.row_masks[dy] << x_shift;
    }
    Some(output)
}
