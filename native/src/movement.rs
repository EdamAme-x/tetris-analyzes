use napi::bindgen_prelude::{Error, Result};

use crate::board::{BoardRows, BOARD_HEIGHT, BOARD_WIDTH};
use crate::pieces::{piece_shapes, Piece, Shape};
use crate::tetrio_tables::{
    kick_table_allows_o_kick, kick_table_from_key, kick_table_offsets, kick_table_piece_offset,
    kick_table_spawn_rotation, Kick, KickGroup, KickTable,
};

const MOVEMENT_ROTATION_CAPACITY: usize = 4;
const MOVEMENT_HIDDEN_ROWS: usize = BOARD_HEIGHT;
const MOVEMENT_BOARD_HEIGHT: usize = BOARD_HEIGHT + MOVEMENT_HIDDEN_ROWS;
const MOVEMENT_STATE_CAPACITY: usize =
    MOVEMENT_ROTATION_CAPACITY * BOARD_WIDTH * MOVEMENT_BOARD_HEIGHT;
const MOVEMENT_VISITED_WORDS: usize =
    (MOVEMENT_STATE_CAPACITY + u64::BITS as usize - 1) / u64::BITS as usize;

type MovementVisitedSet = [u64; MOVEMENT_VISITED_WORDS];
type MovementQueue = [u16; MOVEMENT_STATE_CAPACITY];

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) struct MovementState {
    pub(crate) shape_index: usize,
    pub(crate) x: i8,
    pub(crate) y: i8,
}

pub(crate) struct ReachablePlacementSet {
    visited: MovementVisitedSet,
}

pub(crate) struct ReachabilityCache {
    spawn_open: bool,
    reachable: Option<ReachablePlacementSet>,
    reachable_allow_180: Option<bool>,
}

pub(crate) struct RotationResolution {
    pub(crate) state: MovementState,
    pub(crate) kick_index: Option<usize>,
}

impl ReachabilityCache {
    pub(crate) fn new(rows: &BoardRows, piece: Piece, kick_table: KickTable) -> Self {
        let shapes = piece_shapes(piece);
        let spawn = movement_spawn_state(
            piece,
            kick_table_spawn_rotation(kick_table, piece) as usize,
            kick_table,
        );
        Self {
            spawn_open: can_place_for_movement(rows, shapes[spawn.shape_index], spawn.x, spawn.y),
            reachable: None,
            reachable_allow_180: None,
        }
    }

    pub(crate) fn spawn_open(&self) -> bool {
        self.spawn_open
    }
}

impl ReachablePlacementSet {
    fn contains_exact(&self, state: MovementState) -> bool {
        movement_state_index(state).is_some_and(|index| visited_contains(&self.visited, index))
    }

    fn contains(&self, target_shape_index: usize, target_x: i8, target_y: i8) -> bool {
        self.contains_shape_index(target_shape_index, target_x, target_y)
    }

    fn contains_shape_index(&self, shape_index: usize, x: i8, y: i8) -> bool {
        movement_state_index(MovementState { shape_index, x, y })
            .is_some_and(|index| visited_contains(&self.visited, index))
    }
}

impl ReachabilityCache {
    fn reachable_set(
        &mut self,
        rows: &BoardRows,
        piece: Piece,
        kick_table: KickTable,
        allow_180: bool,
    ) -> Option<&ReachablePlacementSet> {
        if !self.spawn_open {
            return None;
        }
        if self.reachable.is_none() || self.reachable_allow_180 != Some(allow_180) {
            self.reachable = Some(build_reachable_placement_set(
                rows, piece, kick_table, allow_180,
            ));
            self.reachable_allow_180 = Some(allow_180);
        }
        self.reachable.as_ref()
    }
}

