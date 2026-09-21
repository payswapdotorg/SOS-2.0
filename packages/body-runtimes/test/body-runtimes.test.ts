/**
 * Deterministic body-runtime tests (Work Order P8): the three reference
 * bodies through the PUBLIC §9 Harness Contract — complete bounded task
 * journeys, honest UNSUPPORTED surfaces, sandbox boundary violations as
 * truthful FAILED results carrying the typed denial, honest
 * NOT_YET_CONNECTED, and the secrets-never-echoed discipline.
 */

import { describe, expect, it } from 'vitest';
import { CloudCodingShellBody } from '../src/cloud-body.js';
import { BrowserEvaluatorBody, hostOfUrl } from '../src/browser-body.js';
import { GitHubProjectBody } from '../src/github-body.js';
import { InMemoryGitHubRepositoryOperations } from '../src/github-operations.js';
import { ScriptedBrowserPort } from '../src/browser-port.js';
import { ShellSimulator, builtinShellCommands } from '../src/shell-simulator.js';
import type { SandboxPolicy } from '@sos-2/sandbox';
import { isOperationAdvertised } from '@sos-2/harness';

const CLOUD_POLICY: SandboxPolicy = {
  filesystem: { mode: 'workspace', root: '/workspace/cloud-shell' },
  network: { egress: 'allowlist', allowedHosts: ['api.github.com', 'registry.npmjs.org'] },
  secrets: ['github-token'],
  budgets: { fileWrites: 10, fileBytes: 10_000, shellCommands: 10, networkCalls: 10, secretReveals: 10 },
  resourceEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 512 },
};

const GITHUB_TOKEN_VALUE = 'gh-token-value-must-never-appear-anywhere';

function cloudBody(overrides: Partial<ConstructorParameters<typeof CloudCodingShellBody>[0]> = {}) {
  return new CloudCodingShellBody({
    bodyId: 'cloud-shell-1',
    sandboxPolicy: CLOUD_POLICY,
    secrets: { 'github-token': GITHUB_TOKEN_VALUE },
    ...overrides,
  });
}

