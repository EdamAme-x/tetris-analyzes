import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  generateOpeners,
  renderGeneratedOpenersConsole,
  renderGeneratedOpenersMarkdown,
  type GeneratedOpenerPreviewMode,
  type GenerateOpenersRules
} from "../src/application/generate-openers";

const config = createGenerateOpenersCliConfig(process.argv.slice(2));
const report = generateOpeners(config);
const filenameBase = `${report.generatedAt.replaceAll(":", "-").replaceAll(".", "-")}-generated-openers`;

await mkdir(config.outDir, { recursive: true });
await writeFile(join(config.outDir, `${filenameBase}.json`), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(config.outDir, `${filenameBase}.md`), renderGeneratedOpenersMarkdown(report));

console.log(renderGeneratedOpenersConsole(report, config.displayTop));
console.log("");
console.log(`full report: ${join(config.outDir, `${filenameBase}.md`)}`);
console.log(`json: ${join(config.outDir, `${filenameBase}.json`)}`);

interface GenerateOpenersCliConfig {
  readonly outDir: string;
  readonly bag: string;
  readonly beamWidth: number;
  readonly hold: boolean;
  readonly maxDepth: number;
  readonly maxQueues: number;
  readonly top: number;
  readonly displayTop: number;
  readonly includePath: boolean;
  readonly previewMode: GeneratedOpenerPreviewMode;
  readonly rules: Partial<GenerateOpenersRules>;
}

function createGenerateOpenersCliConfig(argv: readonly string[]): GenerateOpenersCliConfig {
  const args = parseArgs(argv);
  const bag = args.get("--bag") ?? "TIJLOSZ";
  const top = readPositiveIntegerOption(args, "--top") ?? 8;
  return {
    outDir: args.get("--out-dir") ?? "experiments/runs",
    bag,
    beamWidth: readPositiveIntegerOption(args, "--beam") ?? 128,
    hold: readBooleanOption(args, "--hold") ?? true,
    maxDepth: readPositiveIntegerOption(args, "--depth") ?? Math.min(7, bag.length),
    maxQueues: readNonNegativeIntegerOption(args, "--max-queues") ?? 0,
    top,
    displayTop: readPositiveIntegerOption(args, "--display-top") ?? top,
    includePath: readBooleanOption(args, "--include-path") ?? true,
    previewMode: readPreviewModeOption(args, "--preview-mode") ?? "placements",
    rules: {
      ...(args.has("--spin-mode") ? { spinMode: args.get("--spin-mode") as GenerateOpenersRules["spinMode"] } : {}),
      ...(args.has("--combo-table") ? { comboTable: args.get("--combo-table") as GenerateOpenersRules["comboTable"] } : {}),
      ...(args.has("--kick-table") ? { kickTable: args.get("--kick-table") as GenerateOpenersRules["kickTable"] } : {}),
      ...(args.has("--allow-180") ? { allow180: readBooleanOption(args, "--allow-180") ?? true } : {})
    }
  };
}

function parseArgs(argv: readonly string[]): Map<string, string> {
  const allowed = new Set([
    "--out-dir",
    "--bag",
    "--beam",
    "--hold",
    "--depth",
    "--max-queues",
    "--top",
    "--display-top",
    "--include-path",
    "--preview-mode",
    "--spin-mode",
    "--combo-table",
    "--kick-table",
    "--allow-180"
  ]);
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      break;
    }
    const [flag, inlineValue] = splitOption(arg);
    if (!allowed.has(flag)) {
      throw new Error(`Unknown option ${flag}.`);
    }
    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    if (inlineValue === undefined) {
      index += 1;
    }
    parsed.set(flag, value);
  }
  return parsed;
}

function readPreviewModeOption(args: ReadonlyMap<string, string>, name: string): GeneratedOpenerPreviewMode | undefined {
  const raw = args.get(name);
  if (raw === undefined) {
    return undefined;
  }
  if (raw === "placements" || raw === "final-board") {
    return raw;
  }
  throw new Error(`${name} must be placements or final-board.`);
}

function splitOption(arg: string): [string, string | undefined] {
  const separator = arg.indexOf("=");
  if (separator === -1) {
    return [arg, undefined];
  }
  return [arg.slice(0, separator), arg.slice(separator + 1)];
}

function readPositiveIntegerOption(args: ReadonlyMap<string, string>, name: string): number | undefined {
  const raw = args.get(name);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function readNonNegativeIntegerOption(args: ReadonlyMap<string, string>, name: string): number | undefined {
  const raw = args.get(name);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

function readBooleanOption(args: ReadonlyMap<string, string>, name: string): boolean | undefined {
  const raw = args.get(name);
  if (raw === undefined) {
    return undefined;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  throw new Error(`${name} must be true or false.`);
}
