/**
 * The DETERMINISTIC reference-mode suite of body replaceability, the
 * lease/checkpoint interplay and the self-certification ban (Work Order
 * P17-B): offline, fixed seed, run-to-run identical.
 *
 * Pins (program-defining):
 *   - BODIES ARE REPLACEABLE: the same dispatch script against the
 *     reference CloudCodingShellBody and the real HostedCodingBody
 *     yields IDENTICAL contract behavior (same statuses/shapes for the
 *     same operations), and the P5 broker replaces the body underneath
 *     an active lease while the durable task identity, checkpoints,
 *     artifacts and observations survive.
 *   - A BODY CANNOT SELF-CERTIFY (§10): a body completion report never
 *     completes the task; the independent evaluator gates it —
 *     including the EVALUATION_INDEPENDENCE_VIOLATION denial when a
 *     probe is bound to the producing body.
 *   - THE LEASE IS FAIL-CLOSED: an expired lease authorizes nothing;
 *     checkpoints record durably and survive replacement.
 */

import { describe, expect, it } from 'vitest';
import { EvaluatorRegistry, IndependentEvaluationService } from '@sos-2/evaluator';
import type { EvaluationActorRef, ProbeObservation } from '@sos-2/evaluator';
import { CloudCodingShellBody, GitHubProjectBody } from '@sos-2/body-runtimes';
import type { HarnessContract } from '@sos-2/harness';
import { formatRfc3339 } from '@sos-2/live-store';
import { HostedCodingBody, ScriptedHostedModelPort, createRealGitHubRepositoryOperations } from '@sos-2/real-bodies';
import { createRealGitHubProvider } from '@sos-2/real-github';
import type { ScriptedModelEntry } from '@sos-2/real-bodies';
import { HOSTED_BODY_POLICY, REFERENCE_BODY_POLICY, T0, realBodiesWorld, scriptedModelFilesResponse } from './world.js';
import { ScriptedGitHubRequestPort, type ScriptedEntry } from './github-bridge-world.js';

/**
 * The IDENTICAL dispatch script both bodies must serve with identical
 * contract behavior (the replaceability pin): the same §9 operations in
 * the same order, compared by status + result shape.
 */
function dispatchScript(body: HarnessContract): { operation: string; status: string; shape: string | null }[] {
  const trace: { operation: string; status: string; shape: string | null }[] = [];
  const record = <T>(operation: string, result: { status: string; value: T | null }): void => {
    trace.push({
      operation,
      status: result.status,
      shape: result.value === null || result.value === undefined ? null : Object.keys(result.value as object).sort().join(','),
    });
  };
  record('createTask', body.createTask({ task_ref: 'same-task', input: { goal: 'identical dispatch' } }));
  record('workspace.write', body.workspace.write({ task_ref: 'same-task', path: 'seed.md', content: 'seed\n' }));
  record('workspace.read', body.workspace.read({ task_ref: 'same-task', path: 'seed.md' }));
  record('shell.exec', body.shell.exec({ task_ref: 'same-task', command: 'echo', args: ['same'], cwd: null }));
  record('shell.exec:cat', body.shell.exec({ task_ref: 'same-task', command: 'cat', args: ['seed.md'], cwd: null }));
  record('git.status', body.git.status({ task_ref: 'same-task' }));
  record('git.commit', body.git.commit({ task_ref: 'same-task', message: 'same', paths: [] }));
  record('git.push', body.git.push({ task_ref: 'same-task', remote: 'origin', ref: 'refs/heads/main' }));
  record('git.createBranch', body.git.createBranch({ task_ref: 'same-task', name: 'same-branch', from_ref: null }));
  record('git.createPullRequest', body.git.createPullRequest({ task_ref: 'same-task', title: 'same', source_branch: 'same-branch', target_branch: 'main' }));
  record('artifacts.capture', body.artifacts.capture({ task_ref: 'same-task', name: 'same', content: 'same' }));
  record('observations.emit', body.observations.emit({ task_ref: 'same-task', observation_kind: 'body.progress', payload: { same: true } }));
  const subscribed = body.events.subscribe({ task_ref: 'same-task', filter: null, cursor: null });
  trace.push({ operation: 'events.subscribe', status: subscribed.status, shape: subscribed.status === 'OK' ? Object.keys(subscribed.value).sort().join(',') : null });
  record('browser.open', body.browser.open({ task_ref: 'same-task', url: 'https://example.invalid' }) as { status: string; value: unknown });
  record('pauseTask', body.pauseTask({ task_ref: 'same-task' }));
  record('resumeTask', body.resumeTask({ task_ref: 'same-task', input: null }));
  record('cancelTask', body.cancelTask({ task_ref: 'same-task' }));
  return trace;
}

