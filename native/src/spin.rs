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

impl SpinDetection {
    pub(crate) fn none(cleared_lines: u32) -> Self {
        Self {
            kind: SpinKind::None,
            spin: false,
            mini: false,
            immobile: false,
            force_back_to_back: false,
            halve_attack: false,
            occupied_corners: 0,
            cleared_lines,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
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
#[allow(dead_code)]
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
#[allow(dead_code)]
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
        let occupied_corners =
            count_handheld_occupied_corners(locked_rows, piece, shape.rotation, x, y);
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
    _locked_rows: &BoardRows,
    piece: Piece,
    shape: Shape,
    x: i8,
    y: i8,
    cleared_lines: u32,
    mode: SpinMode,
    rotation_kick_index: Option<usize>,
) -> SpinDetection {
    let immobile = is_placement_immobile_before_lock(rows_before_lock, shape, x, y);
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

pub(crate) fn detect_spin_for_mode_after_grounded_rotation(
    rows_before_lock: &BoardRows,
    piece: Piece,
    shape: Shape,
    x: i8,
    y: i8,
    cleared_lines: u32,
    mode: SpinMode,
    rotation_kick_index: Option<usize>,
    include_immobile: bool,
) -> SpinDetection {
    let Some(raw_kick_index) = rotation_kick_index else {
        return SpinDetection {
            kind: SpinKind::None,
            spin: false,
            mini: false,
            immobile: include_immobile
                && is_grounded_placement_immobile_before_lock(rows_before_lock, shape, x, y),
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
    if mode == SpinMode::None {
        return SpinDetection::none(cleared_lines);
    }

    if piece == Piece::T {
        let occupied_corners = count_t_occupied_corners(rows_before_lock, shape.rotation, x, y);
        if occupied_corners >= 3 {
            let front_corners = count_t_front_corners(rows_before_lock, shape.rotation, x, y);
            let mini = mode == SpinMode::MiniOnly || (front_corners != 2 && raw_kick_index != 4);
            return SpinDetection {
                kind: if mini {
                    SpinKind::TSpinMini
                } else {
                    SpinKind::TSpin
                },
                spin: true,
                mini,
                immobile: include_immobile
                    && is_grounded_placement_immobile_before_lock(rows_before_lock, shape, x, y),
                force_back_to_back: false,
                halve_attack: false,
                occupied_corners,
                cleared_lines,
            };
        }

        let fallback_spin = match mode {
            SpinMode::TSpinsPlus | SpinMode::AllMiniPlus | SpinMode::MiniOnly => {
                Some((SpinKind::TSpinMini, true))
            }
            SpinMode::AllSpinsPlus => Some((SpinKind::TSpin, false)),
            _ => None,
        };
        let Some((kind, mini)) = fallback_spin else {
            return SpinDetection {
                kind: SpinKind::None,
                spin: false,
                mini: false,
                immobile: include_immobile
                    && is_grounded_placement_immobile_before_lock(rows_before_lock, shape, x, y),
                force_back_to_back: false,
                halve_attack: false,
                occupied_corners,
                cleared_lines,
            };
        };
        let immobile = is_grounded_placement_immobile_before_lock(rows_before_lock, shape, x, y);
        return if immobile {
            SpinDetection {
                kind,
                spin: true,
                mini,
                immobile,
                force_back_to_back: false,
                halve_attack: false,
                occupied_corners,
                cleared_lines,
            }
        } else {
            SpinDetection {
                kind: SpinKind::None,
                spin: false,
                mini: false,
                immobile: include_immobile && immobile,
                force_back_to_back: false,
                halve_attack: false,
                occupied_corners,
                cleared_lines,
            }
        };
    }

    let occupied_corners = if matches!(piece, Piece::S | Piece::Z | Piece::J | Piece::L) {
        count_handheld_occupied_corners(rows_before_lock, piece, shape.rotation, x, y)
    } else {
        0
    };
    let halve_attack = occupied_corners >= 3;

    if mode == SpinMode::Stupid {
        return SpinDetection {
            kind: SpinKind::TSpin,
            spin: true,
            mini: false,
            immobile: include_immobile
                && is_grounded_placement_immobile_before_lock(rows_before_lock, shape, x, y),
            force_back_to_back: false,
            halve_attack,
            occupied_corners,
            cleared_lines,
        };
    }

    if mode == SpinMode::Handheld {
        return if occupied_corners >= 3 {
            SpinDetection {
                kind: SpinKind::TSpin,
                spin: true,
                mini: false,
                immobile: include_immobile
                    && is_grounded_placement_immobile_before_lock(rows_before_lock, shape, x, y),
                force_back_to_back: false,
                halve_attack: true,
                occupied_corners,
                cleared_lines,
            }
        } else {
            SpinDetection {
                kind: SpinKind::None,
                spin: false,
                mini: false,
                immobile: include_immobile
                    && is_grounded_placement_immobile_before_lock(rows_before_lock, shape, x, y),
                force_back_to_back: false,
                halve_attack: false,
                occupied_corners,
                cleared_lines,
            }
        };
    }

    let immobile_spin_mode = matches!(
        mode,
        SpinMode::AllSpins
            | SpinMode::AllSpinsPlus
            | SpinMode::AllMini
            | SpinMode::AllMiniPlus
            | SpinMode::MiniOnly
    );
    let immobile = if immobile_spin_mode || include_immobile {
        is_grounded_placement_immobile_before_lock(rows_before_lock, shape, x, y)
    } else {
        false
    };
    if !immobile_spin_mode || !immobile {
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
    let mini = matches!(
        mode,
        SpinMode::AllMini | SpinMode::AllMiniPlus | SpinMode::MiniOnly
    );
    SpinDetection {
        kind: if mini {
            SpinKind::TSpinMini
        } else {
            SpinKind::TSpin
        },
        spin: true,
        mini,
        immobile,
        force_back_to_back: mini && cleared_lines > 0,
        halve_attack,
        occupied_corners,
        cleared_lines,
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
    could_spin_grounded_for_mode(rows_before_lock, locked_rows, piece, shape, x, y, mode)
}

pub(crate) fn could_spin_grounded_for_mode(
    rows_before_lock: &BoardRows,
    _locked_rows: &BoardRows,
    piece: Piece,
    shape: Shape,
    x: i8,
    y: i8,
    mode: SpinMode,
) -> bool {
    if mode == SpinMode::None {
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
            | SpinMode::MiniOnly => {
                corner_spin
                    || is_grounded_placement_immobile_before_lock(rows_before_lock, shape, x, y)
            }
            SpinMode::Stupid | SpinMode::None => false,
        };
    }

    let immobile = is_grounded_placement_immobile_before_lock(rows_before_lock, shape, x, y);
    match mode {
        SpinMode::Handheld => {
            matches!(piece, Piece::S | Piece::Z | Piece::J | Piece::L)
                && count_handheld_occupied_corners(rows_before_lock, piece, shape.rotation, x, y)
                    >= 3
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
            let mini = front_corners != 2 && raw_kick_index != 4;
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
        count_handheld_occupied_corners(rows_before_lock, piece, shape.rotation, x, y)
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
#[allow(dead_code)]
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

#[cfg(test)]
pub(crate) fn is_placement_immobile(locked_rows: &BoardRows, shape: Shape, x: i8, y: i8) -> bool {
    let board_without_piece = remove_shape_cells(locked_rows, shape, x, y);
    is_placement_immobile_before_lock(&board_without_piece, shape, x, y)
}

fn is_placement_immobile_before_lock(
    rows_before_lock: &BoardRows,
    shape: Shape,
    x: i8,
    y: i8,
) -> bool {
    !can_place(rows_before_lock, shape, x - 1, y)
        && !can_place(rows_before_lock, shape, x + 1, y)
        && !can_place(rows_before_lock, shape, x, y - 1)
        && !can_place(rows_before_lock, shape, x, y + 1)
}

fn is_grounded_placement_immobile_before_lock(
    rows_before_lock: &BoardRows,
    shape: Shape,
    x: i8,
    y: i8,
) -> bool {
    !can_place(rows_before_lock, shape, x - 1, y)
        && !can_place(rows_before_lock, shape, x + 1, y)
        && !can_place(rows_before_lock, shape, x, y + 1)
}

fn is_grounded(rows_before_lock: &BoardRows, shape: Shape, x: i8, y: i8) -> bool {
    !can_place(rows_before_lock, shape, x, y - 1)
}

#[cfg(test)]
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

pub(crate) fn count_handheld_occupied_corners(
    rows: &BoardRows,
    piece: Piece,
    rotation: u8,
    x: i8,
    y: i8,
) -> u32 {
    handheld_corner_cells(piece, rotation, x, y)
        .into_iter()
        .flatten()
        .filter(|cell| is_occupied_or_wall(rows, cell.x, cell.y))
        .count() as u32
}

fn handheld_corner_cells(piece: Piece, rotation: u8, x: i8, y: i8) -> [Option<Cell>; 4] {
    let offsets: [(i8, i8); 4] = match piece {
        Piece::T => match rotation {
            0 => [(0, 1), (2, 1), (2, -1), (0, -1)],
            1 => [(-1, 2), (1, 2), (1, 0), (-1, 0)],
            2 | 3 => [(0, 2), (2, 2), (2, 0), (0, 0)],
            _ => return [None, None, None, None],
        },
        Piece::S => match rotation {
            0 | 2 => [(0, 1), (3, 1), (2, 0), (-1, 0)],
            1 => [(0, 3), (1, 2), (1, -1), (0, 0)],
            3 => [(0, 3), (1, 2), (0, 0), (1, -1)],
            _ => return [None, None, None, None],
        },
        Piece::Z => match rotation {
            0 | 2 => [(-1, 1), (2, 1), (3, 0), (0, 0)],
            1 => [(0, 2), (1, 3), (0, -1), (1, 0)],
            3 => [(0, 2), (1, 3), (1, 0), (0, -1)],
            _ => return [None, None, None, None],
        },
        Piece::J => match rotation {
            0 => [(1, 1), (2, 1), (2, -1), (0, -1)],
            1 => [(-1, 2), (1, 1), (1, 0), (-1, 0)],
            2 => [(0, 2), (2, 2), (1, 0), (0, 0)],
            3 => [(0, 2), (2, 2), (2, 0), (0, 1)],
            _ => return [None, None, None, None],
        },
        Piece::L => match rotation {
            0 => [(0, 1), (1, 1), (2, -1), (0, -1)],
            1 => [(-1, 2), (1, 2), (1, 1), (-1, 0)],
            2 => [(0, 2), (2, 2), (2, 0), (1, 0)],
            3 => [(0, 1), (2, 2), (2, 0), (0, 0)],
            _ => return [None, None, None, None],
        },
        Piece::I | Piece::O => return [None, None, None, None],
    };
    offsets.map(|(dx, dy)| {
        Some(Cell {
            x: x + dx,
            y: y + dy,
        })
    })
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
        rows[1] = (1 << 0) | (1 << 3);
        let shape = piece_shapes(Piece::S)[0];
        let locked = lock_shape(&rows, shape, 0, 0).expect("S piece should lock on floor");

        let handheld = detect_spin_for_mode_after_rotation(
            &rows,
            &locked,
            Piece::S,
            shape,
            0,
            0,
            2,
            SpinMode::Handheld,
            Some(0),
        );
        assert!(handheld.kind == SpinKind::TSpin);
        assert!(handheld.spin);
        assert_eq!(handheld.occupied_corners, 3);
        assert!(handheld.halve_attack);

        let t_spins = detect_spin_for_mode_after_rotation(
            &rows,
            &locked,
            Piece::S,
            shape,
            0,
            0,
            2,
            SpinMode::TSpins,
            Some(0),
        );
        assert!(t_spins.kind == SpinKind::None);
        assert!(!t_spins.spin);
    }

    #[test]
    fn grounded_fast_spin_detection_matches_full_detector() {
        let mut t_rows = [0_u16; BOARD_HEIGHT];
        t_rows[1] = (1 << 3) | (1 << 5);
        assert_grounded_fast_spin_matches_full(&t_rows, Piece::T, 0, 3, 0, 2);

        let mut s_rows = [0_u16; BOARD_HEIGHT];
        s_rows[1] = (1 << 0) | (1 << 3);
        assert_grounded_fast_spin_matches_full(&s_rows, Piece::S, 0, 0, 0, 2);
    }

    fn assert_grounded_fast_spin_matches_full(
        rows: &BoardRows,
        piece: Piece,
        shape_index: usize,
        x: i8,
        y: i8,
        cleared_lines: u32,
    ) {
        let shape = piece_shapes(piece)[shape_index];
        let locked = lock_shape(rows, shape, x, y).expect("test piece should lock");
        for mode in [
            SpinMode::TSpins,
            SpinMode::TSpinsPlus,
            SpinMode::AllSpins,
            SpinMode::AllSpinsPlus,
            SpinMode::AllMini,
            SpinMode::AllMiniPlus,
            SpinMode::MiniOnly,
            SpinMode::Handheld,
            SpinMode::Stupid,
        ] {
            let full = detect_spin_for_mode_after_rotation(
                rows,
                &locked,
                piece,
                shape,
                x,
                y,
                cleared_lines,
                mode,
                Some(0),
            );
            let fast = detect_spin_for_mode_after_grounded_rotation(
                rows,
                piece,
                shape,
                x,
                y,
                cleared_lines,
                mode,
                Some(0),
                true,
            );
            assert_eq!(spin_signature(full), spin_signature(fast));
        }
    }

    fn spin_signature(spin: SpinDetection) -> (SpinKind, bool, bool, bool, bool, bool, u32, u32) {
        (
            spin.kind,
            spin.spin,
            spin.mini,
            spin.immobile,
            spin.force_back_to_back,
            spin.halve_attack,
            spin.occupied_corners,
            spin.cleared_lines,
        )
    }
}
