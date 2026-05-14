import { resolve } from "node:path";

const TETRIO_HOME = "https://tetr.io/";
const DEFAULT_OUTPUT = "src/generated/tetrio-tables.generated.ts";

interface GenerateOptions {
  readonly input?: string;
  readonly asset?: string;
  readonly output: string;
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
const source = await loadBundleSource(options);
const tables = extractTables(source.text);
const generated = formatGeneratedModule(source, tables);
const outputPath = resolve(options.output);

if (options.check) {
  const current = await Bun.file(outputPath).text();
  if (current !== generated) {
    throw new Error(`${options.output} is out of date. Run bun run generate:tetrio-tables.`);
  }
  console.log(`${options.output} is up to date.`);
} else {
  await Bun.write(outputPath, generated);
  console.log(`Generated ${options.output} from ${source.asset}.`);
}

function parseArgs(args: readonly string[]): GenerateOptions {
  const options: {
    input?: string;
    asset?: string;
    output: string;
    fetchedAt?: string;
    lastModified?: string;
    check: boolean;
  } = {
    output: DEFAULT_OUTPUT,
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
    return {
      asset: options.asset ?? `file://${resolve(options.input)}`,
      text: await Bun.file(options.input).text(),
      fetchedAt: options.fetchedAt ?? new Date().toISOString(),
      lastModified: options.lastModified ?? ""
    };
  }

  const asset = options.asset ?? (await discoverClientAsset());
  const response = await fetch(asset);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${asset}: ${response.status} ${response.statusText}`);
  }

  return {
    asset,
    text: await response.text(),
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    lastModified: options.lastModified ?? response.headers.get("last-modified") ?? ""
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

function formatGeneratedModule(source: BundleSource, tables: Record<string, unknown>): string {
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
