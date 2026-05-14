use napi::bindgen_prelude::{Error, Result};

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) enum Piece {
    I,
    O,
    T,
    S,
    Z,
    J,
    L,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub(crate) struct Cell {
    pub(crate) x: i8,
    pub(crate) y: i8,
}

#[derive(Clone, Copy)]
pub(crate) struct Shape {
    pub(crate) rotation: u8,
    pub(crate) width: i8,
    pub(crate) height: i8,
    pub(crate) cells: &'static [Cell],
    pub(crate) row_masks: [u16; 4],
}

pub(crate) fn parse_queue(queue: &str) -> Result<Vec<Piece>> {
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

pub(crate) fn parse_piece(char: char) -> Result<Piece> {
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

pub(crate) fn parse_piece_string(input: &str) -> Result<Piece> {
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

pub(crate) fn piece_name(piece: Piece) -> &'static str {
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

pub(crate) fn format_placement(
    piece: Piece,
    rotation: u8,
    x: i8,
    y: i8,
    used_hold: bool,
) -> String {
    let prefix = if used_hold { "hold:" } else { "" };
    format!("{prefix}{}@r{},x{},y{}", piece_name(piece), rotation, x, y)
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
    Cell { x: 1, y: 2 },
];
const J2: &[Cell] = &[
    Cell { x: 0, y: 1 },
    Cell { x: 1, y: 1 },
    Cell { x: 2, y: 0 },
    Cell { x: 2, y: 1 },
];
const J3: &[Cell] = &[
    Cell { x: 1, y: 0 },
    Cell { x: 1, y: 1 },
    Cell { x: 1, y: 2 },
    Cell { x: 0, y: 0 },
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
    Cell { x: 1, y: 0 },
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
    Cell { x: 0, y: 2 },
];

const I_SHAPES: &[Shape] = &[
    Shape {
        rotation: 0,
        width: 4,
        height: 1,
        cells: I0,
        row_masks: [0b1111, 0, 0, 0],
    },
    Shape {
        rotation: 1,
        width: 1,
        height: 4,
        cells: I1,
        row_masks: [0b1, 0b1, 0b1, 0b1],
    },
    Shape {
        rotation: 2,
        width: 4,
        height: 1,
        cells: I0,
        row_masks: [0b1111, 0, 0, 0],
    },
    Shape {
        rotation: 3,
        width: 1,
        height: 4,
        cells: I1,
        row_masks: [0b1, 0b1, 0b1, 0b1],
    },
];
const O_SHAPES: &[Shape] = &[
    Shape {
        rotation: 0,
        width: 2,
        height: 2,
        cells: O0,
        row_masks: [0b11, 0b11, 0, 0],
    },
    Shape {
        rotation: 1,
        width: 2,
        height: 2,
        cells: O0,
        row_masks: [0b11, 0b11, 0, 0],
    },
    Shape {
        rotation: 2,
        width: 2,
        height: 2,
        cells: O0,
        row_masks: [0b11, 0b11, 0, 0],
    },
    Shape {
        rotation: 3,
        width: 2,
        height: 2,
        cells: O0,
        row_masks: [0b11, 0b11, 0, 0],
    },
];
const T_SHAPES: &[Shape] = &[
    Shape {
        rotation: 0,
        width: 3,
        height: 2,
        cells: T0,
        row_masks: [0b111, 0b010, 0, 0],
    },
    Shape {
        rotation: 1,
        width: 2,
        height: 3,
        cells: T1,
        row_masks: [0b01, 0b11, 0b01, 0],
    },
    Shape {
        rotation: 2,
        width: 3,
        height: 2,
        cells: T2,
        row_masks: [0b010, 0b111, 0, 0],
    },
    Shape {
        rotation: 3,
        width: 2,
        height: 3,
        cells: T3,
        row_masks: [0b10, 0b11, 0b10, 0],
    },
];
const S_SHAPES: &[Shape] = &[
    Shape {
        rotation: 0,
        width: 3,
        height: 2,
        cells: S0,
        row_masks: [0b011, 0b110, 0, 0],
    },
    Shape {
        rotation: 1,
        width: 2,
        height: 3,
        cells: S1,
        row_masks: [0b10, 0b11, 0b01, 0],
    },
    Shape {
        rotation: 2,
        width: 3,
        height: 2,
        cells: S0,
        row_masks: [0b011, 0b110, 0, 0],
    },
    Shape {
        rotation: 3,
        width: 2,
        height: 3,
        cells: S1,
        row_masks: [0b10, 0b11, 0b01, 0],
    },
];
const Z_SHAPES: &[Shape] = &[
    Shape {
        rotation: 0,
        width: 3,
        height: 2,
        cells: Z0,
        row_masks: [0b110, 0b011, 0, 0],
    },
    Shape {
        rotation: 1,
        width: 2,
        height: 3,
        cells: Z1,
        row_masks: [0b01, 0b11, 0b10, 0],
    },
    Shape {
        rotation: 2,
        width: 3,
        height: 2,
        cells: Z0,
        row_masks: [0b110, 0b011, 0, 0],
    },
    Shape {
        rotation: 3,
        width: 2,
        height: 3,
        cells: Z1,
        row_masks: [0b01, 0b11, 0b10, 0],
    },
];
const J_SHAPES: &[Shape] = &[
    Shape {
        rotation: 0,
        width: 3,
        height: 2,
        cells: J0,
        row_masks: [0b111, 0b001, 0, 0],
    },
    Shape {
        rotation: 1,
        width: 2,
        height: 3,
        cells: J1,
        row_masks: [0b01, 0b01, 0b11, 0],
    },
    Shape {
        rotation: 2,
        width: 3,
        height: 2,
        cells: J2,
        row_masks: [0b100, 0b111, 0, 0],
    },
    Shape {
        rotation: 3,
        width: 2,
        height: 3,
        cells: J3,
        row_masks: [0b11, 0b10, 0b10, 0],
    },
];
const L_SHAPES: &[Shape] = &[
    Shape {
        rotation: 0,
        width: 3,
        height: 2,
        cells: L0,
        row_masks: [0b111, 0b100, 0, 0],
    },
    Shape {
        rotation: 1,
        width: 2,
        height: 3,
        cells: L1,
        row_masks: [0b11, 0b01, 0b01, 0],
    },
    Shape {
        rotation: 2,
        width: 3,
        height: 2,
        cells: L2,
        row_masks: [0b001, 0b111, 0, 0],
    },
    Shape {
        rotation: 3,
        width: 2,
        height: 3,
        cells: L3,
        row_masks: [0b10, 0b10, 0b11, 0],
    },
];

pub(crate) fn piece_shapes(piece: Piece) -> &'static [Shape] {
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

pub(crate) fn placement_shape_indices(piece: Piece) -> &'static [usize] {
    match piece {
        Piece::I | Piece::S | Piece::Z => &[0, 1],
        Piece::O => &[0],
        Piece::T | Piece::J | Piece::L => &[0, 1, 2, 3],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shape_row_masks_match_declared_cells() {
        for piece in [
            Piece::I,
            Piece::O,
            Piece::T,
            Piece::S,
            Piece::Z,
            Piece::J,
            Piece::L,
        ] {
            for shape in piece_shapes(piece) {
                let mut expected = [0_u16; 4];
                for cell in shape.cells {
                    expected[cell.y as usize] |= 1_u16 << cell.x;
                }

                assert_eq!(
                    shape.row_masks,
                    expected,
                    "{} r{} row masks must match cells",
                    piece_name(piece),
                    shape.rotation
                );
            }
        }
    }

    #[test]
    fn shape_arrays_are_indexed_by_rotation() {
        for piece in [
            Piece::I,
            Piece::O,
            Piece::T,
            Piece::S,
            Piece::Z,
            Piece::J,
            Piece::L,
        ] {
            for (index, shape) in piece_shapes(piece).iter().enumerate() {
                assert_eq!(
                    usize::from(shape.rotation),
                    index,
                    "{} shape index must match rotation",
                    piece_name(piece)
                );
            }
        }
    }
}