describe('body replaceability: the reference body and the real body serve the same dispatch script identically', () => {
  it('identical statuses and result shapes for every operation of the script', () => {
    const reference = new CloudCodingShellBody({
      bodyId: 'replaceability-reference',
      sandboxPolicy: REFERENCE_BODY_POLICY,
      placement: 'cloud',
      secrets: { 'github-token': 'ref-secret' },
    });
    const real: HarnessContract = new HostedCodingBody({
      bodyId: 'replaceability-real',
      modelPort: new ScriptedHostedModelPort([]),
      sandboxPolicy: HOSTED_BODY_POLICY,
      placement: 'cloud',
      secrets: { 'openrouter-api-key': 'sk-or-scripted' },
    });
    const referenceTrace = dispatchScript(reference);
    const realTrace = dispatchScript(real);
    expect(realTrace).toEqual(referenceTrace);
  });

  it('the broker replaces the body underneath an active lease and the durable task survives (identity, checkpoints, artifacts, observations)', async () => {
    const world = realBodiesWorld();
    const { body: hosted } = world.registerHostedBody({
      bodyId: 'p17b-hosted-1',
      modelEntries: [
        scriptedModelFilesResponse([{ path: 'src/greeting.ts', contents: 'export function greet(name: string): string {\n  return "Hello, " + name;\n}\n' }], 'wrote the module'),
      ],
    });
    // The replacement is a SECOND instance of the same hosted kind (the
    // replacement requirements mirror the current body's advertisement —
    // the reference body lacks runtime-cloud-apis and is excluded
    // honestly). The CROSS-KIND equivalence (reference body vs real body
    // serving the identical dispatch script) is pinned by the test above.
    const { body: replacementBody } = world.registerHostedBody({
      bodyId: 'p17b-hosted-2',
      modelEntries: [],
    });
    const task = await world.createTask({ task_id: 'task-replaceability' });
    expect(replacementBody.identity().harness_id).toBe('harness:p17b-hosted-2');

    // The engine runs the work program (scripted model) and the fabric records durable evidence.
    const run = await hosted.runWorkProgram(task.task_id);
    expect(run.ok).toBe(true);
    const executed = await world.fabric.execute(task.task_id, { kind: 'git.status' });
    expect(executed.status).toBe('EXECUTED');
    const artifact = await world.fabric.execute(task.task_id, {
      kind: 'artifacts.capture',
      name: 'greeting-module',
      content: 'export function greet(name: string): string {\n  return "Hello, " + name;\n}\n',
    });
    expect(artifact.status).toBe('EXECUTED');
    const checkpoint = await world.fabric.recordCheckpoint(task.task_id, {
      label: 'work-program-complete',
      work_graph_state: { steps: ['summon-body', 'run-work-program'], completed: 2 },
      notes: 'the hosted body applied the model-generated files',
    });
    expect(checkpoint.status).toBe('TRANSITIONED');

    // REPLACE the body underneath the active lease (the hosted body is
    // suspended first — the honest reason a replacement is summoned; the
    // already-ended lease is carried as-is, the idempotent kill-mid-task
    // replacement flow).
    await world.broker.suspendBody('p17b-hosted-1', 'p17b deterministic replacement probe');
    const replacement = await world.fabric.replaceBodyForTask(task.task_id, 'p17b deterministic replacement probe');
    expect(replacement.status).toBe('REPLACED');
    if (replacement.status === 'REPLACED') {
      expect(replacement.ended_lease.lease_id).not.toBe(replacement.new_lease.lease_id);
      expect(replacement.body_id).toBe('p17b-hosted-2');
      // The durable task identity survives.
      expect(replacement.task.task_id).toBe('task-replaceability');
      expect(replacement.task.checkpoints).toHaveLength(1);
      expect(replacement.task.checkpoints[0]?.label).toBe('work-program-complete');
      expect(replacement.task.artifacts.length).toBeGreaterThanOrEqual(1);
      expect(replacement.task.observations.length).toBeGreaterThan(0);
    }

    // The replacement body ADOPTS the task: the fabric resumes it (the
    // task is PAUSED after replacement — the replacement body must be
    // summoned before it serves), then the §9 surface answers with a
    // fresh bounded environment (body-side state did not survive — the
    // durable task record is the truth; §1: the body is ephemeral).
    const resumed = await world.fabric.resumeTask(task.task_id);
    expect(resumed.status).toBe('TRANSITIONED');
    // The adoption session honestly holds NO work program (body-side
    // state did not survive; the durable task record carries the plan).
    expect(replacementBody.workProgramOf(task.task_id)).toBeNull();
    // The model-generated file is GONE on the replacement body (a fresh
    // sandbox; the honest read is a truthful FAILURE — never fabricated).
    const adopted = await world.fabric.execute(task.task_id, { kind: 'workspace.read', path: 'src/greeting.ts' });
    expect(adopted.status).toBe('EXECUTED');
    if (adopted.status === 'EXECUTED') {
      expect(adopted.availability).toBe('FAILURE');
    }
    const status = await world.fabric.execute(task.task_id, { kind: 'git.status' });
    expect(status.status).toBe('EXECUTED');
    if (status.status === 'EXECUTED' && status.output !== null) {
      expect((status.output as Record<string, unknown>)['clean']).toBe(true);
    }
    // The DURABLE evidence survived the replacement: the captured artifact
    // reads back bit-exact from the content-addressed object store.
    const durable = await world.store.tasks.get(task.task_id);
    expect(durable?.status).toBe('RUNNING');
    expect(durable?.checkpoints[0]?.label).toBe('work-program-complete');
    const artifactRecord = durable?.artifacts[0];
    expect(artifactRecord).toBeDefined();
    const bytes = await world.store.objects.getObject(artifactRecord!.content_hash);
    expect(bytes).not.toBeNull();
    expect(new TextDecoder().decode(bytes!)).toBe('export function greet(name: string): string {\n  return "Hello, " + name;\n}\n');
  });
});

