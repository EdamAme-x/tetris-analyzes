import { describe, expect, test } from "bun:test";
import { generateOpeners, renderGeneratedOpenersConsole, renderGeneratedOpenersMarkdown } from "../src/application/generate-openers";
import type { FumenCodec, FumenData, FumenUrlMode, FumenUrls } from "../src/domain/fumen";

const urls: FumenUrls = {
  edit: "https://fumen.zui.jp/?v115@generated",
  view: "https://fumen.zui.jp/?m115@generated",
  list: "https://fumen.zui.jp/?d115@generated",
  listMin: "https://fumen.zui.jp/?D115@generated"
};

describe("opener generation", () => {
  test("generates fumen-ready templates from native bag mining", () => {
    const codec = createFakeFumenCodec();
    const report = generateOpeners({
      bag: "TIO",
      beamWidth: 32,
      maxDepth: 3,
      top: 2,
      includePath: true,
      fumenCodec: codec
    });

    expect(report.bag).toBe("TIO");
    expect(report.mining.totalQueues).toBe(6);
    expect(report.mining.searchedQueues).toBe(6);
    expect(report.templates).toHaveLength(2);
    expect(report.templates[0]?.supportQueues).toBeGreaterThan(0);
    expect(report.templates[0]?.path).toHaveLength(3);
    expect(report.templates[0]?.previewUrl).toBe(urls.view);
    expect(codec.encodedRows).toHaveLength(2);
    expect(codec.encodedRows[0]).toHaveLength(20);
  });

  test("renders compact console and markdown summaries", () => {
    const report = generateOpeners({
      bag: "TIO",
      beamWidth: 32,
      maxDepth: 3,
      top: 1,
      includePath: false,
      fumenCodec: createFakeFumenCodec()
    });

    expect(report.templates[0]?.path).toHaveLength(0);
    expect(renderGeneratedOpenersConsole(report)).toContain("#1 support=");
    expect(renderGeneratedOpenersConsole(report)).toContain("view=https://fumen.zui.jp/?m115@generated");
    expect(renderGeneratedOpenersMarkdown(report)).toContain("| rank | support | queue |");
    expect(renderGeneratedOpenersMarkdown(report)).toContain("[view](https://fumen.zui.jp/?m115@generated)");
  });
});

function createFakeFumenCodec(): FumenCodec & { encodedRows: number[][] } {
  const encodedRows: number[][] = [];
  return {
    encodedRows,
    encodePages: (pages): FumenData => {
      for (const page of pages) {
        encodedRows.push([...(page.rows ?? new Uint16Array())]);
      }
      return "v115@generated";
    },
    decode: () => [],
    createUrl: (_data: string, mode: FumenUrlMode = "edit") => urls[mode === "list-min" ? "listMin" : mode],
    createUrls: () => urls
  };
}
