import { createBoardBatch } from "../src/domain/board";
import {
  batchClearFullLines,
  batchCountOccupiedCells,
  bitBoardFromRows,
  clearFullLines,
  countOccupiedCells
} from "../src/infrastructure/bitboard/native-bitboard";
import { loadNativeBinding } from "../src/infrastructure/native/load-native-binding";

interface BenchCase {
  readonly name: string;
  readonly iterations: number;
  run(): number;
}

const boardCount = 512;
const boards = Array.from({ length: boardCount }, (_, boardIndex) => {
  const rows = new Array(20).fill(0);
  for (let y = 0; y < rows.length; y += 1) {
    rows[y] = (boardIndex + y) % 5 === 0 ? 0b1111111111 : (boardIndex * 37 + y * 17) & 0b1111111111;
  }
  return bitBoardFromRows(rows);
});
const batch = createBoardBatch(boards);
const native = loadNativeBinding();

const cases: BenchCase[] = [
  {
    name: "native countOccupiedCells per-board",
    iterations: 150,
    run: () => {
      let checksum = 0;
      for (const board of boards) {
        checksum += countOccupiedCells(board);
      }
      return checksum;
    }
  },
  {
    name: "native batchCountOccupiedCells",
    iterations: 150,
    run: () => {
      let checksum = 0;
      for (const count of batchCountOccupiedCells(batch.rows, batch.boardCount)) {
        checksum += count;
      }
      return checksum;
    }
  },
  {
    name: "native clearFullLines per-board",
    iterations: 100,
    run: () => {
      let checksum = 0;
      for (const board of boards) {
        checksum += clearFullLines(board)[0] ?? 0;
      }
      return checksum;
    }
  },
  {
    name: "native batchClearFullLines",
    iterations: 100,
    run: () => batchClearFullLines(batch.rows, batch.boardCount)[0] ?? 0
  },
  {
    name: "native batchRowsToFumenFields",
    iterations: 50,
    run: () => native.batchRowsToFumenFields(batch.rows, batch.boardCount).length
  }
];

for (const bench of cases) {
  bench.run();
}

const results = new Map(cases.map((bench) => [bench.name, [] as number[]]));
for (const bench of rotateCases(cases, 3)) {
  results.get(bench.name)?.push(...measure(bench, 5));
}

for (const bench of cases) {
  const samples = (results.get(bench.name) ?? []).sort((left, right) => left - right);
  const median = samples[Math.floor(samples.length / 2)] ?? 0;
  const min = samples[0] ?? 0;
  const max = samples.at(-1) ?? 0;
  console.log(`${bench.name}: median=${median.toFixed(3)}ms min=${min.toFixed(3)}ms max=${max.toFixed(3)}ms samples=${samples.length}`);
}

function measure(bench: BenchCase, samples: number): number[] {
  const timings: number[] = [];
  let checksum = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const start = performance.now();
    for (let iteration = 0; iteration < bench.iterations; iteration += 1) {
      checksum ^= bench.run();
    }
    timings.push(performance.now() - start);
  }
  if (checksum === Number.MIN_SAFE_INTEGER) {
    console.log("unreachable", checksum);
  }
  return timings.sort((left, right) => left - right);
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
