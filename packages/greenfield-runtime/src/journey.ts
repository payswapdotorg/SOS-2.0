/**
 * THE GREENFIELD JOURNEY ENGINE (Work Order P13) — the §11 flagship
 * journey as a typed state machine over the durable P6 task graph.
 *
 *     user mission -> connect GitHub repo -> [user approves authority]
 *       -> SOS formalizes mission -> architecture/capability plan
 *       -> candidate + assurance -> worker task graph -> summon cloud
 *       body -> implementation -> independent evaluation -> repair/retry
 *       or ASK -> commit/PR/push -> deployment -> runtime verification
 *       -> evidence-backed completion report
 *
 * COMPOSITION (the merged surfaces, consumed never re-implemented):
 *
 *   - the task graph is @sos-2/task-graph (P6): every planned task is a
 *     node carrying mission_ref + authority_ref; assignment is lane-
 *     scoped onto DISJOINT owned paths; completion is verification-gated
 *     (fabric.completeTask -> adoptFabricTransition -> recordVerificationRef
 *     — the P6 completion chain);
 *   - bodies come from the P5 BodyBroker (capability-based selection,
 *     cloud placement — the journey continues while the user's computer
 *     is off); body-side work runs through the P8 HarnessContract seam;
 *   - repository realization is @sos-2/project-realization (P9 gateway
 *     only — the pipeline never touches a filesystem, git CLI or
 *     deployment API);
 *   - the completion gate is the independent P9 evaluation suite:
 *     per-node gates run the applicable evaluators against the EXACT
 *     produced revision (verdicts never carry across revisions), the
 *     repair discipline is bounded (repair into a NEW revision, full
 *     fresh suite, ASK when the bound is exhausted — never a silent
 *     infinite loop), and the journey-level completion is GRANTED only
 *     by the CompletionCertifier relaying the suite's verdicts;
 *   - the GitHub connection is the P4 GitHubPort (reference adapter:
 *     honest SIMULATED states, empty-repository detection);
 *   - every stage transition, dispatch, completion, denial and ask
 *     emits a durable P7-discipline observation event — the timeline a
 *     disconnected user replays on return.
 *
 * §7 USER DEVICE MODEL: the engine advances ONLY on cloud ticks
 * (onCloudTick); user presence is RECORDED into observation payloads,
 * never consulted for progress. All required resources are remote.
 *
 * Determinism: no ambient time/randomness/network/process — the clock,
 * stores, seams and presence port are injected; task ids, action ids and
 * ask ids are content-derived or caller-supplied.
 */

import { contentAddress } from '@sos-2/action-gateway';
import type { ActorRef, Clock as GatewayClock } from '@sos-2/action-gateway';
import type { BodyBroker } from '@sos-2/body-broker';
import { aggregate, buildPlan } from '@sos-2/evaluation-orchestration';
import type { EvaluationOrchestrator, EvaluationPlan, EvaluationSummary, SuiteRunRecord } from '@sos-2/evaluation-orchestration';
import type { EvaluationActorRef, EvaluationType, StructuredFailure } from '@sos-2/evaluator';
import type { ExecutionFabric } from '@sos-2/execution-fabric';
import { parseJourneyRepositorySlug } from './github-port.js';
import type { JourneyGitHubPort, JourneyImportedRevision, JourneyRepositoryId } from './github-port.js';
import {
  SCAFFOLD_COMPONENT_ID,
  assertValidRawUserMission,
  decomposePlan,
  mintPipelineAsk,
  runMissionIntake,
  runPlanning,
  taskIdForComponent,
} from '@sos-2/implementation-orchestrator';
import type {
  ArchitecturePlannerPort,
  ImplementationPlan,
  MissionFormalizerPort,
  MissionIntakeOutcome,
  PipelineAsk,
  RawUserMission,
  TaskNodeSpec,
} from '@sos-2/implementation-orchestrator';
import type { AuthorityGrantRepository, Clock, MissionRepository, ObservationEventRepository, TaskStateRepository, TaskVerificationRecord } from '@sos-2/live-store';
import { formatRfc3339 } from '@sos-2/live-store';
import type { MissionArtifact } from '@sos-2/mission';
import {
  buildRepositoryRealizationPlan,
} from '@sos-2/project-realization';
import type {
  RealizedCommit,
  RealizedDeployment,
  RealizedPullRequest,
  RealizedPush,
  RepositoryRealizationPlan,
  RepositoryRealizer,
} from '@sos-2/project-realization';
import type { TaskGraph, TaskNode } from '@sos-2/task-graph';
import { JourneyStageError, InvalidJourneyDepsError } from './errors.js';
import { JourneyObserver, journeyTimeline, taskAndEvidenceTimeline } from './observation.js';
import type { CertificationOutcome, CompletionCertifier } from './certification.js';
import {
  buildCompletionReport,
  evaluationSliceOf,
  recomputeCompletionId,
  sourceRevisionsOf,
} from './report.js';
import type { CompletionReport } from './report.js';
import type { TaskImplementationOutcome, TaskImplementationPort } from './implementation.js';
import type {
  AuthorityRequirement,
  CloudTickAction,
  CloudTickRecord,
  ConnectRepositoryOutcome,
  GreenfieldJourneyStage,
  GreenfieldJourneyStatus,
  JourneyState,
  JourneyTimelineEvent,
  JourneyStageTransition,
} from './types.js';
import {
  actingBodyIdFor,
  defaultAuthorityRequirement,
  implementationBranchFor,
  summarizeGrant,
} from './types.js';
import type { AuthorityApprovalPort } from './reference/approval.js';

/** The typed result of one node repair (a new revision, or the honest null). */
export interface NodeRepairResult {
  readonly newSourceRevision: string | null;
  readonly detail: string;
  /** The realized repair commit (when one landed — exact revision + evidence). */
  readonly realizedCommit: import('@sos-2/project-realization').RealizedCommit | null;
}

/** The node-level repair executor (bounded repair into a NEW revision). */
export interface NodeRepairExecutor {
  repair(input: {
    readonly node: TaskNode;
    readonly failures: readonly StructuredFailure[];
    readonly currentRevision: string;
    readonly attempt: number;
  }): Promise<NodeRepairResult>;
}

/** Journey dependencies — every port INJECTED. */
export interface GreenfieldJourneyDeps {
  /** Caller-supplied RUNTIME journey id (never sos:// shaped). */
  readonly journeyId: string;
  /** The durable P2 repositories the journey writes through. */
  readonly store: {
    readonly missions: MissionRepository;
    readonly authorityGrants: AuthorityGrantRepository;
    readonly tasks: TaskStateRepository;
    readonly observationEvents: ObservationEventRepository;
  };
  /** The P6 durable task graph — THE graph. */
  readonly graph: TaskGraph;
  /** The P5 body broker (capability-based selection + leases). */
  readonly broker: BodyBroker;
  /** The P5 execution fabric (the §10 completion write lives here). */
  readonly fabric: ExecutionFabric;
  /** The P4 GitHub adapter surface (connection, discovery, empty detection). */
  readonly github: JourneyGitHubPort;
  /** The P13 implementation-orchestrator seams. */
  readonly formalizer: MissionFormalizerPort;
  readonly planner: ArchitecturePlannerPort;
  /** The approval seam (the user's authority decision). */
  readonly authorityApproval: AuthorityApprovalPort;
  /** The body-side task implementation seam. */
  readonly bodyExecutor: TaskImplementationPort;
  /** The bounded node-repair seam (the P9 repair discipline). */
  readonly nodeRepair: NodeRepairExecutor;
  /** The independent completion gate (P9 evaluation suite relay). */
  readonly certifier: CompletionCertifier;
  /** The P9 evaluation orchestration (per-node gates). */
  readonly evaluationOrchestration: EvaluationOrchestrator;
  /** The P13 repository realizer (P9 gateway only). */
  readonly realizer: RepositoryRealizer;
  /** The injected clock (live-store shape; no hidden time). */
  readonly clock: Clock;
  /** The user-presence recorder (§7: recorded, never required). */
  readonly presence: { userDeviceOnline(): boolean };
  /** Honest provider statuses carried into the completion report. */
  readonly providerStatuses: readonly { readonly name: string; readonly status: string; readonly detail: string }[];
  /** The deployment environment (default 'production'). */
  readonly deploymentEnvironment?: string;
}

