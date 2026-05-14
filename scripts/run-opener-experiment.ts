import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_OPENER_EXPERIMENT_SCENARIOS,
  renderOpenerExperimentMarkdown,
  runOpenerExperiment
} from "../src/application/run-opener-experiment";

const outDir = readOption("--out-dir") ?? "experiments/runs";
const top = readNumberOption("--top");
const report = runOpenerExperiment({
  scenarios: DEFAULT_OPENER_EXPERIMENT_SCENARIOS,
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

console.log(markdown);
console.log(`wrote ${join(outDir, `${filenameBase}.json`)}`);
console.log(`wrote ${join(outDir, `${filenameBase}.md`)}`);

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
