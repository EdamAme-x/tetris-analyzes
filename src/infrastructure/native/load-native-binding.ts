import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NativeBinding } from "./binding-types";

let cachedBinding: NativeBinding | undefined;
const moduleRequire = createRequire(import.meta.url);

export function nativeBindingPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../native/index.js");
}

export function loadNativeBinding(): NativeBinding {
  if (cachedBinding !== undefined) {
    return cachedBinding;
  }

  const entry = nativeBindingPath();
  if (!existsSync(entry)) {
    throw new Error(`Native binding is not built. Run \`bun run build:native:debug\` first. Missing: ${entry}`);
  }

  const binding = moduleRequire(entry) as Record<string, unknown>;
  const requiredExports = [
    "createEmptyBoard",
    "copyBoardRows",
    "isPerfectClear",
    "countOccupiedCells",
    "clearFullLines",
    "batchCountOccupiedCells",
    "batchClearFullLines",
    "batchEvaluateBoards",
    "createGarbageRows",
    "applyGarbage",
    "rowsToFumenField",
    "batchRowsToFumenFields",
    "searchOpenerBeam"
  ];
  for (const exportName of requiredExports) {
    if (typeof binding[exportName] !== "function") {
      throw new Error(`Native binding at ${entry} does not export ${exportName}.`);
    }
  }

  cachedBinding = binding as unknown as NativeBinding;
  return cachedBinding;
}
