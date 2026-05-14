import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { nativeBindingPath } from "../src/infrastructure/native/load-native-binding";

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
});
