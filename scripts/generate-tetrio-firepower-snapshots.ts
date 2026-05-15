import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { format, resolveConfig } from "prettier";
import {
  TETRIO_COMBO_ATTACK_TABLES,
  TETRIO_GARBAGE_ATTACK_TABLE,
  TETRIO_SCORING_TABLE,
  TETRIO_TABLE_SOURCE,
  TETRIO_TL_OPTIONS
} from "../src/domain/tetrio-tables";
import type { NativeClearName, NativeComboTable } from "../src/infrastructure/native/binding-types";

const DEFAULT_OUTPUT = "tests/fixtures/tetrio-firepower.generated.ts";
const TETRIO_BACK_TO_BACK_CLEARS = new Set<NativeClearName>([
  "QUAD",
  "PENTA",
  "TSPIN_MINI_SINGLE",
  "TSPIN_SINGLE",
  "TSPIN_MINI_DOUBLE",
  "TSPIN_DOUBLE",
  "TSPIN_MINI_TRIPLE",
  "TSPIN_TRIPLE",
  "TSPIN_MINI_QUAD",
  "TSPIN_QUAD",
  "TSPIN_PENTA"
]);
const TETRIO_SPIN_LINE_CLEARS = new Set<NativeClearName>([
  "TSPIN_MINI_SINGLE",
  "TSPIN_SINGLE",
  "TSPIN_MINI_DOUBLE",
  "TSPIN_DOUBLE",
  "TSPIN_MINI_TRIPLE",
  "TSPIN_TRIPLE",
  "TSPIN_MINI_QUAD",
  "TSPIN_QUAD",
  "TSPIN_PENTA"
]);

interface GenerateOptions {
  readonly output: string;
  readonly check: boolean;
}

interface SnapshotEventInput {
  readonly clearName: NativeClearName;
  readonly allClear?: boolean;
  readonly comboTable?: NativeComboTable;
}

interface SnapshotCase {
  readonly name: string;
  readonly events: readonly SnapshotEventInput[];
  readonly expected: TetrioFirepowerSummary;
}

interface TetrioFirepowerEvent {
  readonly clearName: NativeClearName;
  readonly attack: number;
  readonly baseAttack: number;
  readonly points: number;
  readonly combo: number;
  readonly backToBackChain: number;
  readonly backToBack: boolean;
  readonly backToBackBonus: number;
  readonly backToBackChargeAttack: number;
  readonly allClear: boolean;
  readonly allClearBonus: number;
}

interface TetrioFirepowerSummary {
  readonly attack: number;
  readonly points: number;
  readonly combo: number;
  readonly maxCombo: number;
  readonly backToBackChain: number;
  readonly allClears: number;
  readonly difficultClears: number;
  readonly difficultAttack: number;
  readonly spinClears: number;
  readonly spinAttack: number;
  readonly tSpinClears: number;
  readonly tSpinAttack: number;
  readonly events: readonly TetrioFirepowerEvent[];
}

type FirepowerState = Omit<TetrioFirepowerSummary, "events">;

const options = parseArgs(process.argv.slice(2));
const outputPath = resolve(options.output);
const snapshot = createSnapshot();
const content = await formatSnapshot(snapshot, outputPath);

if (options.check) {
  const current = await Bun.file(outputPath).text();
  if (current !== content) {
    throw new Error(`${options.output} is out of date. Run bun run generate:tetrio-firepower-snapshots.`);
  }
  console.log(`${options.output} is up to date.`);
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, content);
  console.log(`Generated ${options.output} with ${snapshot.cases.length} TETR.IO firepower cases.`);
}

