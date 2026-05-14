use napi::bindgen_prelude::{Error, Result};

use crate::board::{BoardRows, BOARD_HEIGHT, BOARD_WIDTH};
use crate::movement::can_place;
use crate::pieces::{Cell, Piece, Shape};

#[derive(Clone, Copy)]
pub(crate) struct SpinDetection {
    pub(crate) kind: SpinKind,
    pub(crate) spin: bool,
    pub(crate) mini: bool,
    pub(crate) immobile: bool,
    pub(crate) force_back_to_back: bool,
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

#[derive(Clone, Copy, Eq, PartialEq)]
pub(crate) enum SpinMode {
    TSpins,
    TSpinsPlus,
    AllSpins,
    AllSpinsPlus,
    AllMini,
    AllMiniPlus,
    MiniOnly,
    Handheld,
    Stupid,
    None,
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
                force_back_to_back: false,
                occupied_corners,
                cleared_lines,
            };
        }

        return SpinDetection {
            kind: SpinKind::None,
            spin: false,
            mini: false,
            immobile,
            force_back_to_back: false,
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
            force_back_to_back: false,
            occupied_corners: 0,
            cleared_lines,
        };
    }

    SpinDetection {
        kind: SpinKind::None,
        spin: false,
        mini: false,
        immobile,
        force_back_to_back: false,
        occupied_corners: 0,
        cleared_lines,
    }
}

pub(crate) fn detect_spin_for_mode(
    locked_rows: &BoardRows,
    piece: Piece,
    shape: Shape,
    x: i8,
    y: i8,
    cleared_lines: u32,
    mode: SpinMode,
) -> SpinDetection {
    if piece != Piece::T
        && matches!(
            mode,
            SpinMode::TSpins | SpinMode::TSpinsPlus | SpinMode::None
        )
    {
        return SpinDetection {
            kind: SpinKind::None,
            spin: false,
            mini: false,
            immobile: false,
            force_back_to_back: false,
            occupied_corners: 0,
            cleared_lines,
        };
    }

    apply_spin_mode(
        detect_spin(locked_rows, piece, shape, x, y, cleared_lines),
        piece,
        mode,
    )
}

pub(crate) fn apply_spin_mode(
    detection: SpinDetection,
    piece: Piece,
    mode: SpinMode,
) -> SpinDetection {
    if mode == SpinMode::None {
        return without_spin(detection);
    }

    if mode == SpinMode::Stupid {
        return with_spin_kind(detection, SpinKind::TSpin, false);
    }

    if piece == Piece::T {
        if detection.kind != SpinKind::None {
            return detection;
        }
        if detection.immobile && mode_allows_immobile_t_mini(mode) {
            return with_spin_kind(detection, SpinKind::TSpinMini, true);
        }
        return without_spin(detection);
    }

    if !detection.immobile {
        return without_spin(detection);
    }

    match mode {
        SpinMode::AllSpins | SpinMode::AllSpinsPlus | SpinMode::Handheld => {
            with_spin_kind(detection, SpinKind::TSpin, false)
        }
        SpinMode::AllMini | SpinMode::AllMiniPlus | SpinMode::MiniOnly => {
            let mut spin = with_spin_kind(detection, SpinKind::TSpinMini, true);
            spin.force_back_to_back = true;
            spin
        }
        SpinMode::TSpins | SpinMode::TSpinsPlus | SpinMode::None | SpinMode::Stupid => {
            without_spin(detection)
        }
    }
}

pub(crate) fn parse_spin_mode(input: &str) -> Result<SpinMode> {
    let normalized = input.trim().to_ascii_uppercase().replace('_', "-");
    match normalized.as_str() {
        "T-SPINS" | "TSPINS" | "T-SPIN" | "TSPIN" => Ok(SpinMode::TSpins),
        "T-SPINS+" | "TSPINS+" | "T-SPIN+" | "TSPIN+" => Ok(SpinMode::TSpinsPlus),
        "ALL-SPINS" => Ok(SpinMode::AllSpins),
        "ALL-SPINS+" => Ok(SpinMode::AllSpinsPlus),
        "ALL-MINI" => Ok(SpinMode::AllMini),
        "ALL-MINI+" => Ok(SpinMode::AllMiniPlus),
        "MINI-ONLY" => Ok(SpinMode::MiniOnly),
        "HANDHELD" => Ok(SpinMode::Handheld),
        "STUPID" => Ok(SpinMode::Stupid),
        "NONE" => Ok(SpinMode::None),
        _ => Err(Error::from_reason(format!(
            "Unsupported native opener spin mode {input}."
        ))),
    }
}

fn mode_allows_immobile_t_mini(mode: SpinMode) -> bool {
    matches!(
        mode,
        SpinMode::TSpinsPlus | SpinMode::AllSpinsPlus | SpinMode::AllMiniPlus
    )
}

fn with_spin_kind(detection: SpinDetection, kind: SpinKind, mini: bool) -> SpinDetection {
    SpinDetection {
        kind,
        spin: true,
        mini,
        ..detection
    }
}

fn without_spin(detection: SpinDetection) -> SpinDetection {
    SpinDetection {
        kind: SpinKind::None,
        spin: false,
        mini: false,
        force_back_to_back: false,
        ..detection
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
    if x < 0
        || y < 0
        || x + shape.width > BOARD_WIDTH as i8
        || y + shape.height > BOARD_HEIGHT as i8
    {
        return output;
    }

    let x_shift = x as u32;
    let base_y = y as usize;
    for dy in 0..shape.height as usize {
        output[base_y + dy] &= !(shape.row_masks[dy] << x_shift);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_mini_non_t_spins_force_back_to_back_without_full_spin_attack() {
        let detection = SpinDetection {
            kind: SpinKind::ImmobileSpin,
            spin: true,
            mini: false,
            immobile: true,
            force_back_to_back: false,
            occupied_corners: 0,
            cleared_lines: 1,
        };

        let all_mini = apply_spin_mode(detection, Piece::I, SpinMode::AllMini);
        assert!(all_mini.kind == SpinKind::TSpinMini);
        assert!(all_mini.mini);
        assert!(all_mini.force_back_to_back);

        let tl = apply_spin_mode(detection, Piece::I, SpinMode::TSpins);
        assert!(tl.kind == SpinKind::None);
        assert!(!tl.force_back_to_back);
    }
}
