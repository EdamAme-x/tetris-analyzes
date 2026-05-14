import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CONTINUATION_OPENER_EXPERIMENT_SCENARIOS,
  DEFAULT_OPENER_EXPERIMENT_SCENARIOS,
  DISCOVERY_OPENER_EXPERIMENT_SCENARIOS,
  SURVEY_OPENER_EXPERIMENT_SCENARIOS,
  createTemplateReplayScenarios,
  renderOpenerExperimentConsoleSummary,
  renderOpenerExperimentMarkdown,
  runOpenerExperiment
} from "../src/application/run-opener-experiment";

const args = parseArgs(process.argv.slice(2));
const outDir = args.get("--out-dir") ?? "experiments/runs";
const top = readNumberOption(args, "--top");
const preset = args.get("--preset") ?? "default";
const setupPoolMultiplier = readNumberOption(args, "--setup-pool-multiplier");
const scenarios = scenarioPreset(preset).map((scenario) => ({
  ...scenario,
  ...(setupPoolMultiplier === undefined ? {} : { setupPoolMultiplier })
}));
const survivabilityReplay = readNonNegativeNumberOption(args, "--survivability-replay") ?? defaultSurvivabilityReplay(preset);
const displayTop = top ?? 5;
const replayTopTemplates = readNumberOption(args, "--replay-top-templates") ?? defaultReplayTemplatePool(preset, displayTop);
const experimentTop = survivabilityReplay === 0 ? top : Math.max(displayTop, replayTopTemplates);
const report = runOpenerExperiment({
  scenarios,
  environment: {
    runtime: `bun ${Bun.version}`,
    nativeProfile: "release"
  },
  ...(experimentTop === undefined ? {} : { top: experimentTop }),
  ...(survivabilityReplay === 0
    ? {}
    : {
        templateReplay: {
          scenarios: createTemplateReplayScenarios(survivabilityReplay, templateReplayOptions(scenarios)),
          topTemplates: replayTopTemplates
        }
      })
});
const markdown = renderOpenerExperimentMarkdown(report);
const filenameBase = `${report.generatedAt.replaceAll(":", "-").replaceAll(".", "-")}-opener`;

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, `${filenameBase}.json`), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(outDir, `${filenameBase}.md`), markdown);

console.log(renderOpenerExperimentConsoleSummary(report, displayTop));
console.log("");
console.log(`full report: ${join(outDir, `${filenameBase}.md`)}`);
console.log(`json: ${join(outDir, `${filenameBase}.json`)}`);

function parseArgs(argv: readonly string[]): Map<string, string> {
  const allowed = new Set([
    "--out-dir",
    "--top",
    "--preset",
    "--survivability-replay",
    "--replay-top-templates",
    "--setup-pool-multiplier"
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

function splitOption(arg: string): [string, string | undefined] {
  const separator = arg.indexOf("=");
  if (separator === -1) {
    return [arg, undefined];
  }
  return [arg.slice(0, separator), arg.slice(separator + 1)];
}

function readNumberOption(args: ReadonlyMap<string, string>, name: string): number | undefined {
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

function readNonNegativeNumberOption(args: ReadonlyMap<string, string>, name: string): number | undefined {
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

function defaultSurvivabilityReplay(presetName: string): number {
  return presetName === "discovery" ? 24 : 0;
}

function defaultReplayTemplatePool(presetName: string, displayTop: number): number {
  const minimum = presetName === "continuation" || presetName === "discovery" ? 64 : 16;
  return Math.max(displayTop, minimum);
}

function scenarioPreset(name: string) {
  switch (name) {
    case "default":
      return DEFAULT_OPENER_EXPERIMENT_SCENARIOS;
    case "survey":
      return SURVEY_OPENER_EXPERIMENT_SCENARIOS;
    case "discovery":
      return DISCOVERY_OPENER_EXPERIMENT_SCENARIOS;
    case "continuation":
      return CONTINUATION_OPENER_EXPERIMENT_SCENARIOS;
    default:
      throw new Error(`Unknown opener experiment preset ${name}. Expected default, survey, discovery, or continuation.`);
  }
}

function templateReplayOptions(scenarios: readonly ReturnType<typeof scenarioPreset>[number][]) {
  const first = scenarios[0];
  if (first === undefined) {
    return {};
  }
  return {
    bagCount: Math.max(1, Math.round(first.queue.length / 7)),
    beamWidth: first.beamWidth,
    maxDepth: first.maxDepth
  };
}