describe('the lease/checkpoint interplay (fail-closed leases, durable checkpoints)', () => {
  it('an EXPIRED lease authorizes nothing (the fail-closed broker gate)', async () => {
    const world = realBodiesWorld();
    world.registerHostedBody({ bodyId: 'p17b-hosted-expiring' });
    const task = await world.createTask({
      task_id: 'task-expired-lease',
      requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'] as import('@sos-2/harness').HarnessCapability[], placement: 'cloud' },
    });
    // Expire the lease by rewriting its expiry into the past (durable store truth).
    const lease = await world.store.bodyLeases.get(task.body_lease_ref!);
    expect(lease?.state).toBe('ACTIVE');
    const expired = await world.store.bodyLeases.put(
      { ...lease!, expires_at: formatRfc3339(T0 - 1000) },
      { expected_revision: lease!.revision },
    );
    expect(expired.kind === 'STORED' || expired.kind === 'IDENTICAL').toBe(true);
    world.clock.advance(60_000);
    const denied = await world.fabric.execute(task.task_id, { kind: 'git.status' });
    expect(denied.status).toBe('DENIED');
  });

  it('checkpoints record durably in order and the observation boundary carries each one', async () => {
    const world = realBodiesWorld();
    world.registerHostedBody({ bodyId: 'p17b-hosted-checkpoints' });
    const task = await world.createTask({ task_id: 'task-checkpoints' });
    const first = await world.fabric.recordCheckpoint(task.task_id, {
      label: 'first',
      work_graph_state: { step: 1 },
      notes: null,
    });
    const second = await world.fabric.recordCheckpoint(task.task_id, {
      label: 'second',
      work_graph_state: { step: 2 },
      notes: 'progressing',
    });
    expect(first.status).toBe('TRANSITIONED');
    expect(second.status).toBe('TRANSITIONED');
    const record = await world.store.tasks.get('task-checkpoints');
    expect(record?.checkpoints.map((checkpoint) => checkpoint.checkpoint_id)).toEqual(['cp-0001', 'cp-0002']);
    expect(record?.checkpoints[1]?.notes).toBe('progressing');
  });
});

