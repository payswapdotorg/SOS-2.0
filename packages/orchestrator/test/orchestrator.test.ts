/**
 * @sos-2/orchestrator contract tests (Work Order P6).
 *
 * Pins (the journey-level pins live in tests/orchestration; these are
 * the package's own contract tests):
 *  - the three-lane journey: mission -> decomposition (managed default,
 *    zero BYO) -> 3 concurrent lanes on disjoint scopes -> crash +
 *    recovery of one lane -> verification-gated completion -> architect
 *    gate -> honest report;
 *  - a worker completion REPORT never certifies: completion flows
 *    through the independent verifier (VERIFIED verdict required);
 *  - mission completion without the governed gate is a typed violation
 *    naming the rule; a forged gate record authorizes nothing;
 *  - the architect gate cannot mint authority (unresolvable/expired
 *    refs are typed violations).
 */

import { describe, expect, it } from 'vitest';
import { CloudCodingShellBody } from '@sos-2/body-runtimes';
import { BodyBroker } from '@sos-2/body-broker';
import { ExecutionFabric } from '@sos-2/execution-fabric';
import { ManualClock, createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import { createGrant } from '@sos-2/authority';
import { createMission } from '@sos-2/mission';
import { AskQueue } from '@sos-2/ask';
import { TaskGraph } from '@sos-2/task-graph';
import { WorkerRuntime } from '@sos-2/worker-runtime';
import { ReasoningBroker } from '@sos-2/reasoning-broker';
import { ArchitectGate, ReferenceIndependentVerifier, SilentBypassViolationError, SpiritOrchestrator } from '../src/index.js';

const T0 = Date.parse('2026-02-01T10:00:00Z');

function sandboxPolicy(root: string) {
  return {
    filesystem: { mode: 'workspace' as const, root },
    network: { egress: 'allowlist' as const, allowedHosts: ['api.github.com', 'registry.npmjs.org'] },
    secrets: ['github-token'],
    budgets: { fileWrites: 200, fileBytes: 1_000_000, shellCommands: 500, networkCalls: 200, secretReveals: 100 },
    resourceEnvelope: { maxDurationMs: 7_200_000, maxMemoryMb: 2048 },
  };
}

function world(bodyCount = 4) {
  const clock = new ManualClock(T0);
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
  for (let index = 0; index < bodyCount; index += 1) {
    const bodyId = `cloud-shell-${String(index + 1).padStart(2, '0')}`;
    const body = new CloudCodingShellBody({
      bodyId,
      provider: { name: 'reference-cloud-shell', version: '1.0.0' },
      placement: 'cloud',
      sandboxPolicy: sandboxPolicy(`/workspace/${bodyId}`),
      secrets: {},
    });
    broker.registerBody({
      body_id: bodyId,
      provider: { name: 'reference-cloud-shell', version: '1.0.0' },
      capabilities: body.capabilitiesValue,
      placement: 'cloud',
      harness: body,
    });
  }
  const now = clock.nowEpochMs();
  const grant = createGrant({
    grantee: 'spirit:persistent',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['READ', 'REVISE'],
    expiry: { kind: 'TIME', at: formatRfc3339(now + 86_400_000) },
    provenance: ['p6-orchestrator-test'],
    created_at: formatRfc3339(now),
    status: 'ACTIVE',
  });
  const mission = createMission({
    content: {
      purpose: 'Ship the resilient checkout mission',
      goals: [
        { id: 'goal-a', statement: 'Implement payment review', status: 'PROPOSED', measures: [] },
        { id: 'goal-b', statement: 'Harden validation', status: 'PROPOSED', measures: [] },
        { id: 'goal-c', statement: 'Document the flow', status: 'PROPOSED', measures: [] },
      ],
      outcomes: [],
      stakeholders: [],
      measures: [],
      assumptions: [],
      ambiguities: [],
      constraints: [],
    },
    provenance: ['p6-orchestrator-test:mission'],
    created_at: formatRfc3339(now),
    status: 'ACTIVE',
  });
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
  return { clock, store, broker, fabric, graph, worker, reasoning, verifier, askQueue, gate, orchestrator, grant, mission };
}

describe('the three-lane journey (managed default, zero BYO)', () => {
  it('decomposes, dispatches 3 concurrent lanes on disjoint scopes, crashes+recovers one lane, verification-gates completion, and reports honestly', async () => {
    const w = world();
    await w.store.authorityGrants.put(w.grant);
    await w.store.missions.put(w.mission);

    // Zero BYO providers configured — the managed default serves.
    expect(w.reasoning.providers()).toHaveLength(1);

    const decomposition = await w.orchestrator.decomposeMission({ mission: w.mission, authority_ref: w.grant.envelope.id });
    expect(decomposition.plan).toHaveLength(3);
    expect(decomposition.plan.map((planned) => planned.owned_paths)).toEqual([['work/goal-a'], ['work/goal-b'], ['work/goal-c']]);
    expect(decomposition.broker_input!.non_authoritative).toBe(true);
    expect(decomposition.broker_input!.simulated).toBe(true);

    // The journey: crash the SECOND lane (index 1) before step 3.
    const report = await w.orchestrator.runToCompletion({ simulation: { crashes: { 1: 3 } } });
    expect(report.completed).toBe(true);
    expect(report.tasks).toHaveLength(3);
    for (const task of report.tasks) {
      expect(task.state).toBe('COMPLETED');
      expect(task.verification_ref).not.toBeNull();
      expect(task.workspace_revision.source_revision).not.toBeNull();
    }
    // The crashed lane recovered (1 retry) — never silently done.
    const crashed = report.tasks.find((task) => task.retries > 0);
    expect(crashed).toBeDefined();
    expect(crashed!.retries).toBe(1);

    // Three lanes dispatched concurrently (one tick, three dispatches).
    const dispatchTick = report.ticks.find((tick) => tick.dispatched.length === 3);
    expect(dispatchTick).toBeDefined();
    expect(new Set(dispatchTick!.dispatched.map((dispatch) => dispatch.lane)).size).toBe(3);
    expect(dispatchTick!.dispatched.every((dispatch) => dispatch.handoff.authority_ref === w.grant.envelope.id)).toBe(true);

    // Mission completion through the governed architect gate.
    const completion = await w.orchestrator.completeMission({
      mission_ref: w.mission.envelope.id,
      authority_ref: w.grant.envelope.id,
      rationale: 'every task verified-complete under stored authority',
    });
    expect(completion.completed).toBe(true);
    expect(completion.gate!.decision).toBe('APPROVED');
    expect(completion.gate!.authority_ref).toBe(w.grant.envelope.id);
    expect(completion.gate!.governed).toBe(true);
    expect(completion.reasoning!.provider_kind).toBe('managed');
    expect(completion.reasoning!.non_authoritative).toBe(true);
    expect(completion.simulated_markers.length).toBeGreaterThan(0);
    // The graph is structurally valid at the end of the journey.
    const scan = await w.graph.scan();
    expect(scan.valid).toBe(true);
  });

  it('determinism: the identical journey reproduces the identical report', async () => {
    const run = async () => {
      const w = world();
      await w.store.authorityGrants.put(w.grant);
      await w.store.missions.put(w.mission);
      await w.orchestrator.decomposeMission({ mission: w.mission, authority_ref: w.grant.envelope.id });
      const report = await w.orchestrator.runToCompletion({ simulation: { crashes: { 1: 3 } } });
      const completion = await w.orchestrator.completeMission({
        mission_ref: w.mission.envelope.id,
        authority_ref: w.grant.envelope.id,
        rationale: 'every task verified-complete under stored authority',
      });
      return JSON.stringify({ report, completion });
    };
    const first = await run();
    const second = await run();
    expect(first).toBe(second);
  });
});

describe('no silent bypass (typed violations naming the rule)', () => {
  it('refuses mission completion without COMPLETED tasks (a worker report never certifies)', async () => {
    const w = world();
    await w.store.authorityGrants.put(w.grant);
    await w.store.missions.put(w.mission);
    await w.orchestrator.decomposeMission({ mission: w.mission, authority_ref: w.grant.envelope.id });
    await expect(
      w.orchestrator.completeMission({ mission_ref: w.mission.envelope.id, authority_ref: w.grant.envelope.id, rationale: 'premature' }),
    ).rejects.toThrow(SilentBypassViolationError);
  });

  it('refuses a FORGED gate record (not in the governed decision log)', async () => {
    const w = world();
    await w.store.authorityGrants.put(w.grant);
    await w.store.missions.put(w.mission);
    await w.orchestrator.decomposeMission({ mission: w.mission, authority_ref: w.grant.envelope.id });
    await w.orchestrator.runToCompletion({});
    const forged = {
      gate_id: 'gate:deadbeefdeadbeefdeadbeef',
      transition: 'MISSION_COMPLETION',
      subject_ref: w.mission.envelope.id,
      authority_ref: w.grant.envelope.id,
      decision: 'APPROVED',
      rationale: 'forged approval',
      recorded_at: '2026-02-01T10:00:00.000Z',
      governed: true,
    };
    await expect(
      w.orchestrator.completeMission({
        mission_ref: w.mission.envelope.id,
        authority_ref: w.grant.envelope.id,
        rationale: 'attempting to complete with a forged gate record',
        gateRecord: forged,
      }),
    ).rejects.toThrow(/forged gate record authorizes nothing/);
  });

  it('the architect gate cannot mint authority (unresolvable authority is a typed violation)', async () => {
    const w = world();
    await w.store.authorityGrants.put(w.grant);
    await expect(
      w.gate.requestApproval({
        transition: 'DEPLOY',
        subject_ref: 'checkout-production',
        authority_ref: 'sos://AuthorityGrant/ffffffffffffffffffffffffffffffff',
        rationale: 'deploy under invented authority',
      }),
    ).rejects.toThrow(/cannot mint authority|not in the durable authority store/);
  });
});
