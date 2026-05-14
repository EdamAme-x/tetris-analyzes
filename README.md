# tetris-analyzes

```sh
bun install
bun run build:native:debug
bun run generate:tetrio-tables
bun run check
bun test
bun run bench:release
bun run experiment:opener
```

`experiment:opener` writes JSON/Markdown reports with fumen preview URLs under `experiments/runs/`.
Executable examples live in `tests/`.