/** The retry budget for failed nodes (the P6 precedent — honest, bounded). */
const NODE_RETRY_BUDGET = 3;

/** The per-node gate outcome. */
type NodeGateOutcome =
  | { readonly kind: 'ALL_VERDICTS_PASS'; readonly certificationId: string; readonly runs: readonly SuiteRunRecord[]; readonly summaries: readonly EvaluationSummary[] }
  | { readonly kind: 'ASK_PARKED'; readonly ask: PipelineAsk };

/** The journey-level completion outcome. */
export type JourneyCompletionOutcome =
  | { readonly kind: 'REPORT'; readonly report: CompletionReport }
  | { readonly kind: 'ASK'; readonly ask: PipelineAsk };

/**
 * THE GREENFIELD JOURNEY. One instance drives ONE journey; every method
 * is a typed stage transition that fails loudly outside its stage.
 */
export class GreenfieldJourney {
  readonly journeyId: string;
  private readonly deps: GreenfieldJourneyDeps;
  private readonly observer: JourneyObserver;
  private readonly gatewayClock: GatewayClock;
  private readonly actingBody: ActorRef;
  private readonly systemActor: ActorRef;

  private stage: GreenfieldJourneyStage | null = null;
  private status: GreenfieldJourneyStatus = 'RUNNING';
  private readonly transitions: JourneyStageTransition[] = [];
  private rawMission: RawUserMission | null = null;
  private repository: JourneyRepositoryId | null = null;
  private importedRevision: JourneyImportedRevision | null = null;
  private mission: MissionArtifact | null = null;
  private authorityGrantId: string | null = null;
  private authorityGrantSummary: ReturnType<typeof summarizeGrant> | null = null;
  private plan: ImplementationPlan | null = null;
  private specs = new Map<string, TaskNodeSpec>();
  private realizationPlan: RepositoryRealizationPlan | null = null;
  private realizedCommits: RealizedCommit[] = [];
  private push: RealizedPush | null = null;
  private pullRequest: RealizedPullRequest | null = null;
  private deployment: RealizedDeployment | null = null;
  private pendingAsk: PipelineAsk | null = null;
  private completion: CompletionReport | null = null;
  private readonly nodeCertifications = new Map<string, { certificationId: string; verdictIds: readonly string[] }>();
  private readonly bodyProvenance = new Map<string, { bodyId: string; leaseRef: string }>();
  private tickCounter = 0;
  private readonly tickLog: CloudTickRecord[] = [];

  constructor(deps: GreenfieldJourneyDeps) {
    if (typeof deps !== 'object' || deps === null) {
      throw new InvalidJourneyDepsError('GreenfieldJourney requires its deps injected');
    }
    if (typeof deps.journeyId !== 'string' || deps.journeyId.length === 0 || deps.journeyId.includes('sos://')) {
      throw new InvalidJourneyDepsError('the journey id must be a non-empty RUNTIME identifier (never sos:// shaped)');
    }
    for (const [field, value] of Object.entries(deps.store ?? {})) {
      if (typeof value !== 'object' || value === null) {
        throw new InvalidJourneyDepsError(`the journey requires the durable P2 store port ${JSON.stringify(field)} injected`);
      }
    }
    for (const field of ['graph', 'broker', 'fabric', 'github', 'formalizer', 'planner', 'authorityApproval', 'bodyExecutor', 'nodeRepair', 'certifier', 'evaluationOrchestration', 'realizer'] as const) {
      const value = (deps as unknown as Record<string, unknown>)[field];
      if (typeof value !== 'object' || value === null) {
        throw new InvalidJourneyDepsError(`the journey requires the ${JSON.stringify(field)} port injected`);
      }
    }
    if (typeof deps.clock !== 'object' || deps.clock === null || typeof deps.clock.nowEpochMs !== 'function') {
      throw new InvalidJourneyDepsError('the journey requires an injected clock (no hidden time)');
    }
    if (typeof deps.presence !== 'object' || deps.presence === null || typeof deps.presence.userDeviceOnline !== 'function') {
      throw new InvalidJourneyDepsError('the journey requires the user-presence recorder injected (§7: recorded, never required)');
    }
    this.journeyId = deps.journeyId;
    this.deps = deps;
    this.observer = new JourneyObserver(deps.store.observationEvents, deps.clock, deps.journeyId);
    this.gatewayClock = { now: () => deps.clock.nowEpochMs() };
    this.actingBody = { kind: 'body', id: actingBodyIdFor(deps.journeyId) };
    this.systemActor = { kind: 'system', id: 'greenfield-runtime' };
  }

  // ---------------------------------------------------------------------------
  // The user-present phase (acceptance steps 1-3)
  // ---------------------------------------------------------------------------

  /** Stage 1 — record the raw user mission. */
  async kickoff(raw: RawUserMission): Promise<void> {
    if (this.stage !== null) {
      throw new JourneyStageError(`kickoff requires an unstarted journey, but the journey is already at ${this.stage}`);
    }
    assertValidRawUserMission(raw);
    this.rawMission = raw;
    await this.observer.emit(
      'journey.mission-received',
      { statement: raw.statement, repositorySlug: raw.repositorySlug, source: raw.source, userDeviceOnline: this.deps.presence.userDeviceOnline() },
      [`raw-mission:${raw.source}`],
    );
    this.enterStage('MISSION_RECEIVED');
  }

