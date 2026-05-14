import { evaluateOpenerBag, searchOpenerBeam, searchOpenerBeamWithPlacements } from "../src/application/search-opener";

interface BenchCase {
  readonly name: string;
  readonly iterations: number;
  run(): number;
}

interface BenchResult {
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly samples: number;
}

const samplesPerRound = 3;
const rounds = 2;
const cases: BenchCase[] = [
  {
    name: "beam16 depth4 hold",
    iterations: 40,
    run: () => checksum(searchOpenerBeam({ queue: "TILJSZOT", beamWidth: 16, hold: true, maxDepth: 4 }))
  },
  {
    name: "beam64 depth5 hold",
    iterations: 10,
    run: () => checksum(searchOpenerBeam({ queue: "TILJSZOTIL", beamWidth: 64, hold: true, maxDepth: 5 }))
  },
  {
    name: "beam64 depth5 no-hold",
    iterations: 10,
    run: () => checksum(searchOpenerBeam({ queue: "TILJSZOTIL", beamWidth: 64, hold: false, maxDepth: 5 }))
  },
  {
    name: "beam64 depth5 hold detailed",
    iterations: 10,
    run: () => checksum(searchOpenerBeamWithPlacements({ queue: "TILJSZOTIL", beamWidth: 64, hold: true, maxDepth: 5 }))
  },
  {
    name: "bag sample 24 depth3 hold",
    iterations: 10,
    run: () => {
      const evaluation = evaluateOpenerBag({ bag: "TIJLOSZ", beamWidth: 8, hold: true, maxDepth: 3, maxQueues: 24, topQueueCount: 4 });
      return Math.trunc(evaluation.averageScore) ^ evaluation.buildableQueues ^ evaluation.topQueues.length;
    }
  }
];

for (const bench of cases) {
  bench.run();
}

const results = new Map(cases.map((bench) => [bench.name, [] as number[]]));
for (const bench of rotateCases(cases, rounds)) {
  results.get(bench.name)?.push(...measure(bench, samplesPerRound));
}

console.log("");
console.log("| case | median ms | ms/search | searches/s | min ms | max ms | samples |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const bench of cases) {
  const result = summarize(results.get(bench.name) ?? []);
  const msPerSearch = result.median / bench.iterations;
  const searchesPerSecond = 1_000 / msPerSearch;
  console.log(
    `| ${bench.name} | ${result.median.toFixed(3)} | ${msPerSearch.toFixed(3)} | ${searchesPerSecond.toFixed(1)} | ${result.min.toFixed(3)} | ${result.max.toFixed(3)} | ${result.samples} |`
  );
}

function checksum(
  nodes: readonly { readonly score: number; readonly attack: number; readonly occupiedCells: number; readonly path: readonly string[] }[]
): number {
  let value = nodes.length;
  for (const node of nodes) {
    value ^= Math.trunc(node.score) + node.attack + node.occupiedCells + node.path.length;
  }
  return value;
}

function measure(bench: BenchCase, samples: number): number[] {
  const timings: number[] = [];
  let value = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const start = performance.now();
    for (let iteration = 0; iteration < bench.iterations; iteration += 1) {
      value ^= bench.run();
    }
    timings.push(performance.now() - start);
  }
  if (value === Number.MIN_SAFE_INTEGER) {
    console.log("unreachable", value);
  }
  return timings;
}

function summarize(samples: readonly number[]): BenchResult {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
    samples: sorted.length
  };
}

function rotateCases(input: readonly BenchCase[], rounds: number): BenchCase[] {
  const output: BenchCase[] = [];
  for (let round = 0; round < rounds; round += 1) {
    for (let index = 0; index < input.length; index += 1) {
      output.push(input[(index + round) % input.length] as BenchCase);
    }
  }
  return output;
}