pub(crate) fn is_reachable_placement(
    rows: &BoardRows,
    piece: Piece,
    target_shape_index: usize,
    target_x: i8,
    target_y: i8,
    kick_table: KickTable,
    allow_180: bool,
) -> bool {
    let mut reachable_cache = ReachabilityCache::new(rows, piece, kick_table);
    is_reachable_placement_with_cache(
        rows,
        piece,
        target_shape_index,
        target_x,
        target_y,
        kick_table,
        allow_180,
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
    allow_180: bool,
    reachable_cache: &mut ReachabilityCache,
) -> bool {
    if !reachable_cache.spawn_open {
        return false;
    }

    let shapes = piece_shapes(piece);
    let target_shape = shapes[target_shape_index];
    if reachable_cache.reachable_allow_180 == Some(allow_180) {
        if let Some(reachable) = reachable_cache.reachable.as_ref() {
            return reachable.contains(target_shape_index, target_x, target_y);
        }
    }

    if target_shape_index == kick_table_spawn_rotation(kick_table, piece) as usize
        && has_clear_horizontal_entry_drop(
            rows,
            piece,
            target_shape_index,
            target_shape,
            target_x,
            target_y,
            kick_table,
        )
    {
        return true;
    }

    if reachable_cache.reachable.is_none() || reachable_cache.reachable_allow_180 != Some(allow_180)
    {
        reachable_cache.reachable = Some(build_reachable_placement_set(
            rows, piece, kick_table, allow_180,
        ));
        reachable_cache.reachable_allow_180 = Some(allow_180);
    }
    reachable_cache
        .reachable
        .as_ref()
        .is_some_and(|reachable| reachable.contains(target_shape_index, target_x, target_y))
}

fn build_reachable_placement_set(
    rows: &BoardRows,
    piece: Piece,
    kick_table: KickTable,
    allow_180: bool,
) -> ReachablePlacementSet {
    let shapes = piece_shapes(piece);
    let spawn = movement_spawn_state(
        piece,
        kick_table_spawn_rotation(kick_table, piece) as usize,
        kick_table,
    );

    let mut visited = [0_u64; MOVEMENT_VISITED_WORDS];
    let mut queue = [0_u16; MOVEMENT_STATE_CAPACITY];
    let mut head = 0_usize;
    let mut tail = 0_usize;
    push_known_movement_state(spawn, &mut visited, &mut queue, &mut tail);

    while head < tail {
        let state = movement_state_from_index(usize::from(queue[head]));
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
        if allow_180 {
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
    }

    ReachablePlacementSet { visited }
}

pub(crate) fn has_clear_vertical_drop(
    rows: &BoardRows,
    piece: Piece,
    shape_index: usize,
    shape: Shape,
    x: i8,
    target_y: i8,
    kick_table: KickTable,
) -> bool {
    let spawn_y = movement_spawn_state(piece, shape_index, kick_table).y;
    if target_y > spawn_y {
        return false;
    }
    let highest_visible_y = BOARD_HEIGHT as i8 - shape.height;
    for y in target_y..=spawn_y.min(highest_visible_y) {
        if !can_place_for_movement(rows, shape, x, y) {
            return false;
        }
    }
    true
}

fn has_clear_horizontal_entry_drop(
    rows: &BoardRows,
    piece: Piece,
    shape_index: usize,
    shape: Shape,
    target_x: i8,
    target_y: i8,
    kick_table: KickTable,
) -> bool {
    let spawn = movement_spawn_state(piece, shape_index, kick_table);
    let spawn_y = spawn.y;
    let spawn_x = spawn.x;
    let (left, right) = if spawn_x <= target_x {
        (spawn_x, target_x)
    } else {
        (target_x, spawn_x)
    };
    if spawn_y < BOARD_HEIGHT as i8 {
        for x in left..=right {
            if !can_place_for_movement(rows, shape, x, spawn_y) {
                return false;
            }
        }
    }
    has_clear_vertical_drop(
        rows,
        piece,
        shape_index,
        shape,
        target_x,
        target_y,
        kick_table,
    )
}

pub(crate) fn push_movement_state(
    rows: &BoardRows,
    shapes: &[Shape],
    shape_index: usize,
    x: i8,
    y: i8,
    visited: &mut MovementVisitedSet,
    queue: &mut MovementQueue,
    tail: &mut usize,
) {
    let next = MovementState { shape_index, x, y };
    let Some(index) = movement_state_index(next) else {
        return;
    };
    if visited_contains(visited, index) || *tail >= queue.len() {
        return;
    }

    let shape = shapes[shape_index];
    if !can_place_for_movement(rows, shape, x, y) {
        return;
    }

    push_indexed_movement_state(index, visited, queue, tail);
}

pub(crate) fn push_rotation_states(
    rows: &BoardRows,
    piece: Piece,
    shapes: &[Shape],
    state: MovementState,
    direction: i8,
    kick_table: KickTable,
    visited: &mut MovementVisitedSet,
    queue: &mut MovementQueue,
    tail: &mut usize,
) {
    let Some(resolution) =
        resolve_rotation_state(rows, piece, shapes, state, direction, kick_table)
    else {
        return;
    };
    let Some(index) = movement_state_index(resolution.state) else {
        return;
    };
    if visited_contains(visited, index) || *tail >= queue.len() {
        return;
    }
    push_indexed_movement_state(index, visited, queue, tail);
}

pub(crate) fn resolve_rotation_state(
    rows: &BoardRows,
    piece: Piece,
    shapes: &[Shape],
    state: MovementState,
    direction: i8,
    kick_table: KickTable,
) -> Option<RotationResolution> {
    if shapes.len() <= 1 || state.shape_index >= shapes.len() {
        return None;
    }

    let from_rotation = shapes[state.shape_index].rotation;
    let to_rotation = (i16::from(from_rotation) + i16::from(direction)).rem_euclid(4) as u8;
    let next_shape_index = to_rotation as usize;
    let next_shape = *shapes.get(next_shape_index)?;
    let (from_anchor_x, from_anchor_y) = shape_anchor_offset(piece, state.shape_index);
    let (to_anchor_x, to_anchor_y) = shape_anchor_offset(piece, next_shape_index);
    let from_offset = kick_table_piece_offset(kick_table, piece, from_rotation);
    let to_offset = kick_table_piece_offset(kick_table, piece, to_rotation);
    let offset_delta_x = to_offset.x - from_offset.x;
    let offset_delta_y = to_offset.y - from_offset.y;
    let anchor_x = state.x + from_anchor_x;
    let anchor_y = state.y + from_anchor_y;

    for (kick_table_index, kick) in kicks_for(kick_table, piece, from_rotation, to_rotation)
        .iter()
        .enumerate()
    {
        let x = anchor_x + offset_delta_x + kick.x - to_anchor_x;
        let y = anchor_y + offset_delta_y + kick.y - to_anchor_y;
        let next = MovementState {
            shape_index: next_shape_index,
            x,
            y,
        };
        if movement_state_index(next).is_some() && can_place_for_movement(rows, next_shape, x, y) {
            return Some(RotationResolution {
                state: next,
                kick_index: kick_table_index.checked_sub(1),
            });
        }
    }

    None
}

pub(crate) fn find_reachable_rotation_entry(
    rows: &BoardRows,
    piece: Piece,
    target_shape_index: usize,
    target_x: i8,
    target_y: i8,
    kick_table: KickTable,
    allow_180: bool,
    reachable_cache: &mut ReachabilityCache,
) -> Option<usize> {
    let shapes = piece_shapes(piece);
    let target_shape = *shapes.get(target_shape_index)?;
    if !can_place_for_movement(rows, target_shape, target_x, target_y) {
        return None;
    }

    let reachable = reachable_cache.reachable_set(rows, piece, kick_table, allow_180)?;
    let to_rotation = target_shape.rotation;
    let (to_anchor_x, to_anchor_y) = shape_anchor_offset(piece, target_shape_index);
    let to_offset = kick_table_piece_offset(kick_table, piece, to_rotation);

    for direction in [-1_i8, 1_i8, 2_i8] {
        if direction == 2 && !allow_180 {
            continue;
        }
        let from_rotation = (i16::from(to_rotation) - i16::from(direction)).rem_euclid(4) as u8;
        let from_shape_index = from_rotation as usize;
        let (from_anchor_x, from_anchor_y) = shape_anchor_offset(piece, from_shape_index);
        let from_offset = kick_table_piece_offset(kick_table, piece, from_rotation);
        let offset_delta_x = to_offset.x - from_offset.x;
        let offset_delta_y = to_offset.y - from_offset.y;

        for (raw_kick_index, kick) in kicks_for(kick_table, piece, from_rotation, to_rotation)
            .iter()
            .enumerate()
        {
            let from_x = target_x + to_anchor_x - offset_delta_x - kick.x - from_anchor_x;
            let from_y = target_y + to_anchor_y - offset_delta_y - kick.y - from_anchor_y;
            let from_state = MovementState {
                shape_index: from_shape_index,
                x: from_x,
                y: from_y,
            };
            if !reachable.contains_exact(from_state) {
                continue;
            }

            let Some(resolution) =
                resolve_rotation_state(rows, piece, shapes, from_state, direction, kick_table)
            else {
                continue;
            };
            if resolution.state.shape_index == target_shape_index
                && resolution.state.x == target_x
                && resolution.state.y == target_y
            {
                return Some(raw_kick_index);
            }
        }
    }

    None
}

fn push_known_movement_state(
    state: MovementState,
    visited: &mut MovementVisitedSet,
    queue: &mut MovementQueue,
    tail: &mut usize,
) {
    let Some(index) = movement_state_index(state) else {
        return;
    };
    if visited_contains(visited, index) || *tail >= queue.len() {
        return;
    }
    push_indexed_movement_state(index, visited, queue, tail);
}

fn push_indexed_movement_state(
    index: usize,
    visited: &mut MovementVisitedSet,
    queue: &mut MovementQueue,
    tail: &mut usize,
) {
    visited_insert(visited, index);
    queue[*tail] = index as u16;
    *tail += 1;
}

#[inline]
fn movement_state_index(state: MovementState) -> Option<usize> {
    if state.shape_index >= MOVEMENT_ROTATION_CAPACITY
        || state.x < 0
        || state.x >= BOARD_WIDTH as i8
        || state.y < 0
        || state.y >= MOVEMENT_BOARD_HEIGHT as i8
    {
        return None;
    }

    Some(
        state.shape_index * BOARD_WIDTH * MOVEMENT_BOARD_HEIGHT
            + state.y as usize * BOARD_WIDTH
            + state.x as usize,
    )
}

#[inline]
fn movement_state_from_index(index: usize) -> MovementState {
    let rotation_stride = BOARD_WIDTH * MOVEMENT_BOARD_HEIGHT;
    let shape_index = index / rotation_stride;
    let offset = index % rotation_stride;
    MovementState {
        shape_index,
        x: (offset % BOARD_WIDTH) as i8,
        y: (offset / BOARD_WIDTH) as i8,
    }
}

#[inline]
fn visited_contains(visited: &MovementVisitedSet, index: usize) -> bool {
    let word = index / u64::BITS as usize;
    let bit = index % u64::BITS as usize;
    visited[word] & (1_u64 << bit) != 0
}

#[inline]
fn visited_insert(visited: &mut MovementVisitedSet, index: usize) {
    let word = index / u64::BITS as usize;
    let bit = index % u64::BITS as usize;
    visited[word] |= 1_u64 << bit;
}

fn movement_spawn_state(piece: Piece, shape_index: usize, kick_table: KickTable) -> MovementState {
    let (anchor_x, anchor_y) = shape_anchor_offset(piece, shape_index);
    let offset =
        kick_table_piece_offset(kick_table, piece, piece_shapes(piece)[shape_index].rotation);
    MovementState {
        shape_index,
        x: movement_spawn_anchor_x() + offset.x - anchor_x,
        y: movement_spawn_anchor_y() + offset.y - anchor_y,
    }
}

fn movement_spawn_anchor_x() -> i8 {
    ((BOARD_WIDTH as i8 + 1) / 2) - 1
}

fn movement_spawn_anchor_y() -> i8 {
    BOARD_HEIGHT as i8 + 1
}

fn shape_anchor_offset(piece: Piece, shape_index: usize) -> (i8, i8) {
    let rotation = piece_shapes(piece)[shape_index].rotation;
    match piece {
        Piece::I => match rotation {
            0 => (1, 0),
            1 => (-1, 2),
            2 => (1, 1),
            3 => (0, 2),
            _ => (0, 0),
        },
        Piece::O => (0, 0),
        Piece::S | Piece::Z | Piece::J | Piece::L | Piece::T => match rotation {
            0 => (1, 0),
            1 => (0, 1),
            2 | 3 => (1, 1),
            _ => (0, 0),
        },
    }
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
    if piece == Piece::O && !kick_table_allows_o_kick(kick_table) {
        return &crate::tetrio_tables::NO_KICKS;
    }
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
        Piece::O | Piece::T | Piece::S | Piece::Z | Piece::J | Piece::L => KickGroup::Default,
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

fn can_place_for_movement(rows: &BoardRows, shape: Shape, x: i8, y: i8) -> bool {
    if x < 0
        || y < 0
        || x + shape.width > BOARD_WIDTH as i8
        || y + shape.height > MOVEMENT_BOARD_HEIGHT as i8
    {
        return false;
    }

    let x_shift = x as u32;
    let base_y = y as usize;
    for dy in 0..shape.height as usize {
        let row_y = base_y + dy;
        if row_y >= BOARD_HEIGHT {
            continue;
        }
        let mask = shape.row_masks[dy] << x_shift;
        if rows[row_y] & mask != 0 {
            return false;
        }
    }
    true
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
        let mut cache = ReachabilityCache::new(&rows, Piece::I, KickTable::SrsPlus);

        assert!(is_reachable_placement_with_cache(
            &rows,
            Piece::I,
            0,
            3,
            0,
            KickTable::SrsPlus,
            true,
            &mut cache,
        ));
        assert!(cache.reachable.is_none());
    }

    #[test]
    fn non_spawn_rotation_reachability_builds_bfs_cache() {
        let rows = [0_u16; BOARD_HEIGHT];
        let mut cache = ReachabilityCache::new(&rows, Piece::T, KickTable::SrsPlus);

        assert!(is_reachable_placement_with_cache(
            &rows,
            Piece::T,
            1,
            3,
            0,
            KickTable::SrsPlus,
            true,
            &mut cache,
        ));
        assert!(cache.reachable.is_some());
    }

    #[test]
    fn reachability_cache_is_built_only_after_direct_drop_misses() {
        let mut rows = [0_u16; BOARD_HEIGHT];
        rows[BOARD_HEIGHT - 1] = 1;
        let mut cache = ReachabilityCache::new(&rows, Piece::I, KickTable::SrsPlus);

        assert!(is_reachable_placement_with_cache(
            &rows,
            Piece::I,
            0,
            0,
            0,
            KickTable::SrsPlus,
            true,
            &mut cache,
        ));
        assert!(cache.reachable.is_some());
    }

    #[test]
    fn rotation_reachability_rejects_later_successful_kick_choices() {
        let rows = [0_u16; BOARD_HEIGHT];
        let shapes = piece_shapes(Piece::T);
        let state = MovementState {
            shape_index: 3,
            x: 6,
            y: 2,
        };
        let mut visited = [0_u64; MOVEMENT_VISITED_WORDS];
        let mut queue = [0_u16; MOVEMENT_STATE_CAPACITY];
        let mut tail = 0_usize;

        push_rotation_states(
            &rows,
            Piece::T,
            shapes,
            state,
            1,
            KickTable::SrsPlus,
            &mut visited,
            &mut queue,
            &mut tail,
        );

        assert_eq!(tail, 1);
        assert_eq!(
            movement_state_from_index(usize::from(queue[0])),
            MovementState {
                shape_index: 0,
                x: 6,
                y: 3,
            }
        );
    }

    #[test]
    fn spawn_rotation_uses_hidden_rows_without_ceiling_kick() {
        let rows = [0_u16; BOARD_HEIGHT];
        let shapes = piece_shapes(Piece::T);
        let state = movement_spawn_state(Piece::T, 0, KickTable::SrsPlus);
        let mut visited = [0_u64; MOVEMENT_VISITED_WORDS];
        let mut queue = [0_u16; MOVEMENT_STATE_CAPACITY];
        let mut tail = 0_usize;

        push_rotation_states(
            &rows,
            Piece::T,
            shapes,
            state,
            1,
            KickTable::SrsPlus,
            &mut visited,
            &mut queue,
            &mut tail,
        );

        assert_eq!(tail, 1);
        assert_eq!(
            movement_state_from_index(usize::from(queue[0])),
            MovementState {
                shape_index: 1,
                x: 4,
                y: 20,
            }
        );
    }

    #[test]
    fn rotation_kicks_are_applied_to_piece_anchor_not_bounding_box() {
        let rows = [0_u16; BOARD_HEIGHT];
        let shapes = piece_shapes(Piece::T);
        let state = MovementState {
            shape_index: 0,
            x: 3,
            y: 2,
        };
        let mut visited = [0_u64; MOVEMENT_VISITED_WORDS];
        let mut queue = [0_u16; MOVEMENT_STATE_CAPACITY];
        let mut tail = 0_usize;

        push_rotation_states(
            &rows,
            Piece::T,
            shapes,
            state,
            2,
            KickTable::SrsPlus,
            &mut visited,
            &mut queue,
            &mut tail,
        );

        assert_eq!(tail, 1);
        assert_eq!(
            movement_state_from_index(usize::from(queue[0])),
            MovementState {
                shape_index: 2,
                x: 3,
                y: 1,
            }
        );
    }

    #[test]
    fn reachable_set_requires_exact_final_rotation_membership() {
        let mut visited = [0_u64; MOVEMENT_VISITED_WORDS];
        let mut queue = [0_u16; MOVEMENT_STATE_CAPACITY];
        let mut tail = 0_usize;
        push_known_movement_state(
            MovementState {
                shape_index: 0,
                x: 3,
                y: 0,
            },
            &mut visited,
            &mut queue,
            &mut tail,
        );
        let reachable = ReachablePlacementSet { visited };

        assert!(reachable.contains(0, 3, 0));
        assert!(!reachable.contains(2, 3, 0));
        assert!(!reachable.contains(2, 10, 0));
    }

    #[test]
    fn packed_movement_state_index_round_trips_and_sets_bits() {
        let state = MovementState {
            shape_index: 3,
            x: 9,
            y: 39,
        };
        let index = movement_state_index(state).expect("state should fit movement index");
        let mut visited = [0_u64; MOVEMENT_VISITED_WORDS];

        assert_eq!(movement_state_from_index(index), state);
        assert!(!visited_contains(&visited, index));
        visited_insert(&mut visited, index);
        assert!(visited_contains(&visited, index));
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
