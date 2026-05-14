import { createFumenCodec } from "../infrastructure/fumen/tetris-fumen-codec";
import type { FumenCodec, FumenUrls } from "../domain/fumen";
import { createOpenerFumenPages } from "./create-opener-fumen";
import { searchOpenerBeamWithPlacements, type SearchOpenerBeamInput, type SearchOpenerBeamNode } from "./search-opener";

export interface OpenerExperimentScenario {
  readonly name: string;
  readonly queue: string;
  readonly hold: boolean;
  readonly beamWidth: number;
  readonly maxDepth: number;
  readonly warmups?: number;
  readonly iterations?: number;
  readonly top?: number;
  readonly tags?: readonly string[];
}

export interface OpenerExperimentEnvironment {
  readonly runtime: string;
  readonly nativeProfile: string;
}

export interface OpenerExperimentCandidate {
  readonly rank: number;
  readonly score: number;
  readonly firepowerScore: number;
  readonly path: readonly string[];
  readonly previewUrl: string;
  readonly hold: string | null;
  readonly queueIndex: number;
  readonly attack: number;
  readonly points: number;
  readonly maxCombo: number;
  readonly backToBackChain: number;
  readonly allClears: number;
  readonly difficultClears: number;
  readonly tSpinClears: number;
  readonly tSpinAttack: number;
  readonly clearSequence: readonly string[];
  readonly occupiedCells: number;
  readonly clearedLines: number;
  readonly aggregateHeight: number;
  readonly holes: number;
  readonly bumpiness: number;
  readonly urls: FumenUrls;
}

export interface RankedOpenerCandidate extends OpenerExperimentCandidate {
  readonly sourceScenario: string;
}

export interface OpenerExperimentScenarioResult {
  readonly name: string;
  readonly queue: string;
  readonly hold: boolean;
  readonly beamWidth: number;
  readonly maxDepth: number;
  readonly warmups: number;
  readonly iterations: number;
  readonly resultCount: number;
  readonly medianMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly searchesPerSecond: number;
  readonly top: readonly OpenerExperimentCandidate[];
  readonly tags: readonly string[];
}

export interface OpenerExperimentReport {
  readonly generatedAt: string;
  readonly engine: "native-rust-beam";
  readonly environment: OpenerExperimentEnvironment;
  readonly scenarios: readonly OpenerExperimentScenarioResult[];
}

export interface OpenerExperimentClock {
  nowMs(): number;
  isoNow(): string;
}

export type OpenerSearch = (input: SearchOpenerBeamInput) => SearchOpenerBeamNode[];

export interface RunOpenerExperimentInput {
  readonly scenarios: readonly OpenerExperimentScenario[];
  readonly environment?: OpenerExperimentEnvironment;
  readonly clock?: OpenerExperimentClock;
  readonly search?: OpenerSearch;
  readonly fumenCodec?: FumenCodec;
  readonly top?: number;
}

export const DEFAULT_OPENER_EXPERIMENT_SCENARIOS: readonly OpenerExperimentScenario[] = [
  {
    name: "best-two-bag-tspin-openers",
    queue: "SZILOJTSTOZLJI",
    hold: true,
    beamWidth: 1024,
    maxDepth: 14,
    iterations: 1,
    top: 8,
    tags: ["best", "hold", "two-bag", "t-spin"]
  }
];

export function runOpenerExperiment(input: RunOpenerExperimentInput): OpenerExperimentReport {
  if (input.scenarios.length === 0) {
    throw new Error("At least one opener experiment scenario is required.");
  }

  const clock = input.clock ?? systemClock;
  const search = input.search ?? searchOpenerBeamWithPlacements;
  const fumenCodec = input.fumenCodec ?? createFumenCodec();
  const environment = input.environment ?? { runtime: "bun", nativeProfile: "release" };

  return {
    generatedAt: clock.isoNow(),
    engine: "native-rust-beam",
    environment,
    scenarios: input.scenarios.map((scenario) => runScenario(scenario, input.top, search, fumenCodec, clock))
  };
}