describe('cloud coding/shell body: the complete bounded task through the PUBLIC contract', () => {
  it('executes create -> workspace -> shell -> git -> artifacts -> observations -> events', () => {
    const body = cloudBody();
    const harness = body as unknown as import('@sos-2/harness').HarnessContract;
    const taskRef = 'task-cloud-0001';

    expect(harness.createTask({ task_ref: taskRef, input: { steps: ['write', 'verify', 'commit'] } })).toMatchObject({
      status: 'OK',
      value: { accepted: true, workspace_root: '/workspace/cloud-shell/task-cloud-0001' },
    });

    expect(harness.workspace.write({ task_ref: taskRef, path: 'src/feature.ts', content: 'export const feature = 1;\n' })).toMatchObject({
      status: 'OK',
      value: { bytes: 26 },
    });
    expect(harness.workspace.read({ task_ref: taskRef, path: 'src/feature.ts' })).toMatchObject({
      status: 'OK',
      value: { content: 'export const feature = 1;\n' },
    });

    const echoed = harness.shell.exec({ task_ref: taskRef, command: 'echo', args: ['building', 'feature'], cwd: null });
    expect(echoed).toMatchObject({ status: 'OK', value: { exit_code: 0, stdout: 'building feature' } });
    const catted = harness.shell.exec({ task_ref: taskRef, command: 'cat', args: ['src/feature.ts'], cwd: null });
    expect(catted).toMatchObject({ status: 'OK', value: { exit_code: 0, stdout: 'export const feature = 1;\n' } });

    expect(harness.git.status({ task_ref: taskRef })).toMatchObject({
      status: 'OK',
      value: { branch: 'main', clean: false, changed: ['src/feature.ts'] },
    });
    expect(harness.git.diff({ task_ref: taskRef, ref: null }).value?.diff).toContain('+export const feature = 1;');
    expect(harness.git.createBranch({ task_ref: taskRef, name: 'feature/one', from_ref: null })).toMatchObject({
      status: 'OK',
      value: { branch: 'feature/one' },
    });
    expect(harness.git.commit({ task_ref: taskRef, message: 'feat: add feature', paths: [] })).toMatchObject({
      status: 'OK',
      value: { commit_ref: 'commit-001', files: 1 },
    });
    expect(harness.git.status({ task_ref: taskRef })).toMatchObject({ status: 'OK', value: { clean: true, changed: [] } });
    expect(harness.git.push({ task_ref: taskRef, remote: 'origin', ref: 'feature/one' })).toMatchObject({
      status: 'OK',
      value: { pushed_ref: 'origin/feature/one' },
    });
    expect(harness.git.createPullRequest({ task_ref: taskRef, title: 'feat: add feature', source_branch: 'feature/one', target_branch: 'main' })).toMatchObject({
      status: 'OK',
      value: { pull_request_ref: 'pr-001' },
    });

    expect(harness.artifacts.capture({ task_ref: taskRef, name: 'build-report', content: 'all checks passed' })).toMatchObject({
      status: 'OK',
      value: { artifact_id: 'task-cloud-0001:artifact:build-report', size_bytes: 17 },
    });
    expect(harness.observations.emit({ task_ref: taskRef, observation_kind: 'body.progress', payload: { step: 'committed' } })).toMatchObject({
      status: 'OK',
      value: { accepted: true },
    });

    const subscribed = harness.events.subscribe({ task_ref: taskRef, filter: null, cursor: null });
    expect(subscribed.status).toBe('OK');
    if (subscribed.status === 'OK') {
      const kinds = subscribed.value.events.map((event) => event.kind);
      expect(kinds).toContain('task.created');
      expect(kinds).toContain('workspace.wrote');
      expect(kinds).toContain('shell.executed');
      expect(kinds).toContain('git.committed');
      expect(kinds).toContain('git.pushed');
      expect(kinds).toContain('artifacts.captured');
      // Cursor-based paging is deterministic.
      const next = harness.events.subscribe({ task_ref: taskRef, filter: null, cursor: subscribed.value.events[0]!.event_id });
      expect(next.status === 'OK' && next.value.events.length).toBe(subscribed.value.events.length - 1);
    }
  });

  it('advertises honestly: NO browser capability — typed UNSUPPORTED, never silent', () => {
    const body = cloudBody();
    const capabilities = body.capabilitiesValue;
    expect(capabilities.capabilities).toEqual(['terminal', 'filesystem', 'repository-operations']);
    expect(capabilities.browser).toEqual([]);
    expect(isOperationAdvertised(capabilities, 'browser.open')).toBe(false);
    expect(isOperationAdvertised(capabilities, 'shell.exec')).toBe(true);
    const refused = (body as unknown as import('@sos-2/harness').HarnessContract).browser.open({ task_ref: 'x', url: 'https://example.com' });
    expect(refused.status).toBe('UNSUPPORTED');
    if (refused.status === 'UNSUPPORTED') {
      expect(refused.operation).toBe('browser.open');
      expect(refused.reason).toContain('NO browser capability');
    }
  });

  it('is placement cloud — the body holds no local-device handle of any kind', () => {
    const body = cloudBody();
    expect(body.identityValue.placement).toBe('cloud');
    // Structurally: the options carry only bodyId/provider/policy/secrets/
    // commands/costEnvelope — no device handle exists on the contract.
    expect(Object.keys(body.identityValue)).toEqual(['harness_id', 'provider', 'placement']);
  });
});

