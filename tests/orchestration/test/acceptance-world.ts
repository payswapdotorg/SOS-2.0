/**
 * THE ORCHESTRATION ACCEPTANCE WORLD (Work Order P6) — the shared
 * composition every pinned acceptance suite drives: in-memory durable P2
 * stores -> Body Broker (P8 reference cloud bodies) -> Execution Fabric
 * -> durable Task Graph -> Reasoning Broker (managed default; optional
 * BYO slots) -> Worker Runtime -> Independent Verifier -> AskQueue ->
 * ArchitectGate -> Spirit Orchestrator.
 *
 * Everything is injected (ManualClock at a fixed instant — the
 * repository's deterministic discipline); journeys are pure functions of
 * their inputs.
 */

import { CloudCodingShellBody } from '@sos-2/body-runtimes';
import { BodyBroker } from '@sos-2/body-broker';
import { ExecutionFabric } from '@sos-2/execution-fabric';
import { ManualClock, createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { createMission } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';
import { AskQueue } from '@sos-2/ask';
import { TaskGraph } from '@sos-2/task-graph';
import { WorkerRuntime } from '@sos-2/worker-runtime';
import { ReasoningBroker } from '@sos-2/reasoning-broker';
import { ArchitectGate, ReferenceIndependentVerifier, SpiritOrchestrator } from '@sos-2/orchestrator';
import type { JourneyReport } from '@sos-2/orchestrator';

/** The fixed world instant (deterministic journeys). */
export const WORLD_T0 = Date.parse('2026-02-01T10:00:00Z');

/** The default mission of the acceptance journeys (three goals -> three lanes). */
export interface WorldMissionSpec {
  readonly purpose: string;
  readonly goals: readonly { readonly id: string; readonly statement: string }[];
}

export const DEFAULT_MISSION: WorldMissionSpec = {
  purpose: 'Ship the resilient checkout experience',
  goals: [
    { id: 'goal-payment-review', statement: 'Implement payment review' },
    { id: 'goal-validation', statement: 'Harden input validation' },
    { id: 'goal-docs', statement: 'Document the checkout flow' },
  ],
};

/** The assembled acceptance world. */
export interface AcceptanceWorld {
  readonly clock: ManualClock;
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
}

/** Options for assembling a world. */
export interface WorldOptions {
  readonly mission?: WorldMissionSpec;
  /** Grant expiry offset in ms (default 24h; pass a negative value to expire the grant). */
  readonly grantDurationMs?: number;
  /** The number of reference cloud bodies (default 4: three lanes + a spare). */
  readonly bodyCount?: number;
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
export function createAcceptanceWorld(options: WorldOptions = {}): AcceptanceWorld {
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

  const bodyCount = options.bodyCount ?? 4;
  for (let index = 0; index < bodyCount; index += 1) {
    const bodyId = `acceptance-cloud-${String(index + 1).padStart(2, '0')}`;
    const body = new CloudCodingShellBody({
      bodyId,
      provider: { name: 'acceptance-reference-cloud', version: '1.0.0' },
      placement: 'cloud',
      sandboxPolicy: sandboxPolicy(`/workspace/${bodyId}`),
      secrets: {},
    });
    broker.registerBody({
      body_id: bodyId,
      provider: { name: 'acceptance-reference-cloud', version: '1.0.0' },
      capabilities: body.capabilitiesValue,
      placement: 'cloud',
      harness: body,
    });
  }

  const now = clock.nowEpochMs();
  const grant: AuthorityGrantArtifact = createGrant({
    grantee: 'spirit:persistent',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['READ', 'REVISE'],
    expiry: { kind: 'TIME', at: formatRfc3339(now + (options.grantDurationMs ?? 86_400_000)) },
    provenance: ['p6-acceptance:grant'],
    created_at: formatRfc3339(now),
    status: 'ACTIVE',
  });
  const spec = options.mission ?? DEFAULT_MISSION;
  const mission: MissionArtifact = createMission({
    content: {
      purpose: spec.purpose,
      goals: spec.goals.map((goal) => ({ id: goal.id, statement: goal.statement, status: 'PROPOSED' as const, measures: [] })),
      outcomes: [],
      stakeholders: [],
      measures: [],
      assumptions: [],
      ambiguities: [],
      constraints: [],
    },
    provenance: ['p6-acceptance:mission'],
    created_at: formatRfc3339(now),
    status: 'ACTIVE',
  });

  return {
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
  };
}

/** Store the durable truth (mission + authority grant) and decompose. */
export async function startJourney(world: AcceptanceWorld): Promise<void> {
  await world.store.authorityGrants.put(world.grant);
  await world.store.missions.put(world.mission);
  await world.orchestrator.decomposeMission({ mission: world.mission, authority_ref: world.grant.envelope.id });
}

/** Run the journey to its fixed point (bounded) and return the honest report. */
export async function runJourney(world: AcceptanceWorld, simulation: { crashes?: Readonly<Record<number, number>> } = {}): Promise<JourneyReport> {
  for (let tick = 0; tick < 24; tick += 1) {
    const nodes = await world.graph.nodes();
    const active = nodes.filter((node) => node.state === 'PENDING' || node.state === 'RUNNING' || node.state === 'FAILED');
    if (active.length === 0) {
      break;
    }
    await world.orchestrator.tick(simulation);
  }
  return await world.orchestrator.currentReport();
}