function parseArgs(args: readonly string[]): GenerateOptions {
  const parsed: { output: string; check: boolean } = {
    output: DEFAULT_OUTPUT,
    check: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--output":
        parsed.output = readValue(args, ++index, arg);
        break;
      case "--check":
        parsed.check = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function readValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function createSnapshot(): { source: Record<string, unknown>; cases: readonly SnapshotCase[] } {
  const definitions = [
    {
      name: "tl-single-all-clear-uses-5-garbage-and-b2b-credit",
      events: [{ clearName: "SINGLE", allClear: true }]
    },
    {
      name: "tl-mini-spin-line-clears-advance-b2b",
      events: [{ clearName: "TSPIN_MINI_SINGLE" }, { clearName: "TSPIN_MINI_SINGLE" }]
    },
    {
      name: "tl-flat-b2b-bonus-does-not-grow-with-chain-when-b2bchaining-is-off",
      events: [
        { clearName: "TSPIN_DOUBLE" },
        { clearName: "TSPIN_DOUBLE" },
        { clearName: "TSPIN_DOUBLE" },
        { clearName: "TSPIN_DOUBLE" },
        { clearName: "TSPIN_DOUBLE" }
      ]
    },
    {
      name: "tl-difficult-all-clear-adds-all-clear-b2b-before-scoring",
      events: [{ clearName: "TSPIN_DOUBLE", allClear: true }]
    },
    {
      name: "tl-b2b-charge-releases-when-chain-breaks-after-threshold",
      events: [
        { clearName: "QUAD" },
        { clearName: "QUAD" },
        { clearName: "QUAD" },
        { clearName: "QUAD" },
        { clearName: "QUAD" },
        { clearName: "SINGLE" }
      ]
    },
    {
      name: "tl-no-line-events-preserve-b2b-and-break-combo",
      events: [{ clearName: "TSPIN_DOUBLE" }, { clearName: "NONE" }, { clearName: "TSPIN_DOUBLE" }]
    },
    {
      name: "tl-ordinary-line-clear-resets-b2b-after-scoring",
      events: [{ clearName: "TSPIN_DOUBLE" }, { clearName: "SINGLE" }, { clearName: "TSPIN_DOUBLE" }]
    }
  ] as const satisfies readonly { name: string; events: readonly SnapshotEventInput[] }[];

  return {
    source: {
      asset: TETRIO_TABLE_SOURCE.asset,
      lastModified: TETRIO_TABLE_SOURCE.lastModified,
      tlOptions: TETRIO_TL_OPTIONS,
      generator: "scripts/generate-tetrio-firepower-snapshots.ts"
    },
    cases: definitions.map((definition) => ({
      ...definition,
      expected: evaluateTetrioFirepower(definition.events)
    }))
  };
}

function evaluateTetrioFirepower(events: readonly SnapshotEventInput[]): TetrioFirepowerSummary {
  let state: FirepowerState = {
    attack: 0,
    points: 0,
    combo: 0,
    maxCombo: 0,
    backToBackChain: 0,
    allClears: 0,
    difficultClears: 0,
    difficultAttack: 0,
    spinClears: 0,
    spinAttack: 0,
    tSpinClears: 0,
    tSpinAttack: 0
  };
  const outputEvents: TetrioFirepowerEvent[] = [];

  for (const input of events) {
    const event = advanceTetrioFirepower(state, input);
    state = accumulate(state, event);
    outputEvents.push(event);
  }

  return { ...state, events: outputEvents };
}

function advanceTetrioFirepower(previous: FirepowerState, input: SnapshotEventInput): TetrioFirepowerEvent {
  const clearName = input.clearName;
  const clearedLines = clearLines(clearName);
  const allClear = clearedLines > 0 && input.allClear === true;
  const baseAttack: number = clearName === "NONE" ? 0 : TETRIO_GARBAGE_ATTACK_TABLE[clearName];
  let attack: number = baseAttack;
  let points: number = clearName === "NONE" ? 0 : TETRIO_SCORING_TABLE[clearName];
  const combo = clearedLines > 0 ? previous.combo + 1 : 0;
  let backToBackIncrement = Number(TETRIO_BACK_TO_BACK_CLEARS.has(clearName));

  if (allClear) {
    backToBackIncrement += TETRIO_TL_OPTIONS.allclear_b2b;
    if (!TETRIO_TL_OPTIONS.allclear_b2b_dupes) {
      backToBackIncrement = Math.max(TETRIO_TL_OPTIONS.allclear_b2b, backToBackIncrement - TETRIO_TL_OPTIONS.allclear_b2b);
    }
    if (TETRIO_TL_OPTIONS.allclear_charges) {
      backToBackIncrement = Math.max(backToBackIncrement, Math.max(0, TETRIO_TL_OPTIONS.b2bcharge_at + 1 - previous.backToBackChain));
    }
  }

  const backToBackChain =
    backToBackIncrement > 0 ? previous.backToBackChain + backToBackIncrement : clearedLines > 0 ? 0 : previous.backToBackChain;
  const backToBack = backToBackIncrement > 0 && backToBackChain > 1;
  const sendsBackToBack = TETRIO_TL_OPTIONS.allclear_b2b_sends || !(allClear && backToBackIncrement === TETRIO_TL_OPTIONS.allclear_b2b);
  const backToBackBonus = backToBack ? backToBackAttackBonus(clearName, backToBackChain) : 0;

  if (backToBack && sendsBackToBack) {
    attack += backToBackBonus;
    points = Math.floor(points * TETRIO_SCORING_TABLE.BACKTOBACK_MULTIPLIER);
  }

  if (combo > 1) {
    points += TETRIO_SCORING_TABLE.COMBO * (combo - 1);
    attack = comboAttack(input.comboTable ?? "MULTIPLIER", attack, combo);
  }

  const backToBackChargeAttack =
    clearedLines > 0 &&
    backToBackIncrement === 0 &&
    TETRIO_TL_OPTIONS.b2bcharging &&
    previous.backToBackChain > TETRIO_TL_OPTIONS.b2bcharge_at
      ? Math.floor(
          (previous.backToBackChain - TETRIO_TL_OPTIONS.b2bcharge_at + TETRIO_TL_OPTIONS.b2bcharge_base) *
            TETRIO_TL_OPTIONS.garbagemultiplier
        )
      : 0;
  const allClearBonus = allClear ? TETRIO_TL_OPTIONS.allclear_garbage : 0;

  return {
    clearName,
    attack: Math.floor(attack) + allClearBonus + backToBackChargeAttack,
    baseAttack,
    points: points + (allClear ? TETRIO_SCORING_TABLE.ALL_CLEAR : 0),
    combo,
    backToBackChain,
    backToBack,
    backToBackBonus,
    backToBackChargeAttack,
    allClear,
    allClearBonus
  };
}

function accumulate(previous: FirepowerState, event: TetrioFirepowerEvent): FirepowerState {
  const isDifficult = TETRIO_BACK_TO_BACK_CLEARS.has(event.clearName) && clearLines(event.clearName) > 0;
  const isSpin = TETRIO_SPIN_LINE_CLEARS.has(event.clearName);
  const isRealTSpin = isSpin;

  return {
    attack: previous.attack + event.attack,
    points: previous.points + event.points,
    combo: event.combo,
    maxCombo: Math.max(previous.maxCombo, event.combo),
    backToBackChain: event.backToBackChain,
    allClears: previous.allClears + Number(event.allClear),
    difficultClears: previous.difficultClears + Number(isDifficult),
    difficultAttack: previous.difficultAttack + (isDifficult ? event.attack : 0),
    spinClears: previous.spinClears + Number(isSpin),
    spinAttack: previous.spinAttack + (isSpin ? event.attack : 0),
    tSpinClears: previous.tSpinClears + Number(isRealTSpin),
    tSpinAttack: previous.tSpinAttack + (isRealTSpin ? event.attack : 0)
  };
}

function clearLines(clearName: NativeClearName): number {
  if (clearName === "NONE" || clearName === "TSPIN" || clearName === "TSPIN_MINI") {
    return 0;
  }
  if (clearName.includes("SINGLE")) {
    return 1;
  }
  if (clearName.includes("DOUBLE")) {
    return 2;
  }
  if (clearName.includes("TRIPLE")) {
    return 3;
  }
  if (clearName.includes("QUAD") || clearName === "QUAD") {
    return 4;
  }
  return 5;
}

function backToBackAttackBonus(clearName: NativeClearName, backToBackChain: number): number {
  if (!TETRIO_TL_OPTIONS.b2bchaining) {
    const extras =
      TETRIO_TL_OPTIONS.b2bextras &&
      (clearLines(clearName) === 4 || (TETRIO_SPIN_LINE_CLEARS.has(clearName) && clearLines(clearName) >= 2));
    return TETRIO_GARBAGE_ATTACK_TABLE.BACKTOBACK_BONUS * (extras ? 2 : 1);
  }
  const chain = backToBackChain - 1;
  const value = 1 + Math.log1p(chain * TETRIO_GARBAGE_ATTACK_TABLE.BACKTOBACK_BONUS_LOG);
  return TETRIO_GARBAGE_ATTACK_TABLE.BACKTOBACK_BONUS * (Math.floor(value) + (chain === 1 ? 0 : (value % 1) / 3));
}

function comboAttack(comboTable: NativeComboTable, baseAttack: number, combo: number): number {
  if (combo <= 1) {
    return baseAttack;
  }
  if (comboTable === "NONE") {
    return baseAttack + TETRIO_COMBO_ATTACK_TABLES.none[0]!;
  }
  if (comboTable === "CLASSIC GUIDELINE") {
    return baseAttack + tableComboBonus(TETRIO_COMBO_ATTACK_TABLES["classic guideline"], combo);
  }
  if (comboTable === "MODERN GUIDELINE") {
    return baseAttack + tableComboBonus(TETRIO_COMBO_ATTACK_TABLES["modern guideline"], combo);
  }

  const comboIndex = combo - 1;
  const multiplied = baseAttack * (1 + TETRIO_GARBAGE_ATTACK_TABLE.COMBO_BONUS * comboIndex);
  if (combo <= 2) {
    return multiplied;
  }
  return Math.max(
    Math.log1p(TETRIO_GARBAGE_ATTACK_TABLE.COMBO_MINIFIER * comboIndex * TETRIO_GARBAGE_ATTACK_TABLE.COMBO_MINIFIER_LOG),
    multiplied
  );
}

function tableComboBonus(table: readonly number[], combo: number): number {
  if (combo <= 1) {
    return 0;
  }
  return table[Math.min(combo - 2, table.length - 1)]!;
}

async function formatSnapshot(snapshot: ReturnType<typeof createSnapshot>, outputPath: string): Promise<string> {
  const config = (await resolveConfig(outputPath)) ?? {};
  return await format(
    [
      "// Generated by scripts/generate-tetrio-firepower-snapshots.ts. Do not edit by hand.",
      "",
      `export const TETRIO_FIREPOWER_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)} as const;`,
      ""
    ].join("\n"),
    { ...config, parser: "typescript" }
  );
}
