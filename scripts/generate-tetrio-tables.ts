import { resolve } from "node:path";

const TETRIO_HOME = "https://tetr.io/";
const DEFAULT_TS_OUTPUT = "src/generated/tetrio-tables.generated.ts";
const DEFAULT_RUST_OUTPUT = "native/src/tetrio_tables.rs";

const RUST_CLEAR_DEFINITIONS = [
  { variant: "None", name: "NONE", key: undefined, clearedLines: 0, backToBack: false },
  { variant: "Single", name: "SINGLE", key: "SINGLE", clearedLines: 1, backToBack: false },
  { variant: "Double", name: "DOUBLE", key: "DOUBLE", clearedLines: 2, backToBack: false },
  { variant: "Triple", name: "TRIPLE", key: "TRIPLE", clearedLines: 3, backToBack: false },
  { variant: "Quad", name: "QUAD", key: "QUAD", clearedLines: 4, backToBack: true },
  { variant: "Penta", name: "PENTA", key: "PENTA", clearedLines: 5, backToBack: true },
  { variant: "TSpin", name: "TSPIN", key: "TSPIN", clearedLines: 0, backToBack: false },
  { variant: "TSpinMini", name: "TSPIN_MINI", key: "TSPIN_MINI", clearedLines: 0, backToBack: false },
  { variant: "TSpinMiniSingle", name: "TSPIN_MINI_SINGLE", key: "TSPIN_MINI_SINGLE", clearedLines: 1, backToBack: false },
  { variant: "TSpinSingle", name: "TSPIN_SINGLE", key: "TSPIN_SINGLE", clearedLines: 1, backToBack: true },
  { variant: "TSpinMiniDouble", name: "TSPIN_MINI_DOUBLE", key: "TSPIN_MINI_DOUBLE", clearedLines: 2, backToBack: false },
  { variant: "TSpinDouble", name: "TSPIN_DOUBLE", key: "TSPIN_DOUBLE", clearedLines: 2, backToBack: true },
  { variant: "TSpinMiniTriple", name: "TSPIN_MINI_TRIPLE", key: "TSPIN_MINI_TRIPLE", clearedLines: 3, backToBack: false },
  { variant: "TSpinTriple", name: "TSPIN_TRIPLE", key: "TSPIN_TRIPLE", clearedLines: 3, backToBack: true },
  { variant: "TSpinMiniQuad", name: "TSPIN_MINI_QUAD", key: "TSPIN_MINI_QUAD", clearedLines: 4, backToBack: true },
  { variant: "TSpinQuad", name: "TSPIN_QUAD", key: "TSPIN_QUAD", clearedLines: 4, backToBack: true },
  { variant: "TSpinPenta", name: "TSPIN_PENTA", key: "TSPIN_PENTA", clearedLines: 5, backToBack: true }
] as const;

interface GenerateOptions {
  readonly input?: string;
  readonly asset?: string;
  readonly output: string;
  readonly rustOutput: string;
  readonly fetchedAt?: string;
  readonly lastModified?: string;
  readonly check: boolean;
}

interface BundleSource {
  readonly asset: string;
  readonly text: string;
  readonly fetchedAt: string;
  readonly lastModified: string;
}

const options = parseArgs(process.argv.slice(2));
let source = await loadBundleSource(options);
const outputPath = resolve(options.output);
const rustOutputPath = resolve(options.rustOutput);
const existingSource = await readGeneratedSource(outputPath);
if (options.fetchedAt === undefined && existingSource?.asset === source.asset) {
  source = {
    ...source,
    fetchedAt: existingSource.fetchedAt,
    lastModified: options.lastModified ?? existingSource.lastModified
  };
}
const tables = extractTables(source.text);
const generatedFiles = [
  { label: options.output, path: outputPath, content: formatGeneratedTsModule(source, tables) },
  { label: options.rustOutput, path: rustOutputPath, content: formatGeneratedRustModule(source, tables) }
] as const;

if (options.check) {
  const stale = [];
  for (const file of generatedFiles) {
    const current = await Bun.file(file.path).text();
    if (current !== file.content) {
      stale.push(file.label);
    }
  }
  if (stale.length > 0) {
    throw new Error(`${stale.join(", ")} out of date. Run bun run generate:tetrio-tables.`);
  }
  console.log(`${generatedFiles.map((file) => file.label).join(", ")} are up to date.`);
} else {
  for (const file of generatedFiles) {
    await Bun.write(file.path, file.content);
  }
  console.log(`Generated ${generatedFiles.map((file) => file.label).join(", ")} from ${source.asset}.`);
}

