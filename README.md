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
bun run experiment:opener -- --preset=continuation --top=1 --setup-pool-multiplier=26
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
- [x] Pre-size native opener search maps to reduce rehashing during beam expansion
- [x] Cache native reachability BFS only after direct-drop checks miss
- [x] Reuse native reachability spawn checks across placement candidates
- [x] Use a lightweight deterministic hasher for native opener search maps
- [x] Reuse native reachability cache while estimating T-spin continuation potential
- [x] Skip non-T immobility spin detection on the TETR.IO TL T-spin path
- [x] Limit native continuation potential credit to T/I pieces reachable within remaining search depth
- [x] Use native shape row masks for faster collision and lock operations
- [x] Add regression tests for B2B carry/reset, empty-hold queue consumption, grounded placements, and TL non-T spin suppression
- [x] Use static equivalent-rotation lookup for native reachability cache membership
- [x] Pre-allocate accepted native child paths and placement histories during beam expansion
- [x] Stop native T-spin potential scans once the maximum reachable continuation value is found
- [x] Make native ALL-MINI and MINI-ONLY non-T spin clears advance Back-to-Back chains
- [x] Cache native quad-well continuation potential by board rows during beam rescoring
- [x] Model native HANDHELD non-T spins with 4-corner detection and halved attack
- [x] Skip native T immobility checks for spin modes that cannot use immobile T minis
- [x] Add fumen parity coverage for real native hold and line-clear placement histories
- [x] Scan occupied row bits directly during native board evaluation
- [x] Combine native line-clear counting and clearing during placement evaluation
- [x] Show native candidate queue index and hold state in opener Markdown reports
- [x] Pack native search-key board rows before hashing opener beam states
- [x] Match template survivability replay bag count and depth to the selected opener preset
- [x] Group mirrored final boards as the same opener template for survivability reports
- [x] Derive native placement cells at report conversion time instead of cloning cell vectors during search
- [x] Skip duplicate placement boundary checks inside native opener search scans
- [x] Skip duplicate native reachability collision checks for already-visited BFS states
- [x] Deduplicate native beam states with single-entry hash map lookups
- [x] Sample capped native bag queues across deterministic permutation positions instead of DFS prefixes
- [x] Add medium-depth TL B2B T-spin pruning regression coverage
- [x] Stream native bag permutation evaluation without prebuilding queue vectors
- [x] Compare native placement-step tie breakers with numeric piece ranks
- [x] Use early-return native beam comparators on the search ranking hot path
- [x] Use native difficult-attack totals for opener report ranking and replay
- [x] Reuse native bag permutation buffers during sampled opener evaluation
- [x] Key opener template replay by board, hold, queue progress, and B2B state
- [x] Prioritize replay-hit survivability before firepower inside replay reports
- [x] Keep console top compact while using a wider internal replay template pool
- [x] Track bag-boundary phase replay hits separately from exact final-board replay
- [x] Reuse full phase indexes for cached replay and grouped template representatives
- [x] Use a wider continuation replay pool so robust B2B/T-spin templates can outrank brittle max-firepower lines
- [x] Make continuation experiments replay templates by default instead of emitting firepower-only top lines
- [x] Preserve native bag-boundary phase families during beam pruning
- [x] Keep replay reports ordered by B2B/T-spin firepower before quality-only broadness
- [x] Prune exact native T-spin setup scans only on three-bag continuation beams
- [x] Report normalized phase-profile replay hits separately from exact phase hits
- [x] Add an opt-in native setup-pool multiplier for slower high-quality TL search passes
- [x] Report replay firepower quality hits separately from exact template reconstruction
- [x] Curate continuation source queues to TL-gated three-bag B2B/T-spin lines
- [x] Rank replay reports by reproducible B2B/T-spin firepower instead of brittle peak firepower
- [x] Promote additional measured TL-gated three-bag queues into continuation discovery
- [x] Replay continuation phase survivability against the native fourteen-piece frontier
- [x] Preserve native continuation phase diversity by hold and B2B state
- [x] Compute continuation phase frontiers lazily during replay instead of every source search
- [x] Promote measured high-firepower 3T-spin/3B2B continuation queues into discovery
- [x] Prefer holeless candidates when B2B/T-spin firepower is equivalent in reports
- [x] Exclude quality-gate failures from opener template replay pools
- [x] Use placement-light native searches for template replay checks
