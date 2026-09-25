/**
 * The DETERMINISTIC reference-mode suite of the hosted coding-harness
 * body (Work Order P17-B): the frozen §9 HarnessContract compliance of
 * @sos-2/real-bodies' HostedCodingBody — offline (a scripted model
 * port), fixed seed, run-to-run identical.
 *
 * Pins: the binding advertisement, explicit UNSUPPORTED browser
 * operations, the sandbox-bounded workspace, the model-backed shell
 * vocabulary, git typed records, artifacts/observations/events cursor
 * discipline, the model-engine protocol (bounded parse, honest FAILED
 * runs — never fabricated successes), and the §7 device-optional pin
 * (placement cloud, no user-device handle).
 */

import { describe, expect, it } from 'vitest';
import { HARNESS_OPERATIONS, advertisedOperations, isOperationAdvertised } from '@sos-2/harness';
import { assertValidHarnessCapabilities, assertValidHarnessIdentity } from '@sos-2/harness';
import { HostedCodingBody, ScriptedHostedModelPort, parseWorkProgramOutput, parseWorkProgramInput } from '@sos-2/real-bodies';
import type { ScriptedModelEntry } from '@sos-2/real-bodies';
import { HOSTED_BODY_POLICY, realBodiesWorld, scriptedModelFilesResponse } from './world.js';

function hostedBody(entries: readonly ScriptedModelEntry[]): HostedCodingBody {
  return new HostedCodingBody({
    bodyId: 'test-hosted-coding',
    modelPort: new ScriptedHostedModelPort(entries),
    sandboxPolicy: HOSTED_BODY_POLICY,
    secrets: { 'openrouter-api-key': 'sk-or-scripted' },
  });
}

describe('the hosted coding body: §9 identity + binding advertisement', () => {
  it('answers a valid runtime identity (never a sos:// semantic id) with placement cloud', () => {
    const body = hostedBody([]);
    const identity = body.identity();
    expect(() => assertValidHarnessIdentity(identity)).not.toThrow();
    expect(identity.harness_id).toBe('harness:test-hosted-coding');
    expect(identity.placement).toBe('cloud');
    expect(identity.provider.name).toBe('openrouter-hosted-coding');
  });

  it('advertises the binding §3 surface consistently (validated + closed operation mapping)', () => {
    const body = hostedBody([]);
    expect(() => assertValidHarnessCapabilities(body.capabilities())).not.toThrow();
    const capabilities = body.capabilities();
    expect(capabilities.shell).toEqual(['exec']);
    expect(capabilities.git).toEqual(['status', 'diff', 'commit', 'push', 'createBranch', 'createPullRequest']);
    expect(capabilities.browser).toEqual([]);
    expect(capabilities.taskLifecycle).toEqual({ create: true, resume: true, pause: true, cancel: true, checkpoints: true });
    expect(capabilities.evidenceCapture).toEqual({ artifacts: true, observations: true, events: true });
    // The model API is an honest runtime integration (provenance, never authority).
    expect(capabilities.capabilities).toContain('runtime-cloud-apis');
    expect(capabilities.runtimeIntegrations[0]?.capability).toBe('hosted-model');
    expect(capabilities.runtimeIntegrations[0]?.integrations[0]?.endpoint).toBe('https://openrouter.ai/api/v1/chat/completions');
    // The closed §9 vocabulary maps exactly onto the advertisement.
    expect(advertisedOperations(capabilities).sort()).toEqual(
      HARNESS_OPERATIONS.filter((operation) => operation !== 'browser.open' && operation !== 'browser.interact').sort(),
    );
    expect(isOperationAdvertised(capabilities, 'browser.open')).toBe(false);
    expect(isOperationAdvertised(capabilities, 'shell.exec')).toBe(true);
  });

  it('answers explicit typed UNSUPPORTED for the unadvertised browser operations (never silent)', () => {
    const body = hostedBody([]);
    const opened = body.browser.open({ task_ref: 't1', url: 'https://example.invalid' });
    expect(opened.status).toBe('UNSUPPORTED');
    if (opened.status === 'UNSUPPORTED') {
      expect(opened.operation).toBe('browser.open');
    }
    const interacted = body.browser.interact({ task_ref: 't1', page_id: 'p1', action: 'click', target: 'a', value: null });
    expect(interacted.status).toBe('UNSUPPORTED');
  });
});

