import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_OPENER_EXPERIMENT_SCENARIOS,
  SURVEY_OPENER_EXPERIMENT_SCENARIOS,
  renderOpenerExperimentConsoleSummary,
  renderOpenerExperimentMarkdown,
  runOpenerExperiment
} from "../src/application/run-opener-experiment";

const outDir = readOption("--out-dir") ?? "experiments/runs";
const top = readNumberOption("--top");
const preset = readOption("--preset") ?? "default";
const report = runOpenerExperiment({
  scenarios: scenarioPreset(preset),
  environment: {
    runtime: `bun ${Bun.version}`,
    nativeProfile: "release"
  },
  ...(top === undefined ? {} : { top })
});
const markdown = renderOpenerExperimentMarkdown(report);
const filenameBase = `${report.generatedAt.replaceAll(":", "-").replaceAll(".", "-")}-opener`;

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, `${filenameBase}.json`), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(outDir, `${filenameBase}.md`), markdown);

console.log(renderOpenerExperimentConsoleSummary(report, top ?? 5));
console.log("");
console.log(`full report: ${join(outDir, `${filenameBase}.md`)}`);
console.log(`json: ${join(outDir, `${filenameBase}.json`)}`);

function readOption(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function readNumberOption(name: string): number | undefined {
  const raw = readOption(name);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function scenarioPreset(name: string) {
  switch (name) {
    case "default":
      return DEFAULT_OPENER_EXPERIMENT_SCENARIOS;
    case "survey":
      return SURVEY_OPENER_EXPERIMENT_SCENARIOS;
    default:
      throw new Error(`Unknown opener experiment preset ${name}. Expected default or survey.`);
  }
}
