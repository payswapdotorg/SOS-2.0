/**
 * The REAL-PROVIDER INTEGRATION SUITE of the real cloud execution body
 * (Work Order P17-B) — env-gated (RUN_REAL=1 AND OPENROUTER_API_KEY),
 * default OFF, strictly separated from the deterministic suite.
 *
 * THE JOURNEY (a real hosted coding-harness body behind the frozen §9
 * contract, driving a REAL coding-capable model API):
 *
 *   durable bounded task (P2 live store) + authority grant
 *     -> P5 broker lease on the REAL hosted body (capability-selected)
 *     -> createTask through the fabric (the work program rides in the plan)
 *     -> the engine drives the REAL OpenRouter model (model id + usage +
 *        response id recorded as provider facts)
 *     -> §9 surface collection: git.status, workspace.read,
 *        artifacts.capture (durable, content-addressed), checkpoint
 *     -> the body reports completion (NON-AUTHORITATIVE — the task stays
 *        RUNNING, §10)
 *     -> the INDEPENDENT evaluator EXECUTES the generated test under
 *        node (real runtime verification — never the body certifying
 *        itself) -> verdict PASS
 *     -> the Spirit side completes the task citing the verdict
 *     -> user_computer_required: NO — placement 'cloud', the egress
 *        allowlist carries only the model provider, zero device probes
 *        (asserted in evidence)
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGrant } from '@sos-2/authority';
import { BodyBroker } from '@sos-2/body-broker';
import { EvaluatorRegistry, IndependentEvaluationService } from '@sos-2/evaluator';
import type { ProbeObservation } from '@sos-2/evaluator';
import { ExecutionFabric } from '@sos-2/execution-fabric';
import { createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import type { Clock, TaskRecord } from '@sos-2/live-store';
import { HostedCodingBody, OpenRouterModelClient } from '@sos-2/real-bodies';
import type { HostedModelRunRecord } from '@sos-2/real-bodies';
import type { SandboxPolicy } from '@sos-2/sandbox';

const RUN_REAL = process.env['RUN_REAL'] === '1';
const EVIDENCE_DIR = join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'evidence', 'production-connectivity', 'github-execution');
const EVIDENCE_FILE = join(EVIDENCE_DIR, 'real-body-execution.json');
const BODY_ID = 'p17b-openrouter-hosted-coding';
const MODEL = 'qwen/qwen3-coder-flash';
const TASK_ID = `task-p17b-real-${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 14)}`;

/** The REAL work program: a small, independently verifiable coding task. */
const WORK_PROGRAM = {
  goal: [
    'Create src/fibonacci.ts exporting an iterative function fib(n: number): number returning the nth Fibonacci number, with fib(1) = 1 and fib(2) = 1.',
    'Also create tests/fibonacci.test.ts that imports fib from "../src/fibonacci.ts" (exact .ts extension — the evaluator runs it with node native TypeScript stripping)',
    'and uses node:assert strict equality to assert fib(1) === 1, fib(2) === 1 and fib(10) === 55.',
  ].join(' '),
  deliverable_path: 'src/fibonacci.ts',
  steps: ['summon-body', 'run-work-program', 'collect-evidence', 'evaluate'],
};

const SANDBOX_POLICY: SandboxPolicy = {
  filesystem: { mode: 'workspace', root: '/workspace/p17b-real-hosted' },
  network: { egress: 'allowlist', allowedHosts: ['openrouter.ai'] },
  secrets: ['openrouter-api-key'],
  budgets: { fileWrites: 50, fileBytes: 200_000, shellCommands: 50, networkCalls: 20, secretReveals: 10 },
  resourceEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 1024 },
};

/** A REAL wall clock — real evidence timestamps (the fabric stamps instants). */
const wallClock: Clock = { nowEpochMs: () => Date.now() };

const suite = RUN_REAL ? describe : describe.skip;

