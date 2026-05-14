# tetris-analyzes

```sh
bun install
bun run build:native:debug
bun run generate:tetrio-tables
bun run check
bun test
bun run bench:release
bun run bench:openers
bun run experiment:opener
```

`experiment:opener` writes JSON/Markdown reports with fumen preview URLs under `experiments/runs/`.
Executable examples live in `tests/`.

## Progress

- [x] Native bitboard, line clear, garbage, and fumen field helpers
- [x] Native opener beam search with hold and reachability filtering
- [x] Native spin/firepower scoring with generated TETR.IO clear and combo tables
- [x] Native 7-bag buildability sampling with Pareto queue ranking
- [x] Native generated TETR.IO kick tables for SRS+, SRS, SRS-X, TETRA-X, NRS, ARS, ASC, and NONE
- [x] Native spin mode selection for T-SPINS, all-spin, mini-only, handheld, stupid, and none variants
- [x] Known opener benchmark set and regression report
- [x] Fumen preview operation parity tests for native SRS piece geometry
- [x] Native beam pruning prefers T-spin, difficult clear, and B2B chain branches
- [x] Native T-spin slot potential helper for future setup-aware search
