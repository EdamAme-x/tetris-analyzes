import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createOpenerExperimentCliConfig } from "../src/application/opener-experiment-cli";
import {
  type OpenerExperimentProgressEvent,
  renderOpenerExperimentConsoleSummary,
  renderOpenerExperimentMarkdown,
  runOpenerExperiment
} from "../src/application/run-opener-experiment";

const config = createOpenerExperimentCliConfig(process.argv.slice(2));
const progressStartedAt = performance.now();
const report = runOpenerExperiment({
  scenarios: config.scenarios,
  environment: {
    runtime: `bun ${Bun.version}`,
    nativeProfile: "release"
  },
  ...(config.experimentTop === undefined ? {} : { top: config.experimentTop }),
  ...(config.progress ? { onProgress: logProgress } : {}),
  ...(config.validationScenarios.length === 0
    ? {}
    : {
        templateReplay: {
          scenarios: config.validationScenarios,
          topTemplates: config.replayTopTemplates
        }
      }),
  ...(config.testScenarios.length === 0
    ? {}
    : {
        certificationReplay: {
          scenarios: config.testScenarios,
          topTemplates: config.replayTopTemplates
        }
      })
});
const markdown = renderOpenerExperimentMarkdown(report);
const filenameBase = `${report.generatedAt.replaceAll(":", "-").replaceAll(".", "-")}-opener`;

await mkdir(config.outDir, { recursive: true });
await writeFile(join(config.outDir, `${filenameBase}.json`), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(config.outDir, `${filenameBase}.md`), markdown);

console.log(renderOpenerExperimentConsoleSummary(report, config.displayTop));
console.log("");
console.log(`full report: ${join(config.outDir, `${filenameBase}.md`)}`);
console.log(`json: ${join(config.outDir, `${filenameBase}.json`)}`);

function logProgress(event: OpenerExperimentProgressEvent): void {
  const elapsedSeconds = ((performance.now() - progressStartedAt) / 1_000).toFixed(1);
  const parts = [`[${elapsedSeconds}s]`, event.stage, `${event.index}/${event.total}`, event.scenario, event.step, `queue=${event.queue}`];
  if (event.elapsedMs !== undefined) {
    parts.push(`elapsed=${event.elapsedMs.toFixed(1)}ms`);
  }
  if (event.medianMs !== undefined) {
    parts.push(`median=${event.medianMs.toFixed(1)}ms`);
  }
  if (event.resultCount !== undefined) {
    parts.push(`nodes=${event.resultCount}`);
  }
  console.error(parts.join(" "));
}
