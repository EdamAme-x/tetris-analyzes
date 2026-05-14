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

## Progress

- [x] Native bitboard, line clear, garbage, and fumen field helpers
- [x] Native opener beam search with hold and reachability filtering
- [x] Native spin/firepower scoring with generated TETR.IO clear and combo tables
- [x] Native 7-bag buildability sampling with Pareto queue ranking
- [ ] Kick table modes beyond current SRS+ search
- [ ] Spin mode variants beyond current T-spin/immobile primitives
- [ ] Known opener benchmark set and regression report
