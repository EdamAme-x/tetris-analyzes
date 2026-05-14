import { loadNativeBinding } from "../infrastructure/native/load-native-binding";
import type { NativeBeamSearchNode } from "../infrastructure/native/binding-types";

export type SearchPiece = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

export interface SearchOpenerBeamInput {
  readonly queue: string | readonly SearchPiece[];
  readonly beamWidth?: number;
  readonly hold?: boolean;
  readonly maxDepth?: number;
}

export type SearchOpenerBeamNode = NativeBeamSearchNode;

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