function parseArgs(args: readonly string[]): GenerateOptions {
  const options: {
    input?: string;
    asset?: string;
    output: string;
    rustOutput: string;
    fetchedAt?: string;
    lastModified?: string;
    check: boolean;
  } = {
    output: DEFAULT_TS_OUTPUT,
    rustOutput: DEFAULT_RUST_OUTPUT,
    check: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--input":
        options.input = readValue(args, ++index, arg);
        break;
      case "--asset":
        options.asset = readValue(args, ++index, arg);
        break;
      case "--output":
        options.output = readValue(args, ++index, arg);
        break;
      case "--rust-output":
        options.rustOutput = readValue(args, ++index, arg);
        break;
      case "--fetched-at":
        options.fetchedAt = readValue(args, ++index, arg);
        break;
      case "--last-modified":
        options.lastModified = readValue(args, ++index, arg);
        break;
      case "--check":
        options.check = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function readValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

async function loadBundleSource(options: GenerateOptions): Promise<BundleSource> {
  if (options.input !== undefined) {
    const lastModified = options.lastModified ?? "";
    return {
      asset: options.asset ?? `file://${resolve(options.input)}`,
      text: await Bun.file(options.input).text(),
      fetchedAt: options.fetchedAt ?? lastModified,
      lastModified
    };
  }

  const asset = options.asset ?? (await discoverClientAsset());
  const response = await fetch(asset);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${asset}: ${response.status} ${response.statusText}`);
  }

  const lastModified = options.lastModified ?? response.headers.get("last-modified") ?? "";
  return {
    asset,
    text: await response.text(),
    fetchedAt: options.fetchedAt ?? lastModified,
    lastModified
  };
}

async function discoverClientAsset(): Promise<string> {
  const response = await fetch(TETRIO_HOME);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${TETRIO_HOME}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const directMatch = html.match(/["']([^"']*\/js\/tetrio\.js\?[^"']+)["']/i);
  if (directMatch?.[1] !== undefined) {
    return new URL(directMatch[1], TETRIO_HOME).href;
  }

  const hashMatch = html.match(/(?:\/bootstrap\.js|\/css\/tetrio\.css)\?hv=([^"'&<>]+)/i);
  if (hashMatch?.[1] !== undefined) {
    return new URL(`/js/tetrio.js?hv=${hashMatch[1]}`, TETRIO_HOME).href;
  }

  throw new Error("Could not find the TETR.IO client script hash in the homepage HTML.");
}

function extractTables(bundle: string): Record<string, unknown> {
  const garbage = evaluateObject(extractObjectLiteralAfterKey(bundle, "garbage"));
  const comboTables = readRecord(garbage, "combotable");
  delete garbage.combotable;

  return {
    TETRIO_SCORING_TABLE: evaluateObject(extractObjectLiteralAfterKey(bundle, "scoring")),
    TETRIO_GARBAGE_ATTACK_TABLE: garbage,
    TETRIO_COMBO_ATTACK_TABLES: comboTables,
    TETRIO_SPIN_BONUS_RULES: evaluateObject(extractObjectLiteralAfterKey(bundle, "spinbonuses_rules")),
    TETRIO_KICK_TABLES: evaluateObject(extractObjectLiteralAfterKey(bundle, "kicksets"))
  };
}

function readRecord(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const nested = value[key];
  if (nested === null || typeof nested !== "object" || Array.isArray(nested)) {
    throw new Error(`Expected ${key} to be an object.`);
  }
  return nested as Record<string, unknown>;
}

function extractObjectLiteralAfterKey(input: string, key: string): string {
  const keyIndex = input.indexOf(`${key}:`);
  if (keyIndex === -1) {
    throw new Error(`Could not find ${key} in the client bundle.`);
  }

  const start = input.indexOf("{", keyIndex + key.length + 1);
  if (start === -1) {
    throw new Error(`Could not find ${key} object start.`);
  }

  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return input.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Could not find ${key} object end.`);
}

function evaluateObject(source: string): Record<string, unknown> {
  const value = Function(`"use strict"; return (${source});`)() as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Extracted source did not evaluate to an object.");
  }
  return value as Record<string, unknown>;
}

async function readGeneratedSource(outputPath: string): Promise<{ asset: string; fetchedAt: string; lastModified: string } | undefined> {
  try {
    const text = await Bun.file(outputPath).text();
    const match = text.match(/export const TETRIO_TABLE_SOURCE = (\{[\s\S]*?\}) as const;/);
    if (match?.[1] === undefined) {
      return undefined;
    }
    const value = JSON.parse(match[1]) as unknown;
    if (!isRecord(value)) {
      return undefined;
    }
    if (typeof value.asset !== "string" || typeof value.fetchedAt !== "string" || typeof value.lastModified !== "string") {
      return undefined;
    }
    return {
      asset: value.asset,
      fetchedAt: value.fetchedAt,
      lastModified: value.lastModified
    };
  } catch {
    return undefined;
  }
}