describe('cloud coding/shell body: sandbox boundaries surface as truthful FAILED results', () => {
  it('refuses an out-of-scope workspace write with the typed denial code', () => {
    const body = cloudBody();
    const harness = body as unknown as import('@sos-2/harness').HarnessContract;
    harness.createTask({ task_ref: 'task-oos-0001', input: null });
    const denied = harness.workspace.write({ task_ref: 'task-oos-0001', path: '../../escape.txt', content: 'x' });
    expect(denied.status).toBe('FAILED');
    if (denied.status === 'FAILED') {
      expect(denied.error).toContain('SANDBOX_FILESYSTEM_OUT_OF_SCOPE');
    }
  });

  it('refuses shell executions past the shellCommands budget with SANDBOX_BUDGET_EXCEEDED', () => {
    const body = new CloudCodingShellBody({
      bodyId: 'cloud-shell-budget',
      sandboxPolicy: { ...CLOUD_POLICY, budgets: { fileWrites: 10, fileBytes: 10_000, shellCommands: 2, networkCalls: 10, secretReveals: 10 } },
      secrets: { 'github-token': GITHUB_TOKEN_VALUE },
    });
    const harness = body as unknown as import('@sos-2/harness').HarnessContract;
    harness.createTask({ task_ref: 'task-budget-0001', input: null });
    expect(harness.shell.exec({ task_ref: 'task-budget-0001', command: 'echo', args: ['one'], cwd: null }).status).toBe('OK');
    expect(harness.shell.exec({ task_ref: 'task-budget-0001', command: 'echo', args: ['two'], cwd: null }).status).toBe('OK');
    const denied = harness.shell.exec({ task_ref: 'task-budget-0001', command: 'echo', args: ['three'], cwd: null });
    expect(denied.status).toBe('FAILED');
    if (denied.status === 'FAILED') {
      expect(denied.error).toContain('SANDBOX_BUDGET_EXCEEDED');
      expect(denied.error).toContain('shellCommands');
    }
  });

  it('never echoes the credential value through ANY contract output', () => {
    const body = cloudBody();
    const harness = body as unknown as import('@sos-2/harness').HarnessContract;
    harness.createTask({ task_ref: 'task-secrets-0001', input: null });
    // Use the credential through the sandbox closure (a network exchange).
    const sandbox = body.sandboxOf('task-secrets-0001')!;
    const exchange = sandbox.network.netCall('api.github.com', '/repos/acme/x', 'github-token');
    expect(exchange.status).toBe('OK');
    // Exercise outputs.
    harness.workspace.write({ task_ref: 'task-secrets-0001', path: 'a.txt', content: 'a' });
    harness.shell.exec({ task_ref: 'task-secrets-0001', command: 'echo', args: ['hi'], cwd: null });
    harness.artifacts.capture({ task_ref: 'task-secrets-0001', name: 'report', content: 'report body' });
    harness.observations.emit({ task_ref: 'task-secrets-0001', observation_kind: 'body.progress', payload: { ok: true } });
    const outputs = [
      JSON.stringify(harness.events.subscribe({ task_ref: 'task-secrets-0001', filter: null, cursor: null })),
      JSON.stringify(harness.git.status({ task_ref: 'task-secrets-0001' })),
      JSON.stringify(harness.git.diff({ task_ref: 'task-secrets-0001', ref: null })),
      JSON.stringify(body.capabilitiesValue),
      JSON.stringify(body.identityValue),
      JSON.stringify(sandbox.describe()),
      JSON.stringify(sandbox.budget.report()),
      JSON.stringify(exchange),
    ];
    for (const output of outputs) {
      expect(output).not.toContain(GITHUB_TOKEN_VALUE);
    }
  });

  it('lifecycle: pause -> resume -> cancel; a replacement body adopts an unknown task honestly', () => {
    const body = cloudBody();
    const harness = body as unknown as import('@sos-2/harness').HarnessContract;
    harness.createTask({ task_ref: 'task-lc-0001', input: null });
    expect(harness.pauseTask({ task_ref: 'task-lc-0001' })).toMatchObject({ status: 'OK', value: { state: 'paused' } });
    const resumed = harness.resumeTask({ task_ref: 'task-lc-0001', input: null });
    expect(resumed).toMatchObject({ status: 'OK', value: { state: 'resumed' } });
    if (resumed.status === 'OK') {
      expect(resumed.value.recovered).toMatchObject({ adopted_by_replacement: false });
    }
    expect(harness.cancelTask({ task_ref: 'task-lc-0001' })).toMatchObject({ status: 'OK', value: { state: 'cancelled' } });
    expect(harness.workspace.read({ task_ref: 'task-lc-0001', path: 'a' }).status).toBe('FAILED');

    // A REPLACEMENT body (fresh instance, same kind) adopts the task.
    const replacement = cloudBody({ bodyId: 'cloud-shell-2' });
    const adopted = (replacement as unknown as import('@sos-2/harness').HarnessContract).resumeTask({ task_ref: 'task-lc-0001', input: null });
    expect(adopted).toMatchObject({ status: 'OK', value: { state: 'resumed' } });
    if (adopted.status === 'OK') {
      expect(adopted.value.recovered).toMatchObject({ adopted_by_replacement: true });
    }
  });
});

