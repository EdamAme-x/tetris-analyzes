import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NativeBinding } from "./binding-types";

let cachedBinding: NativeBinding | undefined;

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

  const binding = require(entry) as Record<string, unknown>;
  const requiredExports = [
    "createEmptyBoard",
    "copyBoardRows",
    "isPerfectClear",
    "countOccupiedCells",
    "clearFullLines",
    "batchCountOccupiedCells",
    "batchClearFullLines",
    "createGarbageRows",
    "applyGarbage",
    "rowsToFumenField",
    "batchRowsToFumenFields"
  ];
  for (const exportName of requiredExports) {
    if (typeof binding[exportName] !== "function") {
      throw new Error(`Native binding at ${entry} does not export ${exportName}.`);
    }
  }

  cachedBinding = binding as unknown as NativeBinding;
  return cachedBinding;
}