  /** Stage 2 — connect the GitHub repository through the P4 adapter surface. */
  async connectRepository(slug: string): Promise<ConnectRepositoryOutcome> {
    this.requireStage('MISSION_RECEIVED');
    const repository = parseJourneyRepositorySlug(slug);

    // The P4 connection contract: honestly NOT_YET_CONNECTED until the
    // handshake completes (the reference provider completes it
    // deterministically and labels every state SIMULATED).
    if (this.deps.github.connection().status !== 'CONNECTED') {
      const authorization = this.deps.github.beginConnection({ scopes: [], state_token: `p13-${this.journeyId}` });
      const completed = this.deps.github.completeConnection({
        authorization_ref: authorization.authorization_ref,
        authorization_code: `reference-handshake:${this.journeyId}`,
        completed_at: formatRfc3339(this.deps.clock.nowEpochMs()),
      });
      if (completed.status !== 'CONNECTED') {
        return { kind: 'UNSUPPORTED', repository, detail: `the GitHub handshake did not complete: ${completed.reason}` };
      }
    }

    const discovery = await this.deps.github.discoverRepositories();
    if (discovery.status !== 'OK') {
      return { kind: 'UNSUPPORTED', repository, detail: `repository discovery failed: ${discovery.reason}` };
    }
    const summary = discovery.result.find((candidate) => candidate.id.owner === repository.owner && candidate.id.name === repository.name);
    if (summary === undefined) {
      return { kind: 'NOT_FOUND', repository, detail: `repository ${slug} is not visible to the connection` };
    }
    if (!summary.is_empty) {
      // The flagship journey realizes into an EMPTY repository; a
      // non-empty repository belongs to the brownfield journey — a typed
      // ASK, never a silent overwrite.
      const ask = mintPipelineAsk({
        stage: 'REALIZATION',
        reasonCode: 'REPOSITORY_NOT_EMPTY',
        detail: `repository ${slug} already contains revisions — the greenfield journey realizes into an empty repository and never overwrites existing work; connect an empty repository or use the brownfield journey`,
        openQuestions: ['Should the mission continue against a different (empty) repository, or as a brownfield journey?'],
        context: { repository, slug },
        createdAt: formatRfc3339(this.deps.clock.nowEpochMs()),
      });
      await this.park(ask);
      return { kind: 'NOT_EMPTY', repository, detail: `repository ${slug} is not empty (${summary.default_branch ?? 'default branch'} exists)`, ask };
    }

    const snapshot = await this.deps.github.getRepositorySnapshot(repository, {}, formatRfc3339(this.deps.clock.nowEpochMs()));
    if (snapshot.status !== 'OK') {
      return { kind: 'UNSUPPORTED', repository, detail: `the repository snapshot could not be captured: ${snapshot.reason}` };
    }
    const imported = this.deps.github.importSnapshot(snapshot.result);
    this.repository = repository;
    this.importedRevision = imported;
    const simulated = this.deps.github.connection().simulated;
    await this.observer.emit(
      'journey.repository-connected',
      {
        repository: { owner: repository.owner, name: repository.name },
        isEmpty: true,
        importedRevision: { branch: imported.branch, revision: imported.revision.value },
        simulated,
        userDeviceOnline: this.deps.presence.userDeviceOnline(),
      },
      [`repository:${slug}`],
    );
    this.enterStage('REPOSITORY_CONNECTED');
    return { kind: 'CONNECTED', repository, imported, simulated };
  }

  /** The typed authority requirement the user must approve (surfaced before any consequential action). */
  authorityRequirement(): AuthorityRequirement {
    return defaultAuthorityRequirement(this.journeyId, this.deploymentEnvironment());
  }

  /** Stage 3 — the user approves the required authority (a typed grant). */
  async approveAuthority(input: { readonly approvedBy: string }): Promise<void> {
    const authorityParked =
      this.pendingAsk !== null && (this.pendingAsk.reasonCode === 'AUTHORITY_REQUIRED' || this.pendingAsk.reasonCode === 'AUTHORITY_REVOKED');
    if (this.stage !== 'REPOSITORY_CONNECTED' && !authorityParked) {
      throw new JourneyStageError(
        `authority approval requires the repository-connected stage (or a parked authority ask), but the journey is at ${this.stage ?? 'nothing'}${this.pendingAsk ? ` with a pending ${this.pendingAsk.reasonCode} ask` : ''}`,
      );
    }
    const grant = await this.deps.authorityApproval.approve({
      requirement: this.authorityRequirement(),
      actor: this.actingBody,
      approvedBy: input.approvedBy,
    });
    this.authorityGrantId = grant.envelope.id;
    this.authorityGrantSummary = summarizeGrant(grant);
    if (authorityParked) {
      this.pendingAsk = null;
      this.status = 'RUNNING';
    }
    await this.observer.emit(
      'journey.authority-approved',
      { grantId: grant.envelope.id, approvedBy: input.approvedBy, families: this.authorityRequirement().families, userDeviceOnline: this.deps.presence.userDeviceOnline() },
      [`authority-grant:${grant.envelope.id}`],
    );
    if (this.stage === 'REPOSITORY_CONNECTED') {
      this.enterStage('AUTHORITY_APPROVED');
    }
  }

  // ---------------------------------------------------------------------------
  // The cloud-tick phase (acceptance step 4 — the user's computer is optional)
  // ---------------------------------------------------------------------------

  /** ONE cloud tick: advance the typed state machine by one deterministic step. */
  async onCloudTick(): Promise<CloudTickRecord> {
    this.tickCounter += 1;
    const userDeviceOnline = this.deps.presence.userDeviceOnline();
    const action = await this.advanceOnCloudTick();
    const record: CloudTickRecord = { tick: this.tickCounter, stage: this.stage ?? 'MISSION_RECEIVED', action, userDeviceOnline };
    this.tickLog.push(record);
    return record;
  }

  private async advanceOnCloudTick(): Promise<CloudTickAction> {
    if (this.status === 'AWAITING_ASK') {
      return { kind: 'IDLE', reason: `parked behind a typed ${this.pendingAsk?.stage ?? 'PIPELINE'} ask (${this.pendingAsk?.reasonCode ?? 'UNKNOWN'}) — a decision authority must resolve it` };
    }
    if (this.status === 'FAILED') {
      return { kind: 'IDLE', reason: 'the journey failed with a typed failure — no silent autonomy past a failure' };
    }
    switch (this.stage) {
      case null:
        return { kind: 'IDLE', reason: 'the journey has not started — kickoff first (user-present phase)' };
      case 'MISSION_RECEIVED':
        return { kind: 'IDLE', reason: 'waiting for the user to connect the GitHub repository (user-present phase)' };
      case 'REPOSITORY_CONNECTED':
        return { kind: 'IDLE', reason: 'waiting for the user to approve the required authority (user-present phase)' };
      case 'AUTHORITY_APPROVED':
        return this.tickFormalize();
      case 'MISSION_FORMALIZED':
        return this.tickPlan();
      case 'PLAN_PREPARED':
        return this.tickBuildGraph();
      case 'GRAPH_BUILT':
      case 'WORKSPACE_PROVISIONED':
      case 'IMPLEMENTING':
        return this.tickNodeCycle();
      case 'IMPLEMENTED':
        return this.tickRealizeChange();
      case 'CHANGE_REALIZED':
        return this.tickDeploy();
      case 'DEPLOYED':
        return this.tickVerifyRuntime();
      case 'RUNTIME_VERIFIED':
        return this.tickRequestCompletion();
      case 'COMPLETED':
        return { kind: 'IDLE', reason: 'the journey is complete — the evidence-backed completion report stands' };
    }
  }

  /** Run the cloud-tick loop to its fixed point (bounded — no ambient loops). */
  async drive(maxTicks = 96): Promise<JourneyState> {
    for (let index = 0; index < maxTicks; index += 1) {
      const record = await this.onCloudTick();
      if (this.stage === 'COMPLETED' || this.status !== 'RUNNING') break;
      if (record.action.kind === 'IDLE') break;
    }
    return this.state();
  }

  // -------------------------------------------------------------------------
  // Stage implementations (cloud-tick driven)
  // -------------------------------------------------------------------------

