/**
 * THE AUTONOMOUS-BUILD DOGFOOD WORLD (Work Order P15, lane B) — the shared
 * composition every lane-B journey drives. This file is the IMPURE BOUNDARY
 * of the lane-B delivery (the composition-root precedent of
 * tests/mission-to-repo + tests/autonomy): it assembles the MERGED public
 * surfaces exactly the way the product composes them, with every clock,
 * store, seam, probe and scripted outage INJECTED — deterministically,
 * offline. Lane B writes ZERO product code; it composes journeys.
 *
 * Three compositions live here:
 *
 *   1. createDogfoodWorld     — the §11 flagship greenfield journey world
 *      (mission -> connected empty GitHub repo -> authority approval ->
 *      cloud-tick pipeline -> implementation -> independent evaluation ->
 *      commit/PR/push/deployment -> runtime verification -> completion).
 *
 *   2. createAutonomyWorld    — the P12 lease/checkpoint/outage world
 *      (durable tasks, verified checkpoints, body leases through the P9
 *      action surface, recovery planning, truthful outage windows).
 *
 *   3. createObservationWorld — the P7 no-body observation plane composed
 *      WITH the P12 runtime stack on ONE shared clock: events ingest and
 *      anomalies are detected with ZERO bodies leased; a body is summoned
 *      through the action surface ONLY when action is required.
 *
 * No Date.now / Math.random / fetch / process.env / ambient timers /
 * child_process anywhere in these sources — every instant is the injected
 * ManualClock at a fixed lane-B epoch.
 */

