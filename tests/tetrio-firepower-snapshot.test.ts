import { describe, expect, test } from "bun:test";
import { evaluateOpenerFirepower } from "../src/application/search-opener";
import type { NativeFirepowerInput } from "../src/infrastructure/native/binding-types";
import { TETRIO_FIREPOWER_SNAPSHOT } from "./fixtures/tetrio-firepower.generated";

describe("TETR.IO firepower snapshots", () => {
  test("matches current TETR.IO TL line clear, B2B, combo, and all-clear accounting", () => {
    expect(TETRIO_FIREPOWER_SNAPSHOT.source.tlOptions).toMatchObject({
      spinbonuses: "all-mini+",
      b2bchaining: false,
      b2bcharging: true,
      allclear_garbage: 5,
      allclear_b2b: 1
    });

    for (const fixture of TETRIO_FIREPOWER_SNAPSHOT.cases) {
      expect(evaluateOpenerFirepower(fixture.events as readonly NativeFirepowerInput[])).toMatchObject(fixture.expected);
    }
  });
});
