import { decoder, encoder, Field, type EncodePage } from "tetris-fumen";
import { createBoardBatch } from "../../domain/board";
import {
  FUMEN_VIEWER_BASE_URL,
  type DecodedFumenPage,
  type FumenCell,
  type FumenCellRow,
  type FumenCodec,
  type FumenData,
  type FumenMino,
  type FumenOperation,
  type FumenPageInput,
  type FumenQuizInput,
  type FumenUrlMode,
  type FumenUrls
} from "../../domain/fumen";
import type { NativeBinding } from "../native/binding-types";
import { loadNativeBinding } from "../native/load-native-binding";

const FUMEN_PREFIX_PATTERN = /[vmdD](?:115|110)@/;
const FUMEN_FIELD_WIDTH = 10;
const FUMEN_FIELD_HEIGHT = 23;
const VALID_CELL_VALUES = new Set<string>(["I", "L", "O", "Z", "T", "J", "S", "X", "_", "GRAY", "EMPTY"]);
const VALID_MINO_VALUES = new Set<string>(["I", "L", "O", "Z", "T", "J", "S"]);

export class TetrisFumenCodec implements FumenCodec {
  constructor(private readonly native: NativeBinding = loadNativeBinding()) {}

  encodePages(pages: readonly FumenPageInput[]): FumenData {
    const rowFields = this.batchRowFields(pages);
    return normalizeFumenData(encoder.encode(pages.map((page, index) => this.toEncodePage(page, rowFields.get(index)))));
  }

  decode(input: string): readonly DecodedFumenPage[] {
    return decoder.decode(normalizeFumenData(input)).map((page) => {
      const lines = splitFumenField(page.field.str({ reduced: false, separator: "\n", garbage: true }));
      const decoded: DecodedFumenPage = {
        index: page.index,
        comment: page.comment,
        flags: page.flags,
        field: lines.fieldRows.join("\n"),
        fieldRows: lines.fieldRows,
        garbage: lines.garbage
      };

      const withQuiz = page.comment.startsWith("#Q=") ? { ...decoded, quiz: page.comment } : decoded;
      if (page.operation !== undefined) {
        return { ...withQuiz, operation: page.operation as FumenOperation };
      }

      return withQuiz;
    });
  }

  createUrl(data: string, mode: FumenUrlMode = "edit"): string {
    return createFumenUrl(data, mode);
  }

  createUrls(data: string): FumenUrls {
    return createFumenUrls(data);
  }

  rowsToFieldString(rows: Uint16Array): string {
    return this.native.rowsToFumenField(rows);
  }

  private toEncodePage(page: FumenPageInput, rowField: string | undefined): EncodePage {
    const fieldSourceCount = [page.rows, page.field, page.fieldRows].filter((source) => source !== undefined).length;
    if (fieldSourceCount > 1) {
      throw new Error("A fumen page can specify only one of rows, field, or fieldRows.");
    }

    if (page.garbage !== undefined && page.garbageRow !== undefined) {
      throw new Error("A fumen page can specify only one of garbage or garbageRow.");
    }
    if (page.comment !== undefined && page.quiz !== undefined) {
      throw new Error("A fumen page can specify only one of comment or quiz.");
    }

    const field = this.resolveFieldString(page, rowField);
    const garbage = page.garbageRow !== undefined ? formatFumenCellRow(page.garbageRow) : page.garbage;
    const comment = page.quiz !== undefined ? createFumenQuizComment(page.quiz) : page.comment;
    const encodePage: EncodePage = {};
    if (field !== undefined || garbage !== undefined) {
      encodePage.field = Field.create(field, garbage);
    }
    if (comment !== undefined) {
      encodePage.comment = comment;
    }
    if (page.operation !== undefined) {
      encodePage.operation = page.operation;
    }
    if (page.flags !== undefined) {
      encodePage.flags = page.flags;
    }
    return encodePage;
  }

  private resolveFieldString(page: FumenPageInput, rowField: string | undefined): string | undefined {
    if (page.rows !== undefined) {
      return rowField ?? this.rowsToFieldString(page.rows);
    }
    if (page.fieldRows !== undefined) {
      return formatFumenFieldRows(page.fieldRows);
    }
    return page.field;
  }

  private batchRowFields(pages: readonly FumenPageInput[]): Map<number, string> {
    const indexedRows = pages
      .map((page, index) => ({ index, rows: page.rows }))
      .filter((entry): entry is { index: number; rows: Uint16Array } => entry.rows !== undefined);
    if (indexedRows.length <= 1) {
      return new Map();
    }

    const batch = createBoardBatch(indexedRows.map((entry) => entry.rows));
    const fields = this.native.batchRowsToFumenFields(batch.rows, batch.boardCount);
    if (fields.length !== indexedRows.length) {
      throw new Error(`Native fumen field batch returned ${fields.length} fields for ${indexedRows.length} boards.`);
    }
    return new Map(indexedRows.map((entry, index) => [entry.index, fields[index] as string]));
  }
}

export function createFumenCodec(): FumenCodec {
  return new TetrisFumenCodec();
}

