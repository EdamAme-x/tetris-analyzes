import { createFumenCodec } from "../infrastructure/fumen/tetris-fumen-codec";
import { BOARD_HEIGHT, BOARD_WIDTH, ROW_MASK } from "../domain/board";
import type { FumenCodec, FumenUrls } from "../domain/fumen";
import type { NativeComboTable, NativeKickTable, NativeSpinMode } from "../infrastructure/native/binding-types";
import { createOpenerFumenPages } from "./create-opener-fumen";
import {
  searchOpenerBeam,
  searchOpenerBeamCompact,
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
  readonly setupPoolMultiplier?: number;
  readonly rules?: OpenerExperimentSearchRules;
  readonly qualityGate?: OpenerExperimentQualityGate;
  readonly warmups?: number;
  readonly iterations?: number;
  readonly top?: number;
  readonly tags?: readonly string[];
}

export interface OpenerExperimentQualityGate {
  readonly minQueueIndex?: number;
  readonly minAttack?: number;
  readonly minDifficultAttack?: number;
  readonly minTSpinClears?: number;
  readonly minTSpinAttack?: number;
  readonly minBackToBackChain?: number;
  readonly maxHoles?: number;
}

export interface OpenerExperimentEnvironment {
  readonly runtime: string;
  readonly nativeProfile: string;
}

export interface OpenerExperimentCandidate {
  readonly rank: number;
  readonly score: number;
  readonly firepowerScore: number;
  readonly finalRows: readonly number[];
  readonly path: readonly string[];
  readonly previewUrl: string;
  readonly hold: string | null;
  readonly queueIndex: number;
  readonly attack: number;
  readonly difficultAttack: number;
  readonly nonDifficultAttack: number;
  readonly points: number;
  readonly combo: number;
  readonly maxCombo: number;
  readonly backToBackChain: number;
  readonly allClears: number;
  readonly difficultClears: number;
  readonly spinClears: number;
  readonly spinAttack: number;
  readonly tSpinClears: number;
  readonly tSpinAttack: number;
  readonly tSpinPotential: number;
  readonly phaseTemplateKey: string;
  readonly phaseProfileKey: string;
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
  readonly survivalCount: number;
  readonly survivalRate: number;
}

export interface RankedOpenerTemplate {
  readonly rank: number;
  readonly key: string;
  readonly survivalCount: number;
  readonly survivalRate: number;
  readonly sources: readonly string[];
  readonly phaseTemplateKeys: readonly string[];
  readonly phaseProfileKeys: readonly string[];
  readonly best: RankedOpenerCandidate;
}

export interface OpenerTemplateReplayHit {
  readonly scenario: string;
  readonly queue: string;
  readonly rank: number;
  readonly score?: number;
  readonly attack?: number;
  readonly difficultAttack?: number;
  readonly spinClears?: number;
  readonly spinAttack?: number;
  readonly tSpinClears?: number;
  readonly tSpinAttack?: number;
  readonly backToBackChain?: number;
  readonly tSpinPotential?: number;
  readonly path?: readonly string[];
  readonly clearSequence?: readonly string[];
  readonly cached: boolean;
}

export interface OpenerTemplateReplayEntry {
  readonly rank: number;
  readonly key: string;
  readonly groupedSurvivalCount: number;
  readonly groupedScenarioCount: number;
  readonly groupedSurvivalRate: number;
  readonly replayScenarioCount: number;
  readonly replayHitCount: number;
  readonly replayHitRate: number;
  readonly phaseReplayHitCount: number;
  readonly phaseReplayHitRate: number;
  readonly phaseProfileReplayHitCount: number;
  readonly phaseProfileReplayHitRate: number;
  readonly qualityReplayHitCount: number;
  readonly qualityReplayHitRate: number;
  readonly sources: readonly string[];
  readonly best: RankedOpenerCandidate;
  readonly hits: readonly OpenerTemplateReplayHit[];
}

export interface OpenerTemplateReplayReport {
  readonly topTemplateCount: number;
  readonly replayScenarioCount: number;
  readonly templates: readonly OpenerTemplateReplayEntry[];
}

export interface OpenerExperimentScenarioResult {
  readonly name: string;
  readonly queue: string;
  readonly hold: boolean;
  readonly rules: OpenerExperimentSearchRules;
  readonly beamWidth: number;
  readonly maxDepth: number;
  readonly setupPoolMultiplier?: number;
  readonly qualityGate?: OpenerExperimentQualityGate;
  readonly warmups: number;
  readonly iterations: number;
  readonly resultCount: number;
  readonly medianMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly searchesPerSecond: number;
  readonly reachableTemplates: readonly OpenerScenarioReachableTemplate[];
  readonly reachableTemplatePhases: readonly OpenerScenarioReachablePhase[];
  readonly reachablePhaseFrontiers: readonly OpenerScenarioReachablePhaseFrontier[];
  readonly reachableQualities: readonly OpenerScenarioReachableQuality[];
  readonly top: readonly OpenerExperimentCandidate[];
  readonly tags: readonly string[];
}

export interface OpenerScenarioReachableTemplate {
  readonly key: string;
  readonly rank: number;
}

export interface OpenerScenarioReachablePhase {
  readonly key: string;
  readonly phaseKey: string;
  readonly phaseProfileKey: string;
  readonly rank: number;
}

export interface OpenerScenarioReachablePhaseFrontier {
  readonly phaseKey: string;
  readonly phaseProfileKey: string;
  readonly rank: number;
}

export interface OpenerScenarioReachableQuality {
  readonly rank: number;
  readonly queueIndex: number;
  readonly difficultAttack: number;
  readonly spinClears: number;
  readonly spinAttack: number;
  readonly tSpinClears: number;
  readonly tSpinAttack: number;
  readonly backToBackChain: number;
  readonly combo: number;
  readonly tSpinPotential: number;
  readonly holes: number;
}

export interface OpenerExperimentReport {
  readonly generatedAt: string;
  readonly engine: "native-rust-beam";
  readonly environment: OpenerExperimentEnvironment;
  readonly scenarios: readonly OpenerExperimentScenarioResult[];
  readonly templateReplay?: OpenerTemplateReplayReport;
}

export interface OpenerExperimentClock {
  nowMs(): number;
  isoNow(): string;
}

export type OpenerSearch = (input: SearchOpenerBeamInput) => SearchOpenerBeamNode[];

interface SearchNodeWithReportPotential {
  readonly node: SearchOpenerBeamNode;
  readonly tSpinPotential: number;
}

interface TemplateStateKeyInput {
  readonly rows: readonly number[];
  readonly hold: string | null;
  readonly queueIndex: number;
  readonly backToBackChain: number;
  readonly combo: number;
}

interface PhaseStateKeys {
  readonly phaseKey: string;
  readonly phaseProfileKey: string;
}

export interface RunOpenerExperimentInput {
  readonly scenarios: readonly OpenerExperimentScenario[];
  readonly environment?: OpenerExperimentEnvironment;
  readonly clock?: OpenerExperimentClock;
  readonly search?: OpenerSearch;
  readonly detailSearch?: OpenerSearch;
  readonly replaySearch?: OpenerSearch;
  readonly fumenCodec?: FumenCodec;
  readonly top?: number;
  readonly templateReplay?: OpenerTemplateReplayInput;
}

export interface OpenerTemplateReplayInput {
  readonly scenarios: readonly OpenerExperimentScenario[];
  readonly topTemplates?: number;
}

export interface TemplateReplayScenarioOptions {
  readonly bagCount?: number;
  readonly beamWidth?: number;
  readonly maxDepth?: number;
  readonly sampleOffset?: number;
}

