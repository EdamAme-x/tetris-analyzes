import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const CACHE_VERSION = 1;
const ROOT_DIR = process.cwd();
const NATIVE_DIR = join(ROOT_DIR, "native");
const CACHE_DIR = join(NATIVE_DIR, "target", "napi-build-cache");
const ACTIVE_STATE_PATH = join(CACHE_DIR, "active.json");
const BASE_OUTPUTS = ["index.js", "index.d.ts"] as const;

type NativeBuildProfile = "debug" | "release";

interface BuildOptions {
  readonly profile: NativeBuildProfile;
  readonly force: boolean;
}

interface ProfileCacheState {
  readonly version: typeof CACHE_VERSION;
  readonly profile: NativeBuildProfile;
  readonly inputHash: string;
  readonly command: readonly string[];
  readonly outputs: readonly string[];
  readonly cachedAt: string;
}

interface ActiveCacheState {
  readonly version: typeof CACHE_VERSION;
  readonly profile: NativeBuildProfile;
  readonly inputHash: string;
  readonly outputs: readonly string[];
  readonly activatedAt: string;
}

const options = readBuildOptions(process.argv.slice(2));
const command = createNapiCommand(options.profile);
const inputHash = await hashBuildInputs(command, options.profile);
const profileStatePath = join(CACHE_DIR, `${options.profile}.json`);
const profileState = await readProfileCacheState(profileStatePath);
const activeState = await readActiveCacheState(ACTIVE_STATE_PATH);

if (
  !options.force &&
  activeState?.profile === options.profile &&
  activeState.inputHash === inputHash &&
  (await outputsExist(activeState.outputs))
) {
  console.log(`native build cache hit: ${options.profile} ${shortHash(inputHash)}`);
  process.exit(0);
}

if (
  !options.force &&
  profileState?.inputHash === inputHash &&
  arraysEqual(profileState.command, command) &&
  (await cachedOutputsExist(options.profile, inputHash, profileState.outputs))
) {
  await restoreCachedOutputs(options.profile, inputHash, profileState.outputs);
  await writeActiveState(options.profile, inputHash, profileState.outputs);
  console.log(`native build cache restored: ${options.profile} ${shortHash(inputHash)}`);
  process.exit(0);
}

console.log(`native build cache miss: ${options.profile} ${shortHash(inputHash)}`);
await runNapiBuild(command);
const outputs = await findNativeOutputs();
await cacheOutputs(options.profile, inputHash, outputs);
await writeProfileState({
  version: CACHE_VERSION,
  profile: options.profile,
  inputHash,
  command,
  outputs,
  cachedAt: new Date().toISOString()
});
await writeActiveState(options.profile, inputHash, outputs);

function readBuildOptions(args: readonly string[]): BuildOptions {
  return {
    profile: args.includes("--release") ? "release" : "debug",
    force: args.includes("--force")
  };
}

function createNapiCommand(profile: NativeBuildProfile): readonly string[] {
  const command = [
    "napi",
    "build",
    "--manifest-path",
    "native/Cargo.toml",
    "--package-json-path",
    "package.json",
    "--output-dir",
    "native",
    "--platform",
    "--js",
    "index.js",
    "--dts",
    "index.d.ts"
  ];
  return profile === "release" ? [...command, "--release"] : command;
}

async function hashBuildInputs(command: readonly string[], profile: NativeBuildProfile): Promise<string> {
  const hash = createHash("sha256");
  hash.update(`cache-version:${CACHE_VERSION}\n`);
  hash.update(`profile:${profile}\n`);
  hash.update(`platform:${process.platform}\n`);
  hash.update(`arch:${process.arch}\n`);
  hash.update(`bun:${Bun.version}\n`);
  hash.update(`command:${command.join("\0")}\n`);

  for (const filePath of await collectInputFiles()) {
    hash.update(`file:${relative(ROOT_DIR, filePath)}\0`);
    hash.update(await readFile(filePath));
    hash.update("\0");
  }

  return hash.digest("hex");
}

async function collectInputFiles(): Promise<string[]> {
  const files = [
    join(ROOT_DIR, "package.json"),
    join(ROOT_DIR, "bun.lock"),
    join(NATIVE_DIR, "Cargo.toml"),
    join(NATIVE_DIR, "Cargo.lock"),
    join(NATIVE_DIR, "build.rs"),
    join(ROOT_DIR, "scripts", "build-native.ts")
  ];
  files.push(...(await collectRustFiles(join(NATIVE_DIR, "src"))));
  return files.sort();
}

