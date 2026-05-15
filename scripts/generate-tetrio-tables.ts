import { spawnSync } from "node:child_process";
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
  { variant: "TSpinMiniSingle", name: "TSPIN_MINI_SINGLE", key: "TSPIN_MINI_SINGLE", clearedLines: 1, backToBack: true },
  { variant: "TSpinSingle", name: "TSPIN_SINGLE", key: "TSPIN_SINGLE", clearedLines: 1, backToBack: true },
  { variant: "TSpinMiniDouble", name: "TSPIN_MINI_DOUBLE", key: "TSPIN_MINI_DOUBLE", clearedLines: 2, backToBack: true },
  { variant: "TSpinDouble", name: "TSPIN_DOUBLE", key: "TSPIN_DOUBLE", clearedLines: 2, backToBack: true },
  { variant: "TSpinMiniTriple", name: "TSPIN_MINI_TRIPLE", key: "TSPIN_MINI_TRIPLE", clearedLines: 3, backToBack: true },
  { variant: "TSpinTriple", name: "TSPIN_TRIPLE", key: "TSPIN_TRIPLE", clearedLines: 3, backToBack: true },
  { variant: "TSpinMiniQuad", name: "TSPIN_MINI_QUAD", key: "TSPIN_MINI_QUAD", clearedLines: 4, backToBack: true },
  { variant: "TSpinQuad", name: "TSPIN_QUAD", key: "TSPIN_QUAD", clearedLines: 4, backToBack: true },
  { variant: "TSpinPenta", name: "TSPIN_PENTA", key: "TSPIN_PENTA", clearedLines: 5, backToBack: true }
] as const;

const RUST_KICK_TRANSITIONS = ["01", "10", "12", "21", "23", "32", "30", "03", "02", "20", "13", "31"] as const;
const RUST_PIECES = [
  { key: "i", variant: "I", constantName: "I" },
  { key: "o", variant: "O", constantName: "O" },
  { key: "t", variant: "T", constantName: "T" },
  { key: "s", variant: "S", constantName: "S" },
  { key: "z", variant: "Z", constantName: "Z" },
  { key: "j", variant: "J", constantName: "J" },
  { key: "l", variant: "L", constantName: "L" }
] as const;
const ZERO_KICK: RustKick = { x: 0, y: 0 };
const TETRIO_TL_PRESET = "tetra league";
const TETRIO_TL_OPTION_DEFINITIONS = [
  { key: "spinbonuses", type: "string" },
  { key: "kickset", type: "string" },
  { key: "combotable", type: "string" },
  { key: "b2bchaining", type: "boolean" },
  { key: "b2bcharging", type: "boolean" },
  { key: "b2bextras", type: "boolean" },
  { key: "b2bcharge_at", type: "number" },
  { key: "b2bcharge_base", type: "number" },
  { key: "allclear_garbage", type: "number" },
  { key: "allclear_b2b", type: "number" },
  { key: "allclear_b2b_sends", type: "boolean" },
  { key: "allclear_b2b_dupes", type: "boolean" },
  { key: "allclear_charges", type: "boolean" },
  { key: "garbagemultiplier", type: "number" },
  { key: "garbagespecialbonus", type: "boolean" },
  { key: "roundmode", type: "string" },
  { key: "openerphase", type: "number" }
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

type TetrioOptionType = (typeof TETRIO_TL_OPTION_DEFINITIONS)[number]["type"];
type TetrioOptionValue = string | number | boolean;

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
  { label: options.rustOutput, path: rustOutputPath, content: formatRustModule(formatGeneratedRustModule(source, tables)) }
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
    TETRIO_KICK_TABLES: evaluateObject(extractObjectLiteralAfterKey(bundle, "kicksets")),
    TETRIO_TL_OPTIONS: extractPresetOptions(bundle, TETRIO_TL_PRESET)
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

function extractPresetOptions(bundle: string, presetName: string): Record<string, TetrioOptionValue> {
  const assigned = parsePresetAssignments(extractPresetString(bundle, presetName));
  const output: Record<string, TetrioOptionValue> = {};
  for (const definition of TETRIO_TL_OPTION_DEFINITIONS) {
    const raw = assigned.get(definition.key) ?? extractOptionDefault(bundle, definition.key);
    output[definition.key] = parseOptionValue(raw, definition.type, definition.key);
  }
  return output;
}

function extractPresetString(bundle: string, presetName: string): string {
  const startNeedle = `${JSON.stringify(presetName)}:"`;
  const start = bundle.indexOf(startNeedle);
  if (start === -1) {
    throw new Error(`Could not find TETR.IO preset ${presetName}.`);
  }

  let escaped = false;
  const valueStart = start + startNeedle.length;
  for (let index = valueStart; index < bundle.length; index += 1) {
    const char = bundle[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      return bundle.slice(valueStart, index);
    }
  }

  throw new Error(`Could not find TETR.IO preset ${presetName} end.`);
}

function parsePresetAssignments(preset: string): Map<string, string> {
  const assignments = new Map<string, string>();
  for (const statement of preset.split(";")) {
    const match = statement.match(/^options\.([a-z0-9_]+)=(.*)$/);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      assignments.set(match[1], match[2]);
    }
  }
  return assignments;
}

