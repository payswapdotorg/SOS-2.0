/**
 * The orchestrator host composition (Work Order P6) — the plain Node +
 * TypeScript composition root assembling the Spirit Orchestrator exactly
 * the way the product composes it (the apps/worker-runtimes precedent):
 *
 *   in-memory durable P2 stores -> Body Broker (the P8 reference cloud
 *   bodies registered) -> Execution Fabric -> durable Task Graph ->
 *   Reasoning Broker (managed default ALWAYS present; optional BYO slots
 *   honest NOT_YET_CONNECTED) -> Worker Runtime -> Independent Verifier
 *   -> AskQueue -> ArchitectGate -> Spirit Orchestrator on the injected
 *   tick source.
 *
 * Everything is INJECTED (clock, tick source) — this module is PURE and
 * deterministic; the only impure boundary is the documented system-clock
 * module (which the deterministic demo does NOT use).
 */

import { CloudCodingShellBody } from '@sos-2/body-runtimes';
import { BodyBroker } from '@sos-2/body-broker';
import { ExecutionFabric } from '@sos-2/execution-fabric';
import { ManualClock, createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import type { Clock } from '@sos-2/live-store';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { createMission } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { AskQueue } from '@sos-2/ask';
import { TaskGraph } from '@sos-2/task-graph';
import { WorkerRuntime } from '@sos-2/worker-runtime';
import { ReasoningBroker } from '@sos-2/reasoning-broker';
import { ArchitectGate, ReferenceIndependentVerifier, SpiritOrchestrator } from '@sos-2/orchestrator';
import type { SandboxPolicy } from '@sos-2/sandbox';

/** The default bounded-environment policy of the demo reference bodies. */
export const DEMO_CLOUD_SANDBOX_POLICY: SandboxPolicy = {
  filesystem: { mode: 'workspace', root: '/workspace/demo-cloud' },
  network: { egress: 'allowlist', allowedHosts: ['api.github.com', 'registry.npmjs.org'] },
  secrets: ['github-token'],
  budgets: { fileWrites: 200, fileBytes: 1_000_000, shellCommands: 500, networkCalls: 200, secretReveals: 100 },
  resourceEnvelope: { maxDurationMs: 7_200_000, maxMemoryMb: 2048 },
};

/** The assembled orchestrator host. */
export interface OrchestratorHost {
  readonly clock: Clock;
  readonly store: ReturnType<typeof createInMemoryLiveStore>;
  readonly broker: BodyBroker;
  readonly fabric: ExecutionFabric;
  readonly graph: TaskGraph;
  readonly reasoning: ReasoningBroker;
  readonly worker: WorkerRuntime;
  readonly verifier: ReferenceIndependentVerifier;
  readonly askQueue: AskQueue;
  readonly gate: ArchitectGate;
  readonly orchestrator: SpiritOrchestrator;
  readonly grant: AuthorityGrantArtifact;
  readonly mission: MissionArtifact;
  registerCloudBody(input?: { bodyId?: string }): CloudCodingShellBody;
}

/** Composition dependencies (everything injected — the app boundary). */
export interface OrchestratorHostDeps {
  readonly clock: Clock;
  /** The demo mission's purpose + goals (three goals -> three concurrent lanes). */
  readonly mission: {
    readonly purpose: string;
    readonly goals: readonly { readonly id: string; readonly statement: string }[];
  };
  /** Grant expiry offset in ms (default: 24h from the injected clock). */
  readonly grantDurationMs?: number;
}

/**
 * Assemble the orchestrator host. Deterministic for an injected
 * ManualClock; the mission and authority grant are minted through the
 * merged domain packages and stored durably BEFORE the journey runs.
 */
export function createOrchestratorHost(deps: OrchestratorHostDeps): OrchestratorHost {
  if (typeof deps !== 'object' || deps === null || typeof deps.clock !== 'object' || deps.clock === null) {
    throw new Error('createOrchestratorHost requires an injected clock (no hidden time)');
  }
  const clock = deps.clock;
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
  const worker = new WorkerRuntime({ fabric, broker, graph, tasks: store.tasks, clock });
  const reasoning = new ReasoningBroker({ clock });
  const verifier = new ReferenceIndependentVerifier({ tasks: store.tasks, observationEvents: store.observationEvents, clock });
  const askQueue = new AskQueue();
  const gate = new ArchitectGate({ authorityGrants: store.authorityGrants, clock });
  const orchestrator = new SpiritOrchestrator({
    graph,
    fabric,
    broker,
    worker,
    reasoning,
    verifier,
    askQueue,
    gate,
    tasks: store.tasks,
    authorityGrants: store.authorityGrants,
    clock,
  });

  const now = clock.nowEpochMs();
  const grant: AuthorityGrantArtifact = createGrant({
    grantee: 'spirit:persistent',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['READ', 'REVISE'],
    expiry: { kind: 'TIME', at: formatRfc3339(now + (deps.grantDurationMs ?? 86_400_000)) },
    provenance: ['p6-orchestrator-host:demo'],
    created_at: formatRfc3339(now),
    status: 'ACTIVE',
  });
  const mission: MissionArtifact = createMission({
    content: {
      purpose: deps.mission.purpose,
      goals: deps.mission.goals.map((goal) => ({ id: goal.id, statement: goal.statement, status: 'PROPOSED' as const, measures: [] })),
      outcomes: [],
      stakeholders: [],
      measures: [],
      assumptions: [],
      ambiguities: [],
      constraints: [],
    },
    provenance: ['p6-orchestrator-host:demo-mission'],
    created_at: formatRfc3339(now),
    status: 'ACTIVE',
  });

  let registeredCount = 0;
  const host: OrchestratorHost = {
    clock,
    store,
    broker,
    fabric,
    graph,
    reasoning,
    worker,
    verifier,
    askQueue,
    gate,
    orchestrator,
    grant,
    mission,
    registerCloudBody(input = {}) {
      const bodyId = input.bodyId ?? `demo-cloud-shell-${registeredCount + 1}`;
      const body = new CloudCodingShellBody({
        bodyId,
        provider: { name: 'demo-reference-cloud-shell', version: '1.0.0' },
        placement: 'cloud',
        sandboxPolicy: { ...DEMO_CLOUD_SANDBOX_POLICY, filesystem: { mode: 'workspace', root: `/workspace/${bodyId}` } },
        secrets: {},
      });
      broker.registerBody({
        body_id: bodyId,
        provider: { name: 'demo-reference-cloud-shell', version: '1.0.0' },
        capabilities: body.capabilitiesValue,
        placement: 'cloud',
        harness: body,
      });
      registeredCount += 1;
      return body;
    },
  };
  // Four reference bodies: three concurrent lanes + a spare for recovery.
  host.registerCloudBody({ bodyId: 'demo-cloud-shell-1' });
  host.registerCloudBody({ bodyId: 'demo-cloud-shell-2' });
  host.registerCloudBody({ bodyId: 'demo-cloud-shell-3' });
  host.registerCloudBody({ bodyId: 'demo-cloud-shell-4' });
  return host;
}

/** A deterministic manual clock at the demo instant (fixed — never ambient). */
export function demoManualClock(): ManualClock {
  return new ManualClock(Date.parse('2026-02-01T09:00:00Z'));
}
