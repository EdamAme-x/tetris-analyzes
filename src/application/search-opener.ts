import { loadNativeBinding } from "../infrastructure/native/load-native-binding";
import type {
  NativeBeamSearchNode,
  NativeComboTable,
  NativeFirepowerInput,
  NativeFirepowerSummary,
  NativeKickTable,
  NativeOpenerBagEvaluation,
  NativeOpenerBagTemplateMining,
  NativeRotationResolution,
  NativeSpinAfterRotation,
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
  readonly allow180?: boolean;
  readonly setupPoolMultiplier?: number;
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
  readonly allow180?: boolean;
}

export interface MineOpenerBagTemplatesInput {
  readonly bag?: string | readonly SearchPiece[];
  readonly beamWidth?: number;
  readonly hold?: boolean;
  readonly maxDepth?: number;
  readonly maxQueues?: number;
  readonly topTemplateCount?: number;
  readonly includePath?: boolean;
  readonly comboTable?: NativeComboTable;
  readonly kickTable?: NativeKickTable;
  readonly spinMode?: NativeSpinMode;
  readonly allow180?: boolean;
}

export type SearchOpenerBeamNode = NativeBeamSearchNode;
export type OpenerBagEvaluation = NativeOpenerBagEvaluation;
export type OpenerBagTemplateMining = NativeOpenerBagTemplateMining;

export interface OpenerPlacementReachabilityInput {
  readonly rows: Uint16Array;
  readonly piece: SearchPiece;
  readonly rotation: number;
  readonly x: number;
  readonly y: number;
  readonly kickTable?: NativeKickTable;
  readonly spinMode?: NativeSpinMode;
  readonly allow180?: boolean;
}

export interface OpenerRotationResolutionInput {
  readonly rows: Uint16Array;
  readonly piece: SearchPiece;
  readonly rotation: number;
  readonly x: number;
  readonly y: number;
  readonly direction: -1 | 1 | 2;
  readonly kickTable?: NativeKickTable;
  readonly allow180?: boolean;
}

export interface OpenerSpinAfterRotationInput extends OpenerRotationResolutionInput {
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
    input.spinMode,
    input.setupPoolMultiplier,
    input.allow180
  );
}

export function searchOpenerBeamCompact(input: SearchOpenerBeamInput): SearchOpenerBeamNode[] {
  const queue = typeof input.queue === "string" ? input.queue : input.queue.join("");
  return loadNativeBinding().searchOpenerBeamCompact(
    queue,
    input.beamWidth ?? 64,
    input.hold ?? true,
    input.maxDepth ?? queue.length,
    input.comboTable,
    input.kickTable,
    input.spinMode,
    input.setupPoolMultiplier,
    input.allow180
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
    input.spinMode,
    input.setupPoolMultiplier,
    input.allow180
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
    input.spinMode,
    input.allow180
  );
}

export function mineOpenerBagTemplates(input: MineOpenerBagTemplatesInput = {}): OpenerBagTemplateMining {
  const bag = input.bag === undefined ? "TIJLOSZ" : typeof input.bag === "string" ? input.bag : input.bag.join("");
  return loadNativeBinding().mineOpenerBagTemplates(
    bag,
    input.beamWidth ?? 64,
    input.hold ?? true,
    input.maxDepth ?? Math.min(4, bag.length),
    input.maxQueues ?? 0,
    input.topTemplateCount ?? 16,
    input.includePath ?? false,
    input.comboTable,
    input.kickTable,
    input.spinMode,
    input.allow180
  );
}

export function canReachOpenerPlacement(input: OpenerPlacementReachabilityInput): boolean {
  return loadNativeBinding().canReachOpenerPlacement(
    input.rows,
    input.piece,
    input.rotation,
    input.x,
    input.y,
    input.kickTable,
    input.allow180
  );
}

export function resolveOpenerRotation(input: OpenerRotationResolutionInput): NativeRotationResolution {
  return loadNativeBinding().resolveOpenerRotation(
    input.rows,
    input.piece,
    input.rotation,
    input.x,
    input.y,
    input.direction,
    input.kickTable,
    input.allow180
  );
}

export function detectOpenerSpin(input: OpenerPlacementReachabilityInput): NativeSpinDetection {
  return loadNativeBinding().detectOpenerSpin(
    input.rows,
    input.piece,
    input.rotation,
    input.x,
    input.y,
    input.spinMode,
    input.kickTable,
    input.allow180
  );
}

export function detectOpenerSpinAfterRotation(input: OpenerSpinAfterRotationInput): NativeSpinAfterRotation {
  return loadNativeBinding().detectOpenerSpinAfterRotation(
    input.rows,
    input.piece,
    input.rotation,
    input.x,
    input.y,
    input.direction,
    input.spinMode,
    input.kickTable,
    input.allow180
  );
}

export function estimateOpenerTSpinPotential(rows: Uint16Array, kickTable?: NativeKickTable, allow180?: boolean): number {
  return loadNativeBinding().estimateOpenerTSpinPotential(rows, kickTable, allow180);
}

export function evaluateOpenerFirepower(events: readonly NativeFirepowerInput[]): NativeFirepowerSummary {
  return loadNativeBinding().evaluateOpenerFirepower([...events]);
}