function formatGeneratedTsModule(source: BundleSource, tables: Record<string, unknown>): string {
  return [
    "// Generated by scripts/generate-tetrio-tables.ts. Do not edit by hand.",
    "",
    `export const TETRIO_TABLE_SOURCE = ${formatConst({ asset: source.asset, fetchedAt: source.fetchedAt, lastModified: source.lastModified })};`,
    "",
    `export const TETRIO_SCORING_TABLE = ${formatConst(tables.TETRIO_SCORING_TABLE)};`,
    "",
    `export const TETRIO_GARBAGE_ATTACK_TABLE = ${formatConst(tables.TETRIO_GARBAGE_ATTACK_TABLE)};`,
    "",
    `export const TETRIO_COMBO_ATTACK_TABLES = ${formatConst(tables.TETRIO_COMBO_ATTACK_TABLES)};`,
    "",
    `export const TETRIO_SPIN_BONUS_RULES = ${formatConst(tables.TETRIO_SPIN_BONUS_RULES)};`,
    "",
    `export const TETRIO_KICK_TABLES = ${formatConst(tables.TETRIO_KICK_TABLES)};`,
    ""
  ].join("\n");
}

function formatConst(value: unknown): string {
  return `${JSON.stringify(value, null, 2)} as const`;
}

function formatGeneratedRustModule(source: BundleSource, tables: Record<string, unknown>): string {
  const scoring = readNumberRecord(tables, "TETRIO_SCORING_TABLE");
  const garbage = readNumberRecord(tables, "TETRIO_GARBAGE_ATTACK_TABLE");
  const comboTables = readComboTables(tables);
  const clearNames = RUST_CLEAR_DEFINITIONS.map((definition) => definition.name);
  const clearAttack = RUST_CLEAR_DEFINITIONS.map((definition) =>
    definition.key === undefined ? 0 : readInteger(garbage, definition.key, "TETRIO_GARBAGE_ATTACK_TABLE")
  );
  const clearPoints = RUST_CLEAR_DEFINITIONS.map((definition) =>
    definition.key === undefined ? 0 : readInteger(scoring, definition.key, "TETRIO_SCORING_TABLE")
  );
  const clearLines = RUST_CLEAR_DEFINITIONS.map((definition) => definition.clearedLines);
  const clearBackToBack = RUST_CLEAR_DEFINITIONS.map((definition) => definition.backToBack);
  const comboTableArms = comboTables.map((table) => `        ComboTable::${table.variant} => &${table.constantName},`);
  const comboTableKeyArms = comboTables.map((table) => `        ComboTable::${table.variant} => ${formatRustString(table.key)},`);
  const comboTableFromKeyArms = comboTables.map((table) => `        ${formatRustString(table.key)} => Some(ComboTable::${table.variant}),`);

  return [
    "// Generated by scripts/generate-tetrio-tables.ts. Do not edit by hand.",
    "#![allow(dead_code)]",
    "",
    "#[derive(Clone, Copy, Eq, PartialEq)]",
    "#[repr(usize)]",
    "pub(crate) enum ClearKind {",
    ...RUST_CLEAR_DEFINITIONS.map((definition, index) => `    ${definition.variant} = ${index},`),
    "}",
    "",
    "#[derive(Clone, Copy, Eq, PartialEq)]",
    "pub(crate) enum ComboTable {",
    "    Multiplier,",
    ...comboTables.map((table) => `    ${table.variant},`),
    "}",
    "",
    ...formatRustStringConstant("SOURCE_ASSET", source.asset),
    `pub const SOURCE_FETCHED_AT: &str = ${formatRustString(source.fetchedAt)};`,
    `pub const SOURCE_LAST_MODIFIED: &str = ${formatRustString(source.lastModified)};`,
    "",
    `pub const BACK_TO_BACK_SCORE_MULTIPLIER: f64 = ${formatRustFloat(readFiniteNumber(scoring, "BACKTOBACK_MULTIPLIER", "TETRIO_SCORING_TABLE"))};`,
    `pub const BACK_TO_BACK_BONUS: f64 = ${formatRustFloat(readFiniteNumber(garbage, "BACKTOBACK_BONUS", "TETRIO_GARBAGE_ATTACK_TABLE"))};`,
    `pub const BACK_TO_BACK_BONUS_LOG: f64 = ${formatRustFloat(readFiniteNumber(garbage, "BACKTOBACK_BONUS_LOG", "TETRIO_GARBAGE_ATTACK_TABLE"))};`,
    `pub const COMBO_SCORE: u32 = ${formatRustU32(readInteger(scoring, "COMBO", "TETRIO_SCORING_TABLE"))};`,
    `pub const COMBO_BONUS: f64 = ${formatRustFloat(readFiniteNumber(garbage, "COMBO_BONUS", "TETRIO_GARBAGE_ATTACK_TABLE"))};`,
    `pub const COMBO_MINIFIER: f64 = ${formatRustFloat(readFiniteNumber(garbage, "COMBO_MINIFIER", "TETRIO_GARBAGE_ATTACK_TABLE"))};`,
    `pub const COMBO_MINIFIER_LOG: f64 = ${formatRustFloat(readFiniteNumber(garbage, "COMBO_MINIFIER_LOG", "TETRIO_GARBAGE_ATTACK_TABLE"))};`,
    `pub const ALL_CLEAR_ATTACK: u32 = ${formatRustU32(readInteger(garbage, "ALL_CLEAR", "TETRIO_GARBAGE_ATTACK_TABLE"))};`,
    `pub const ALL_CLEAR_POINTS: u32 = ${formatRustU32(readInteger(scoring, "ALL_CLEAR", "TETRIO_SCORING_TABLE"))};`,
    "",
    `pub(crate) const CLEAR_KIND_COUNT: usize = ${RUST_CLEAR_DEFINITIONS.length};`,
    `pub(crate) const CLEAR_NAMES: [&str; CLEAR_KIND_COUNT] = ${formatRustStringArray(clearNames)};`,
    `pub(crate) const CLEAR_ATTACK: [u32; CLEAR_KIND_COUNT] = ${formatRustU32Array(clearAttack)};`,
    `pub(crate) const CLEAR_POINTS: [u32; CLEAR_KIND_COUNT] = ${formatRustU32Array(clearPoints)};`,
    `pub(crate) const CLEAR_CLEARED_LINES: [u32; CLEAR_KIND_COUNT] = ${formatRustU32Array(clearLines)};`,
    `pub(crate) const CLEAR_BACK_TO_BACK: [bool; CLEAR_KIND_COUNT] = ${formatRustBoolArray(clearBackToBack)};`,
    "",
    ...comboTables.flatMap((table) => [
      `pub(crate) const ${table.constantName}: [u32; ${table.values.length}] = ${formatRustU32Array(table.values)};`
    ]),
    "",
    "pub(crate) fn clear_kind_name(kind: ClearKind) -> &'static str {",
    "    CLEAR_NAMES[clear_kind_index(kind)]",
    "}",
    "",
    "pub(crate) fn clear_kind_attack(kind: ClearKind) -> u32 {",
    "    CLEAR_ATTACK[clear_kind_index(kind)]",
    "}",
    "",
    "pub(crate) fn clear_kind_points(kind: ClearKind) -> u32 {",
    "    CLEAR_POINTS[clear_kind_index(kind)]",
    "}",
    "",
    "pub(crate) fn clear_kind_cleared_lines(kind: ClearKind) -> u32 {",
    "    CLEAR_CLEARED_LINES[clear_kind_index(kind)]",
    "}",
    "",
    "pub(crate) fn is_back_to_back_clear(kind: ClearKind) -> bool {",
    "    CLEAR_BACK_TO_BACK[clear_kind_index(kind)]",
    "}",
    "",
    "pub(crate) fn combo_table_key(table: ComboTable) -> &'static str {",
    "    match table {",
    `        ComboTable::Multiplier => ${formatRustString("multiplier")},`,
    ...comboTableKeyArms,
    "    }",
    "}",
    "",
    "pub(crate) fn combo_table_from_key(key: &str) -> Option<ComboTable> {",
    "    match key {",
    `        ${formatRustString("multiplier")} => Some(ComboTable::Multiplier),`,
    ...comboTableFromKeyArms,
    "        _ => None,",
    "    }",
    "}",
    "",
    "pub(crate) fn combo_table_attack(table: ComboTable, base_attack: f64, combo: u32) -> f64 {",
    "    match table {",
    "        ComboTable::Multiplier => multiplier_combo_attack(base_attack, combo),",
    "        _ => base_attack + f64::from(combo_table_attack_bonus(table, combo)),",
    "    }",
    "}",
    "",
    "pub(crate) fn combo_table_attack_bonus(table: ComboTable, combo: u32) -> u32 {",
    "    if combo <= 1 {",
    "        return 0;",
    "    }",
    "    let table: &[u32] = match table {",
    "        ComboTable::Multiplier => return 0,",
    ...comboTableArms,
    "    };",
    "    let index = usize::min((combo - 2) as usize, table.len() - 1);",
    "    table[index]",
    "}",
    "",
    "pub(crate) fn multiplier_combo_attack(base_attack: f64, combo: u32) -> f64 {",
    "    if combo <= 1 {",
    "        return base_attack;",
    "    }",
    "    let combo_index = (combo - 1) as f64;",
    "    let multiplied = base_attack * (1.0 + COMBO_BONUS * combo_index);",
    "    if combo <= 2 {",
    "        return multiplied;",
    "    }",
    "    let minified = (COMBO_MINIFIER * combo_index * COMBO_MINIFIER_LOG).ln_1p();",
    "    multiplied.max(minified)",
    "}",
    "",
    "fn clear_kind_index(kind: ClearKind) -> usize {",
    "    kind as usize",
    "}",
    ""
  ].join("\n");
}

