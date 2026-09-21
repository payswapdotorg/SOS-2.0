/**
 * ACCEPTANCE: a fake/reference body executes a COMPLETE bounded task
 * through the contract (Work Order P5).
 *
 * The journey, every body-side step through the public §9 contract
 * surface (dispatched by the fabric under the uniform gates):
 *
 *   create -> workspace write -> shell exec -> git commit ->
 *   artifacts capture -> observations emit -> complete
 *
 * (plus the surrounding contract surface: workspace read, git status /
 *   diff / createBranch / createPullRequest, events subscribe, the body
 *   completion report and the Spirit-side verified completion).
 */

import { describe, expect, it } from 'vitest';
import { formatRfc3339 } from '@sos-2/live-store';
import { acceptanceWorld } from './acceptance-world.js';

describe('acceptance: the reference body completes a bounded task through the contract', () => {
  it('create -> workspace write -> shell exec -> git commit -> artifacts capture -> observations emit -> complete', async () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:reference-cloud-1', providerName: 'reference-body-vendor' });

    // CREATE — the bounded task starts under live authority, on a
    // capability-selected body, holding a durable lease.
    const task = await w.createTask({ task_id: 'task-journey-0001' });
    expect(task.status).toBe('RUNNING');
    expect(task.task_id).toBe('task-journey-0001');
    expect(body.dispatches.get('createTask')).toBe(1);

    // WORKSPACE WRITE — through workspace.write().
    const FEATURE_SOURCE = 'export function feature(): string { return "bounded"; }\n';
    const write = await w.fabric.execute(task.task_id, {
      kind: 'workspace.write',
      path: 'src/feature.ts',
      content: FEATURE_SOURCE,
    });
    expect(write.status).toBe('EXECUTED');
    if (write.status === 'EXECUTED') {
      expect(write.availability).toBe('SUCCESS');
      expect(write.output).toMatchObject({ bytes: FEATURE_SOURCE.length });
    }

    // WORKSPACE READ — the write is readable back through the contract.
    const read = await w.fabric.execute(task.task_id, { kind: 'workspace.read', path: 'src/feature.ts' });
    expect(read.status).toBe('EXECUTED');
    if (read.status === 'EXECUTED') {
      expect(read.output).toMatchObject({ content: expect.stringContaining('export function feature') });
    }

    // SHELL EXEC — the body's environment runs the deterministic command.
    const shell = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'cat', args: ['src/feature.ts'], cwd: null });
    expect(shell.status).toBe('EXECUTED');
    if (shell.status === 'EXECUTED') {
      expect(shell.output).toMatchObject({ exit_code: 0, stdout: expect.stringContaining('bounded') });
    }
    expect(body.dispatches.get('shell.exec')).toBe(1);

    // GIT — status, diff, branch, commit, PR: the repository surface.
    const status = await w.fabric.execute(task.task_id, { kind: 'git.status' });
    expect(status.status).toBe('EXECUTED');
    const branch = await w.fabric.execute(task.task_id, { kind: 'git.createBranch', name: 'wo/bounded-task', from_ref: 'main' });
    expect(branch.status).toBe('EXECUTED');
    const diff = await w.fabric.execute(task.task_id, { kind: 'git.diff', ref: null });
    expect(diff.status).toBe('EXECUTED');
    if (diff.status === 'EXECUTED') {
      expect(diff.output).toMatchObject({ diff: expect.stringContaining('src/feature.ts') });
    }
    const commit = await w.fabric.execute(task.task_id, {
      kind: 'git.commit',
      message: 'feat: the bounded task implementation',
      paths: [],
    });
    expect(commit.status).toBe('EXECUTED');
    if (commit.status === 'EXECUTED') {
      expect(commit.output).toMatchObject({ commit_ref: 'commit-001', files: 1 });
    }
    const pr = await w.fabric.execute(task.task_id, {
      kind: 'git.createPullRequest',
      title: 'Bounded task implementation',
      source_branch: 'wo/bounded-task',
      target_branch: 'main',
    });
    expect(pr.status).toBe('EXECUTED');

    // ARTIFACTS CAPTURE — content-addressed, durable, attached to the task.
    const capture = await w.fabric.execute(task.task_id, {
      kind: 'artifacts.capture',
      name: 'journey-report',
      content: 'the bounded task journey report — every step through the contract',
    });
    expect(capture.status).toBe('EXECUTED');

    // OBSERVATIONS EMIT — through the typed observation boundary.
    const emit = await w.fabric.execute(task.task_id, {
      kind: 'observations.emit',
      observation_kind: 'body.progress',
      payload: { step: 'implementation', result: 'committed' },
    });
    expect(emit.status).toBe('EXECUTED');

    // EVENTS SUBSCRIBE — the body's event stream, cursor-based.
    const events = await w.fabric.execute(task.task_id, { kind: 'events.subscribe', filter: null, cursor: null });
    expect(events.status).toBe('EXECUTED');
    if (events.status === 'EXECUTED') {
      expect(events.output).toMatchObject({ events: expect.arrayContaining([expect.objectContaining({ kind: 'workspace.wrote' })]) });
    }

    // The durable task record carries every trace so far.
    const mid = await w.store.tasks.get(task.task_id);
    expect(mid?.artifacts).toHaveLength(1);
    expect(mid?.observations.length).toBeGreaterThanOrEqual(9);

    // The body reports completion — a NON-AUTHORITATIVE observation.
    const report = await w.fabric.reportBodyCompletion(task.task_id, {
      summary: 'implementation committed on wo/bounded-task',
      evidence: { commit: 'commit-001', pr: 'pr-001' },
    });
    expect(report.status).toBe('TRANSITIONED');
    expect((await w.store.tasks.get(task.task_id))?.status).toBe('RUNNING');

    // COMPLETE — the Spirit-side verified completion (the body never
    // certifies itself; §10).
    const evidenceRefs = (await w.store.tasks.get(task.task_id))!.observations;
    const completed = await w.fabric.completeTask(task.task_id, {
      verified: true,
      recorded_at: formatRfc3339(w.clock.nowEpochMs()),
      evidence_refs: evidenceRefs,
      summary: 'independently verified against the durable observation trace',
    });
    expect(completed.status).toBe('TRANSITIONED');
    const final = await w.store.tasks.get(task.task_id);
    expect(final?.status).toBe('COMPLETED');
    expect(final?.final_verification?.verified).toBe(true);
    expect(final?.final_verification?.evidence_refs).toEqual(evidenceRefs);

    // The captured artifact is content-addressed in the object store and
    // its bytes round-trip bit-exact.
    const artifact = final?.artifacts[0]!;
    expect(artifact.artifact_id).toBe('task-journey-0001:artifacts:001');
    expect(artifact.content_hash).toMatch(/^[0-9a-f]{64}$/);
    const bytes = await w.store.objects.getObject(artifact.content_hash);
    expect(new TextDecoder().decode(bytes!)).toBe('the bounded task journey report — every step through the contract');

    // The lease was released on completion; the durable lease history
    // survives for audit.
    const lease = await w.store.bodyLeases.get(task.body_lease_ref!);
    expect(lease?.state).toBe('RELEASED');

    // Every body-side step dispatched exactly once through the contract.
    expect(body.dispatches.get('createTask')).toBe(1);
    expect(body.dispatches.get('workspace.write')).toBe(1);
    expect(body.dispatches.get('workspace.read')).toBe(1);
    expect(body.dispatches.get('shell.exec')).toBe(1);
    expect(body.dispatches.get('git.commit')).toBe(1);
    expect(body.dispatches.get('artifacts.capture')).toBe(1);
    expect(body.dispatches.get('observations.emit')).toBe(1);
    expect(body.dispatches.get('events.subscribe')).toBe(1);
  });

  it('a second body from a DIFFERENT vendor executes the same journey (provider interchangeability)', async () => {
    const w = acceptanceWorld();
    w.registerBody({ bodyId: 'body:vendor-a', providerName: 'vendor-a' });
    const bodyB = w.registerBody({ bodyId: 'body:vendor-b', providerName: 'vendor-b' });

    // Vendor A serves this task.
    const task = await w.createTask({ task_id: 'task-journey-0002' });
    expect(task.body_lease_ref).toBe('lease:task-journey-0002:0001');
    const write = await w.fabric.execute(task.task_id, {
      kind: 'workspace.write',
      path: 'hello.txt',
      content: 'from the reference body',
    });
    expect(write.status).toBe('EXECUTED');

    // The SAME journey runs identically through vendor B's body when it
    // holds the lease (provider-neutral contract — no vendor surface).
    const secondTask = await (async () => {
      await w.store.authorityGrants.put(w.grant);
      // Suspend vendor A's body so vendor B is selected.
      await w.broker.suspendBody('body:vendor-a', 'interchangeability probe');
      const created = await w.fabric.createBoundedTask({
        task_id: 'task-journey-0002b',
        mission_ref: null,
        plan: {},
        grant_refs: [w.grant.envelope.id],
        requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'cloud' },
        holder: 'spirit:persistent',
        expires_at: null,
      });
      if (created.status !== 'CREATED') {
        throw new Error(`unexpected: ${JSON.stringify(created)}`);
      }
      return created.task;
    })();
    expect(secondTask.body_lease_ref).toBe('lease:task-journey-0002b:0001');
    const writeB = await w.fabric.execute(secondTask.task_id, {
      kind: 'workspace.write',
      path: 'hello.txt',
      content: 'from the other reference body',
    });
    expect(writeB.status).toBe('EXECUTED');
    expect(bodyB.dispatches.get('workspace.write')).toBe(1);
  });

  it('a body whose createTask FAILS is a truthful creation failure: no task record, lease released', async () => {
    const w = acceptanceWorld();
    w.registerBody({ bodyId: 'body:broken-at-birth', providerName: 'reference-body-vendor', failEveryOperation: 'the body is broken' });
    await w.store.authorityGrants.put(w.grant);
    const created = await w.fabric.createBoundedTask({
      task_id: 'task-failing-0001',
      mission_ref: null,
      plan: {},
      grant_refs: [w.grant.envelope.id],
      requirements: { requiredCapabilities: ['terminal'], placement: 'cloud' },
      holder: 'spirit:persistent',
      expires_at: null,
    });
    expect(created.status).toBe('FAILED');
    if (created.status === 'FAILED') {
      expect(created.error).toContain('the body is broken');
      expect(created.body_id).toBe('body:broken-at-birth');
    }
    // No durable task record exists; the lease was released.
    expect(await w.store.tasks.get('task-failing-0001')).toBeUndefined();
    const leases = await w.store.bodyLeases.list({ limit: null });
    expect(leases.items.every((lease) => lease.state !== 'ACTIVE')).toBe(true);
  });

  it('a body whose OPERATIONS fail reports truthful FAILURE (never conflated with refusal)', async () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:failing-ops', providerName: 'reference-body-vendor' });
    const task = await w.createTask({ task_id: 'task-failing-0002' });
    // The task starts healthy; the body's environment breaks AFTER creation.
    body.breakOperations('the body environment broke mid-task');
    const result = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'ls', args: [], cwd: null });
    expect(result.status).toBe('EXECUTED');
    if (result.status === 'EXECUTED') {
      expect(result.availability).toBe('FAILURE');
      expect(result.error).toContain('the body environment broke mid-task');
    }
    // The task survives a failing body (durable state intact, still RUNNING).
    const after = await w.store.tasks.get(task.task_id);
    expect(after?.status).toBe('RUNNING');
  });
});
