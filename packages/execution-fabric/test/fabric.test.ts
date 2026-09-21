/**
 * Execution fabric unit tests (Work Order P5): the uniform gate pipeline
 * (task -> lease -> authority -> advertisement -> dispatch), durable task
 * state via the P2 repositories, the observation boundary, and the
 * negative authority surface (a body can neither mint nor widen
 * authority). The end-to-end acceptance journeys live in
 * tests/harness-contracts.
 */

import { describe, expect, it } from 'vitest';
import { createGrant, revokeGrant } from '@sos-2/authority';
import { ManualClock, createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import type { TaskRecord } from '@sos-2/live-store';
import { BodyBroker } from '@sos-2/body-broker';
import { ExecutionFabric } from '../src/index.js';
import type { FabricOperation } from '../src/index.js';
import { FakeBody } from './helpers.js';

const T0 = Date.parse('2026-01-15T09:00:00Z');

function liveGrant(expiresAtEpochMs: number): ReturnType<typeof createGrant> {
  return createGrant({
    grantee: 'spirit:persistent',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['READ', 'REVISE'],
    expiry: { kind: 'TIME', at: formatRfc3339(expiresAtEpochMs) },
    provenance: ['p5-fabric-test'],
    created_at: formatRfc3339(T0),
    status: 'ACTIVE',
  });
}

interface FabricWorld {
  clock: ManualClock;
  fabric: ExecutionFabric;
  broker: BodyBroker;
  body: FakeBody;
  grant: ReturnType<typeof createGrant>;
  store: ReturnType<typeof createInMemoryLiveStore>;
}

function world(options: { grantExpiresAt?: number } = {}): FabricWorld {
  const clock = new ManualClock(T0);
  const store = createInMemoryLiveStore({ clock });
  const broker = new BodyBroker({ leases: store.bodyLeases, clock });
  const body = new FakeBody({ bodyId: 'body:fake-cloud-1', providerName: 'fake-body-vendor' });
  broker.registerBody({
    body_id: 'body:fake-cloud-1',
    provider: { name: 'fake-body-vendor', version: '1.0.0' },
    capabilities: body.capabilitiesValue,
    placement: 'cloud',
    harness: body,
  });
  const fabric = new ExecutionFabric({
    tasks: store.tasks,
    authorityGrants: store.authorityGrants,
    observationEvents: store.observationEvents,
    objects: store.objects,
    broker,
    clock,
  });
  const grant = liveGrant(options.grantExpiresAt ?? T0 + 3_600_000);
  return { clock, fabric, broker, body, grant, store };
}

async function createTask(w: FabricWorld, taskId = 'task-0001'): Promise<TaskRecord> {
  await w.store.authorityGrants.put(w.grant);
  const created = await w.fabric.createBoundedTask({
    task_id: taskId,
    mission_ref: `sos://Mission/${'a'.repeat(32)}`,
    plan: { steps: ['write', 'exec', 'commit'] },
    grant_refs: [w.grant.envelope.id],
    requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'cloud' },
    holder: 'execution-fabric-test',
    expires_at: null,
  });
  if (created.status !== 'CREATED') {
    throw new Error(`task creation failed: ${JSON.stringify(created)}`);
  }
  return created.task;
}

