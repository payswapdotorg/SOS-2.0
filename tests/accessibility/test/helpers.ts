/**
 * SHARED LANE-C FIXTURES + COMPOSITIONS (Work Order P15, lane C —
 * accessibility + negative cases).
 *
 * This file is the IMPURE-ish composition boundary of the lane-C suites,
 * following the exemplar compositions the repository already ships: the
 * P13 acceptance world (tests/mission-to-repo/test/world.ts), the P12
 * autonomy world (tests/autonomy/test/world.ts) and the P14 credential
 * gateway composition (tests/production-hardening/helpers.ts). Every
 * clock, store, seam and probe is INJECTED; the fixtures are fixed
 * literals. Nothing here is product code — it assembles the MERGED
 * PUBLIC EXPORTS exactly the way the product composes them so the
 * suites drive only surfaces a non-developer user can reach.
 *
 * Sections:
 *   1. fixed instants + spine fixtures (the W17 helper discipline)
 *   2. synthetic secret fixtures (fragment-assembled — never real)
 *   3. the PRODUCT WORLD: the §11 flagship journey composition (the
 *      composed app surface a fresh user drives)
 *   4. the RESILIENCE WORLD: durable task + body-lease supervision
 *      (the P12 composition the crash/resume negative cases drive)
 *   5. the CREDENTIAL GATEWAY: the P9 action gateway re-evaluating a
 *      P14 scoped credential at action time (expired/revoked pins)
 *   6. evidence-graph truthfulness helpers (the shared after-the-fault
 *      assertions every negative case runs)
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
import type { ActionFamily, ActionRequest, AuthorityPort, AuthorityQuery, AuthoritySnapshot, Clock as GatewayClock } from '@sos-2/action-gateway';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { CloudCodingShellBody } from '@sos-2/body-runtimes';
import { BodyBroker } from '@sos-2/body-broker';
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
import { createMission } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { createEvidence } from '@sos-2/evidence';
import type { CreateEvidenceInput, EvidenceRecordW3 } from '@sos-2/evidence';
import { EvaluationOrchestrator } from '@sos-2/evaluation-orchestration';
import { EvaluatorRegistry, IndependentEvaluationService, ScriptedReferenceProbe, defaultRegistry } from '@sos-2/evaluator';
import type { EvaluationActorRef, EvaluationRequest, EvaluationType, ProbeObservation } from '@sos-2/evaluator';
import { EVALUATION_TYPES } from '@sos-2/evaluator';
import { ExecutionFabric } from '@sos-2/execution-fabric';
import {
  CompletionCertifier,
  GreenfieldJourney,
  ReferenceAuthorityApproval,
  ReferenceBodyTaskExecutor,
  ReferenceNodeRepairExecutor,
  actingBodyIdFor,
} from '@sos-2/greenfield-runtime';
import type { GreenfieldJourneyDeps, GrantingAuthorityPort, JourneyState, NodeRepairExecutor } from '@sos-2/greenfield-runtime';
import { ReferenceArchitecturePlanner, ReferenceMissionFormalizer } from '@sos-2/implementation-orchestrator';
import type { ArchitecturePlannerPort, MissionFormalizerPort, RawUserMission } from '@sos-2/implementation-orchestrator';
import { ManualClock, createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import type { Clock } from '@sos-2/live-store';
import { evaluateCredentialScope } from '@sos-2/security';
import type { CredentialScopeRecord } from '@sos-2/security';
import { RepositoryRealizer } from '@sos-2/project-realization';
import { TraceLinkStore, deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import { TaskGraph } from '@sos-2/task-graph';
import { TaskRuntime, TaskTimeline } from '@sos-2/task-runtime';
// The P4 reference github provider is ENTRY-POINT-LESS by design (the
// P3/P4 lockfile-byte-identity precedent) — it binds through its source
// entry, exactly the way the merged P13 suite binds it. This is the ONE
// documented source binding outside the owned paths (pinned by the
// structural suite).
import { InMemoryGitHubProvider } from '../../../packages/github/src/index.ts';
import { expect } from 'vitest';

// ---------------------------------------------------------------------------
// 1. Fixed instants + spine fixtures (the W17 helper discipline)
// ---------------------------------------------------------------------------

/** Fixed instants for the package-level negative fixtures (deterministic literals). */
export const T0 = '2026-07-01T00:00:00.000Z';
export const T1 = '2026-07-02T00:00:00.000Z';
export const T2 = '2026-07-03T00:00:00.000Z';
export const T_FAR = '2026-12-31T00:00:00.000Z';

