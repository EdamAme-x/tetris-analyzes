import { createFumenCodec } from "../infrastructure/fumen/tetris-fumen-codec";
import type { FumenCodec, FumenUrls } from "../domain/fumen";
import type { NativeComboTable, NativeKickTable, NativeSpinMode } from "../infrastructure/native/binding-types";
import { createOpenerFumenPages } from "./create-opener-fumen";
import {
  estimateOpenerTSpinPotential,
  searchOpenerBeamWithPlacements,
  type SearchOpenerBeamInput,
  type SearchOpenerBeamNode
} from "./search-opener";

export interface OpenerExperimentSearchRules {
  readonly spinMode: NativeSpinMode;
  readonly comboTable: NativeComboTable;
  readonly kickTable: NativeKickTable;
}

export interface OpenerExperimentScenario {
  readonly name: string;
  readonly queue: string;
  readonly hold: boolean;
  readonly beamWidth: number;
  readonly maxDepth: number;
  readonly rules?: OpenerExperimentSearchRules;
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
  readonly difficultAttack: number;
  readonly nonDifficultAttack: number;
  readonly points: number;
  readonly maxCombo: number;
  readonly backToBackChain: number;
  readonly allClears: number;
  readonly difficultClears: number;
  readonly tSpinClears: number;
  readonly tSpinAttack: number;
  readonly tSpinPotential: number;
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
  readonly rules: OpenerExperimentSearchRules;
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

const TWO_BAG_TL_SURVEY_QUEUES = [
  ["seed-szilojt", "SZILOJTSTOZLJI"],
  ["seed-tiljszo", "TILJSZOTILJSZO"],
  ["seed-tjlziso", "TJLZISOTJLZISO"],
  ["seed-tsljzio", "TSLJZIOTSLJZIO"],
  ["seed-jlstzio", "JLSTZIOTJLSTZIO"],
  ["seed-stziljo", "STZILJOTSTZILJO"],
  ["seed-lstzjio", "LSTZJIOOLSTZJI"]
] as const;

export const TETRIO_TL_OPENER_SEARCH_RULES = {
  spinMode: "T-SPINS",
  comboTable: "MULTIPLIER",
  kickTable: "SRS+"
} as const satisfies OpenerExperimentSearchRules;

export const DEFAULT_OPENER_EXPERIMENT_SCENARIOS: readonly OpenerExperimentScenario[] = [
  {
    name: "best-two-bag-tspin-openers",
    queue: "SZILOJTSTOZLJI",
    hold: true,
    beamWidth: 1024,
    maxDepth: 14,
    rules: TETRIO_TL_OPENER_SEARCH_RULES,
    iterations: 1,
    top: 8,
    tags: ["best", "hold", "two-bag", "t-spin", "tetrio-tl"]
  }
];

export const SURVEY_OPENER_EXPERIMENT_SCENARIOS: readonly OpenerExperimentScenario[] = TWO_BAG_TL_SURVEY_QUEUES.map(([name, queue]) => ({
  name,
  queue,
  hold: true,
  beamWidth: 1024,
  maxDepth: 14,
  rules: TETRIO_TL_OPENER_SEARCH_RULES,
  warmups: 0,
  iterations: 1,
  top: 3,
  tags: ["survey", "hold", "two-bag", "t-spin", "tetrio-tl"]
}));

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
    `Rules: ${formatReportRules(report.scenarios)}`,
    "",
    "## Best openers",
    "",
    "| rank | attack | difficult attack | other attack | tspin | tspin attack | b2b | tspin potential | points | score | holes | bumpiness | clears | path | preview |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |"
  ];

  for (const candidate of bestCandidates) {
    lines.push(
      [
        String(candidate.rank),
        String(candidate.attack),
        String(candidate.difficultAttack),
        String(candidate.nonDifficultAttack),
        String(candidate.tSpinClears),
        String(candidate.tSpinAttack),
        String(candidate.backToBackChain),
        String(candidate.tSpinPotential),
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
    "| name | queue | hold | spins | combo | kicks | beam | depth | median ms | searches/s | nodes |",
    "| --- | --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |"
  );

  for (const scenario of report.scenarios) {
    lines.push(
      [
        scenario.name,
        scenario.queue,
        String(scenario.hold),
        scenario.rules.spinMode,
        scenario.rules.comboTable,
        scenario.rules.kickTable,
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
      "| rank | attack | difficult attack | other attack | tspin | tspin attack | b2b | tspin potential | points | score | holes | bumpiness | clears | path | preview |",
      "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |"
    );
    for (const candidate of scenario.top) {
      lines.push(
        [
          String(candidate.rank),
          String(candidate.attack),
          String(candidate.difficultAttack),
          String(candidate.nonDifficultAttack),
          String(candidate.tSpinClears),
          String(candidate.tSpinAttack),
          String(candidate.backToBackChain),
          String(candidate.tSpinPotential),
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
      `#${candidate.rank} attack=${candidate.attack} difficultAttack=${candidate.difficultAttack} otherAttack=${candidate.nonDifficultAttack} tspin=${candidate.tSpinClears} tspinAttack=${candidate.tSpinAttack} b2b=${candidate.backToBackChain} tspinPotential=${candidate.tSpinPotential} points=${candidate.points} score=${candidate.score.toFixed(1)} holes=${candidate.holes} bump=${candidate.bumpiness}`,
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
  const rules = scenarioRules(scenario);
  return {
    name: scenario.name,
    queue: scenario.queue,
    hold: scenario.hold,
    rules,
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
  const rules = scenarioRules(scenario);
  return {
    queue: scenario.queue,
    beamWidth: scenario.beamWidth,
    hold: scenario.hold,
    maxDepth: scenario.maxDepth,
    spinMode: rules.spinMode,
    comboTable: rules.comboTable,
    kickTable: rules.kickTable
  };
}

function scenarioRules(scenario: OpenerExperimentScenario): OpenerExperimentSearchRules {
  return scenario.rules ?? TETRIO_TL_OPENER_SEARCH_RULES;
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
      const qualityAttack = difficultAttack(node);
      const rules = scenarioRules(scenario);
      return {
        rank: index + 1,
        score: node.score,
        firepowerScore: node.firepowerScore,
        path: node.path,
        previewUrl: urls.view,
        hold: node.hold ?? null,
        queueIndex: node.queueIndex,
        attack: node.attack,
        difficultAttack: qualityAttack,
        nonDifficultAttack: node.attack - qualityAttack,
        points: node.points,
        maxCombo: node.maxCombo,
        backToBackChain: node.backToBackChain,
        allClears: node.allClears,
        difficultClears: node.difficultClears,
        tSpinClears: node.tSpinClears,
        tSpinAttack: node.tSpinAttack,
        tSpinPotential: estimateOpenerTSpinPotential(Uint16Array.from(node.rows), rules.kickTable),
        clearSequence: node.placements
          .filter((placement) => placement.clearName !== "NONE" && placement.clearedLines > 0)
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
    right.backToBackChain - left.backToBackChain ||
    difficultAttack(right) - difficultAttack(left) ||
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
    right.backToBackChain - left.backToBackChain ||
    right.difficultClears - left.difficultClears ||
    right.difficultAttack - left.difficultAttack ||
    right.tSpinPotential - left.tSpinPotential ||
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

function difficultAttack(node: SearchOpenerBeamNode): number {
  return node.placements
    .filter((placement) => placement.clearedLines > 0 && isDifficultClearName(placement.clearName))
    .reduce((attack, placement) => attack + placement.attack, 0);
}

function isDifficultClearName(clearName: string): boolean {
  return (
    clearName === "QUAD" ||
    clearName === "PENTA" ||
    clearName === "TSPIN_SINGLE" ||
    clearName === "TSPIN_DOUBLE" ||
    clearName === "TSPIN_TRIPLE" ||
    clearName === "TSPIN_QUAD" ||
    clearName === "TSPIN_PENTA" ||
    clearName === "TSPIN_MINI_QUAD"
  );
}

function formatClearSequence(clearSequence: readonly string[]): string {
  return clearSequence.length === 0 ? "-" : clearSequence.join(" ");
}

function formatRules(rules: OpenerExperimentSearchRules): string {
  return `spins=${rules.spinMode}, combo=${rules.comboTable}, kicks=${rules.kickTable}`;
}

function formatReportRules(scenarios: readonly OpenerExperimentScenarioResult[]): string {
  const first = scenarios[0];
  if (first === undefined) {
    return formatRules(TETRIO_TL_OPENER_SEARCH_RULES);
  }
  if (scenarios.every((scenario) => rulesEqual(scenario.rules, first.rules))) {
    return formatRules(first.rules);
  }
  return "mixed (see Search run)";
}

function rulesEqual(left: OpenerExperimentSearchRules, right: OpenerExperimentSearchRules): boolean {
  return left.spinMode === right.spinMode && left.comboTable === right.comboTable && left.kickTable === right.kickTable;
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