  private async tickFormalize(): Promise<CloudTickAction> {
    this.requireStage('AUTHORITY_APPROVED');
    if (this.rawMission === null) {
      throw new JourneyStageError('formalization requires the raw mission recorded at kickoff');
    }
    const outcome: MissionIntakeOutcome = runMissionIntake(this.rawMission, this.deps.formalizer);
    if (outcome.kind === 'ASK') {
      await this.park(outcome.ask);
      return { kind: 'ASK_PARKED', ask: outcome.ask };
    }
    await this.deps.store.missions.put(outcome.mission);
    this.mission = outcome.mission;
    await this.observer.emit(
      'journey.mission-formalized',
      { missionRef: outcome.mission.envelope.id, purpose: outcome.mission.content.purpose, ambiguitiesResolved: outcome.ambiguitiesResolved, userDeviceOnline: this.deps.presence.userDeviceOnline() },
      [`mission:${outcome.mission.envelope.id}`],
    );
    this.enterStage('MISSION_FORMALIZED');
    return { kind: 'STAGE_ADVANCED', stage: 'MISSION_FORMALIZED' };
  }

  private async tickPlan(): Promise<CloudTickAction> {
    this.requireStage('MISSION_FORMALIZED');
    if (this.mission === null) {
      throw new JourneyStageError('planning requires a formalized mission');
    }
    const outcome = runPlanning({ mission: this.mission }, this.deps.planner);
    if (outcome.kind === 'ASK') {
      await this.park(outcome.ask);
      return { kind: 'ASK_PARKED', ask: outcome.ask };
    }
    this.plan = outcome.plan;
    await this.observer.emit(
      'journey.plan-prepared',
      {
        planId: outcome.plan.planId,
        missionRef: outcome.plan.missionRef,
        capabilityRequirements: outcome.plan.capabilityRequirements.map((requirement) => requirement.id),
        assuranceConstraints: outcome.plan.assuranceConstraints.map((constraint) => constraint.id),
        components: outcome.plan.components.map((component) => ({ id: component.id, ownedPaths: component.ownedPaths, dependsOn: component.dependsOn })),
        maxRepairAttempts: outcome.plan.maxRepairAttempts,
        userDeviceOnline: this.deps.presence.userDeviceOnline(),
      },
      [`plan:${outcome.plan.planId}`],
    );
    this.enterStage('PLAN_PREPARED');
    return { kind: 'STAGE_ADVANCED', stage: 'PLAN_PREPARED' };
  }

  private async tickBuildGraph(): Promise<CloudTickAction> {
    this.requireStage('PLAN_PREPARED');
    if (this.plan === null || this.mission === null || this.authorityGrantId === null) {
      throw new JourneyStageError('graph building requires the plan, the formalized mission and the approved authority grant');
    }
    const specs = decomposePlan(this.plan);
    for (const spec of specs) {
      await this.deps.graph.addNode({
        task_id: spec.taskId,
        mission_ref: this.mission.envelope.id,
        authority_ref: this.authorityGrantId,
        title: spec.title,
        owned_paths: [...spec.ownedPaths],
        dependencies: [...spec.dependencies],
        unresolved_uncertainty: [],
        cost_envelope: { max_cost_usd: null, max_duration_ms: null },
        steps: spec.steps,
      });
      this.specs.set(spec.taskId, spec);
    }
    // The repository realization plan (DATA — executed through the P9 gateway).
    const branch = implementationBranchFor(this.journeyId);
    const scaffold = this.plan.components.find((component) => component.id === SCAFFOLD_COMPONENT_ID);
    this.realizationPlan = buildRepositoryRealizationPlan({
      repository: {
        owner: this.repository?.owner ?? 'unlinked',
        name: this.repository?.name ?? 'unlinked',
        defaultBranch: 'main',
        implementationBranch: branch,
      },
      scaffoldMessage: 'Provision the repository scaffold (SOS mission-to-implementation)',
      scaffold: scaffold?.files ?? this.plan.components[0]!.files,
      taskCommits: specs.map((spec) => ({
        taskId: spec.taskId,
        message: `Implement: ${spec.title}`,
        changes: (spec.steps as { files: { path: string; contents: string }[] }).files.map((file) => ({ path: file.path, contents: file.contents })),
      })),
      pullRequestTitle: `SOS mission implementation: ${this.mission.content.purpose}`,
      pullRequestDescription: `Realized by the SOS 2.0 mission-to-implementation pipeline (journey ${this.journeyId}, mission ${this.mission.envelope.id}). Every consequential action flowed through the authority-gated action gateway; completion was granted only by the independent evaluation suite.`,
      deploymentEnvironment: this.deploymentEnvironment(),
    });
    await this.observer.emit(
      'journey.graph-built',
      { taskIds: specs.map((spec) => spec.taskId), realizationPlanId: this.realizationPlan.planId, userDeviceOnline: this.deps.presence.userDeviceOnline() },
      [`plan:${this.plan.planId}`],
    );
    this.enterStage('GRAPH_BUILT');
    return { kind: 'STAGE_ADVANCED', stage: 'GRAPH_BUILT' };
  }

