/**
 * THE MISSION-TO-REPO ACCEPTANCE WORLD (Work Order P13) — the shared
 * composition every pinned acceptance suite drives. This file is the
 * IMPURE BOUNDARY of the P13 delivery (the composition-root precedent of
 * apps/actions + tests/orchestration): it assembles the merged surfaces
 * exactly the way the product composes them, with every clock, store,
 * seam and probe INJECTED — deterministically, offline.
 *
 *   in-memory durable P2 stores
 *     -> P9 action gateway (reference world + executors + in-memory
 *        authority with grant registration) — EVERY consequential action
 *     -> P9 evaluator registry (scripted reference probes; option: the
 *        P9 default registry with honest NOT_YET_CONNECTED probes)
 *     -> P9 evaluation orchestration + the P13 completion certifier
 *     -> P5 body broker + execution fabric + P6 task graph
 *     -> P8 reference cloud bodies (CloudCodingShellBody)
 *     -> P4 GitHub reference provider (bound through its source entry —
 *        the entry-point-less P4 package is source-consumed by every
 *        merged suite that binds it)
 *     -> P13 implementation-orchestrator (formalizer + planner)
 *     -> P13 project realization (P9 gateway only)
 *     -> P13 greenfield runtime (the journey engine)
 *
 * The user-presence recorder defaults to OFFLINE (the §7 device-optional
 * pin: the flagship journey must complete with the user's computer off).
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
import type { ActionFamily, Clock as GatewayClock } from '@sos-2/action-gateway';
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
// The P4 reference provider: @sos-2/github is deliberately entry-point-less
// (zero-dependency, source-consumed — the P3/P4 lockfile precedent), so it
// binds through its source entry exactly the way the merged P4 suites bind it.
import { InMemoryGitHubProvider } from '../../../packages/github/src/index.ts';

/** The fixed world instant (deterministic journeys). */
export const WORLD_T0 = Date.parse('2026-03-01T09:00:00Z');

/** The default mission of the flagship journey. */
export const DEFAULT_RAW_MISSION: RawUserMission = {
  statement: 'Build a URL shortener service with a public API',
  repositorySlug: 'acme/empty-repo',
  capturedAt: formatRfc3339(WORLD_T0),
  source: 'web-console:greenfield',
};

/** The empty greenfield fixture repository. */
export const EMPTY_REPOSITORY_SLUG = 'acme/empty-repo';

/** Scripted-failure probe options for the repair-loop paths. */
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

export interface WorldOptions {
  /** The journey id (default 'flagship-01'). */
  readonly journeyId?: string;
  /** The number of reference cloud bodies (default 3). */
  readonly bodyCount?: number;
  /** Register the bodies at user-device placement instead of cloud (the offline denial fixture). */
  readonly userDeviceBodies?: boolean;
  /** Probe scripting (default: all reference probes pass). */
  readonly probes?: ProbeScripting;
  /** Use the P9 DEFAULT registry (honest NOT_YET_CONNECTED probes for deployment/runtime/security). */
  readonly defaultEvaluatorRegistry?: boolean;
  /** A custom formalizer (the planning-ASK fixture). */
  readonly formalizer?: MissionFormalizerPort;
  /** A custom planner (the planning-ASK fixture). */
  readonly planner?: ArchitecturePlannerPort;
  /** Defect injection for the body executor (the repair fixture). */
  readonly defects?: readonly { readonly taskId: string; readonly mode: 'BUGGY_OUTPUT' }[];
  /** The user-presence recorder (default: ALWAYS OFFLINE — the §7 pin). */
  readonly presence?: { userDeviceOnline(): boolean };
}

/** The assembled acceptance world. */
export interface AcceptanceWorld {
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


/** Assemble the acceptance world (deterministic; everything injected). */
export function createAcceptanceWorld(options: WorldOptions = {}): AcceptanceWorld {
  const journeyId = options.journeyId ?? 'flagship-01';
  const clock: ManualClock = new ManualClock(WORLD_T0);
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
    const bodyId = `p13-${bodyPlacement}-body-${String(index + 1).padStart(2, '0')}`;
    const body = new CloudCodingShellBody({
      bodyId,
      provider: { name: 'p13-acceptance-reference', version: '1.0.0' },
      placement: bodyPlacement,
      sandboxPolicy: sandboxPolicy(`/workspace/${bodyId}`),
      secrets: {},
    });
    broker.registerBody({
      body_id: bodyId,
      provider: { name: 'p13-acceptance-reference', version: '1.0.0' },
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
  const formalizer: MissionFormalizerPort =
    options.formalizer ?? new ReferenceMissionFormalizer({ createdAt: formatRfc3339(WORLD_T0) });
  const planner: ArchitecturePlannerPort =
    options.planner ?? new ReferenceArchitecturePlanner({ createdAt: formatRfc3339(WORLD_T0) });
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
    const bound = scripting.bindToActingBody?.includes(type) ? actingBodyRef : scripting.boundActor ?? null;
    registry.register(
      new RecordingProbe({
        evaluatorId: `p13-reference-${type}`,
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

/** Run the user-present phase (acceptance steps 1-3), then hand over to the cloud. */
export async function startFlagshipJourney(
  world: AcceptanceWorld,
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
  world: AcceptanceWorld,
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
