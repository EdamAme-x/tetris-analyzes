import { describe, expect, test } from "bun:test";
import type { FumenCodec, FumenUrls } from "../src/domain/fumen";
import type { NativeBeamPlacement, NativeClearName } from "../src/infrastructure/native/binding-types";
import {
  createOpenerExperimentCliConfig,
  defaultCertificationReplay,
  defaultReplayTemplatePool,
  defaultSurvivabilityReplay,
  defaultTrainSamples
} from "../src/application/opener-experiment-cli";
import {
  CONTINUATION_OPENER_EXPERIMENT_SCENARIOS,
  DEFAULT_OPENER_EXPERIMENT_SCENARIOS,
  DISCOVERY_OPENER_EXPERIMENT_SCENARIOS,
  SURVEY_OPENER_EXPERIMENT_SCENARIOS,
  TETRIO_TL_OPENER_SEARCH_RULES,
  createDistributionOpenerExperimentSplits,
  createTemplateReplayScenarios,
  rankOpenerCandidates,
  rankOpenerTemplates,
  replayOpenerTemplateSurvivability,
  renderOpenerExperimentConsoleSummary,
  renderOpenerExperimentMarkdown,
  runOpenerExperiment,
  type OpenerExperimentClock
} from "../src/application/run-opener-experiment";

const urls: FumenUrls = {
  edit: "https://fumen.zui.jp/?v115@test",
  view: "https://fumen.zui.jp/?m115@test",
  list: "https://fumen.zui.jp/?d115@test",
  listMin: "https://fumen.zui.jp/?D115@test"
};

