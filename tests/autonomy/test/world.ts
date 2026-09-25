/**
 * THE AUTONOMY ACCEPTANCE WORLD (Work Order P12) — the shared composition
 * every pinned acceptance suite drives: in-memory durable P2 stores ->
 * Body Broker (P8 reference cloud bodies) -> Execution Fabric -> durable
 * Task Graph -> P9 Action Gateway (authority-gated body-lifecycle lease
 * actions) -> Lease Supervisor (injectable beats + verified failures) ->
 * Recovery Planner -> Outage Registry + AskSink -> Cost Ledger ->
 * TaskRuntime + TaskTimeline.
 *
 * Everything is injected (ManualClock at a fixed instant — the
 * repository's deterministic discipline); journeys are pure functions of
 * their inputs. No Date/Math.random/fetch/process.env anywhere in these
 * test sources.
 */

import { CloudCodingShellBody } from '@sos-2/body-runtimes';
import { BodyBroker } from '@sos-2/body-broker';
import { ExecutionFabric } from '@sos-2/execution-fabric';
import { createInMemoryLiveStore, ManualClock, formatRfc3339 } from '@sos-2/live-store';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { createMission } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { TaskGraph } from '@sos-2/task-graph';
import {
  ActionGateway,
  InMemoryAuthority,
  InMemoryEventLog,
  InMemoryEvidenceSink,
  InMemoryIdempotencyStore,
} from '@sos-2/action-gateway';
import type { ActorRef } from '@sos-2/action-gateway';
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

/** The fixed world instant (deterministic journeys): 2026-03-01T08:00:00Z. */
export const WORLD_T0 = 1_772_352_000_000;

/** The runtime actor every lease action runs as (authority-gated at action time). */
export const RUNTIME_ACTOR: ActorRef = { kind: 'system', id: 'spirit:persistent' };

/** The human actor (cancellation / user-driven actions). */
export const HUMAN_ACTOR: ActorRef = { kind: 'human', id: 'operator:primary' };

/** The body the journeys lease first (replacements pick a spare). */
export const FIRST_BODY = 'autonomy-cloud-01';

/** The deterministic missed-beat window of the acceptance world (ms). */
export const MISSED_BEAT_WINDOW_MS = 30_000;

/** The stable source revision lease actions target. */
export const TARGET_SHA = '77553cafd2440264cbe714bef88891585a9a6e78';

export interface AutonomyWorld {
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

export interface WorldOptions {
  /** Grant expiry offset in ms (default 24h; negative = already expired). */
  readonly grantDurationMs?: number;
  /** The number of reference cloud bodies (default 4: one + three spares). */
  readonly bodyCount?: number;
  /** The missed-beat window (default 30s). */
  readonly missedBeatWindowMs?: number;
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

/** Assemble the acceptance world (deterministic; everything injected). */
export function createAutonomyWorld(options: WorldOptions = {}): AutonomyWorld {
  const clock = new ManualClock(WORLD_T0);
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
    const bodyId = `autonomy-cloud-${String(index + 1).padStart(2, '0')}`;
    const body = new CloudCodingShellBody({
      bodyId,
      provider: { name: 'autonomy-reference-cloud', version: '1.0.0' },
      placement: 'cloud',
      sandboxPolicy: sandboxPolicy(`/workspace/${bodyId}`),
      secrets: {},
    });
    broker.registerBody({
      body_id: bodyId,
      provider: { name: 'autonomy-reference-cloud', version: '1.0.0' },
      capabilities: body.capabilitiesValue,
      placement: 'cloud',
      harness: body,
    });
  }

  const authority = new InMemoryAuthority();
  authority.grant(RUNTIME_ACTOR.id, 'body-lifecycle', '*');
  authority.grant(HUMAN_ACTOR.id, 'body-lifecycle', '*');
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
    provenance: ['p12-acceptance:grant'],
    created_at: formatRfc3339(now),
    status: 'ACTIVE',
  });
  const mission: MissionArtifact = createMission({
    content: {
      purpose: 'Keep long-running work alive while bodies are disposable',
      goals: [{ id: 'goal-resilient-run', statement: 'Run the durable task to completion across body loss', status: 'PROPOSED' as const, measures: [] }],
      outcomes: [],
      stakeholders: [],
      measures: [],
      assumptions: [],
      ambiguities: [],
      constraints: [],
    },
    provenance: ['p12-acceptance:mission'],
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

/** Store the durable truth (mission + authority grant). */
export async function seedWorld(world: AutonomyWorld): Promise<void> {
  await world.store.authorityGrants.put(world.grant);
  await world.store.missions.put(world.mission);
}

/**
 * The deterministic acceptance work program: 11 steps — writes,
 * checkpoints, an uncertainty, a final artifact capture. Pure function
 * of nothing (fully static) so uninterrupted and resumed runs execute
 * the EXACT same steps.
 */
export function acceptanceProgram(): { steps: readonly unknown[] } {
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

/** Start the acceptance task on the world's first body (the typed start outcome). */
export async function startAcceptanceTask(world: AutonomyWorld, taskId: string) {
  return world.runtime.startTask({
    node: {
      task_id: taskId,
      mission_ref: world.mission.envelope.id,
      authority_ref: world.grant.envelope.id,
      title: 'Resilient autonomous run',
      owned_paths: ['work/resilient-run'],
    },
    program: acceptanceProgram() as unknown as { steps: import('@sos-2/worker-runtime').WorkerStep[] },
    body_id: FIRST_BODY,
    actor: RUNTIME_ACTOR,
    targetSha: TARGET_SHA,
  });
}

/**
 * The deterministic independent verifier of the acceptance journeys (the
 * P6 no-self-approval discipline: the RUNTIME never certifies; this
 * verifier derives the verdict from the durable evidence).
 */
export function verifyTranscript(
  world: AutonomyWorld,
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
