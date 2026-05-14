import { describe, expect, test } from "bun:test";
import type { FumenCodec, FumenUrls } from "../src/domain/fumen";
import type { NativeBeamPlacement, NativeClearName } from "../src/infrastructure/native/binding-types";
import {
  CONTINUATION_OPENER_EXPERIMENT_SCENARIOS,
  DEFAULT_OPENER_EXPERIMENT_SCENARIOS,
  DISCOVERY_OPENER_EXPERIMENT_SCENARIOS,
  SURVEY_OPENER_EXPERIMENT_SCENARIOS,
  TETRIO_TL_OPENER_SEARCH_RULES,
  createTemplateReplayScenarios,
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
  test("defaults to a two-bag T-spin-oriented opener search", () => {
    expect(DEFAULT_OPENER_EXPERIMENT_SCENARIOS[0]).toMatchObject({
      name: "best-two-bag-tspin-openers",
      queue: "SZILOJTSTOZLJI",
      hold: true,
      beamWidth: 1024,
      maxDepth: 14,
      rules: TETRIO_TL_OPENER_SEARCH_RULES
    });
  });

  test("provides a two-bag TL survey preset for comparing several opener seeds", () => {
    expect(SURVEY_OPENER_EXPERIMENT_SCENARIOS).toHaveLength(7);
    expect(SURVEY_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.rules === TETRIO_TL_OPENER_SEARCH_RULES)).toBe(true);
    expect(new Set(SURVEY_OPENER_EXPERIMENT_SCENARIOS.map((scenario) => scenario.queue)).size).toBe(
      SURVEY_OPENER_EXPERIMENT_SCENARIOS.length
    );
    expect(SURVEY_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => isTwoBagQueue(scenario.queue))).toBe(true);
    expect(SURVEY_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.beamWidth === 1024)).toBe(true);
    expect(SURVEY_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.tags?.includes("survey"))).toBe(true);
  });

  test("provides deterministic two-bag discovery queues beyond the named survey seeds", () => {
    const queues = DISCOVERY_OPENER_EXPERIMENT_SCENARIOS.map((scenario) => scenario.queue);

    expect(DISCOVERY_OPENER_EXPERIMENT_SCENARIOS).toHaveLength(24);
    expect(new Set(queues).size).toBe(queues.length);
    expect(DISCOVERY_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.name.startsWith("discover-"))).toBe(true);
    expect(DISCOVERY_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.queue.length === 14)).toBe(true);
    expect(DISCOVERY_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.rules === TETRIO_TL_OPENER_SEARCH_RULES)).toBe(true);
  });

  test("provides a three-bag continuation preset for B2B T-spin chain experiments", () => {
    expect(CONTINUATION_OPENER_EXPERIMENT_SCENARIOS).toHaveLength(SURVEY_OPENER_EXPERIMENT_SCENARIOS.length);
    expect(CONTINUATION_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.name.startsWith("continuation-"))).toBe(true);
    expect(CONTINUATION_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => isThreeBagQueue(scenario.queue))).toBe(true);
    expect(CONTINUATION_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.beamWidth === 256)).toBe(true);
    expect(CONTINUATION_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.maxDepth === 21)).toBe(true);
    expect(CONTINUATION_OPENER_EXPERIMENT_SCENARIOS.every((scenario) => scenario.tags?.includes("three-bag"))).toBe(true);
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
          spinMode: "T-SPINS",
          comboTable: "MULTIPLIER",
          kickTable: "SRS+"
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
            maxCombo: 0,
            backToBackChain: 0,
            allClears: 0,
            difficultClears: 0,
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
    expect(report.scenarios[0]?.top[0]?.previewUrl).toBe(urls.view);
    expect(report.scenarios[0]?.top[0]?.urls.view).toBe(urls.view);
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
          maxCombo: 0,
          backToBackChain: 0,
          allClears: 0,
          difficultClears: 0,
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
    expect(markdown).toContain("Rules: spins=T-SPINS, combo=MULTIPLIER, kicks=SRS+");
    expect(markdown).toContain("## Best openers");
    expect(markdown).toContain("## Template survivability");
    expect(markdown).toContain("fake-scenario | TI | false | T-SPINS | MULTIPLIER | SRS+ | 4 | 1 | 2.000");
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
    expect(markdown).toContain("custom-rules | TI | false | NONE | NONE | NONE | 4 | 1 | 2.000");
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
      "#1 sources=fake-scenario survival=1 (100.0%) queueIndex=1 hold=- attack=0 difficultAttack=0 otherAttack=0 tspin=0 tspinAttack=0 b2b=0 tspinPotential=0 points=0 score=10.0"
    );
    expect(summary).toContain("path: T@r0,x3");
    expect(summary).not.toContain("fake-scenario | TI");
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

  test("creates deterministic replay scenarios for wider template survivability checks", () => {
    const scenarios = createTemplateReplayScenarios(3);

    expect(scenarios).toHaveLength(3);
    expect(scenarios.map((scenario) => scenario.name)).toEqual(["replay-01", "replay-02", "replay-03"]);
    expect(scenarios.every((scenario) => isTwoBagQueue(scenario.queue))).toBe(true);
    expect(scenarios.every((scenario) => scenario.rules === TETRIO_TL_OPENER_SEARCH_RULES)).toBe(true);
    expect(createTemplateReplayScenarios(0)).toEqual([]);
    expect(() => createTemplateReplayScenarios(-1)).toThrow("Template replay sample size");
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
    expect(summary).toContain("Best opener templates (replayed)");
    expect(summary).toContain("replay=1/2 (50.0%) grouped=1 (100.0%)");
    expect(renderOpenerExperimentMarkdown(report)).toContain("## Template replay");
    expect(renderOpenerExperimentMarkdown(report)).toContain("1/2 (50.0%) | 1 (100.0%) | source");
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
    expect(report.scenarios[0]?.reachableTemplates).toEqual([{ key: rows.join(","), rank: 1 }]);
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
          maxCombo: 0,
          backToBackChain: 0,
          allClears: 0,
          difficultClears: 0,
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
          maxCombo: 0,
          backToBackChain: 0,
          allClears: 0,
          difficultClears: 0,
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
          maxCombo: 4,
          backToBackChain: 0,
          allClears: 0,
          difficultClears: 0,
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
          maxCombo: 1,
          backToBackChain: 1,
          allClears: 0,
          difficultClears: 1,
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
          placements: [placementEvent("TSPIN_MINI", 0, 0, "T", 0), placementEvent("TSPIN_SINGLE", 2, 1, "I", 4)]
        }
      ]
    });

    expect(report.scenarios[0]?.top[0]?.clearSequence).toEqual(["TSPIN_SINGLE:2"]);
    expect(report.scenarios[0]?.top[0]).toMatchObject({ difficultAttack: 2, nonDifficultAttack: 0 });
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
    maxCombo: 0,
    backToBackChain: 0,
    allClears: 0,
    difficultClears: 0,
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
  clearName: Extract<NativeClearName, "TSPIN_MINI" | "TSPIN_SINGLE">,
  attack: number,
  clearedLines: number,
  piece: "T" | "I",
  x: number
): NativeBeamPlacement {
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
    spinKind: "T_SPIN_MINI",
    spin: true,
    mini: true,
    immobile: false,
    occupiedCorners: 3,
    clearedLines,
    clearName,
    attack,
    baseAttack: attack,
    points: 0,
    combo: 0,
    backToBack: false,
    backToBackBonus: 0,
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
