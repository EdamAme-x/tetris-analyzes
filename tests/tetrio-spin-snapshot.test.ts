import { describe, expect, test } from "bun:test";
import { detectOpenerSpinAfterRotation, type SearchPiece } from "../src/application/search-opener";
import { bitBoardFromRows } from "../src/infrastructure/bitboard/native-bitboard";
import type { NativeKickTable, NativeSpinDetection, NativeSpinMode } from "../src/infrastructure/native/binding-types";
import { TETRIO_SPIN_SNAPSHOT } from "./fixtures/tetrio-spin.generated";

type SpinSnapshotExpected =
  | { readonly success: false; readonly spin: NativeSpinDetection }
  | {
      readonly success: true;
      readonly rotation: number;
      readonly x: number;
      readonly y: number;
      readonly kickIndex: number | null;
      readonly spin: NativeSpinDetection;
    };

describe("TETR.IO spin-state snapshots", () => {
  test("matches generated tetrio.js rotation and spin-state oracle cases", () => {
    const failures: string[] = [];
    const coverage = {
      direct: 0,
      kicked: 0,
      failed: 0,
      normal: 0,
      mini: 0,
      nonT: 0,
      kickIndex3FullT: 0,
      none: 0,
      lineClear: 0,
      modes: new Set<string>()
    };

    for (const fixture of TETRIO_SPIN_SNAPSHOT.cases) {
      const actual = normalizeSpinAfterRotation(
        detectOpenerSpinAfterRotation({
          rows: bitBoardFromRows([...fixture.rows]),
          piece: fixture.piece as SearchPiece,
          rotation: fixture.from.rotation,
          x: fixture.from.x,
          y: fixture.from.y,
          direction: fixture.direction,
          spinMode: fixture.spinMode as NativeSpinMode,
          kickTable: fixture.kickTable as NativeKickTable
        })
      );
      if (JSON.stringify(actual) !== JSON.stringify(fixture.expected)) {
        failures.push(`${fixture.name}: expected ${JSON.stringify(fixture.expected)}, got ${JSON.stringify(actual)}`);
      }
      addCoverage(coverage, fixture);
    }

    expect(TETRIO_SPIN_SNAPSHOT.cases.length).toBeGreaterThanOrEqual(2_000);
    expect(new Set(TETRIO_SPIN_SNAPSHOT.cases.map((fixture) => fixture.kickTable)).size).toBeGreaterThanOrEqual(8);
    expect(coverage.direct).toBeGreaterThanOrEqual(180);
    expect(coverage.kicked).toBeGreaterThanOrEqual(120);
    expect(coverage.failed).toBeGreaterThanOrEqual(180);
    expect(coverage.normal).toBeGreaterThanOrEqual(24);
    expect(coverage.mini).toBeGreaterThanOrEqual(24);
    expect(coverage.nonT).toBeGreaterThanOrEqual(12);
    expect(coverage.kickIndex3FullT).toBeGreaterThanOrEqual(1);
    expect(coverage.none).toBeGreaterThanOrEqual(180);
    expect(coverage.lineClear).toBeGreaterThanOrEqual(24);
    expect(coverage.modes.size).toBe(10);
    expect(failures.slice(0, 20)).toEqual([]);
  });
});

function normalizeSpinAfterRotation(value: ReturnType<typeof detectOpenerSpinAfterRotation>): SpinSnapshotExpected {
  const spin = {
    kind: value.spin.kind,
    spin: value.spin.spin,
    mini: value.spin.mini,
    immobile: value.spin.immobile,
    occupiedCorners: value.spin.occupiedCorners,
    clearedLines: value.spin.clearedLines
  };
  if (!value.success) {
    return { success: false, spin };
  }
  if (
    value.rotation === undefined ||
    value.rotation === null ||
    value.x === undefined ||
    value.x === null ||
    value.y === undefined ||
    value.y === null
  ) {
    throw new Error(`Native spin rotation succeeded without a concrete state: ${JSON.stringify(value)}`);
  }
  return {
    success: true,
    rotation: value.rotation,
    x: value.x,
    y: value.y,
    kickIndex: value.kickIndex ?? null,
    spin
  };
}

function addCoverage(
  coverage: {
    direct: number;
    kicked: number;
    failed: number;
    normal: number;
    mini: number;
    nonT: number;
    kickIndex3FullT: number;
    none: number;
    lineClear: number;
    modes: Set<string>;
  },
  fixture: (typeof TETRIO_SPIN_SNAPSHOT.cases)[number]
): void {
  coverage.modes.add(fixture.spinMode);
  if (!fixture.expected.success) {
    coverage.failed += 1;
    return;
  }
  if (fixture.expected.kickIndex === null) {
    coverage.direct += 1;
  } else {
    coverage.kicked += 1;
  }
  if (fixture.expected.spin.kind === "T_SPIN") {
    coverage.normal += 1;
  } else if (fixture.expected.spin.kind === "T_SPIN_MINI") {
    coverage.mini += 1;
  } else {
    coverage.none += 1;
  }
  if (fixture.expected.spin.spin && fixture.piece !== "T") {
    coverage.nonT += 1;
  }
  if (fixture.piece === "T" && fixture.expected.kickIndex === 3 && fixture.expected.spin.kind === "T_SPIN") {
    coverage.kickIndex3FullT += 1;
  }
  if (fixture.expected.spin.clearedLines > 0) {
    coverage.lineClear += 1;
  }
}