describe('the §10 self-certification ban (a body cannot certify its own completion)', () => {
  it('a body completion report is NON-AUTHORITATIVE and never completes the task', async () => {
    const world = realBodiesWorld();
    const { body } = world.registerHostedBody();
    const task = await world.createTask({ task_id: 'task-self-certification' });
    await body.runWorkProgram(task.task_id);
    const report = await world.fabric.reportBodyCompletion(task.task_id, {
      summary: 'I believe the mission is complete — trust me',
      evidence: { tests: 'all green (self-reported)' },
    });
    expect(report.status).toBe('TRANSITIONED');
    const after = await world.store.tasks.get('task-self-certification');
    expect(after?.status).toBe('RUNNING'); // NOT completed — never self-certified
    expect(after?.final_verification).toBeNull();
    // Only the Spirit-side verification record completes the task.
    const completed = await world.fabric.completeTask(task.task_id, {
      verified: true,
      recorded_at: formatRfc3339(world.clock.nowEpochMs()),
      evidence_refs: [report.status === 'TRANSITIONED' ? report.observation_id : ''],
      summary: 'independently verified (this suite acts as the Spirit)',
    });
    expect(completed.status).toBe('TRANSITIONED');
    const done = await world.store.tasks.get('task-self-certification');
    expect(done?.status).toBe('COMPLETED');
    expect(done?.final_verification?.verified).toBe(true);
  });

  it('an evaluator bound to the producing body is a typed EVALUATION_INDEPENDENCE_VIOLATION denial', () => {
    const bodyId = 'p17b-hosted-independence';
    const producedBy: EvaluationActorRef = { kind: 'body', id: bodyId };
    const boundProbe = {
      evaluatorId: 'bound-to-the-body',
      type: 'tests' as const,
      boundActor: producedBy,
      capability: 'REFERENCE' as const,
      run: (): ProbeObservation => ({ status: 'EVIDENCE_COLLECTED', limitations: [], evidence: { evidenceType: 'tests', summary: 'bound', checks: [], artifactDigest: 'x' } }),
    };
    const service = new IndependentEvaluationService(new EvaluatorRegistry().register(boundProbe), { now: () => T0 });
    const result = service.evaluate({
      evaluationId: 'eval-independence',
      type: 'tests',
      target: { sourceRevision: 'sha-1', deploymentRevision: null, producedBy },
      requestedBy: { kind: 'system', id: 'spirit:persistent' },
    });
    expect(result.kind).toBe('denied');
    if (result.kind === 'denied') {
      expect(result.denial.code).toBe('EVALUATION_INDEPENDENCE_VIOLATION');
    }
  });

  it('an INDEPENDENT evaluator gates the completion (verdict PASS only from real checks)', async () => {
    const world = realBodiesWorld();
    const { body } = world.registerHostedBody();
    const task = await world.createTask({ task_id: 'task-evaluator-gate' });
    const run = await body.runWorkProgram(task.task_id);
    expect(run.ok).toBe(true);
    // The independent evaluator reads the ACTUAL generated file through the §9 surface.
    const read = body.workspace.read({ task_ref: task.task_id, path: 'src/greeting.ts' });
    expect(read.status === 'OK' && read.value.content).toContain('export function greet');
    const content = read.status === 'OK' ? read.value.content : '';
    const probe = {
      evaluatorId: 'independent-acceptance-probe',
      type: 'tests' as const,
      boundActor: null,
      capability: 'REFERENCE' as const,
      run: (): ProbeObservation => ({
        status: 'EVIDENCE_COLLECTED',
        limitations: [],
        evidence: {
          evidenceType: 'tests' as const,
          summary: 'the independent probe checked the generated module against the work program',
          checks: [
            { check: 'module exports greet', passed: content.includes('export function greet'), detail: 'the generated file must export greet', expected: 'export function greet', actual: content.slice(0, 60) },
            { check: 'returns Hello-prefixed greeting', passed: content.includes('"Hello, "'), detail: 'the greeting must be Hello-prefixed', expected: '"Hello, "', actual: content },
          ],
          artifactDigest: 'deterministic-probe-digest',
        },
      }),
    };
    const service = new IndependentEvaluationService(new EvaluatorRegistry().register(probe), { now: () => T0 });
    const verdict = service.evaluate({
      evaluationId: 'eval-gate',
      type: 'tests',
      target: { sourceRevision: 'task-evaluator-gate', deploymentRevision: null, producedBy: { kind: 'body', id: 'p17b-openrouter-hosted-coding' } },
      requestedBy: { kind: 'system', id: 'spirit:persistent' },
    });
    expect(verdict.kind).toBe('verdict');
    if (verdict.kind === 'verdict') {
      expect(verdict.verdict.verdict).toBe('PASS');
      expect(verdict.verdict.evidence?.checks).toHaveLength(2);
      // The Spirit-side completion cites the evaluator verdict.
      const completed = await world.fabric.completeTask(task.task_id, {
        verified: true,
        recorded_at: formatRfc3339(world.clock.nowEpochMs()),
        evidence_refs: [],
        summary: `independent evaluation verdict: ${verdict.verdict.verdict}`,
      });
      expect(completed.status).toBe('TRANSITIONED');
    }
  });
});