function extractOptionDefault(bundle: string, key: string): string {
  const keyIndex = bundle.indexOf(`${key}:{default:`);
  if (keyIndex === -1) {
    throw new Error(`Could not find TETR.IO option default ${key}.`);
  }
  const valueStart = keyIndex + `${key}:{default:`.length;
  let quote: string | undefined;
  let escaped = false;
  for (let index = valueStart; index < bundle.length; index += 1) {
    const char = bundle[index];
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
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "," || char === "}") {
      return bundle.slice(valueStart, index);
    }
  }
  throw new Error(`Could not find TETR.IO option default ${key} end.`);
}

function parseOptionValue(raw: string, type: TetrioOptionType, key: string): TetrioOptionValue {
  const value = raw.trim();
  switch (type) {
    case "boolean":
      if (value === "1" || value === "true" || value === "!0") {
        return true;
      }
      if (value === "0" || value === "false" || value === "!1") {
        return false;
      }
      throw new Error(`TETR.IO option ${key} must be boolean-like, got ${raw}.`);
    case "number": {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`TETR.IO option ${key} must be numeric, got ${raw}.`);
      }
      return parsed;
    }
    case "string":
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
      }
      return value;
  }
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
    "",
    `export const TETRIO_TL_OPTIONS = ${formatConst(tables.TETRIO_TL_OPTIONS)};`,
    ""
  ].join("\n");
}

function formatConst(value: unknown): string {
  return `${JSON.stringify(value, null, 2)} as const`;
}

function formatRustModule(content: string): string {
  const result = spawnSync("rustfmt", ["--emit", "stdout"], {
    encoding: "utf8",
    input: content,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`rustfmt failed while formatting generated native tables:\n${result.stderr}`);
  }
  return result.stdout;
}

