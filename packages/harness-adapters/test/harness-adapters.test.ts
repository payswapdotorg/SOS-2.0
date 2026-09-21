/**
 * Deterministic harness-adapter tests (Work Order P8): the three §4
 * shapes over injectable transports, the honest advertisement gates, the
 * exact-field-set marshaling discipline (anti-smuggling), honest
 * connection statuses, the §4 tier selection (vendor-blind), and the
 * in-process bridges serving any HarnessContract through every shape.
 */

import { describe, expect, it } from 'vitest';
import { NativeApiHarnessAdapter } from '../src/shapes/native-api.js';
import type { NativeApiTransport } from '../src/shapes/native-api.js';
import { McpHarnessAdapter, harnessToolDescriptors, operationForToolName, toolNameForOperation } from '../src/shapes/mcp.js';
import type { McpProtocolTransport } from '../src/shapes/mcp.js';
import { LocalBridgeHarnessAdapter, bridgeCommandForOperation, operationForBridgeCommand } from '../src/shapes/local-bridge.js';
import type { LocalBridgeTransport } from '../src/shapes/local-bridge.js';
import { inProcessLocalBridgeTransport, inProcessMcpTransport, inProcessNativeApiTransport } from '../src/in-process.js';
import { selectHarnessAdapter } from '../src/adapter.js';
import type { HarnessAdapterSpec, HarnessProviderAdapter } from '../src/adapter.js';
import { ADAPTER_NOT_YET_CONNECTED, assertValidAdapterConnection, simulatedAdapterConnection } from '../src/status.js';
import { harnessReplyValueViolation, harnessRequestViolation } from '../src/transport.js';
import type { HarnessCapabilities, HarnessContract, HarnessOperationName, HarnessResult } from '@sos-2/harness';
import { harnessFailed, harnessOk } from '@sos-2/harness';

// ---------------------------------------------------------------------------
// A minimal deterministic fake body (a complete §9 HarnessContract).
// ---------------------------------------------------------------------------

const FAKE_CAPABILITIES: HarnessCapabilities = {
  capabilities: ['terminal', 'filesystem', 'repository-operations'],
  isolationLevel: 'process',
  networkPolicy: { egress: 'allowlist', allowedHosts: ['api.github.com'] },
  filesystemScope: { mode: 'workspace', root: '/workspace/fake' },
  browser: [],
  shell: ['exec'],
  git: ['status', 'diff', 'commit', 'push', 'createBranch', 'createPullRequest'],
  runtimeIntegrations: [],
  taskLifecycle: { create: true, resume: true, pause: true, cancel: true, checkpoints: true },
  evidenceCapture: { artifacts: true, observations: true, events: true },
  costEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 512, maxCostUsdPerTask: null },
};

function fakeBody(): HarnessContract {
  return {
    identity: () => ({ harness_id: 'harness:fake-body', provider: { name: 'fake', version: '1.0.0' }, placement: 'cloud' }),
    capabilities: () => FAKE_CAPABILITIES,
    createTask: (request) => harnessOk({ accepted: true, workspace_root: `/workspace/fake/${request.task_ref}` }),
    resumeTask: () => harnessOk({ state: 'resumed', recovered: null }),
    pauseTask: () => harnessOk({ state: 'paused' }),
    cancelTask: () => harnessOk({ state: 'cancelled' }),
    workspace: {
      read: () => harnessOk({ content: 'file-content' }),
      write: (request) => harnessOk({ bytes: request.content.length }),
    },
    shell: {
      exec: (request) => harnessOk({ exit_code: 0, stdout: `ran ${request.command}`, stderr: '' }),
    },
    browser: {
      open: () => harnessFailed('no browser on the fake body'),
      interact: () => harnessFailed('no browser on the fake body'),
    },
    git: {
      status: () => harnessOk({ branch: 'main', clean: true, changed: [] }),
      diff: () => harnessOk({ diff: '' }),
      commit: (request) => harnessOk({ commit_ref: `commit-for-${request.message.length}`, files: 1 }),
      push: (request) => harnessOk({ pushed_ref: `${request.remote}/${request.ref}` }),
      createBranch: (request) => harnessOk({ branch: request.name }),
      createPullRequest: (request) => harnessOk({ pull_request_ref: 'pr-001', url: null }),
    },
    artifacts: {
      capture: (request) => harnessOk({ artifact_id: `art:${request.name}`, size_bytes: request.content.length, description: null }),
    },
    observations: {
      emit: () => harnessOk({ accepted: true }),
    },
    events: {
      subscribe: () => harnessOk({ events: [], next_cursor: null }),
    },
  };
}