describe('shell simulator: deterministic in-process execution with an injectable registry', () => {
  it('runs the built-ins deterministically and answers 127 for unknown commands', () => {
    const simulator = new ShellSimulator();
    const context = {
      taskRef: 't',
      readWorkspaceFile: (path: string) => (path === 'a.txt' ? 'contents' : null),
      listWorkspaceFiles: () => ['a.txt'],
      emitEvent: () => {},
    };
    expect(simulator.exec('echo', ['hello', 'world'], context)).toEqual({ exit_code: 0, stdout: 'hello world', stderr: '' });
    expect(simulator.exec('cat', ['a.txt'], context)).toEqual({ exit_code: 0, stdout: 'contents', stderr: '' });
    expect(simulator.exec('cat', ['missing.txt'], context).exit_code).toBe(1);
    expect(simulator.exec('ls', [], context).stdout).toBe('a.txt');
    expect(simulator.exec('pwd', [], context).stdout).toBe('/workspace');
    expect(simulator.exec('test', ['-f', 'a.txt'], context).exit_code).toBe(0);
    expect(simulator.exec('test', ['-f', 'nope'], context).exit_code).toBe(1);
    expect(simulator.exec('exit', ['3'], context).exit_code).toBe(3);
    const unknown = simulator.exec('definitely-not-a-command', [], context);
    expect(unknown.exit_code).toBe(127);
    expect(simulator.commandNames()).toEqual(builtinShellCommands().map((command) => command.name));
  });

  it('accepts an injectable custom command registry (no real process spawning anywhere)', () => {
    const simulator = new ShellSimulator([
      {
        name: 'deploy-check',
        run: (args) => ({ exit_code: 0, stdout: `deployment ${args.join('/')} verified (simulated)`, stderr: '' }),
      },
    ]);
    const context = { taskRef: 't', readWorkspaceFile: () => null, listWorkspaceFiles: () => [], emitEvent: () => {} };
    expect(simulator.exec('deploy-check', ['prod', 'eu'], context).stdout).toBe('deployment prod/eu verified (simulated)');
    expect(simulator.exec('echo', ['hi'], context).exit_code).toBe(127);
  });
});

