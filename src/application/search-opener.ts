import { loadNativeBinding } from "../infrastructure/native/load-native-binding";
import type {
  NativeBeamSearchNode,
  NativeFirepowerInput,
  NativeFirepowerSummary,
  NativeOpenerBagEvaluation,
  NativeSpinDetection
} from "../infrastructure/native/binding-types";

export type SearchPiece = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

export interface SearchOpenerBeamInput {
  readonly queue: string | readonly SearchPiece[];
  readonly beamWidth?: number;
  readonly hold?: boolean;
  readonly maxDepth?: number;
}

export interface EvaluateOpenerBagInput {
  readonly bag?: string | readonly SearchPiece[];
  readonly beamWidth?: number;
  readonly hold?: boolean;
  readonly maxDepth?: number;
  readonly maxQueues?: number;
  readonly topQueueCount?: number;
}

export type SearchOpenerBeamNode = NativeBeamSearchNode;
export type OpenerBagEvaluation = NativeOpenerBagEvaluation;

export interface OpenerPlacementReachabilityInput {
  readonly rows: Uint16Array;
  readonly piece: SearchPiece;
  readonly rotation: number;
  readonly x: number;
  readonly y: number;
}

export function searchOpenerBeam(input: SearchOpenerBeamInput): SearchOpenerBeamNode[] {
  const queue = typeof input.queue === "string" ? input.queue : input.queue.join("");
  return loadNativeBinding().searchOpenerBeam(queue, input.beamWidth ?? 64, input.hold ?? true, input.maxDepth ?? queue.length);
}

export function searchOpenerBeamWithPlacements(input: SearchOpenerBeamInput): SearchOpenerBeamNode[] {
  const queue = typeof input.queue === "string" ? input.queue : input.queue.join("");
  return loadNativeBinding().searchOpenerBeamWithPlacements(
    queue,
    input.beamWidth ?? 64,
    input.hold ?? true,
    input.maxDepth ?? queue.length
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
    input.topQueueCount ?? 16
  );
}

export function canReachOpenerPlacement(input: OpenerPlacementReachabilityInput): boolean {
  return loadNativeBinding().canReachOpenerPlacement(input.rows, input.piece, input.rotation, input.x, input.y);
}

export function detectOpenerSpin(input: OpenerPlacementReachabilityInput): NativeSpinDetection {
  return loadNativeBinding().detectOpenerSpin(input.rows, input.piece, input.rotation, input.x, input.y);
}

export function evaluateOpenerFirepower(events: readonly NativeFirepowerInput[]): NativeFirepowerSummary {
  return loadNativeBinding().evaluateOpenerFirepower([...events]);
}