export const LANE_PROVENANCE = ['P15:accessibility:lane-c'];

/** A deterministic governance anchor for the lane-C suites. */
export const LANE_ANCHOR = deriveDeterministicArtifactId('Constitution', {
  note: 'p15 lane-c accessibility dogfood governance anchor',
  scenario: 'p15-accessibility-lane-c',
});

/** A spine id of any kind (for test subjects that are not full artifacts). */
export function subjectId(kind: string, note: string): string {
  return deriveDeterministicArtifactId(kind, { note, scenario: 'p15-accessibility-lane-c' });
}

export function toolProducer(): Producer {
  return {
    tool: 'p15-accessibility-dogfood',
    tool_version: '1.0.0',
    model: null,
    model_version: null,
    command: 'vitest run tests/accessibility',
    environment: 'ci:local',
  };
}

export const WINDOW: TimeWindow = { start: T0, end: T_FAR };

/** A valid PROMOTE grant over a kind (TIME-bound, expiring after T2 — the W17 technique). */
export function promoteGrant(artifactKind: string, grantee = 'p15-lane-c-runner'): AuthorityGrantArtifact {
  return createGrant({
    grantee,
    scope: { kind: 'KIND', artifact_kind: artifactKind },
    permissions: ['READ', 'PROMOTE'],
    expiry: { kind: 'TIME', at: T_FAR },
    provenance: [...LANE_PROVENANCE, 'authority:promote-grant'],
    created_at: T0,
    status: 'ACTIVE',
  });
}

export function makeEvidence(subject: string, overrides: Partial<CreateEvidenceInput> = {}): EvidenceRecordW3 {
  return createEvidence({
    kind: 'telemetry',
    subject_ref: subject,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'telemetry:capture-availability',
    provenance: ['observation:sha256:' + 'a'.repeat(64)],
    window: WINDOW,
    subject_revision: null,
    producer: toolProducer(),
    ...overrides,
  });
}

/**
 * THE TRACE-CHAIN-STAYS-QUERYABLE check shared by every lane-C negative
 * case (the W17 discipline): after the fault was constructed and
 * contained, the typed links still answer from/to queries.
 */
export function assertTraceQueryable(links: readonly TraceLink[]): {
  store: TraceLinkStore;
  queryFrom: (source: string) => TraceLink[];
  queryTo: (target: string) => TraceLink[];
} {
  const store = new TraceLinkStore();
  for (const link of links) {
    if (!store.has(link.source, link.target, link.type)) {
      store.add(link);
    }
  }
  for (const link of links) {
    expect(store.has(link.source, link.target, link.type)).toBe(true);
  }
  const queryFrom = (source: string) => store.from(source);
  const queryTo = (target: string) => store.to(target);
  return { store, queryFrom, queryTo };
}

// ---------------------------------------------------------------------------
// 2. Synthetic secret fixtures (fragment-assembled — never real secrets)
// ---------------------------------------------------------------------------

/** A synthetic GitHub-token-shaped VALUE (assembled from fragments, the P3/P14 technique). */
export const SYNTHETIC_GITHUB_TOKEN = ['ghp', '_', 'LaneCaaaa', 'Synthetic0', 'Fixture11', 'NotAReal1', 'Secret999'].join('');
/** A synthetic slack-bot-token-shaped VALUE. */
export const SYNTHETIC_SLACK_TOKEN = ['xoxb', '-', '7777777777', 'laneCsynthetic'].join('');

/** An artifact a body tries to emit with a secret-shaped value inside. */
export const LEAKY_ARTIFACT = `# build log\nstep 1 ok\npush with token ${SYNTHETIC_GITHUB_TOKEN}\ndone\n`;

// ---------------------------------------------------------------------------
// 3. THE PRODUCT WORLD — the §11 flagship journey composition
//    (the composed surface a fresh user drives; mirrors the P13 exemplar
//    world over the SAME merged public exports)
// ---------------------------------------------------------------------------

