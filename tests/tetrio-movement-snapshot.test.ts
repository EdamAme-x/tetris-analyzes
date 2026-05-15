import { describe, expect, test } from "bun:test";
import { resolveOpenerRotation, type SearchPiece } from "../src/application/search-opener";
import { bitBoardFromRows } from "../src/infrastructure/bitboard/native-bitboard";
import type { NativeKickTable } from "../src/infrastructure/native/binding-types";
import { TETRIO_MOVEMENT_SNAPSHOT } from "./fixtures/tetrio-movement.generated";

describe("TETR.IO movement snapshots", () => {
  test("matches generated tetrio.js rotation oracle cases", () => {
    const failures: string[] = [];
    const coverage = { direct: 0, kicked: 0, failed: 0 };

    for (const fixture of TETRIO_MOVEMENT_SNAPSHOT.cases) {
      const actual = normalizeResolution(
        resolveOpenerRotation({
          rows: bitBoardFromRows([...fixture.rows]),
          piece: fixture.piece as SearchPiece,
          rotation: fixture.from.rotation,
          x: fixture.from.x,
          y: fixture.from.y,
          direction: fixture.direction,
          kickTable: fixture.kickTable as NativeKickTable
        })
      );
      if (JSON.stringify(actual) !== JSON.stringify(fixture.expected)) {
        failures.push(`${fixture.name}: expected ${JSON.stringify(fixture.expected)}, got ${JSON.stringify(actual)}`);
      }
      if (!fixture.expected.success) {
        coverage.failed += 1;
      } else if (fixture.expected.kickIndex === null) {
        coverage.direct += 1;
      } else {
        coverage.kicked += 1;
      }
    }

    expect(TETRIO_MOVEMENT_SNAPSHOT.cases.length).toBeGreaterThanOrEqual(1_500);
    expect(new Set(TETRIO_MOVEMENT_SNAPSHOT.cases.map((fixture) => fixture.kickTable)).size).toBeGreaterThanOrEqual(8);
    expect(coverage.direct).toBeGreaterThanOrEqual(180);
    expect(coverage.kicked).toBeGreaterThanOrEqual(180);
    expect(coverage.failed).toBeGreaterThanOrEqual(180);
    expect(failures.slice(0, 20)).toEqual([]);
  });
});

function normalizeResolution(
  value: ReturnType<typeof resolveOpenerRotation>
):
  | { readonly success: false }
  | { readonly success: true; readonly rotation: number; readonly x: number; readonly y: number; readonly kickIndex: number | null } {
  if (!value.success) {
    return { success: false };
  }
  if (
    value.rotation === undefined ||
    value.rotation === null ||
    value.x === undefined ||
    value.x === null ||
    value.y === undefined ||
    value.y === null
  ) {
    throw new Error(`Native rotation resolution succeeded without a concrete state: ${JSON.stringify(value)}`);
  }
  return {
    success: true,
    rotation: value.rotation,
    x: value.x,
    y: value.y,
    kickIndex: value.kickIndex ?? null
  };
}
