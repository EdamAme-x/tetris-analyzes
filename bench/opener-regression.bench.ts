import { searchOpenerBeamWithPlacements, type SearchOpenerBeamInput } from "../src/application/search-opener";

interface OpenerRegressionCase {
  readonly name: string;
  readonly input: SearchOpenerBeamInput;
  readonly iterations: number;
  readonly minDepth: number;
  readonly minQueueIndex?: number;
  readonly minAttack?: number;
  readonly minDifficultAttack?: number;
  readonly minTSpinClears?: number;
  readonly minTSpinAttack?: number;
  readonly minBackToBackChain?: number;
  readonly maxAllClears?: number;
  readonly maxHoles?: number;
}

interface OpenerRegressionResult {
  readonly name: string;
  readonly resultCount: number;
  readonly topQueueIndex: number;
  readonly topHold: string;
  readonly topAttack: number;
  readonly topTSpinClears: number;
  readonly topTSpinAttack: number;
  readonly topSpinClears: number;
  readonly topSpinAttack: number;
  readonly topDifficultClears: number;
  readonly topBackToBackChain: number;
  readonly topAllClears: number;
  readonly topScore: number;
  readonly topHoles: number;
  readonly topBumpiness: number;
  readonly topPath: string;
  readonly checksum: number;
}

interface TimingSummary {
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly samples: number;
}

const samplesPerRound = 2;
const rounds = 2;

const cases: OpenerRegressionCase[] = [
  {
    name: "tki-3-seed",
    input: { queue: "TILJSZO", beamWidth: 48, hold: true, maxDepth: 5 },
    iterations: 4,
    minDepth: 5
  },
  {
    name: "dt-cannon-seed",
    input: { queue: "TJLZISO", beamWidth: 48, hold: true, maxDepth: 5 },
    iterations: 4,
    minDepth: 5
  },
  {
    name: "bt-cannon-seed",
    input: { queue: "TSLJZIO", beamWidth: 48, hold: true, maxDepth: 5 },
    iterations: 4,
    minDepth: 5
  },
  {
    name: "srsx-all-spin-stress",
    input: { queue: "JLSTZIOT", beamWidth: 48, hold: true, maxDepth: 5, kickTable: "SRS-X", spinMode: "ALL-SPINS" },
    iterations: 4,
    minDepth: 5
  },
  {
    name: "no-hold-control",
    input: { queue: "TILJSZO", beamWidth: 48, hold: false, maxDepth: 5 },
    iterations: 4,
    minDepth: 5
  },
  {
    name: "two-bag-tspin-quality",
    input: { queue: "SZILOJTSTOZLJI", beamWidth: 512, hold: true, maxDepth: 14 },
    iterations: 1,
    minDepth: 13,
    minQueueIndex: 14,
    minAttack: 9,
    minTSpinClears: 2,
    minBackToBackChain: 2
  },
  {
    name: "three-bag-continuation",
    input: { queue: "JLSTZIOJLSTZIOTIJLOSZ", beamWidth: 256, hold: true, maxDepth: 21 },
    iterations: 1,
    minDepth: 20,
    minQueueIndex: 21,
    minAttack: 12,
    minTSpinClears: 3,
    minBackToBackChain: 3
  },
  {
    name: "tl-3spin-14attack-no-pc",
    input: { queue: "ZTSLOJIZJTILSOLTIZJSO", beamWidth: 256, hold: true, maxDepth: 21, setupPoolMultiplier: 18 },
    iterations: 1,
    minDepth: 20,
    minQueueIndex: 21,
    minAttack: 14,
    minDifficultAttack: 14,
    minTSpinClears: 3,
    minTSpinAttack: 14,
    minBackToBackChain: 3,
    maxAllClears: 0,
    maxHoles: 0
  }
];

for (const bench of cases) {
  runCase(bench);
}

const samples = new Map(cases.map((bench) => [bench.name, [] as number[]]));
const latest = new Map<string, OpenerRegressionResult>();

for (const bench of rotateCases(cases, rounds)) {
  for (let sample = 0; sample < samplesPerRound; sample += 1) {
    const measured = measureCase(bench);
    samples.get(bench.name)?.push(measured.ms);
    latest.set(bench.name, measured.result);
  }
}

console.log("");
console.log(
  "| opener seed | median ms | searches/s | nodes | queue index | hold | attack | spin | spin attack | tspin | tspin attack | difficult | b2b | all clears | score | holes | bumpiness | checksum | top path |"
);
console.log(
  "| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |"
);
for (const bench of cases) {
  const timings = samples.get(bench.name) ?? [];
  const summary = summarize(timings);
  const latestResult = latest.get(bench.name);
  if (latestResult === undefined) {
    throw new Error(`Missing regression result for ${bench.name}.`);
  }
  const msPerSearch = summary.median / bench.iterations;
  const searchesPerSecond = 1_000 / msPerSearch;
  console.log(
    [
      bench.name,
      summary.median.toFixed(3),
      searchesPerSecond.toFixed(1),
      String(latestResult.resultCount),
      String(latestResult.topQueueIndex),
      latestResult.topHold,
      String(latestResult.topAttack),
      String(latestResult.topSpinClears),
      String(latestResult.topSpinAttack),
      String(latestResult.topTSpinClears),
      String(latestResult.topTSpinAttack),
      String(latestResult.topDifficultClears),
      String(latestResult.topBackToBackChain),
      String(latestResult.topAllClears),
      latestResult.topScore.toFixed(1),
      String(latestResult.topHoles),
      String(latestResult.topBumpiness),
      String(latestResult.checksum),
      latestResult.topPath
    ].join(" | ")
  );
}