describe('the hosted coding body: §9 lifecycle + workspace + shell + git + evidence surfaces', () => {
  it('creates, pauses, resumes and cancels a task session with honest failures for unknown sessions', () => {
    const body = hostedBody([]);
    const created = body.createTask({ task_ref: 't1', input: { goal: 'demo goal' } });
    expect(created.status).toBe('OK');
    if (created.status === 'OK') {
      expect(created.value.accepted).toBe(true);
      expect(created.value.workspace_root).toContain('t1');
    }
    expect(body.workProgramOf('t1')).toEqual({ goal: 'demo goal' });
    const paused = body.pauseTask({ task_ref: 't1' });
    expect(paused.status).toBe('OK');
    const resumed = body.resumeTask({ task_ref: 't1', input: null });
    expect(resumed.status).toBe('OK');
    if (resumed.status === 'OK') {
      expect(resumed.value.state).toBe('resumed');
      expect(resumed.value.recovered).toEqual({ adopted_by_replacement: false, files: 0, commits: 0 });
    }
    const cancelled = body.cancelTask({ task_ref: 't1' });
    expect(cancelled.status).toBe('OK');
    expect(body.shell.exec({ task_ref: 't1', command: 'echo', args: [], cwd: null }).status).toBe('FAILED');
    const unknown = body.shell.exec({ task_ref: 'never-created', command: 'echo', args: [], cwd: null });
    expect(unknown.status).toBe('FAILED');
  });

  it('bounds the workspace by the sandbox (out-of-scope writes fail truthfully; reads work)', () => {
    const body = hostedBody([]);
    body.createTask({ task_ref: 't1', input: null });
    const written = body.workspace.write({ task_ref: 't1', path: 'notes.md', content: '# notes\n' });
    expect(written.status).toBe('OK');
    if (written.status === 'OK') {
      expect(written.value.bytes).toBe(8);
    }
    const read = body.workspace.read({ task_ref: 't1', path: 'notes.md' });
    expect(read.status).toBe('OK');
    if (read.status === 'OK') {
      expect(read.value.content).toBe('# notes\n');
    }
    const denied = body.workspace.write({ task_ref: 't1', path: '../escape.txt', content: 'no' });
    expect(denied.status).toBe('FAILED');
  });

  it('serves the model-backed shell vocabulary (built-ins + the honest engine status)', () => {
    const body = hostedBody([]);
    body.createTask({ task_ref: 't1', input: { goal: 'demo goal' } });
    const echoed = body.shell.exec({ task_ref: 't1', command: 'echo', args: ['hello'], cwd: null });
    expect(echoed.status).toBe('OK');
    if (echoed.status === 'OK') {
      expect(echoed.value.stdout).toBe('hello');
    }
    const listed = body.shell.exec({ task_ref: 't1', command: 'ls', args: [], cwd: null });
    expect(listed.status).toBe('OK');
    const status = body.shell.exec({ task_ref: 't1', command: 'status', args: [], cwd: null });
    expect(status.status).toBe('OK');
    if (status.status === 'OK') {
      const parsed = JSON.parse(status.value.stdout) as Record<string, unknown>;
      expect(parsed['placement']).toBe('cloud');
      expect(parsed['model']).toBe('qwen/qwen3-coder-flash');
      expect(parsed['runs']).toBe(0);
      expect(parsed['work_program']).toEqual({ goal: 'demo goal' });
    }
    const unknownCommand = body.shell.exec({ task_ref: 't1', command: 'not-a-command', args: [], cwd: null });
    expect(unknownCommand.status).toBe('OK');
    if (unknownCommand.status === 'OK') {
      expect(unknownCommand.value.exit_code).not.toBe(0);
    }
  });

  it('serves the git typed-record surface (status/diff/commit/push/branch/PR)', () => {
    const body = hostedBody([]);
    body.createTask({ task_ref: 't1', input: null });
    body.workspace.write({ task_ref: 't1', path: 'a.ts', content: 'export {};\n' });
    const status = body.git.status({ task_ref: 't1' });
    expect(status.status).toBe('OK');
    if (status.status === 'OK') {
      expect(status.value.clean).toBe(false);
      expect(status.value.changed).toEqual(['a.ts']);
    }
    const committed = body.git.commit({ task_ref: 't1', message: 'add a', paths: [] });
    expect(committed.status).toBe('OK');
    const pushed = body.git.push({ task_ref: 't1', remote: 'origin', ref: 'refs/heads/main' });
    expect(pushed.status).toBe('OK');
    if (pushed.status === 'OK') {
      expect(pushed.value.pushed_ref).toBe('origin/refs/heads/main');
    }
    const branched = body.git.createBranch({ task_ref: 't1', name: 'wo/probe', from_ref: null });
    expect(branched.status).toBe('OK');
    const pullRequest = body.git.createPullRequest({ task_ref: 't1', title: 'probe', source_branch: 'wo/probe', target_branch: 'main' });
    expect(pullRequest.status).toBe('OK');
  });

  it('captures artifacts, emits observations and serves the cursor event stream', () => {
    const body = hostedBody([]);
    body.createTask({ task_ref: 't1', input: null });
    const captured = body.artifacts.capture({ task_ref: 't1', name: 'run-log', content: 'log-line\n' });
    expect(captured.status).toBe('OK');
    if (captured.status === 'OK') {
      expect(captured.value.artifact_id).toBe('t1:artifact:run-log');
      expect(captured.value.size_bytes).toBe(9);
    }
    const emitted = body.observations.emit({ task_ref: 't1', observation_kind: 'body.progress', payload: { step: 1 } });
    expect(emitted.status).toBe('OK');
    const subscribed = body.events.subscribe({ task_ref: 't1', filter: null, cursor: null });
    expect(subscribed.status).toBe('OK');
    if (subscribed.status === 'OK') {
      expect(subscribed.value.events.length).toBeGreaterThan(0);
      expect(subscribed.value.next_cursor).not.toBeNull();
      const next = body.events.subscribe({ task_ref: 't1', filter: null, cursor: subscribed.value.next_cursor });
      expect(next.status === 'OK');
      if (next.status === 'OK') {
        expect(next.value.events).toEqual([]);
        expect(next.value.next_cursor).toBeNull();
      }
    }
  });
});

