import { createDistributionOpenerExperimentSplits, type OpenerExperimentScenario } from "./run-opener-experiment";

export type OpenerExperimentPresetName = "default" | "distribution" | "survey" | "discovery" | "continuation";

export interface OpenerExperimentCliConfig {
  readonly outDir: string;
  readonly preset: OpenerExperimentPresetName;
  readonly seed: string;
  readonly scenarios: readonly OpenerExperimentScenario[];
  readonly validationScenarios: readonly OpenerExperimentScenario[];
  readonly testScenarios: readonly OpenerExperimentScenario[];
  readonly displayTop: number;
  readonly experimentTop?: number;
  readonly survivabilityReplay: number;
  readonly certificationReplay: number;
  readonly replayTopTemplates: number;
  readonly progress: boolean;
}

export function createOpenerExperimentCliConfig(argv: readonly string[]): OpenerExperimentCliConfig {
  const args = parseArgs(argv);
  const outDir = args.get("--out-dir") ?? "experiments/runs";
  const top = readNumberOption(args, "--top");
  const preset = readPreset(args.get("--preset") ?? "default");
  const setupPoolMultiplier = readNumberOption(args, "--setup-pool-multiplier");
  const seed = args.get("--seed") ?? defaultSeed(preset);
  const bagCount = readNumberOption(args, "--bag-count") ?? defaultBagCount(preset);
  const trainSamples = readNonNegativeNumberOption(args, "--train-samples") ?? defaultTrainSamples(preset);
  const survivabilityReplay =
    readNonNegativeNumberOption(args, "--validation-samples") ??
    readNonNegativeNumberOption(args, "--survivability-replay") ??
    defaultSurvivabilityReplay(preset);
  const certificationReplay = readNonNegativeNumberOption(args, "--test-samples") ?? defaultCertificationReplay(preset);
  const splits = createDistributionOpenerExperimentSplits({
    seed,
    bagCount,
    trainSamples,
    validationSamples: survivabilityReplay,
    testSamples: certificationReplay,
    ...(setupPoolMultiplier === undefined ? {} : { setupPoolMultiplier }),
    beamWidth: defaultBeamWidth(bagCount),
    maxDepth: bagCount * 7
  });
  const displayTop = top ?? 5;
  const replayTopTemplates = readNumberOption(args, "--replay-top-templates") ?? defaultReplayTemplatePool(preset, displayTop);
  const experimentTop = survivabilityReplay === 0 && certificationReplay === 0 ? top : Math.max(displayTop, replayTopTemplates);
  const progress = readBooleanOption(args, "--progress") ?? false;

  return {
    outDir,
    preset,
    seed,
    scenarios: splits.train,
    validationScenarios: splits.validation,
    testScenarios: splits.test,
    displayTop,
    ...(experimentTop === undefined ? {} : { experimentTop }),
    survivabilityReplay,
    certificationReplay,
    replayTopTemplates,
    progress
  };
}

export function defaultTrainSamples(presetName: OpenerExperimentPresetName): number {
  return presetName === "survey" || presetName === "discovery" ? 16 : 8;
}

export function defaultSurvivabilityReplay(_presetName: OpenerExperimentPresetName): number {
  return 16;
}

export function defaultCertificationReplay(_presetName: OpenerExperimentPresetName): number {
  return 64;
}

export function defaultReplayTemplatePool(presetName: OpenerExperimentPresetName, displayTop: number): number {
  const minimum = presetName === "survey" || presetName === "discovery" ? 64 : 128;
  return Math.max(displayTop, minimum);
}

export function scenarioPreset(name: OpenerExperimentPresetName): readonly OpenerExperimentScenario[] {
  return createDistributionOpenerExperimentSplits({
    seed: defaultSeed(name),
    bagCount: defaultBagCount(name),
    trainSamples: defaultTrainSamples(name),
    validationSamples: 0,
    testSamples: 0
  }).train;
}

function parseArgs(argv: readonly string[]): Map<string, string> {
  const allowed = new Set([
    "--out-dir",
    "--top",
    "--preset",
    "--seed",
    "--bag-count",
    "--train-samples",
    "--validation-samples",
    "--test-samples",
    "--survivability-replay",
    "--replay-top-templates",
    "--setup-pool-multiplier",
    "--progress"
  ]);
  const booleanFlags = new Set(["--progress"]);
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
    if (booleanFlags.has(flag) && inlineValue === undefined) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        parsed.set(flag, "true");
        continue;
      }
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

function readBooleanOption(args: ReadonlyMap<string, string>, name: string): boolean | undefined {
  const raw = args.get(name);
  if (raw === undefined) {
    return undefined;
  }
  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw new Error(`${name} must be a boolean.`);
  }
}

function readPreset(raw: string): OpenerExperimentPresetName {
  switch (raw) {
    case "default":
    case "distribution":
    case "survey":
    case "discovery":
    case "continuation":
      return raw;
    default:
      throw new Error(`Unknown opener experiment preset ${raw}. Expected default, distribution, survey, discovery, or continuation.`);
  }
}

function defaultSeed(presetName: OpenerExperimentPresetName): string {
  return `tl-distribution-v1:${presetName}`;
}

function defaultBagCount(presetName: OpenerExperimentPresetName): number {
  return presetName === "survey" || presetName === "discovery" ? 2 : 3;
}

function defaultBeamWidth(_bagCount: number): number {
  return 512;
}
