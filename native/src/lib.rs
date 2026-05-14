use napi::bindgen_prelude::*;
use napi_derive::napi;

const BOARD_WIDTH: usize = 10;
const BOARD_HEIGHT: usize = 20;
const FUMEN_FIELD_HEIGHT: usize = 23;
const ROW_MASK: u16 = (1 << BOARD_WIDTH) - 1;

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
    validate_single_board(rows)?;
    Ok(rows.iter().all(|row| *row == 0))
}

#[napi(js_name = "countOccupiedCells")]
pub fn count_occupied_cells(rows: Uint16Array) -> Result<u32> {
    let rows = rows.as_ref();
    validate_single_board(rows)?;
    Ok(count_occupied_cells_in_rows(rows))
}

#[napi(js_name = "clearFullLines")]
pub fn clear_full_lines(rows: Uint16Array) -> Result<Uint16Array> {
    let rows = rows.as_ref();
    validate_single_board(rows)?;

    let mut output = vec![0_u16; BOARD_HEIGHT];
    clear_full_lines_into(rows, &mut output);

    Ok(output.into())
}

#[napi(js_name = "batchCountOccupiedCells")]
pub fn batch_count_occupied_cells(rows: Uint16Array, board_count: u32) -> Result<Uint32Array> {
    let rows = rows.as_ref();
    let board_count = board_count as usize;
    validate_board_rows(rows, board_count)?;

    let mut counts = Vec::with_capacity(board_count);
    for board_index in 0..board_count {
        let offset = board_index * BOARD_HEIGHT;
        counts.push(count_occupied_cells_in_rows(
            &rows[offset..offset + BOARD_HEIGHT],
        ));
    }

    Ok(counts.into())
}

#[napi(js_name = "batchClearFullLines")]
pub fn batch_clear_full_lines(rows: Uint16Array, board_count: u32) -> Result<Uint16Array> {
    let rows = rows.as_ref();
    let board_count = board_count as usize;
    validate_board_rows(rows, board_count)?;

    let mut output = vec![0_u16; rows.len()];
    for board_index in 0..board_count {
        let offset = board_index * BOARD_HEIGHT;
        clear_full_lines_into(
            &rows[offset..offset + BOARD_HEIGHT],
            &mut output[offset..offset + BOARD_HEIGHT],
        );
    }

    Ok(output.into())
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
    validate_single_board(rows)?;
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
    validate_single_board(rows)?;
    Ok(rows_to_fumen_field_string(rows))
}

#[napi(js_name = "batchRowsToFumenFields")]
pub fn batch_rows_to_fumen_fields(rows: Uint16Array, board_count: u32) -> Result<Vec<String>> {
    let rows = rows.as_ref();
    let board_count = board_count as usize;
    validate_board_rows(rows, board_count)?;

    let mut fields = Vec::with_capacity(board_count);
    for board_index in 0..board_count {
        let offset = board_index * BOARD_HEIGHT;
        fields.push(rows_to_fumen_field_string(
            &rows[offset..offset + BOARD_HEIGHT],
        ));
    }

    Ok(fields)
}

fn validate_board_rows(rows: &[u16], board_count: usize) -> Result<()> {
    let expected_rows = board_count * BOARD_HEIGHT;
    if rows.len() != expected_rows {
        return Err(Error::from_reason(format!(
            "Expected {expected_rows} row values, got {}.",
            rows.len()
        )));
    }

    for (index, row) in rows.iter().copied().enumerate() {
        if row & !ROW_MASK != 0 {
            return Err(Error::from_reason(format!(
                "Row {index} must fit in {BOARD_WIDTH} bits, got {row}."
            )));
        }
    }

    Ok(())
}

fn validate_single_board(rows: &[u16]) -> Result<()> {
    validate_board_rows(rows, 1)
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

fn count_occupied_cells_in_rows(rows: &[u16]) -> u32 {
    rows.iter().map(|row| row.count_ones()).sum()
}

fn clear_full_lines_into(rows: &[u16], output: &mut [u16]) {
    output.fill(0);
    let mut write_y = 0;
    for row in rows.iter().copied() {
        if row != ROW_MASK {
            output[write_y] = row;
            write_y += 1;
        }
    }
}

fn rows_to_fumen_field_string(rows: &[u16]) -> String {
    let mut field = String::with_capacity(FUMEN_FIELD_HEIGHT * BOARD_WIDTH);

    for y in (0..FUMEN_FIELD_HEIGHT).rev() {
        let row = if y < BOARD_HEIGHT { rows[y] } else { 0 };
        for x in 0..BOARD_WIDTH {
            if row & (1_u16 << x) == 0 {
                field.push('_');
            } else {
                field.push('X');
            }
        }
    }

    field
}
