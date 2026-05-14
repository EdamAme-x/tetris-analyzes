import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NativeBinding } from "./binding-types";

let cachedBinding: NativeBinding | undefined;
const moduleRequire = createRequire(import.meta.url);
const nativeBindingSpec = {
  createEmptyBoard: "function",
  copyBoardRows: "function",
  isPerfectClear: "function",
  countOccupiedCells: "function",
  clearFullLines: "function",
  batchCountOccupiedCells: "function",
  batchClearFullLines: "function",
  batchEvaluateBoards: "function",
  createGarbageRows: "function",
  applyGarbage: "function",
  rowsToFumenField: "function",
  batchRowsToFumenFields: "function",
  canReachOpenerPlacement: "function",
  detectOpenerSpin: "function",
  evaluateOpenerFirepower: "function",
  searchOpenerBeam: "function",
  searchOpenerBeamWithPlacements: "function"
} satisfies { readonly [K in keyof NativeBinding]: "function" };
const nativeBindingExportNames = Object.keys(nativeBindingSpec) as readonly (keyof NativeBinding)[];
const nativeBindingExportNameSet = new Set<string>(nativeBindingExportNames);

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

  const binding: unknown = moduleRequire(entry);
  assertNativeBinding(binding, entry);
  cachedBinding = binding;
  return cachedBinding;
}

export function assertNativeBinding(value: unknown, entry: string): asserts value is NativeBinding {
  if (!isRecord(value)) {
    throw new Error(`Native binding at ${entry} must export an object.`);
  }

  const unexpectedExports = Object.keys(value).filter((exportName) => !nativeBindingExportNameSet.has(exportName));
  if (unexpectedExports.length > 0) {
    throw new Error(`Native binding at ${entry} exports unexpected bindings: ${unexpectedExports.sort().join(", ")}.`);
  }

  for (const exportName of nativeBindingExportNames) {
    if (typeof value[exportName] !== nativeBindingSpec[exportName]) {
      throw new Error(`Native binding at ${entry} does not export ${exportName}.`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
