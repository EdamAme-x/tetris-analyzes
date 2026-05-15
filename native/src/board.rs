use napi::bindgen_prelude::{Error, Result};

pub(crate) const BOARD_WIDTH: usize = 10;
pub(crate) const BOARD_HEIGHT: usize = 20;
pub(crate) const BOARD_EVALUATION_STRIDE: usize = 5;
pub(crate) const ROW_MASK: u16 = (1 << BOARD_WIDTH) - 1;

pub(crate) type BoardRows = [u16; BOARD_HEIGHT];
pub(crate) type BoardEvaluation = [u32; BOARD_EVALUATION_STRIDE];

pub(crate) fn create_empty_board() -> Vec<u16> {
    vec![0_u16; BOARD_HEIGHT]
}

pub(crate) fn copy_board_rows(rows: &[u16]) -> Result<Vec<u16>> {
    validate_single_board(rows)?;
    Ok(rows.to_vec())
}

pub(crate) fn is_perfect_clear(rows: &[u16]) -> Result<bool> {
    validate_single_board_shape(rows)?;

    for (index, row) in rows.iter().copied().enumerate() {
        validate_row(row, index)?;
        if row != 0 {
            return Ok(false);
        }
    }

    Ok(true)
}

pub(crate) fn count_occupied_cells(rows: &[u16]) -> Result<u32> {
    validate_single_board_shape(rows)?;
    count_occupied_cells_in_rows(rows, 0)
}

pub(crate) fn clear_full_lines(rows: &[u16]) -> Result<Vec<u16>> {
    validate_single_board_shape(rows)?;

    let mut output = vec![0_u16; BOARD_HEIGHT];
    clear_full_lines_into(rows, &mut output, 0)?;

    Ok(output)
}

pub(crate) fn batch_count_occupied_cells(rows: &[u16], board_count: u32) -> Result<Vec<u32>> {
    let board_count = board_count as usize;
    validate_board_shape(rows, board_count)?;

    let mut counts = Vec::with_capacity(board_count);
    for board_index in 0..board_count {
        let offset = board_index * BOARD_HEIGHT;
        counts.push(count_occupied_cells_in_rows(
            &rows[offset..offset + BOARD_HEIGHT],
            offset,
        )?);
    }

    Ok(counts)
}

pub(crate) fn batch_clear_full_lines(rows: &[u16], board_count: u32) -> Result<Vec<u16>> {
    let board_count = board_count as usize;
    validate_board_shape(rows, board_count)?;

    let mut output = vec![0_u16; rows.len()];
    for board_index in 0..board_count {
        let offset = board_index * BOARD_HEIGHT;
        clear_full_lines_into(
            &rows[offset..offset + BOARD_HEIGHT],
            &mut output[offset..offset + BOARD_HEIGHT],
            offset,
        )?;
    }

    Ok(output)
}

pub(crate) fn batch_evaluate_boards(rows: &[u16], board_count: u32) -> Result<Vec<u32>> {
    let board_count = board_count as usize;
    validate_board_shape(rows, board_count)?;

    let mut evaluations = Vec::with_capacity(board_count * BOARD_EVALUATION_STRIDE);
    for board_index in 0..board_count {
        let offset = board_index * BOARD_HEIGHT;
        evaluations.extend_from_slice(&evaluate_board(
            &rows[offset..offset + BOARD_HEIGHT],
            offset,
        )?);
    }

    Ok(evaluations)
}

pub(crate) fn create_garbage_rows(holes: &[u8]) -> Result<Vec<u16>> {
    validate_garbage_holes(holes)?;

    let rows = holes
        .iter()
        .map(|hole| ROW_MASK ^ (1_u16 << *hole))
        .collect::<Vec<u16>>();
    Ok(rows)
}

pub(crate) fn apply_garbage(rows: &[u16], holes: &[u8]) -> Result<Vec<u16>> {
    validate_single_board_shape(rows)?;
    for (index, row) in rows.iter().copied().enumerate() {
        validate_row(row, index)?;
    }
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

    Ok(output)
}

