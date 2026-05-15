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
    pub(crate) halve_attack: bool,
    pub(crate) occupied_corners: u32,
    pub(crate) cleared_lines: u32,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub(crate) enum SpinKind {
    None,
    TSpin,
    TSpinMini,
    #[allow(dead_code)]
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

#[cfg(test)]
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
        return detect_t_spin_corners(locked_rows, shape.rotation, x, y, cleared_lines, immobile);
    }

    if immobile {
        return SpinDetection {
            kind: SpinKind::ImmobileSpin,
            spin: true,
            mini: false,
            immobile,
            force_back_to_back: false,
            halve_attack: false,
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
        halve_attack: false,
        occupied_corners: 0,
        cleared_lines,
    }
}

#[cfg(test)]
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
            halve_attack: false,
            occupied_corners: 0,
            cleared_lines,
        };
    }

    if piece != Piece::T && mode == SpinMode::Handheld {
        let occupied_corners = count_piece_occupied_corners(locked_rows, shape, x, y);
        return SpinDetection {
            kind: if occupied_corners >= 3 {
                SpinKind::TSpin
            } else {
                SpinKind::None
            },
            spin: occupied_corners >= 3,
            mini: false,
            immobile: false,
            force_back_to_back: false,
            halve_attack: occupied_corners >= 3,
            occupied_corners,
            cleared_lines,
        };
    }

    if piece == Piece::T && !mode_allows_immobile_t_mini(mode) {
        return apply_spin_mode(
            detect_t_spin_corners(locked_rows, shape.rotation, x, y, cleared_lines, false),
            piece,
            mode,
        );
    }

    apply_spin_mode(
        detect_spin(locked_rows, piece, shape, x, y, cleared_lines),
        piece,
        mode,
    )
}

pub(crate) fn detect_spin_for_mode_after_rotation(
    rows_before_lock: &BoardRows,
    locked_rows: &BoardRows,
    piece: Piece,
    shape: Shape,
    x: i8,
    y: i8,
    cleared_lines: u32,
    mode: SpinMode,
    rotation_kick_index: Option<usize>,
) -> SpinDetection {
    let immobile = is_placement_immobile(locked_rows, shape, x, y);
    let Some(raw_kick_index) = rotation_kick_index else {
        return SpinDetection {
            kind: SpinKind::None,
            spin: false,
            mini: false,
            immobile,
            force_back_to_back: false,
            halve_attack: false,
            occupied_corners: if piece == Piece::T {
                count_t_occupied_corners(rows_before_lock, shape.rotation, x, y)
            } else {
                0
            },
            cleared_lines,
        };
    };

    if mode == SpinMode::None || !is_grounded(rows_before_lock, shape, x, y) {
        return SpinDetection {
            kind: SpinKind::None,
            spin: false,
            mini: false,
            immobile,
            force_back_to_back: false,
            halve_attack: false,
            occupied_corners: 0,
            cleared_lines,
        };
    }

    let corner_spin = detect_corner_spin_after_rotation(
        rows_before_lock,
        piece,
        shape,
        x,
        y,
        cleared_lines,
        immobile,
        raw_kick_index,
    );

    match mode {
        SpinMode::None => without_spin(corner_spin),
        SpinMode::Stupid => with_spin_kind(corner_spin, SpinKind::TSpin, false),
        SpinMode::TSpins | SpinMode::Handheld => {
            if mode_allows_corner_spin_piece(mode, piece) {
                corner_spin
            } else {
                without_spin(corner_spin)
            }
        }
        SpinMode::TSpinsPlus => {
            if piece != Piece::T {
                without_spin(corner_spin)
            } else if corner_spin.kind != SpinKind::None {
                corner_spin
            } else if immobile {
                with_spin_kind(corner_spin, SpinKind::TSpinMini, true)
            } else {
                without_spin(corner_spin)
            }
        }
        SpinMode::AllSpins | SpinMode::AllMini => {
            if piece == Piece::T {
                corner_spin
            } else if immobile {
                let mini = mode == SpinMode::AllMini;
                let mut spin = with_spin_kind(
                    corner_spin,
                    if mini {
                        SpinKind::TSpinMini
                    } else {
                        SpinKind::TSpin
                    },
                    mini,
                );
                spin.force_back_to_back = mini && cleared_lines > 0;
                spin
            } else {
                without_spin(corner_spin)
            }
        }
        SpinMode::AllSpinsPlus | SpinMode::AllMiniPlus | SpinMode::MiniOnly => {
            if piece == Piece::T && corner_spin.kind != SpinKind::None {
                if mode == SpinMode::MiniOnly {
                    with_spin_kind(corner_spin, SpinKind::TSpinMini, true)
                } else {
                    corner_spin
                }
            } else if immobile {
                let mini = mode != SpinMode::AllSpinsPlus;
                let mut spin = with_spin_kind(
                    corner_spin,
                    if mini {
                        SpinKind::TSpinMini
                    } else {
                        SpinKind::TSpin
                    },
                    mini,
                );
                spin.force_back_to_back = mini && cleared_lines > 0;
                spin
            } else {
                without_spin(corner_spin)
            }
        }
    }
}