function formatGeneratedRustModule(source: BundleSource, tables: Record<string, unknown>): string {
  const scoring = readNumberRecord(tables, "TETRIO_SCORING_TABLE");
  const garbage = readNumberRecord(tables, "TETRIO_GARBAGE_ATTACK_TABLE");
  const tlOptions = readRecord(tables, "TETRIO_TL_OPTIONS");
  const comboTables = readComboTables(tables);
  const kickTables = readKickTables(tables);
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
  const kickTableKeyArms = kickTables.map((table) => `        KickTable::${table.variant} => ${formatRustString(table.key)},`);
  const kickTableFromKeyArms = kickTables.map((table) => `        ${formatRustString(table.key)} => Some(KickTable::${table.variant}),`);

  return [
    "// Generated by scripts/generate-tetrio-tables.ts. Do not edit by hand.",
    "#![allow(dead_code)]",
    "",
    "use crate::pieces::Piece;",
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
    "#[derive(Clone, Copy, Eq, PartialEq)]",
    "pub(crate) enum KickTable {",
    ...kickTables.map((table) => `    ${table.variant},`),
    "}",
    "",
    "#[derive(Clone, Copy, Eq, PartialEq)]",
    "pub(crate) enum KickGroup {",
    "    Default,",
    "    I,",
    "    O,",
    "}",
    "",
    "#[derive(Clone, Copy)]",
    "pub(crate) struct Kick {",
    "    pub(crate) x: i8,",
    "    pub(crate) y: i8,",
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
    `pub const TL_SPIN_BONUSES: &str = ${formatRustString(readString(tlOptions, "spinbonuses", "TETRIO_TL_OPTIONS"))};`,
    `pub const TL_KICKSET: &str = ${formatRustString(readString(tlOptions, "kickset", "TETRIO_TL_OPTIONS"))};`,
    `pub const TL_COMBO_TABLE: &str = ${formatRustString(readString(tlOptions, "combotable", "TETRIO_TL_OPTIONS"))};`,
    `pub const TL_B2B_CHAINING: bool = ${formatRustBool(readBoolean(tlOptions, "b2bchaining", "TETRIO_TL_OPTIONS"))};`,
    `pub const TL_B2B_CHARGING: bool = ${formatRustBool(readBoolean(tlOptions, "b2bcharging", "TETRIO_TL_OPTIONS"))};`,
    `pub const TL_B2B_EXTRAS: bool = ${formatRustBool(readBoolean(tlOptions, "b2bextras", "TETRIO_TL_OPTIONS"))};`,
    `pub const TL_B2B_CHARGE_AT: u32 = ${formatRustU32(readIntegerValue(tlOptions, "b2bcharge_at", "TETRIO_TL_OPTIONS"))};`,
    `pub const TL_B2B_CHARGE_BASE: u32 = ${formatRustU32(readIntegerValue(tlOptions, "b2bcharge_base", "TETRIO_TL_OPTIONS"))};`,
    `pub const TL_ALL_CLEAR_ATTACK: u32 = ${formatRustU32(readIntegerValue(tlOptions, "allclear_garbage", "TETRIO_TL_OPTIONS"))};`,
    `pub const TL_ALL_CLEAR_B2B: u32 = ${formatRustU32(readIntegerValue(tlOptions, "allclear_b2b", "TETRIO_TL_OPTIONS"))};`,
    `pub const TL_ALL_CLEAR_B2B_SENDS: bool = ${formatRustBool(readBoolean(tlOptions, "allclear_b2b_sends", "TETRIO_TL_OPTIONS"))};`,
    `pub const TL_ALL_CLEAR_B2B_DUPES: bool = ${formatRustBool(readBoolean(tlOptions, "allclear_b2b_dupes", "TETRIO_TL_OPTIONS"))};`,
    `pub const TL_ALL_CLEAR_CHARGES: bool = ${formatRustBool(readBoolean(tlOptions, "allclear_charges", "TETRIO_TL_OPTIONS"))};`,
    `pub const TL_GARBAGE_MULTIPLIER: f64 = ${formatRustFloat(readFiniteNumberValue(tlOptions, "garbagemultiplier", "TETRIO_TL_OPTIONS"))};`,
    `pub const TL_GARBAGE_SPECIAL_BONUS: bool = ${formatRustBool(readBoolean(tlOptions, "garbagespecialbonus", "TETRIO_TL_OPTIONS"))};`,
    `pub const TL_ROUND_MODE: &str = ${formatRustString(readString(tlOptions, "roundmode", "TETRIO_TL_OPTIONS"))};`,
    `pub const TL_OPENER_PHASE: u32 = ${formatRustU32(readIntegerValue(tlOptions, "openerphase", "TETRIO_TL_OPTIONS"))};`,
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
    `pub(crate) const NO_KICKS: [Kick; 1] = ${formatRustKickArray([{ x: 0, y: 0 }])};`,
    "",
    ...kickTables.flatMap((table) =>
      (["default", "i", "o"] as const).flatMap((group) =>
        RUST_KICK_TRANSITIONS.map((transition) => {
          const kicks = table.groups[group][transition];
          return `pub(crate) const ${table.constantName}_${group.toUpperCase()}_${transition}: [Kick; ${kicks.length}] = ${formatRustKickArray(kicks)};`;
        })
      )
    ),
    "",
    `pub(crate) const ZERO_OFFSET: Kick = Kick { x: 0, y: 0 };`,
    `pub(crate) const ZERO_OFFSETS: [Kick; 4] = ${formatRustKickArray([ZERO_KICK, ZERO_KICK, ZERO_KICK, ZERO_KICK])};`,
    "",
    ...kickTables.flatMap((table) =>
      RUST_PIECES.map(
        (piece) =>
          `pub(crate) const ${table.constantName}_${piece.constantName}_OFFSETS: [Kick; 4] = ${formatRustKickArray(table.pieceOffsets[piece.key])};`
      )
    ),
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
    "pub(crate) fn kick_table_key(table: KickTable) -> &'static str {",
    "    match table {",
    ...kickTableKeyArms,
    "    }",
    "}",
    "",
    "pub(crate) fn kick_table_from_key(key: &str) -> Option<KickTable> {",
    "    match key {",
    ...kickTableFromKeyArms,
    "        _ => None,",
    "    }",
    "}",
    "",
    "pub(crate) fn kick_table_piece_offset(table: KickTable, piece: Piece, rotation: u8) -> Kick {",
    "    let offsets = kick_table_piece_offsets(table, piece);",
    "    offsets.get(rotation as usize).copied().unwrap_or(ZERO_OFFSET)",
    "}",
    "",
    "pub(crate) fn kick_table_piece_offsets(table: KickTable, piece: Piece) -> &'static [Kick; 4] {",
    "    match table {",
    ...kickTables.flatMap((table) => formatRustPieceOffsetsMatch(table)),
    "    }",
    "}",
    "",
    "pub(crate) fn kick_table_spawn_rotation(table: KickTable, piece: Piece) -> u8 {",
    "    match table {",
    ...kickTables.flatMap((table) => formatRustSpawnRotationMatch(table)),
    "    }",
    "}",
    "",
    "pub(crate) fn kick_table_allows_o_kick(table: KickTable) -> bool {",
    "    match table {",
    ...kickTables.map((table) => `        KickTable::${table.variant} => ${table.allowOKick},`),
    "    }",
    "}",
    "",
    "pub(crate) fn kick_table_offsets(",
    "    table: KickTable,",
    "    group: KickGroup,",
    "    from_rotation: u8,",
    "    to_rotation: u8,",
    ") -> &'static [Kick] {",
    "    match table {",
    ...kickTables.flatMap((table) => formatRustKickTableMatch(table)),
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

interface RustKick {
  readonly x: number;
  readonly y: number;
}

interface RustKickTable {
  readonly key: string;
  readonly variant: string;
  readonly constantName: string;
  readonly groups: Record<"default" | "i" | "o", Record<(typeof RUST_KICK_TRANSITIONS)[number], RustKick[]>>;
  readonly pieceOffsets: Record<(typeof RUST_PIECES)[number]["key"], [RustKick, RustKick, RustKick, RustKick]>;
  readonly spawnRotations: Record<(typeof RUST_PIECES)[number]["key"], number>;
  readonly allowOKick: boolean;
}

function readKickTables(tables: Record<string, unknown>): RustKickTable[] {
  const value = tables.TETRIO_KICK_TABLES;
  if (!isRecord(value)) {
    throw new Error("TETRIO_KICK_TABLES must be an object.");
  }

  return Object.entries(value).map(([key, table]) => {
    if (!isRecord(table)) {
      throw new Error(`TETRIO_KICK_TABLES.${key} must be an object.`);
    }
    const defaultGroup = readKickRecord(readRecord(table, "kicks"), `TETRIO_KICK_TABLES.${key}.kicks`);
    const iGroup = isRecord(table.i_kicks) ? readKickRecord(table.i_kicks, `TETRIO_KICK_TABLES.${key}.i_kicks`) : defaultGroup;
    const oGroup = isRecord(table.oo_kicks) ? readKickRecord(table.oo_kicks, `TETRIO_KICK_TABLES.${key}.oo_kicks`) : defaultGroup;
    const pieceOffsets = readPieceOffsets(
      isRecord(table.additional_offsets) ? table.additional_offsets : {},
      `TETRIO_KICK_TABLES.${key}.additional_offsets`
    );
    const spawnRotations = readSpawnRotations(
      isRecord(table.spawn_rotation) ? table.spawn_rotation : {},
      `TETRIO_KICK_TABLES.${key}.spawn_rotation`
    );

    const variant = formatRustKickVariant(key);
    return {
      key,
      variant,
      constantName: `KICK_TABLE_${formatRustVariantConstantIdentifier(variant)}`,
      groups: {
        default: defaultGroup,
        i: iGroup,
        o: oGroup
      },
      pieceOffsets,
      spawnRotations,
      allowOKick: table.allow_o_kick === true
    };
  });
}

function readPieceOffsets(
  record: Record<string, unknown>,
  label: string
): Record<(typeof RUST_PIECES)[number]["key"], [RustKick, RustKick, RustKick, RustKick]> {
  return Object.fromEntries(
    RUST_PIECES.map((piece) => [piece.key, readPieceOffsetList(record[piece.key], `${label}.${piece.key}`)])
  ) as Record<(typeof RUST_PIECES)[number]["key"], [RustKick, RustKick, RustKick, RustKick]>;
}

function readPieceOffsetList(value: unknown, label: string): [RustKick, RustKick, RustKick, RustKick] {
  if (value === undefined) {
    return [ZERO_KICK, ZERO_KICK, ZERO_KICK, ZERO_KICK];
  }
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error(`${label} must be a four-entry offset array.`);
  }
  return value.map((entry, index) => readScreenOffset(entry, `${label}[${index}]`)) as [RustKick, RustKick, RustKick, RustKick];
}

function readSpawnRotations(record: Record<string, unknown>, label: string): Record<(typeof RUST_PIECES)[number]["key"], number> {
  return Object.fromEntries(
    RUST_PIECES.map((piece) => {
      const value = record[piece.key] ?? 0;
      if (!Number.isInteger(value) || typeof value !== "number" || value < 0 || value > 3) {
        throw new Error(`${label}.${piece.key} must be a rotation integer between 0 and 3.`);
      }
      return [piece.key, value];
    })
  ) as Record<(typeof RUST_PIECES)[number]["key"], number>;
}

function readKickRecord(record: Record<string, unknown>, label: string): Record<(typeof RUST_KICK_TRANSITIONS)[number], RustKick[]> {
  return Object.fromEntries(
    RUST_KICK_TRANSITIONS.map((transition) => [transition, readKickList(record[transition], `${label}.${transition}`)])
  ) as Record<(typeof RUST_KICK_TRANSITIONS)[number], RustKick[]>;
}

function readKickList(value: unknown, label: string): RustKick[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return [ZERO_KICK, ...value.map((entry, index) => readScreenOffset(entry, `${label}[${index}]`))];
}

function readScreenOffset(value: unknown, label: string): RustKick {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== "number" ||
    typeof value[1] !== "number" ||
    !Number.isInteger(value[0]) ||
    !Number.isInteger(value[1]) ||
    value[0] < -128 ||
    value[0] > 127 ||
    value[1] < -128 ||
    value[1] > 127
  ) {
    throw new Error(`${label} must be an integer [x, y] offset.`);
  }
  // TETR.IO stores offsets in screen coordinates; native board y grows upward.
  return { x: value[0], y: -value[1] };
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

function readIntegerValue(record: Record<string, unknown>, key: string, label: string): number {
  const value = readFiniteNumberValue(record, key, label);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label}.${key} must be a non-negative integer, got ${value}.`);
  }
  return value;
}

function readFiniteNumberValue(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}.${key} must be a finite number.`);
  }
  return value;
}

