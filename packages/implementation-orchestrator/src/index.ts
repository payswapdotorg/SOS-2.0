/**
 * @sos-2/implementation-orchestrator — the mission-to-plan-to-graph front
 * half of the P13 flagship greenfield journey.
 *
 * Composition (consumed, never re-defined):
 *   - @sos-2/mission            the formalized mission artifact model
 *   - @sos-2/harness            the §3 capability vocabulary
 *   - @sos-2/evaluator          the P9 evaluation-type vocabulary
 *   - @sos-2/action-gateway     content addressing (deterministic ids)
 *   - @sos-2/semantic-spine     canonical JSON + RFC3339 discipline
 *
 * Determinism: no Date.now / Math.random / fetch / process.env / ambient
 * timers / child_process in this package's src — every instant is
 * caller-supplied; every identity is content-derived or caller-supplied.
 */

export { ImplementationOrchestratorError, InvalidImplementationPlanError, InvalidDecompositionError, InvalidMissionIntakeError } from './errors.js';

export {
  PIPELINE_ASK_STAGES,
  PIPELINE_ASK_REASONS,
  mintPipelineAsk,
} from './asks.js';
export type { PipelineAsk, PipelineAskStage, PipelineAskReason, MintPipelineAskInput } from './asks.js';

export {
  assertValidRawUserMission,
  runMissionIntake,
} from './intake.js';
export type { RawUserMission, MissionIntakeOutcome, MissionFormalizerPort, MissionFormalizationResult } from './intake.js';

export {
  assertValidImplementationPlan,
  buildImplementationPlan,
  implementationPlanId,
  serializeImplementationPlan,
  runPlanning,
} from './planning.js';
export type {
  CapabilityRequirement,
  AssuranceConstraint,
  PlannedFile,
  PlannedComponent,
  ImplementationPlan,
  PlanningOutcome,
  ArchitecturePlannerPort,
} from './planning.js';

export {
  assertValidTaskWorkProgram,
  assertValidDecomposition,
  parseTaskWorkProgram,
  taskIdForComponent,
  workProgramForComponent,
  decomposePlan,
} from './decomposition.js';
export type { TaskWorkProgram, TaskNodeSpec } from './decomposition.js';

export { ReferenceMissionFormalizer } from './reference/formalizer.js';
export type { ReferenceMissionFormalizerOptions } from './reference/formalizer.js';

export {
  ReferenceArchitecturePlanner,
  REFERENCE_CODING_CAPABILITIES,
  REFERENCE_NODE_EVALUATION_TYPES,
  SCAFFOLD_COMPONENT_ID,
  referenceModuleContents,
  referenceTestContents,
} from './reference/planner.js';
export type { ReferenceArchitecturePlannerOptions } from './reference/planner.js';