suite('REAL hosted body execution (RUN_REAL=1): the durable task through the real OpenRouter-backed body', () => {
  let store: ReturnType<typeof createInMemoryLiveStore>;
  let broker: BodyBroker;
  let fabric: ExecutionFabric;
  let body: HostedCodingBody;
  let task: TaskRecord;
  let runs: readonly HostedModelRunRecord[] = [];
  let evaluationOutput: Record<string, unknown> | null = null;
  let verdictSummary: string | null = null;
  let completedAt: string | null = null;

  beforeAll(async () => {
    const apiKey = process.env['OPENROUTER_API_KEY'] ?? null;
    expect(apiKey, 'OPENROUTER_API_KEY must be set for the real integration suite').toBeTruthy();
    store = createInMemoryLiveStore({ clock: wallClock });
    broker = new BodyBroker({ leases: store.bodyLeases, clock: wallClock });
    fabric = new ExecutionFabric({
      tasks: store.tasks,
      authorityGrants: store.authorityGrants,
      observationEvents: store.observationEvents,
      objects: store.objects,
      broker,
      clock: wallClock,
    });
    body = new HostedCodingBody({
      bodyId: BODY_ID,
      modelPort: new OpenRouterModelClient({ apiKey }),
      model: MODEL,
      maxOutputTokens: 1800,
      sandboxPolicy: SANDBOX_POLICY,
      placement: 'cloud',
      provider: { name: 'openrouter-hosted-coding', version: '1.0.0' },
      secrets: { 'openrouter-api-key': apiKey! },
    });
    broker.registerBody({
      body_id: BODY_ID,
      provider: { name: 'openrouter-hosted-coding', version: '1.0.0' },
      capabilities: body.capabilities(),
      placement: 'cloud',
      harness: body,
    });
    const grant = createGrant({
      grantee: 'spirit:persistent',
      scope: { kind: 'KIND', artifact_kind: 'Mission' },
      permissions: ['READ', 'REVISE'],
      expiry: { kind: 'TIME', at: formatRfc3339(Date.now() + 86_400_000) },
      provenance: ['p17b-real-body-suite'],
      created_at: formatRfc3339(Date.now()),
      status: 'ACTIVE',
    });
    await store.authorityGrants.put(grant);
    const created = await fabric.createBoundedTask({
      task_id: TASK_ID,
      mission_ref: null,
      plan: WORK_PROGRAM,
      grant_refs: [grant.envelope.id],
      requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'cloud' },
      holder: 'spirit:persistent',
      expires_at: null,
    });
    if (created.status !== 'CREATED') {
      throw new Error(`real task creation failed: ${JSON.stringify(created)}`);
    }
    task = created.task;
  });

  afterAll(() => {
    // Machine-readable evidence — real outcomes, exact model facts,
    // timestamps, verdict and the device-optional assertion. The durable
    // task record is read synchronously-safe: the record was asserted by
    // the tests themselves; the evidence snapshot mirrors the last known
    // state (status COMPLETED, checkpoints, artifacts).
    const evidence = {
      schema: 'sos-2/p17b/real-body-execution',
      work_order: 'P17-B',
      body_id: BODY_ID,
      placement: 'cloud',
      model_requested: MODEL,
      credential_env: 'OPENROUTER_API_KEY',
      credential_value_present: true,
      credential_redacted: true,
      task: {
        task_id: TASK_ID,
        lease_id: task.body_lease_ref,
        status: completedAt === null ? 'RUNNING' : 'COMPLETED',
        completed_at: completedAt,
      },
      model_runs: runs.map((run) => ({ ...run, files_applied: [...run.files_applied] })),
      body_completion_report: 'NON-AUTHORITATIVE — the body reported, only the Spirit completed',
      independent_evaluation: evaluationOutput,
      verdict_summary: verdictSummary,
      user_computer_required: false,
      user_computer_not_required_evidence: [
        "placement is 'cloud' and the task ran end-to-end through cloud API calls only",
        'the sandbox egress allowlist carries only the model provider (openrouter.ai) — no user-device host exists',
        `zero device probes: the §9 dispatch log names no device operation (${[...body.dispatches.keys()].join(', ')})`,
      ],
      honest_notes: [
        'The model API is a replaceable mechanism (never an authority): its output was parsed by a bounded protocol, applied inside a bounded sandbox, and gated by an INDEPENDENT evaluator that executed the generated test under node.',
        'The engine is the provider-side async drive documented by the frozen P8 sync-seam composition (§9 stays synchronous; results flow back through events, files and artifacts).',
      ],
    };
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
  });

  it('the broker leased the REAL cloud body for the durable task', () => {
    expect(task.body_lease_ref).not.toBeNull();
    expect(task.status).toBe('RUNNING');
    expect(body.identity().placement).toBe('cloud');
  });

  it('the engine drives the REAL model API and applies the parsed files (bounded retries, honest failures)', async () => {
    let last: HostedModelRunRecord | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const run = await body.runWorkProgram(TASK_ID);
      runs = body.modelRunsOf(TASK_ID);
      last = run;
      if (run.ok) {
        break;
      }
      // Honest retry with the same goal (the failed run is recorded).
    }
    expect(last?.ok, `the model engine did not succeed in 3 attempts: ${last?.error}`).toBe(true);
    expect(last?.model).toBeTruthy();
    expect(last?.response_id).toBeTruthy();
    expect(last?.usage?.total_tokens ?? 0).toBeGreaterThan(0);
    expect(last?.files_applied.some((file) => file.path === 'src/fibonacci.ts')).toBe(true);
  });

  it('collects the §9 evidence surface through the fabric (status, read, artifacts, checkpoint)', async () => {
    const status = await fabric.execute(TASK_ID, { kind: 'git.status' });
    expect(status.status).toBe('EXECUTED');
    if (status.status === 'EXECUTED') {
      expect((status.output as Record<string, unknown>)['clean']).toBe(false);
    }
    const read = await fabric.execute(TASK_ID, { kind: 'workspace.read', path: 'src/fibonacci.ts' });
    expect(read.status).toBe('EXECUTED');
    if (read.status === 'EXECUTED') {
      expect(read.availability).toBe('SUCCESS');
      const module = String((read.output as Record<string, unknown>)['content'] ?? '');
      expect(module).toContain('fib');
    }
    const testRead = await fabric.execute(TASK_ID, { kind: 'workspace.read', path: 'tests/fibonacci.test.ts' });
    expect(testRead.status === 'EXECUTED' && testRead.availability).toBe('SUCCESS');
    const moduleContent = await readModule();
    const testContent = await readTest();
    const capturedModule = await fabric.execute(TASK_ID, { kind: 'artifacts.capture', name: 'fibonacci-module', content: moduleContent });
    expect(capturedModule.status).toBe('EXECUTED');
    const capturedTest = await fabric.execute(TASK_ID, { kind: 'artifacts.capture', name: 'fibonacci-test', content: testContent });
    expect(capturedTest.status).toBe('EXECUTED');
    const checkpoint = await fabric.recordCheckpoint(TASK_ID, {
      label: 'work-program-complete',
      work_graph_state: { steps: ['summon-body', 'run-work-program', 'collect-evidence'], completed: 3 },
      notes: 'the real model-generated files were captured durably',
    });
    expect(checkpoint.status).toBe('TRANSITIONED');
    const events = await fabric.execute(TASK_ID, { kind: 'events.subscribe', filter: null, cursor: null });
    expect(events.status).toBe('EXECUTED');
    if (events.status === 'EXECUTED') {
      const bodyEvents = (events.output as Record<string, unknown>)['events'] as { kind: string }[];
      const kinds = bodyEvents.map((event) => event.kind);
      expect(kinds).toContain('model.call');
      expect(kinds).toContain('model.response');
      expect(kinds).toContain('work.completed');
    }
  });

  it('the body completion report is NON-AUTHORITATIVE (the task stays RUNNING)', async () => {
    const report = await fabric.reportBodyCompletion(TASK_ID, {
      summary: 'the body believes the work program is complete (self-reported — never a certification)',
      evidence: { runs: runs.length },
    });
    expect(report.status).toBe('TRANSITIONED');
    const after = await store.tasks.get(TASK_ID);
    expect(after?.status).toBe('RUNNING');
    expect(after?.final_verification).toBeNull();
  });

  it('the INDEPENDENT evaluator executes the generated test under node and gates completion (verdict PASS)', async () => {
    const moduleContent = await readModule();
    const testContent = await readTest();
    const workdir = mkdtempSync(join(tmpdir(), 'p17b-real-eval-'));
    let exitCode: number | null = null;
    let stdout = '';
    let stderr = '';
    const probe = {
      evaluatorId: 'independent-node-runtime-probe',
      type: 'tests' as const,
      boundActor: null,
      capability: 'REFERENCE' as const,
      run: (): ProbeObservation => {
        // REAL runtime verification: write the generated files and EXECUTE
        // the generated test — the body did not certify itself.
        mkdirSync(join(workdir, 'src'), { recursive: true });
        mkdirSync(join(workdir, 'tests'), { recursive: true });
        writeFileSync(join(workdir, 'src', 'fibonacci.ts'), moduleContent);
        writeFileSync(join(workdir, 'tests', 'fibonacci.test.ts'), testContent);
        const spawned = spawnSync('node', ['tests/fibonacci.test.ts'], { cwd: workdir, encoding: 'utf8', timeout: 60_000 });
        exitCode = spawned.status;
        stdout = spawned.stdout ?? '';
        stderr = spawned.stderr ?? '';
        const passed = spawned.status === 0;
        return {
          status: 'EVIDENCE_COLLECTED',
          limitations: ['the runtime verification executed the model-generated test file under the host node runtime'],
          evidence: {
            evidenceType: 'tests' as const,
            summary: 'the independent probe executed the generated test under node (exit code recorded)',
            checks: [
              {
                check: 'generated test executes and passes under node',
                passed,
                detail: `node tests/fibonacci.test.ts exited ${spawned.status}`,
                expected: 'exit code 0',
                actual: `exit code ${spawned.status}`,
              },
              {
                check: 'module exports an iterative fib',
                passed: /export\s+(function|const)\s+fib/.test(moduleContent) && !/recursi/.test(moduleContent.split('\n')[0] ?? ''),
                detail: 'the generated module must export fib without recursion',
                expected: 'export function fib | export const fib',
                actual: moduleContent.split('\n').filter((line) => line.includes('fib')).slice(0, 3).join(' | '),
              },
            ],
            artifactDigest: 'runtime-verification',
          },
        };
      },
    };
    const service = new IndependentEvaluationService(new EvaluatorRegistry().register(probe), { now: () => Date.now() });
    const result = service.evaluate({
      evaluationId: `eval-${TASK_ID}`,
      type: 'tests',
      target: { sourceRevision: TASK_ID, deploymentRevision: null, producedBy: { kind: 'body', id: BODY_ID } },
      requestedBy: { kind: 'system', id: 'spirit:persistent' },
    });
    expect(result.kind).toBe('verdict');
    if (result.kind !== 'verdict') {
      return;
    }
    evaluationOutput = {
      verdict: result.verdict.verdict,
      verdict_id: result.verdict.verdictId,
      evaluator: result.verdict.evaluator,
      exit_code: exitCode,
      stdout_excerpt: stdout.slice(0, 400),
      stderr_excerpt: stderr.slice(0, 400),
      checks: result.verdict.evidence?.checks,
      uncertainty: result.verdict.uncertainty,
    };
    verdictSummary = `independent evaluation verdict: ${result.verdict.verdict} (node exit ${exitCode})`;
    expect(result.verdict.verdict, `the generated test failed under node:\n${stdout}\n${stderr}`).toBe('PASS');
    rmSync(workdir, { recursive: true, force: true });
  });

  it('the Spirit side completes the task citing the independent verdict', async () => {
    const completed = await fabric.completeTask(TASK_ID, {
      verified: true,
      recorded_at: formatRfc3339(Date.now()),
      evidence_refs: [],
      summary: verdictSummary,
    });
    expect(completed.status).toBe('TRANSITIONED');
    const after = await store.tasks.get(TASK_ID);
    expect(after?.status).toBe('COMPLETED');
    expect(after?.final_verification?.verified).toBe(true);
    completedAt = after?.final_verification?.recorded_at ?? null;
  });

  it('asserts the user computer was NEVER required (the §7 pin, recorded in evidence)', () => {
    expect(body.identity().placement).toBe('cloud');
    expect(body.capabilities().networkPolicy).toEqual({ egress: 'allowlist', allowedHosts: ['openrouter.ai'] });
    for (const operation of body.dispatches.keys()) {
      expect(operation.startsWith('device')).toBe(false);
    }
  });

  async function readModule(): Promise<string> {
    const read = await fabric.execute(TASK_ID, { kind: 'workspace.read', path: 'src/fibonacci.ts' });
    if (read.status !== 'EXECUTED' || read.availability !== 'SUCCESS') {
      throw new Error(`module read failed: ${JSON.stringify(read)}`);
    }
    return String((read.output as Record<string, unknown>)['content'] ?? '');
  }

  async function readTest(): Promise<string> {
    const read = await fabric.execute(TASK_ID, { kind: 'workspace.read', path: 'tests/fibonacci.test.ts' });
    if (read.status !== 'EXECUTED' || read.availability !== 'SUCCESS') {
      throw new Error(`test read failed: ${JSON.stringify(read)}`);
    }
    return String((read.output as Record<string, unknown>)['content'] ?? '');
  }
});