describe('browser/evaluator body: typed-record browser journeys through the injectable port', () => {
  function browserBody() {
    return new BrowserEvaluatorBody({
      bodyId: 'browser-evaluator-1',
      browserPort: new ScriptedBrowserPort(),
      allowedHosts: ['example.com'],
    });
  }

  it('executes open -> interact(read) as typed records', () => {
    const body = browserBody();
    const harness = body as unknown as import('@sos-2/harness').HarnessContract;
    const taskRef = 'task-browser-0001';
    harness.createTask({ task_ref: taskRef, input: null });
    const opened = harness.browser.open({ task_ref: taskRef, url: 'https://example.com/status' });
    expect(opened).toMatchObject({ status: 'OK', value: { page_id: 'page-001', url: 'https://example.com/status', title: 'Example Status' } });
    if (opened.status === 'OK') {
      const read = harness.browser.interact({ task_ref: taskRef, page_id: opened.value.page_id, action: 'read', target: '#status', value: null });
      expect(read).toMatchObject({ status: 'OK', value: { result: 'all systems operational' } });
      const clicked = harness.browser.interact({ task_ref: taskRef, page_id: opened.value.page_id, action: 'click', target: '#refresh', value: null });
      expect(clicked.status).toBe('OK');
    }
    expect(body.dispatches.get('browser.open')).toBe(1);
    expect(body.dispatches.get('browser.interact')).toBe(2);
  });

  it('refuses navigation to hosts outside its declared network policy', () => {
    const body = browserBody();
    const harness = body as unknown as import('@sos-2/harness').HarnessContract;
    harness.createTask({ task_ref: 'task-nav-0001', input: null });
    const refused = harness.browser.open({ task_ref: 'task-nav-0001', url: 'https://evil.example.net/status' });
    expect(refused.status).toBe('FAILED');
    if (refused.status === 'FAILED') {
      expect(refused.error).toContain('not admitted');
    }
    expect(hostOfUrl('https://example.com/status')).toBe('example.com');
    expect(hostOfUrl('not-a-url')).toBeNull();
  });

  it('answers typed UNSUPPORTED for shell/git/workspace (explicit, never silent)', () => {
    const body = browserBody();
    const capabilities = body.capabilitiesValue;
    expect(capabilities.capabilities).toEqual(['browser-ui']);
    expect(capabilities.shell).toEqual([]);
    expect(capabilities.git).toEqual([]);
    expect(capabilities.filesystemScope.mode).toBe('none');
    const harness = body as unknown as import('@sos-2/harness').HarnessContract;
    harness.createTask({ task_ref: 'task-unsup-0001', input: null });
    expect(harness.shell.exec({ task_ref: 'task-unsup-0001', command: 'ls', args: [], cwd: null }).status).toBe('UNSUPPORTED');
    expect(harness.git.status({ task_ref: 'task-unsup-0001' }).status).toBe('UNSUPPORTED');
    expect(harness.workspace.read({ task_ref: 'task-unsup-0001', path: 'x' }).status).toBe('UNSUPPORTED');
    expect(harness.workspace.write({ task_ref: 'task-unsup-0001', path: 'x', content: 'y' }).status).toBe('UNSUPPORTED');
  });

  it('captures artifacts and emits observations like every contract body', () => {
    const body = browserBody();
    const harness = body as unknown as import('@sos-2/harness').HarnessContract;
    harness.createTask({ task_ref: 'task-ev-0001', input: null });
    harness.browser.open({ task_ref: 'task-ev-0001', url: 'https://example.com/status' });
    expect(harness.artifacts.capture({ task_ref: 'task-ev-0001', name: 'status-snapshot', content: 'operational' })).toMatchObject({
      status: 'OK',
      value: { artifact_id: 'task-ev-0001:artifact:status-snapshot' },
    });
    expect(harness.observations.emit({ task_ref: 'task-ev-0001', observation_kind: 'body.progress', payload: { page: 1 } })).toMatchObject({
      status: 'OK',
    });
    const events = harness.events.subscribe({ task_ref: 'task-ev-0001', filter: null, cursor: null });
    expect(events.status === 'OK' && events.value.events.map((event) => event.kind)).toContain('browser.opened');
  });
});