export function encodeFumenPages(pages: readonly FumenPageInput[]): FumenData {
  return createFumenCodec().encodePages(pages);
}

export function decodeFumen(input: string): readonly DecodedFumenPage[] {
  return createFumenCodec().decode(input);
}

export function createFumenUrl(data: string, mode: FumenUrlMode = "edit"): string {
  const normalized = normalizeFumenData(data);
  const query = mode === "edit" ? normalized : `${modePrefix(mode)}${normalized.slice(1)}`;
  return `${FUMEN_VIEWER_BASE_URL}?${query}`;
}

export function createFumenUrls(data: string): FumenUrls {
  return {
    edit: createFumenUrl(data, "edit"),
    view: createFumenUrl(data, "view"),
    list: createFumenUrl(data, "list"),
    listMin: createFumenUrl(data, "list-min")
  };
}

export function formatFumenFieldRows(rows: readonly FumenCellRow[]): string {
  if (rows.length === 0 || rows.length > FUMEN_FIELD_HEIGHT) {
    throw new Error(`Fumen fieldRows must contain 1 to ${FUMEN_FIELD_HEIGHT} rows, got ${rows.length}.`);
  }
  return rows.map((row, index) => formatFumenCellRow(row, `fieldRows[${index}]`)).join("");
}

export function formatFumenCellRow(row: FumenCellRow, label = "row"): string {
  const cells = typeof row === "string" ? [...row] : row.map(formatFumenCell);
  if (cells.length !== FUMEN_FIELD_WIDTH) {
    throw new Error(`${label} must contain ${FUMEN_FIELD_WIDTH} cells, got ${cells.length}.`);
  }
  for (const cell of cells) {
    assertFumenCell(cell, label);
  }
  return cells.join("");
}

export function createFumenQuizComment(input: FumenQuizInput | string): string {
  if (typeof input === "string") {
    const quiz = input.trim().replace(/\s+/g, "");
    if (!quiz.startsWith("#Q=")) {
      throw new Error("Raw fumen quiz comments must start with #Q=.");
    }
    return quiz;
  }

  const hold = input.hold ?? "";
  const current = input.current ?? "";
  const next = formatMinoSequence(input.next ?? "");
  if (hold !== "") {
    assertFumenMino(hold, "quiz.hold");
  }
  if (current !== "") {
    assertFumenMino(current, "quiz.current");
  }
  return `#Q=[${hold}](${current})${next}`;
}

export function normalizeFumenData(input: string): FumenData {
  const candidate = extractFumenCandidate(input);
  const match = FUMEN_PREFIX_PATTERN.exec(candidate);
  if (match?.index === undefined) {
    throw new Error("Unsupported fumen data. Expected v115@, m115@, d115@, D115@, or v110-compatible data.");
  }

  const prefix = match[0];
  const payloadStart = match.index + prefix.length;
  const payload = candidate
    .slice(payloadStart)
    .split("&", 1)[0]
    ?.replace(/\s+/g, "");

  if (payload === undefined || payload.length === 0) {
    throw new Error("Fumen payload is empty.");
  }

  return `v${prefix.slice(1)}${payload}`;
}

function splitFumenField(field: string): { fieldRows: string[]; garbage: string } {
  const rows = field.split("\n");
  if (rows.length === FUMEN_FIELD_HEIGHT + 1) {
    return {
      fieldRows: rows.slice(0, FUMEN_FIELD_HEIGHT),
      garbage: rows[FUMEN_FIELD_HEIGHT] ?? "__________"
    };
  }
  return {
    fieldRows: rows,
    garbage: "__________"
  };
}

function formatFumenCell(cell: FumenCell): FumenPieceCharacter {
  assertFumenCell(cell, "cell");
  if (cell === "GRAY") {
    return "X";
  }
  if (cell === "EMPTY") {
    return "_";
  }
  return cell;
}

type FumenPieceCharacter = "I" | "L" | "O" | "Z" | "T" | "J" | "S" | "X" | "_";

function assertFumenCell(cell: string, label: string): asserts cell is FumenPieceCharacter | "GRAY" | "EMPTY" {
  if (!VALID_CELL_VALUES.has(cell)) {
    throw new Error(`${label} contains unsupported fumen cell "${cell}".`);
  }
}

function formatMinoSequence(sequence: readonly FumenMino[] | string): string {
  const values = typeof sequence === "string" ? [...sequence.replace(/\s+/g, "")] : sequence;
  for (const value of values) {
    assertFumenMino(value, "quiz.next");
  }
  return values.join("");
}

function assertFumenMino(value: string, label: string): asserts value is FumenMino {
  if (!VALID_MINO_VALUES.has(value)) {
    throw new Error(`${label} contains unsupported fumen mino "${value}".`);
  }
}

function extractFumenCandidate(input: string): string {
  const trimmed = input.trim();
  return trimmed.split("#", 1)[0] ?? trimmed;
}

function modePrefix(mode: FumenUrlMode): "m" | "d" | "D" {
  switch (mode) {
    case "view":
      return "m";
    case "list":
      return "d";
    case "list-min":
      return "D";
    case "edit":
      throw new Error("Edit mode does not use a replacement prefix.");
  }
}