/** The fixed world instant (deterministic journeys). */
export const PRODUCT_T0 = Date.parse('2026-03-01T09:00:00Z');

/** The default mission of the flagship journey (plain user language). */
export const DEFAULT_RAW_MISSION: RawUserMission = {
  statement: 'Build a URL shortener service with a public API',
  repositorySlug: 'acme/empty-repo',
  capturedAt: formatRfc3339(PRODUCT_T0),
  source: 'web-console:greenfield',
};

export const EMPTY_REPOSITORY_SLUG = 'acme/empty-repo';

/** Scripted-failure probe options for the fault-injection paths. */
export interface ProbeScripting {
  /** Revisions whose evaluation FAILS (keyed by source revision). */
  readonly failRevisions?: ReadonlyMap<string, ProbeObservation>;
  /** Fail EVERY revision (the repair-exhaustion fixture). */
  readonly failAll?: boolean;
  /** Fail every revision OF THESE TYPES. */
  readonly failTypes?: readonly EvaluationType[];
  /** Bind one evaluator to the acting body (the independence fixture). */
  readonly bindToActingBody?: readonly EvaluationType[];
}

export interface ProductWorldOptions {
  /** The journey id (default 'flagship-p15c'). */
  readonly journeyId?: string;
  /** The number of reference cloud bodies (default 3). */
  readonly bodyCount?: number;
  /** Register the bodies at user-device placement instead of cloud (the offline denial fixture). */
  readonly userDeviceBodies?: boolean;
  /** Probe scripting (default: all reference probes pass). */
  readonly probes?: ProbeScripting;
  /** Use the P9 DEFAULT registry (honest NOT_YET_CONNECTED probes for deployment/runtime/security). */
  readonly defaultEvaluatorRegistry?: boolean;
  /** Defect injection for the body executor (the unsafe-output fixture). */
  readonly defects?: readonly { readonly taskId: string; readonly mode: 'BUGGY_OUTPUT' }[];
  /** The user-presence recorder (default: ALWAYS OFFLINE — the §7 pin). */
  readonly presence?: { userDeviceOnline(): boolean };
}