pub(crate) fn could_spin_for_mode(
    rows_before_lock: &BoardRows,
    locked_rows: &BoardRows,
    piece: Piece,
    shape: Shape,
    x: i8,
    y: i8,
    mode: SpinMode,
) -> bool {
    if mode == SpinMode::None || !is_grounded(rows_before_lock, shape, x, y) {
        return false;
    }
    if mode == SpinMode::Stupid {
        return true;
    }

    if piece == Piece::T {
        let corner_spin = count_t_occupied_corners(rows_before_lock, shape.rotation, x, y) >= 3;
        return match mode {
            SpinMode::TSpins | SpinMode::AllSpins | SpinMode::AllMini | SpinMode::Handheld => {
                corner_spin
            }
            SpinMode::TSpinsPlus
            | SpinMode::AllSpinsPlus
            | SpinMode::AllMiniPlus
            | SpinMode::MiniOnly => corner_spin || is_placement_immobile(locked_rows, shape, x, y),
            SpinMode::Stupid | SpinMode::None => false,
        };
    }

    let immobile = is_placement_immobile(locked_rows, shape, x, y);
    match mode {
        SpinMode::Handheld => {
            matches!(piece, Piece::S | Piece::Z | Piece::J | Piece::L)
                && count_piece_occupied_corners(rows_before_lock, shape, x, y) >= 3
        }
        SpinMode::AllSpins
        | SpinMode::AllSpinsPlus
        | SpinMode::AllMini
        | SpinMode::AllMiniPlus
        | SpinMode::MiniOnly => immobile,
        SpinMode::TSpins | SpinMode::TSpinsPlus | SpinMode::Stupid | SpinMode::None => false,
    }
}

fn detect_corner_spin_after_rotation(
    rows_before_lock: &BoardRows,
    piece: Piece,
    shape: Shape,
    x: i8,
    y: i8,
    cleared_lines: u32,
    immobile: bool,
    raw_kick_index: usize,
) -> SpinDetection {
    if piece == Piece::T {
        let occupied_corners = count_t_occupied_corners(rows_before_lock, shape.rotation, x, y);
        if occupied_corners >= 3 {
            let front_corners = count_t_front_corners(rows_before_lock, shape.rotation, x, y);
            let mini = front_corners != 2 && raw_kick_index != 3;
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
                halve_attack: false,
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
            halve_attack: false,
            occupied_corners,
            cleared_lines,
        };
    }

    let occupied_corners = if matches!(piece, Piece::S | Piece::Z | Piece::J | Piece::L) {
        count_piece_occupied_corners(rows_before_lock, shape, x, y)
    } else {
        0
    };
    if occupied_corners >= 3 {
        SpinDetection {
            kind: SpinKind::TSpin,
            spin: true,
            mini: false,
            immobile,
            force_back_to_back: false,
            halve_attack: piece != Piece::T,
            occupied_corners,
            cleared_lines,
        }
    } else {
        SpinDetection {
            kind: SpinKind::None,
            spin: false,
            mini: false,
            immobile,
            force_back_to_back: false,
            halve_attack: false,
            occupied_corners,
            cleared_lines,
        }
    }
}

