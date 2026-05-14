# tetris-analyzes

```sh
bun install
bun run build:native:debug
bun run generate:tetrio-tables
bun run check
bun run test:native
bun test
bun run bench:release
bun run bench:openers
bun run experiment:opener
bun run experiment:opener -- --preset=survey --top=5
bun run experiment:opener -- --preset=discovery --top=5
bun run experiment:opener -- --preset=continuation --top=3
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
- [x] Native scoring separates B2B-capable difficult attack from ordinary line-clear attack
- [x] Native full grounded placement enumeration with reachable-history regression tests
- [x] Native T-spin setup-aware pruning with precise report-side potential checks
- [x] Native T-spin setup pruning filters unreachable continuation slots before beam ranking
- [x] Opener reports show B2B chain, difficult attack, and fumen preview URLs
- [x] Broaden deterministic two-bag queue discovery beyond the current survey seeds
- [x] Keep survey/discovery queues to valid two-bag inputs
- [x] Native bag ranking exposes and prefers TL B2B/T-spin continuation metrics over perfect-clear bias
- [x] Native pruning rewards B2B-preserving quad wells when a future I piece exists
- [x] Add opener-template survivability grouping across experiment queue permutations
- [x] Expand survivability from top-candidate grouping to full template replay across wider queues
- [x] Add a three-bag continuation preset for B2B T-spin chain experiments
- [x] Add a bench regression gate for three-bag B2B T-spin continuation quality
- [x] Reduce two-bag experiment beam width while preserving top B2B T-spin firepower
- [x] Add experiment quality gates for curated B2B T-spin opener presets
- [x] Add a bench regression gate for two-bag B2B T-spin opener quality
- [x] Reduce native opener search path cloning while preserving B2B T-spin quality gates
- [x] Remove duplicate native T-spin continuation scans from opener pruning
- [x] Avoid per-state heap allocation while enumerating hold choices