describe("opener experiment runner", () => {
  test("defaults to generated three-bag distribution training scenarios", () => {
    expect(DEFAULT_OPENER_EXPERIMENT_SCENARIOS).toHaveLength(24);
    expect(new Set(DEFAULT_OPENER_EXPERIMENT_SCENARIOS.map((scenario) => scenario.queue)).size).toBe(
      DEFAULT_OPENER_EXPERIMENT_SCENARIOS.length
    );
    expect(DEFAULT_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => isThreeBagQueue(scenario.queue))).toBe(true);
    expect(DEFAULT_OPENER_EXPERIMENT_SCENARIOS[0]).toMatchObject({
      name: "train-001",
      hold: true,
      beamWidth: 512,
      maxDepth: 21,
      setupPoolMultiplier: 64,
      rules: TETRIO_TL_OPENER_SEARCH_RULES,
      qualityGateRequired: false,
      qualityGate: {
        minQueueIndex: 21,
        minAttack: 9,
        minDifficultAttack: 9,
        minTSpinClears: 3,
        minTSpinAttack: 8,
        minBackToBackChain: 3,
        maxAllClears: 0,
        maxHoles: 0
      }
    });
  });

  test("provides seed-generated two-bag survey scenarios without curated queues", () => {
    expect(SURVEY_OPENER_EXPERIMENT_SCENARIOS).toHaveLength(16);
    expect(SURVEY_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.rules === TETRIO_TL_OPENER_SEARCH_RULES)).toBe(true);
    expect(new Set(SURVEY_OPENER_EXPERIMENT_SCENARIOS.map((scenario) => scenario.queue)).size).toBe(
      SURVEY_OPENER_EXPERIMENT_SCENARIOS.length
    );
    expect(SURVEY_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => isTwoBagQueue(scenario.queue))).toBe(true);
    expect(SURVEY_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.beamWidth === 512)).toBe(true);
    expect(SURVEY_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.name.startsWith("train-"))).toBe(true);
    expect(SURVEY_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.tags?.includes("distribution"))).toBe(true);
  });

  test("provides deterministic two-bag discovery queues from the seed distribution", () => {
    const queues = DISCOVERY_OPENER_EXPERIMENT_SCENARIOS.map((scenario) => scenario.queue);

    expect(DISCOVERY_OPENER_EXPERIMENT_SCENARIOS).toHaveLength(24);
    expect(new Set(queues).size).toBe(queues.length);
    expect(DISCOVERY_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.name.startsWith("train-"))).toBe(true);
    expect(DISCOVERY_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.queue.length === 14)).toBe(true);
    expect(DISCOVERY_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.rules === TETRIO_TL_OPENER_SEARCH_RULES)).toBe(true);
  });

  test("provides three-bag continuation scenarios from the seed distribution", () => {
    expect(CONTINUATION_OPENER_EXPERIMENT_SCENARIOS).toHaveLength(24);
    expect(CONTINUATION_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.name.startsWith("train-"))).toBe(true);
    expect(new Set(CONTINUATION_OPENER_EXPERIMENT_SCENARIOS.map((scenario) => scenario.queue)).size).toBe(
      CONTINUATION_OPENER_EXPERIMENT_SCENARIOS.length
    );
    expect(CONTINUATION_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => isThreeBagQueue(scenario.queue))).toBe(true);
    expect(CONTINUATION_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.beamWidth === 512)).toBe(true);
    expect(CONTINUATION_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.maxDepth === 21)).toBe(true);
    expect(CONTINUATION_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.setupPoolMultiplier === 64)).toBe(true);
    expect(CONTINUATION_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.qualityGate?.minTSpinClears === 3)).toBe(true);
    expect(CONTINUATION_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.qualityGate?.minBackToBackChain === 3)).toBe(true);
    expect(CONTINUATION_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.qualityGate?.maxAllClears === 0)).toBe(true);
    expect(CONTINUATION_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.tags?.includes("three-bag"))).toBe(true);
  });

  test("creates disjoint train validation and test splits from one seed", () => {
    const splits = createDistributionOpenerExperimentSplits({
      seed: "test-seed",
      bagCount: 2,
      trainSamples: 3,
      validationSamples: 2,
      testSamples: 2
    });
    const queues = [...splits.train, ...splits.validation, ...splits.test].map((scenario) => scenario.queue);

    expect(splits.train.map((scenario) => scenario.name)).toEqual(["train-001", "train-002", "train-003"]);
    expect(splits.validation.map((scenario) => scenario.name)).toEqual(["validation-001", "validation-002"]);
    expect(splits.test.map((scenario) => scenario.name)).toEqual(["test-001", "test-002"]);
    expect(new Set(queues).size).toBe(queues.length);
    expect(queues.every(isTwoBagQueue)).toBe(true);
    expect(createDistributionOpenerExperimentSplits({ seed: "test-seed", bagCount: 2, trainSamples: 3 }).train).toEqual(splits.train);
    expect(createDistributionOpenerExperimentSplits({ seed: "other-seed", bagCount: 2, trainSamples: 3 }).train).not.toEqual(splits.train);
  });

  test("defaults continuation CLI runs to validation and certification replay", () => {
    const config = createOpenerExperimentCliConfig(["--preset=continuation", "--top=3"]);

    expect(defaultTrainSamples("continuation")).toBe(8);
    expect(defaultSurvivabilityReplay("continuation")).toBe(16);
    expect(defaultCertificationReplay("continuation")).toBe(64);
    expect(defaultReplayTemplatePool("continuation", 3)).toBe(128);
    expect(config.displayTop).toBe(3);
    expect(config.survivabilityReplay).toBe(16);
    expect(config.certificationReplay).toBe(64);
    expect(config.replayTopTemplates).toBe(128);
    expect(config.experimentTop).toBe(128);
    expect(config.scenarios).toHaveLength(8);
    expect(config.scenarios.every((scenario) => scenario.beamWidth === 512)).toBe(true);
    expect(config.scenarios.every((scenario) => scenario.setupPoolMultiplier === 64)).toBe(true);
    expect(config.validationScenarios).toHaveLength(16);
    expect(config.testScenarios).toHaveLength(64);
  });

  test("accepts explicit distribution CLI seed and split sizes", () => {
    const config = createOpenerExperimentCliConfig([
      "--preset=distribution",
      "--seed=test-seed",
      "--bag-count=2",
      "--train-samples=2",
      "--validation-samples=1",
      "--test-samples=1"
    ]);

    expect(config.seed).toBe("test-seed");
    expect(config.scenarios).toHaveLength(2);
    expect(config.validationScenarios).toHaveLength(1);
    expect(config.testScenarios).toHaveLength(1);
    expect(
      [...config.scenarios, ...config.validationScenarios, ...config.testScenarios].every((scenario) => isTwoBagQueue(scenario.queue))
    ).toBe(true);
  });

  test("accepts progress logging CLI flags", () => {
    expect(createOpenerExperimentCliConfig(["--progress"]).progress).toBe(true);
    expect(createOpenerExperimentCliConfig(["--progress=false"]).progress).toBe(false);
  });

  test("emits progress events around long-running search steps", () => {
    const events: string[] = [];
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "progress-scenario",
          queue: "TI",
          hold: true,
          beamWidth: 4,
          maxDepth: 1,
          warmups: 1,
          iterations: 1,
          top: 1
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2, 10, 15]),
      fumenCodec: fakeCodec,
      search: () => [{ ...candidateNode("progress"), placements: [] }],
      onProgress: (event) => {
        events.push(`${event.stage}:${event.step}:${event.scenario}`);
      }
    });

    expect(report.scenarios[0]?.medianMs).toBe(5);
    expect(events).toEqual([
      "train:scenario-start:progress-scenario",
      "train:warmup-start:progress-scenario",
      "train:warmup-end:progress-scenario",
      "train:iteration-start:progress-scenario",
      "train:iteration-end:progress-scenario",
      "train:detail-start:progress-scenario",
      "train:detail-end:progress-scenario",
      "train:scenario-end:progress-scenario"
    ]);
  });

  test("measures native search scenarios and keeps top candidates linkable", () => {
    const clock = createClock("2026-05-14T00:00:00.000Z", [100, 104, 200, 206, 300, 305]);
    let calls = 0;
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "fake-scenario",
          queue: "TI",
          hold: true,
          beamWidth: 8,
          maxDepth: 2,
          setupPoolMultiplier: 26,
          warmups: 1,
          iterations: 3,
          top: 1
        }
      ],
      clock,
      fumenCodec: fakeCodec,
      search: (input) => {
        calls += 1;
        expect(input).toEqual({
          queue: "TI",
          beamWidth: 8,
          hold: true,
          maxDepth: 2,
          spinMode: "ALL-MINI+",
          comboTable: "MULTIPLIER",
          kickTable: "SRS+",
          allow180: true,
          setupPoolMultiplier: 26
        });
        return [
          {
            score: 42,
            firepowerScore: 0,
            depth: 2,
            queueIndex: 2,
            rows: new Array(20).fill(0),
            path: ["T@r0,x3", "I@r1,x0"],
            placements: [],
            attack: 0,
            points: 0,
            combo: 0,
            maxCombo: 0,
            backToBackChain: 0,
            allClears: 0,
            difficultClears: 0,
            difficultAttack: 0,
            tSpinClears: 0,
            tSpinAttack: 0,
            tSpinPotential: 0,
            occupiedCells: 8,
            clearedLines: 0,
            aggregateHeight: 4,
            holes: 0,
            bumpiness: 1
          }
        ];
      }
    });

    expect(calls).toBe(4);
    expect(report.generatedAt).toBe("2026-05-14T00:00:00.000Z");
    expect(report.scenarios[0]?.medianMs).toBe(5);
    expect(report.scenarios[0]?.searchesPerSecond).toBe(200);
    expect(report.scenarios[0]?.setupPoolMultiplier).toBe(26);
    expect(report.scenarios[0]?.top[0]?.previewUrl).toBe(urls.view);
    expect(report.scenarios[0]?.top[0]?.urls.view).toBe(urls.view);
  });

  test("can measure placement-light search and render detailed fumen candidates separately", () => {
    let searchCalls = 0;
    let detailCalls = 0;
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "split-detail",
          queue: "TI",
          hold: true,
          beamWidth: 4,
          maxDepth: 1,
          warmups: 0,
          iterations: 1,
          top: 1
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => {
        searchCalls += 1;
        return [{ ...candidateNode("light-search"), placements: [] }];
      },
      detailSearch: () => {
        detailCalls += 1;
        return [{ ...candidateNode("detailed-search"), placements: [placementEvent("TSPIN_SINGLE", 2, 1, "T", 4)] }];
      }
    });

    expect(searchCalls).toBe(1);
    expect(detailCalls).toBe(1);
    expect(report.scenarios[0]?.top[0]?.path).toEqual(["detailed-search"]);
    expect(report.scenarios[0]?.top[0]?.clearSequence).toEqual(["TSPIN_SINGLE:2"]);
  });

  test("renders a compact markdown report", () => {
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "fake-scenario",
          queue: "TI",
          hold: false,
          beamWidth: 4,
          maxDepth: 1,
          warmups: 0,
          iterations: 1
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => [
        {
          score: 10,
          firepowerScore: 0,
          depth: 1,
          queueIndex: 1,
          rows: new Array(20).fill(0),
          path: ["T@r0,x3"],
          placements: [],
          attack: 0,
          points: 0,
          combo: 0,
          maxCombo: 0,
          backToBackChain: 0,
          allClears: 0,
          difficultClears: 0,
          difficultAttack: 0,
          tSpinClears: 0,
          tSpinAttack: 0,
          tSpinPotential: 0,
          occupiedCells: 4,
          clearedLines: 0,
          aggregateHeight: 2,
          holes: 0,
          bumpiness: 0
        }
      ]
    });

    const markdown = renderOpenerExperimentMarkdown(report);
    expect(markdown).toContain("# Opener experiment");
    expect(markdown).toContain("Rules: spins=ALL-MINI+, combo=MULTIPLIER, kicks=SRS+");
    expect(markdown).toContain("## Best openers");
    expect(markdown).toContain("## Template survivability");
    expect(markdown).toContain("fake-scenario | TI | false | ALL-MINI+ | MULTIPLIER | SRS+ | on | 4 | 1 | 14 | 2.000");
    expect(markdown).toContain("quality gate");
    expect(markdown).toContain("## Candidate details");
    expect(markdown).toContain("[view](https://fumen.zui.jp/?m115@test)");
  });

  test("renders overridden scenario rules instead of the default TL header", () => {
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "custom-rules",
          queue: "TI",
          hold: false,
          beamWidth: 4,
          maxDepth: 1,
          warmups: 0,
          iterations: 1,
          rules: { spinMode: "NONE", comboTable: "NONE", kickTable: "NONE" }
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: (input) => {
        expect(input.spinMode).toBe("NONE");
        expect(input.comboTable).toBe("NONE");
        expect(input.kickTable).toBe("NONE");
        return [candidateNode("quiet")];
      }
    });

    const markdown = renderOpenerExperimentMarkdown(report);
    expect(markdown).toContain("Rules: spins=NONE, combo=NONE, kicks=NONE");
    expect(markdown).toContain("custom-rules | TI | false | NONE | NONE | NONE | on | 4 | 1 | 14 | 2.000");
  });

  test("fails opener experiments when a scenario quality gate is missed", () => {
    expect(() =>
      runOpenerExperiment({
        scenarios: [
          {
            name: "weak",
            queue: "TI",
            hold: false,
            beamWidth: 4,
            maxDepth: 1,
            warmups: 0,
            iterations: 1,
            qualityGate: {
              minQueueIndex: 1,
              minAttack: 1,
              minTSpinClears: 1,
              maxAllClears: 0,
              maxHoles: 0
            }
          }
        ],
        clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
        fumenCodec: fakeCodec,
        search: () => [{ ...candidateNode("weak"), queueIndex: 1, holes: 1 }]
      })
    ).toThrow("Scenario weak quality gate failed: attack 0 < 1; tSpinClears 0 < 1; holes 1 > 0.");
  });

  test("excludes lower-ranked candidates that miss the scenario quality gate from template replay", () => {
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "gated",
          queue: "TT",
          hold: false,
          beamWidth: 4,
          maxDepth: 2,
          warmups: 0,
          iterations: 1,
          top: 2,
          qualityGate: {
            minQueueIndex: 1,
            minAttack: 12,
            minDifficultAttack: 12,
            minTSpinClears: 3,
            minTSpinAttack: 12,
            minBackToBackChain: 3,
            maxAllClears: 0,
            maxHoles: 0
          }
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => [
        {
          ...candidateNode("hole-score"),
          score: 20_000,
          firepowerScore: 20_000,
          attack: 12,
          difficultAttack: 12,
          difficultClears: 3,
          tSpinClears: 3,
          tSpinAttack: 12,
          backToBackChain: 3,
          holes: 1
        },
        {
          ...candidateNode("holeless"),
          score: 10_000,
          firepowerScore: 10_000,
          attack: 12,
          difficultAttack: 12,
          difficultClears: 3,
          tSpinClears: 3,
          tSpinAttack: 12,
          backToBackChain: 3,
          holes: 0
        }
      ]
    });

    expect(report.scenarios[0]?.top.map((candidate) => candidate.path[0])).toEqual(["holeless", "hole-score"]);
    expect(rankOpenerTemplates(report, 2).map((template) => template.best.path[0])).toEqual(["holeless"]);
  });

  test("ranks non-PC firepower before all-clear-bonus-inflated candidates", () => {
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "pc-ranking",
          queue: "TT",
          hold: false,
          beamWidth: 4,
          maxDepth: 2,
          warmups: 0,
          iterations: 1,
          top: 2
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => [
        {
          ...candidateNode("all-clear-boosted"),
          rows: [1, 0, ...new Array(18).fill(0)],
          score: 100_000,
          firepowerScore: 100_000,
          attack: 24,
          difficultAttack: 24,
          difficultClears: 3,
          tSpinClears: 3,
          tSpinAttack: 24,
          backToBackChain: 3,
          allClears: 1,
          holes: 0
        },
        {
          ...candidateNode("clean-b2b"),
          rows: [3, 0, ...new Array(18).fill(0)],
          score: 10_000,
          firepowerScore: 10_000,
          attack: 14,
          difficultAttack: 14,
          difficultClears: 3,
          tSpinClears: 3,
          tSpinAttack: 14,
          backToBackChain: 3,
          allClears: 0,
          holes: 0
        }
      ]
    });

    expect(report.scenarios[0]?.top.map((candidate) => candidate.path[0])).toEqual(["clean-b2b", "all-clear-boosted"]);
    expect(rankOpenerTemplates(report, 2).map((template) => template.best.path[0])).toEqual(["clean-b2b", "all-clear-boosted"]);
  });

  test("excludes all-clear candidates from quality-gated template pools", () => {
    const gate = { maxAllClears: 0 };
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "pc-gated",
          queue: "TT",
          hold: false,
          beamWidth: 4,
          maxDepth: 2,
          warmups: 0,
          iterations: 1,
          top: 2,
          qualityGate: gate
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => [
        {
          ...candidateNode("pc"),
          rows: [7, 11, 13, ...new Array(17).fill(0)],
          attack: 24,
          difficultAttack: 24,
          tSpinClears: 3,
          tSpinAttack: 24,
          allClears: 1
        },
        {
          ...candidateNode("clean"),
          rows: [1, 2, 4, ...new Array(17).fill(0)],
          attack: 14,
          difficultAttack: 14,
          tSpinClears: 3,
          tSpinAttack: 14
        }
      ]
    });

    expect(report.scenarios[0]?.top.map((candidate) => candidate.path[0])).toEqual(["clean", "pc"]);
    expect(rankOpenerTemplates(report, 2).map((template) => template.best.path[0])).toEqual(["clean"]);
  });

  test("excludes quality-gate failures from template survival counts", () => {
    const sharedRows = [7, 11, 13, ...new Array(17).fill(0)];
    const alternateRows = [1, 2, 4, ...new Array(17).fill(0)];
    const gate = { maxHoles: 0 };
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "shared-pass",
          queue: "TI",
          hold: false,
          beamWidth: 4,
          maxDepth: 2,
          warmups: 0,
          iterations: 1,
          top: 2,
          qualityGate: gate
        },
        {
          name: "shared-fail",
          queue: "JO",
          hold: false,
          beamWidth: 4,
          maxDepth: 2,
          warmups: 0,
          iterations: 1,
          top: 2,
          qualityGate: gate
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2, 10, 12]),
      fumenCodec: fakeCodec,
      search: (input) => {
        if (input.queue === "TI") {
          return [{ ...candidateNode("shared-pass"), rows: sharedRows, attack: 12 }];
        }
        return [
          { ...candidateNode("alternate-pass"), rows: alternateRows, attack: 13 },
          { ...candidateNode("shared-fail"), rows: sharedRows, attack: 12, holes: 1 }
        ];
      }
    });

    const shared = rankOpenerCandidates(report, 10).find((candidate) => candidate.path[0] === "shared-pass");

    expect(report.scenarios[1]?.top.map((candidate) => candidate.path[0])).toEqual(["alternate-pass", "shared-fail"]);
    expect(shared).toMatchObject({ survivalCount: 1, survivalRate: 0.5 });
  });

  test("renders a deduplicated best-template console summary instead of scenario noise", () => {
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "fake-scenario",
          queue: "TI",
          hold: false,
          beamWidth: 4,
          maxDepth: 1,
          warmups: 0,
          iterations: 1
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => [candidateNode("T@r0,x3")]
    });

    const summary = renderOpenerExperimentConsoleSummary(report, 1);
    expect(summary).toContain("Best opener templates");
    expect(summary).toContain(
      "#1 sources=fake-scenario survival=1 (100.0%) queueIndex=1 hold=- attack=0 difficultAttack=0 otherAttack=0 spin=0 spinAttack=0 tspin=0 tspinAttack=0 b2b=0 allClears=0 tspinPotential=0 points=0 score=10.0"
    );
    expect(summary).toContain("path: T@r0,x3");
    expect(summary).not.toContain("fake-scenario | TI");
  });

  test("explains empty quality-gated replay output and prints raw candidates", () => {
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "strict-source",
          queue: "TI",
          hold: false,
          beamWidth: 4,
          maxDepth: 1,
          warmups: 0,
          iterations: 1,
          top: 1,
          qualityGate: { minAttack: 99 },
          qualityGateRequired: false
        }
      ],
      templateReplay: {
        scenarios: [
          {
            name: "strict-replay",
            queue: "TI",
            hold: false,
            beamWidth: 4,
            maxDepth: 1,
            warmups: 0,
            iterations: 1,
            top: 1
          }
        ],
        topTemplates: 1
      },
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => [{ ...candidateNode("weak-template"), attack: 1, difficultAttack: 1 }]
    });

    const summary = renderOpenerExperimentConsoleSummary(report, 1);
    expect(summary).toContain("No opener templates passed the quality gates.");
    expect(summary).toContain("Best raw candidates");
    expect(summary).toContain("path: weak-template");
    expect(renderOpenerExperimentMarkdown(report)).toContain("No candidates passed the quality gate");
    expect(renderOpenerExperimentMarkdown(report)).toContain("No templates passed the quality gate");
  });

  test("renders native candidate queue and hold state in reports", () => {
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "native-state",
          queue: "TIOSZJL",
          hold: true,
          beamWidth: 4,
          maxDepth: 3,
          warmups: 0,
          iterations: 1,
          top: 1
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => [{ ...candidateNode("native-state"), hold: "S", queueIndex: 3 }]
    });

    expect(report.scenarios[0]?.top[0]).toMatchObject({ hold: "S", queueIndex: 3 });
    expect(renderOpenerExperimentConsoleSummary(report, 1)).toContain("queueIndex=3 hold=S");
    expect(renderOpenerExperimentMarkdown(report)).toContain("1 | 3 | S | 0 | 0 | 0 | 0 | 0 |");
  });

  test("does not rank exhausted queues by post-search T-spin potential", () => {
    const readyRows = new Array(20).fill(0);
    readyRows[1] = (1 << 3) | (1 << 5);
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "potential",
          queue: "TI",
          hold: false,
          beamWidth: 4,
          maxDepth: 2,
          warmups: 0,
          iterations: 1,
          top: 2
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => [
        { ...candidateNode("exhausted"), queueIndex: 2, rows: readyRows },
        { ...candidateNode("held-t"), hold: "T", queueIndex: 2, rows: readyRows, tSpinPotential: 1 }
      ]
    });

    expect(report.scenarios[0]?.top.find((candidate) => candidate.path[0] === "exhausted")?.tSpinPotential).toBe(0);
    expect(report.scenarios[0]?.top.find((candidate) => candidate.path[0] === "held-t")?.tSpinPotential).toBeGreaterThan(0);
    expect(renderOpenerExperimentConsoleSummary(report, 1)).toContain("path: held-t");
  });

  test("groups repeated final boards as opener template survivability", () => {
    const sharedRows = [1, 2, 3, ...new Array(17).fill(0)];
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "left",
          queue: "IT",
          hold: false,
          beamWidth: 4,
          maxDepth: 1,
          warmups: 0,
          iterations: 1,
          top: 1
        },
        {
          name: "right",
          queue: "TI",
          hold: false,
          beamWidth: 4,
          maxDepth: 1,
          warmups: 0,
          iterations: 1,
          top: 1
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2, 10, 12]),
      fumenCodec: fakeCodec,
      search: () => [{ ...candidateNode("shared-template"), rows: sharedRows }]
    });

    expect(rankOpenerTemplates(report, 1)[0]).toMatchObject({
      survivalCount: 2,
      survivalRate: 1,
      sources: ["left", "right"]
    });
    expect(renderOpenerExperimentMarkdown(report)).toContain("2 (100.0%) | left right");
  });

  test("groups mirrored final boards as the same opener template", () => {
    const leftRows = [0b0000000001, 0b0000000011, ...new Array(18).fill(0)];
    const rightRows = [0b1000000000, 0b1100000000, ...new Array(18).fill(0)];
    const report = runOpenerExperiment({
      scenarios: [rankingScenario("left", "IO"), rankingScenario("right", "OI")],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 1, 2, 3]),
      fumenCodec: fakeCodec,
      search: (input) => [{ ...candidateNode(`${input.queue}-template`), rows: input.queue === "IO" ? leftRows : rightRows }]
    });

    expect(rankOpenerTemplates(report, 1)[0]).toMatchObject({
      survivalCount: 2,
      survivalRate: 1,
      sources: ["left", "right"]
    });
  });

  test("ranks stronger T-spin firepower ahead of broader template survival", () => {
    const strongRows = [7, 7, 7, ...new Array(17).fill(0)];
    const commonRows = [3, 3, 3, ...new Array(17).fill(0)];
    const report = runOpenerExperiment({
      scenarios: [rankingScenario("strong", "HI"), rankingScenario("common-left", "LO"), rankingScenario("common-right", "OL")],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 1, 2, 3, 4, 5]),
      fumenCodec: fakeCodec,
      search: (input) => {
        if (input.queue === "HI") {
          return [
            {
              ...candidateNode("strong-template"),
              rows: strongRows,
              attack: 9,
              difficultClears: 2,
              tSpinClears: 2,
              tSpinAttack: 9,
              backToBackChain: 2
            }
          ];
        }
        return [
          {
            ...candidateNode("common-template"),
            rows: commonRows,
            attack: 7,
            difficultClears: 2,
            tSpinClears: 2,
            tSpinAttack: 7,
            backToBackChain: 2
          }
        ];
      }
    });

    const [topTemplate] = rankOpenerTemplates(report, 2);
    expect(topTemplate).toMatchObject({
      sources: ["strong"],
      best: { path: ["strong-template"], attack: 9, tSpinAttack: 9 }
    });
  });

  test("creates deterministic replay scenarios for wider template survivability checks", () => {
    const scenarios = createTemplateReplayScenarios(3);

    expect(scenarios).toHaveLength(3);
    expect(scenarios.map((scenario) => scenario.name)).toEqual(["validation-001", "validation-002", "validation-003"]);
    expect(scenarios.every((scenario) => isTwoBagQueue(scenario.queue))).toBe(true);
    expect(scenarios.every((scenario) => scenario.rules === TETRIO_TL_OPENER_SEARCH_RULES)).toBe(true);
    expect(createTemplateReplayScenarios(0)).toEqual([]);
    expect(() => createTemplateReplayScenarios(-1)).toThrow("Template replay sample size");
  });

  test("creates three-bag replay scenarios for continuation template survivability", () => {
    const scenarios = createTemplateReplayScenarios(2, { bagCount: 3, beamWidth: 256, maxDepth: 21 });

    expect(scenarios).toHaveLength(2);
    expect(scenarios.every((scenario) => isThreeBagQueue(scenario.queue))).toBe(true);
    expect(scenarios.every((scenario) => scenario.beamWidth === 256)).toBe(true);
    expect(scenarios.every((scenario) => scenario.maxDepth === 21)).toBe(true);
    expect(scenarios.every((scenario) => scenario.tags?.includes("three-bag"))).toBe(true);
    expect(scenarios.map((scenario) => scenario.queue.slice(0, 14))).toEqual(
      createTemplateReplayScenarios(2).map((scenario) => scenario.queue)
    );
    expect(() => createTemplateReplayScenarios(1, { bagCount: 0 })).toThrow("Template replay bagCount");
  });

  test("replays templates against full search results instead of only scenario top candidates", () => {
    const targetRows = [1, 2, 3, ...new Array(17).fill(0)];
    const missRows = [9, 8, 7, ...new Array(17).fill(0)];
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "source",
          queue: "IO",
          hold: false,
          beamWidth: 4,
          maxDepth: 1,
          warmups: 0,
          iterations: 1,
          top: 1,
          rules: { spinMode: "NONE", comboTable: "MULTIPLIER", kickTable: "SRS+" }
        }
      ],
      templateReplay: {
        scenarios: [replayScenario("replay-hit", "JO"), replayScenario("replay-miss", "LO")],
        topTemplates: 1
      },
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: (input) => {
        switch (input.queue) {
          case "IO":
            return [{ ...candidateNode("source-template"), rows: targetRows }];
          case "JO":
            return [
              { ...candidateNode("better-ranked-miss"), score: 100, rows: missRows },
              { ...candidateNode("lower-ranked-template"), score: 10, rows: targetRows }
            ];
          case "LO":
            return [{ ...candidateNode("miss-only"), rows: missRows }];
          default:
            throw new Error(`Unexpected queue ${input.queue}`);
        }
      }
    });

    const replay = report.templateReplay?.templates[0];
    expect(replay).toMatchObject({
      replayScenarioCount: 2,
      replayHitCount: 1,
      replayHitRate: 0.5,
      groupedSurvivalCount: 1,
      groupedSurvivalRate: 1
    });
    expect(replay?.hits[0]).toMatchObject({
      scenario: "replay-hit",
      queue: "JO",
      rank: 2,
      path: ["lower-ranked-template"]
    });

    const summary = renderOpenerExperimentConsoleSummary(report, 1);
    expect(summary).toContain("Best opener templates (validated)");
    expect(summary).toContain("replay=1/2 (50.0%) phase=1/2 (50.0%) profile=1/2 (50.0%) quality=0/2 (0.0%) grouped=1/1 (100.0%)");
    expect(renderOpenerExperimentMarkdown(report)).toContain("## Template validation");
    expect(renderOpenerExperimentMarkdown(report)).toContain(
      "1/2 (50.0%) | 1/2 (50.0%) | 1/2 (50.0%) | 0/2 (0.0%) | 1/1 (100.0%) | source"
    );
  });

  test("uses a separate replay search so replay checks can skip placement payloads", () => {
    const rows = [7, 11, 13, ...new Array(17).fill(0)];
    let sourceCalls = 0;
    let replayCalls = 0;
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "source",
          queue: "IO",
          hold: false,
          beamWidth: 4,
          maxDepth: 1,
          warmups: 0,
          iterations: 1,
          top: 1,
          rules: { spinMode: "NONE", comboTable: "MULTIPLIER", kickTable: "SRS+" }
        }
      ],
      templateReplay: {
        scenarios: [replayScenario("replay-hit", "JO")],
        topTemplates: 1
      },
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => {
        sourceCalls += 1;
        return [{ ...candidateNode("source-template"), rows, placements: [placementEvent("TSPIN_SINGLE", 2, 1, "T", 4)] }];
      },
      replaySearch: () => {
        replayCalls += 1;
        return [{ ...candidateNode("replay-template"), rows, placements: [] }];
      }
    });

    expect(sourceCalls).toBe(1);
    expect(replayCalls).toBe(1);
    expect(report.scenarios[0]?.top[0]?.clearSequence).toEqual(["TSPIN_SINGLE:2"]);
    expect(report.templateReplay?.templates[0]).toMatchObject({ replayHitCount: 1 });
    expect(report.templateReplay?.templates[0]?.hits[0]).toMatchObject({ path: ["replay-template"], clearSequence: [] });
  });

  test("prioritizes replayed templates before unreplayed firepower in replay reports", () => {
    const strongRows = [9, 8, 7, ...new Array(17).fill(0)];
    const stableRows = [1, 2, 3, ...new Array(17).fill(0)];
    const report = runOpenerExperiment({
      scenarios: [rankingScenario("strong", "HI"), rankingScenario("stable", "IO")],
      templateReplay: {
        scenarios: [replayScenario("stable-hit", "JO")],
        topTemplates: 2
      },
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 1, 2, 3]),
      fumenCodec: fakeCodec,
      search: (input) => {
        if (input.queue === "HI") {
          return [
            {
              ...candidateNode("strong"),
              rows: strongRows,
              attack: 12,
              difficultAttack: 12,
              difficultClears: 3,
              tSpinClears: 3,
              tSpinAttack: 12,
              backToBackChain: 3
            }
          ];
        }
        return [
          {
            ...candidateNode("stable"),
            rows: stableRows,
            attack: 8,
            difficultAttack: 8,
            difficultClears: 2,
            tSpinClears: 2,
            tSpinAttack: 8,
            backToBackChain: 2
          }
        ];
      }
    });

    expect(report.templateReplay?.templates.map((template) => template.sources[0])).toEqual(["stable", "strong"]);
    expect(report.templateReplay?.templates.map((template) => template.replayHitCount)).toEqual([1, 0]);
    expect(renderOpenerExperimentConsoleSummary(report, 1)).toContain("#1 sources=stable");
  });

  test("reuses full template indexes from already searched scenarios during replay", () => {
    const rows = [6, 5, 4, ...new Array(17).fill(0)];
    let calls = 0;
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "source",
          queue: "IO",
          hold: false,
          beamWidth: 4,
          maxDepth: 1,
          warmups: 0,
          iterations: 1,
          top: 1,
          rules: { spinMode: "NONE", comboTable: "MULTIPLIER", kickTable: "SRS+" }
        }
      ],
      templateReplay: {
        scenarios: [replayScenario("cached-replay", "IO")],
        topTemplates: 1
      },
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => {
        calls += 1;
        return [{ ...candidateNode("source"), rows }];
      }
    });

    expect(calls).toBe(1);
    expect(report.scenarios[0]?.reachableTemplates).toEqual([
      { key: `${[384, 640, 128, ...new Array(17).fill(0)].join(",")}|hold=-|queue=1|b2b=0|combo=0`, rank: 1 }
    ]);
    expect(report.templateReplay?.templates[0]?.hits[0]).toMatchObject({
      scenario: "cached-replay",
      rank: 1,
      cached: true
    });
  });

  test("can replay survivability separately from report generation", () => {
    const rows = [4, 5, 6, ...new Array(17).fill(0)];
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "source",
          queue: "IO",
          hold: false,
          beamWidth: 4,
          maxDepth: 1,
          warmups: 0,
          iterations: 1,
          top: 1,
          rules: { spinMode: "NONE", comboTable: "MULTIPLIER", kickTable: "SRS+" }
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => [{ ...candidateNode("source"), rows }]
    });

    const replay = replayOpenerTemplateSurvivability(
      report,
      {
        scenarios: [replayScenario("hit", "JO")],
        topTemplates: 1
      },
      () => [{ ...candidateNode("hit"), rows }]
    );

    expect(replay.templates[0]).toMatchObject({ replayHitCount: 1, replayHitRate: 1 });
    expect(() => replayOpenerTemplateSurvivability(report, { scenarios: [], topTemplates: 0 })).toThrow("Template replay topTemplates");
  });

  test("does not replay template hits across different hold or B2B state", () => {
    const rows = [1, 2, 3, ...new Array(17).fill(0)];
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "source",
          queue: "IO",
          hold: true,
          beamWidth: 4,
          maxDepth: 1,
          warmups: 0,
          iterations: 1,
          top: 1,
          rules: { spinMode: "T-SPINS", comboTable: "MULTIPLIER", kickTable: "SRS+" }
        }
      ],
      templateReplay: {
        scenarios: [replayScenario("same-board-broken-state", "JO")],
        topTemplates: 1
      },
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: (input) => {
        if (input.queue === "IO") {
          return [{ ...candidateNode("source"), rows, hold: "T", backToBackChain: 2 }];
        }
        return [{ ...candidateNode("same-board"), rows, hold: null, backToBackChain: 0 }];
      }
    });

    expect(report.templateReplay?.templates[0]).toMatchObject({
      replayScenarioCount: 1,
      replayHitCount: 0,
      replayHitRate: 0,
      hits: []
    });
  });

  test("does not replay template hits across different active combo state", () => {
    const rows = [1, 2, 3, ...new Array(17).fill(0)];
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "source",
          queue: "IO",
          hold: true,
          beamWidth: 4,
          maxDepth: 1,
          warmups: 0,
          iterations: 1,
          top: 1,
          rules: { spinMode: "T-SPINS", comboTable: "MULTIPLIER", kickTable: "SRS+" }
        }
      ],
      templateReplay: {
        scenarios: [replayScenario("same-board-broken-combo", "JO")],
        topTemplates: 1
      },
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: (input) => {
        if (input.queue === "IO") {
          return [{ ...candidateNode("source"), rows, hold: "T", queueIndex: 2, backToBackChain: 2, combo: 2 }];
        }
        return [{ ...candidateNode("same-board"), rows, hold: "T", queueIndex: 2, backToBackChain: 2, combo: 0 }];
      }
    });

    expect(report.templateReplay?.templates[0]).toMatchObject({
      replayScenarioCount: 1,
      replayHitCount: 0,
      replayHitRate: 0,
      hits: []
    });
  });

  test("counts phase replay hits at bag boundaries without exact final board matches", () => {
    const phasePlacements = Array.from({ length: 7 }, () => placementEvent("SINGLE", 0, 0, "I", 0));
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "source",
          queue: "TIJLOSZTIJLOSZ",
          hold: true,
          beamWidth: 4,
          maxDepth: 14,
          warmups: 0,
          iterations: 1,
          top: 1
        }
      ],
      templateReplay: {
        scenarios: [
          {
            name: "phase-hit",
            queue: "OJLZISTOJLZIST",
            hold: true,
            beamWidth: 4,
            maxDepth: 14,
            warmups: 0,
            iterations: 1
          }
        ],
        topTemplates: 1
      },
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: (input) => {
        if (input.queue === "TIJLOSZTIJLOSZ") {
          return [
            {
              ...candidateNode("source"),
              depth: 8,
              queueIndex: 14,
              rows: [1, ...new Array(19).fill(0)],
              placements: [...phasePlacements, placementEvent("SINGLE", 0, 0, "I", 4)]
            }
          ];
        }
        return [
          {
            ...candidateNode("phase-hit"),
            depth: 8,
            queueIndex: 14,
            rows: [2, ...new Array(19).fill(0)],
            placements: [...phasePlacements, placementEvent("SINGLE", 0, 0, "I", 5)]
          }
        ];
      }
    });

    expect(report.templateReplay?.templates[0]).toMatchObject({
      replayHitCount: 0,
      phaseReplayHitCount: 1,
      phaseReplayHitRate: 1
    });
  });

  test("does not count phase replay across mismatched phase hold, queue, B2B, or combo state", () => {
    const phasePlacements = Array.from({ length: 7 }, () => placementEvent("SINGLE", 0, 0, "I", 0));
    const phaseRows = [0b1111, ...new Array(19).fill(0)];
    const missRows = [0b11110000, ...new Array(19).fill(0)];
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "source",
          queue: "TIJLOSZTIJLOSZ",
          hold: true,
          beamWidth: 4,
          maxDepth: 14,
          warmups: 0,
          iterations: 1,
          top: 1
        }
      ],
      templateReplay: {
        scenarios: [
          {
            name: "phase-state-miss",
            queue: "OJLZISTOJLZIST",
            hold: true,
            beamWidth: 4,
            maxDepth: 14,
            warmups: 0,
            iterations: 1
          }
        ],
        topTemplates: 1
      },
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: (input) => {
        if (input.queue === "TIJLOSZTIJLOSZ") {
          return [
            {
              ...candidateNode("source"),
              depth: 8,
              queueIndex: 14,
              rows: missRows,
              placements: [...phasePlacements, placementEvent("SINGLE", 0, 0, "I", 4)]
            }
          ];
        }
        return [
          {
            ...candidateNode("phase-state-miss"),
            depth: 7,
            queueIndex: 8,
            hold: "T",
            rows: phaseRows,
            backToBackChain: 1,
            combo: 1
          }
        ];
      }
    });

    expect(report.templateReplay?.templates[0]).toMatchObject({
      replayHitCount: 0,
      phaseReplayHitCount: 0,
      phaseProfileReplayHitCount: 0
    });
  });

  test("counts continuation phase replay from the fourteen-piece frontier", () => {
    const targetRows = [7, 11, 13, ...new Array(17).fill(0)];
    const missRows = [2, 4, 8, ...new Array(17).fill(0)];
    let calls = 0;
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "source",
          queue: "TIJLOSZTIJLOSZTIJLOSZ",
          hold: true,
          beamWidth: 4,
          maxDepth: 21,
          warmups: 0,
          iterations: 1,
          top: 1
        }
      ],
      templateReplay: {
        scenarios: [
          {
            name: "frontier-hit",
            queue: "OJLZISTOJLZISTOJLZIST",
            hold: true,
            beamWidth: 4,
            maxDepth: 21,
            warmups: 0,
            iterations: 1
          }
        ],
        topTemplates: 1
      },
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: (input) => {
        calls += 1;
        if (input.queue === "TIJLOSZTIJLOSZTIJLOSZ") {
          return [
            {
              ...candidateNode(`source-depth-${input.maxDepth}`),
              rows: targetRows,
              attack: 12,
              difficultAttack: 12,
              difficultClears: 3,
              tSpinClears: 3,
              tSpinAttack: 12,
              backToBackChain: 3
            }
          ];
        }
        if (input.maxDepth === 14) {
          return [{ ...candidateNode("frontier-hit"), rows: targetRows, backToBackChain: 3 }];
        }
        return [{ ...candidateNode("final-miss"), rows: missRows }];
      }
    });

    expect(calls).toBe(3);
    expect(report.templateReplay?.templates[0]).toMatchObject({
      replayHitCount: 0,
      phaseReplayHitCount: 1,
      phaseProfileReplayHitCount: 1
    });
  });

  test("counts quality replay hits separately from exact template matches", () => {
    const targetRows = [7, 11, 13, ...new Array(17).fill(0)];
    const hitRows = [3, 5, 9, ...new Array(17).fill(0)];
    const missRows = [1, 2, 4, ...new Array(17).fill(0)];
    const report = runOpenerExperiment({
      scenarios: [rankingScenario("source", "TI")],
      templateReplay: {
        scenarios: [replayScenario("quality-hit", "JO"), replayScenario("quality-miss", "LO")],
        topTemplates: 1
      },
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 1]),
      fumenCodec: fakeCodec,
      search: (input) => {
        if (input.queue === "TI") {
          return [
            {
              ...candidateNode("source"),
              rows: targetRows,
              attack: 12,
              difficultAttack: 12,
              difficultClears: 3,
              tSpinClears: 3,
              tSpinAttack: 12,
              backToBackChain: 3
            }
          ];
        }
        if (input.queue === "JO") {
          return [
            {
              ...candidateNode("quality-hit"),
              rows: hitRows,
              attack: 12,
              difficultAttack: 12,
              difficultClears: 3,
              tSpinClears: 3,
              tSpinAttack: 12,
              backToBackChain: 3
            }
          ];
        }
        return [
          {
            ...candidateNode("quality-miss"),
            rows: missRows,
            attack: 8,
            difficultAttack: 8,
            difficultClears: 2,
            tSpinClears: 2,
            tSpinAttack: 8,
            backToBackChain: 2
          }
        ];
      }
    });

    expect(report.templateReplay?.templates[0]).toMatchObject({
      replayHitCount: 0,
      phaseReplayHitCount: 0,
      qualityReplayHitCount: 1,
      qualityReplayHitRate: 0.5
    });
  });

  test("requires replay quality hits to preserve active combo state", () => {
    const targetRows = [7, 11, 13, ...new Array(17).fill(0)];
    const hitRows = [3, 5, 9, ...new Array(17).fill(0)];
    const report = runOpenerExperiment({
      scenarios: [rankingScenario("source", "TI")],
      templateReplay: {
        scenarios: [replayScenario("combo-miss", "JO")],
        topTemplates: 1
      },
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 1]),
      fumenCodec: fakeCodec,
      search: (input) => {
        if (input.queue === "TI") {
          return [
            {
              ...candidateNode("source"),
              rows: targetRows,
              attack: 12,
              difficultAttack: 12,
              difficultClears: 3,
              tSpinClears: 3,
              tSpinAttack: 12,
              backToBackChain: 3,
              combo: 2
            }
          ];
        }
        return [
          {
            ...candidateNode("combo-miss"),
            rows: hitRows,
            attack: 12,
            difficultAttack: 12,
            difficultClears: 3,
            tSpinClears: 3,
            tSpinAttack: 12,
            backToBackChain: 3,
            combo: 1
          }
        ];
      }
    });

    expect(report.templateReplay?.templates[0]).toMatchObject({
      replayHitCount: 0,
      qualityReplayHitCount: 0
    });
  });

  test("requires replay quality hits to preserve total attack", () => {
    const targetRows = [7, 11, 13, ...new Array(17).fill(0)];
    const hitRows = [3, 5, 9, ...new Array(17).fill(0)];
    const report = runOpenerExperiment({
      scenarios: [rankingScenario("source", "TI")],
      templateReplay: {
        scenarios: [replayScenario("attack-miss", "JO")],
        topTemplates: 1
      },
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 1]),
      fumenCodec: fakeCodec,
      search: (input) => {
        if (input.queue === "TI") {
          return [
            {
              ...candidateNode("source"),
              rows: targetRows,
              attack: 15,
              difficultAttack: 14,
              difficultClears: 3,
              tSpinClears: 3,
              tSpinAttack: 14,
              backToBackChain: 3
            }
          ];
        }
        return [
          {
            ...candidateNode("attack-miss"),
            rows: hitRows,
            attack: 14,
            difficultAttack: 14,
            difficultClears: 3,
            tSpinClears: 3,
            tSpinAttack: 14,
            backToBackChain: 3
          }
        ];
      }
    });

    expect(report.templateReplay?.templates[0]).toMatchObject({
      replayHitCount: 0,
      qualityReplayHitCount: 0
    });
  });

  test("requires replay quality hits to preserve continuation potential", () => {
    const targetRows = [7, 11, 13, ...new Array(17).fill(0)];
    const report = runOpenerExperiment({
      scenarios: [{ ...rankingScenario("source", "TT"), rules: TETRIO_TL_OPENER_SEARCH_RULES }],
      templateReplay: {
        scenarios: [replayScenario("potential-miss", "JO"), replayScenario("potential-hit", "LO")],
        topTemplates: 1
      },
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 1]),
      fumenCodec: fakeCodec,
      search: (input) => {
        const base = {
          attack: 8,
          difficultAttack: 8,
          difficultClears: 2,
          tSpinClears: 2,
          tSpinAttack: 8,
          backToBackChain: 2
        };
        if (input.queue === "TT") {
          return [{ ...candidateNode("source"), ...base, rows: targetRows, tSpinPotential: 2 }];
        }
        return [
          {
            ...candidateNode(input.queue === "LO" ? "potential-hit" : "potential-miss"),
            ...base,
            rows: [3, 5, 9, ...new Array(17).fill(0)],
            tSpinPotential: input.queue === "LO" ? 2 : 1
          }
        ];
      }
    });

    expect(report.templateReplay?.templates[0]).toMatchObject({
      replayHitCount: 0,
      qualityReplayHitCount: 1,
      qualityReplayHitRate: 0.5
    });
  });

  test("ranks replayed quality by reproducible B2B T-spin firepower", () => {
    const strongRows = [31, 7, 11, ...new Array(17).fill(0)];
    const broadRows = [3, 5, 9, ...new Array(17).fill(0)];
    const report = runOpenerExperiment({
      scenarios: [rankingScenario("strong", "TI"), rankingScenario("broad", "JO")],
      templateReplay: {
        scenarios: [replayScenario("broad-quality-a", "LO"), replayScenario("broad-quality-b", "SO")],
        topTemplates: 2
      },
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 1, 2, 3]),
      fumenCodec: fakeCodec,
      search: (input) => {
        if (input.queue === "TI") {
          return [
            {
              ...candidateNode("strong"),
              rows: strongRows,
              attack: 12,
              difficultAttack: 12,
              difficultClears: 3,
              tSpinClears: 3,
              tSpinAttack: 12,
              backToBackChain: 3
            }
          ];
        }
        if (input.queue === "JO") {
          return [
            {
              ...candidateNode("broad"),
              rows: broadRows,
              attack: 8,
              difficultAttack: 8,
              difficultClears: 2,
              tSpinClears: 2,
              tSpinAttack: 8,
              backToBackChain: 2
            }
          ];
        }
        return [
          {
            ...candidateNode("broad-quality"),
            rows: [1, 2, 4, ...new Array(17).fill(0)],
            attack: 8,
            difficultAttack: 8,
            difficultClears: 2,
            tSpinClears: 2,
            tSpinAttack: 8,
            backToBackChain: 2
          }
        ];
      }
    });

    expect(report.templateReplay?.templates.map((template) => template.sources[0])).toEqual(["broad", "strong"]);
    expect(report.templateReplay?.templates.map((template) => template.qualityReplayHitCount)).toEqual([2, 0]);
  });

  test("groups phase replay across non-best sources of the same final template", () => {
    const sharedRows = [7, 11, 13, ...new Array(17).fill(0)];
    const phaseA = Array.from({ length: 7 }, () => placementEvent("SINGLE", 0, 0, "I", 0));
    const phaseB = Array.from({ length: 7 }, () => placementEvent("SINGLE", 0, 0, "I", 4));
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "best-source",
          queue: "TIJLOSZTIJLOSZ",
          hold: true,
          beamWidth: 4,
          maxDepth: 14,
          warmups: 0,
          iterations: 1,
          top: 1
        },
        {
          name: "phase-source",
          queue: "OJLZISTOJLZIST",
          hold: true,
          beamWidth: 4,
          maxDepth: 14,
          warmups: 0,
          iterations: 1,
          top: 1
        }
      ],
      templateReplay: {
        scenarios: [
          {
            name: "phase-hit",
            queue: "SZTILJOSZTILJO",
            hold: true,
            beamWidth: 4,
            maxDepth: 14,
            warmups: 0,
            iterations: 1
          }
        ],
        topTemplates: 1
      },
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 1, 2, 3]),
      fumenCodec: fakeCodec,
      search: (input) => {
        if (input.queue === "TIJLOSZTIJLOSZ") {
          return [
            {
              ...candidateNode("best-source"),
              rows: sharedRows,
              placements: [...phaseA, placementEvent("SINGLE", 0, 0, "I", 0)],
              attack: 12,
              difficultAttack: 12,
              difficultClears: 3,
              tSpinClears: 3,
              tSpinAttack: 12,
              backToBackChain: 3
            }
          ];
        }
        if (input.queue === "OJLZISTOJLZIST") {
          return [
            {
              ...candidateNode("phase-source"),
              rows: sharedRows,
              placements: [...phaseB, placementEvent("SINGLE", 0, 0, "I", 0)],
              backToBackChain: 3
            }
          ];
        }
        return [
          {
            ...candidateNode("phase-hit"),
            rows: [19, ...new Array(19).fill(0)],
            placements: [...phaseB, placementEvent("SINGLE", 0, 0, "I", 0)]
          }
        ];
      }
    });

    expect(report.templateReplay?.templates[0]).toMatchObject({
      replayHitCount: 0,
      phaseReplayHitCount: 1,
      groupedSurvivalCount: 2,
      groupedScenarioCount: 2
    });
  });

  test("reuses cached full phase indexes instead of only cached top candidates", () => {
    const targetRows = [5, 8, 13, ...new Array(17).fill(0)];
    const cachedTopRows = [2, 4, 8, ...new Array(17).fill(0)];
    const cachedLowerRows = [3, 6, 12, ...new Array(17).fill(0)];
    const targetPhase = Array.from({ length: 7 }, () => placementEvent("SINGLE", 0, 0, "I", 0));
    const wrongPhase = Array.from({ length: 7 }, () => placementEvent("SINGLE", 0, 0, "I", 4));
    let calls = 0;
    const cachedScenario = {
      name: "cached-source",
      queue: "OJLZISTOJLZIST",
      hold: true,
      beamWidth: 4,
      maxDepth: 14,
      warmups: 0,
      iterations: 1,
      top: 1
    };
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "target-source",
          queue: "TIJLOSZTIJLOSZ",
          hold: true,
          beamWidth: 4,
          maxDepth: 14,
          warmups: 0,
          iterations: 1,
          top: 1
        },
        cachedScenario
      ],
      templateReplay: {
        scenarios: [{ ...cachedScenario, name: "cached-replay" }],
        topTemplates: 1
      },
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 1, 2, 3]),
      fumenCodec: fakeCodec,
      search: (input) => {
        calls += 1;
        if (input.queue === "TIJLOSZTIJLOSZ") {
          return [
            {
              ...candidateNode("target-source"),
              rows: targetRows,
              placements: [...targetPhase, placementEvent("SINGLE", 0, 0, "I", 0)],
              attack: 12,
              difficultAttack: 12,
              difficultClears: 3,
              tSpinClears: 3,
              tSpinAttack: 12,
              backToBackChain: 3
            }
          ];
        }
        return [
          {
            ...candidateNode("cached-top-wrong-phase"),
            rows: cachedTopRows,
            placements: [...wrongPhase, placementEvent("SINGLE", 0, 0, "I", 0)]
          },
          {
            ...candidateNode("cached-lower-target-phase"),
            rows: cachedLowerRows,
            placements: [...targetPhase, placementEvent("SINGLE", 0, 0, "I", 0)]
          }
        ];
      }
    });

    expect(calls).toBe(2);
    expect(report.templateReplay?.templates[0]).toMatchObject({
      replayHitCount: 0,
      phaseReplayHitCount: 1
    });
  });

  test("keeps T-spin continuation potential before slicing scenario top candidates", () => {
    const readyRows = new Array(20).fill(0);
    readyRows[1] = (1 << 3) | (1 << 5);
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "potential-slice",
          queue: "IT",
          hold: false,
          beamWidth: 4,
          maxDepth: 1,
          warmups: 0,
          iterations: 1,
          top: 1
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => [
        { ...candidateNode("aaa-quiet"), queueIndex: 1, rows: new Array(20).fill(0) },
        { ...candidateNode("zzz-potential"), queueIndex: 1, rows: readyRows, tSpinPotential: 1 }
      ]
    });

    expect(report.scenarios[0]?.top).toHaveLength(1);
    expect(report.scenarios[0]?.top[0]).toMatchObject({
      path: ["zzz-potential"]
    });
    expect(report.scenarios[0]?.top[0]?.tSpinPotential).toBeGreaterThan(0);
  });

  test("does not add T-spin continuation potential when spins are disabled", () => {
    const readyRows = new Array(20).fill(0);
    readyRows[1] = (1 << 3) | (1 << 5);
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "spinless",
          queue: "IT",
          hold: false,
          beamWidth: 4,
          maxDepth: 1,
          warmups: 0,
          iterations: 1,
          top: 1,
          rules: { spinMode: "NONE", comboTable: "MULTIPLIER", kickTable: "SRS+" }
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => [{ ...candidateNode("ready-but-spinless"), queueIndex: 1, rows: readyRows, tSpinPotential: 1 }]
    });

    expect(report.scenarios[0]?.top[0]).toMatchObject({
      path: ["ready-but-spinless"],
      tSpinPotential: 0
    });
  });

  test("ranks opener candidates by firepower before search order", () => {
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "ranking",
          queue: "TI",
          hold: false,
          beamWidth: 4,
          maxDepth: 1,
          warmups: 0,
          iterations: 1,
          top: 2
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => [
        {
          score: 100,
          firepowerScore: 0,
          depth: 1,
          queueIndex: 1,
          rows: new Array(20).fill(0),
          path: ["quiet"],
          placements: [],
          attack: 0,
          points: 0,
          combo: 0,
          maxCombo: 0,
          backToBackChain: 0,
          allClears: 0,
          difficultClears: 0,
          difficultAttack: 0,
          tSpinClears: 0,
          tSpinAttack: 0,
          tSpinPotential: 0,
          occupiedCells: 4,
          clearedLines: 0,
          aggregateHeight: 2,
          holes: 0,
          bumpiness: 0
        },
        {
          score: 20,
          firepowerScore: 400,
          depth: 1,
          queueIndex: 1,
          rows: new Array(20).fill(0),
          path: ["attack"],
          placements: [],
          attack: 4,
          points: 400,
          combo: 0,
          maxCombo: 0,
          backToBackChain: 0,
          allClears: 0,
          difficultClears: 0,
          difficultAttack: 0,
          tSpinClears: 0,
          tSpinAttack: 0,
          tSpinPotential: 0,
          occupiedCells: 4,
          clearedLines: 2,
          aggregateHeight: 2,
          holes: 0,
          bumpiness: 0
        }
      ]
    });

    expect(report.scenarios[0]?.top.map((candidate) => candidate.path[0])).toEqual(["attack", "quiet"]);
  });

  test("ranks holeless equivalent-firepower candidates before higher board score", () => {
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "hole-ranking",
          queue: "TT",
          hold: false,
          beamWidth: 4,
          maxDepth: 2,
          warmups: 0,
          iterations: 1,
          top: 2
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => [
        {
          ...candidateNode("hole-score"),
          score: 20_000,
          firepowerScore: 20_000,
          attack: 12,
          difficultAttack: 12,
          difficultClears: 3,
          tSpinClears: 3,
          tSpinAttack: 12,
          backToBackChain: 3,
          holes: 1
        },
        {
          ...candidateNode("holeless"),
          score: 10_000,
          firepowerScore: 10_000,
          attack: 12,
          difficultAttack: 12,
          difficultClears: 3,
          tSpinClears: 3,
          tSpinAttack: 12,
          backToBackChain: 3,
          holes: 0
        }
      ]
    });

    expect(report.scenarios[0]?.top.map((candidate) => candidate.path[0])).toEqual(["holeless", "hole-score"]);
  });

  test("ranks real T-spin line clears before combo-only attack", () => {
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "ranking",
          queue: "TT",
          hold: false,
          beamWidth: 4,
          maxDepth: 2,
          warmups: 0,
          iterations: 1,
          top: 2
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => [
        {
          score: 20_000,
          firepowerScore: 20_000,
          depth: 2,
          queueIndex: 2,
          rows: new Array(20).fill(0),
          path: ["combo"],
          placements: [],
          attack: 10,
          points: 2_000,
          combo: 4,
          maxCombo: 4,
          backToBackChain: 0,
          allClears: 0,
          difficultClears: 0,
          difficultAttack: 0,
          tSpinClears: 0,
          tSpinAttack: 0,
          tSpinPotential: 0,
          occupiedCells: 4,
          clearedLines: 4,
          aggregateHeight: 2,
          holes: 0,
          bumpiness: 0
        },
        {
          score: 9_000,
          firepowerScore: 9_000,
          depth: 2,
          queueIndex: 2,
          rows: new Array(20).fill(0),
          path: ["tspin"],
          placements: [],
          attack: 4,
          points: 1_200,
          combo: 1,
          maxCombo: 1,
          backToBackChain: 1,
          allClears: 0,
          difficultClears: 1,
          difficultAttack: 4,
          tSpinClears: 1,
          tSpinAttack: 4,
          tSpinPotential: 0,
          occupiedCells: 4,
          clearedLines: 2,
          aggregateHeight: 2,
          holes: 0,
          bumpiness: 0
        }
      ]
    });

    expect(report.scenarios[0]?.top.map((candidate) => candidate.path[0])).toEqual(["tspin", "combo"]);
  });

  test("omits zero-line spin markers from candidate clear summaries", () => {
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "clear-summary",
          queue: "TT",
          hold: false,
          beamWidth: 4,
          maxDepth: 2,
          warmups: 0,
          iterations: 1,
          top: 1
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => [
        {
          ...candidateNode("spin setup"),
          attack: 2,
          difficultAttack: 2,
          placements: [placementEvent("TSPIN_MINI", 0, 0, "T", 0), placementEvent("TSPIN_SINGLE", 2, 1, "I", 4)]
        }
      ]
    });

    expect(report.scenarios[0]?.top[0]?.clearSequence).toEqual(["I_SPIN_SINGLE:2"]);
    expect(report.scenarios[0]?.top[0]).toMatchObject({ difficultAttack: 2, nonDifficultAttack: 0 });
  });

  test("uses native difficult attack instead of report-side clear-name reconstruction", () => {
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "native-difficult-attack",
          queue: "TT",
          hold: false,
          beamWidth: 4,
          maxDepth: 2,
          warmups: 0,
          iterations: 1,
          top: 1
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => [
        {
          ...candidateNode("forced mini"),
          attack: 2,
          difficultAttack: 2,
          placements: [placementEvent("TSPIN_MINI", 2, 1, "T", 0)]
        }
      ]
    });

    expect(report.scenarios[0]?.top[0]).toMatchObject({
      clearSequence: ["TSPIN_MINI:2"],
      difficultAttack: 2,
      nonDifficultAttack: 0
    });
  });

  test("omits zero-attack line clears from candidate clear summaries", () => {
    const report = runOpenerExperiment({
      scenarios: [
        {
          name: "zero-attack-clear",
          queue: "IT",
          hold: false,
          beamWidth: 4,
          maxDepth: 2,
          warmups: 0,
          iterations: 1,
          top: 1
        }
      ],
      clock: createClock("2026-05-14T00:00:00.000Z", [0, 2]),
      fumenCodec: fakeCodec,
      search: () => [
        {
          ...candidateNode("single then tspin"),
          attack: 2,
          placements: [placementEvent("SINGLE", 0, 1, "I", 4), placementEvent("TSPIN_SINGLE", 2, 1, "T", 0)]
        }
      ]
    });

    expect(report.scenarios[0]?.top[0]?.clearSequence).toEqual(["TSPIN_SINGLE:2"]);
  });
});