describe('the model engine: bounded protocol, honest failures (never fabricated successes)', () => {
  it('drives the scripted model, applies the parsed files inside the sandbox and records provider facts', async () => {
    const greetingModule = 'export function greet(name: string): string {\n  return "Hello, " + name;\n}\n';
    const body = hostedBody([
      scriptedModelFilesResponse([{ path: 'src/greeting.ts', contents: greetingModule }], 'wrote the requested module'),
    ]);
    body.createTask({ task_ref: 't1', input: { goal: 'write greeting module', deliverable_path: 'src/greeting.ts' } });
    const run = await body.runWorkProgram('t1');
    expect(run.ok).toBe(true);
    expect(run.files_applied).toEqual([{ path: 'src/greeting.ts', bytes: greetingModule.length }]);
    expect(run.model).toBe('openai/gpt-5.1-codex-mini');
    expect(run.response_id).toBe('scripted-model-response-0001');
    expect(run.usage).toEqual({ prompt_tokens: 111, completion_tokens: 222, total_tokens: 333 });
    expect(run.summary).toBe('wrote the requested module');
    // The applied file is readable through the §9 surface and visible to git status.
    const read = body.workspace.read({ task_ref: 't1', path: 'src/greeting.ts' });
    expect(read.status === 'OK' && read.value.content).toContain('export function greet');
    const status = body.git.status({ task_ref: 't1' });
    expect(status.status === 'OK' && status.value.changed).toEqual(['src/greeting.ts']);
    // The event stream carries the full engine trace (model.call -> model.response -> work.applied -> work.completed).
    const subscribed = body.events.subscribe({ task_ref: 't1', filter: null, cursor: null });
    expect(subscribed.status === 'OK');
    if (subscribed.status === 'OK') {
      const kinds = subscribed.value.events.map((event) => event.kind);
      expect(kinds).toContain('task.created');
      expect(kinds).toContain('model.call');
      expect(kinds).toContain('model.response');
      expect(kinds).toContain('work.applied');
      expect(kinds).toContain('work.completed');
    }
    // The run record is on the audit probe.
    expect(body.modelRunsOf('t1')).toHaveLength(1);
  });

  it('reports an honest FAILED run when the provider call fails (typed error vocabulary)', async () => {
    const body = hostedBody([
      { respond: { fail: { status: 429, kind: 'RATE_LIMIT', message: 'quota exhausted' } } },
    ]);
    body.createTask({ task_ref: 't1', input: { goal: 'write module' } });
    const run = await body.runWorkProgram('t1');
    expect(run.ok).toBe(false);
    expect(run.files_applied).toEqual([]);
    expect(run.error).toContain('RATE_LIMIT');
    const subscribed = body.events.subscribe({ task_ref: 't1', filter: null, cursor: null });
    expect(subscribed.status === 'OK');
    if (subscribed.status === 'OK') {
      expect(subscribed.value.events.map((event) => event.kind)).toContain('model.failed');
    }
  });

  it('reports an honest FAILED run when the model output does not parse (prose, malformed JSON)', async () => {
    const body = hostedBody([
      { respond: { id: 'r2', model: 'openai/gpt-5.1-codex-mini', content: 'I would rather explain than emit JSON.', finish_reason: 'stop', usage: null } },
    ]);
    body.createTask({ task_ref: 't1', input: { goal: 'write module' } });
    const run = await body.runWorkProgram('t1');
    expect(run.ok).toBe(false);
    expect(run.error).toContain('did not parse');
  });

  it('reports an honest FAILED run when the model attempts a path traversal (bounded protocol)', async () => {
    const body = hostedBody([
      scriptedModelFilesResponse([{ path: '../../etc/passwd', contents: 'no' }], 'escape attempt'),
    ]);
    body.createTask({ task_ref: 't1', input: { goal: 'write module' } });
    const run = await body.runWorkProgram('t1');
    expect(run.ok).toBe(false);
    expect(run.error).toContain('did not parse');
  });

  it('reports an honest FAILED run when the network budget is exhausted (sandbox denial)', async () => {
    const tightPolicy = {
      ...HOSTED_BODY_POLICY,
      budgets: { fileWrites: 50, fileBytes: 200_000, shellCommands: 50, networkCalls: 1, secretReveals: 10 },
    };
    const body = new HostedCodingBody({
      bodyId: 'test-hosted-tight',
      modelPort: new ScriptedHostedModelPort([
        scriptedModelFilesResponse([{ path: 'a.ts', contents: 'a' }], 'first'),
        scriptedModelFilesResponse([{ path: 'b.ts', contents: 'b' }], 'second'),
      ]),
      sandboxPolicy: tightPolicy,
    });
    body.createTask({ task_ref: 't1', input: { goal: 'write module' } });
    const first = await body.runWorkProgram('t1');
    expect(first.ok).toBe(true);
    // The bounded network budget is exhausted — the second run is denied truthfully.
    const second = await body.runWorkProgram('t1');
    expect(second.ok).toBe(false);
    expect(second.error).toContain('networkCalls');
  });

  it('refuses to run without a work program (honest absence, never an invented goal)', async () => {
    const body = hostedBody([]);
    body.createTask({ task_ref: 't1', input: null });
    const run = await body.runWorkProgram('t1');
    expect(run.ok).toBe(false);
    expect(run.error).toContain('no work program');
  });
});

