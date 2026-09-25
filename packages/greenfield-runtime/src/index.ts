/**
 * @sos-2/greenfield-runtime — the §11 flagship journey engine (Work
 * Order P13).
 *
 * A typed state machine over the durable P6 task graph that composes the
 * merged surfaces end-to-end: the P4 GitHub connection, the P13
 * implementation-orchestrator (formalization + planning + decomposition),
 * the P6 task graph, the P5 body broker (cloud bodies) + execution
 * fabric, the P8 harness seams, the P13 project realization (P9 gateway
 * only), the P9 independent evaluation suite (the ONLY completion gate)
 * and the P7 observation discipline (the replayable timeline).
 *
 * Determinism: no Date.now / Math.random / fetch / process.env / ambient
 * timers / child_process in this package's src — the clock, stores,
 * seams, presence recorder and provider statuses are injected; the
 * composition root (tests/mission-to-repo) is the impure boundary.
 */

export { GreenfieldRuntimeError, JourneyStageError, InvalidJourneyDepsError, InvalidCompletionReportError } from './errors.js';

export { parseJourneyRepositorySlug } from './github-port.js';
export type {
  JourneyGitHubPort,
  JourneyGitHubOutcome,
  JourneyGitHubConnectionState,
  JourneyRepositoryId,
  JourneyRepositorySummary,
  JourneyRepositorySnapshot,
  JourneySnapshotRefSelection,
  JourneyImportedRevision,
} from './github-port.js';

export {
  GREENFIELD_JOURNEY_STAGES,
  GREENFIELD_JOURNEY_STATUSES,
  actingBodyIdFor,
  implementationBranchFor,
  defaultAuthorityRequirement,
  summarizeGrant,
} from './types.js';
export type {
  GreenfieldJourneyStage,
  GreenfieldJourneyStatus,
  JourneyStageTransition,
  AuthorityRequirement,
  ConnectRepositoryOutcome,
  CloudTickAction,
  CloudTickRecord,
  JourneyState,
  JourneyTimelineEvent,
  JourneyPrincipal,
  AuthorityGrantSummary,
} from './types.js';

export {
  JOURNEY_OBSERVATION_SOURCE,
  JourneyObserver,
  journeyTimeline,
  taskAndEvidenceTimeline,
} from './observation.js';

export { CompletionCertifier } from './certification.js';
export type { CertificationRequest, CertificationOutcome, CompletionCertifierDeps } from './certification.js';

export type { TaskImplementationRequest, TaskImplementationOutcome } from './implementation.js';
export type { TaskImplementationPort } from './implementation.js';

export {
  buildCompletionReport,
  completionRecordId,
  recomputeCompletionId,
  assertValidCompletionReport,
  evaluationSliceOf,
  sourceRevisionsOf,
} from './report.js';
export type { CompletionReport, CompletionReportBody, CompletedTaskSummary } from './report.js';

export { GreenfieldJourney } from './journey.js';
export type { GreenfieldJourneyDeps, NodeRepairExecutor, JourneyCompletionOutcome } from './journey.js';

export type { AuthorityApprovalPort, GrantingAuthorityPort, ReferenceAuthorityApprovalDeps } from './reference/approval.js';
export { ReferenceAuthorityApproval } from './reference/approval.js';

export { ReferenceBodyTaskExecutor, corruptFileContents } from './reference/body-executor.js';
export type { ReferenceBodyTaskExecutorOptions, ReferenceDefectSpec } from './reference/body-executor.js';

export { ReferenceNodeRepairExecutor } from './reference/repair.js';
export type { ReferenceNodeRepairExecutorOptions } from './reference/repair.js';
