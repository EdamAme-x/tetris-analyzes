export const OPENER_ENGINE_TASKS = [
  {
    id: "srs-reachability",
    title: "Filter opener candidates by movement reachability.",
    status: "in-progress",
    implementation: "native-rust",
    evidence: [
      "searchOpenerBeam filters final placements through a native visible-board SRS+ reachability pass.",
      "canReachOpenerPlacement exposes the native reachability helper for tests."
    ]
  },
  {
    id: "spin-detection",
    title: "Detect T-spin, mini, all-spin, and all-mini classifications.",
    status: "pending",
    implementation: "native-rust",
    evidence: []
  },
  {
    id: "firepower-evaluation",
    title: "Score line clears, B2B, combo, all clear, and spin bonuses as opener firepower.",
    status: "pending",
    implementation: "native-rust",
    evidence: []
  },
  {
    id: "pc-continuation",
    title: "Evaluate perfect clear chances and continuation quality after the visible template.",
    status: "pending",
    implementation: "native-rust",
    evidence: []
  },
  {
    id: "bag-probability",
    title: "Aggregate template buildability over 7-bag queues and hold decisions.",
    status: "pending",
    implementation: "native-rust",
    evidence: []
  },
  {
    id: "tetrio-rules-parity",
    title: "Keep movement, kicks, attack, spins, combo, gravity, and garbage aligned with extracted TETR.IO tables.",
    status: "pending",
    implementation: "native-rust-and-codegen",
    evidence: ["src/generated/tetrio-tables.generated.ts pins the extracted TETR.IO payload."]
  }
] as const;

export type OpenerEngineTask = (typeof OPENER_ENGINE_TASKS)[number];