function measureCase(bench: OpenerRegressionCase): { readonly ms: number; readonly result: OpenerRegressionResult } {
  const start = performance.now();
  let result = runCase(bench);
  for (let iteration = 1; iteration < bench.iterations; iteration += 1) {
    result = runCase(bench);
  }
  return { ms: performance.now() - start, result };
}

function runCase(bench: OpenerRegressionCase): OpenerRegressionResult {
  const nodes = searchOpenerBeamWithPlacements(bench.input);
  const top = selectRegressionCandidate(nodes, bench);
  if (top === undefined || top.depth < bench.minDepth) {
    throw new Error(`Regression case ${bench.name} did not build to depth ${bench.minDepth}.`);
  }
  if (top.queueIndex < (bench.minQueueIndex ?? 0)) {
    throw new Error(`Regression case ${bench.name} queue index ${top.queueIndex} fell below ${bench.minQueueIndex}.`);
  }
  if (top.attack < (bench.minAttack ?? 0)) {
    throw new Error(`Regression case ${bench.name} attack ${top.attack} fell below ${bench.minAttack}.`);
  }
  if (top.difficultAttack < (bench.minDifficultAttack ?? 0)) {
    throw new Error(`Regression case ${bench.name} difficult attack ${top.difficultAttack} fell below ${bench.minDifficultAttack}.`);
  }
  if (top.tSpinClears < (bench.minTSpinClears ?? 0)) {
    throw new Error(`Regression case ${bench.name} T-spin clears ${top.tSpinClears} fell below ${bench.minTSpinClears}.`);
  }
  if (top.tSpinAttack < (bench.minTSpinAttack ?? 0)) {
    throw new Error(`Regression case ${bench.name} T-spin attack ${top.tSpinAttack} fell below ${bench.minTSpinAttack}.`);
  }
  if (top.backToBackChain < (bench.minBackToBackChain ?? 0)) {
    throw new Error(`Regression case ${bench.name} B2B chain ${top.backToBackChain} fell below ${bench.minBackToBackChain}.`);
  }
  if (top.allClears > (bench.maxAllClears ?? Number.POSITIVE_INFINITY)) {
    throw new Error(`Regression case ${bench.name} all clears ${top.allClears} exceeded ${bench.maxAllClears}.`);
  }
  if (top.holes > (bench.maxHoles ?? Number.POSITIVE_INFINITY)) {
    throw new Error(`Regression case ${bench.name} holes ${top.holes} exceeded ${bench.maxHoles}.`);
  }
  return {
    name: bench.name,
    resultCount: nodes.length,
    topQueueIndex: top.queueIndex,
    topHold: top.hold ?? "-",
    topAttack: top.attack,
    topSpinClears: top.spinClears ?? top.tSpinClears,
    topSpinAttack: top.spinAttack ?? top.tSpinAttack,
    topTSpinClears: top.tSpinClears,
    topTSpinAttack: top.tSpinAttack,
    topDifficultClears: top.difficultClears,
    topBackToBackChain: top.backToBackChain,
    topAllClears: top.allClears,
    topScore: top.score,
    topHoles: top.holes,
    topBumpiness: top.bumpiness,
    topPath: top.path.join(" "),
    checksum: checksum(nodes)
  };
}

function selectRegressionCandidate(
  nodes: ReadonlyArray<ReturnType<typeof searchOpenerBeamWithPlacements>[number]>,
  bench: OpenerRegressionCase
): ReturnType<typeof searchOpenerBeamWithPlacements>[number] | undefined {
  return nodes.find(
    (node) =>
      node.allClears <= (bench.maxAllClears ?? Number.POSITIVE_INFINITY) && node.holes <= (bench.maxHoles ?? Number.POSITIVE_INFINITY)
  );
}

function checksum(
  nodes: readonly {
    readonly score: number;
    readonly attack: number;
    readonly points: number;
    readonly occupiedCells: number;
    readonly path: readonly string[];
  }[]
): number {
  let value = nodes.length;
  for (const node of nodes) {
    value ^= Math.trunc(node.score) + node.attack * 31 + node.points + node.occupiedCells + node.path.length;
  }
  return value;
}

function summarize(input: readonly number[]): TimingSummary {
  const sorted = [...input].sort((left, right) => left - right);
  return {
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
    samples: sorted.length
  };
}

function rotateCases(input: readonly OpenerRegressionCase[], rounds: number): OpenerRegressionCase[] {
  const output: OpenerRegressionCase[] = [];
  for (let round = 0; round < rounds; round += 1) {
    for (let index = 0; index < input.length; index += 1) {
      output.push(input[(index + round) % input.length] as OpenerRegressionCase);
    }
  }
  return output;
}
