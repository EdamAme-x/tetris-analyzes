import { describe, expect, test } from "bun:test";
import { evaluateOpenerFirepower } from "../src/application/search-opener";
import type { NativeClearName, NativeComboTable, NativeFirepowerInput } from "../src/infrastructure/native/binding-types";
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
    const clearNames = new Set<NativeClearName>();
    const comboTables = new Set<NativeComboTable>();

    for (const fixture of TETRIO_FIREPOWER_SNAPSHOT.cases) {
      for (const event of fixture.events) {
        clearNames.add(event.clearName as NativeClearName);
        if ("comboTable" in event && event.comboTable !== undefined) {
          comboTables.add(event.comboTable as NativeComboTable);
        }
      }
      expect(evaluateOpenerFirepower(fixture.events as readonly NativeFirepowerInput[])).toMatchObject(fixture.expected);
    }

    expect([...clearNames].sort()).toEqual([...TETRIO_FIREPOWER_SNAPSHOT.source.clearNames].sort());
    expect([...comboTables].sort()).toEqual([...TETRIO_FIREPOWER_SNAPSHOT.source.comboTables].sort());
  });
});
