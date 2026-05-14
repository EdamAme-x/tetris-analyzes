use napi::bindgen_prelude::Result;
use std::sync::OnceLock;

use crate::board::{self, validate_row, BOARD_HEIGHT, BOARD_WIDTH, ROW_MASK};

pub(crate) const FUMEN_FIELD_HEIGHT: usize = 23;

pub(crate) fn rows_to_fumen_field(rows: &[u16]) -> Result<String> {
    board::validate_single_board_shape(rows)?;
    rows_to_fumen_field_string(rows)
}

pub(crate) fn batch_rows_to_fumen_fields(rows: &[u16], board_count: u32) -> Result<Vec<String>> {
    let board_count = board_count as usize;
    board::validate_board_shape(rows, board_count)?;

    let mut fields = Vec::with_capacity(board_count);
    for board_index in 0..board_count {
        let offset = board_index * BOARD_HEIGHT;
        fields.push(rows_to_fumen_field_string(
            &rows[offset..offset + BOARD_HEIGHT],
        )?);
    }

    Ok(fields)
}

pub(crate) fn rows_to_fumen_field_string(rows: &[u16]) -> Result<String> {
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