  /** One node cycle: recovery -> dispatch -> implement -> commit -> evaluate (-> repair) -> complete or park. */
  private async tickNodeCycle(): Promise<CloudTickAction> {
    const nodes = await this.deps.graph.nodes();

    // RECOVERY — failed RETRYABLE tasks re-queue (bounded by the retry
    // budget; the dead lease ends first — the P6 discipline).
    for (const node of nodes) {
      if (node.state === 'FAILED' && node.recovery.status === 'RETRYABLE' && node.retries < NODE_RETRY_BUDGET) {
        const record = await this.deps.store.tasks.get(node.task_id);
        if (record !== undefined && record.body_lease_ref !== null) {
          const lease = await this.deps.broker.leaseRepository.get(record.body_lease_ref);
          if (lease !== undefined && lease.state === 'ACTIVE') {
            await this.deps.broker.releaseLease(lease.lease_id, `recovery re-queues task ${node.task_id}`);
          }
        }
        const retried = await this.deps.graph.retry(node.task_id);
        await this.observer.emit('journey.node-recovered', { taskId: node.task_id, retries: retried.retries, userDeviceOnline: this.deps.presence.userDeviceOnline() }, [`task:${node.task_id}`]);
      }
    }

    const current = await this.deps.graph.nodes();
    const running = current.filter((node) => node.state === 'RUNNING');
    const pending = current.filter((node) => node.state === 'PENDING');
    const completed = current.filter((node) => node.state === 'COMPLETED');

    if (running.length === 0 && pending.length === 0) {
      if (completed.length === current.length && current.length > 0) {
        this.enterStage('IMPLEMENTED');
        await this.observer.emit('journey.implemented', { tasks: current.length, userDeviceOnline: this.deps.presence.userDeviceOnline() }, [`journey:${this.journeyId}`]);
        return { kind: 'STAGE_ADVANCED', stage: 'IMPLEMENTED' };
      }
      return { kind: 'IDLE', reason: 'no runnable tasks — the graph is parked (asks) or exhausted' };
    }

    // One READY node per tick (dependencies COMPLETED — the graph enforces
    // this at assignment; the pre-check keeps denials out of the tick log).
    const ready = pending.find((node) => node.dependencies.every((dependency) => current.find((candidate) => candidate.task_id === dependency)?.state === 'COMPLETED'));
    if (ready === undefined) {
      return { kind: 'IDLE', reason: 'no ready tasks — dependencies gate assignment (the graph refuses orphans)' };
    }
    const spec = this.specs.get(ready.task_id);
    if (spec === undefined) {
      return { kind: 'DENIED', taskId: ready.task_id, code: 'SPEC_MISSING', reason: `the node ${ready.task_id} carries no P13 spec — the journey only dispatches nodes it decomposed` };
    }

    // SUMMON A CLOUD BODY through the broker contracts (capability-based,
    // vendor-blind; the flagship journey requires cloud placement).
    const selection = this.deps.broker.select({
      requiredCapabilities: [...spec.requiredCapabilities],
      placement: spec.placement,
    });
    if (selection.status !== 'SELECTED') {
      const ask = mintPipelineAsk({
        stage: 'REALIZATION',
        reasonCode: 'NO_BODY_AVAILABLE',
        detail: `no AVAILABLE body advertises the required capabilities [${spec.requiredCapabilities.join(', ')}] at placement ${spec.placement} — ${selection.reason}`,
        openQuestions: ['Should a body provider with the required capabilities be connected, or should the mission wait?'],
        context: { taskId: ready.task_id, requiredCapabilities: spec.requiredCapabilities, placement: spec.placement },
        createdAt: formatRfc3339(this.deps.clock.nowEpochMs()),
      });
      await this.park(ask);
      return { kind: 'ASK_PARKED', ask };
    }

    const acquisition = await this.deps.broker.acquireLease({
      task_ref: ready.task_id,
      body_id: selection.body.body_id,
      holder: 'greenfield-runtime',
      expires_at: null,
    });
    if (acquisition.status !== 'ACQUIRED') {
      return {
        kind: 'DENIED',
        taskId: ready.task_id,
        code: 'LEASE_DENIED',
        reason: `the body lease could not be acquired: ${'denial' in acquisition ? acquisition.denial.reason : 'conflict'}`,
      };
    }

    const occupiedLanes = new Set<number>();
    for (const node of current) {
      if (node.state === 'RUNNING' || (node.state === 'PAUSED' && node.assignment !== null)) {
        if (node.assignment !== null) occupiedLanes.add(node.assignment.lane);
      }
    }
    const lane = ([1, 2, 3] as const).find((candidate) => !occupiedLanes.has(candidate));
    if (lane === undefined) {
      await this.deps.broker.releaseLease(acquisition.lease.lease_id, 'no free worker lane');
      return { kind: 'DENIED', taskId: ready.task_id, code: 'LANE_EXHAUSTED', reason: 'all three worker lanes are occupied — the task waits for the next tick' };
    }

    const workerRef = `p13-worker-lane-${lane}`;
    const assigned = await this.deps.graph.assign(ready.task_id, { lane, worker_ref: workerRef, lease_ref: acquisition.lease.lease_id, note: `journey ${this.journeyId} dispatch` });
    this.bodyProvenance.set(ready.task_id, { bodyId: selection.body.body_id, leaseRef: acquisition.lease.lease_id });
    // The implementation stage begins with the first non-scaffold dispatch
    // (the scaffold dispatch is workspace provisioning).
    if ((this.stage === 'GRAPH_BUILT' || this.stage === 'WORKSPACE_PROVISIONED') && ready.task_id !== taskIdForComponent(SCAFFOLD_COMPONENT_ID)) {
      this.enterStage('IMPLEMENTING');
    }
    await this.observer.emit(
      'journey.node-dispatched',
      { taskId: ready.task_id, lane, workerRef, bodyId: selection.body.body_id, leaseRef: acquisition.lease.lease_id, userDeviceOnline: this.deps.presence.userDeviceOnline() },
      [`task:${ready.task_id}`, `body:${selection.body.body_id}`],
    );

    // IMPLEMENT through the body seam (typed task output, never a completion).
    const implementation: TaskImplementationOutcome = this.deps.bodyExecutor.implement({
      node: ready,
      bodyId: selection.body.body_id,
      leaseRef: acquisition.lease.lease_id,
      attempt: ready.retries + 1,
    });
    if (implementation.kind === 'FAILED') {
      await this.deps.graph.recordFailure(ready.task_id, {
        failure_kind: implementation.failureKind,
        reason: implementation.reason,
        recovery: implementation.retryable ? 'RETRYABLE' : 'TERMINAL',
      });
      await this.deps.broker.releaseLease(acquisition.lease.lease_id, `implementation failed: ${implementation.reason}`);
      await this.observer.emit('journey.node-failed', { taskId: ready.task_id, failureKind: implementation.failureKind, reason: implementation.reason, userDeviceOnline: this.deps.presence.userDeviceOnline() }, [`task:${ready.task_id}`]);
      return { kind: 'NODE_FAILED', taskId: ready.task_id, failureKind: implementation.failureKind, reason: implementation.reason };
    }

    // REALIZE the task output into the repository — through the P9 gateway.
    const commit = await this.deps.realizer.commitTaskOutput({
      taskId: ready.task_id,
      message: `Implement: ${ready.title} (attempt ${ready.retries + 1})`,
      changes: [...implementation.files],
    });
    if (commit.kind === 'DENIED') {
      const ask = mintPipelineAsk({
        stage: 'REALIZATION',
        reasonCode: 'AUTHORITY_REQUIRED',
        detail: `the commit action for task ${ready.task_id} was DENIED at action time (${commit.grantReason}): ${commit.detail} — the journey never acts without current authority`,
        openQuestions: ['Approve the required authority for repository realization, or stop the mission?'],
        context: { taskId: ready.task_id, grantReason: commit.grantReason },
        createdAt: formatRfc3339(this.deps.clock.nowEpochMs()),
      });
      await this.deps.broker.releaseLease(acquisition.lease.lease_id, 'commit denied at action time');
      await this.park(ask);
      return { kind: 'ASK_PARKED', ask };
    }
    if (commit.kind === 'FAILED') {
      await this.deps.graph.recordFailure(ready.task_id, {
        failure_kind: 'OPERATION_FAILURE',
        reason: `the commit action failed: ${commit.failure.errorType} at ${commit.failure.operation} — ${commit.failure.message}`,
        recovery: commit.failure.retryable ? 'RETRYABLE' : 'TERMINAL',
      });
      await this.deps.broker.releaseLease(acquisition.lease.lease_id, 'commit failed');
      return { kind: 'NODE_FAILED', taskId: ready.task_id, failureKind: 'OPERATION_FAILURE', reason: commit.failure.message };
    }
    this.realizedCommits.push(commit.result);
    await this.deps.graph.recordWorkspaceRevision(ready.task_id, { source_revision: commit.result.sha, deployment_revision: null });

    // The body's completion REPORT — non-authoritative input (§10): the
    // report never completes the task; only the independent gate does.
    await this.deps.fabric.reportBodyCompletion(ready.task_id, {
      summary: `body ${selection.body.body_id} reports the implementation of ${ready.title} at revision ${commit.result.sha}`,
      evidence: { files: implementation.files.map((file) => file.path), sourceRevision: commit.result.sha, bodyProvenance: implementation.bodyProvenance },
    });

    // THE INDEPENDENT EVALUATION GATE (per node): the P9 repair discipline.
    const gate = await this.runNodeEvaluationGate(ready, spec, commit.result.sha, commit.result.evidenceIds);
    if (gate.kind === 'ASK_PARKED') {
      return { kind: 'ASK_PARKED', ask: gate.ask };
    }

    // Verification-gated completion (the P6 chain): the fabric writes the
    // terminal status under the evidence; the graph adopts + pins the ref.
    const lastRun = gate.runs[gate.runs.length - 1]!;
    const verdictIds = lastRun.results.flatMap((step) => (step.outcome.kind === 'verdict' ? [step.outcome.verdict.verdictId] : []));
    const verification: TaskVerificationRecord = {
      verified: true,
      recorded_at: formatRfc3339(this.deps.clock.nowEpochMs()),
      evidence_refs: [...verdictIds, ...commit.result.evidenceIds],
      summary: `independent evaluation granted node completion: ${gate.summaries[gate.summaries.length - 1]!.passed} verdict(s) passed across ${gate.runs.length} suite run(s); certification ${gate.certificationId}`,
    };
    const completion = await this.deps.fabric.completeTask(ready.task_id, verification);
    if (completion.status === 'DENIED') {
      await this.deps.graph.recordFailure(ready.task_id, {
        failure_kind: 'OPERATION_FAILURE',
        reason: `the fabric refused completion: ${completion.denial.reason}`,
        recovery: 'RETRYABLE',
      });
      return { kind: 'NODE_FAILED', taskId: ready.task_id, failureKind: 'OPERATION_FAILURE', reason: completion.denial.reason };
    }
    if (completion.status === 'FAILED') {
      await this.deps.graph.recordFailure(ready.task_id, {
        failure_kind: 'OPERATION_FAILURE',
        reason: `the fabric's completeTask ran and failed: ${completion.error}`,
        recovery: 'RETRYABLE',
      });
      return { kind: 'NODE_FAILED', taskId: ready.task_id, failureKind: 'OPERATION_FAILURE', reason: completion.error };
    }
    await this.deps.graph.adoptFabricTransition(ready.task_id, assigned);
    await this.deps.graph.recordVerificationRef(ready.task_id, gate.certificationId);
    this.nodeCertifications.set(ready.task_id, { certificationId: gate.certificationId, verdictIds });
    await this.observer.emit(
      'journey.node-completed',
      { taskId: ready.task_id, sourceRevision: commit.result.sha, certificationId: gate.certificationId, verdicts: verdictIds.length, userDeviceOnline: this.deps.presence.userDeviceOnline() },
      [`task:${ready.task_id}`, `certification:${gate.certificationId}`],
    );

    // Stage progress: the first completion provisions the workspace; all
    // completions end the implementation stage.
    const after = await this.deps.graph.nodes();
    const allCompleted = after.every((node) => node.state === 'COMPLETED');
    if (allCompleted) {
      this.enterStage('IMPLEMENTED');
      await this.observer.emit('journey.implemented', { tasks: after.length, userDeviceOnline: this.deps.presence.userDeviceOnline() }, [`journey:${this.journeyId}`]);
    } else if (ready.task_id === taskIdForComponent(SCAFFOLD_COMPONENT_ID)) {
      this.enterStage('WORKSPACE_PROVISIONED');
    } else if (this.stage === 'GRAPH_BUILT' || this.stage === 'WORKSPACE_PROVISIONED') {
      this.enterStage('IMPLEMENTING');
    }
    return { kind: 'NODE_COMPLETED', taskId: ready.task_id, sourceRevision: commit.result.sha, certificationId: gate.certificationId };
  }