describe('GitHub-aware project body: typed records + honest NOT_YET_CONNECTED', () => {
  const REPOSITORY = { owner: 'acme', name: 'legacy-checkout' };
  const BASE_SHA = 'c0ffee10d5c0a11b2c3d4e5f60718293a4b5c6d7';

  function repositoryOperations() {
    return new InMemoryGitHubRepositoryOperations({
      repository: REPOSITORY,
      branches: [
        { name: 'main', head_sha: BASE_SHA, is_protected: true },
        { name: 'release/1.2', head_sha: 'dead00beef1234567890abcdef0123456789abcd', is_protected: true },
      ],
    });
  }

  function githubBody(operations = repositoryOperations()) {
    return new GitHubProjectBody({
      bodyId: 'github-project-1',
      repositoryOperations: operations,
      repository: REPOSITORY,
      baseBranch: 'main',
      baseSha: BASE_SHA,
      sandboxPolicy: {
        filesystem: { mode: 'workspace', root: '/workspace/github-project' },
        network: { egress: 'allowlist', allowedHosts: ['api.github.com'] },
        secrets: ['github-token'],
        budgets: { fileWrites: 10, fileBytes: 10_000, shellCommands: 10, networkCalls: 10, secretReveals: 10 },
        resourceEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 512 },
      },
      credentialName: 'github-token',
      secrets: { 'github-token': GITHUB_TOKEN_VALUE },
    });
  }

  it('fails provider-backed write operations truthfully while NOT_YET_CONNECTED (never fabricated)', () => {
    const body = githubBody();
    const harness = body as unknown as import('@sos-2/harness').HarnessContract;
    const taskRef = 'task-ghc-0001';
    harness.createTask({ task_ref: taskRef, input: null });
    harness.workspace.write({ task_ref: taskRef, path: 'src/patch.ts', content: 'export const patch = 1;\n' });
    const commit = harness.git.commit({ task_ref: taskRef, message: 'fix: patch', paths: [] });
    expect(commit.status).toBe('FAILED');
    if (commit.status === 'FAILED') {
      expect(commit.error).toContain('NOT_YET_CONNECTED');
      expect(commit.error).toContain('never fabricated');
    }
    const branch = harness.git.createBranch({ task_ref: taskRef, name: 'fix/patch', from_ref: null });
    expect(branch.status === 'FAILED' && branch.error).toContain('NOT_YET_CONNECTED');
    const push = harness.git.push({ task_ref: taskRef, remote: 'origin', ref: 'main' });
    expect(push.status === 'FAILED' && push.error).toContain('NOT_YET_CONNECTED');
    const pr = harness.git.createPullRequest({ task_ref: taskRef, title: 'fix', source_branch: 'fix/patch', target_branch: 'main' });
    expect(pr.status === 'FAILED' && pr.error).toContain('NOT_YET_CONNECTED');
    // The honest advertisement: the integration surface is NOT available while unconnected.
    const integration = body.capabilitiesValue.runtimeIntegrations[0];
    expect(integration?.integrations[0]?.available).toBe(false);
    // Body-side status/diff still answer honestly from the staging state.
    expect(harness.git.status({ task_ref: taskRef })).toMatchObject({ status: 'OK', value: { branch: 'main', changed: ['src/patch.ts'] } });
  });

  it('executes the connected repository journey as typed records (branch -> stage -> commit -> push -> PR)', () => {
    const operations = repositoryOperations();
    const connected = operations.completeConnection({ authorization_code: 'simulated-auth-code', completed_at: '2025-06-15T12:00:00Z' });
    expect(connected.status).toBe('CONNECTED');
    const body = githubBody(operations);
    const harness = body as unknown as import('@sos-2/harness').HarnessContract;
    const taskRef = 'task-gh-0001';

    expect(harness.createTask({ task_ref: taskRef, input: null }).status).toBe('OK');
    expect(harness.workspace.write({ task_ref: taskRef, path: 'src/checkout.ts', content: 'export const checkout = 2;\n' }).status).toBe('OK');

    const branch = harness.git.createBranch({ task_ref: taskRef, name: 'feature/checkout-v2', from_ref: null });
    expect(branch).toMatchObject({ status: 'OK', value: { branch: 'feature/checkout-v2' } });

    const commit = harness.git.commit({ task_ref: taskRef, message: 'feat: checkout v2', paths: [] });
    expect(commit.status).toBe('OK');
    if (commit.status === 'OK') {
      // The commit ref is the provider's typed record sha (a 40-hex ref).
      expect(commit.value.commit_ref).toMatch(/^[0-9a-f]{40}$/);
      expect(commit.value.files).toBe(1);
    }
    expect(harness.git.status({ task_ref: taskRef })).toMatchObject({ status: 'OK', value: { clean: true, changed: [] } });

    const push = harness.git.push({ task_ref: taskRef, remote: 'origin', ref: 'feature/checkout-v2' });
    expect(push).toMatchObject({ status: 'OK', value: { pushed_ref: 'origin/feature/checkout-v2' } });

    const pr = harness.git.createPullRequest({ task_ref: taskRef, title: 'feat: checkout v2', source_branch: 'feature/checkout-v2', target_branch: 'main' });
    expect(pr.status).toBe('OK');
    if (pr.status === 'OK') {
      expect(pr.value.pull_request_ref).toBe('pr-7');
      expect(pr.value.url).toContain('simulated.github.invalid');
    }

    // The provider state advanced: the branch head moved to the commit sha.
    const state = body.gitStateOf(taskRef);
    expect(state?.branch).toBe('feature/checkout-v2');
    expect(state?.commits.map((entry) => entry.message)).toEqual(['feat: checkout v2']);
    const providerBranch = operations.branchState().find((entry) => entry.name === 'feature/checkout-v2');
    expect(providerBranch?.head_sha).toBe(state?.headSha);
  });

  it('refuses a provider exchange past the network budget with the typed denial', () => {
    const operations = repositoryOperations();
    operations.completeConnection({ authorization_code: 'code', completed_at: '2025-06-15T12:00:00Z' });
    const body = new GitHubProjectBody({
      bodyId: 'github-project-budget',
      repositoryOperations: operations,
      repository: REPOSITORY,
      baseBranch: 'main',
      baseSha: BASE_SHA,
      sandboxPolicy: {
        filesystem: { mode: 'workspace', root: '/workspace/github-budget' },
        network: { egress: 'allowlist', allowedHosts: ['api.github.com'] },
        secrets: [],
        budgets: { fileWrites: 10, fileBytes: 10_000, shellCommands: 10, networkCalls: 1, secretReveals: 10 },
        resourceEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 512 },
      },
    });
    const harness = body as unknown as import('@sos-2/harness').HarnessContract;
    const taskRef = 'task-ghb-0001';
    harness.createTask({ task_ref: taskRef, input: null });
    expect(harness.git.createBranch({ task_ref: taskRef, name: 'x/one', from_ref: null }).status).toBe('OK');
    const denied = harness.git.createBranch({ task_ref: taskRef, name: 'x/two', from_ref: null });
    expect(denied.status).toBe('FAILED');
    if (denied.status === 'FAILED') {
      expect(denied.error).toContain('SANDBOX_BUDGET_EXCEEDED');
      expect(denied.error).toContain('networkCalls');
    }
  });

  it('advertises a narrower git capability when the seam supports fewer write operations', () => {
    const reduced = new InMemoryGitHubRepositoryOperations({
      repository: REPOSITORY,
      branches: [{ name: 'main', head_sha: BASE_SHA, is_protected: false }],
      supportedOperations: ['commitFiles'],
    });
    const body = githubBody(reduced);
    const capabilities = body.capabilitiesValue;
    expect(capabilities.git).toEqual(['status', 'diff', 'commit', 'push']);
    expect(capabilities.capabilities).toEqual(['filesystem', 'repository-operations', 'runtime-cloud-apis']);
    expect(isOperationAdvertised(capabilities, 'git.createBranch')).toBe(false);
    expect(isOperationAdvertised(capabilities, 'git.createPullRequest')).toBe(false);
    const harness = body as unknown as import('@sos-2/harness').HarnessContract;
    const refused = harness.git.createBranch({ task_ref: 'never-created', name: 'x', from_ref: null });
    expect(refused.status).toBe('UNSUPPORTED');
  });

  it('never echoes the credential value through any output (provider exchanges carry NAMES only)', () => {
    const operations = repositoryOperations();
    operations.completeConnection({ authorization_code: 'code', completed_at: '2025-06-15T12:00:00Z' });
    const body = githubBody(operations);
    const harness = body as unknown as import('@sos-2/harness').HarnessContract;
    const taskRef = 'task-ghs-0001';
    harness.createTask({ task_ref: taskRef, input: null });
    harness.workspace.write({ task_ref: taskRef, path: 'src/x.ts', content: 'x' });
    harness.git.commit({ task_ref: taskRef, message: 'm', paths: [] });
    const outputs = [
      JSON.stringify(harness.events.subscribe({ task_ref: taskRef, filter: null, cursor: null })),
      JSON.stringify(harness.git.status({ task_ref: taskRef })),
      JSON.stringify(body.capabilitiesValue),
      JSON.stringify(operations.connection()),
    ];
    for (const output of outputs) {
      expect(output).not.toContain(GITHUB_TOKEN_VALUE);
    }
  });

  it('construction is loud about dishonest policies (egress without the provider host)', () => {
    expect(
      () =>
        new GitHubProjectBody({
          bodyId: 'github-bad',
          repositoryOperations: repositoryOperations(),
          repository: REPOSITORY,
          baseBranch: 'main',
          baseSha: BASE_SHA,
          sandboxPolicy: {
            filesystem: { mode: 'workspace', root: '/workspace/x' },
            network: { egress: 'allowlist', allowedHosts: ['registry.npmjs.org'] },
            secrets: [],
            budgets: { fileWrites: 1, fileBytes: 100, shellCommands: 1, networkCalls: 1, secretReveals: 1 },
            resourceEnvelope: { maxDurationMs: 600_000, maxMemoryMb: 256 },
          },
        }),
    ).toThrowError(/provider host/);
  });
});