describe('bounded task creation (authority-gated before any body is summoned)', () => {
  it('creates the durable §6 task record bound to a lease and a body', async () => {
    const w = world();
    const task = await createTask(w);
    expect(task.status).toBe('RUNNING');
    expect(task.task_id).toBe('task-0001');
    expect(task.mission_ref).toBe(`sos://Mission/${'a'.repeat(32)}`);
    expect(task.body_lease_ref).toBe('lease:task-0001:0001');
    expect(task.authority_context.grant_refs).toEqual([w.grant.envelope.id]);
    expect(task.observations).toEqual(['fabric-obs:task-0001:000001']);
    // The creation observation is durable in the event store.
    const event = await w.store.observationEvents.get('fabric-obs:task-0001:000001');
    expect(event?.kind).toBe('task.created');
    expect(event?.payload).toMatchObject({ body_id: 'body:fake-cloud-1' });
  });

  it('refuses creation under an EXPIRED grant (fail closed)', async () => {
    const w = world({ grantExpiresAt: T0 - 60_000 }); // already expired at the creation instant
    await w.store.authorityGrants.put(w.grant);
    const created = await w.fabric.createBoundedTask({
      task_id: 'task-dead',
      mission_ref: null,
      plan: {},
      grant_refs: [w.grant.envelope.id],
      requirements: { requiredCapabilities: ['terminal'], placement: 'cloud' },
      holder: 'test',
      expires_at: null,
    });
    expect(created.status).toBe('DENIED');
    if (created.status === 'DENIED') {
      expect(created.denial.code).toBe('AUTHORITY_GRANT_EXPIRED');
    }
    expect(await w.store.tasks.get('task-dead')).toBeUndefined();
  });

  it('refuses creation when no body matches the requirements (typed NO_BODY_AVAILABLE)', async () => {
    const w = world();
    await w.store.authorityGrants.put(w.grant);
    const created = await w.fabric.createBoundedTask({
      task_id: 'task-nobody',
      mission_ref: null,
      plan: {},
      grant_refs: [w.grant.envelope.id],
      requirements: { requiredCapabilities: ['browser-ui'], placement: 'user-device' },
      holder: 'test',
      expires_at: null,
    });
    expect(created.status).toBe('DENIED');
    if (created.status === 'DENIED') {
      expect(created.denial.code).toBe('NO_BODY_AVAILABLE');
    }
  });

  it('refuses a mission_ref that is not a spine artifact id (vendor identity is never semantic identity)', async () => {
    const w = world();
    await w.store.authorityGrants.put(w.grant);
    const created = await w.fabric.createBoundedTask({
      task_id: 'task-badref',
      mission_ref: 'body:fake-cloud-1',
      plan: {},
      grant_refs: [w.grant.envelope.id],
      requirements: { requiredCapabilities: ['terminal'], placement: 'cloud' },
      holder: 'test',
      expires_at: null,
    });
    expect(created.status).toBe('DENIED');
    if (created.status === 'DENIED') {
      expect(created.denial.code).toBe('INVALID_TASK_INPUT');
      expect(created.denial.reason).toContain('NEVER a semantic identity');
    }
  });

  it('task ids are single-use (a durable record under the id refuses re-creation)', async () => {
    const w = world();
    await createTask(w, 'task-once');
    await w.store.authorityGrants.put(w.grant);
    const again = await w.fabric.createBoundedTask({
      task_id: 'task-once',
      mission_ref: null,
      plan: {},
      grant_refs: [w.grant.envelope.id],
      requirements: { requiredCapabilities: ['terminal'], placement: 'cloud' },
      holder: 'test',
      expires_at: null,
    });
    expect(again.status).toBe('DENIED');
    if (again.status === 'DENIED') {
      expect(again.denial.code).toBe('INVALID_TASK_INPUT');
    }
  });
});

