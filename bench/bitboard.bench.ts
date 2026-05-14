import { createBoardBatch, ROW_MASK } from "../src/domain/board";
import {
  batchClearFullLines,
  batchCountOccupiedCells,
  batchEvaluateBoards,
  bitBoardFromRows,
  clearFullLines,
  countOccupiedCells
} from "../src/infrastructure/bitboard/native-bitboard";

interface BenchCase {
  readonly name: string;
  readonly boardCount: number;
  readonly iterations: number;
  run(): number;
}

interface BenchResult {
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly samples: number;
}

const boardCounts = [1, 8, 64, 512, 4096] as const;
const samplesPerRound = 3;
const rounds = 2;
const popCountLookup = createPopCountLookup();
const cases = boardCounts.flatMap((boardCount) => createCases(boardCount));

for (const bench of cases) {
  bench.run();
}

const results = new Map(cases.map((bench) => [benchKey(bench), [] as number[]]));
for (const bench of rotateCases(cases, rounds)) {
  results.get(benchKey(bench))?.push(...measure(bench, samplesPerRound));
}

console.log("| boards | case | median ms | ns/board | min ms | max ms | samples |");
console.log("| ---: | --- | ---: | ---: | ---: | ---: | ---: |");
for (const bench of cases) {
  const result = summarize(results.get(benchKey(bench)) ?? []);
  const nsPerBoard = (result.median * 1_000_000) / (bench.iterations * bench.boardCount);
  console.log(
    `| ${bench.boardCount} | ${bench.name} | ${result.median.toFixed(3)} | ${nsPerBoard.toFixed(1)} | ${result.min.toFixed(3)} | ${result.max.toFixed(3)} | ${result.samples} |`
  );
}

function createCases(boardCount: number): BenchCase[] {
  const boards = createBoards(boardCount);
  const batch = createBoardBatch(boards);
  return [
    {
      name: "count TS per-board",
      boardCount,
      iterations: iterationsFor(boardCount, 60_000),
      run: () => {
        let checksum = 0;
        for (const board of boards) {
          checksum += tsCountOccupiedCells(board);
        }
        return checksum;
      }
    },
    {
      name: "count native per-board",
      boardCount,
      iterations: iterationsFor(boardCount, 60_000),
      run: () => {
        let checksum = 0;
        for (const board of boards) {
          checksum += countOccupiedCells(board);
        }
        return checksum;
      }
    },
    {
      name: "count native batch",
      boardCount,
      iterations: iterationsFor(boardCount, 60_000),
      run: () => {
        let checksum = 0;
        for (const count of batchCountOccupiedCells(batch.rows, batch.boardCount)) {
          checksum += count;
        }
        return checksum;
      }
    },
    {
      name: "clear TS per-board",
      boardCount,
      iterations: iterationsFor(boardCount, 30_000),
      run: () => {
        let checksum = 0;
        for (const board of boards) {
          checksum += tsClearFullLines(board)[0] ?? 0;
        }
        return checksum;
      }
    },
    {
      name: "clear native per-board",
      boardCount,
      iterations: iterationsFor(boardCount, 30_000),
      run: () => {
        let checksum = 0;
        for (const board of boards) {
          checksum += clearFullLines(board)[0] ?? 0;
        }
        return checksum;
      }
    },
    {
      name: "clear native batch",
      boardCount,
      iterations: iterationsFor(boardCount, 30_000),
      run: () => batchClearFullLines(batch.rows, batch.boardCount)[0] ?? 0
    },
    {
      name: "evaluate TS per-board",
      boardCount,
      iterations: iterationsFor(boardCount, 20_000),
      run: () => {
        let checksum = 0;
        for (const board of boards) {
          const evaluation = tsEvaluateBoard(board);
          checksum ^= evaluation[0] + evaluation[2] + evaluation[3] + evaluation[4];
        }
        return checksum;
      }
    },
    {
      name: "evaluate native batch",
      boardCount,
      iterations: iterationsFor(boardCount, 20_000),
      run: () => {
        let checksum = 0;
        const evaluations = batchEvaluateBoards(batch.rows, batch.boardCount);
        for (let index = 0; index < evaluations.length; index += 5) {
          checksum ^=
            (evaluations[index] ?? 0) + (evaluations[index + 2] ?? 0) + (evaluations[index + 3] ?? 0) + (evaluations[index + 4] ?? 0);
        }
        return checksum;
      }
    }
  ];
}

function createBoards(boardCount: number): Uint16Array[] {
  return Array.from({ length: boardCount }, (_, boardIndex) => {
    const rows = new Array(20).fill(0);
    for (let y = 0; y < rows.length; y += 1) {
      rows[y] = (boardIndex + y) % 5 === 0 ? ROW_MASK : (boardIndex * 37 + y * 17) & ROW_MASK;
    }
    return bitBoardFromRows(rows);
  });
}

function iterationsFor(boardCount: number, targetBoardOps: number): number {
  return Math.max(1, Math.round(targetBoardOps / boardCount));
}

function tsCountOccupiedCells(rows: Uint16Array): number {
  let count = 0;
  for (const row of rows) {
    count += popCountLookup[row] ?? 0;
  }
  return count;
}

function tsClearFullLines(rows: Uint16Array): Uint16Array {
  const output = new Uint16Array(20);
  let writeY = 0;
  for (const row of rows) {
    if (row !== ROW_MASK) {
      output[writeY] = row;
      writeY += 1;
    }
  }
  return output;
}

function createPopCountLookup(): number[] {
  return Array.from({ length: ROW_MASK + 1 }, (_, row) => {
    let count = 0;
    for (let bits = row; bits !== 0; bits >>= 1) {
      count += bits & 1;
    }
    return count;
  });
}

function tsEvaluateBoard(rows: Uint16Array): [number, number, number, number, number] {
  let occupiedCells = 0;
  let clearedLines = 0;
  const columnMasks = new Uint32Array(10);
  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y] ?? 0;
    occupiedCells += popCountLookup[row] ?? 0;
    if (row === ROW_MASK) {
      clearedLines += 1;
    }
    for (let x = 0; x < 10; x += 1) {
      if ((row & (1 << x)) !== 0) {
        columnMasks[x] = (columnMasks[x] ?? 0) | (1 << y);
      }
    }
  }

  let aggregateHeight = 0;
  let holes = 0;
  let bumpiness = 0;
  let previousHeight: number | undefined;
  for (const columnMask of columnMasks) {
    const height = columnMask === 0 ? 0 : 32 - Math.clz32(columnMask);
    aggregateHeight += height;
    holes += height - (popCountLookup[columnMask] ?? popCount32(columnMask));
    if (previousHeight !== undefined) {
      bumpiness += Math.abs(previousHeight - height);
    }
    previousHeight = height;
  }

  return [occupiedCells, clearedLines, aggregateHeight, holes, bumpiness];
}

function popCount32(value: number): number {
  let count = 0;
  for (let bits = value; bits !== 0; bits >>>= 1) {
    count += bits & 1;
  }
  return count;
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

function benchKey(bench: BenchCase): string {
  return `${bench.boardCount}:${bench.name}`;
}