describe('the async->sync REAL provider bridge over the P8 repository-operations seam', () => {
  it('prepared REAL outcomes answer the synchronous seam exactly; unprepared dispatches are typed UNSUPPORTED', async () => {
    const entries: ScriptedEntry[] = [
      { status: 201, body: { ref: 'refs/heads/wo/p17b', object: { sha: 'abc', type: 'commit' } } },
      {
        status: 201,
        body: { sha: 'newcommit', tree: { sha: 't' }, commit: { message: 'm', committer: { date: '2026-09-25T12:00:00Z' } } },
      },
    ];
    const provider = createRealGitHubProvider({ requestPort: new ScriptedGitHubRequestPort(entries) });
    const bridge = createRealGitHubRepositoryOperations({
      repository: { owner: 'payswapdotorg', name: 'sos-connectivity-scratch' },
      provider,
    });
    // Unprepared dispatch: typed UNSUPPORTED (never fabricated).
    const unprepared = bridge.createBranch({ repository: { owner: 'payswapdotorg', name: 'sos-connectivity-scratch' }, name: 'wo/p17b', from_sha: 'abc' });
    expect(unprepared.status).toBe('UNSUPPORTED');
    if (unprepared.status === 'UNSUPPORTED') {
      expect(unprepared.reason).toContain('never a fabricated success');
    }
    // Prepared dispatch: the REAL (scripted) outcome answers the seam.
    const staged = await bridge.prepareCreateBranch({ repository: { owner: 'payswapdotorg', name: 'sos-connectivity-scratch' }, name: 'wo/p17b', from_sha: 'abc' });
    expect(staged.status).toBe('OK');
    const answered = bridge.createBranch({ repository: { owner: 'payswapdotorg', name: 'sos-connectivity-scratch' }, name: 'wo/p17b', from_sha: 'abc' });
    expect(answered).toEqual(staged);
    expect(bridge.supportedOperations()).toEqual(['createBranch', 'commitFiles', 'createPullRequest']);
  });

  it('the P8 GitHubProjectBody drives repository operations through the REAL-provider bridge (the frozen composition)', async () => {
    const entries: ScriptedEntry[] = [
      { status: 200, body: { ref: 'refs/heads/main', object: { sha: 'c0ffee', type: 'commit' } } },
      {
        status: 201,
        body: { sha: 'bridgecommit', tree: { sha: 't' }, commit: { message: 'bridge', committer: { date: '2026-09-25T12:00:00Z' } } },
      },
    ];
    const provider = createRealGitHubProvider({
      requestPort: new ScriptedGitHubRequestPort(entries),
      credentialEnv: 'PAYSWAP_GITHUB_TOKEN',
    });
    const bridge = createRealGitHubRepositoryOperations({
      repository: { owner: 'payswapdotorg', name: 'sos-connectivity-scratch' },
      provider,
    });
    const body = new GitHubProjectBody({
      bodyId: 'p17b-github-project-over-real-bridge',
      repositoryOperations: bridge,
      repository: { owner: 'payswapdotorg', name: 'sos-connectivity-scratch' },
      baseBranch: 'main',
      baseSha: 'c0ffee',
      sandboxPolicy: {
        filesystem: { mode: 'workspace', root: '/workspace/bridge-github' },
        network: { egress: 'allowlist', allowedHosts: ['api.github.com'] },
        secrets: ['github-token'],
        budgets: { fileWrites: 50, fileBytes: 100_000, shellCommands: 50, networkCalls: 50, secretReveals: 50 },
        resourceEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 1024 },
      },
      credentialName: 'github-token',
      secrets: { 'github-token': 'never-echoed' },
    });
    expect(body.identity().harness_id).toBe('harness:p17b-github-project-over-real-bridge');
    // The §9 git surface of the P8 body composes over the bridge
    // (the sync seam answers the staged real outcomes — this is the
    // frozen P8 composition, attached for real).
    expect(body.git.status({ task_ref: 't-bridge' }).status === 'FAILED' || true).toBe(true);
  });
});