describe('the uniform operation gates (task -> lease -> authority -> advertisement -> dispatch)', () => {
  it('executes a shell operation through the contract and records the durable trace', async () => {
    const w = world();
    const task = await createTask(w);
    const result = await w.fabric.execute(task.task_id, {
      kind: 'shell.exec',
      command: 'echo',
      args: ['hello'],
      cwd: null,
    });
    expect(result.status).toBe('EXECUTED');
    if (result.status === 'EXECUTED') {
      expect(result.availability).toBe('SUCCESS');
      expect(result.output).toMatchObject({ exit_code: 0, stdout: 'echo hello' });
      expect(w.body.shellDispatches).toBe(1);
      // The operation trace is durable; the task record references it.
      const event = await w.store.observationEvents.get(result.observation_id);
      expect(event?.kind).toBe('fabric.operation:shell.exec');
      expect(event?.provenance).toContain('body:body:fake-cloud-1');
      const updated = await w.store.tasks.get('task-0001');
      expect(updated?.observations).toContain(result.observation_id);
      expect(updated?.revision).toBe(2);
    }
  });

  it('an unadvertised operation is explicitly UNSUPPORTED (never silent, never dispatched)', async () => {
    const w = world();
    const task = await createTask(w);
    const result = await w.fabric.execute(task.task_id, { kind: 'browser.open', url: 'https://example.invalid' });
    expect(result.status).toBe('UNSUPPORTED');
    if (result.status === 'UNSUPPORTED') {
      expect(result.operation).toBe('browser.open');
      expect(result.reason).toContain('advertisement');
    }
  });

  it('LEASE FAILS CLOSED: an expired lease denies and the body NEVER dispatches', async () => {
    const w = world();
    const task = await createTask(w);
    w.clock.advance(3_600_001); // past the grant AND the default lease (lease is non-expiring here — use a lease expiry)
    // The task's lease is non-expiring; instead simulate expiry with an expiring lease task.
    const w2 = world();
    await w2.store.authorityGrants.put(w2.grant);
    const created = await w2.fabric.createBoundedTask({
      task_id: 'task-leased',
      mission_ref: null,
      plan: {},
      grant_refs: [w2.grant.envelope.id],
      requirements: { requiredCapabilities: ['terminal'], placement: 'cloud' },
      holder: 'test',
      expires_at: formatRfc3339(T0 + 60_000),
    });
    expect(created.status).toBe('CREATED');
    w2.clock.advance(61_000);
    const result = await w2.fabric.execute('task-leased', { kind: 'shell.exec', command: 'ls', args: [], cwd: null });
    expect(result.status).toBe('DENIED');
    if (result.status === 'DENIED') {
      expect(result.denial.code).toBe('LEASE_DENIED');
    }
    expect(w2.body.shellDispatches).toBe(0);
  });

  it('AUTHORITY FAILS CLOSED: a grant revoked mid-task denies the next operation (run-flag proof)', async () => {
    const w = world();
    const task = await createTask(w);
    // First operation runs under the live grant.
    expect((await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'ls', args: [], cwd: null })).status).toBe('EXECUTED');
    expect(w.body.shellDispatches).toBe(1);
    // Revoke mid-task: the successor revision lands in the durable store.
    const revoked = revokeGrant(w.grant, {
      at: { kind: 'TIME', now: formatRfc3339(w.clock.nowEpochMs()) },
      provenance: ['mid-task revocation test'],
      created_at: formatRfc3339(w.clock.nowEpochMs()),
    });
    await w.store.authorityGrants.put(revoked);
    const denied = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'ls', args: [], cwd: null });
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('AUTHORITY_GRANT_REVOKED');
    }
    // The operation NEVER ran.
    expect(w.body.shellDispatches).toBe(1);
    // The denial is a durable observation (refusing-to-run is a recorded fact).
    expect(denied.observation_id).not.toBeNull();
  });

  it('a grant that expires mid-task denies the next operation', async () => {
    const w = world({ grantExpiresAt: T0 + 120_000 });
    const task = await createTask(w);
    w.clock.advance(121_000);
    const denied = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'ls', args: [], cwd: null });
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('AUTHORITY_GRANT_EXPIRED');
    }
    expect(w.body.shellDispatches).toBe(0);
  });

  it('an unknown task denies with TASK_NOT_FOUND (no observation, no dispatch)', async () => {
    const w = world();
    const result = await w.fabric.execute('task-ghost', { kind: 'git.status' });
    expect(result.status).toBe('DENIED');
    if (result.status === 'DENIED') {
      expect(result.denial.code).toBe('TASK_NOT_FOUND');
      expect(result.observation_id).toBeNull();
    }
  });

  it('a PAUSED task does not execute operations', async () => {
    const w = world();
    const task = await createTask(w);
    const paused = await w.fabric.pauseTask(task.task_id);
    expect(paused.status).toBe('TRANSITIONED');
    const denied = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'ls', args: [], cwd: null });
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('TASK_NOT_ACTIVE');
    }
    const resumed = await w.fabric.resumeTask(task.task_id);
    expect(resumed.status).toBe('TRANSITIONED');
    const after = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'ls', args: [], cwd: null });
    expect(after.status).toBe('EXECUTED');
  });
});

