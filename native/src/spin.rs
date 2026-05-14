use crate::board::{BoardRows, BOARD_HEIGHT, BOARD_WIDTH};
use crate::movement::can_place;
use crate::pieces::{Cell, Piece, Shape};

#[derive(Clone, Copy)]
pub(crate) struct SpinDetection {
    pub(crate) kind: SpinKind,
    pub(crate) spin: bool,
    pub(crate) mini: bool,
    pub(crate) immobile: bool,
    pub(crate) occupied_corners: u32,
    pub(crate) cleared_lines: u32,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub(crate) enum SpinKind {
    None,
    TSpin,
    TSpinMini,
    ImmobileSpin,
}

pub(crate) fn detect_spin(
    locked_rows: &BoardRows,
    piece: Piece,
    shape: Shape,
    x: i8,
    y: i8,
    cleared_lines: u32,
) -> SpinDetection {
    let immobile = is_placement_immobile(locked_rows, shape, x, y);
    if piece == Piece::T {
        let occupied_corners = count_t_occupied_corners(locked_rows, shape.rotation, x, y);
        if occupied_corners >= 3 {
            let front_corners = count_t_front_corners(locked_rows, shape.rotation, x, y);
            let mini = front_corners < 2;
            return SpinDetection {
                kind: if mini {
                    SpinKind::TSpinMini
                } else {
                    SpinKind::TSpin
                },
                spin: true,
                mini,
                immobile,
                occupied_corners,
                cleared_lines,
            };
        }

        return SpinDetection {
            kind: SpinKind::None,
            spin: false,
            mini: false,
            immobile,
            occupied_corners,
            cleared_lines,
        };
    }

    if immobile {
        return SpinDetection {
            kind: SpinKind::ImmobileSpin,
            spin: true,
            mini: false,
            immobile,
            occupied_corners: 0,
            cleared_lines,
        };
    }

    SpinDetection {
        kind: SpinKind::None,
        spin: false,
        mini: false,
        immobile,
        occupied_corners: 0,
        cleared_lines,
    }
}

pub(crate) fn is_placement_immobile(locked_rows: &BoardRows, shape: Shape, x: i8, y: i8) -> bool {
    let board_without_piece = remove_shape_cells(locked_rows, shape, x, y);
    !can_place(&board_without_piece, shape, x - 1, y)
        && !can_place(&board_without_piece, shape, x + 1, y)
        && !can_place(&board_without_piece, shape, x, y - 1)
}

pub(crate) fn remove_shape_cells(rows: &BoardRows, shape: Shape, x: i8, y: i8) -> BoardRows {
    let mut output = *rows;
    for cell in shape.cells {
        let board_x = x + cell.x;
        let board_y = y + cell.y;
        if board_x >= 0
            && board_x < BOARD_WIDTH as i8
            && board_y >= 0
            && board_y < BOARD_HEIGHT as i8
        {
            output[board_y as usize] &= !(1_u16 << board_x);
        }
    }
    output
}

pub(crate) fn count_t_occupied_corners(rows: &BoardRows, rotation: u8, x: i8, y: i8) -> u32 {
    t_corner_cells(rotation, x, y)
        .into_iter()
        .filter(|cell| is_occupied_or_wall(rows, cell.x, cell.y))
        .count() as u32
}

pub(crate) fn count_t_front_corners(rows: &BoardRows, rotation: u8, x: i8, y: i8) -> u32 {
    t_front_corner_cells(rotation, x, y)
        .into_iter()
        .filter(|cell| is_occupied_or_wall(rows, cell.x, cell.y))
        .count() as u32
}

pub(crate) fn t_corner_cells(rotation: u8, x: i8, y: i8) -> [Cell; 4] {
    let origin = t_origin(rotation, x, y);
    [
        Cell {
            x: origin.x - 1,
            y: origin.y - 1,
        },
        Cell {
            x: origin.x + 1,
            y: origin.y - 1,
        },
        Cell {
            x: origin.x - 1,
            y: origin.y + 1,
        },
        Cell {
            x: origin.x + 1,
            y: origin.y + 1,
        },
    ]
}

pub(crate) fn t_front_corner_cells(rotation: u8, x: i8, y: i8) -> [Cell; 2] {
    let origin = t_origin(rotation, x, y);
    match rotation {
        0 => [
            Cell {
                x: origin.x - 1,
                y: origin.y + 1,
            },
            Cell {
                x: origin.x + 1,
                y: origin.y + 1,
            },
        ],
        1 => [
            Cell {
                x: origin.x + 1,
                y: origin.y - 1,
            },
            Cell {
                x: origin.x + 1,
                y: origin.y + 1,
            },
        ],
        2 => [
            Cell {
                x: origin.x - 1,
                y: origin.y - 1,
            },
            Cell {
                x: origin.x + 1,
                y: origin.y - 1,
            },
        ],
        3 => [
            Cell {
                x: origin.x - 1,
                y: origin.y - 1,
            },
            Cell {
                x: origin.x - 1,
                y: origin.y + 1,
            },
        ],
        _ => [origin, origin],
    }
}

pub(crate) fn t_origin(rotation: u8, x: i8, y: i8) -> Cell {
    match rotation {
        0 => Cell { x: x + 1, y },
        1 => Cell { x, y: y + 1 },
        2 => Cell { x: x + 1, y: y + 1 },
        3 => Cell { x: x + 1, y: y + 1 },
        _ => Cell { x, y },
    }
}

pub(crate) fn is_occupied_or_wall(rows: &BoardRows, x: i8, y: i8) -> bool {
    if !(0..BOARD_WIDTH as i8).contains(&x) || !(0..BOARD_HEIGHT as i8).contains(&y) {
        return true;
    }
    rows[y as usize] & (1_u16 << x) != 0
}

pub(crate) fn spin_kind_name(kind: SpinKind) -> &'static str {
    match kind {
        SpinKind::None => "NONE",
        SpinKind::TSpin => "T_SPIN",
        SpinKind::TSpinMini => "T_SPIN_MINI",
        SpinKind::ImmobileSpin => "IMMOBILE_SPIN",
    }
}