describe('the work-program protocol parsing (bounded, deterministic)', () => {
  it('parses the plain JSON, the fenced block and the brace span; rejects malformed shapes', () => {
    const files = [{ path: 'a.ts', contents: 'a' }];
    expect(parseWorkProgramOutput(JSON.stringify({ files, summary: 's' }))).toEqual({ files, summary: 's' });
    expect(parseWorkProgramOutput(`Here you go:\n\`\`\`json\n${JSON.stringify({ files, summary: 's' })}\n\`\`\`\nthanks!`)).toEqual({ files, summary: 's' });
    expect(parseWorkProgramOutput(`prefix {\"files\":[{\"path\":\"a.ts\",\"contents\":\"a\"}],\"summary\":\"s\"} suffix`)).toEqual({ files, summary: 's' });
    expect(parseWorkProgramOutput('no json at all')).toBeNull();
    expect(parseWorkProgramOutput('{"summary": "no files key"}')).toBeNull();
    expect(parseWorkProgramOutput('{"files": "not-an-array"}')).toBeNull();
    expect(parseWorkProgramOutput('{"files": [{"path": "", "contents": "a"}], "summary": "s"}')).toBeNull();
    expect(parseWorkProgramOutput('{"files": [{"path": "../up.ts", "contents": "a"}], "summary": "s"}')).toBeNull();
  });

  it('parses the createTask input into the bounded work program (or an honest null)', () => {
    expect(parseWorkProgramInput({ goal: 'g', deliverable_path: 'd.ts' })).toEqual({ goal: 'g', deliverable_path: 'd.ts' });
    expect(parseWorkProgramInput({ goal: 'g' })).toEqual({ goal: 'g' });
    expect(parseWorkProgramInput(null)).toBeNull();
    expect(parseWorkProgramInput({})).toBeNull();
    expect(parseWorkProgramInput('a string')).toBeNull();
    expect(parseWorkProgramInput({ goal: '' })).toBeNull();
    expect(parseWorkProgramInput({ goal: 'g', deliverable_path: 42 })).toEqual({ goal: 'g' });
  });
});

describe('the §7 device-optional pin (cloud execution never requires the user computer)', () => {
  it('holds no user-device handle: placement cloud, egress allowlist is the model provider only, no device surface exists', () => {
    const body = hostedBody([]);
    const capabilities = body.capabilities();
    expect(body.identity().placement).toBe('cloud');
    expect(capabilities.networkPolicy).toEqual({ egress: 'allowlist', allowedHosts: ['openrouter.ai'] });
    // No device-placed operation exists anywhere in the §9 vocabulary this body realizes.
    for (const operation of advertisedOperations(capabilities)) {
      expect(operation.startsWith('device.')).toBe(false);
    }
  });

  it('completes a full scripted task with ZERO device probes (the audit trail names only model/workspace/git events)', async () => {
    const world = realBodiesWorld();
    const { body } = world.registerHostedBody();
    const task = await world.createTask({ task_id: 'task-device-optional' });
    await body.runWorkProgram(task.task_id);
    const status = body.shell.exec({ task_ref: task.task_id, command: 'status', args: [], cwd: null });
    expect(status.status).toBe('OK');
    // The dispatched operations are the §9 control/read plane only.
    for (const operation of body.dispatches.keys()) {
      expect(operation.startsWith('device')).toBe(false);
    }
  });
});