  /**
   * The per-node independent evaluation gate — the P9 repair discipline
   * composed over the P9 EvaluationOrchestrator + aggregate: run the
   * applicable suite against the EXACT produced revision; when verdicts
   * fail, repair into a NEW revision and re-run the FULL fresh suite
   * (verdicts never carry across revisions); after the bounded attempts,
   * escalate to a typed ASK — never a silent infinite loop, never a
   * fabricated pass.
   */
  private async runNodeEvaluationGate(
    node: TaskNode,
    spec: TaskNodeSpec,
    sourceRevision: string,
    commitEvidenceIds: readonly string[],
  ): Promise<NodeGateOutcome> {
    if (this.plan === null) {
      throw new JourneyStageError('the evaluation gate requires the implementation plan (repair bound)');
    }
    const maxRepairAttempts = this.plan.maxRepairAttempts;
    const plan: EvaluationPlan = buildPlan({
      steps: spec.evaluationTypes.map((type) => ({ stepId: `p13-node-${node.task_id}-${type}`, type, maxAttempts: 2 })),
      applicability: [{ families: ['*'], missions: '*', types: [...spec.evaluationTypes] }],
      maxRepairAttempts,
    });
    const target: { sourceRevision: string; deploymentRevision: string | null; producedBy: EvaluationActorRef } = {
      sourceRevision,
      deploymentRevision: null,
      producedBy: this.evaluationActorOf(this.actingBody),
    };
    const runs: SuiteRunRecord[] = [];
    const summaries: EvaluationSummary[] = [];
    for (let attempt = 0; ; attempt += 1) {
      const run = this.deps.evaluationOrchestration.runSuite({
        plan,
        target: { sourceRevision: target.sourceRevision, deploymentRevision: target.deploymentRevision, producedBy: target.producedBy },
        requestedBy: this.evaluationActorOf(this.systemActor),
        family: 'commit',
        mission: this.mission?.envelope.id ?? null,
      });
      runs.push(run);
      const summary = aggregate(run);
      summaries.push(summary);
      const clean = summary.failed === 0 && summary.unknown === 0 && summary.denied === 0 && summary.notEvaluated === 0;
      if (clean) {
        const certificationId = contentAddress(
          { taskId: node.task_id, runs: runs.map((entry) => entry.runId), summaries: summaries.map((entry) => entry.summaryDigest), commitEvidenceIds },
          'p13-node-certification',
        );
        return { kind: 'ALL_VERDICTS_PASS', certificationId, runs, summaries };
      }
      if (attempt >= maxRepairAttempts) {
        const ask = mintPipelineAsk({
          stage: 'COMPLETION',
          reasonCode: 'EVALUATION_REPAIR_EXHAUSTED',
          detail: `the independent evaluation for task ${node.task_id} still fails after ${attempt + 1} attempt(s) (repair bound ${maxRepairAttempts}): ${summary.failures.map((failure) => `${failure.check}: ${failure.message}`).join('; ') || 'no structured failures — open uncertainties remain'}`,
          openQuestions: ['Should the mission continue with a different implementation approach, or stop?'],
          context: { taskId: node.task_id, sourceRevision: target.sourceRevision, failures: summary.failures, uncertainties: summary.openUncertainties },
          createdAt: formatRfc3339(this.deps.clock.nowEpochMs()),
        });
        await this.deps.graph.recordAsk(node.task_id, ask.askId, `evaluation repair exhausted: ${summary.failures.length} failure(s)`);
        await this.park(ask);
        return { kind: 'ASK_PARKED', ask };
      }
      const repair = await this.deps.nodeRepair.repair({
        node,
        failures: summary.failures,
        currentRevision: target.sourceRevision,
        attempt: attempt + 1,
      });
      if (repair.newSourceRevision === null) {
        const ask = mintPipelineAsk({
          stage: 'COMPLETION',
          reasonCode: 'REPAIR_UNAVAILABLE',
          detail: `the repair executor could not produce a corrected revision for task ${node.task_id}: ${repair.detail}`,
          openQuestions: ['Should the mission wait for a repair capability, or stop?'],
          context: { taskId: node.task_id, sourceRevision: target.sourceRevision, failures: summary.failures },
          createdAt: formatRfc3339(this.deps.clock.nowEpochMs()),
        });
        await this.deps.graph.recordAsk(node.task_id, ask.askId, 'repair unavailable');
        await this.park(ask);
        return { kind: 'ASK_PARKED', ask };
      }
      if (repair.realizedCommit !== null) {
        // The repair commit is an exact source revision of the journey —
        // recorded for the completion report (never dropped).
        this.realizedCommits.push(repair.realizedCommit);
      }
      target.sourceRevision = repair.newSourceRevision;
    }
  }