function readComboTables(tables: Record<string, unknown>): Array<{ key: string; variant: string; constantName: string; values: number[] }> {
  const value = tables.TETRIO_COMBO_ATTACK_TABLES;
  if (!isRecord(value)) {
    throw new Error("TETRIO_COMBO_ATTACK_TABLES must be an object.");
  }

  return Object.entries(value).map(([key, table]) => {
    if (!Array.isArray(table)) {
      throw new Error(`TETRIO_COMBO_ATTACK_TABLES.${key} must be an array.`);
    }

    return {
      key,
      variant: formatRustPascalIdentifier(key),
      constantName: `COMBO_TABLE_${formatRustConstantIdentifier(key)}`,
      values: table.map((entry, index) => {
        if (!Number.isInteger(entry) || typeof entry !== "number" || entry < 0) {
          throw new Error(`TETRIO_COMBO_ATTACK_TABLES.${key}[${index}] must be a non-negative integer.`);
        }
        return entry;
      })
    };
  });
}

function readNumberRecord(tables: Record<string, unknown>, key: string): Record<string, number> {
  const value = tables[key];
  if (!isRecord(value)) {
    throw new Error(`${key} must be an object.`);
  }

  const output: Record<string, number> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (typeof entryValue === "number") {
      output[entryKey] = entryValue;
    }
  }
  return output;
}