function candidateNode(path: string) {
  return {
    score: 10,
    firepowerScore: 0,
    depth: 1,
    queueIndex: 1,
    rows: new Array(20).fill(0),
    path: [path],
    placements: [],
    attack: 0,
    points: 0,
    combo: 0,
    maxCombo: 0,
    backToBackChain: 0,
    allClears: 0,
    difficultClears: 0,
    difficultAttack: 0,
    tSpinClears: 0,
    tSpinAttack: 0,
    tSpinPotential: 0,
    occupiedCells: 4,
    clearedLines: 0,
    aggregateHeight: 2,
    holes: 0,
    bumpiness: 0
  };
}

function placementEvent(
  clearName: Extract<NativeClearName, "SINGLE" | "TSPIN_MINI" | "TSPIN_SINGLE">,
  attack: number,
  clearedLines: number,
  piece: "T" | "I",
  x: number
): NativeBeamPlacement {
  const spinClear = clearName !== "SINGLE";
  return {
    piece,
    rotation: 0,
    x,
    y: 0,
    usedHold: false,
    cells:
      piece === "T"
        ? [
            { x, y: 0 },
            { x: x + 1, y: 0 },
            { x: x + 2, y: 0 },
            { x: x + 1, y: 1 }
          ]
        : [
            { x, y: 0 },
            { x: x + 1, y: 0 },
            { x: x + 2, y: 0 },
            { x: x + 3, y: 0 }
          ],
    path: `${piece}@r0,x${x},y0`,
    spinKind: spinClear ? "T_SPIN_MINI" : "NONE",
    spin: spinClear,
    mini: spinClear,
    immobile: false,
    occupiedCorners: 3,
    clearedLines,
    clearName,
    attack,
    baseAttack: attack,
    points: 0,
    combo: 0,
    backToBackChain: 0,
    backToBack: false,
    backToBackBonus: 0,
    backToBackChargeAttack: 0,
    allClear: false,
    allClearBonus: 0
  };
}

