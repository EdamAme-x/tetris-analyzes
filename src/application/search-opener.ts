import { loadNativeBinding } from "../infrastructure/native/load-native-binding";
import type {
  NativeBeamSearchNode,
  NativeComboTable,
  NativeFirepowerInput,
  NativeFirepowerSummary,
  NativeKickTable,
  NativeOpenerBagEvaluation,
  NativeSpinMode,
  NativeSpinDetection
} from "../infrastructure/native/binding-types";

export type SearchPiece = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

export interface SearchOpenerBeamInput {
  readonly queue: string | readonly SearchPiece[];
  readonly beamWidth?: number;
  readonly hold?: boolean;
  readonly maxDepth?: number;
  readonly comboTable?: NativeComboTable;
  readonly kickTable?: NativeKickTable;
  readonly spinMode?: NativeSpinMode;
}

export interface EvaluateOpenerBagInput {
  readonly bag?: string | readonly SearchPiece[];
  readonly beamWidth?: number;
  readonly hold?: boolean;
  readonly maxDepth?: number;
  readonly maxQueues?: number;
  readonly topQueueCount?: number;
  readonly comboTable?: NativeComboTable;
  readonly kickTable?: NativeKickTable;
  readonly spinMode?: NativeSpinMode;
}

export type SearchOpenerBeamNode = NativeBeamSearchNode;
export type OpenerBagEvaluation = NativeOpenerBagEvaluation;

export interface OpenerPlacementReachabilityInput {
  readonly rows: Uint16Array;
  readonly piece: SearchPiece;
  readonly rotation: number;
  readonly x: number;
  readonly y: number;
  readonly kickTable?: NativeKickTable;
  readonly spinMode?: NativeSpinMode;
}

export function searchOpenerBeam(input: SearchOpenerBeamInput): SearchOpenerBeamNode[] {
  const queue = typeof input.queue === "string" ? input.queue : input.queue.join("");
  return loadNativeBinding().searchOpenerBeam(
    queue,
    input.beamWidth ?? 64,
    input.hold ?? true,
    input.maxDepth ?? queue.length,
    input.comboTable,
    input.kickTable,
    input.spinMode
  );
}

export function searchOpenerBeamWithPlacements(input: SearchOpenerBeamInput): SearchOpenerBeamNode[] {
  const queue = typeof input.queue === "string" ? input.queue : input.queue.join("");
  return loadNativeBinding().searchOpenerBeamWithPlacements(
    queue,
    input.beamWidth ?? 64,
    input.hold ?? true,
    input.maxDepth ?? queue.length,
    input.comboTable,
    input.kickTable,
    input.spinMode
  );
}

export function evaluateOpenerBag(input: EvaluateOpenerBagInput = {}): OpenerBagEvaluation {
  const bag = input.bag === undefined ? "TIJLOSZ" : typeof input.bag === "string" ? input.bag : input.bag.join("");
  return loadNativeBinding().evaluateOpenerBag(
    bag,
    input.beamWidth ?? 64,
    input.hold ?? true,
    input.maxDepth ?? Math.min(4, bag.length),
    input.maxQueues ?? 0,
    input.topQueueCount ?? 16,
    input.comboTable,
    input.kickTable,
    input.spinMode
  );
}

export function canReachOpenerPlacement(input: OpenerPlacementReachabilityInput): boolean {
  return loadNativeBinding().canReachOpenerPlacement(input.rows, input.piece, input.rotation, input.x, input.y, input.kickTable);
}

export function detectOpenerSpin(input: OpenerPlacementReachabilityInput): NativeSpinDetection {
  return loadNativeBinding().detectOpenerSpin(input.rows, input.piece, input.rotation, input.x, input.y, input.spinMode);
}

export function estimateOpenerTSpinPotential(rows: Uint16Array, kickTable?: NativeKickTable): number {
  return loadNativeBinding().estimateOpenerTSpinPotential(rows, kickTable);
}

export function evaluateOpenerFirepower(events: readonly NativeFirepowerInput[]): NativeFirepowerSummary {
  return loadNativeBinding().evaluateOpenerFirepower([...events]);
}
