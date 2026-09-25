/**
 * GREENFIELD JOURNEY TYPES (Work Order P13) — the typed state machine of
 * the §11 flagship journey.
 *
 * spec/productization-execution-architecture.md §11 (verbatim contract):
 *
 *     user mission
 *       -> connect GitHub repo
 *       -> SOS formalizes mission
 *       -> architecture/capability plan
 *       -> candidate + assurance
 *       -> worker task graph
 *       -> summon cloud body
 *       -> implementation
 *       -> independent evaluation
 *       -> repair/retry or ASK
 *       -> commit/PR/push
 *       -> deployment
 *       -> runtime verification
 *       -> evidence-backed completion report
 *
 * The journey must continue without the user's computer remaining online
 * when all required resources are remote (§7): the engine advances ONLY
 * on CLOUD ticks; user presence is RECORDED, never required.
 */

import type { ActorRef, ActionFamily } from '@sos-2/action-gateway';
import type { MissionArtifact } from '@sos-2/mission';
import type { ImplementationPlan } from '@sos-2/implementation-orchestrator';
import type { PipelineAsk } from '@sos-2/implementation-orchestrator';
import type {
  RealizedCommit,
  RealizedDeployment,
  RealizedPullRequest,
  RealizedPush,
} from '@sos-2/project-realization';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import type { JourneyImportedRevision, JourneyRepositoryId } from './github-port.js';

/**
 * The §11 journey stages. The §11 pipeline order is preserved exactly
 * (mission -> connect repo -> formalize -> plan -> candidate+assurance ->
 * task graph -> bodies -> implementation -> evaluation -> repair/ASK ->
 * commit/PR/push -> deployment -> runtime verification -> completion
 * report); the typed AUTHORITY_APPROVED gate sits at the acceptance
 * boundary (steps 1-3 are the user-present phase: create mission,
 * connect repository, approve authority; step 4 "let SOS run" is the
 * cloud-tick phase that drives every stage below it without the user's
 * computer remaining online).
 */
export const GREENFIELD_JOURNEY_STAGES = [
  'MISSION_RECEIVED',
  'REPOSITORY_CONNECTED',
  'AUTHORITY_APPROVED',
  'MISSION_FORMALIZED',
  'PLAN_PREPARED',
  'GRAPH_BUILT',
  'WORKSPACE_PROVISIONED',
  'IMPLEMENTING',
  'IMPLEMENTED',
  'CHANGE_REALIZED',
  'DEPLOYED',
  'RUNTIME_VERIFIED',
  'COMPLETED',
] as const;
export type GreenfieldJourneyStage = (typeof GREENFIELD_JOURNEY_STAGES)[number];

/** The journey-level status (ASK parking and typed failures are visible). */
export const GREENFIELD_JOURNEY_STATUSES = ['RUNNING', 'AWAITING_ASK', 'COMPLETED', 'FAILED'] as const;
export type GreenfieldJourneyStatus = (typeof GREENFIELD_JOURNEY_STATUSES)[number];

/** One recorded stage transition (typed, inspectable). */
export interface JourneyStageTransition {
  readonly from: GreenfieldJourneyStage | null;
  readonly to: GreenfieldJourneyStage;
  readonly at: string;
}

/** The authority a journey needs before any consequential action (typed requirement). */
export interface AuthorityRequirement {
  /** The action families the journey will exercise through the gateway. */
  readonly families: readonly ActionFamily[];
  /** The exact scope per family (the gateway re-evaluates at action time). */
  readonly scopes: readonly { readonly family: ActionFamily; readonly scope: string }[];
  readonly rationale: string;
}

/** The typed outcome of a repository connection. */
export type ConnectRepositoryOutcome =
  | { readonly kind: 'CONNECTED'; readonly repository: JourneyRepositoryId; readonly imported: JourneyImportedRevision; readonly simulated: boolean }
  | { readonly kind: 'NOT_FOUND'; readonly repository: JourneyRepositoryId; readonly detail: string }
  | { readonly kind: 'NOT_EMPTY'; readonly repository: JourneyRepositoryId; readonly detail: string; readonly ask: PipelineAsk }
  | { readonly kind: 'UNSUPPORTED'; readonly repository: JourneyRepositoryId; readonly detail: string };

