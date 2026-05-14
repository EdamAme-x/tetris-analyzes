import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createOpenerExperimentCliConfig } from "../src/application/opener-experiment-cli";
import {
  createTemplateReplayScenarios,
  renderOpenerExperimentConsoleSummary,
  renderOpenerExperimentMarkdown,
  runOpenerExperiment,
  type OpenerExperimentScenario
} from "../src/application/run-opener-experiment";

const { outDir, scenarios, survivabilityReplay, displayTop, replayTopTemplates, experimentTop } = createOpenerExperimentCliConfig(
  process.argv.slice(2)
);
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

function templateReplayOptions(scenarios: readonly OpenerExperimentScenario[]) {
  const first = scenarios[0];
  if (first === undefined) {
    return {};
  }
  return {
    bagCount: Math.max(1, Math.round(first.queue.length / 7)),
    beamWidth: first.beamWidth,
    maxDepth: first.maxDepth,
    sampleOffset: scenarios.some((scenario) => scenario.tags?.includes("continuation")) ? Math.max(64, scenarios.length) : 0
  };
}