function readBoolean(record: Record<string, unknown>, key: string, label: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`${label}.${key} must be a boolean.`);
  }
  return value;
}

function readString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`${label}.${key} must be a string.`);
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

function formatRustBool(value: boolean): string {
  return value ? "true" : "false";
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

function formatRustKickArray(values: readonly RustKick[]): string {
  return formatRustWrappedArray(values.map((value) => `Kick { x: ${value.x}, y: ${value.y} }`));
}

function formatRustPieceOffsetsMatch(table: RustKickTable): string[] {
  return [
    `        KickTable::${table.variant} => match piece {`,
    ...RUST_PIECES.map((piece) => `            Piece::${piece.variant} => &${table.constantName}_${piece.constantName}_OFFSETS,`),
    "        },"
  ];
}

function formatRustSpawnRotationMatch(table: RustKickTable): string[] {
  return [
    `        KickTable::${table.variant} => match piece {`,
    ...RUST_PIECES.map((piece) => `            Piece::${piece.variant} => ${table.spawnRotations[piece.key]}_u8,`),
    "        },"
  ];
}

function formatRustKickTableMatch(table: RustKickTable): string[] {
  return [
    `        KickTable::${table.variant} => match group {`,
    "            KickGroup::Default => match (from_rotation, to_rotation) {",
    ...formatRustKickTransitionArms(table, "default"),
    "            },",
    "            KickGroup::I => match (from_rotation, to_rotation) {",
    ...formatRustKickTransitionArms(table, "i"),
    "            },",
    "            KickGroup::O => match (from_rotation, to_rotation) {",
    ...formatRustKickTransitionArms(table, "o"),
    "            },",
    "        },"
  ];
}

function formatRustKickTransitionArms(table: RustKickTable, group: "default" | "i" | "o"): string[] {
  return [
    ...RUST_KICK_TRANSITIONS.map((transition) => {
      const [fromRotation, toRotation] = transition.split("");
      return `                (${fromRotation}, ${toRotation}) => &${table.constantName}_${group.toUpperCase()}_${transition},`;
    }),
    "                _ => &NO_KICKS,"
  ];
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

function formatRustVariantConstantIdentifier(value: string): string {
  return formatRustConstantIdentifier(value.replace(/([a-z0-9])([A-Z])/g, "$1_$2"));
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

function formatRustKickVariant(value: string): string {
  switch (value) {
    case "SRS":
      return "Srs";
    case "SRS+":
      return "SrsPlus";
    case "SRS-X":
      return "SrsX";
    case "TETRA-X":
      return "TetraX";
    case "NRS":
      return "Nrs";
    case "ARS":
      return "Ars";
    case "ASC":
      return "Asc";
    case "none":
      return "None";
    default:
      return formatRustPascalIdentifier(value);
  }
}
