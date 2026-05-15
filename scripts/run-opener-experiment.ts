import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createOpenerExperimentCliConfig } from "../src/application/opener-experiment-cli";
import {
  renderOpenerExperimentConsoleSummary,
  renderOpenerExperimentMarkdown,
  runOpenerExperiment
} from "../src/application/run-opener-experiment";

const { outDir, scenarios, validationScenarios, testScenarios, displayTop, replayTopTemplates, experimentTop } =
  createOpenerExperimentCliConfig(process.argv.slice(2));
const report = runOpenerExperiment({
  scenarios,
  environment: {
    runtime: `bun ${Bun.version}`,
    nativeProfile: "release"
  },
  ...(experimentTop === undefined ? {} : { top: experimentTop }),
  ...(validationScenarios.length === 0
    ? {}
    : {
        templateReplay: {
          scenarios: validationScenarios,
          topTemplates: replayTopTemplates
        }
      }),
  ...(testScenarios.length === 0
    ? {}
    : {
        certificationReplay: {
          scenarios: testScenarios,
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
