import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { assertNativeBinding, nativeBindingPath } from "../src/infrastructure/native/load-native-binding";
import type { NativeBinding } from "../src/infrastructure/native/binding-types";

describe("native binding loader", () => {
  test("resolves native/index.js independently of process cwd", () => {
    const originalCwd = process.cwd();
    const before = nativeBindingPath();
    const tempDir = mkdtempSync(join(tmpdir(), "tetris-analyzes-cwd-"));

    try {
      process.chdir(tempDir);

      expect(nativeBindingPath()).toBe(before);
      expect(nativeBindingPath()).not.toBe(join(tempDir, "native", "index.js"));
    } finally {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("accepts only the exact native binding surface", () => {
    const binding = createValidBinding();

    expect(() => assertNativeBinding(binding, "test-binding")).not.toThrow();
    expect(() => assertNativeBinding({ ...binding, extraExport: () => undefined }, "test-binding")).toThrow(
      "unexpected bindings: extraExport"
    );
    expect(() => assertNativeBinding({ ...binding, searchOpenerBeamWithPlacements: 1 }, "test-binding")).toThrow(
      "does not export searchOpenerBeamWithPlacements"
    );
  });
});

function createValidBinding(): NativeBinding {
  return {
    createEmptyBoard: () => new Uint16Array(),
    copyBoardRows: (rows) => rows,
    isPerfectClear: () => false,
    countOccupiedCells: () => 0,
    clearFullLines: (rows) => rows,
    batchCountOccupiedCells: () => new Uint32Array(),
    batchClearFullLines: (rows) => rows,
    batchEvaluateBoards: () => new Uint32Array(),
    createGarbageRows: () => new Uint16Array(),
    applyGarbage: (rows) => rows,
    rowsToFumenField: () => "",
    batchRowsToFumenFields: () => [],
    canReachOpenerPlacement: () => false,
    detectOpenerSpin: () => ({ kind: "NONE", spin: false, mini: false, immobile: false, occupiedCorners: 0, clearedLines: 0 }),
    estimateOpenerTSpinPotential: () => 0,
    evaluateOpenerFirepower: () => ({
      attack: 0,
      points: 0,
      combo: 0,
      maxCombo: 0,
      backToBackChain: 0,
      allClears: 0,
      firepowerScore: 0,
      events: []
    }),
    searchOpenerBeam: () => [],
    searchOpenerBeamCompact: () => [],
    searchOpenerBeamWithPlacements: () => [],
    evaluateOpenerBag: () => ({
      bag: "TIJLOSZ",
      totalQueues: 0,
      searchedQueues: 0,
      exact: true,
      buildableQueues: 0,
      buildRate: 0,
      averageScore: 0,
      averageAttack: 0,
      averageFirepowerScore: 0,
      averageHoles: 0,
      averageBumpiness: 0,
      worstScore: 0,
      bestScore: 0,
      paretoFront: [],
      topQueues: []
    }),
    mineOpenerBagTemplates: () => ({
      bag: "TIJLOSZ",
      totalQueues: 0,
      searchedQueues: 0,
      exact: true,
      buildableQueues: 0,
      templateCount: 0,
      topTemplates: []
    })
  };
}