  private async tickRealizeChange(): Promise<CloudTickAction> {
    this.requireStage('IMPLEMENTED');
    if (this.realizationPlan === null || this.mission === null) {
      throw new JourneyStageError('change realization requires the realization plan');
    }
    const branch = this.realizationPlan.repository.implementationBranch;
    const remote = this.repository ? `github.com/${this.repository.owner}/${this.repository.name}` : 'origin';
    const push = await this.deps.realizer.pushBranch({ remote, ref: branch });
    if (push.kind === 'DENIED') {
      await this.park(this.authorityAsk(`the push action for ${branch} was DENIED at action time (${push.grantReason}): ${push.detail}`));
      return { kind: 'ASK_PARKED', ask: this.pendingAsk! };
    }
    if (push.kind === 'FAILED') {
      return { kind: 'DENIED', taskId: null, code: 'PUSH_FAILED', reason: push.failure.message };
    }
    this.push = push.result;
    const pullRequest = await this.deps.realizer.openPullRequest({
      title: this.realizationPlan.pullRequestTitle,
      headBranch: branch,
      baseBranch: this.realizationPlan.repository.defaultBranch,
      description: this.realizationPlan.pullRequestDescription,
    });
    if (pullRequest.kind === 'DENIED') {
      await this.park(this.authorityAsk(`the pull-request action for ${branch} was DENIED at action time (${pullRequest.grantReason}): ${pullRequest.detail}`));
      return { kind: 'ASK_PARKED', ask: this.pendingAsk! };
    }
    if (pullRequest.kind === 'FAILED') {
      return { kind: 'DENIED', taskId: null, code: 'PULL_REQUEST_FAILED', reason: pullRequest.failure.message };
    }
    this.pullRequest = pullRequest.result;
    await this.observer.emit(
      'journey.change-realized',
      { remote, ref: branch, sha: push.result.sha, pullRequestId: pullRequest.result.pullRequestId, userDeviceOnline: this.deps.presence.userDeviceOnline() },
      [`pull-request:${pullRequest.result.pullRequestId}`],
    );
    this.enterStage('CHANGE_REALIZED');
    return { kind: 'STAGE_ADVANCED', stage: 'CHANGE_REALIZED' };
  }

  private async tickDeploy(): Promise<CloudTickAction> {
    this.requireStage('CHANGE_REALIZED');
    const deployment = await this.deps.realizer.deploy({ environment: this.deploymentEnvironment() });
    if (deployment.kind === 'DENIED') {
      await this.park(this.authorityAsk(`the deployment action for ${this.deploymentEnvironment()} was DENIED at action time (${deployment.grantReason}): ${deployment.detail}`));
      return { kind: 'ASK_PARKED', ask: this.pendingAsk! };
    }
    if (deployment.kind === 'FAILED') {
      return { kind: 'DENIED', taskId: null, code: 'DEPLOYMENT_FAILED', reason: deployment.failure.message };
    }
    this.deployment = deployment.result;
    await this.observer.emit(
      'journey.deployed',
      { deploymentId: deployment.result.deploymentId, environment: deployment.result.environment, sourceSha: deployment.result.sourceSha, userDeviceOnline: this.deps.presence.userDeviceOnline() },
      [`deployment:${deployment.result.deploymentId}`],
    );
    this.enterStage('DEPLOYED');
    return { kind: 'STAGE_ADVANCED', stage: 'DEPLOYED' };
  }

  private async tickVerifyRuntime(): Promise<CloudTickAction> {
    this.requireStage('DEPLOYED');
    if (this.deployment === null) {
      throw new JourneyStageError('runtime verification requires the deployment record');
    }
    const outcome = this.deps.certifier.request({
      requirements: ['runtime-verification'],
      target: { sourceRevision: this.deps.realizer.currentHead(), deploymentRevision: this.deployment.deploymentId, producedBy: this.evaluationActorOf(this.actingBody) },
      requestedBy: this.evaluationActorOf(this.systemActor),
      family: 'deployment',
      mission: this.mission?.envelope.id ?? null,
    });
    if (outcome.kind !== 'GRANTED') {
      const ask = mintPipelineAsk({
        stage: 'COMPLETION',
        reasonCode: 'RUNTIME_VERIFICATION_NOT_PASSED',
        detail: `the independent runtime verification did not pass: ${certificationReasons(outcome)}`,
        openQuestions: ['Should the deployment be repaired, rolled back, or should the mission stop?'],
        context: { deploymentId: this.deployment.deploymentId, sourceRevision: this.deps.realizer.currentHead() },
        createdAt: formatRfc3339(this.deps.clock.nowEpochMs()),
      });
      await this.park(ask);
      return { kind: 'ASK_PARKED', ask };
    }
    await this.observer.emit(
      'journey.runtime-verified',
      { certificationId: outcome.certificationId, deploymentId: this.deployment.deploymentId, userDeviceOnline: this.deps.presence.userDeviceOnline() },
      [`certification:${outcome.certificationId}`],
    );
    this.enterStage('RUNTIME_VERIFIED');
    return { kind: 'STAGE_ADVANCED', stage: 'RUNTIME_VERIFIED' };
  }

  private async tickRequestCompletion(): Promise<CloudTickAction> {
    this.requireStage('RUNTIME_VERIFIED');
    const outcome = await this.requestCompletion();
    if (outcome.kind === 'ASK') {
      return { kind: 'ASK_PARKED', ask: outcome.ask };
    }
    return { kind: 'STAGE_ADVANCED', stage: 'COMPLETED' };
  }