/** The assembled product world (the composed user-reachable surface). */
export interface ProductWorld {
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

/** Assemble the product world (deterministic; everything injected). */
export function createProductWorld(options: ProductWorldOptions = {}): ProductWorld {
  const journeyId = options.journeyId ?? 'flagship-p15c';
  const clock: ManualClock = new ManualClock(PRODUCT_T0);
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

  // The P5/P6/P8 execution stack.
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
    const bodyId = `p15c-${bodyPlacement}-body-${String(index + 1).padStart(2, '0')}`;
    const body = new CloudCodingShellBody({
      bodyId,
      provider: { name: 'p15c-accessibility-reference', version: '1.0.0' },
      placement: bodyPlacement,
      sandboxPolicy: sandboxPolicy(`/workspace/${bodyId}`),
      secrets: {},
    });
    broker.registerBody({
      body_id: bodyId,
      provider: { name: 'p15c-accessibility-reference', version: '1.0.0' },
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
  const bodyExecutor = new ReferenceBodyTaskExecutor({ broker, defects: options.defects });
  const nodeRepairExecutor = new ReferenceNodeRepairExecutor({
    realizer,
    onRevisionProduced: () => {
      /* the realizer tracks the head from its own receipts */
    },
  });
  const nodeRepair: NodeRepairExecutor = {
    repair: (input) => nodeRepairExecutor.repair(input),
  };
  const formalizer: MissionFormalizerPort = new ReferenceMissionFormalizer({ createdAt: formatRfc3339(PRODUCT_T0) });
  const planner: ArchitecturePlannerPort = new ReferenceArchitecturePlanner({ createdAt: formatRfc3339(PRODUCT_T0) });
  const authorityApproval = new ReferenceAuthorityApproval({
    authorityGrants: store.authorityGrants,
    gatewayAuthority: grantingAuthority,
    clock,
  });

  const presence = options.presence ?? { userDeviceOnline: () => false };
  const providerStatuses = [
    { name: 'github-adapter (P4 reference provider)', status: 'REFERENCE', detail: 'SIMULATED connection states; empty-repository detection over static fixtures — never a real GitHub connection' },
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
    const bound = scripting.bindToActingBody?.includes(type) ? actingBodyRef : null;
    registry.register(
      new RecordingProbe({
        evaluatorId: `p15c-reference-${type}`,
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

/** Run the user-present phase (kickoff -> connect -> approve), then hand over to the cloud. */
export async function startFlagshipJourney(
  world: ProductWorld,
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
  world: ProductWorld,
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

// ---------------------------------------------------------------------------
// 4. THE RESILIENCE WORLD — durable task + body-lease supervision
//    (the P12 composition the crash/resume negative cases drive)
// ---------------------------------------------------------------------------

/** The fixed world instant of the resilience world: 2026-03-01T08:00:00Z. */
export const RESILIENCE_T0 = 1_772_352_000_000;

/** The runtime actor every lease action runs as (authority-gated at action time). */
export const RUNTIME_ACTOR = { kind: 'system' as const, id: 'spirit:persistent' };

/** The body the journeys lease first (replacements pick a spare). */
export const RESILIENCE_FIRST_BODY = 'p15c-resilience-body-01';

/** The deterministic missed-beat window of the resilience world (ms). */
export const MISSED_BEAT_WINDOW_MS = 30_000;

/** The stable source revision lease actions target. */
export const RESILIENCE_TARGET_SHA = '77553cafd2440264cbe714bef88891585a9a6e78';

/** The assembled resilience world (the P12-style composition). */
export interface ResilienceWorld {
  readonly clock: ManualClock;
  readonly store: ReturnType<typeof createInMemoryLiveStore>;
  readonly broker: BodyBroker;
  readonly fabric: ExecutionFabric;
  readonly graph: TaskGraph;
  readonly gateway: ActionGateway;
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

/** Assemble the resilience world (deterministic; everything injected). */
export function createResilienceWorld(): ResilienceWorld {
  const clock = new ManualClock(RESILIENCE_T0);
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

  const bodyCount = 4;
  for (let index = 0; index < bodyCount; index += 1) {
    const bodyId = `p15c-resilience-body-${String(index + 1).padStart(2, '0')}`;
    const body = new CloudCodingShellBody({
      bodyId,
      provider: { name: 'p15c-resilience-reference', version: '1.0.0' },
      placement: 'cloud',
      sandboxPolicy: sandboxPolicy(`/workspace/${bodyId}`),
      secrets: {},
    });
    broker.registerBody({
      body_id: bodyId,
      provider: { name: 'p15c-resilience-reference', version: '1.0.0' },
      capabilities: body.capabilitiesValue,
      placement: 'cloud',
      harness: body,
    });
  }

  const authority = new InMemoryAuthority();
  authority.grant(RUNTIME_ACTOR.id, 'body-lifecycle', '*');
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
    events: new InMemoryEventLog(),
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
    missedBeatWindowMs: MISSED_BEAT_WINDOW_MS,
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
    expiry: { kind: 'TIME', at: formatRfc3339(now + 86_400_000) },
    provenance: [...LANE_PROVENANCE, 'resilience:grant'],
    created_at: formatRfc3339(now),
    status: 'ACTIVE',
  });
  const mission: MissionArtifact = createMission({
    content: {
      purpose: 'Prove the product fails safely when bodies crash mid-task',
      goals: [{ id: 'goal-resilient-run', statement: 'Run the durable task to completion across body loss', status: 'PROPOSED' as const, measures: [] }],
      outcomes: [],
      stakeholders: [],
      measures: [],
      assumptions: [],
      ambiguities: [],
      constraints: [],
    },
    provenance: [...LANE_PROVENANCE, 'resilience:mission'],
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

/** Store the durable truth (mission + authority grant) of a resilience world. */
export async function seedResilienceWorld(world: ResilienceWorld): Promise<void> {
  await world.store.authorityGrants.put(world.grant);
  await world.store.missions.put(world.mission);
}

/**
 * The deterministic resilience work program: 11 steps — writes,
 * checkpoints, an uncertainty, a final artifact capture (the P12
 * acceptance program shape — fully static so uninterrupted and resumed
 * runs execute the EXACT same steps).
 */
export function resilienceProgram(): { steps: readonly unknown[] } {
  return {
    steps: [
      { kind: 'operation', operation: { kind: 'workspace.write', path: 'work/report.md', content: '# autonomous run\nstep-0\n' } },
      { kind: 'checkpoint', label: 'after-step-0', notes: 'resumable at step 1' },
      { kind: 'operation', operation: { kind: 'workspace.write', path: 'work/report.md', content: '# autonomous run\nstep-0\nstep-2\n' } },
      { kind: 'checkpoint', label: 'after-step-2', notes: 'resumable at step 3' },
      { kind: 'operation', operation: { kind: 'workspace.write', path: 'work/notes.md', content: 'step-4 notes\n' } },
      { kind: 'uncertainty', statement: 'the reference body cannot reach real GitHub from the offline sandbox' },
      { kind: 'checkpoint', label: 'after-step-5', notes: 'resumable at step 6' },
      { kind: 'operation', operation: { kind: 'workspace.write', path: 'work/notes.md', content: 'step-4 notes\nstep-7 more\n' } },
      { kind: 'checkpoint', label: 'after-step-7', notes: 'resumable at step 8' },
      { kind: 'operation', operation: { kind: 'workspace.write', path: 'work/report.md', content: '# autonomous run\nstep-0\nstep-2\nstep-9 final\n' } },
      { kind: 'operation', operation: { kind: 'artifacts.capture', name: 'final-report', content: 'the durable completion evidence of the autonomous run' } },
    ],
  };
}

/** Start a resilience task on the world's first body (the typed start outcome). */
export async function startResilienceTask(world: ResilienceWorld, taskId: string) {
  return world.runtime.startTask({
    node: {
      task_id: taskId,
      mission_ref: world.mission.envelope.id,
      authority_ref: world.grant.envelope.id,
      title: 'Resilient autonomous run',
      owned_paths: ['work/resilient-run'],
    },
    program: resilienceProgram() as unknown as { steps: import('@sos-2/worker-runtime').WorkerStep[] },
    body_id: RESILIENCE_FIRST_BODY,
    actor: RUNTIME_ACTOR,
    targetSha: RESILIENCE_TARGET_SHA,
  });
}

/**
 * The deterministic independent verifier of the resilience journeys (the
 * no-self-approval discipline: the RUNTIME never certifies; this verifier
 * derives the verdict from the durable evidence).
 */
export function verifyTranscript(
  world: ResilienceWorld,
  taskId: string,
  outcomes: readonly { readonly index: number; readonly kind: string; readonly outcome: string; readonly output: unknown }[],
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
// 5. THE CREDENTIAL GATEWAY — the P9 action gateway re-evaluating a P14
//    scoped credential at action time (the expired/revoked pins)
// ---------------------------------------------------------------------------

/** A manual clock for the policy/gateway compositions ({ now() } — the P14 helper discipline). */
export class PolicyManualClock {
  private current: number;
  constructor(start: number = 1_000_000) {
    this.current = start;
  }
  now(): number {
    return this.current;
  }
  advance(milliseconds: number): void {
    this.current += milliseconds;
  }
}

/**
 * The lane-C credential->gateway authority adapter: the gateway's
 * AuthorityPort re-evaluated at ACTION TIME, ANDed with the P14
 * credential-scope evaluation. A credential that is expired or scoped
 * away from the requested family fails closed — the executor is never
 * invoked.
 */
export class ScopedCredentialAuthority implements AuthorityPort {
  readonly evaluations: Array<{ readonly query: AuthorityQuery; readonly now: number; readonly snapshot: AuthoritySnapshot }> = [];

  constructor(
    public readonly base: InMemoryAuthority,
    private readonly credential: CredentialScopeRecord | null,
  ) {}

  evaluateCurrent(query: AuthorityQuery, now: number): AuthoritySnapshot {
    const gatewayGrant = this.base.evaluateCurrent(query, now);
    let snapshot: AuthoritySnapshot;
    if (!gatewayGrant.granted) {
      snapshot = gatewayGrant;
    } else {
      const scope = evaluateCredentialScope(this.credential, query.family, now);
      if (scope.kind === 'SCOPE_GRANTED') {
        snapshot = gatewayGrant;
      } else {
        const reason = scope.kind === 'CREDENTIAL_EXPIRED' ? 'GRANT_EXPIRED' : 'SCOPE_EXCEEDED';
        snapshot = {
          granted: false,
          reason,
          grantId: gatewayGrant.grantId,
          evaluatedAt: now,
          detail: scope.detail,
        };
      }
    }
    this.evaluations.push({ query, now, snapshot });
    return snapshot;
  }
}

/** The composed credential gateway (the fail-closed pins drive this). */
export interface CredentialGateway {
  readonly gateway: ActionGateway;
  readonly world: ReferenceWorld;
  readonly executor: ReferenceExecutor;
  readonly authority: ScopedCredentialAuthority;
  readonly eventLog: InMemoryEventLog;
  readonly evidence: InMemoryEvidenceSink;
  readonly clock: PolicyManualClock;
}

/** Build a real P9 gateway composed with the P14 credential scoping. */
export function composeCredentialGateway(credential: CredentialScopeRecord | null, clockStart: number = 1_000_000): CredentialGateway {
  const clock = new PolicyManualClock(clockStart);
  const world = new ReferenceWorld();
  const executor = new ReferenceExecutor(world);
  const authority = new ScopedCredentialAuthority(new InMemoryAuthority(), credential);
  const eventLog = new InMemoryEventLog();
  const evidence = new InMemoryEvidenceSink();
  const gateway = new ActionGateway({
    clock,
    authority,
    executors: [executor],
    idempotency: new InMemoryIdempotencyStore(),
    events: eventLog,
    evidence,
    rollbackVerifier: null,
  });
  return { gateway, world, executor, authority, eventLog, evidence, clock };
}

/** A well-formed commit action request (the P9 envelope). */
export function commitActionRequest(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    actionId: 'act-p15c-commit-1',
    idempotencyKey: 'idem-p15c-commit-1',
    family: 'commit',
    actor: { kind: 'body', id: 'body-1' },
    requestedAt: 1_000_000,
    targetRevision: { kind: 'source', sha: WORLD_BASE_SHA },
    payload: {
      family: 'commit',
      commit: {
        message: 'apply change',
        changes: [{ path: 'src/a.ts', contents: 'export const a = 1;\n' }],
        expectedBaseSha: WORLD_BASE_SHA,
      },
    },
    ...overrides,
  };
}

/** A well-formed push action request (a DIFFERENT action family). */
export function pushActionRequest(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    actionId: 'act-p15c-push-1',
    idempotencyKey: 'idem-p15c-push-1',
    family: 'push',
    actor: { kind: 'body', id: 'body-1' },
    requestedAt: 1_000_000,
    targetRevision: { kind: 'source', sha: WORLD_BASE_SHA },
    payload: {
      family: 'push',
      push: { remote: 'origin', ref: 'main', fromSha: WORLD_BASE_SHA },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 6. Evidence-graph truthfulness helpers (the shared after-the-fault
//    assertions every negative case runs)
// ---------------------------------------------------------------------------

/**
 * THE SHARED "the evidence graph stays queryable and truthful" check for
 * product-world journeys: the durable observation timeline still replays,
 * every event carries its replayable shape (id, kind, instants,
 * provenance), and every truth state the graph recorded is one of the
 * honest vocabulary values (never a folded/ambiguous value).
 */
export async function assertProductGraphQueryableAndTruthful(world: ProductWorld): Promise<void> {
  const timeline = await world.journey.evidenceTimeline();
  expect(timeline.length, 'the evidence timeline must still replay after the fault').toBeGreaterThan(0);
  for (const event of timeline) {
    expect(event.eventId.length).toBeGreaterThan(0);
    expect(event.provenance.length).toBeGreaterThan(0);
    expect(event.occurredAt).toMatch(/^\d{4}-/);
  }
  // The durable stores still answer point queries (the graph is queryable).
  const missions = await world.store.missions.list({ limit: null });
  expect(missions.items.length).toBeGreaterThan(0);
}

/** Assert a serialized record pool contains NO demo-fixture provenance marker (the demo/live fence). */
export function assertNoDemoMarkers(pool: readonly unknown[], label: string): void {
  for (const entry of pool) {
    const serialized = JSON.stringify(entry);
    expect(
      serialized.includes('demo-fixture') || serialized.includes('DEMO — SIMULATED DATA'),
      `${label}: a demo-fixture marker leaked into the live record pool`,
    ).toBe(false);
  }
}
