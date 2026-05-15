import { TETRIO_TABLE_SOURCE } from "../src/generated/tetrio-tables.generated";

const TETRIO_ORIGIN = "https://tetr.io";
const DIRECT_ASSET = `${TETRIO_ORIGIN}/js/tetrio.js`;

const home = await fetchText(TETRIO_ORIGIN);
const currentHashVersion = extractCurrentHashVersion(home);
const currentAsset = `${DIRECT_ASSET}?hv=${currentHashVersion}`;

if (TETRIO_TABLE_SOURCE.asset !== currentAsset) {
  throw new Error(`Generated TETR.IO source is stale: expected ${currentAsset}, got ${TETRIO_TABLE_SOURCE.asset}.`);
}

const [direct, pinned] = await Promise.all([fetchAsset(DIRECT_ASSET), fetchAsset(TETRIO_TABLE_SOURCE.asset)]);

if (direct.sha256 !== pinned.sha256) {
  throw new Error(`Pinned TETR.IO source does not match the live asset: direct=${direct.sha256}, pinned=${pinned.sha256}.`);
}

console.log(`TETR.IO source current: ${TETRIO_TABLE_SOURCE.asset}`);
console.log(`sha256: ${pinned.sha256}`);

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

async function fetchAsset(url: string): Promise<{ readonly sha256: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await response.arrayBuffer());
  return { sha256: hasher.digest("hex") };
}

function extractCurrentHashVersion(html: string): string {
  const versions = new Set([...html.matchAll(/\bhv=([^"&<>]+)/g)].map((match) => match[1]).filter((value) => value !== undefined));
  if (versions.size !== 1) {
    throw new Error(`Expected exactly one TETR.IO hash version in the homepage, got ${versions.size}.`);
  }
  return [...versions][0]!;
}