export function renderOpenerExperimentMarkdown(report: OpenerExperimentReport): string {
  const bestCandidates = rankOpenerCandidates(report, 12);
  const lines = [
    "# Opener experiment",
    "",
    `Generated: ${report.generatedAt}`,
    `Engine: ${report.engine}`,
    `Runtime: ${report.environment.runtime}`,
    `Native: ${report.environment.nativeProfile}`,
    "",
    "## Best openers",
    "",
    "| rank | attack | tspin | tspin attack | points | score | holes | bumpiness | clears | path | preview |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |"
  ];

  for (const candidate of bestCandidates) {
    lines.push(
      [
        String(candidate.rank),
        String(candidate.attack),
        String(candidate.tSpinClears),
        String(candidate.tSpinAttack),
        String(candidate.points),
        candidate.score.toFixed(1),
        String(candidate.holes),
        String(candidate.bumpiness),
        formatClearSequence(candidate.clearSequence),
        candidate.path.join(" "),
        `[view](${candidate.previewUrl})`
      ].join(" | ")
    );
  }

  lines.push(
    "",
    "## Search run",
    "",
    "| name | queue | hold | beam | depth | median ms | searches/s | nodes |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |"
  );

  for (const scenario of report.scenarios) {
    lines.push(
      [
        scenario.name,
        scenario.queue,
        String(scenario.hold),
        String(scenario.beamWidth),
        String(scenario.maxDepth),
        scenario.medianMs.toFixed(3),
        scenario.searchesPerSecond.toFixed(1),
        String(scenario.resultCount)
      ].join(" | ")
    );
  }

  lines.push("", "## Candidate details", "");
  for (const scenario of report.scenarios) {
    lines.push(`### ${scenario.name}`, "");
    if (scenario.top.length === 0) {
      lines.push("No candidates.", "");
      continue;
    }

    lines.push(
      "| rank | attack | tspin | tspin attack | points | score | holes | bumpiness | clears | path | preview |",
      "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |"
    );
    for (const candidate of scenario.top) {
      lines.push(
        [
          String(candidate.rank),
          String(candidate.attack),
          String(candidate.tSpinClears),
          String(candidate.tSpinAttack),
          String(candidate.points),
          candidate.score.toFixed(1),
          String(candidate.holes),
          String(candidate.bumpiness),
          formatClearSequence(candidate.clearSequence),
          candidate.path.join(" "),
          `[view](${candidate.previewUrl})`
        ].join(" | ")
      );
    }
    lines.push("");
  }

  lines.push("");
  return lines.join("\n");
}

export function renderOpenerExperimentConsoleSummary(report: OpenerExperimentReport, topCount = 5): string {
  const lines = ["Best opener candidates", ""];
  for (const candidate of rankOpenerCandidates(report, topCount)) {
    lines.push(
      `#${candidate.rank} attack=${candidate.attack} tspin=${candidate.tSpinClears} tspinAttack=${candidate.tSpinAttack} points=${candidate.points} score=${candidate.score.toFixed(1)} holes=${candidate.holes} bump=${candidate.bumpiness}`,
      `clears: ${formatClearSequence(candidate.clearSequence)}`,
      `path: ${candidate.path.join(" ")}`,
      `view: ${candidate.previewUrl}`,
      ""
    );
  }
  return lines.join("\n").trimEnd();
}