const TWO_BAG_TL_SURVEY_QUEUES = [
  ["seed-szilojt", "SZILOJTSTOZLJI"],
  ["seed-tiljszo", "TILJSZOTILJSZO"],
  ["seed-tjlziso", "TJLZISOTJLZISO"],
  ["seed-tsljzio", "TSLJZIOTSLJZIO"],
  ["seed-jlstzio", "JLSTZIOJLSTZIO"],
  ["seed-stziljo", "STZILJOSTZILJO"],
  ["seed-lstzjio", "LSTZJIOOLSTZJI"]
] as const;
const DISCOVERY_TWO_BAG_SAMPLE_SIZE = 24;
const DISCOVERY_BAG = "TIJLOSZ";
const CONTINUATION_THREE_BAG_QUEUES = [
  ["discover-01", "TIJLOSZTIZJLSOTJSZIOL"],
  ["discover-02", "TJSIZOLTSILJOZITSOJLZ"],
  ["discover-04", "TSZLJOIISLOZTJJSLZOTI"],
  ["discover-06", "ILJTOZSJZTIOLSOJLISTZ"],
  ["discover-09", "JITSZLOOJSLZITZSIJOLT"],
  ["discover-11", "JSLTOIZSLITOZJIOTZLSJ"],
  ["discover-13", "LISOTJZZLOJTSILITOJZS"],
  ["discover-14", "LOISZJTTIZSJLOOTIJLSZ"],
  ["discover-19", "OZJSTILJZTSIOLITSOJZL"],
  ["discover-21", "SJZTOILLZOTSJIJSLZOIT"],
  ["discover-23", "ZTIOLJSSTIOLZJOJLISZT"],
  ["discover-24", "ZIOSTLJSLIZJTOSILTOJZ"],
  ["discover-27", "TISLZJOTJIOZSLTSJIZOL"],
  ["discover-28", "TLJSOZITSJOZILIOTZSJL"],
  ["discover-71", "STZLJIOJZOLISTIZOJLST"],
  ["discover-75", "ZILJSTOSTOJZLISILTZOJ"],
  ["discover-77", "ZOLSITJZITSLOJZSILJOT"],
  ["discover-83", "ILSTOJZJLSTOZIOSZLIJT"],
  ["discover-86", "JIOSZLTOTJZILSTJZILOS"],
  ["discover-88", "JSZTLOISTZIOJLIZOJSTL"],
  ["discover-92", "LZISOJTTJZILOSSILJTOZ"],
  ["discover-93", "OITJZLSTZIJSOLZTJSOLI"],
  ["discover-96", "OZSLTJIJLSZITOIOJTSLZ"]
] as const;
const DEFAULT_TWO_BAG_QUALITY_GATE = {
  minQueueIndex: 14,
  minAttack: 9,
  minDifficultAttack: 9,
  minTSpinClears: 2,
  minTSpinAttack: 9,
  minBackToBackChain: 2,
  maxHoles: 0
} as const satisfies OpenerExperimentQualityGate;
const SURVEY_TWO_BAG_QUALITY_GATE = {
  minQueueIndex: 14,
  minAttack: 4,
  minDifficultAttack: 4,
  minTSpinClears: 1,
  minTSpinAttack: 2,
  minBackToBackChain: 1
} as const satisfies OpenerExperimentQualityGate;
const CONTINUATION_QUALITY_GATE = {
  minQueueIndex: 21,
  minAttack: 9,
  minDifficultAttack: 9,
  minTSpinClears: 2,
  minTSpinAttack: 7,
  minBackToBackChain: 2,
  maxHoles: 0
} as const satisfies OpenerExperimentQualityGate;

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
    beamWidth: 512,
    maxDepth: 14,
    rules: TETRIO_TL_OPENER_SEARCH_RULES,
    qualityGate: DEFAULT_TWO_BAG_QUALITY_GATE,
    iterations: 1,
    top: 8,
    tags: ["best", "hold", "two-bag", "t-spin", "tetrio-tl"]
  }
];

export const SURVEY_OPENER_EXPERIMENT_SCENARIOS: readonly OpenerExperimentScenario[] = TWO_BAG_TL_SURVEY_QUEUES.map(([name, queue]) => ({
  name,
  queue,
  hold: true,
  beamWidth: 512,
  maxDepth: 14,
  rules: TETRIO_TL_OPENER_SEARCH_RULES,
  qualityGate: SURVEY_TWO_BAG_QUALITY_GATE,
  warmups: 0,
  iterations: 1,
  top: 3,
  tags: ["survey", "hold", "two-bag", "t-spin", "tetrio-tl"]
}));

export const CONTINUATION_OPENER_EXPERIMENT_SCENARIOS: readonly OpenerExperimentScenario[] = CONTINUATION_THREE_BAG_QUEUES.map(
  ([name, queue]) => ({
    name: `continuation-${name}`,
    queue,
    hold: true,
    beamWidth: 256,
    maxDepth: 21,
    rules: TETRIO_TL_OPENER_SEARCH_RULES,
    qualityGate: CONTINUATION_QUALITY_GATE,
    warmups: 0,
    iterations: 1,
    top: 2,
    tags: ["continuation", "hold", "three-bag", "t-spin", "tetrio-tl"]
  })
);

export const DISCOVERY_OPENER_EXPERIMENT_SCENARIOS: readonly OpenerExperimentScenario[] = createDiscoveryTwoBagQueues(
  DISCOVERY_TWO_BAG_SAMPLE_SIZE
).map((queue, index) => ({
  name: `discover-${String(index + 1).padStart(2, "0")}`,
  queue,
  hold: true,
  beamWidth: 512,
  maxDepth: 14,
  rules: TETRIO_TL_OPENER_SEARCH_RULES,
  warmups: 0,
  iterations: 1,
  top: 1,
  tags: ["discovery", "hold", "two-bag", "t-spin", "tetrio-tl"]
}));

export function createTemplateReplayScenarios(sampleSize: number, options: TemplateReplayScenarioOptions = {}): OpenerExperimentScenario[] {
  if (!Number.isInteger(sampleSize) || sampleSize < 0) {
    throw new Error("Template replay sample size must be a non-negative integer.");
  }
  const bagCount = options.bagCount ?? 2;
  if (!Number.isInteger(bagCount) || bagCount <= 0) {
    throw new Error("Template replay bagCount must be a positive integer.");
  }
  const maxDepth = options.maxDepth ?? bagCount * DISCOVERY_BAG.length;
  const beamWidth = options.beamWidth ?? (bagCount >= 3 ? 256 : 512);
  const bagTag = bagCountTag(bagCount);
  return createDiscoveryBagQueues(sampleSize, bagCount, options.sampleOffset ?? 0).map((queue, index) => ({
    name: `replay-${String(index + 1).padStart(2, "0")}`,
    queue,
    hold: true,
    beamWidth,
    maxDepth,
    rules: TETRIO_TL_OPENER_SEARCH_RULES,
    warmups: 0,
    iterations: 1,
    top: 1,
    tags: ["replay", "hold", bagTag, "t-spin", "tetrio-tl"]
  }));
}

