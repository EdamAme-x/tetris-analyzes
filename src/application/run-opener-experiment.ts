import { createFumenCodec } from "../infrastructure/fumen/tetris-fumen-codec";
import type { FumenCodec, FumenUrls } from "../domain/fumen";
import { createOpenerFumenPages } from "./create-opener-fumen";
import { searchOpenerBeam, type SearchOpenerBeamInput, type SearchOpenerBeamNode } from "./search-opener";

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
  readonly path: readonly string[];
  readonly previewUrl: string;
  readonly hold: string | null;
  readonly queueIndex: number;
  readonly occupiedCells: number;
  readonly clearedLines: number;
  readonly aggregateHeight: number;
  readonly holes: number;
  readonly bumpiness: number;
  readonly urls: FumenUrls;
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
    name: "seed-beam16-depth4-hold",
    queue: "TILJSZOT",
    hold: true,
    beamWidth: 16,
    maxDepth: 4,
    tags: ["smoke", "hold"]
  },
  {
    name: "seed-beam64-depth5-hold",
    queue: "TILJSZOTIL",
    hold: true,
    beamWidth: 64,
    maxDepth: 5,
    tags: ["baseline", "hold"]
  },
  {
    name: "seed-beam64-depth5-no-hold",
    queue: "TILJSZOTIL",
    hold: false,
    beamWidth: 64,
    maxDepth: 5,
    tags: ["control", "no-hold"]
  },
  {
    name: "seed-beam128-depth6-hold",
    queue: "TILJSZOTILJ",
    hold: true,
    beamWidth: 128,
    maxDepth: 6,
    iterations: 3,
    tags: ["wider", "hold"]
  }
];

export function runOpenerExperiment(input: RunOpenerExperimentInput): OpenerExperimentReport {
  if (input.scenarios.length === 0) {
    throw new Error("At least one opener experiment scenario is required.");
  }

  const clock = input.clock ?? systemClock;
  const search = input.search ?? searchOpenerBeam;
  const fumenCodec = input.fumenCodec ?? createFumenCodec();
  const environment = input.environment ?? { runtime: "bun", nativeProfile: "release" };

  return {
    generatedAt: clock.isoNow(),
    engine: "native-rust-beam",
    environment,
    scenarios: input.scenarios.map((scenario) => runScenario(scenario, input.top ?? 5, search, fumenCodec, clock))
  };
}

export function renderOpenerExperimentMarkdown(report: OpenerExperimentReport): string {
  const lines = [
    "# Opener experiment",
    "",
    `Generated: ${report.generatedAt}`,
    `Engine: ${report.engine}`,
    `Runtime: ${report.environment.runtime}`,
    `Native: ${report.environment.nativeProfile}`,
    "",
    "| scenario | queue | hold | beam | depth | median ms | searches/s | result nodes | top score | holes | bumpiness | preview |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |"
  ];

  for (const scenario of report.scenarios) {
    const top = scenario.top[0];
    lines.push(
      [
        scenario.name,
        scenario.queue,
        String(scenario.hold),
        String(scenario.beamWidth),
        String(scenario.maxDepth),
        scenario.medianMs.toFixed(3),
        scenario.searchesPerSecond.toFixed(1),
        String(scenario.resultCount),
        top?.score.toFixed(1) ?? "",
        String(top?.holes ?? ""),
        String(top?.bumpiness ?? ""),
        top === undefined ? "" : `[fumen](${top.previewUrl})`
      ].join(" | ")
    );
  }

  lines.push("", "## Top templates", "");
  for (const scenario of report.scenarios) {
    lines.push(`### ${scenario.name}`, "");
    if (scenario.top.length === 0) {
      lines.push("No candidates.", "");
      continue;
    }

    lines.push("| rank | score | path | preview URL |", "| ---: | ---: | --- | --- |");
    for (const candidate of scenario.top) {
      lines.push(
        [String(candidate.rank), candidate.score.toFixed(1), candidate.path.join(" "), `[fumen](${candidate.previewUrl})`].join(" | ")
      );
    }
    lines.push("");
  }

  lines.push("");
  return lines.join("\n");
}

function runScenario(
  scenario: OpenerExperimentScenario,
  defaultTop: number,
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
    top: createTopCandidates(lastNodes, scenario, scenario.top ?? defaultTop, fumenCodec),
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
  return nodes.slice(0, topCount).map((node, index) => {
    const data = fumenCodec.encodePages(createOpenerFumenPages(node, { title: `${scenario.name} #${index + 1}` }));
    const urls = fumenCodec.createUrls(data);
    return {
      rank: index + 1,
      score: node.score,
      path: node.path,
      previewUrl: urls.view,
      hold: node.hold ?? null,
      queueIndex: node.queueIndex,
      occupiedCells: node.occupiedCells,
      clearedLines: node.clearedLines,
      aggregateHeight: node.aggregateHeight,
      holes: node.holes,
      bumpiness: node.bumpiness,
      urls
    };
  });
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