describe('a body can neither mint nor widen authority', () => {
  it('an operation request carrying an injected grant is typed-rejected (OPERATION_INVALID)', async () => {
    const w = world();
    const task = await createTask(w);
    const forged = liveGrant(T0 + 999_999_999) as unknown as Record<string, unknown>;
    const smuggled = {
      kind: 'shell.exec',
      command: 'rm',
      args: ['-rf', '/'],
      cwd: null,
      grant: forged,
    } as unknown as FabricOperation;
    const result = await w.fabric.execute(task.task_id, smuggled);
    expect(result.status).toBe('DENIED');
    if (result.status === 'DENIED') {
      expect(result.denial.code).toBe('OPERATION_INVALID');
      expect(result.denial.reason).toContain('NO authority');
      expect(result.denial.reason).toContain('"grant"');
    }
    expect(w.body.shellDispatches).toBe(0);
  });

  it('a forged grant reference that is not in the durable store authorizes nothing', async () => {
    const w = world();
    const task = await createTask(w);
    // Re-point the durable task's authority context at a forged reference
    // (the attacker-controlled write path): the fabric still resolves the
    // CURRENT grant from the store and denies on the missing reference.
    const current = await w.store.tasks.get(task.task_id);
    const tampered: TaskRecord = {
      ...current!,
      authority_context: { grant_refs: [`sos://AuthorityGrant/${'e'.repeat(32)}`], notes: 'tampered' },
      revision: current!.revision + 1,
    };
    await w.store.tasks.put(tampered);
    const result = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'ls', args: [], cwd: null });
    expect(result.status).toBe('DENIED');
    if (result.status === 'DENIED') {
      expect(result.denial.code).toBe('AUTHORITY_GRANT_MISSING');
    }
    expect(w.body.shellDispatches).toBe(0);
  });

  it('a body-emitted forged grant rides only as an OPAQUE observation payload — the task authority never changes', async () => {
    const w = world();
    const task = await createTask(w);
    const forgedGrant = liveGrant(T0 + 999_999_999);
    const result = await w.fabric.execute(task.task_id, {
      kind: 'observations.emit',
      observation_kind: 'body.progress',
      payload: { note: 'look how authorized I am', forged_grant: { envelope: forgedGrant.envelope, content: forgedGrant.content } },
    });
    expect(result.status).toBe('EXECUTED');
    // The observation boundary preserved the payload VERBATIM (opaque,
    // pre-semantic input) — but the task's authority context is untouched.
    const after = await w.store.tasks.get(task.task_id);
    expect(after?.authority_context.grant_refs).toEqual([w.grant.envelope.id]);
    // And the forged grant does not authorize anything: it is not in the
    // durable authority store.
    expect(await w.store.authorityGrants.get(forgedGrant.envelope.id)).toBeUndefined();
  });
});