export function runOpenerExperiment(input: RunOpenerExperimentInput): OpenerExperimentReport {
  if (input.scenarios.length === 0) {
    throw new Error("At least one opener experiment scenario is required.");
  }

  const clock = input.clock ?? systemClock;
  const search = input.search ?? searchOpenerBeam;
  const detailSearch = input.detailSearch ?? (input.search === undefined ? searchOpenerBeamWithPlacements : undefined);
  const replaySearch = input.replaySearch ?? (input.search === undefined ? searchOpenerBeamCompact : search);
  const fumenCodec = input.fumenCodec ?? createFumenCodec();
  const environment = input.environment ?? { runtime: "bun", nativeProfile: "release" };
  const scenarios = input.scenarios.map((scenario) => runScenario(scenario, input.top, search, detailSearch, fumenCodec, clock));
  const reportWithoutReplay: OpenerExperimentReport = {
    generatedAt: clock.isoNow(),
    engine: "native-rust-beam",
    environment,
    scenarios
  };
  const templateReplay =
    input.templateReplay === undefined
      ? undefined
      : replayOpenerTemplateSurvivability(reportWithoutReplay, input.templateReplay, replaySearch);

  return {
    ...reportWithoutReplay,
    ...(templateReplay === undefined ? {} : { templateReplay })
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
    "| rank | survival | source | attack | difficult attack | other attack | spin | spin attack | tspin | tspin attack | b2b | tspin potential | points | score | holes | bumpiness | clears | path | preview |",
    "| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |"
  ];

  for (const candidate of bestCandidates) {
    lines.push(
      [
        String(candidate.rank),
        formatSurvival(candidate),
        candidate.sourceScenario,
        String(candidate.attack),
        String(candidate.difficultAttack),
        String(candidate.nonDifficultAttack),
        String(candidate.spinClears),
        String(candidate.spinAttack),
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
    "## Template survivability",
    "",
    "| rank | survival | sources | attack | difficult attack | spin | tspin | b2b | holes | bumpiness | clears | preview |",
    "| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |"
  );
  for (const template of rankOpenerTemplates(report, 12)) {
    lines.push(
      [
        String(template.rank),
        formatTemplateSurvival(template),
        template.sources.join(" "),
        String(template.best.attack),
        String(template.best.difficultAttack),
        String(template.best.spinClears),
        String(template.best.tSpinClears),
        String(template.best.backToBackChain),
        String(template.best.holes),
        String(template.best.bumpiness),
        formatClearSequence(template.best.clearSequence),
        `[view](${template.best.previewUrl})`
      ].join(" | ")
    );
  }

  if (report.templateReplay !== undefined) {
    lines.push(
      "",
      "## Template replay",
      "",
      "| rank | replay hits | phase hits | profile hits | quality hits | grouped survival | sources | attack | difficult attack | spin | spin attack | tspin | tspin attack | b2b | best replay rank | clears | preview |",
      "| ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |"
    );
    for (const template of report.templateReplay.templates.slice(0, 12)) {
      lines.push(
        [
          String(template.rank),
          formatReplaySurvival(template),
          formatPhaseReplaySurvival(template),
          formatPhaseProfileReplaySurvival(template),
          formatQualityReplaySurvival(template),
          formatGroupedReplaySurvival(template),
          template.sources.join(" "),
          String(template.best.attack),
          String(template.best.difficultAttack),
          String(template.best.spinClears),
          String(template.best.spinAttack),
          String(template.best.tSpinClears),
          String(template.best.tSpinAttack),
          String(template.best.backToBackChain),
          String(template.hits[0]?.rank ?? "-"),
          formatClearSequence(template.best.clearSequence),
          `[view](${template.best.previewUrl})`
        ].join(" | ")
      );
    }
  }

  lines.push(
    "",
    "## Search run",
    "",
    "| name | queue | hold | spins | combo | kicks | beam | depth | setup pool | median ms | searches/s | nodes | quality gate |",
    "| --- | --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |"
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
        String(scenario.setupPoolMultiplier ?? 14),
        scenario.medianMs.toFixed(3),
        scenario.searchesPerSecond.toFixed(1),
        String(scenario.resultCount),
        formatQualityGate(scenario.qualityGate)
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
      "| rank | queue index | hold | attack | difficult attack | other attack | spin | spin attack | tspin | tspin attack | b2b | tspin potential | points | score | holes | bumpiness | clears | path | preview |",
      "| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |"
    );
    for (const candidate of scenario.top) {
      lines.push(
        [
          String(candidate.rank),
          String(candidate.queueIndex),
          candidate.hold ?? "-",
          String(candidate.attack),
          String(candidate.difficultAttack),
          String(candidate.nonDifficultAttack),
          String(candidate.spinClears),
          String(candidate.spinAttack),
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
  if (report.templateReplay !== undefined) {
    const lines = ["Best opener templates (replayed)", ""];
    for (const template of report.templateReplay.templates.slice(0, topCount)) {
      const candidate = template.best;
      lines.push(
        `#${template.rank} sources=${template.sources.join(",")} replay=${formatReplaySurvival(template)} phase=${formatPhaseReplaySurvival(template)} profile=${formatPhaseProfileReplaySurvival(template)} quality=${formatQualityReplaySurvival(template)} grouped=${formatGroupedReplaySurvival(template)} queueIndex=${candidate.queueIndex} hold=${candidate.hold ?? "-"} attack=${candidate.attack} difficultAttack=${candidate.difficultAttack} otherAttack=${candidate.nonDifficultAttack} spin=${candidate.spinClears} spinAttack=${candidate.spinAttack} tspin=${candidate.tSpinClears} tspinAttack=${candidate.tSpinAttack} b2b=${candidate.backToBackChain} tspinPotential=${candidate.tSpinPotential} points=${candidate.points} score=${candidate.score.toFixed(1)} holes=${candidate.holes} bump=${candidate.bumpiness}`,
        `clears: ${formatClearSequence(candidate.clearSequence)}`,
        `path: ${candidate.path.join(" ")}`,
        `view: ${candidate.previewUrl}`,
        ""
      );
    }
    return lines.join("\n").trimEnd();
  }

  const lines = ["Best opener templates", ""];
  for (const template of rankOpenerTemplates(report, topCount)) {
    const candidate = template.best;
    lines.push(
      `#${template.rank} sources=${template.sources.join(",")} survival=${formatTemplateSurvival(template)} queueIndex=${candidate.queueIndex} hold=${candidate.hold ?? "-"} attack=${candidate.attack} difficultAttack=${candidate.difficultAttack} otherAttack=${candidate.nonDifficultAttack} spin=${candidate.spinClears} spinAttack=${candidate.spinAttack} tspin=${candidate.tSpinClears} tspinAttack=${candidate.tSpinAttack} b2b=${candidate.backToBackChain} tspinPotential=${candidate.tSpinPotential} points=${candidate.points} score=${candidate.score.toFixed(1)} holes=${candidate.holes} bump=${candidate.bumpiness}`,
      `clears: ${formatClearSequence(candidate.clearSequence)}`,
      `path: ${candidate.path.join(" ")}`,
      `view: ${candidate.previewUrl}`,
      ""
    );
  }
  return lines.join("\n").trimEnd();
}

export function rankOpenerCandidates(report: OpenerExperimentReport, topCount: number): RankedOpenerCandidate[] {
  const survivalByTemplate = countTemplateSurvivors(report);
  return report.scenarios
    .flatMap((scenario) =>
      scenario.top
        .filter((candidate) => candidateMeetsQualityGate(candidate, scenario.qualityGate))
        .map((candidate) => ({
          ...candidate,
          sourceScenario: scenario.name,
          survivalCount: survivalByTemplate.get(templateKey(candidate)) ?? 1,
          survivalRate: (survivalByTemplate.get(templateKey(candidate)) ?? 1) / report.scenarios.length
        }))
    )
    .sort(compareRankedOpenerCandidates)
    .slice(0, topCount)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

export function rankOpenerTemplates(report: OpenerExperimentReport, topCount: number): RankedOpenerTemplate[] {
  const phaseKeysByTemplate = collectReachablePhaseKeysByTemplate(report);
  const phaseProfileKeysByTemplate = collectReachablePhaseProfileKeysByTemplate(report);
  const byKey = new Map<
    string,
    { best: RankedOpenerCandidate; sources: Set<string>; phaseKeys: Set<string>; phaseProfileKeys: Set<string> }
  >();
  for (const candidate of rankOpenerCandidates(report, Number.MAX_SAFE_INTEGER)) {
    const key = templateKey(candidate);
    const current = byKey.get(key);
    if (current === undefined) {
      byKey.set(key, {
        best: candidate,
        sources: new Set([candidate.sourceScenario]),
        phaseKeys: new Set(phaseKeysByTemplate.get(key) ?? [candidate.phaseTemplateKey]),
        phaseProfileKeys: new Set(phaseProfileKeysByTemplate.get(key) ?? [candidate.phaseProfileKey])
      });
      continue;
    }
    current.sources.add(candidate.sourceScenario);
    for (const phaseKey of phaseKeysByTemplate.get(key) ?? [candidate.phaseTemplateKey]) {
      current.phaseKeys.add(phaseKey);
    }
    for (const profileKey of phaseProfileKeysByTemplate.get(key) ?? [candidate.phaseProfileKey]) {
      current.phaseProfileKeys.add(profileKey);
    }
    if (compareRankedOpenerCandidates(candidate, current.best) < 0) {
      current.best = candidate;
    }
  }

  return [...byKey.entries()]
    .map(([key, group]) => ({
      rank: 0,
      key,
      survivalCount: group.sources.size,
      survivalRate: group.sources.size / report.scenarios.length,
      sources: [...group.sources].sort(),
      phaseTemplateKeys: [...group.phaseKeys].sort(),
      phaseProfileKeys: [...group.phaseProfileKeys].sort(),
      best: group.best
    }))
    .sort(compareRankedOpenerTemplates)
    .slice(0, topCount)
    .map((template, index) => ({ ...template, rank: index + 1 }));
}

export function replayOpenerTemplateSurvivability(
  report: OpenerExperimentReport,
  input: OpenerTemplateReplayInput,
  search: OpenerSearch = searchOpenerBeamWithPlacements
): OpenerTemplateReplayReport {
  const topTemplateCount = input.topTemplates ?? 5;
  if (!Number.isInteger(topTemplateCount) || topTemplateCount <= 0) {
    throw new Error("Template replay topTemplates must be a positive integer.");
  }
  if (input.scenarios.length === 0) {
    return {
      topTemplateCount,
      replayScenarioCount: 0,
      templates: []
    };
  }

  const templates = rankOpenerTemplates(report, topTemplateCount);
  const hitsByTemplate = new Map<string, OpenerTemplateReplayHit[]>();
  const templateKeys = new Set(templates.map((template) => template.key));
  const phaseHitsByTemplate = new Map<string, Set<string>>();
  const phaseProfileHitsByTemplate = new Map<string, Set<string>>();
  const qualityHitsByTemplate = new Map<string, Set<string>>();
  const templateKeysByPhase = new Map<string, string[]>();
  const templateKeysByPhaseProfile = new Map<string, string[]>();
  for (const template of templates) {
    for (const phaseKey of template.phaseTemplateKeys) {
      templateKeysByPhase.set(phaseKey, [...(templateKeysByPhase.get(phaseKey) ?? []), template.key]);
    }
    for (const profileKey of template.phaseProfileKeys) {
      templateKeysByPhaseProfile.set(profileKey, [...(templateKeysByPhaseProfile.get(profileKey) ?? []), template.key]);
    }
  }
  const cachedScenarios = new Map(report.scenarios.map((scenario) => [scenarioResultSignature(scenario), scenario]));
  for (const scenario of input.scenarios) {
    const scenarioHits = new Set<string>();
    const scenarioPhaseHits = new Set<string>();
    const scenarioPhaseProfileHits = new Set<string>();
    const scenarioQualityHits = new Set<string>();
    const cachedScenario = cachedScenarios.get(scenarioSignature(scenario));
    if (cachedScenario !== undefined) {
      for (const reachablePhase of cachedScenario.reachableTemplatePhases) {
        addPhaseReplayHits(phaseHitsByTemplate, templateKeysByPhase, reachablePhase.phaseKey, scenario.name, scenarioPhaseHits);
        addPhaseReplayHits(
          phaseProfileHitsByTemplate,
          templateKeysByPhaseProfile,
          reachablePhase.phaseProfileKey,
          scenario.name,
          scenarioPhaseProfileHits
        );
      }
      for (const reachablePhase of cachedScenario.reachablePhaseFrontiers) {
        addPhaseReplayHits(phaseHitsByTemplate, templateKeysByPhase, reachablePhase.phaseKey, scenario.name, scenarioPhaseHits);
        addPhaseReplayHits(
          phaseProfileHitsByTemplate,
          templateKeysByPhaseProfile,
          reachablePhase.phaseProfileKey,
          scenario.name,
          scenarioPhaseProfileHits
        );
      }
      for (const reachablePhase of createReachablePhaseFrontiers(searchPhaseFrontierNodes(scenario, [], search), scenario)) {
        addPhaseReplayHits(phaseHitsByTemplate, templateKeysByPhase, reachablePhase.phaseKey, scenario.name, scenarioPhaseHits);
        addPhaseReplayHits(
          phaseProfileHitsByTemplate,
          templateKeysByPhaseProfile,
          reachablePhase.phaseProfileKey,
          scenario.name,
          scenarioPhaseProfileHits
        );
      }
      for (const quality of cachedScenario.reachableQualities) {
        addQualityReplayHits(qualityHitsByTemplate, templates, quality, scenario.name, scenarioQualityHits);
      }
      for (const reachableTemplate of cachedScenario.reachableTemplates) {
        const key = reachableTemplate.key;
        if (!templateKeys.has(key) || scenarioHits.has(key)) {
          continue;
        }
        scenarioHits.add(key);
        hitsByTemplate.set(key, [
          ...(hitsByTemplate.get(key) ?? []),
          {
            scenario: scenario.name,
            queue: scenario.queue,
            rank: reachableTemplate.rank,
            cached: true
          }
        ]);
      }
      continue;
    }

    const nodes = search(searchInput(scenario));
    for (const reachablePhase of createReachablePhaseFrontiers(searchPhaseFrontierNodes(scenario, nodes, search), scenario)) {
      addPhaseReplayHits(phaseHitsByTemplate, templateKeysByPhase, reachablePhase.phaseKey, scenario.name, scenarioPhaseHits);
      addPhaseReplayHits(
        phaseProfileHitsByTemplate,
        templateKeysByPhaseProfile,
        reachablePhase.phaseProfileKey,
        scenario.name,
        scenarioPhaseProfileHits
      );
    }
    for (const [index, node] of nodes.entries()) {
      const { phaseKey, phaseProfileKey } = searchNodePhaseKeys(node, scenario);
      addQualityReplayHits(qualityHitsByTemplate, templates, searchNodeQuality(node, index), scenario.name, scenarioQualityHits);
      addPhaseReplayHits(phaseHitsByTemplate, templateKeysByPhase, phaseKey, scenario.name, scenarioPhaseHits);
      addPhaseReplayHits(phaseProfileHitsByTemplate, templateKeysByPhaseProfile, phaseProfileKey, scenario.name, scenarioPhaseProfileHits);
      const key = searchNodeTemplateKey(node);
      if (!templateKeys.has(key) || scenarioHits.has(key)) {
        continue;
      }
      scenarioHits.add(key);
      hitsByTemplate.set(key, [
        ...(hitsByTemplate.get(key) ?? []),
        {
          scenario: scenario.name,
          queue: scenario.queue,
          rank: index + 1,
          score: node.score,
          attack: node.attack,
          difficultAttack: node.difficultAttack,
          spinClears: nodeSpinClears(node),
          spinAttack: nodeSpinAttack(node),
          tSpinClears: node.tSpinClears,
          tSpinAttack: node.tSpinAttack,
          backToBackChain: node.backToBackChain,
          tSpinPotential: node.tSpinPotential,
          path: node.path,
          clearSequence: clearSequence(node),
          cached: false
        }
      ]);
    }
  }

  return {
    topTemplateCount,
    replayScenarioCount: input.scenarios.length,
    templates: templates
      .map((template) => {
        const hits = hitsByTemplate.get(template.key) ?? [];
        return {
          rank: 0,
          key: template.key,
          groupedSurvivalCount: template.survivalCount,
          groupedScenarioCount: report.scenarios.length,
          groupedSurvivalRate: template.survivalRate,
          replayScenarioCount: input.scenarios.length,
          replayHitCount: hits.length,
          replayHitRate: hits.length / input.scenarios.length,
          phaseReplayHitCount: phaseHitsByTemplate.get(template.key)?.size ?? 0,
          phaseReplayHitRate: (phaseHitsByTemplate.get(template.key)?.size ?? 0) / input.scenarios.length,
          phaseProfileReplayHitCount: phaseProfileHitsByTemplate.get(template.key)?.size ?? 0,
          phaseProfileReplayHitRate: (phaseProfileHitsByTemplate.get(template.key)?.size ?? 0) / input.scenarios.length,
          qualityReplayHitCount: qualityHitsByTemplate.get(template.key)?.size ?? 0,
          qualityReplayHitRate: (qualityHitsByTemplate.get(template.key)?.size ?? 0) / input.scenarios.length,
          sources: template.sources,
          best: template.best,
          hits
        };
      })
      .sort(compareReplayTemplates)
      .map((template, index) => ({ ...template, rank: index + 1 }))
  };
}

function runScenario(
  scenario: OpenerExperimentScenario,
  topOverride: number | undefined,
  search: OpenerSearch,
  detailSearch: OpenerSearch | undefined,
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
  const detailedNodes = detailSearch === undefined ? lastNodes : detailSearch(searchInput(scenario));
  const topCandidates = createTopCandidates(detailedNodes, scenario, topOverride ?? scenario.top ?? 5, fumenCodec);
  assertScenarioQualityGate(scenario, topCandidates[0]);
  return {
    name: scenario.name,
    queue: scenario.queue,
    hold: scenario.hold,
    rules,
    beamWidth: scenario.beamWidth,
    maxDepth: scenario.maxDepth,
    ...(scenario.setupPoolMultiplier === undefined ? {} : { setupPoolMultiplier: scenario.setupPoolMultiplier }),
    ...(scenario.qualityGate === undefined ? {} : { qualityGate: scenario.qualityGate }),
    warmups,
    iterations,
    resultCount: lastNodes.length,
    medianMs: stats.median,
    minMs: stats.min,
    maxMs: stats.max,
    searchesPerSecond: stats.median === 0 ? 0 : 1_000 / stats.median,
    reachableTemplates: createReachableTemplates(lastNodes),
    reachableTemplatePhases: createReachableTemplatePhases(lastNodes, scenario),
    reachablePhaseFrontiers: createReachablePhaseFrontiers(lastNodes, scenario),
    reachableQualities: createReachableQualities(lastNodes),
    top: topCandidates,
    tags: scenario.tags ?? []
  };
}

function searchPhaseFrontierNodes(
  scenario: OpenerExperimentScenario,
  fallbackNodes: readonly SearchOpenerBeamNode[],
  search: OpenerSearch
): readonly SearchOpenerBeamNode[] {
  const phaseDepth = templatePhaseDepth(scenario.maxDepth);
  if (scenario.maxDepth < 21 || phaseDepth >= scenario.maxDepth) {
    return fallbackNodes;
  }
  return search(searchInput({ ...scenario, maxDepth: phaseDepth }));
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
    kickTable: rules.kickTable,
    ...(scenario.setupPoolMultiplier === undefined ? {} : { setupPoolMultiplier: scenario.setupPoolMultiplier })
  };
}

function scenarioRules(scenario: OpenerExperimentScenario): OpenerExperimentSearchRules {
  return scenario.rules ?? TETRIO_TL_OPENER_SEARCH_RULES;
}

function scenarioSignature(scenario: OpenerExperimentScenario): string {
  const rules = scenarioRules(scenario);
  return [
    scenario.queue,
    String(scenario.hold),
    String(scenario.beamWidth),
    String(scenario.maxDepth),
    String(scenario.setupPoolMultiplier ?? 14),
    formatRules(rules)
  ].join("|");
}

function scenarioResultSignature(scenario: OpenerExperimentScenarioResult): string {
  return [
    scenario.queue,
    String(scenario.hold),
    String(scenario.beamWidth),
    String(scenario.maxDepth),
    String(scenario.setupPoolMultiplier ?? 14),
    formatRules(scenario.rules)
  ].join("|");
}

function createReachableTemplates(nodes: readonly SearchOpenerBeamNode[]): OpenerScenarioReachableTemplate[] {
  const ranksByTemplate = new Map<string, number>();
  for (const [index, node] of nodes.entries()) {
    const key = searchNodeTemplateKey(node);
    if (!ranksByTemplate.has(key)) {
      ranksByTemplate.set(key, index + 1);
    }
  }
  return [...ranksByTemplate.entries()].map(([key, rank]) => ({ key, rank }));
}

function createReachableTemplatePhases(
  nodes: readonly SearchOpenerBeamNode[],
  scenario: OpenerExperimentScenario
): OpenerScenarioReachablePhase[] {
  const ranksByTemplatePhase = new Map<string, OpenerScenarioReachablePhase>();
  for (const [index, node] of nodes.entries()) {
    const key = searchNodeTemplateKey(node);
    const { phaseKey, phaseProfileKey } = searchNodePhaseKeys(node, scenario);
    const uniqueKey = `${key}\n${phaseKey}`;
    if (!ranksByTemplatePhase.has(uniqueKey)) {
      ranksByTemplatePhase.set(uniqueKey, { key, phaseKey, phaseProfileKey, rank: index + 1 });
    }
  }
  return [...ranksByTemplatePhase.values()];
}

function createReachablePhaseFrontiers(
  nodes: readonly SearchOpenerBeamNode[],
  scenario: OpenerExperimentScenario
): OpenerScenarioReachablePhaseFrontier[] {
  const ranksByPhase = new Map<string, OpenerScenarioReachablePhaseFrontier>();
  for (const [index, node] of nodes.entries()) {
    const { phaseKey, phaseProfileKey } = searchNodePhaseKeys(node, scenario);
    const uniqueKey = `${phaseKey}\n${phaseProfileKey}`;
    if (!ranksByPhase.has(uniqueKey)) {
      ranksByPhase.set(uniqueKey, { phaseKey, phaseProfileKey, rank: index + 1 });
    }
  }
  return [...ranksByPhase.values()];
}

function createReachableQualities(nodes: readonly SearchOpenerBeamNode[]): OpenerScenarioReachableQuality[] {
  return nodes.map(searchNodeQuality);
}

function assertScenarioQualityGate(scenario: OpenerExperimentScenario, candidate: OpenerExperimentCandidate | undefined): void {
  const gate = scenario.qualityGate;
  if (gate === undefined) {
    return;
  }
  if (candidate === undefined) {
    throw new Error(`Scenario ${scenario.name} quality gate failed: no candidate was produced.`);
  }

  const failures = [
    minGateFailure("queueIndex", candidate.queueIndex, gate.minQueueIndex),
    minGateFailure("attack", candidate.attack, gate.minAttack),
    minGateFailure("difficultAttack", candidate.difficultAttack, gate.minDifficultAttack),
    minGateFailure("tSpinClears", candidate.tSpinClears, gate.minTSpinClears),
    minGateFailure("tSpinAttack", candidate.tSpinAttack, gate.minTSpinAttack),
    minGateFailure("backToBackChain", candidate.backToBackChain, gate.minBackToBackChain),
    maxGateFailure("holes", candidate.holes, gate.maxHoles)
  ].filter((failure) => failure !== undefined);

  if (failures.length > 0) {
    throw new Error(`Scenario ${scenario.name} quality gate failed: ${failures.join("; ")}.`);
  }
}

function minGateFailure(name: string, actual: number, expected: number | undefined): string | undefined {
  return expected === undefined || actual >= expected ? undefined : `${name} ${actual} < ${expected}`;
}

function maxGateFailure(name: string, actual: number, expected: number | undefined): string | undefined {
  return expected === undefined || actual <= expected ? undefined : `${name} ${actual} > ${expected}`;
}

function candidateMeetsQualityGate(candidate: OpenerExperimentCandidate, gate: OpenerExperimentQualityGate | undefined): boolean {
  if (gate === undefined) {
    return true;
  }
  return (
    candidate.queueIndex >= (gate.minQueueIndex ?? Number.NEGATIVE_INFINITY) &&
    candidate.attack >= (gate.minAttack ?? Number.NEGATIVE_INFINITY) &&
    candidate.difficultAttack >= (gate.minDifficultAttack ?? Number.NEGATIVE_INFINITY) &&
    candidate.tSpinClears >= (gate.minTSpinClears ?? Number.NEGATIVE_INFINITY) &&
    candidate.tSpinAttack >= (gate.minTSpinAttack ?? Number.NEGATIVE_INFINITY) &&
    candidate.backToBackChain >= (gate.minBackToBackChain ?? Number.NEGATIVE_INFINITY) &&
    candidate.holes <= (gate.maxHoles ?? Number.POSITIVE_INFINITY)
  );
}

function createTopCandidates(
  nodes: readonly SearchOpenerBeamNode[],
  scenario: OpenerExperimentScenario,
  topCount: number,
  fumenCodec: FumenCodec
): OpenerExperimentCandidate[] {
  return rankSearchNodes(nodes, scenario)
    .sort(compareSearchNodesForOpener)
    .slice(0, topCount)
    .map(({ node, tSpinPotential }, index) => {
      const { phaseKey, phaseProfileKey } = searchNodePhaseKeys(node, scenario);
      const data = fumenCodec.encodePages(createOpenerFumenPages(node, { title: `${scenario.name} #${index + 1}` }));
      const urls = fumenCodec.createUrls(data);
      const qualityAttack = node.difficultAttack;
      return {
        rank: index + 1,
        score: node.score,
        firepowerScore: node.firepowerScore,
        finalRows: node.rows,
        path: node.path,
        previewUrl: urls.view,
        hold: node.hold ?? null,
        queueIndex: node.queueIndex,
        attack: node.attack,
        difficultAttack: qualityAttack,
        nonDifficultAttack: node.attack - qualityAttack,
        points: node.points,
        combo: node.combo,
        maxCombo: node.maxCombo,
        backToBackChain: node.backToBackChain,
        allClears: node.allClears,
        difficultClears: node.difficultClears,
        spinClears: nodeSpinClears(node),
        spinAttack: nodeSpinAttack(node),
        tSpinClears: node.tSpinClears,
        tSpinAttack: node.tSpinAttack,
        tSpinPotential,
        phaseTemplateKey: phaseKey,
        phaseProfileKey,
        clearSequence: clearSequence(node),
        occupiedCells: node.occupiedCells,
        clearedLines: node.clearedLines,
        aggregateHeight: node.aggregateHeight,
        holes: node.holes,
        bumpiness: node.bumpiness,
        urls
      };
    });
}

function rankSearchNodes(nodes: readonly SearchOpenerBeamNode[], scenario: OpenerExperimentScenario): SearchNodeWithReportPotential[] {
  const rules = scenarioRules(scenario);
  return [...nodes]
    .map((node) => ({
      node,
      tSpinPotential: spinModeAllowsTSpinPotential(rules.spinMode) && hasFutureT(node, scenario) ? node.tSpinPotential : 0
    }))
    .sort(compareSearchNodesForOpener);
}

function nodeSpinClears(node: SearchOpenerBeamNode): number {
  return node.spinClears ?? node.tSpinClears;
}

function nodeSpinAttack(node: SearchOpenerBeamNode): number {
  return node.spinAttack ?? node.tSpinAttack;
}

function compareSearchNodesForOpener(left: SearchNodeWithReportPotential, right: SearchNodeWithReportPotential): number {
  const leftNode = left.node;
  const rightNode = right.node;
  return (
    nodeSpinClears(rightNode) - nodeSpinClears(leftNode) ||
    nodeSpinAttack(rightNode) - nodeSpinAttack(leftNode) ||
    rightNode.tSpinClears - leftNode.tSpinClears ||
    rightNode.tSpinAttack - leftNode.tSpinAttack ||
    rightNode.difficultClears - leftNode.difficultClears ||
    rightNode.difficultAttack - leftNode.difficultAttack ||
    rightNode.backToBackChain - leftNode.backToBackChain ||
    right.tSpinPotential - left.tSpinPotential ||
    rightNode.attack - leftNode.attack ||
    leftNode.holes - rightNode.holes ||
    rightNode.score - leftNode.score ||
    rightNode.points - leftNode.points ||
    leftNode.path.length - rightNode.path.length ||
    leftNode.path.join(" ").localeCompare(rightNode.path.join(" "))
  );
}

function compareRankedOpenerCandidates(left: RankedOpenerCandidate, right: RankedOpenerCandidate): number {
  return (
    right.spinClears - left.spinClears ||
    right.spinAttack - left.spinAttack ||
    right.tSpinClears - left.tSpinClears ||
    right.tSpinAttack - left.tSpinAttack ||
    right.difficultClears - left.difficultClears ||
    right.difficultAttack - left.difficultAttack ||
    right.backToBackChain - left.backToBackChain ||
    right.attack - left.attack ||
    right.tSpinPotential - left.tSpinPotential ||
    right.survivalCount - left.survivalCount ||
    left.holes - right.holes ||
    right.firepowerScore - left.firepowerScore ||
    right.score - left.score ||
    left.bumpiness - right.bumpiness ||
    right.points - left.points ||
    right.path.length - left.path.length ||
    left.path.join(" ").localeCompare(right.path.join(" "))
  );
}

function compareRankedOpenerTemplates(left: RankedOpenerTemplate, right: RankedOpenerTemplate): number {
  return (
    compareRankedOpenerCandidates(left.best, right.best) || right.survivalCount - left.survivalCount || left.key.localeCompare(right.key)
  );
}

function compareReplayTemplates(left: OpenerTemplateReplayEntry, right: OpenerTemplateReplayEntry): number {
  return (
    right.replayHitCount - left.replayHitCount ||
    right.phaseReplayHitCount - left.phaseReplayHitCount ||
    right.phaseProfileReplayHitCount - left.phaseProfileReplayHitCount ||
    templateReplayQualityFirepower(right) - templateReplayQualityFirepower(left) ||
    compareRankedOpenerCandidates(left.best, right.best) ||
    right.qualityReplayHitCount - left.qualityReplayHitCount ||
    right.groupedSurvivalCount - left.groupedSurvivalCount ||
    left.key.localeCompare(right.key)
  );
}

function templateReplayQualityFirepower(template: Pick<OpenerTemplateReplayEntry, "best" | "qualityReplayHitCount">): number {
  return template.qualityReplayHitCount * openerFirepowerRankValue(template.best);
}

function openerFirepowerRankValue(
  candidate: Pick<
    RankedOpenerCandidate,
    "spinClears" | "spinAttack" | "tSpinClears" | "tSpinAttack" | "difficultAttack" | "backToBackChain" | "attack"
  >
): number {
  return (
    candidate.spinClears * 100_000 +
    candidate.spinAttack * 10_000 +
    candidate.tSpinClears * 1_000 +
    candidate.tSpinAttack * 100 +
    candidate.difficultAttack * 1_000 +
    candidate.backToBackChain * 100 +
    candidate.attack
  );
}

function addQualityReplayHits(
  hitsByTemplate: Map<string, Set<string>>,
  templates: readonly RankedOpenerTemplate[],
  quality: OpenerScenarioReachableQuality,
  scenarioName: string,
  scenarioQualityHits: Set<string>
): void {
  for (const template of templates) {
    if (scenarioQualityHits.has(template.key) || !meetsReplayQuality(quality, template.best)) {
      continue;
    }
    scenarioQualityHits.add(template.key);
    const hits = hitsByTemplate.get(template.key) ?? new Set<string>();
    hits.add(scenarioName);
    hitsByTemplate.set(template.key, hits);
  }
}

function addPhaseReplayHits(
  hitsByTemplate: Map<string, Set<string>>,
  templateKeysByPhase: ReadonlyMap<string, readonly string[]>,
  phaseKey: string,
  scenarioName: string,
  scenarioPhaseHits: Set<string>
): void {
  if (scenarioPhaseHits.has(phaseKey)) {
    return;
  }
  scenarioPhaseHits.add(phaseKey);
  for (const templateKey of templateKeysByPhase.get(phaseKey) ?? []) {
    const hits = hitsByTemplate.get(templateKey) ?? new Set<string>();
    hits.add(scenarioName);
    hitsByTemplate.set(templateKey, hits);
  }
}

function clearSequence(node: SearchOpenerBeamNode): string[] {
  return node.placements
    .filter((placement) => placement.clearName !== "NONE" && placement.clearedLines > 0 && placement.attack > 0)
    .map((placement) => `${displayPlacementClearName(placement)}:${placement.attack}`);
}

function displayPlacementClearName(placement: SearchOpenerBeamNode["placements"][number]): string {
  if (placement.piece !== "T" && placement.clearName.startsWith("TSPIN")) {
    return `${placement.piece}_SPIN${placement.clearName.slice("TSPIN".length)}`;
  }
  return placement.clearName;
}

function hasFutureT(node: SearchOpenerBeamNode, scenario: OpenerExperimentScenario): boolean {
  return node.hold === "T" || scenario.queue.slice(node.queueIndex).includes("T");
}

function countTemplateSurvivors(report: OpenerExperimentReport): Map<string, number> {
  const sourcesByTemplate = new Map<string, Set<string>>();
  for (const scenario of report.scenarios) {
    for (const candidate of scenario.top) {
      if (!candidateMeetsQualityGate(candidate, scenario.qualityGate)) {
        continue;
      }
      const key = templateKey(candidate);
      const sources = sourcesByTemplate.get(key) ?? new Set<string>();
      sources.add(scenario.name);
      sourcesByTemplate.set(key, sources);
    }
  }
  return new Map([...sourcesByTemplate].map(([key, sources]) => [key, sources.size]));
}

function collectReachablePhaseKeysByTemplate(report: OpenerExperimentReport): Map<string, Set<string>> {
  const phaseKeysByTemplate = new Map<string, Set<string>>();
  for (const scenario of report.scenarios) {
    for (const reachablePhase of scenario.reachableTemplatePhases) {
      const phaseKeys = phaseKeysByTemplate.get(reachablePhase.key) ?? new Set<string>();
      phaseKeys.add(reachablePhase.phaseKey);
      phaseKeysByTemplate.set(reachablePhase.key, phaseKeys);
    }
  }
  return phaseKeysByTemplate;
}

function collectReachablePhaseProfileKeysByTemplate(report: OpenerExperimentReport): Map<string, Set<string>> {
  const profileKeysByTemplate = new Map<string, Set<string>>();
  for (const scenario of report.scenarios) {
    for (const reachablePhase of scenario.reachableTemplatePhases) {
      const profileKeys = profileKeysByTemplate.get(reachablePhase.key) ?? new Set<string>();
      profileKeys.add(reachablePhase.phaseProfileKey);
      profileKeysByTemplate.set(reachablePhase.key, profileKeys);
    }
  }
  return profileKeysByTemplate;
}

function templateKey(
  candidate: Pick<OpenerExperimentCandidate, "finalRows" | "hold" | "queueIndex" | "backToBackChain" | "combo">
): string {
  return statefulTemplateKey({
    rows: candidate.finalRows,
    hold: candidate.hold,
    queueIndex: candidate.queueIndex,
    backToBackChain: candidate.backToBackChain,
    combo: candidate.combo
  });
}

function searchNodeTemplateKey(node: Pick<SearchOpenerBeamNode, "rows" | "hold" | "queueIndex" | "backToBackChain" | "combo">): string {
  return statefulTemplateKey({
    rows: node.rows,
    hold: node.hold ?? null,
    queueIndex: node.queueIndex,
    backToBackChain: node.backToBackChain,
    combo: node.combo
  });
}

function searchNodePhaseKeys(node: SearchOpenerBeamNode, scenario: OpenerExperimentScenario): PhaseStateKeys {
  const state = searchNodePhaseState(node, scenario);
  return {
    phaseKey: statefulTemplateKey(state),
    phaseProfileKey: statefulPhaseProfileKey(state)
  };
}

function searchNodePhaseState(node: SearchOpenerBeamNode, scenario: OpenerExperimentScenario): TemplateStateKeyInput {
  const prefixDepth = templatePhaseDepth(scenario.maxDepth);
  if (node.placements.length === 0 || prefixDepth >= node.placements.length) {
    return {
      rows: node.rows,
      hold: node.hold ?? null,
      queueIndex: node.queueIndex,
      backToBackChain: node.backToBackChain,
      combo: node.combo
    };
  }
  return stateAfterPlacementPrefix(node, prefixDepth, scenario.queue);
}

function searchNodeQuality(node: SearchOpenerBeamNode, index: number): OpenerScenarioReachableQuality {
  return {
    rank: index + 1,
    queueIndex: node.queueIndex,
    difficultAttack: node.difficultAttack,
    spinClears: nodeSpinClears(node),
    spinAttack: nodeSpinAttack(node),
    tSpinClears: node.tSpinClears,
    tSpinAttack: node.tSpinAttack,
    backToBackChain: node.backToBackChain,
    combo: node.combo,
    tSpinPotential: node.tSpinPotential,
    holes: node.holes
  };
}

function meetsReplayQuality(quality: OpenerScenarioReachableQuality, target: RankedOpenerCandidate): boolean {
  const hasFirepowerTarget = target.difficultAttack > 0 || target.spinClears > 0 || target.tSpinClears > 0 || target.backToBackChain > 0;
  return (
    hasFirepowerTarget &&
    quality.queueIndex >= target.queueIndex &&
    quality.difficultAttack >= target.difficultAttack &&
    quality.spinClears >= target.spinClears &&
    quality.spinAttack >= target.spinAttack &&
    quality.tSpinClears >= target.tSpinClears &&
    quality.tSpinAttack >= target.tSpinAttack &&
    quality.backToBackChain >= target.backToBackChain &&
    quality.combo >= target.combo &&
    quality.tSpinPotential >= target.tSpinPotential &&
    quality.holes <= target.holes
  );
}

function templatePhaseDepth(maxDepth: number): number {
  if (maxDepth <= 7) {
    return maxDepth;
  }
  return Math.floor((maxDepth - 1) / 7) * 7;
}

function stateAfterPlacementPrefix(node: SearchOpenerBeamNode, prefixDepth: number, queue: string): TemplateStateKeyInput {
  let rows = new Array<number>(BOARD_HEIGHT).fill(0);
  let hold: string | null = null;
  let queueIndex = 0;
  let backToBackChain = 0;
  let combo = 0;
  for (let index = 0; index < prefixDepth; index += 1) {
    const placement = node.placements[index];
    if (placement === undefined) {
      throw new Error(`Cannot reconstruct ${prefixDepth}-placement phase state from ${node.placements.length} placements.`);
    }
    for (const cell of placement.cells) {
      if (cell.x < 0 || cell.x >= BOARD_WIDTH || cell.y < 0 || cell.y >= BOARD_HEIGHT) {
        throw new Error(`Placement ${placement.path} has an out-of-board phase cell (${cell.x}, ${cell.y}).`);
      }
      rows[cell.y] = (rows[cell.y] ?? 0) | (1 << cell.x);
    }
    rows = clearFullLineRows(rows);
    ({ hold, queueIndex } = advanceHoldStateFromPlacement(placement.usedHold, hold, queueIndex, queue));
    backToBackChain = placement.backToBackChain;
    combo = placement.combo;
  }
  return { rows, hold, queueIndex, backToBackChain, combo };
}

function advanceHoldStateFromPlacement(
  usedHold: boolean,
  hold: string | null,
  queueIndex: number,
  queue: string
): Pick<TemplateStateKeyInput, "hold" | "queueIndex"> {
  const current = queue[queueIndex];
  if (current === undefined) {
    throw new Error(`Cannot reconstruct hold state after queue index ${queueIndex}: queue is exhausted.`);
  }
  if (!usedHold) {
    return { hold, queueIndex: queueIndex + 1 };
  }
  if (hold === null) {
    if (queue[queueIndex + 1] === undefined) {
      throw new Error(`Cannot reconstruct empty-hold placement after queue index ${queueIndex}: next queue piece is missing.`);
    }
    return { hold: current, queueIndex: queueIndex + 2 };
  }
  return { hold: current, queueIndex: queueIndex + 1 };
}

function clearFullLineRows(rows: number[]): number[] {
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < BOARD_HEIGHT; readIndex += 1) {
    const row = rows[readIndex] ?? 0;
    if (row !== ROW_MASK) {
      rows[writeIndex] = row;
      writeIndex += 1;
    }
  }
  while (writeIndex < BOARD_HEIGHT) {
    rows[writeIndex] = 0;
    writeIndex += 1;
  }
  return rows;
}

function statefulTemplateKey(state: TemplateStateKeyInput): string {
  return `${rowsTemplateKey(state.rows)}|hold=${state.hold ?? "-"}|queue=${state.queueIndex}|b2b=${state.backToBackChain}|combo=${state.combo}`;
}

function rowsTemplateKey(rows: readonly number[]): string {
  const direct = rows.join(",");
  const mirrored = rows.map(mirrorRow).join(",");
  return direct <= mirrored ? direct : mirrored;
}

function statefulPhaseProfileKey(state: TemplateStateKeyInput): string {
  return `${phaseProfileKey(state.rows)}|hold=${state.hold ?? "-"}|queue=${state.queueIndex}|b2b=${state.backToBackChain}|combo=${state.combo}`;
}

function phaseProfileKey(rows: readonly number[]): string {
  const direct = rawPhaseProfileKey(rows);
  const mirrored = rawPhaseProfileKey(rows.map(mirrorRow));
  return direct <= mirrored ? direct : mirrored;
}

function rawPhaseProfileKey(rows: readonly number[]): string {
  const heights = Array.from({ length: BOARD_WIDTH }, (_, x) => columnHeight(rows, x));
  const minHeight = Math.min(...heights);
  const normalizedHeights = heights.map((height) => height - minHeight);
  const holes = Array.from({ length: BOARD_WIDTH }, (_, x) => columnHoles(rows, x, heights[x] ?? 0));
  return `${normalizedHeights.join(",")}|${holes.join(",")}`;
}

function columnHeight(rows: readonly number[], x: number): number {
  for (let y = BOARD_HEIGHT - 1; y >= 0; y -= 1) {
    if (((rows[y] ?? 0) & (1 << x)) !== 0) {
      return y + 1;
    }
  }
  return 0;
}

function columnHoles(rows: readonly number[], x: number, height: number): number {
  let holes = 0;
  for (let y = 0; y < height; y += 1) {
    if (((rows[y] ?? 0) & (1 << x)) === 0) {
      holes += 1;
    }
  }
  return holes;
}

function mirrorRow(row: number): number {
  let mirrored = 0;
  for (let x = 0; x < 10; x += 1) {
    if ((row & (1 << x)) !== 0) {
      mirrored |= 1 << (9 - x);
    }
  }
  return mirrored;
}

function formatSurvival(candidate: Pick<RankedOpenerCandidate, "survivalCount" | "survivalRate">): string {
  return `${candidate.survivalCount} (${formatPercent(candidate.survivalRate)})`;
}

function formatTemplateSurvival(template: Pick<RankedOpenerTemplate, "survivalCount" | "survivalRate">): string {
  return `${template.survivalCount} (${formatPercent(template.survivalRate)})`;
}

function formatReplaySurvival(
  template: Pick<OpenerTemplateReplayEntry, "replayHitCount" | "replayHitRate" | "replayScenarioCount">
): string {
  return `${template.replayHitCount}/${template.replayScenarioCount} (${formatPercent(template.replayHitRate)})`;
}

function formatPhaseReplaySurvival(
  template: Pick<OpenerTemplateReplayEntry, "phaseReplayHitCount" | "phaseReplayHitRate" | "replayScenarioCount">
): string {
  return `${template.phaseReplayHitCount}/${template.replayScenarioCount} (${formatPercent(template.phaseReplayHitRate)})`;
}

function formatPhaseProfileReplaySurvival(
  template: Pick<OpenerTemplateReplayEntry, "phaseProfileReplayHitCount" | "phaseProfileReplayHitRate" | "replayScenarioCount">
): string {
  return `${template.phaseProfileReplayHitCount}/${template.replayScenarioCount} (${formatPercent(template.phaseProfileReplayHitRate)})`;
}

function formatQualityReplaySurvival(
  template: Pick<OpenerTemplateReplayEntry, "qualityReplayHitCount" | "qualityReplayHitRate" | "replayScenarioCount">
): string {
  return `${template.qualityReplayHitCount}/${template.replayScenarioCount} (${formatPercent(template.qualityReplayHitRate)})`;
}

function formatGroupedReplaySurvival(
  template: Pick<OpenerTemplateReplayEntry, "groupedSurvivalCount" | "groupedScenarioCount" | "groupedSurvivalRate">
): string {
  return `${template.groupedSurvivalCount}/${template.groupedScenarioCount} (${formatPercent(template.groupedSurvivalRate)})`;
}

function formatQualityGate(gate: OpenerExperimentQualityGate | undefined): string {
  if (gate === undefined) {
    return "-";
  }
  return [
    minGateLabel("queue", gate.minQueueIndex),
    minGateLabel("attack", gate.minAttack),
    minGateLabel("difficult", gate.minDifficultAttack),
    minGateLabel("tspin", gate.minTSpinClears),
    minGateLabel("tspinAttack", gate.minTSpinAttack),
    minGateLabel("b2b", gate.minBackToBackChain),
    maxGateLabel("holes", gate.maxHoles)
  ]
    .filter((item) => item !== undefined)
    .join(" ");
}

function minGateLabel(name: string, value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${name}>=${value}`;
}

function maxGateLabel(name: string, value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${name}<=${value}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function spinModeAllowsTSpinPotential(spinMode: NativeSpinMode): boolean {
  return spinMode !== "NONE";
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

function createDiscoveryTwoBagQueues(sampleSize: number): string[] {
  return createDiscoveryBagQueues(sampleSize, 2, 0);
}

function createDiscoveryBagQueues(sampleSize: number, bagCount: number, sampleOffset: number): string[] {
  const permutationCount = factorial(DISCOVERY_BAG.length);
  const queues = new Set<string>();
  for (let sample = 0; queues.size < sampleSize && sample < permutationCount * 2; sample += 1) {
    let queue = "";
    for (let bagIndex = 0; bagIndex < bagCount; bagIndex += 1) {
      queue += nthPermutation(DISCOVERY_BAG, permutationIndex(sample + sampleOffset, bagIndex, permutationCount));
    }
    queues.add(queue);
  }
  return [...queues];
}

function permutationIndex(sample: number, bagIndex: number, permutationCount: number): number {
  const multiplier = [197, 389, 593, 787, 991][bagIndex] ?? 197 + bagIndex * 211;
  const offset = [0, 97, 211, 353, 557][bagIndex] ?? bagIndex * 131;
  return (sample * multiplier + offset) % permutationCount;
}

function bagCountTag(bagCount: number): string {
  if (bagCount === 1) {
    return "one-bag";
  }
  if (bagCount === 2) {
    return "two-bag";
  }
  if (bagCount === 3) {
    return "three-bag";
  }
  return `${bagCount}-bag`;
}

function nthPermutation(input: string, index: number): string {
  const remaining = [...input];
  let cursor = index;
  let output = "";
  for (let divisor = remaining.length; divisor > 0; divisor -= 1) {
    const block = factorial(divisor - 1);
    const selected = Math.floor(cursor / block);
    output += remaining.splice(selected, 1).join("");
    cursor %= block;
  }
  return output;
}

function factorial(value: number): number {
  let output = 1;
  for (let item = 2; item <= value; item += 1) {
    output *= item;
  }
  return output;
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
