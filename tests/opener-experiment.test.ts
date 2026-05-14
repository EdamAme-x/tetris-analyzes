import { describe, expect, test } from "bun:test";
import type { FumenCodec, FumenUrls } from "../src/domain/fumen";
import { renderOpenerExperimentMarkdown, runOpenerExperiment, type OpenerExperimentClock } from "../src/application/run-opener-experiment";

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
            depth: 2,
            queueIndex: 2,
            rows: new Array(20).fill(0),
            path: ["T@r0,x3", "I@r1,x0"],
            placements: [],
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
          depth: 1,
          queueIndex: 1,
          rows: new Array(20).fill(0),
          path: ["T@r0,x3"],
          placements: [],
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
    expect(markdown).toContain("fake-scenario | TI | false | 4 | 1 | 2.000");
    expect(markdown).toContain("## Top templates");
    expect(markdown).toContain("[fumen](https://fumen.zui.jp/?m115@test)");
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
