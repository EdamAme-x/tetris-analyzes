import { describe, expect, test } from "bun:test";
import { OPENER_ENGINE_TASKS } from "../src/domain/opener-engine-tasks";

describe("opener engine task list", () => {
  test("tracks every known blocker before the generator is production-ready", () => {
    expect(OPENER_ENGINE_TASKS.map((task) => task.id)).toEqual([
      "srs-reachability",
      "spin-detection",
      "firepower-evaluation",
      "pc-continuation",
      "bag-probability",
      "tetrio-rules-parity"
    ]);
    expect(OPENER_ENGINE_TASKS[0]?.status).toBe("in-progress");
  });
});