  /** The journey-level completion: ONLY the independent gate can grant it. */
  async requestCompletion(): Promise<JourneyCompletionOutcome> {
    this.requireStage('RUNTIME_VERIFIED');
    if (this.plan === null || this.mission === null || this.deployment === null) {
      throw new JourneyStageError('completion requires the plan, the mission and the deployment');
    }
    const requirements: EvaluationType[] = [];
    for (const constraint of this.plan.assuranceConstraints) {
      if (!requirements.includes(constraint.evaluationType)) requirements.push(constraint.evaluationType);
    }
    const outcome = this.deps.certifier.request({
      requirements,
      target: {
        sourceRevision: this.deps.realizer.currentHead(),
        deploymentRevision: this.deployment.deploymentId,
        producedBy: this.evaluationActorOf(this.actingBody),
      },
      requestedBy: this.evaluationActorOf(this.systemActor),
      family: 'deployment',
      mission: this.mission.envelope.id,
    });
    if (outcome.kind === 'INDEPENDENCE_DENIED') {
      const ask = mintPipelineAsk({
        stage: 'COMPLETION',
        reasonCode: 'CERTIFICATION_DENIED',
        detail: `the independent certification was denied on independence grounds: ${'code' in outcome.denial ? outcome.denial.code : 'UNKNOWN'}`,
        openQuestions: ['An independence violation blocked completion — who should certify, and how?'],
        context: { requirements, denial: outcome.denial },
        createdAt: formatRfc3339(this.deps.clock.nowEpochMs()),
      });
      await this.park(ask);
      return { kind: 'ASK', ask };
    }
    if (outcome.kind === 'DENIED') {
      const ask = mintPipelineAsk({
        stage: 'COMPLETION',
        reasonCode: 'CERTIFICATION_DENIED',
        detail: `the independent certification was denied: ${outcome.reasons.join('; ')}`,
        openQuestions: ['Should the implementation be repaired and re-certified, or should the mission stop?'],
        context: { requirements, failures: outcome.failures, uncertainties: outcome.summary.openUncertainties },
        createdAt: formatRfc3339(this.deps.clock.nowEpochMs()),
      });
      await this.park(ask);
      return { kind: 'ASK', ask };
    }
    const nodes = await this.deps.graph.nodes();
    const tasks = await Promise.all(
      nodes.map(async (node) => {
        const provenance = this.bodyProvenance.get(node.task_id) ?? { bodyId: null, leaseRef: null };
        return {
          taskId: node.task_id,
          title: node.title,
          state: node.state,
          verificationRef: node.verification_ref,
          sourceRevision: node.workspace_revision.source_revision,
          bodyId: provenance.bodyId,
          leaseRef: provenance.leaseRef,
          retries: node.retries,
        };
      }),
    );
    const remainingUncertainty = [
      ...outcome.summary.openUncertainties,
      'reference mode: the GitHub connection is the P4 reference adapter (SIMULATED states — never a real GitHub connection)',
      'reference mode: git and deployment executors are the P9 deterministic reference executors (no real provider evidence exists)',
      'reference mode: bodies are the P8 reference cloud bodies (deterministic simulators behind the §9 harness seam)',
      'reference mode: evaluation evidence comes from scripted reference probes (deterministic simulators, not real providers)',
    ];
    this.completion = buildCompletionReport({
      journeyId: this.journeyId,
      missionRef: this.mission.envelope.id,
      authority: this.authorityGrantSummary,
      stage: 'COMPLETED',
      sourceRevisions: sourceRevisionsOf({
        workspaceHead: this.deps.realizer.currentHead(),
        commits: this.realizedCommits,
        push: this.push,
        pullRequest: this.pullRequest,
        deployment: this.deployment,
        imported: this.importedRevision,
      }),
      evaluation: evaluationSliceOf(outcome.summary, outcome.certificationId),
      remainingUncertainty,
      tasks,
      producedBy: this.actingBody,
      certifiedUponRequestBy: this.systemActor,
      completedAt: formatRfc3339(this.deps.clock.nowEpochMs()),
      providerStatuses: this.deps.providerStatuses.map((status) => ({ ...status })),
    });
    this.status = 'COMPLETED';
    await this.observer.emit(
      'journey.completed',
      { completionId: this.completion.completionId, certificationId: outcome.certificationId, workspaceHead: this.completion.sourceRevisions.workspaceHead, userDeviceOnline: this.deps.presence.userDeviceOnline() },
      [`completion:${this.completion.completionId}`],
    );
    this.enterStage('COMPLETED');
    return { kind: 'REPORT', report: this.completion };
  }

  // -------------------------------------------------------------------------
  // Introspection (the surfaces a disconnected user returns to)
  // -------------------------------------------------------------------------

  /** The typed journey state. */
  state(): JourneyState {
    return {
      journeyId: this.journeyId,
      stage: this.stage,
      status: this.status,
      rawMissionStatement: this.rawMission?.statement ?? null,
      repository: this.repository,
      importedRevision: this.importedRevision,
      mission: this.mission,
      authorityGrantId: this.authorityGrantId,
      plan: this.plan,
      workspaceHead: this.deps.realizer.currentHead(),
      realizedCommits: [...this.realizedCommits],
      push: this.push,
      pullRequest: this.pullRequest,
      deployment: this.deployment,
      pendingAsk: this.pendingAsk,
      transitions: this.transitions.map((transition) => ({ ...transition })),
      providerStatuses: this.deps.providerStatuses.map((status) => ({ ...status })),
    };
  }

  /** The evidence-backed completion report (or null until granted). */
  completionReport(): CompletionReport | null {
    return this.completion === null ? null : structuredClone(this.completion);
  }

  /** The journey's own observation timeline (replayable, durable). */
  async timeline(): Promise<JourneyTimelineEvent[]> {
    return journeyTimeline(this.deps.store.observationEvents, this.journeyId);
  }

  /** The task + evidence timeline (journey + task-graph + fabric events). */
  async evidenceTimeline(): Promise<JourneyTimelineEvent[]> {
    const nodes = await this.deps.graph.nodes();
    return taskAndEvidenceTimeline(this.deps.store.observationEvents, this.journeyId, nodes.map((node) => node.task_id));
  }

  /** The accumulated cloud-tick log (audit). */
  ticks(): readonly CloudTickRecord[] {
    return this.tickLog.map((tick) => ({ ...tick }));
  }

  /** The acting principal + system actors (audit). */
  principals(): { readonly actingBody: ActorRef; readonly system: ActorRef } {
    return { actingBody: { ...this.actingBody }, system: { ...this.systemActor } };
  }

  /** Re-derive the completion record id (the reproduction pin). */
  reproducedCompletionId(): string | null {
    return this.completion === null ? null : recomputeCompletionId(this.completion);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private deploymentEnvironment(): string {
    return this.deps.deploymentEnvironment ?? 'production';
  }

  private requireStage(stage: GreenfieldJourneyStage): void {
    if (this.stage !== stage) {
      throw new JourneyStageError(`this operation requires the ${stage} stage, but the journey is at ${this.stage ?? 'nothing'}${this.status !== 'RUNNING' ? ` (status ${this.status})` : ''}`);
    }
  }

  private enterStage(stage: GreenfieldJourneyStage): void {
    if (this.stage === stage) return;
    this.transitions.push({ from: this.stage, to: stage, at: formatRfc3339(this.deps.clock.nowEpochMs()) });
    this.stage = stage;
  }

  private async park(ask: PipelineAsk): Promise<void> {
    this.pendingAsk = ask;
    this.status = 'AWAITING_ASK';
    await this.observer.emit(
      'journey.ask-parked',
      { askId: ask.askId, stage: ask.stage, reasonCode: ask.reasonCode, detail: ask.detail, openQuestions: ask.openQuestions, userDeviceOnline: this.deps.presence.userDeviceOnline() },
      [`ask:${ask.askId}`],
    );
  }

  private authorityAsk(detail: string): PipelineAsk {
    return mintPipelineAsk({
      stage: 'REALIZATION',
      reasonCode: 'AUTHORITY_REQUIRED',
      detail: `${detail} — the journey never acts without current authority and never retries-until-granted`,
      openQuestions: ['Approve the required authority for this action, or stop the mission?'],
      context: { journeyId: this.journeyId },
      createdAt: formatRfc3339(this.deps.clock.nowEpochMs()),
    });
  }

  private evaluationActorOf(actor: ActorRef): EvaluationActorRef {
    return { kind: actor.kind, id: actor.id };
  }
}

function certificationReasons(outcome: CertificationOutcome): string {
  if (outcome.kind === 'INDEPENDENCE_DENIED') {
    return `independence denial (${'code' in outcome.denial ? outcome.denial.code : 'UNKNOWN'})`;
  }
  if (outcome.kind === 'DENIED') {
    return outcome.reasons.join('; ');
  }
  return 'granted';
}