import {
  ActionGateway,
  InMemoryAuthority,
  InMemoryEventLog,
  InMemoryEvidenceSink,
  InMemoryIdempotencyStore,
  ReferenceExecutor,
  ReferenceRollbackVerifier,
  ReferenceWorld,
  WORLD_BASE_SHA,
} from '@sos-2/action-gateway';
import type { ActionFamily, ActorRef, Clock as GatewayClock } from '@sos-2/action-gateway';
import { CloudCodingShellBody } from '@sos-2/body-runtimes';
import { BodyBroker } from '@sos-2/body-broker';
import { EvaluationOrchestrator } from '@sos-2/evaluation-orchestration';
import { EvaluatorRegistry, IndependentEvaluationService, ScriptedReferenceProbe, defaultRegistry } from '@sos-2/evaluator';
import type { EvaluationActorRef, EvaluationRequest, EvaluationType, ProbeObservation } from '@sos-2/evaluator';
import { EVALUATION_TYPES } from '@sos-2/evaluator';
import { ExecutionFabric } from '@sos-2/execution-fabric';
import { ManualClock, createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import type { Clock } from '@sos-2/live-store';
import {
  CompletionCertifier,
  GreenfieldJourney,
  ReferenceAuthorityApproval,
  ReferenceBodyTaskExecutor,
  ReferenceNodeRepairExecutor,
  actingBodyIdFor,
} from '@sos-2/greenfield-runtime';
import type { GreenfieldJourneyDeps, JourneyState, NodeRepairExecutor } from '@sos-2/greenfield-runtime';
import type { GrantingAuthorityPort } from '@sos-2/greenfield-runtime';
import { ReferenceArchitecturePlanner, ReferenceMissionFormalizer } from '@sos-2/implementation-orchestrator';
import type { ArchitecturePlannerPort, MissionFormalizerPort, RawUserMission } from '@sos-2/implementation-orchestrator';
import { RepositoryRealizer } from '@sos-2/project-realization';
import { TaskGraph } from '@sos-2/task-graph';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { createMission } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import {
  CostLedger,
  InMemoryAskSink,
  InMemoryOutageRegistry,
  LeaseActionService,
  LeaseLifecycleExecutor,
  LeaseSupervisor,
  ManualBeatSource,
  ManualFailureVerification,
  RecoveryPlanner,
} from '@sos-2/autonomy-runtime';
import { TaskRuntime, TaskTimeline } from '@sos-2/task-runtime';
import type { StepOutcome } from '@sos-2/task-runtime';
import type { WorkerStep } from '@sos-2/worker-runtime';
import {
  REFERENCE_SUBJECTS,
  ScriptedClaimsPort,
  ScriptedEventSource,
  createReferenceObservationPlane,
  referenceCiEnvelopes,
  referenceClaims,
  referenceDeploymentEnvelopes,
  referenceGitHubEnvelopes,
  referenceProviderHealthEnvelopes,
} from '@sos-2/observation-host';
import type { ReferenceObservationPlane } from '@sos-2/observation-host';
// The P4 reference provider: @sos-2/github is deliberately entry-point-less
// (zero-dependency, source-consumed — the P3/P4 lockfile precedent), so it
// binds through its source entry exactly the way the merged P4/P13 suites
// bind it. This is the ONE documented source binding outside the owned path.
import { InMemoryGitHubProvider } from '../../../packages/github/src/index.ts';

// ---------------------------------------------------------------------------
// Fixed lane-B instants (deterministic journeys; every stamp derives from
// these via the injected clocks — never from ambient time).
// ---------------------------------------------------------------------------

/** The flagship journey epoch: 2026-04-01T09:00:00Z. */
export const DOGFOOD_T0 = Date.parse('2026-04-01T09:00:00Z');

/** The autonomy-journey epoch: 2026-04-01T08:00:00Z. */
export const AUTONOMY_T0 = Date.parse('2026-04-01T08:00:00Z');

/** The observation-plane epoch: 2026-09-21T12:05:00Z (the scripted event window). */
export const OBSERVATION_T0 = Date.parse('2026-09-21T12:05:00Z');

/** The flagship journey id of the lane-B dogfood. */
export const FLAGSHIP_JOURNEY_ID = 'flagship-p15b-01';

/** The default mission of the lane-B flagship journey. */
export const DEFAULT_RAW_MISSION: RawUserMission = {
  statement: 'Build a markdown notes service with a public API',
  repositorySlug: 'acme/empty-repo',
  capturedAt: formatRfc3339(DOGFOOD_T0),
  source: 'web-console:greenfield',
};

/** The empty greenfield fixture repository (the P4 reference provider's empty-repo fixture). */
export const EMPTY_REPOSITORY_SLUG = 'acme/empty-repo';

/** The runtime actor every autonomy/lease action runs as (authority-gated at action time). */
export const RUNTIME_ACTOR: ActorRef = { kind: 'system', id: 'spirit:persistent' };

/** The human actor (cancellation / user-driven actions). */
export const HUMAN_ACTOR: ActorRef = { kind: 'human', id: 'operator:primary' };

/** The body the autonomy journeys lease first (replacements pick a spare). */
export const FIRST_BODY = 'p15b-autonomy-cloud-01';

/** The deterministic missed-beat window of the acceptance worlds (ms). */
export const MISSED_BEAT_WINDOW_MS = 30_000;

/**
 * The stable source revision the observation-world lease actions target —
 * the EXACT repository head the scripted reference events observe (the
 * anomaly journey pins its repair lease to the revision it observed).
 */
export const OBSERVED_HEAD_SHA = '86a6921631113167f071c2f9019dddd0c1ab6447';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function sandboxPolicy(root: string) {
  return {
    filesystem: { mode: 'workspace' as const, root },
    network: { egress: 'allowlist' as const, allowedHosts: ['api.github.com', 'registry.npmjs.org'] },
    secrets: ['github-token'],
    budgets: { fileWrites: 200, fileBytes: 1_000_000, shellCommands: 500, networkCalls: 200, secretReveals: 100 },
    resourceEnvelope: { maxDurationMs: 7_200_000, maxMemoryMb: 2048 },
  };
}

/** A failing evidence observation (deterministic, honest — the probe RAN and found failures). */
export function failingObservation(type: EvaluationType): ProbeObservation {
  return {
    status: 'EVIDENCE_COLLECTED',
    limitations: [],
    evidence: {
      evidenceType: type,
      summary: `reference ${type} check FAILED (scripted fixture)`,
      checks: [
        {
          check: `${type}:fixture`,
          passed: false,
          detail: 'the scripted reference fixture fails this revision',
          expected: 'the planned (correct) output',
          actual: 'the produced output',
        },
      ],
      artifactDigest: `fixture-failure:${type}`,
    },
  };
}

/** The user-presence recorder (RECORDED into observation payloads, never consulted for progress). */
export class ScriptedPresence {
  private online: boolean;
  constructor(initial = false) {
    this.online = initial;
  }
  userDeviceOnline(): boolean {
    return this.online;
  }
  /** The user's computer comes back online (the §7 "return"). */
  returnOnline(): void {
    this.online = true;
  }
}

/** Scripted-failure probe options for the flagship repair paths. */
export interface ProbeScripting {
  /** Revisions whose evaluation FAILS (keyed by source revision). */
  readonly failRevisions?: ReadonlyMap<string, ProbeObservation>;
  /** Fail EVERY revision (the repair-exhaustion fixture). */
  readonly failAll?: boolean;
  /** Fail every revision OF THESE TYPES (the runtime-verification fixture). */
  readonly failTypes?: readonly EvaluationType[];
  /** Bind one evaluator to the acting body (the independence fixture). */
  readonly bindToActingBody?: readonly EvaluationType[];
  /** Probe bound to an arbitrary actor (the P9 relay fixture). */
  readonly boundActor?: EvaluationActorRef | null;
}

// ---------------------------------------------------------------------------
// 1. The flagship dogfood world (§11, device-optional)
// ---------------------------------------------------------------------------

export interface DogfoodWorldOptions {
  /** The journey id (default FLAGSHIP_JOURNEY_ID). */
  readonly journeyId?: string;
  /** The number of reference cloud bodies (default 3). */
  readonly bodyCount?: number;
  /** Register the bodies at user-device placement instead of cloud (the offline denial fixture). */
  readonly userDeviceBodies?: boolean;
  /** Probe scripting (default: all reference probes pass). */
  readonly probes?: ProbeScripting;
  /** Use the P9 DEFAULT registry (honest NOT_YET_CONNECTED probes for deployment/runtime/security). */
  readonly defaultEvaluatorRegistry?: boolean;
  /** The user-presence recorder (default: ALWAYS OFFLINE — the §7 pin). */
  readonly presence?: { userDeviceOnline(): boolean };
}

/** The assembled flagship dogfood world. */
export interface DogfoodWorld {
  readonly clock: ManualClock;
  readonly store: ReturnType<typeof createInMemoryLiveStore>;
  readonly gatewayWorld: ReferenceWorld;
  readonly executor: ReferenceExecutor;
  readonly authority: InMemoryAuthority;
  readonly evidence: InMemoryEvidenceSink;
  readonly actionEvents: InMemoryEventLog;
  readonly broker: BodyBroker;
  readonly fabric: ExecutionFabric;
  readonly graph: TaskGraph;
  readonly github: InMemoryGitHubProvider;
  readonly realizer: RepositoryRealizer;
  readonly journey: GreenfieldJourney;
  readonly grantedGrantIds: readonly string[];
  /** Revoke every journey action-time grant (fail-closed fixture). */
  revokeJourneyAuthority(): void;
  /** The recorded evaluation requests (requestedBy/producedBy audit). */
  readonly evaluationRequests: readonly { readonly type: EvaluationType; readonly requestedBy: EvaluationActorRef; readonly producedBy: EvaluationActorRef }[];
}

/** A probe that records every request it sees (the requester-independence audit). */
class RecordingProbe extends ScriptedReferenceProbe {
  constructor(
    options: ConstructorParameters<typeof ScriptedReferenceProbe>[0] & {
      readonly sink?: { readonly type: EvaluationType; readonly requestedBy: EvaluationActorRef; readonly producedBy: EvaluationActorRef }[];
    },
  ) {
    const { sink, ...rest } = options;
    super(rest);
    this.sink = sink ?? [];
  }

  private readonly sink: { readonly type: EvaluationType; readonly requestedBy: EvaluationActorRef; readonly producedBy: EvaluationActorRef }[];

  override run(request: EvaluationRequest): ProbeObservation {
    this.sink.push({ type: request.type, requestedBy: request.requestedBy, producedBy: request.target.producedBy });
    return super.run(request);
  }
}

/** Assemble the flagship dogfood world (deterministic; everything injected). */
export function createDogfoodWorld(options: DogfoodWorldOptions = {}): DogfoodWorld {
  const journeyId = options.journeyId ?? FLAGSHIP_JOURNEY_ID;
  const clock: ManualClock = new ManualClock(DOGFOOD_T0);
  const store = createInMemoryLiveStore({ clock });

  // The P9 action gateway: reference world + executors + in-memory
  // authority (with grant registration for the approval flow).
  const gatewayWorld = new ReferenceWorld();
  const authority = new InMemoryAuthority();
  const executor = new ReferenceExecutor(gatewayWorld);
  const idempotency = new InMemoryIdempotencyStore();
  const actionEvents = new InMemoryEventLog();
  const evidence = new InMemoryEvidenceSink();
  const gatewayClock: GatewayClock = { now: () => clock.nowEpochMs() };
  const gateway = new ActionGateway({
    clock: gatewayClock,
    authority,
    executors: [executor],
    idempotency,
    events: actionEvents,
    evidence,
    rollbackVerifier: new ReferenceRollbackVerifier(gatewayWorld),
  });

  // The granting-authority adapter: approvals register action-time grants
  // through the SAME object the gateway re-evaluates at action time.
  const grantedGrantIds: string[] = [];
  const grantingAuthority: GrantingAuthorityPort = {
    grantFor: (actorId: string, family: ActionFamily, scope: string, grantOptions?: { grantId?: string }) => {
      const grantId = authority.grant(actorId, family, scope, grantOptions);
      grantedGrantIds.push(grantId);
      return grantId;
    },
    evaluateCurrent: (query, now) => authority.evaluateCurrent(query, now),
  };

  // The P9 evaluator service + registry (scripted reference probes by
  // default; the honest NOT_YET_CONNECTED default registry on demand).
  const actingBodyRef: EvaluationActorRef = { kind: 'body', id: actingBodyIdFor(journeyId) };
  const evaluationRequests: { type: EvaluationType; requestedBy: EvaluationActorRef; producedBy: EvaluationActorRef }[] = [];
  const registry = options.defaultEvaluatorRegistry
    ? defaultRegistry()
    : scriptedReferenceRegistry(options.probes ?? {}, actingBodyRef, evaluationRequests);
  const evaluation = new IndependentEvaluationService(registry, gatewayClock);
  const orchestration = new EvaluationOrchestrator(evaluation, gatewayClock);
  const certifier = new CompletionCertifier({ orchestration, clock: gatewayClock });

  // The P5/P6/P8 execution stack (cloud bodies — the §7 device-optional pin).
  const broker = new BodyBroker({ leases: store.bodyLeases, clock });
  const fabric = new ExecutionFabric({
    tasks: store.tasks,
    authorityGrants: store.authorityGrants,
    observationEvents: store.observationEvents,
    objects: store.objects,
    broker,
    clock,
  });
  const graph = new TaskGraph({ tasks: store.tasks, observationEvents: store.observationEvents, clock });
  const bodyCount = options.bodyCount ?? 3;
  const bodyPlacement = options.userDeviceBodies ? ('user-device' as const) : ('cloud' as const);
  for (let index = 0; index < bodyCount; index += 1) {
    const bodyId = `p15b-${bodyPlacement}-body-${String(index + 1).padStart(2, '0')}`;
    const body = new CloudCodingShellBody({
      bodyId,
      provider: { name: 'p15b-acceptance-reference', version: '1.0.0' },
      placement: bodyPlacement,
      sandboxPolicy: sandboxPolicy(`/workspace/${bodyId}`),
      secrets: {},
    });
    broker.registerBody({
      body_id: bodyId,
      provider: { name: 'p15b-acceptance-reference', version: '1.0.0' },
      capabilities: body.capabilitiesValue,
      placement: bodyPlacement,
      harness: body,
    });
  }

  // The P4 GitHub reference provider (source-bound — the P4 precedent).
  const github = new InMemoryGitHubProvider();

  // The P13 stack: realization (P9 gateway only) + the journey engine.
  const actingBody = { kind: 'body' as const, id: actingBodyIdFor(journeyId) };
  const realizer = new RepositoryRealizer({
    gateway,
    actor: actingBody,
    clock: gatewayClock,
    workspaceBaseSha: WORLD_BASE_SHA,
  });
  const bodyExecutor = new ReferenceBodyTaskExecutor({ broker });
  const nodeRepairExecutor = new ReferenceNodeRepairExecutor({
    realizer,
    onRevisionProduced: () => {
      /* the realizer tracks the head from its own receipts */
    },
  });
  const nodeRepair: NodeRepairExecutor = {
    repair: (input) => nodeRepairExecutor.repair(input),
  };
  const formalizer: MissionFormalizerPort = new ReferenceMissionFormalizer({ createdAt: formatRfc3339(DOGFOOD_T0) });
  const planner: ArchitecturePlannerPort = new ReferenceArchitecturePlanner({ createdAt: formatRfc3339(DOGFOOD_T0) });
  const authorityApproval = new ReferenceAuthorityApproval({
    authorityGrants: store.authorityGrants,
    gatewayAuthority: grantingAuthority,
    clock,
  });

  const presence = options.presence ?? new ScriptedPresence(false);
  const providerStatuses = [
    { name: 'github-adapter (P4 reference provider)', status: 'REFERENCE', detail: 'SIMULATED connection states; empty-repository detection over static fixtures — never a real GitHub connection (P15 lane-B dogfood)' },
    { name: 'git-host (P9 reference executor)', status: 'REFERENCE', detail: 'deterministic in-memory git world; the real adapter attaches behind the executor seam' },
    { name: 'deployment-target (P9 reference executor)', status: 'REFERENCE', detail: 'deterministic in-memory deployment world; no real deployment evidence exists' },
    { name: 'bodies (P8 reference cloud bodies)', status: 'REFERENCE', detail: 'CloudCodingShellBody deterministic simulators behind the §9 harness seam' },
    {
      name: 'evaluators (P9 scripted reference probes)',
      status: options.defaultEvaluatorRegistry ? 'DEFAULT_REGISTRY' : 'REFERENCE',
      detail: options.defaultEvaluatorRegistry
        ? 'the P9 default registry: tests + static-contract-checks are connected reference probes; every other type is honestly NOT_YET_CONNECTED'
        : 'scripted reference probes (deterministic simulators, not real providers)',
    },
  ];

  const journey = new GreenfieldJourney({
    journeyId,
    store: {
      missions: store.missions,
      authorityGrants: store.authorityGrants,
      tasks: store.tasks,
      observationEvents: store.observationEvents,
    },
    graph,
    broker,
    fabric,
    github,
    formalizer,
    planner,
    authorityApproval,
    bodyExecutor,
    nodeRepair,
    certifier,
    evaluationOrchestration: orchestration,
    realizer,
    clock,
    presence,
    providerStatuses,
  } satisfies GreenfieldJourneyDeps);

  return {
    clock,
    store,
    gatewayWorld,
    executor,
    authority,
    evidence,
    actionEvents,
    broker,
    fabric,
    graph,
    github,
    realizer,
    journey,
    grantedGrantIds,
    revokeJourneyAuthority: () => {
      for (const grantId of [...grantedGrantIds]) {
        authority.revoke(grantId);
      }
    },
    evaluationRequests,
  };
}

/** The scripted reference registry (all types connected as deterministic simulators). */
function scriptedReferenceRegistry(
  scripting: ProbeScripting,
  actingBodyRef: EvaluationActorRef,
  requests: { type: EvaluationType; requestedBy: EvaluationActorRef; producedBy: EvaluationActorRef }[],
): EvaluatorRegistry {
  const registry = new EvaluatorRegistry();
  for (const type of EVALUATION_TYPES) {
    const bound = scripting.bindToActingBody?.includes(type) ? actingBodyRef : scripting.boundActor ?? null;
    registry.register(
      new RecordingProbe({
        evaluatorId: `p15b-reference-${type}`,
        type,
        boundActor: bound,
        results: scripting.failRevisions,
        defaultObservation:
          scripting.failAll || scripting.failTypes?.includes(type) ? failingObservation(type) : undefined,
        sink: requests,
      }),
    );
  }
  return registry;
}

/** Run the user-present phase (kick-off: mission, connect, approve), then hand over to the cloud. */
export async function startFlagshipJourney(
  world: DogfoodWorld,
  input: { readonly raw?: RawUserMission; readonly slug?: string; readonly approve?: boolean; readonly approvedBy?: string } = {},
): Promise<void> {
  const raw = input.raw ?? DEFAULT_RAW_MISSION;
  await world.journey.kickoff(raw);
  const connect = await world.journey.connectRepository(input.slug ?? raw.repositorySlug ?? EMPTY_REPOSITORY_SLUG);
  if (connect.kind !== 'CONNECTED') {
    return; // the typed outcome (ask/unsupported) is asserted by the caller
  }
  if (input.approve ?? true) {
    await world.journey.approveAuthority({ approvedBy: input.approvedBy ?? 'test-user:operator@example.test' });
  }
}

/**
 * Drive the journey on CLOUD ticks only (the §7 pin — the user's computer
 * stays offline), advancing the injected clock between ticks so the
 * observation timeline carries distinct, ordered instants.
 */
export async function driveOnCloudTicks(
  world: DogfoodWorld,
  maxTicks = 96,
): Promise<JourneyState> {
  for (let index = 0; index < maxTicks; index += 1) {
    world.clock.advance(1_000);
    const record = await world.journey.onCloudTick();
    const state = world.journey.state();
    if (state.stage === 'COMPLETED' || state.status !== 'RUNNING') break;
    if (record.action.kind === 'IDLE') break;
  }
  return world.journey.state();
}

/** The world clock as an RFC3339 literal (test convenience). */
export function worldNow(clock: Clock): string {
  return formatRfc3339(clock.nowEpochMs());
}

// ---------------------------------------------------------------------------
// 2. The autonomy dogfood world (P12 leases/checkpoints/recovery)
// ---------------------------------------------------------------------------

export interface AutonomyWorld {
  readonly clock: ManualClock;
  readonly store: ReturnType<typeof createInMemoryLiveStore>;
  readonly broker: BodyBroker;
  readonly fabric: ExecutionFabric;
  readonly graph: TaskGraph;
  readonly gateway: ActionGateway;
  readonly actionEvents: InMemoryEventLog;
  readonly authority: InMemoryAuthority;
  readonly leaseActions: LeaseActionService;
  readonly supervisor: LeaseSupervisor;
  readonly beats: ManualBeatSource;
  readonly failures: ManualFailureVerification;
  readonly planner: RecoveryPlanner;
  readonly outage: InMemoryOutageRegistry;
  readonly asks: InMemoryAskSink;
  readonly cost: CostLedger;
  readonly runtime: TaskRuntime;
  readonly timeline: TaskTimeline;
  readonly grant: AuthorityGrantArtifact;
  readonly mission: MissionArtifact;
}

export interface AutonomyWorldOptions {
  /** An injected shared clock (default: a fresh ManualClock at AUTONOMY_T0). */
  readonly clock?: ManualClock;
  /** Grant expiry offset in ms (default 24h; negative = already expired). */
  readonly grantDurationMs?: number;
  /** The number of reference cloud bodies (default 4: one + three spares). */
  readonly bodyCount?: number;
  /** The missed-beat window (default 30s). */
  readonly missedBeatWindowMs?: number;
}

/** Assemble the autonomy dogfood world (deterministic; everything injected). */
export function createAutonomyWorld(options: AutonomyWorldOptions = {}): AutonomyWorld {
  const clock = options.clock ?? new ManualClock(AUTONOMY_T0);
  const store = createInMemoryLiveStore({ clock });
  const broker = new BodyBroker({ leases: store.bodyLeases, clock });
  const fabric = new ExecutionFabric({
    tasks: store.tasks,
    authorityGrants: store.authorityGrants,
    observationEvents: store.observationEvents,
    objects: store.objects,
    broker,
    clock,
  });
  const graph = new TaskGraph({ tasks: store.tasks, observationEvents: store.observationEvents, clock });

  const bodyCount = options.bodyCount ?? 4;
  for (let index = 0; index < bodyCount; index += 1) {
    const bodyId = `p15b-autonomy-cloud-${String(index + 1).padStart(2, '0')}`;
    const body = new CloudCodingShellBody({
      bodyId,
      provider: { name: 'p15b-autonomy-reference-cloud', version: '1.0.0' },
      placement: 'cloud',
      sandboxPolicy: sandboxPolicy(`/workspace/${bodyId}`),
      secrets: {},
    });
    broker.registerBody({
      body_id: bodyId,
      provider: { name: 'p15b-autonomy-reference-cloud', version: '1.0.0' },
      capabilities: body.capabilitiesValue,
      placement: 'cloud',
      harness: body,
    });
  }

  const authority = new InMemoryAuthority();
  authority.grant(RUNTIME_ACTOR.id, 'body-lifecycle', '*');
  authority.grant(HUMAN_ACTOR.id, 'body-lifecycle', '*');
  const actionEvents = new InMemoryEventLog();
  const bodies = {
    bodyAvailable: (bodyId: string): { available: boolean; detail: string } => {
      const registration = broker.body(bodyId);
      if (registration === undefined) {
        return { available: false, detail: `no body registered under ${JSON.stringify(bodyId)}` };
      }
      return registration.health === 'AVAILABLE'
        ? { available: true, detail: `body ${JSON.stringify(bodyId)} is AVAILABLE` }
        : { available: false, detail: `body ${JSON.stringify(bodyId)} is ${registration.health}` };
    },
  };
  const gateway = new ActionGateway({
    clock: { now: () => clock.nowEpochMs() },
    authority,
    executors: [new LeaseLifecycleExecutor(bodies)],
    idempotency: new InMemoryIdempotencyStore(),
    events: actionEvents,
    evidence: new InMemoryEvidenceSink(),
    rollbackVerifier: null,
  });
  const leaseActions = new LeaseActionService({
    gateway,
    clock,
    leases: store.bodyLeases,
  });
  const beats = new ManualBeatSource();
  const failures = new ManualFailureVerification();
  const supervisor = new LeaseSupervisor({
    leases: store.bodyLeases,
    observationEvents: store.observationEvents,
    clock,
    beats,
    failures,
    missedBeatWindowMs: options.missedBeatWindowMs ?? MISSED_BEAT_WINDOW_MS,
  });
  const planner = new RecoveryPlanner({ tasks: store.tasks, leases: store.bodyLeases });
  const outage = new InMemoryOutageRegistry();
  const asks = new InMemoryAskSink();
  const cost = new CostLedger({ tasks: store.tasks, clock });
  const runtime = new TaskRuntime({
    fabric,
    broker,
    graph,
    tasks: store.tasks,
    leases: store.bodyLeases,
    leaseActions,
    clock,
  });
  const timeline = new TaskTimeline({ tasks: store.tasks, observationEvents: store.observationEvents });

  const now = clock.nowEpochMs();
  const grant: AuthorityGrantArtifact = createGrant({
    grantee: 'spirit:persistent',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['READ', 'REVISE'],
    expiry: { kind: 'TIME', at: formatRfc3339(now + (options.grantDurationMs ?? 86_400_000)) },
    provenance: ['p15b-dogfood:grant'],
    created_at: formatRfc3339(now),
    status: 'ACTIVE',
  });
  const mission: MissionArtifact = createMission({
    content: {
      purpose: 'Keep autonomous build work alive while bodies are disposable',
      goals: [{ id: 'goal-resilient-autonomous-build', statement: 'Run the durable autonomous-build task to completion across body loss and provider outage', status: 'PROPOSED' as const, measures: [] }],
      outcomes: [],
      stakeholders: [],
      measures: [],
      assumptions: [],
      ambiguities: [],
      constraints: [],
    },
    provenance: ['p15b-dogfood:mission'],
    created_at: formatRfc3339(now),
    status: 'ACTIVE',
  });

  return {
    clock,
    store,
    broker,
    fabric,
    graph,
    gateway,
    actionEvents,
    authority,
    leaseActions,
    supervisor,
    beats,
    failures,
    planner,
    outage,
    asks,
    cost,
    runtime,
    timeline,
    grant,
    mission,
  };
}

/** Store the durable truth (mission + authority grant) of the autonomy world. */
export async function seedWorld(world: AutonomyWorld): Promise<void> {
  await world.store.authorityGrants.put(world.grant);
  await world.store.missions.put(world.mission);
}

/**
 * The deterministic dogfood work program: 11 steps — writes, checkpoints,
 * an uncertainty, a final artifact capture. A pure function of nothing
 * (fully static) so uninterrupted and resumed runs execute the EXACT same
 * steps. Checkpoints land at step indices 1, 3, 6, 8 (ids cp-0001..cp-0004).
 */
export function dogfoodProgram(): { steps: readonly WorkerStep[] } {
  return {
    steps: [
      { kind: 'operation', operation: { kind: 'workspace.write', path: 'work/autonomous-build/report.md', content: '# p15b autonomous run\nstep-0\n' } },
      { kind: 'checkpoint', label: 'after-step-0', notes: 'resumable at step 1' },
      { kind: 'operation', operation: { kind: 'workspace.write', path: 'work/autonomous-build/report.md', content: '# p15b autonomous run\nstep-0\nstep-2\n' } },
      { kind: 'checkpoint', label: 'after-step-2', notes: 'resumable at step 3' },
      { kind: 'operation', operation: { kind: 'workspace.write', path: 'work/autonomous-build/notes.md', content: 'step-4 notes\n' } },
      { kind: 'uncertainty', statement: 'the reference body cannot reach real GitHub from the offline dogfood sandbox' },
      { kind: 'checkpoint', label: 'after-step-5', notes: 'resumable at step 6' },
      { kind: 'operation', operation: { kind: 'workspace.write', path: 'work/autonomous-build/notes.md', content: 'step-4 notes\nstep-7 more\n' } },
      { kind: 'checkpoint', label: 'after-step-7', notes: 'resumable at step 8' },
      { kind: 'operation', operation: { kind: 'workspace.write', path: 'work/autonomous-build/report.md', content: '# p15b autonomous run\nstep-0\nstep-2\nstep-9 final\n' } },
      { kind: 'operation', operation: { kind: 'artifacts.capture', name: 'final-report', content: 'the durable completion evidence of the p15b autonomous run' } },
    ],
  };
}

/**
 * The deterministic repair program of the anomaly journey: the fix, a
 * checkpoint, an explicit observation emission (the repair trace lands in
 * the durable timeline) and the captured repair evidence.
 */
export function anomalyRepairProgram(): { steps: readonly WorkerStep[] } {
  return {
    steps: [
      { kind: 'operation', operation: { kind: 'workspace.write', path: 'work/anomaly-repair/fix.md', content: 'repair: pin the failing pipeline step and restore the green path\n' } },
      { kind: 'checkpoint', label: 'after-fix-applied', notes: 'resumable at the verification emission' },
      { kind: 'operation', operation: { kind: 'observations.emit', observation_kind: 'p15b.anomaly-repair.executed', payload: { anomaly: 'CI_FAILING_ON_HEAD', subject: REFERENCE_SUBJECTS.repository, repaired_by: 'p15b-autonomy-cloud-01' } } },
      { kind: 'operation', operation: { kind: 'artifacts.capture', name: 'anomaly-repair-evidence', content: 'the durable repair evidence of the p15b anomaly journey' } },
    ],
  };
}

/** Start the dogfood task on the given body (the typed start outcome). */
export async function startDogfoodTask(world: AutonomyWorld, taskId: string, options: { readonly bodyId?: string; readonly targetSha?: string } = {}) {
  return world.runtime.startTask({
    node: {
      task_id: taskId,
      mission_ref: world.mission.envelope.id,
      authority_ref: world.grant.envelope.id,
      title: 'Resilient autonomous-build run',
      owned_paths: ['work/autonomous-build'],
    },
    program: dogfoodProgram(),
    body_id: options.bodyId ?? FIRST_BODY,
    actor: RUNTIME_ACTOR,
    targetSha: options.targetSha ?? OBSERVED_HEAD_SHA,
  });
}

/**
 * The deterministic independent verifier of the dogfood journeys (the
 * no-self-approval discipline: the RUNTIME never certifies; this verifier
 * derives the verdict from the durable evidence alone).
 */
export function verifyTranscript(
  world: AutonomyWorld,
  taskId: string,
  outcomes: readonly StepOutcome[],
): { verificationId: string; record: { verified: boolean; recorded_at: string; evidence_refs: string[]; summary: string } } {
  const allOk = outcomes.every((entry) => entry.outcome === 'OK' || entry.outcome === 'CHECKPOINTED' || entry.outcome === 'RECORDED');
  const artifactSteps = outcomes.filter((entry) => entry.kind === 'operation' && entry.outcome === 'OK' && entry.output !== null);
  const digest = `${taskId}:${outcomes.length}:${artifactSteps
    .map((entry) => JSON.stringify(entry.output))
    .join('|')}`;
  return {
    verificationId: `verify:${digest.length}:${digest.slice(0, 24)}`,
    record: {
      verified: allOk && outcomes.length > 0,
      recorded_at: formatRfc3339(world.clock.nowEpochMs()),
      evidence_refs: artifactSteps.map((entry) => `step-${entry.index}:ok`),
      summary: `${outcomes.length} steps, ${artifactSteps.length} operations verified from the durable transcript`,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. The observation world (P7 no-body plane + P12 stack, one shared clock)
// ---------------------------------------------------------------------------

/** The assembled observation world: the no-body plane AND the execution stack. */
export interface ObservationWorld {
  readonly clock: ManualClock;
  readonly plane: ReferenceObservationPlane;
  /** The scripted organic sources (anomaly envelopes are pushed onto these). */
  readonly sources: {
    readonly github: ScriptedEventSource;
    readonly ci: ScriptedEventSource;
    readonly deployments: ScriptedEventSource;
    readonly providerHealth: ScriptedEventSource;
  };
  /** The P12 execution stack (ZERO bodies leased until action is required). */
  readonly autonomy: AutonomyWorld;
}

/**
 * The extra System State claims of the lane-B dogfood: the reference claims
 * PLUS one subject no source observes (the honest UNVERIFIED fixture — an
 * unobserved subject must never read as verified).
 */
export function dogfoodClaims(): readonly ReturnType<typeof referenceClaims>[number][] {
  return [
    ...referenceClaims(),
    { subject: 'github:repo:other-org/unobserved-repo@main', claimedRevision: '1111111111111111111111111111111111111111', claimRef: 'system-state:implementation:unobserved' },
  ];
}

/** Assemble the observation world (deterministic; everything injected). */
export function createObservationWorld(): ObservationWorld {
  const clock = new ManualClock(OBSERVATION_T0);
  const github = new ScriptedEventSource({
    description: { source: 'github:webhook:payswapdotorg/SOS-2.0', family: 'github', connection: 'simulated', description: 'reference github webhook source (p15b dogfood)' },
    envelopes: referenceGitHubEnvelopes(),
  });
  const ci = new ScriptedEventSource({
    description: { source: 'ci:github-actions:payswapdotorg/SOS-2.0', family: 'ci', connection: 'simulated', description: 'reference CI event source (p15b dogfood)' },
    envelopes: referenceCiEnvelopes(),
  });
  const deployments = new ScriptedEventSource({
    description: { source: 'deploy:tracker:production', family: 'deployment', connection: 'simulated', description: 'reference deployment tracker (p15b dogfood)' },
    envelopes: referenceDeploymentEnvelopes(),
  });
  const providerHealth = new ScriptedEventSource({
    description: { source: 'status:page:aggregate', family: 'provider-health', connection: 'simulated', description: 'reference provider health feed (p15b dogfood)' },
    envelopes: referenceProviderHealthEnvelopes(),
  });

  const plane = createReferenceObservationPlane({
    clock,
    sources: [github, ci, deployments, providerHealth],
    claims: new ScriptedClaimsPort(dogfoodClaims()),
  });

  const autonomy = createAutonomyWorld({ clock });

  return { clock, plane, sources: { github, ci, deployments, providerHealth }, autonomy };
}

/** The scripted CI-failure envelope of the anomaly journey (the observed anomaly). */
export function ciFailureEnvelope(): {
  readonly externalId: string;
  readonly kind: string;
  readonly occurredAt: string;
  readonly payload: { readonly pipeline: string; readonly ref: string; readonly status: string; readonly runId: string };
  readonly provenance: readonly string[];
} {
  return {
    externalId: 'run-p15b-0001',
    kind: 'ci.run',
    occurredAt: '2026-09-21T12:04:00Z',
    payload: { pipeline: 'repository-contract', ref: OBSERVED_HEAD_SHA, status: 'FAILURE', runId: 'run-p15b-0001' },
    provenance: ['ci:github-actions:payswapdotorg/SOS-2.0'],
  };
}
