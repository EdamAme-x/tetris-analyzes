import { describe, expect, test } from "bun:test";
import { ExportFumenUseCase } from "../src/application/export-fumen";
import {
  TetrisFumenCodec,
  createFumenQuizComment,
  formatFumenCellRow,
  formatFumenFieldRows,
  normalizeFumenData
} from "../src/infrastructure/fumen/tetris-fumen-codec";
import { bitBoardFromRows } from "../src/infrastructure/bitboard/native-bitboard";
import type { NativeBinding } from "../src/infrastructure/native/binding-types";

describe("TetrisFumenCodec", () => {
  test("exports native board rows as fumen data and fumen.zui.jp urls", () => {
    const rows = new Array(20).fill(0);
    rows[0] = 0b1111100000;
    rows[1] = 0b0000010001;
    const board = bitBoardFromRows(rows);
    const codec = new TetrisFumenCodec();

    const response = new ExportFumenUseCase(codec).execute({
      pages: [{ rows: board, comment: "first board" }]
    });

    expect(response.data.startsWith("v115@")).toBe(true);
    expect(response.urls.edit.startsWith("https://fumen.zui.jp/?v115@")).toBe(true);
    expect(response.urls.view.startsWith("https://fumen.zui.jp/?m115@")).toBe(true);
    expect(response.urls.list.startsWith("https://fumen.zui.jp/?d115@")).toBe(true);
    expect(response.urls.listMin.startsWith("https://fumen.zui.jp/?D115@")).toBe(true);

    const [page] = codec.decode(response.data);
    expect(page?.comment).toBe("first board");
    expect(page?.fieldRows.slice(-2)).toEqual(["X___X_____", "_____XXXXX"]);
  });

  test("normalizes viewer urls back to editable fumen data", () => {
    expect(normalizeFumenData("https://fumen.zui.jp/?m115@vhAAgH")).toBe("v115@vhAAgH");
    expect(normalizeFumenData("https://fumen.zui.jp/?D115@vhAAgH")).toBe("v115@vhAAgH");
    expect(normalizeFumenData("v115@abc?def")).toBe("v115@abc?def");
  });

  test("supports colored cells, I-mino operations, comments, garbage, and flags", () => {
    const codec = new TetrisFumenCodec();
    const data = codec.encodePages([
      {
        fieldRows: [
          "__________",
          ["T", "T", "T", "_", "_", "_", "_", "_", "_", "_"],
          ["L", "O", "O", "_", "_", "_", "_", "_", "_", "_"],
          ["L", "L", "O", "O", "S", "S", "Z", "Z", "J", "J"]
        ],
        garbageRow: ["GRAY", "GRAY", "GRAY", "GRAY", "GRAY", "GRAY", "GRAY", "GRAY", "GRAY", "EMPTY"],
        operation: { type: "I", rotation: "left", x: 9, y: 1 },
        comment: "I placement with colors",
        flags: { lock: false, colorize: true, mirror: false, rise: false }
      }
    ]);

    const [page] = codec.decode(data);
    expect(page?.comment).toBe("I placement with colors");
    expect(page?.operation).toEqual({ type: "I", rotation: "left", x: 9, y: 1 });
    expect(page?.flags.colorize).toBe(true);
    expect(page?.flags.lock).toBe(false);
    expect(page?.garbage).toBe("XXXXXXXXX_");
    expect(page?.fieldRows.at(-1)).toBe("LLOOSSZZJJ");
  });

  test("formats cell rows for high-level fumen construction", () => {
    expect(formatFumenCellRow(["I", "L", "O", "Z", "T", "J", "S", "X", "GRAY", "EMPTY"])).toBe("ILOZTJSXX_");
    expect(formatFumenFieldRows(["__________", "IIII______"])).toBe("__________IIII______");
  });

  test("supports quiz comments through the fumen comment slot", () => {
    const codec = new TetrisFumenCodec();
    const data = codec.encodePages([
      {
        quiz: { hold: "I", current: "T", next: ["O", "S", "Z"] },
        operation: { type: "T", rotation: "spawn", x: 4, y: 0 }
      }
    ]);
    const [page] = codec.decode(data);

    expect(createFumenQuizComment({ hold: "I", current: "T", next: "OSZ" })).toBe("#Q=[I](T)OSZ");
    expect(page?.comment).toBe("#Q=[I](T)OSZ");
    expect(page?.quiz).toBe("#Q=[I](T)OSZ");
  });

  test("batches native row-to-fumen conversion for multiple bitboards", () => {
    let batchCalls = 0;
    const fakeNative: NativeBinding = {
      createEmptyBoard: () => new Uint16Array(20),
      copyBoardRows: (rows) => rows,
      isPerfectClear: () => false,
      countOccupiedCells: () => 0,
      clearFullLines: (rows) => rows,
      batchCountOccupiedCells: () => new Uint32Array(),
      batchClearFullLines: (rows) => rows,
      batchEvaluateBoards: () => new Uint32Array(),
      createGarbageRows: () => new Uint16Array(),
      applyGarbage: (rows) => rows,
      rowsToFumenField: () => {
        throw new Error("single board conversion should not be used for multi-page row input");
      },
      batchRowsToFumenFields: (rows, boardCount) => {
        batchCalls += 1;
        expect(rows.length).toBe(40);
        expect(boardCount).toBe(2);
        return ["_".repeat(230), "_".repeat(230)];
      },
      canReachOpenerPlacement: () => false,
      detectOpenerSpin: () => ({ kind: "NONE", spin: false, mini: false, immobile: false, occupiedCorners: 0, clearedLines: 0 }),
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
      })
    };

    const codec = new TetrisFumenCodec(fakeNative);
    const data = codec.encodePages([{ rows: new Uint16Array(20) }, { rows: new Uint16Array(20) }]);

    expect(batchCalls).toBe(1);
    expect(data.startsWith("v115@")).toBe(true);
  });
});