function readInteger(record: Record<string, number>, key: string, label: string): number {
  const value = readFiniteNumber(record, key, label);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label}.${key} must be a non-negative integer, got ${value}.`);
  }
  return value;
}

function readFiniteNumber(record: Record<string, number>, key: string, label: string): number {
  const value = record[key];
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error(`${label}.${key} must be a finite number.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatRustString(value: string): string {
  return JSON.stringify(value);
}

function formatRustStringConstant(name: string, value: string): string[] {
  const literal = formatRustString(value);
  const line = `pub const ${name}: &str = ${literal};`;
  if (line.length <= 100) {
    return [line];
  }
  return [`pub const ${name}: &str =`, `    ${literal};`];
}

function formatRustFloat(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(1) : String(value)}_f64`;
}

function formatRustU32(value: number): string {
  return `${value}_u32`;
}

function formatRustStringArray(values: readonly string[]): string {
  return formatRustArray(values.map(formatRustString));
}

function formatRustU32Array(values: readonly number[]): string {
  return formatRustWrappedArray(values.map(formatRustU32));
}

function formatRustBoolArray(values: readonly boolean[]): string {
  return formatRustWrappedArray(values.map(String));
}

function formatRustArray(values: readonly string[]): string {
  return `[\n${values.map((value) => `    ${value},`).join("\n")}\n]`;
}

function formatRustWrappedArray(values: readonly string[]): string {
  const indent = "    ";
  const maxWidth = 100;
  const lines: string[] = [];
  let current = "";
  for (const value of values) {
    const entry = `${value},`;
    const candidate = current.length === 0 ? entry : `${current} ${entry}`;
    if (current.length > 0 && indent.length + candidate.length > maxWidth) {
      lines.push(current);
      current = entry;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  if (values.length === 1) {
    return `[${values.join(", ")}]`;
  }
  return `[\n${lines.map((line) => `${indent}${line}`).join("\n")}\n]`;
}

function formatRustConstantIdentifier(value: string): string {
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalized.length === 0) {
    throw new Error(`Cannot convert ${value} to a Rust constant identifier.`);
  }
  return normalized;
}

function formatRustPascalIdentifier(value: string): string {
  const normalized = value
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`)
    .join("");
  if (normalized.length === 0) {
    throw new Error(`Cannot convert ${value} to a Rust enum variant.`);
  }
  return normalized;
}
