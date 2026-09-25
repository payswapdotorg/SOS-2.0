/**
 * The task-runner composition root (Work Order P12): the single impure
 * boundary. Everything — clock, beat source, failure verifications,
 * stores, executors — is injected; the reference wiring below is
 * deterministic and offline. Real providers bind later as adapters
 * behind the executor/beat/verification seams without contract change.
 */

import {
  ActionGateway,
  InMemoryAuthority,
  InMemoryEventLog,
  InMemoryEvidenceSink,
  InMemoryIdempotencyStore,
} from '@sos-2/action-gateway';
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
  providerStatusOf,
} from '@sos-2/autonomy-runtime';
import type { AskSink, OutageRegistry } from '@sos-2/autonomy-runtime';
import { BodyBroker } from '@sos-2/body-broker';
import { CloudCodingShellBody } from '@sos-2/body-runtimes';
import { ExecutionFabric } from '@sos-2/execution-fabric';
import { createInMemoryLiveStore } from '@sos-2/live-store';
import type { Clock } from '@sos-2/live-store';
import { TaskGraph } from '@sos-2/task-graph';
import { TaskRuntime, TaskTimeline } from '@sos-2/task-runtime';

export type ProviderStatusKind = 'REFERENCE' | 'NOT_YET_CONNECTED';

export interface ProviderStatus {
  readonly provider: string;
  readonly status: ProviderStatusKind;
  readonly detail: string;
}

/** The assembled task-runner host (all seams reachable for the embedder). */
export interface TaskRunnerHost {
  readonly gateway: ActionGateway;
  readonly authority: InMemoryAuthority;
  readonly leaseActions: LeaseActionService;
  readonly supervisor: LeaseSupervisor;
  readonly planner: RecoveryPlanner;
  readonly outage: OutageRegistry;
  readonly asks: AskSink;
  readonly cost: CostLedger;
  readonly fabric: ExecutionFabric;
  readonly graph: TaskGraph;
  readonly runtime: TaskRuntime;
  readonly timeline: TaskTimeline;
  readonly beats: ManualBeatSource;
  readonly failures: ManualFailureVerification;
  readonly broker: BodyBroker;
  readonly store: ReturnType<typeof createInMemoryLiveStore>;
  providerStatus(): readonly ProviderStatus[];
}

/** The reference cloud body count (one active + spares for replacement). */
export const REFERENCE_BODY_COUNT = 3;

function sandboxPolicy(root: string) {
  return {
    filesystem: { mode: 'workspace' as const, root },
    network: { egress: 'allowlist' as const, allowedHosts: ['api.github.com', 'registry.npmjs.org'] },
    secrets: ['github-token'],
    budgets: { fileWrites: 200, fileBytes: 1_000_000, shellCommands: 500, networkCalls: 200, secretReveals: 100 },
    resourceEnvelope: { maxDurationMs: 7_200_000, maxMemoryMb: 2048 },
  };
}

/**
 * Composition root: assemble the task-runner host. The clock is the
 * ONLY ambient dependency (passed in); the live store is the in-memory
 * reference (durable-shape faithful, offline).
 */
export function buildTaskRunnerHost(clock: Clock, options: { readonly missedBeatWindowMs?: number } = {}): TaskRunnerHost {
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

  for (let index = 0; index < REFERENCE_BODY_COUNT; index += 1) {
    const bodyId = `task-runner-cloud-${String(index + 1).padStart(2, '0')}`;
    const body = new CloudCodingShellBody({
      bodyId,
      provider: { name: 'task-runner-reference-cloud', version: '1.0.0' },
      placement: 'cloud',
      sandboxPolicy: sandboxPolicy(`/workspace/${bodyId}`),
      secrets: {},
    });
    broker.registerBody({
      body_id: bodyId,
      provider: { name: 'task-runner-reference-cloud', version: '1.0.0' },
      capabilities: body.capabilitiesValue,
      placement: 'cloud',
      harness: body,
    });
  }

  const authority = new InMemoryAuthority();
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
    missedBeatWindowMs: options.missedBeatWindowMs ?? 30_000,
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

  return {
    gateway,
    authority,
    leaseActions,
    supervisor,
    planner,
    outage,
    asks,
    cost,
    fabric,
    graph,
    runtime,
    timeline,
    beats,
    failures,
    broker,
    store,
    providerStatus(): readonly ProviderStatus[] {
      const availability = providerStatusOf(outage, 'task-runner-reference-cloud');
      return [
        { provider: 'durable-live-store', status: 'REFERENCE', detail: 'the in-memory live store (durable-shape faithful, offline — the real Neon/Upstash/R2 bindings attach as adapters behind the same ports)' },
        { provider: 'cloud-body-provider', status: 'REFERENCE', detail: `${REFERENCE_BODY_COUNT} reference cloud bodies behind the P8 body runtimes (real cloud providers are NOT_YET_CONNECTED — no fabricated liveness)` },
        { provider: 'task-runner-reference-cloud', status: 'REFERENCE', detail: `outage view: ${availability.detail}` },
        { provider: 'github', status: 'NOT_YET_CONNECTED', detail: 'no real GitHub endpoint is bound in the reference composition — honest NOT_YET_CONNECTED, never fabricated evidence' },
      ];
    },
  };
}