pub(crate) fn validate_board_shape(rows: &[u16], board_count: usize) -> Result<()> {
    let expected_rows = board_count.checked_mul(BOARD_HEIGHT).ok_or_else(|| {
        Error::from_reason(format!(
            "boardCount is too large to fit {BOARD_HEIGHT}-row boards."
        ))
    })?;
    if rows.len() != expected_rows {
        return Err(Error::from_reason(format!(
            "Expected {expected_rows} row values, got {}.",
            rows.len()
        )));
    }

    Ok(())
}

pub(crate) fn validate_single_board(rows: &[u16]) -> Result<()> {
    validate_single_board_shape(rows)?;
    for (index, row) in rows.iter().copied().enumerate() {
        validate_row(row, index)?;
    }
    Ok(())
}

pub(crate) fn rows_to_array(rows: &[u16]) -> Result<BoardRows> {
    validate_single_board(rows)?;
    let mut output = [0_u16; BOARD_HEIGHT];
    output.copy_from_slice(rows);
    Ok(output)
}

pub(crate) fn validate_single_board_shape(rows: &[u16]) -> Result<()> {
    validate_board_shape(rows, 1)
}

pub(crate) fn validate_row(row: u16, index: usize) -> Result<()> {
    if row & !ROW_MASK != 0 {
        return Err(Error::from_reason(format!(
            "Row {index} must fit in {BOARD_WIDTH} bits, got {row}."
        )));
    }
    Ok(())
}

