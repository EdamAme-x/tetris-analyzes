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
- [x] Native kick table selection for SRS+, SRS, and NONE
- [ ] Full TETR.IO kick table parity for SRS-X, TETRA-X, NRS, ARS, and ASC
- [ ] Spin mode variants beyond current T-spin/immobile primitives
- [ ] Known opener benchmark set and regression report