const fakeCodec: FumenCodec = {
  encodePages: () => "v115@test",
  decode: () => [],
  createUrl: () => urls.edit,
  createUrls: () => urls
};

function isTwoBagQueue(queue: string): boolean {
  if (queue.length !== 14) {
    return false;
  }
  return isSingleBag(queue.slice(0, 7)) && isSingleBag(queue.slice(7));
}

function isSingleBag(queue: string): boolean {
  return queue.split("").sort().join("") === "IJLOSTZ";
}

function isThreeBagQueue(queue: string): boolean {
  if (queue.length !== 21) {
    return false;
  }
  return isSingleBag(queue.slice(0, 7)) && isSingleBag(queue.slice(7, 14)) && isSingleBag(queue.slice(14));
}

function replayScenario(name: string, queue: string) {
  return {
    name,
    queue,
    hold: false,
    beamWidth: 4,
    maxDepth: 1,
    warmups: 0,
    iterations: 1,
    top: 1,
    rules: { spinMode: "NONE", comboTable: "MULTIPLIER", kickTable: "SRS+" } as const
  };
}

function rankingScenario(name: string, queue: string) {
  return {
    ...replayScenario(name, queue),
    iterations: 1
  };
}

function createClock(iso: string, readings: readonly number[]): OpenerExperimentClock {
  let index = 0;
  return {
    isoNow: () => iso,
    nowMs: () => {
      const value = readings[index];
      index += 1;
      if (value === undefined) {
        throw new Error("clock exhausted");
      }
      return value;
    }
  };
}