function spec(overrides: Partial<HarnessAdapterSpec> = {}): HarnessAdapterSpec {
  return {
    adapterId: 'adapter-test-1',
    provider: { name: 'acme-runners', version: '2.0.0' },
    placement: 'cloud',
    capabilities: FAKE_CAPABILITIES,
    connection: simulatedAdapterConnection(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Status honesty
// ---------------------------------------------------------------------------

describe('adapter connection statuses (honest, never fabricated)', () => {
  it('carries the honest NOT_YET_CONNECTED default for real providers', () => {
    expect(ADAPTER_NOT_YET_CONNECTED.status).toBe('NOT_YET_CONNECTED');
    expect(ADAPTER_NOT_YET_CONNECTED.simulated).toBe(false);
    expect(ADAPTER_NOT_YET_CONNECTED.note).toContain('never fabricated');
    assertValidAdapterConnection(ADAPTER_NOT_YET_CONNECTED);
  });

  it('marks simulated reference connections explicitly', () => {
    const simulated = simulatedAdapterConnection();
    expect(simulated.status).toBe('CONNECTED');
    expect(simulated.simulated).toBe(true);
    expect(simulated.note).toContain('SIMULATED');
  });
});

// ---------------------------------------------------------------------------
// The three shapes over injectable transports
// ---------------------------------------------------------------------------

describe('native-api adapter (§4 tier 1): the SDK-shaped typed surface', () => {
  it('delegates the §9 contract through the transport, gated by the advertisement', () => {
    const calls: string[] = [];
    const transport: NativeApiTransport = {
      createTask: (request) => {
        calls.push(`createTask:${request.task_ref}`);
        return harnessOk({ accepted: true, workspace_root: `/workspace/native/${request.task_ref}` });
      },
      resumeTask: () => harnessOk({ state: 'resumed', recovered: null }),
      pauseTask: () => harnessOk({ state: 'paused' }),
      cancelTask: () => harnessOk({ state: 'cancelled' }),
      workspace: {
        read: () => harnessOk({ content: 'x' }),
        write: (request) => harnessOk({ bytes: request.content.length }),
      },
      shell: { exec: (request) => harnessOk({ exit_code: 0, stdout: request.command, stderr: '' }) },
      browser: {
        open: () => harnessFailed('no browser'),
        interact: () => harnessFailed('no browser'),
      },
      git: {
        status: () => harnessOk({ branch: 'main', clean: true, changed: [] }),
        diff: () => harnessOk({ diff: '' }),
        commit: () => harnessOk({ commit_ref: 'c1', files: 1 }),
        push: () => harnessOk({ pushed_ref: 'origin/main' }),
        createBranch: (request) => harnessOk({ branch: request.name }),
        createPullRequest: () => harnessOk({ pull_request_ref: 'pr-1', url: null }),
      },
      artifacts: { capture: () => harnessOk({ artifact_id: 'a1', size_bytes: 1, description: null }) },
      observations: { emit: () => harnessOk({ accepted: true }) },
      events: { subscribe: () => harnessOk({ events: [], next_cursor: null }) },
    };
    const adapter = new NativeApiHarnessAdapter(transport, spec());
    expect(adapter.tier()).toBe('native-api');
    expect(adapter.descriptor()).toMatchObject({
      adapter_id: 'adapter-test-1',
      tier: 'native-api',
      provider: { name: 'acme-runners', version: '2.0.0' },
      placement: 'cloud',
    });
    const harness = adapter.harness();
    const created = harness.createTask({ task_ref: 'task-a', input: null });
    expect(created).toMatchObject({ status: 'OK', value: { workspace_root: '/workspace/native/task-a' } });
    expect(calls).toEqual(['createTask:task-a']);
    // The advertisement gate: browser is NOT advertised -> typed UNSUPPORTED
    // (never dispatched to the transport).
    const refused = harness.browser.open({ task_ref: 'task-a', url: 'https://example.com' });
    expect(refused.status).toBe('UNSUPPORTED');
    if (refused.status === 'UNSUPPORTED') {
      expect(refused.operation).toBe('browser.open');
    }
    expect(adapter.identity().harness_id).toBe('adapter:adapter-test-1');
    expect(adapter.capabilities()).toBe(FAKE_CAPABILITIES);
  });
});

describe('mcp adapter (§4 tier 2): the tool-protocol surface', () => {
  it('maps §9 operations onto tool names and back (bijective within the vocabulary)', () => {
    for (const descriptor of harnessToolDescriptors()) {
      const operation = operationForToolName(descriptor.name);
      expect(operation).not.toBeNull();
      expect(toolNameForOperation(operation!)).toBe(descriptor.name);
    }
    expect(operationForToolName('not-a-tool')).toBeNull();
    expect(toolNameForOperation('workspace.read')).toBe('workspace__read');
  });

  it('marshals typed requests onto callTool and validates reply values', () => {
    const seen: { name: string; arguments: unknown }[] = [];
    const transport: McpProtocolTransport = {
      listTools: () => harnessToolDescriptors(),
      callTool: (call) => {
        seen.push({ name: call.name, arguments: call.arguments });
        if (call.name === 'workspace__write') {
          return { status: 'OK', result: { bytes: 42 } };
        }
        if (call.name === 'shell__exec') {
          return { status: 'ERROR', message: 'the provider shell exploded' };
        }
        if (call.name === 'git__commit') {
          return { status: 'UNSUPPORTED_TOOL', message: 'commit tool is disabled on this provider' };
        }
        if (call.name === 'git__push') {
          // A malformed reply value: the adapter must answer a truthful FAILED.
          return { status: 'OK', result: { pushed_ref: '' } };
        }
        return { status: 'OK', result: { accepted: true, workspace_root: null } };
      },
    };
    const adapter = new McpHarnessAdapter(transport, spec());
    const harness = adapter.harness();

    expect(harness.workspace.write({ task_ref: 't1', path: 'a.txt', content: '0123456789' })).toMatchObject({
      status: 'OK',
      value: { bytes: 42 },
    });
    expect(seen.at(-1)).toMatchObject({ name: 'workspace__write', arguments: { task_ref: 't1', path: 'a.txt', content: '0123456789' } });

    const errored = harness.shell.exec({ task_ref: 't1', command: 'ls', args: [], cwd: null });
    expect(errored.status).toBe('FAILED');
    if (errored.status === 'FAILED') {
      expect(errored.error).toContain('the provider shell exploded');
    }

    const unsupported = harness.git.commit({ task_ref: 't1', message: 'm', paths: [] });
    expect(unsupported.status).toBe('UNSUPPORTED');
    if (unsupported.status === 'UNSUPPORTED') {
      expect(unsupported.reason).toContain('commit tool is disabled');
    }

    const malformed = harness.git.push({ task_ref: 't1', remote: 'origin', ref: 'main' });
    expect(malformed.status).toBe('FAILED');
    if (malformed.status === 'FAILED') {
      expect(malformed.error).toContain('malformed transport reply');
    }
  });
});

describe('local-bridge adapter (§4 tier 3): the companion/service-bridge surface', () => {
  it('maps §9 operations onto bridge commands and validates reply bodies', () => {
    expect(bridgeCommandForOperation('workspace.read')).toBe('harness.workspace.read');
    expect(operationForBridgeCommand('harness.workspace.read')).toBe('workspace.read');
    expect(operationForBridgeCommand('harness.nope')).toBeNull();
    expect(operationForBridgeCommand('other.command')).toBeNull();

    const transport: LocalBridgeTransport = {
      dispatch: (command) => {
        if (command.command === 'harness.workspace.read') {
          return { status: 'OK', body: { content: 'bridge-content' } };
        }
        if (command.command === 'harness.createTask') {
          return { status: 'ERROR', message: 'the companion refused to summon a body' };
        }
        if (command.command === 'harness.observations.emit') {
          return { status: 'UNKNOWN_COMMAND', message: 'the companion has no observation emitter' };
        }
        return { status: 'OK', body: null };
      },
    };
    const adapter = new LocalBridgeHarnessAdapter(transport, spec());
    const harness = adapter.harness();
    expect(harness.workspace.read({ task_ref: 't2', path: 'a' })).toMatchObject({ status: 'OK', value: { content: 'bridge-content' } });
    const errored = harness.createTask({ task_ref: 't2', input: null });
    expect(errored.status === 'FAILED' && errored.error).toContain('companion refused');
    const unsupported = harness.observations.emit({ task_ref: 't2', observation_kind: 'k', payload: {} });
    expect(unsupported.status).toBe('UNSUPPORTED');
  });
});

// ---------------------------------------------------------------------------
// The §4 tier selection (deterministic, vendor-blind)
// ---------------------------------------------------------------------------

describe('§4 tier selection: the highest available control surface wins, vendor-blind', () => {
  function adapterOf(tier: 'native-api' | 'mcp-protocol' | 'local-bridge', adapterId: string, providerName: string, connection = simulatedAdapterConnection()): HarnessProviderAdapter {
    const adapterSpec = spec({ adapterId, provider: { name: providerName, version: '1.0.0' }, connection });
    const body = fakeBody();
    if (tier === 'native-api') {
      return new NativeApiHarnessAdapter(inProcessNativeApiTransport(body), adapterSpec);
    }
    if (tier === 'mcp-protocol') {
      return new McpHarnessAdapter(inProcessMcpTransport(body), adapterSpec);
    }
    return new LocalBridgeHarnessAdapter(inProcessLocalBridgeTransport(body), adapterSpec);
  }

  it('prefers native-api over mcp-protocol over local-bridge', () => {
    const selection = selectHarnessAdapter([
      adapterOf('local-bridge', 'adapter-bridge-1', 'companion-vendor'),
      adapterOf('mcp-protocol', 'adapter-mcp-1', 'mcp-vendor'),
      adapterOf('native-api', 'adapter-native-1', 'sdk-vendor'),
    ]);
    expect(selection.status).toBe('SELECTED');
    if (selection.status === 'SELECTED') {
      expect(selection.adapter.tier()).toBe('native-api');
      expect(selection.reason).toContain('§4 tier selection');
    }
    const fallback = selectHarnessAdapter([adapterOf('local-bridge', 'b', 'v'), adapterOf('mcp-protocol', 'm', 'v')]);
    expect(fallback.status === 'SELECTED' && fallback.adapter.tier()).toBe('mcp-protocol');
  });

  it('never selects a NOT_YET_CONNECTED adapter and answers honestly when none is available', () => {
    const notConnected = adapterOf('native-api', 'adapter-real-1', 'real-vendor', ADAPTER_NOT_YET_CONNECTED);
    const bridge = adapterOf('local-bridge', 'adapter-bridge-1', 'companion-vendor');
    const selection = selectHarnessAdapter([notConnected, bridge]);
    expect(selection.status === 'SELECTED' && selection.adapter.tier()).toBe('local-bridge');
    const none = selectHarnessAdapter([notConnected]);
    expect(none.status).toBe('UNAVAILABLE');
    if (none.status === 'UNAVAILABLE') {
      expect(none.reason).toContain('never fabricated');
    }
  });

  it('is invariant under provider-name flips (vendor identity is never a selection key)', () => {
    const adaptersA = [adapterOf('mcp-protocol', 'adapter-mcp-1', 'vendor-one'), adapterOf('local-bridge', 'adapter-bridge-1', 'vendor-two')];
    const adaptersB = [adapterOf('mcp-protocol', 'adapter-mcp-1', 'TOTALLY-different-vendor'), adapterOf('local-bridge', 'adapter-bridge-1', 'another-vendor')];
    const selectionA = selectHarnessAdapter(adaptersA);
    const selectionB = selectHarnessAdapter(adaptersB);
    expect(selectionA.status === 'SELECTED' && selectionA.adapter.descriptor().adapter_id).toBe(
      selectionB.status === 'SELECTED' && selectionB.adapter.descriptor().adapter_id,
    );
    expect(selectionA.status === 'SELECTED' && selectionA.adapter.tier()).toBe('mcp-protocol');
  });

  it('filters by the required §9 operation (the advertisement must carry it)', () => {
    const narrowed: HarnessCapabilities = {
      ...FAKE_CAPABILITIES,
      capabilities: ['filesystem'],
      shell: [],
      git: [],
    };
    const nativeWithNarrow = new NativeApiHarnessAdapter(inProcessNativeApiTransport(fakeBody()), spec({ adapterId: 'adapter-narrow', capabilities: narrowed }));
    const bridgeFull = adapterOf('local-bridge', 'adapter-bridge-full', 'v');
    const selection = selectHarnessAdapter([nativeWithNarrow, bridgeFull], { operation: 'shell.exec' });
    expect(selection.status === 'SELECTED' && selection.adapter.tier()).toBe('local-bridge');
    const forRead = selectHarnessAdapter([nativeWithNarrow, bridgeFull], { operation: 'workspace.read' });
    expect(forRead.status === 'SELECTED' && forRead.adapter.tier()).toBe('native-api');
  });
});

// ---------------------------------------------------------------------------
// The in-process bridges: any HarnessContract through every shape
// ---------------------------------------------------------------------------

const SHARED_BODY = fakeBody();

describe('in-process bridges: one contract, every adapter shape (real endpoints attach later without contract change)', () => {
  const body = SHARED_BODY;

  it('serves the full §9 surface through the native-api shape', () => {
    const adapter = new NativeApiHarnessAdapter(inProcessNativeApiTransport(body), spec({ adapterId: 'adapter-ip-native' }));
    const harness = adapter.harness();
    expect(harness.createTask({ task_ref: 't3', input: null })).toMatchObject({ status: 'OK', value: { workspace_root: '/workspace/fake/t3' } });
    expect(harness.workspace.read({ task_ref: 't3', path: 'x' })).toMatchObject({ status: 'OK', value: { content: 'file-content' } });
    expect(harness.shell.exec({ task_ref: 't3', command: 'ls', args: [], cwd: null })).toMatchObject({ status: 'OK', value: { stdout: 'ran ls' } });
    expect(harness.git.commit({ task_ref: 't3', message: 'five', paths: [] })).toMatchObject({ status: 'OK', value: { commit_ref: 'commit-for-4' } });
  });

  it('serves the full §9 surface through the mcp shape (tool list mirrors the advertisement)', () => {
    const transport = inProcessMcpTransport(body);
    const listed = transport.listTools().map((tool) => tool.name);
    expect(listed).toContain('workspace__read');
    expect(listed).toContain('git__commit');
    expect(listed).not.toContain('browser__open'); // NOT advertised -> not listed (honest)
    const adapter = new McpHarnessAdapter(transport, spec({ adapterId: 'adapter-ip-mcp' }));
    const harness = adapter.harness();
    expect(harness.createTask({ task_ref: 't4', input: null })).toMatchObject({ status: 'OK' });
    expect(harness.workspace.write({ task_ref: 't4', path: 'p', content: '12345' })).toMatchObject({ status: 'OK', value: { bytes: 5 } });
    expect(harness.browser.open({ task_ref: 't4', url: 'https://x' }).status).toBe('UNSUPPORTED');
  });

  it('serves the full §9 surface through the local-bridge shape', () => {
    const transport = inProcessLocalBridgeTransport(body);
    const adapter = new LocalBridgeHarnessAdapter(transport, spec({ adapterId: 'adapter-ip-bridge' }));
    const harness = adapter.harness();
    expect(harness.createTask({ task_ref: 't5', input: null })).toMatchObject({ status: 'OK' });
    expect(harness.git.createBranch({ task_ref: 't5', name: 'x/y', from_ref: null })).toMatchObject({ status: 'OK', value: { branch: 'x/y' } });
    expect(harness.artifacts.capture({ task_ref: 't5', name: 'n', content: 'cc' })).toMatchObject({ status: 'OK', value: { size_bytes: 2 } });
  });

  it('round-trips an adapter-served body through ALL THREE shapes with identical §9 outcomes', () => {
    const request = { task_ref: 't6', path: 'same.txt', content: 'identical' } as const;
    const outcomes: unknown[] = [];
    for (const adapter of [
      new NativeApiHarnessAdapter(inProcessNativeApiTransport(body), spec({ adapterId: 'rt-native' })),
      new McpHarnessAdapter(inProcessMcpTransport(body), spec({ adapterId: 'rt-mcp' })),
      new LocalBridgeHarnessAdapter(inProcessLocalBridgeTransport(body), spec({ adapterId: 'rt-bridge' })),
    ]) {
      outcomes.push(adapter.harness().workspace.write(request));
    }
    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(outcomes[1]).toEqual(outcomes[2]);
    expect(outcomes[0]).toMatchObject({ status: 'OK', value: { bytes: 9 } });
  });
});

// ---------------------------------------------------------------------------
// The marshaling discipline (anti-smuggling + typed replies)
// ---------------------------------------------------------------------------

describe('the adapter seam carries NO authority (exact field sets, typed replies)', () => {
  it('rejects a smuggled authority field on any §9 request, naming it loudly', () => {
    const violation = harnessRequestViolation('shell.exec', {
      task_ref: 't',
      command: 'ls',
      args: [],
      cwd: null,
      grant: 'sos://AuthorityGrant/deadbeef',
    });
    expect(violation).toContain('grant');
    expect(violation).toContain('NO authority');
    expect(harnessRequestViolation('git.commit', { task_ref: 't', message: 'm', paths: [], permission: 'REVISE' })).toContain('permission');
  });

  it('validates every well-formed request and reply shape', () => {
    expect(harnessRequestViolation('shell.exec', { task_ref: 't', command: 'ls', args: [], cwd: null })).toBeNull();
    expect(harnessRequestViolation('createTask', { task_ref: 't', input: null })).toBeNull();
    expect(harnessRequestViolation('events.subscribe', { task_ref: 't', filter: null, cursor: null })).toBeNull();
    expect(harnessRequestViolation('git.commit', { task_ref: 't', message: '', paths: [] })).toContain('message');

    expect(harnessReplyValueViolation('createTask', { accepted: true, workspace_root: null })).toBeNull();
    expect(harnessReplyValueViolation('shell.exec', { exit_code: 0, stdout: '', stderr: '' })).toBeNull();
    expect(harnessReplyValueViolation('events.subscribe', { events: [{ event_id: 'e', kind: 'k', payload: {} }], next_cursor: null })).toBeNull();
    expect(harnessReplyValueViolation('git.commit', { commit_ref: '', files: 1 })).toContain('commit_ref');
    expect(harnessReplyValueViolation('artifacts.capture', { artifact_id: 'a', size_bytes: -1, description: null })).toContain('size_bytes');
  });

  it('the in-process transports refuse smuggled requests at the seam (never dispatched)', () => {
    const transport = inProcessMcpTransport(SHARED_BODY);
    const reply = transport.callTool({
      name: 'shell__exec',
      arguments: { task_ref: 't', command: 'ls', args: [], cwd: null, authority: 'forged' },
    });
    expect(reply.status).toBe('ERROR');
    if (reply.status === 'ERROR') {
      expect(reply.message).toContain('authority');
    }
    const bridge = inProcessLocalBridgeTransport(SHARED_BODY);
    const bridgeReply = bridge.dispatch({ command: 'harness.workspace.write', body: { task_ref: 't', path: 'p', content: 'c', grant: 'x' } });
    expect(bridgeReply.status).toBe('ERROR');
  });
});

// ---------------------------------------------------------------------------
// Spec validation
// ---------------------------------------------------------------------------

describe('adapter spec validation is loud', () => {
  it('rejects malformed specs and spine-shaped adapter ids', () => {
    expect(() => new NativeApiHarnessAdapter(inProcessNativeApiTransport(SHARED_BODY), spec({ adapterId: 'sos://Mission/abcd' } as never))).toThrowError(/sos:\/\/ semantic reference/);
    expect(() => new McpHarnessAdapter(inProcessMcpTransport(SHARED_BODY), spec({ connection: { status: 'FAKE' } as never }))).toThrowError(/status/);
    expect(() => new LocalBridgeHarnessAdapter(inProcessLocalBridgeTransport(SHARED_BODY), spec({ capabilities: null as never }))).toThrowError();
    expect(() => new NativeApiHarnessAdapter({} as never, spec())).toThrowError(/NativeApiTransport/);
  });
});