#[cfg(test)]
fn detect_t_spin_corners(
    locked_rows: &BoardRows,
    rotation: u8,
    x: i8,
    y: i8,
    cleared_lines: u32,
    immobile: bool,
) -> SpinDetection {
    let occupied_corners = count_t_occupied_corners(locked_rows, rotation, x, y);
    if occupied_corners >= 3 {
        let front_corners = count_t_front_corners(locked_rows, rotation, x, y);
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
            halve_attack: false,
            occupied_corners,
            cleared_lines,
        };
    }

    SpinDetection {
        kind: SpinKind::None,
        spin: false,
        mini: false,
        immobile,
        force_back_to_back: false,
        halve_attack: false,
        occupied_corners,
        cleared_lines,
    }
}

#[cfg(test)]
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
            spin.force_back_to_back = detection.cleared_lines > 0;
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

#[cfg(test)]
fn mode_allows_immobile_t_mini(mode: SpinMode) -> bool {
    matches!(
        mode,
        SpinMode::TSpinsPlus | SpinMode::AllSpinsPlus | SpinMode::AllMiniPlus
    )
}

fn mode_allows_corner_spin_piece(mode: SpinMode, piece: Piece) -> bool {
    match mode {
        SpinMode::Handheld => matches!(piece, Piece::T | Piece::S | Piece::Z | Piece::J | Piece::L),
        SpinMode::TSpins | SpinMode::TSpinsPlus => piece == Piece::T,
        _ => piece == Piece::T,
    }
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
        halve_attack: false,
        ..detection
    }
}

pub(crate) fn is_placement_immobile(locked_rows: &BoardRows, shape: Shape, x: i8, y: i8) -> bool {
    let board_without_piece = remove_shape_cells(locked_rows, shape, x, y);
    !can_place(&board_without_piece, shape, x - 1, y)
        && !can_place(&board_without_piece, shape, x + 1, y)
        && !can_place(&board_without_piece, shape, x, y - 1)
        && !can_place(&board_without_piece, shape, x, y + 1)
}

fn is_grounded(rows_before_lock: &BoardRows, shape: Shape, x: i8, y: i8) -> bool {
    !can_place(rows_before_lock, shape, x, y - 1)
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

pub(crate) fn count_piece_occupied_corners(rows: &BoardRows, shape: Shape, x: i8, y: i8) -> u32 {
    [
        Cell { x: x - 1, y: y - 1 },
        Cell {
            x: x + shape.width,
            y: y - 1,
        },
        Cell {
            x: x - 1,
            y: y + shape.height,
        },
        Cell {
            x: x + shape.width,
            y: y + shape.height,
        },
    ]
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
    use crate::movement::lock_shape;
    use crate::pieces::piece_shapes;

    #[test]
    fn all_mini_non_t_spins_force_back_to_back_without_full_spin_attack() {
        let detection = SpinDetection {
            kind: SpinKind::ImmobileSpin,
            spin: true,
            mini: false,
            immobile: true,
            force_back_to_back: false,
            halve_attack: false,
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

    #[test]
    fn handheld_non_t_uses_four_corner_detection_and_half_attack() {
        let mut rows = [0_u16; BOARD_HEIGHT];
        rows[1] = 1 << 2;
        let shape = piece_shapes(Piece::I)[0];
        let locked = lock_shape(&rows, shape, 3, 0).expect("I piece should lock on floor");

        let handheld = detect_spin_for_mode(&locked, Piece::I, shape, 3, 0, 2, SpinMode::Handheld);
        assert!(handheld.kind == SpinKind::TSpin);
        assert!(handheld.spin);
        assert_eq!(handheld.occupied_corners, 3);
        assert!(handheld.halve_attack);

        let all_spins = detect_spin_for_mode(&locked, Piece::I, shape, 3, 0, 2, SpinMode::AllSpins);
        assert!(all_spins.kind == SpinKind::None);
        assert!(!all_spins.spin);
    }
}