pub(crate) fn validate_garbage_holes(holes: &[u8]) -> Result<()> {
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

pub(crate) fn count_occupied_cells_in_rows(rows: &[u16], row_offset: usize) -> Result<u32> {
    let mut count = 0;
    for (index, row) in rows.iter().copied().enumerate() {
        validate_row(row, row_offset + index)?;
        count += row.count_ones();
    }
    Ok(count)
}

pub(crate) fn clear_full_lines_into(
    rows: &[u16],
    output: &mut [u16],
    row_offset: usize,
) -> Result<()> {
    let mut write_y = 0;
    for (index, row) in rows.iter().copied().enumerate() {
        validate_row(row, row_offset + index)?;
        if row != ROW_MASK {
            output[write_y] = row;
            write_y += 1;
        }
    }
    Ok(())
}

pub(crate) fn evaluate_board(rows: &[u16], row_offset: usize) -> Result<BoardEvaluation> {
    let mut occupied_cells = 0;
    let mut cleared_lines = 0;
    let mut column_masks = [0_u32; BOARD_WIDTH];

    for (y, row) in rows.iter().copied().enumerate() {
        validate_row(row, row_offset + y)?;
        occupied_cells += row.count_ones();
        if row == ROW_MASK {
            cleared_lines += 1;
        }
        add_row_to_column_masks(&mut column_masks, row, y);
    }

    Ok(evaluate_column_metrics(
        occupied_cells,
        cleared_lines,
        column_masks,
    ))
}

pub(crate) fn evaluate_board_unchecked(rows: &BoardRows) -> BoardEvaluation {
    let mut occupied_cells = 0;
    let mut cleared_lines = 0;
    let mut column_masks = [0_u32; BOARD_WIDTH];

    for (y, row) in rows.iter().copied().enumerate() {
        occupied_cells += row.count_ones();
        if row == ROW_MASK {
            cleared_lines += 1;
        }
        add_row_to_column_masks(&mut column_masks, row, y);
    }

    evaluate_column_metrics(occupied_cells, cleared_lines, column_masks)
}

#[cfg(test)]
pub(crate) fn is_empty_rows(rows: &BoardRows) -> bool {
    rows.iter().all(|row| *row == 0)
}

pub(crate) fn count_full_lines_array(rows: &BoardRows) -> u32 {
    rows.iter().filter(|row| **row == ROW_MASK).count() as u32
}

pub(crate) fn clear_full_lines_array_with_count(rows: BoardRows) -> (BoardRows, u32) {
    let mut output = [0_u16; BOARD_HEIGHT];
    let mut write_y = 0;
    let mut cleared_lines = 0_u32;
    for row in rows {
        if row != ROW_MASK {
            output[write_y] = row;
            write_y += 1;
        } else {
            cleared_lines += 1;
        }
    }
    (output, cleared_lines)
}

fn evaluate_column_metrics(
    occupied_cells: u32,
    cleared_lines: u32,
    column_masks: [u32; BOARD_WIDTH],
) -> BoardEvaluation {
    let mut aggregate_height = 0;
    let mut holes = 0;
    let mut previous_height: Option<u32> = None;
    let mut bumpiness = 0;
    for column_mask in column_masks {
        let height = if column_mask == 0 {
            0
        } else {
            u32::BITS - column_mask.leading_zeros()
        };
        aggregate_height += height;
        holes += height - column_mask.count_ones();
        if let Some(previous) = previous_height {
            bumpiness += previous.abs_diff(height);
        }
        previous_height = Some(height);
    }

    [
        occupied_cells,
        cleared_lines,
        aggregate_height,
        holes,
        bumpiness,
    ]
}

fn add_row_to_column_masks(column_masks: &mut [u32; BOARD_WIDTH], row: u16, y: usize) {
    let mut bits = row;
    let y_bit = 1_u32 << y;
    while bits != 0 {
        let x = bits.trailing_zeros() as usize;
        column_masks[x] |= y_bit;
        bits &= bits - 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unchecked_board_evaluation_matches_validated_sparse_and_dense_rows() {
        let mut rows = [0_u16; BOARD_HEIGHT];
        rows[0] = 0b0000000001;
        rows[1] = 0b0000100001;
        rows[2] = 0b1111111111;
        rows[7] = 0b1010101010;
        rows[19] = 0b1111000000;

        assert_eq!(evaluate_board_unchecked(&rows), slow_evaluate_board(&rows));
    }

    #[test]
    fn unchecked_board_evaluation_handles_empty_and_full_columns() {
        let mut rows = [0_u16; BOARD_HEIGHT];
        rows[0] = 0b1000000001;
        rows[1] = 0b1000000001;
        rows[3] = 0b1000000001;

        let evaluation = evaluate_board_unchecked(&rows);

        assert_eq!(evaluation[0], 6);
        assert_eq!(evaluation[1], 0);
        assert_eq!(evaluation[2], 8);
        assert_eq!(evaluation[3], 2);
        assert_eq!(evaluation[4], 8);
    }

    #[test]
    fn clear_full_lines_array_with_count_matches_clear_and_count_helpers() {
        let mut rows = [0_u16; BOARD_HEIGHT];
        rows[0] = 0b0000001111;
        rows[1] = ROW_MASK;
        rows[2] = 0b1111000000;
        rows[4] = ROW_MASK;

        let (cleared, count) = clear_full_lines_array_with_count(rows);

        assert_eq!(count, count_full_lines_array(&rows));
        assert_eq!(cleared[0], 0b0000001111);
        assert_eq!(cleared[1], 0b1111000000);
        assert_eq!(cleared[2], 0);
    }

    fn slow_evaluate_board(rows: &BoardRows) -> BoardEvaluation {
        let mut occupied_cells = 0;
        let mut cleared_lines = 0;
        let mut column_masks = [0_u32; BOARD_WIDTH];
        for (y, row) in rows.iter().copied().enumerate() {
            occupied_cells += row.count_ones();
            if row == ROW_MASK {
                cleared_lines += 1;
            }
            for (x, column_mask) in column_masks.iter_mut().enumerate() {
                if row & (1_u16 << x) != 0 {
                    *column_mask |= 1_u32 << y;
                }
            }
        }

        evaluate_column_metrics(occupied_cells, cleared_lines, column_masks)
    }
}