/** What one cloud tick did (the deterministic audit unit). */
export type CloudTickAction =
  | { readonly kind: 'STAGE_ADVANCED'; readonly stage: GreenfieldJourneyStage }
  | { readonly kind: 'NODE_DISPATCHED'; readonly taskId: string; readonly bodyId: string; readonly leaseRef: string; readonly lane: number }
  | { readonly kind: 'NODE_COMPLETED'; readonly taskId: string; readonly sourceRevision: string; readonly certificationId: string }
  | { readonly kind: 'NODE_FAILED'; readonly taskId: string; readonly failureKind: string; readonly reason: string }
  | { readonly kind: 'NODE_RECOVERED'; readonly taskId: string; readonly retries: number }
  | { readonly kind: 'ASK_PARKED'; readonly ask: PipelineAsk }
  | { readonly kind: 'DENIED'; readonly taskId: string | null; readonly code: string; readonly reason: string }
  | { readonly kind: 'IDLE'; readonly reason: string };

export interface CloudTickRecord {
  readonly tick: number;
  readonly stage: GreenfieldJourneyStage;
  readonly action: CloudTickAction;
  /** Honest device-optional marker: presence is recorded, never required. */
  readonly userDeviceOnline: boolean;
}

/** The durable journey state (a typed, inspectable record). */
export interface JourneyState {
  readonly journeyId: string;
  /** Null until kickoff; then the §11 stage (never regresses). */
  readonly stage: GreenfieldJourneyStage | null;
  readonly status: GreenfieldJourneyStatus;
  readonly rawMissionStatement: string | null;
  readonly repository: JourneyRepositoryId | null;
  readonly importedRevision: JourneyImportedRevision | null;
  readonly mission: MissionArtifact | null;
  readonly authorityGrantId: string | null;
  readonly plan: ImplementationPlan | null;
  readonly workspaceHead: string | null;
  readonly realizedCommits: readonly RealizedCommit[];
  readonly push: RealizedPush | null;
  readonly pullRequest: RealizedPullRequest | null;
  readonly deployment: RealizedDeployment | null;
  readonly pendingAsk: PipelineAsk | null;
  readonly transitions: readonly JourneyStageTransition[];
  /** Honest provider statuses carried into the completion report. */
  readonly providerStatuses: readonly { readonly name: string; readonly status: string; readonly detail: string }[];
}

/** One replayable timeline event (the P7 observation projection). */
export interface JourneyTimelineEvent {
  readonly eventId: string;
  readonly kind: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly payload: Record<string, unknown>;
  readonly provenance: readonly string[];
}

/** The acting principal of the journey (stable across body replacement). */
export interface JourneyPrincipal {
  readonly actingBody: ActorRef;
  readonly system: ActorRef;
}

/** Derive the acting-body principal id for a journey (bodies are ephemeral; the principal is stable). */
export function actingBodyIdFor(journeyId: string): string {
  return `p13-acting-body:${journeyId}`;
}

/** Derive the implementation branch name for a journey (deterministic). */
export function implementationBranchFor(journeyId: string): string {
  return `sos/mission-${journeyId}`;
}

/** The default authority requirement of the flagship journey. */
export function defaultAuthorityRequirement(journeyId: string, deploymentEnvironment: string): AuthorityRequirement {
  const branch = implementationBranchFor(journeyId);
  return {
    families: ['commit', 'push', 'pull-request', 'deployment', 'rollback'],
    scopes: [
      { family: 'commit', scope: 'workspace' },
      { family: 'push', scope: branch },
      { family: 'pull-request', scope: branch },
      { family: 'deployment', scope: deploymentEnvironment },
      { family: 'rollback', scope: '*' },
    ],
    rationale:
      'the flagship journey realizes the implementation into the connected repository (commits on the implementation branch, a pull request, a push) and integrates a deployment; every action is re-evaluated against the CURRENT grant at action time by the P9 gateway (a planning-time grant is never sufficient)',
  };
}

/** Typed grant summary for reports (the artifact id + scope, never the grant content). */
export interface AuthorityGrantSummary {
  readonly grantId: string;
  readonly grantee: string;
  readonly scope: string;
  readonly permissions: readonly string[];
}

export function summarizeGrant(grant: AuthorityGrantArtifact): AuthorityGrantSummary {
  return {
    grantId: grant.envelope.id,
    grantee: grant.content.grantee,
    scope: grant.content.scope.kind === 'ARTIFACT' ? `ARTIFACT:${grant.content.scope.artifact_id}` : `KIND:${grant.content.scope.artifact_kind}`,
    permissions: [...grant.content.permissions],
  };
}
