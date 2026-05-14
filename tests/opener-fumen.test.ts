import { describe, expect, test } from "bun:test";
import { createOpenerFumenPages } from "../src/application/create-opener-fumen";
import { searchOpenerBeam } from "../src/application/search-opener";
import { TetrisFumenCodec } from "../src/infrastructure/fumen/tetris-fumen-codec";

describe("opener fumen preview pages", () => {
  test("renders native placement history as colored multi-page fumen", () => {
    const [node] = searchOpenerBeam({ queue: "TI", hold: false, beamWidth: 1, maxDepth: 2 });
    expect(node).toBeDefined();

    const pages = createOpenerFumenPages(node!, { title: "candidate" });
    expect(pages).toHaveLength(2);
    expect(pages[0]?.fieldRows?.join("")).toContain("T");
    expect(pages[0]?.operation?.type).toBe("T");
    expect(pages[1]?.fieldRows?.join("")).toContain("I");
    expect(pages[1]?.comment).toContain("step 2/2");

    const codec = new TetrisFumenCodec();
    const decoded = codec.decode(codec.encodePages(pages));
    expect(decoded).toHaveLength(2);
    expect(decoded[0]?.comment).toContain("candidate step 1/2");
    expect(decoded[0]?.operation?.type).toBe("T");
    expect(decoded[1]?.fieldRows.join("")).toContain("I");
  });
});