async function collectRustFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectRustFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".rs")) {
      files.push(path);
    }
  }
  return files;
}

async function runNapiBuild(command: readonly string[]): Promise<void> {
  const executable = await resolveNapiExecutable();
  const child = Bun.spawn([executable, ...command.slice(1)], {
    cwd: ROOT_DIR,
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  });
  const code = await child.exited;
  if (code !== 0) {
    throw new Error(`napi build failed with exit code ${code}.`);
  }
}

async function resolveNapiExecutable(): Promise<string> {
  const localExecutable = join(ROOT_DIR, "node_modules", ".bin", process.platform === "win32" ? "napi.cmd" : "napi");
  return (await fileExists(localExecutable)) ? localExecutable : "napi";
}

async function findNativeOutputs(): Promise<string[]> {
  const entries = await readdir(NATIVE_DIR, { withFileTypes: true });
  const outputs = new Set<string>(BASE_OUTPUTS);
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".node")) {
      outputs.add(entry.name);
    }
  }
  return [...outputs].sort();
}

async function outputsExist(outputs: readonly string[]): Promise<boolean> {
  return Promise.all(outputs.map((output) => fileExists(join(NATIVE_DIR, output)))).then((results) => results.every(Boolean));
}

async function cachedOutputsExist(profile: NativeBuildProfile, inputHash: string, outputs: readonly string[]): Promise<boolean> {
  const cachePath = outputCachePath(profile, inputHash);
  return Promise.all(outputs.map((output) => fileExists(join(cachePath, basename(output))))).then((results) => results.every(Boolean));
}

async function cacheOutputs(profile: NativeBuildProfile, inputHash: string, outputs: readonly string[]): Promise<void> {
  const cachePath = outputCachePath(profile, inputHash);
  await mkdir(cachePath, { recursive: true });
  for (const output of outputs) {
    await copyFile(join(NATIVE_DIR, output), join(cachePath, basename(output)));
  }
}

async function restoreCachedOutputs(profile: NativeBuildProfile, inputHash: string, outputs: readonly string[]): Promise<void> {
  await removeGeneratedNativeOutputs();
  const cachePath = outputCachePath(profile, inputHash);
  for (const output of outputs) {
    await copyFile(join(cachePath, basename(output)), join(NATIVE_DIR, output));
  }
}

async function removeGeneratedNativeOutputs(): Promise<void> {
  const entries = await readdir(NATIVE_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && (BASE_OUTPUTS.includes(entry.name as (typeof BASE_OUTPUTS)[number]) || entry.name.endsWith(".node"))) {
      await rm(join(NATIVE_DIR, entry.name), { force: true });
    }
  }
}

function outputCachePath(profile: NativeBuildProfile, inputHash: string): string {
  return join(CACHE_DIR, profile, inputHash);
}

async function writeProfileState(state: ProfileCacheState): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(join(CACHE_DIR, `${state.profile}.json`), `${JSON.stringify(state, null, 2)}\n`);
}

async function writeActiveState(profile: NativeBuildProfile, inputHash: string, outputs: readonly string[]): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const state: ActiveCacheState = {
    version: CACHE_VERSION,
    profile,
    inputHash,
    outputs,
    activatedAt: new Date().toISOString()
  };
  await writeFile(ACTIVE_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

async function readProfileCacheState(path: string): Promise<ProfileCacheState | undefined> {
  const value = await readJson(path);
  return isProfileCacheState(value) ? value : undefined;
}

async function readActiveCacheState(path: string): Promise<ActiveCacheState | undefined> {
  const value = await readJson(path);
  return isActiveCacheState(value) ? value : undefined;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

function isProfileCacheState(value: unknown): value is ProfileCacheState {
  return (
    isRecord(value) &&
    value.version === CACHE_VERSION &&
    isNativeBuildProfile(value.profile) &&
    typeof value.inputHash === "string" &&
    isStringArray(value.command) &&
    isStringArray(value.outputs) &&
    typeof value.cachedAt === "string"
  );
}

function isActiveCacheState(value: unknown): value is ActiveCacheState {
  return (
    isRecord(value) &&
    value.version === CACHE_VERSION &&
    isNativeBuildProfile(value.profile) &&
    typeof value.inputHash === "string" &&
    isStringArray(value.outputs) &&
    typeof value.activatedAt === "string"
  );
}

function isNativeBuildProfile(value: unknown): value is NativeBuildProfile {
  return value === "debug" || value === "release";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function shortHash(hash: string): string {
  return hash.slice(0, 12);
}
