import { describe, expect, test } from "bun:test";
import { searchOpenerBeam, searchOpenerBeamWithPlacements } from "../src/application/search-opener";

describe("native opener beam search", () => {
  test("searches placements in native code and returns scored beam nodes without detail payload by default", () => {
    const nodes = searchOpenerBeam({ queue: "TILJSZO", beamWidth: 16, hold: true, maxDepth: 4 });

    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.length).toBeLessThanOrEqual(16);
    expect(nodes[0]?.depth).toBe(4);
    expect(nodes[0]?.rows).toHaveLength(20);
    expect(nodes[0]?.path).toHaveLength(4);
    expect(nodes[0]?.placements).toHaveLength(0);
    expect(nodes[0]?.occupiedCells ?? 0).toBeGreaterThan(0);
    expect(nodes[0]?.occupiedCells ?? 0).toBeLessThanOrEqual(16);
    for (let index = 1; index < nodes.length; index += 1) {
      expect(nodes[index - 1]?.score ?? 0).toBeGreaterThanOrEqual(nodes[index]?.score ?? 0);
    }
  });

  test("returns placement details for fumen preview generation when requested", () => {
    const nodes = searchOpenerBeamWithPlacements({ queue: "TILJSZO", beamWidth: 16, hold: true, maxDepth: 4 });

    expect(nodes[0]?.placements).toHaveLength(4);
    expect(nodes[0]?.placements[0]?.cells).toHaveLength(4);
    expect(nodes[0]?.placements[0]?.path).toContain(",y");
  });

  test("models hold inside the native search brancher", () => {
    const nodes = searchOpenerBeamWithPlacements({ queue: "ZI", beamWidth: 128, hold: true, maxDepth: 1 });

    expect(nodes.some((node) => node.hold === "Z" && node.path[0]?.startsWith("hold:I@") && node.placements[0]?.usedHold === true)).toBe(
      true
    );
  });

  test("rejects invalid queues before searching", () => {
    expect(() => searchOpenerBeam({ queue: "TX", beamWidth: 8 })).toThrow("Unknown tetromino");
  });
});