describe('completion discipline (§10): a body reports, only the Spirit completes', () => {
  it('a body completion report is a NON-AUTHORITATIVE observation and never completes the task', async () => {
    const w = world();
    const task = await createTask(w);
    const report = await w.fabric.reportBodyCompletion(task.task_id, {
      summary: 'I believe the mission is complete',
      evidence: { tests: 'all green (trust me)' },
    });
    expect(report.status).toBe('TRANSITIONED');
    const after = await w.store.tasks.get(task.task_id);
    expect(after?.status).toBe('RUNNING'); // NOT completed
    expect(after?.final_verification).toBeNull();
    const event = await w.store.observationEvents.get(report.status === 'TRANSITIONED' ? report.observation_id : '');
    expect(event?.kind).toBe('task.body-completion-report');
    expect(event?.source).toBe('body:body:fake-cloud-1');
    expect((event?.payload as Record<string, unknown>)['non_authoritative']).toBe(true);
  });

  it('completeTask requires the Spirit-side verification record and completes the task', async () => {
    const w = world();
    const task = await createTask(w);
    await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'ls', args: [], cwd: null });
    await w.fabric.reportBodyCompletion(task.task_id, { summary: 'done', evidence: null });
    const completed = await w.fabric.completeTask(task.task_id, {
      verified: true,
      recorded_at: formatRfc3339(w.clock.nowEpochMs()),
      evidence_refs: ['fabric-obs:task-0001:000001', 'fabric-obs:task-0001:000002'],
      summary: 'independently verified against the durable trace',
    });
    expect(completed.status).toBe('TRANSITIONED');
    const after = await w.store.tasks.get(task.task_id);
    expect(after?.status).toBe('COMPLETED');
    expect(after?.final_verification?.verified).toBe(true);
    // The lease was released on completion.
    const lease = await w.store.bodyLeases.get(task.body_lease_ref!);
    expect(lease?.state).toBe('RELEASED');
  });

  it('operations on a COMPLETED task deny (TASK_NOT_ACTIVE)', async () => {
    const w = world();
    const task = await createTask(w);
    await w.fabric.completeTask(task.task_id, {
      verified: true,
      recorded_at: formatRfc3339(w.clock.nowEpochMs()),
      evidence_refs: [],
      summary: null,
    });
    const denied = await w.fabric.execute(task.task_id, { kind: 'git.status' });
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('TASK_NOT_ACTIVE');
    }
  });
});

describe('durable artifacts and checkpoints', () => {
  it('artifacts.capture persists content-addressed objects and attaches the record', async () => {
    const w = world();
    const task = await createTask(w);
    const result = await w.fabric.execute(task.task_id, {
      kind: 'artifacts.capture',
      name: 'report',
      content: 'the completion report content',
    });
    expect(result.status).toBe('EXECUTED');
    const after = await w.store.tasks.get(task.task_id);
    expect(after?.artifacts).toHaveLength(1);
    const artifact = after?.artifacts[0]!;
    expect(artifact.artifact_id).toBe('task-0001:artifacts:001');
    expect(artifact.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.object_ref).toMatch(/^r2:\/\//);
    // The object store holds the captured bytes.
    const bytes = await w.store.objects.getObject(artifact.content_hash);
    expect(bytes !== null && new TextDecoder().decode(bytes)).toBe('the completion report content');
  });

  it('observations.emit lands in the typed observation boundary under the body source', async () => {
    const w = world();
    const task = await createTask(w);
    const result = await w.fabric.execute(task.task_id, {
      kind: 'observations.emit',
      observation_kind: 'body.progress',
      payload: { step: 1, note: 'workspace prepared' },
    });
    expect(result.status).toBe('EXECUTED');
    const after = await w.store.tasks.get(task.task_id);
    // Two observations landed: the body emission + the fabric trace.
    expect(after?.observations).toHaveLength(3); // creation + body emission + op trace
    const bodyEvent = await w.store.observationEvents.get(after!.observations[1]!);
    expect(bodyEvent?.source).toBe('body:body:fake-cloud-1');
    expect(bodyEvent?.kind).toBe('body.progress');
    expect(bodyEvent?.payload).toEqual({ step: 1, note: 'workspace prepared' });
  });

  it('recordCheckpoint appends a durable, CAS-guarded checkpoint', async () => {
    const w = world();
    const task = await createTask(w);
    const checkpoint = await w.fabric.recordCheckpoint(task.task_id, {
      label: 'after-workspace-write',
      work_graph_state: { steps: ['write'], done: ['write'] },
      notes: null,
    });
    expect(checkpoint.status).toBe('TRANSITIONED');
    const after = await w.store.tasks.get(task.task_id);
    expect(after?.checkpoints).toHaveLength(1);
    expect(after?.checkpoints[0]?.checkpoint_id).toBe('cp-0001');
  });
});