export function rankOpenerCandidates(report: OpenerExperimentReport, topCount: number): RankedOpenerCandidate[] {
  return report.scenarios
    .flatMap((scenario) => scenario.top.map((candidate) => ({ ...candidate, sourceScenario: scenario.name })))
    .sort(compareRankedOpenerCandidates)
    .slice(0, topCount)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

function runScenario(
  scenario: OpenerExperimentScenario,
  topOverride: number | undefined,
  search: OpenerSearch,
  fumenCodec: FumenCodec,
  clock: OpenerExperimentClock
): OpenerExperimentScenarioResult {
  const warmups = scenario.warmups ?? 1;
  const iterations = scenario.iterations ?? 5;
  if (warmups < 0 || !Number.isInteger(warmups)) {
    throw new Error(`Scenario ${scenario.name} warmups must be a non-negative integer.`);
  }
  if (iterations <= 0 || !Number.isInteger(iterations)) {
    throw new Error(`Scenario ${scenario.name} iterations must be a positive integer.`);
  }

  for (let index = 0; index < warmups; index += 1) {
    search(searchInput(scenario));
  }

  const timings: number[] = [];
  let lastNodes: SearchOpenerBeamNode[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = clock.nowMs();
    lastNodes = search(searchInput(scenario));
    timings.push(clock.nowMs() - start);
  }

  const stats = summarizeTimings(timings);
  return {
    name: scenario.name,
    queue: scenario.queue,
    hold: scenario.hold,
    beamWidth: scenario.beamWidth,
    maxDepth: scenario.maxDepth,
    warmups,
    iterations,
    resultCount: lastNodes.length,
    medianMs: stats.median,
    minMs: stats.min,
    maxMs: stats.max,
    searchesPerSecond: stats.median === 0 ? 0 : 1_000 / stats.median,
    top: createTopCandidates(lastNodes, scenario, topOverride ?? scenario.top ?? 5, fumenCodec),
    tags: scenario.tags ?? []
  };
}

function searchInput(scenario: OpenerExperimentScenario): SearchOpenerBeamInput {
  return {
    queue: scenario.queue,
    beamWidth: scenario.beamWidth,
    hold: scenario.hold,
    maxDepth: scenario.maxDepth
  };
}

function createTopCandidates(
  nodes: readonly SearchOpenerBeamNode[],
  scenario: OpenerExperimentScenario,
  topCount: number,
  fumenCodec: FumenCodec
): OpenerExperimentCandidate[] {
  return [...nodes]
    .sort(compareSearchNodesForOpener)
    .slice(0, topCount)
    .map((node, index) => {
      const data = fumenCodec.encodePages(createOpenerFumenPages(node, { title: `${scenario.name} #${index + 1}` }));
      const urls = fumenCodec.createUrls(data);
      return {
        rank: index + 1,
        score: node.score,
        firepowerScore: node.firepowerScore,
        path: node.path,
        previewUrl: urls.view,
        hold: node.hold ?? null,
        queueIndex: node.queueIndex,
        attack: node.attack,
        points: node.points,
        maxCombo: node.maxCombo,
        backToBackChain: node.backToBackChain,
        allClears: node.allClears,
        difficultClears: node.difficultClears,
        tSpinClears: node.tSpinClears,
        tSpinAttack: node.tSpinAttack,
        clearSequence: node.placements
          .filter((placement) => placement.clearName !== "NONE")
          .map((placement) => `${placement.clearName}:${placement.attack}`),
        occupiedCells: node.occupiedCells,
        clearedLines: node.clearedLines,
        aggregateHeight: node.aggregateHeight,
        holes: node.holes,
        bumpiness: node.bumpiness,
        urls
      };
    });
}

function compareSearchNodesForOpener(left: SearchOpenerBeamNode, right: SearchOpenerBeamNode): number {
  return (
    right.tSpinClears - left.tSpinClears ||
    right.tSpinAttack - left.tSpinAttack ||
    right.difficultClears - left.difficultClears ||
    right.attack - left.attack ||
    right.firepowerScore - left.firepowerScore ||
    right.score - left.score ||
    left.holes - right.holes ||
    left.bumpiness - right.bumpiness ||
    right.points - left.points ||
    right.depth - left.depth ||
    left.path.join(" ").localeCompare(right.path.join(" "))
  );
}

function compareRankedOpenerCandidates(left: RankedOpenerCandidate, right: RankedOpenerCandidate): number {
  return (
    right.tSpinClears - left.tSpinClears ||
    right.tSpinAttack - left.tSpinAttack ||
    right.difficultClears - left.difficultClears ||
    right.attack - left.attack ||
    right.firepowerScore - left.firepowerScore ||
    right.score - left.score ||
    left.holes - right.holes ||
    left.bumpiness - right.bumpiness ||
    right.points - left.points ||
    right.path.length - left.path.length ||
    left.path.join(" ").localeCompare(right.path.join(" "))
  );
}

function formatClearSequence(clearSequence: readonly string[]): string {
  return clearSequence.length === 0 ? "-" : clearSequence.join(" ");
}

function summarizeTimings(samples: readonly number[]): { median: number; min: number; max: number } {
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return {
    median: sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0),
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0
  };
}

const systemClock: OpenerExperimentClock = {
  nowMs: () => performance.now(),
  isoNow: () => new Date().toISOString()
};
