import { describe, expect, test } from "bun:test";
import type { FumenCodec, FumenUrls } from "../src/domain/fumen";
import {
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
        expect(input).toEqual({ queue: "TI", beamWidth: 8, hold: true, maxDepth: 2 });
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
    expect(markdown).toContain("## Best openers");
    expect(markdown).toContain("fake-scenario | TI | false | 4 | 1 | 2.000");
    expect(markdown).toContain("## Candidate details");
    expect(markdown).toContain("[view](https://fumen.zui.jp/?m115@test)");
  });

  test("renders a best-candidate console summary instead of scenario noise", () => {
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
          occupiedCells: 4,
          clearedLines: 0,
          aggregateHeight: 2,
          holes: 0,
          bumpiness: 0
        }
      ]
    });

    const summary = renderOpenerExperimentConsoleSummary(report, 1);
    expect(summary).toContain("Best opener candidates");
    expect(summary).toContain("#1 attack=0 points=0 score=10.0");
    expect(summary).toContain("path: T@r0,x3");
    expect(summary).not.toContain("fake-scenario | TI");
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
});

const fakeCodec: FumenCodec = {
  encodePages: () => "v115@test",
  decode: () => [],
  createUrl: () => urls.edit,
  createUrls: () => urls
};

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
