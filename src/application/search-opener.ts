import { loadNativeBinding } from "../infrastructure/native/load-native-binding";
import type { NativeBeamSearchNode, NativeSpinDetection } from "../infrastructure/native/binding-types";

export type SearchPiece = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

export interface SearchOpenerBeamInput {
  readonly queue: string | readonly SearchPiece[];
  readonly beamWidth?: number;
  readonly hold?: boolean;
  readonly maxDepth?: number;
}

export type SearchOpenerBeamNode = NativeBeamSearchNode;

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

export function canReachOpenerPlacement(input: OpenerPlacementReachabilityInput): boolean {
  return loadNativeBinding().canReachOpenerPlacement(input.rows, input.piece, input.rotation, input.x, input.y);
}

export function detectOpenerSpin(input: OpenerPlacementReachabilityInput): NativeSpinDetection {
  return loadNativeBinding().detectOpenerSpin(input.rows, input.piece, input.rotation, input.x, input.y);
}
