/**
 * Local-companion contract tests (Work Order P11): pairing/session (names
 * only — values never echo), granted-scope enforcement, process
 * allowlist, the durable local event log, offline queueing semantics,
 * reconciliation (exactly-once, gap-free), and the §9 harness body.
 */

import { describe, expect, it } from 'vitest';
import {
  InMemoryCredentialStore,
  InMemoryLocalEventLog,
  InMemoryLocalFilePort,
  LocalCompanion,
  LocalCompanionBody,
  OfflineWorkQueue,
  ReferencePairingAuthority,
  SimulatedLocalProcess,
  reconcileLocalEventLog,
  resolveScopedPath,
} from '../src/index.js';
import type { CompanionScopeGrant, LocalEventLog, LocalWorkOrder } from '../src/index.js';
import { ManualClock, createInMemoryLiveStore } from '@sos-2/live-store';

const T0 = Date.parse('2026-01-15T09:00:00Z');
const SECRET_SESSION_TOKEN_HINT = 'reference-session-token-';

/** The reference scope grant used across these tests. */
const REFERENCE_GRANT: CompanionScopeGrant = {
  grant_id: 'grant-local-workspace',
  roots: [
    { name: 'acme', mode: 'read-write' },
    { name: 'notes', mode: 'read' },
  ],
  process_allowlist: ['echo', 'cat', 'ls', 'pwd'],
  granted_by: 'user:pairing',
  granted_at: '2026-01-15T09:00:00Z',
  expires_at: null,
};

function companionFixture(options: { grants?: readonly CompanionScopeGrant[]; sessionDurationMs?: number | null } = {}) {
  const clock = new ManualClock(T0);
  const credentials = new InMemoryCredentialStore();
  const authority = new ReferencePairingAuthority([
    {
      code: 'pair-local-0001',
      scopes: options.grants ?? [REFERENCE_GRANT],
      sessionDurationMs: options.sessionDurationMs ?? null,
    },
  ]);
  const filePort = new InMemoryLocalFilePort();
  filePort.seed({ 'acme/README.md': '# acme workspace\n', 'notes/private.txt': 'private notes\n', 'outside/secret.txt': 'never visible\n' });
  const processSeam = new SimulatedLocalProcess();
  const companion = new LocalCompanion({
    deviceId: 'device-reference-0001',
    deviceLabel: 'reference laptop',
    pairingAuthority: authority,
    credentials,
    files: filePort,
    process: processSeam,
    clock,
  });
  return { clock, companion, credentials, authority, filePort, processSeam };
}

function pairedCompanion(options: { grants?: readonly CompanionScopeGrant[]; sessionDurationMs?: number | null } = {}) {
  const fixture = companionFixture(options);
  const paired = fixture.companion.pair({ pairing_code: 'pair-local-0001', device_id: 'device-reference-0001', device_label: 'reference laptop' });
  expect(paired.status).toBe('PAIRED');
  return fixture;
}

describe('pairing + session contract', () => {
  it('pairs through the injected authority and returns the SESSION RECORD (token NAME only)', () => {
    const { companion } = pairedCompanion();
    const status = companion.session();
    expect(status.status).toBe('ACTIVE');
    if (status.status === 'ACTIVE') {
      expect(status.session.session_id).toBe('companion-session-0001');
      expect(status.session.token_name).toBe('companion-session-token:companion-session-0001');
      expect(status.session.scopes.map((grant) => grant.grant_id)).toEqual(['grant-local-workspace']);
    }
  });

  it('a refused pairing code is a typed DENIED outcome — never a fabricated session', () => {
    const { companion } = companionFixture();
    const outcome = companion.pair({ pairing_code: 'pair-wrong-code', device_id: 'device-reference-0001', device_label: 'reference laptop' });
    expect(outcome.status).toBe('DENIED');
    if (outcome.status === 'DENIED') {
      expect(outcome.reason).toContain('does not know pairing code');
    }
    expect(companion.session().status).toBe('UNPAIRED');
  });

  it('an expired session authorizes NOTHING (re-evaluated per access against the injected clock)', () => {
    const { clock, companion } = pairedCompanion({ sessionDurationMs: 60_000 });
    expect(companion.session().status).toBe('ACTIVE');
    clock.advance(61_000);
    expect(companion.session().status).toBe('EXPIRED');
    const read = companion.files.read({ path: 'acme/README.md' });
    expect(read.status).toBe('DENIED');
    if (read.status === 'DENIED') {
      expect(read.denial.code).toBe('COMPANION_UNAUTHENTICATED');
    }
  });

  it('endSession drops the credential and later operations are typed denials', () => {
    const { companion, credentials } = pairedCompanion();
    companion.endSession('user signed out');
    expect(companion.session().status).toBe('UNPAIRED');
    expect(credentials.names()).toEqual([]);
    const write = companion.files.write({ path: 'acme/x.txt', content: 'x' });
    expect(write.status).toBe('DENIED');
    if (write.status === 'DENIED') {
      expect(write.denial.code).toBe('COMPANION_UNAUTHENTICATED');
    }
  });

  it('the session token VALUE never echoes — only the NAME appears in every record', () => {
    const { companion, credentials } = pairedCompanion();
    const names = credentials.names();
    expect(names).toContain('companion-session-token:companion-session-0001');
    // Every serialized surface of the companion: session record, event log,
    // observations, results — scan for the token value prefix.
    const status = companion.session();
    const serialized = JSON.stringify({ status, events: companion.eventLog.events() });
    expect(serialized).not.toContain(SECRET_SESSION_TOKEN_HINT);
    // And operations keep working with the value hidden in the store.
    const read = companion.files.read({ path: 'acme/README.md' });
    expect(read.status).toBe('OK');
  });
});

describe('granted-scope enforcement (typed COMPANION_SCOPE_DENIED denials)', () => {
  it('in-scope reads and writes succeed through the injectable file port', () => {
    const { companion } = pairedCompanion();
    const read = companion.files.read({ path: 'acme/README.md' });
    expect(read.status).toBe('OK');
    if (read.status === 'OK') {
      expect(read.value.content).toBe('# acme workspace\n');
    }
    const write = companion.files.write({ path: 'acme/src/new-file.ts', content: 'export const x = 1;\n' });
    expect(write.status).toBe('OK');
    if (write.status === 'OK') {
      expect(write.value.bytes).toBe(20);
    }
  });

  it('out-of-scope roots, absolute paths and ".." escapes are typed denials — never silent, never a crash', () => {
    const { companion } = pairedCompanion();
    for (const path of ['outside/secret.txt', '/etc/passwd', 'acme/../../secret', 'acme/../notes/private.txt', 'unknown-root/file.txt', '']) {
      const read = companion.files.read({ path });
      expect(read.status, `path ${path} must be denied`).toBe('DENIED');
      if (read.status === 'DENIED') {
        expect(read.denial.code).toBe('COMPANION_SCOPE_DENIED');
        expect(read.denial.subject).toBe(path);
      }
    }
  });

  it('writing a READ-ONLY granted root is an un-granted consequential operation (typed denial)', () => {
    const { companion } = pairedCompanion();
    const write = companion.files.write({ path: 'notes/new-note.txt', content: 'x' });
    expect(write.status).toBe('DENIED');
    if (write.status === 'DENIED') {
      expect(write.denial.code).toBe('COMPANION_SCOPE_DENIED');
      expect(write.denial.reason).toContain('read-only');
    }
    // Reading the read-only root still works.
    const read = companion.files.read({ path: 'notes/private.txt' });
    expect(read.status).toBe('OK');
  });

  it('an EXPIRED scope grant authorizes NOTHING (grants are re-evaluated before consequential operations)', () => {
    const expiring: CompanionScopeGrant = {
      ...REFERENCE_GRANT,
      grant_id: 'grant-expiring',
      expires_at: '2026-01-15T10:00:00Z',
    };
    const { clock, companion } = pairedCompanion({ grants: [expiring] });
    expect(companion.files.read({ path: 'acme/README.md' }).status).toBe('OK');
    clock.advance(3_600_001);
    const read = companion.files.read({ path: 'acme/README.md' });
    expect(read.status).toBe('DENIED');
    if (read.status === 'DENIED') {
      expect(read.denial.code).toBe('COMPANION_SCOPE_DENIED');
      expect(read.denial.reason).toContain('no granted scope covers root');
    }
  });

  it('listing shows ONLY granted roots (port content outside scope is invisible)', () => {
    const { companion } = pairedCompanion();
    const list = companion.files.list();
    expect(list.status).toBe('OK');
    if (list.status === 'OK') {
      expect(list.value.paths).toEqual(['acme/README.md', 'notes/private.txt']);
    }
  });

  it('resolveScopedPath validates the pure scope check directly', () => {
    expect(resolveScopedPath([REFERENCE_GRANT], 'acme/a/b.ts', 'read').status).toBe('OK');
    expect(resolveScopedPath([REFERENCE_GRANT], 'notes/a.txt', 'write').status).toBe('DENIED');
    expect(resolveScopedPath([], 'acme/a.ts', 'read').status).toBe('DENIED');
    expect(resolveScopedPath([REFERENCE_GRANT], 'acme//double', 'read').status).toBe('DENIED');
    expect(resolveScopedPath([REFERENCE_GRANT], 'acme/.', 'read').status).toBe('DENIED');
  });
});

describe('local process integration (typed records through the injectable LocalProcess seam)', () => {
  it('granted commands execute deterministically through the simulated seam (zero real spawning)', () => {
    const { companion } = pairedCompanion();
    const exec = companion.process.exec({ command: 'echo', args: ['hello', 'local'], cwd: null });
    expect(exec.status).toBe('OK');
    if (exec.status === 'OK') {
      expect(exec.value.exit_code).toBe(0);
      expect(exec.value.stdout).toBe('hello local');
    }
    const cat = companion.process.exec({ command: 'cat', args: ['acme/README.md'], cwd: null });
    expect(cat.status).toBe('OK');
    if (cat.status === 'OK') {
      expect(cat.value.stdout).toBe('# acme workspace\n');
    }
  });

  it('un-granted consequential operations are typed COMPANION_PROCESS_DENIED denials', () => {
    const { companion } = pairedCompanion();
    const exec = companion.process.exec({ command: 'rm', args: ['-rf', '/'], cwd: null });
    expect(exec.status).toBe('DENIED');
    if (exec.status === 'DENIED') {
      expect(exec.denial.code).toBe('COMPANION_PROCESS_DENIED');
      expect(exec.denial.subject).toBe('rm');
    }
    const unknown = companion.process.exec({ command: 'curl', args: ['https://evil.example'], cwd: null });
    expect(unknown.status).toBe('DENIED');
    if (unknown.status === 'DENIED') {
      expect(unknown.denial.code).toBe('COMPANION_PROCESS_DENIED');
    }
  });

  it('an empty process allowlist denies every command (the honest no-grant state)', () => {
    const noProcess: CompanionScopeGrant = { ...REFERENCE_GRANT, process_allowlist: [] };
    const { companion } = pairedCompanion({ grants: [noProcess] });
    const exec = companion.process.exec({ command: 'echo', args: [], cwd: null });
    expect(exec.status).toBe('DENIED');
    if (exec.status === 'DENIED') {
      expect(exec.denial.code).toBe('COMPANION_PROCESS_DENIED');
    }
  });
});

describe('the durable local event log + provenance labelling', () => {
  it('every local observation names the local source + device identity (contiguous sequences)', () => {
    const { companion } = pairedCompanion();
    companion.files.read({ path: 'acme/README.md' });
    companion.process.exec({ command: 'echo', args: [], cwd: null });
    const events = companion.eventLog.events();
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
    for (const event of events) {
      expect(event.device_id).toBe('device-reference-0001');
      expect(event.provenance).toContain(event.source);
      expect(event.provenance).toContain('device:device-reference-0001');
      expect(event.provenance).toContain('producer:local-companion@1.0.0');
      expect(event.provenance.every((label) => typeof label === 'string' && label.length > 0)).toBe(true);
    }
    expect(events[0]?.kind).toBe('local.session.paired');
    expect(events[1]?.kind).toBe('local.workspace.read');
    expect(events[2]?.kind).toBe('local.process.executed');
  });

  it('scope denials are logged as observations too (never silent)', () => {
    const { companion } = pairedCompanion();
    companion.files.read({ path: 'outside/secret.txt' });
    const last = companion.eventLog.events().at(-1);
    expect(last?.kind).toBe('local.scope.denied');
    expect(last?.source).toBe('local-companion:filesystem');
    if (last !== undefined) {
      const payload = last.payload as Record<string, unknown>;
      expect(payload['code']).toBe('COMPANION_SCOPE_DENIED');
    }
  });
});

describe('offline queueing (the mechanism)', () => {
  it('local work orders queue and release FIFO — nothing lost, nothing duplicated', () => {
    const queue = new OfflineWorkQueue();
    const orderA: LocalWorkOrder = { task_id: 'task-local-a', mission_ref: null, plan: { kind: 'local' }, grant_refs: ['grant-1'], holder: 'spirit:persistent', expires_at: null, steps: [{ kind: 'workspace.write', path: 'acme/a.txt', content: 'a' }] };
    const orderB: LocalWorkOrder = { task_id: 'task-local-b', mission_ref: null, plan: { kind: 'local' }, grant_refs: ['grant-1'], holder: 'spirit:persistent', expires_at: null, steps: [{ kind: 'shell.exec', command: 'echo', args: [], cwd: null }] };
    queue.enqueue(orderA);
    queue.enqueue(orderB);
    expect(queue.size).toBe(2);
    expect(queue.total).toBe(2);
    const released = queue.releaseAll();
    expect(released.map((order) => order.task_id)).toEqual(['task-local-a', 'task-local-b']);
    expect(queue.size).toBe(0);
    expect(queue.releaseAll()).toEqual([]);
    expect(queue.total).toBe(2);
  });
});

describe('reconnect + state reconciliation (exactly-once, gap-free)', () => {
  it('replays pending events into the P2 live-store idempotently; re-reconciliation deduplicates exactly', async () => {
    const { companion } = pairedCompanion();
    companion.files.read({ path: 'acme/README.md' });
    companion.process.exec({ command: 'echo', args: [], cwd: null });
    const clock = new ManualClock(T0);
    const store = createInMemoryLiveStore({ clock });
    // First reconciliation: everything pending is APPLIED.
    const first = await reconcileLocalEventLog({ log: companion.eventLog, observationEvents: store.observationEvents });
    expect(first.replayed).toBe(3);
    expect(first.applied).toBe(3);
    expect(first.duplicates).toBe(0);
    expect(first.watermark).toBe(3);
    // Second reconciliation: nothing pending (watermark advanced).
    const second = await reconcileLocalEventLog({ log: companion.eventLog, observationEvents: store.observationEvents });
    expect(second.replayed).toBe(0);
    // Lost-acknowledgement replay: the companion crashed after ingestion
    // but BEFORE persisting its acknowledgement watermark — on restart the
    // log replays the full suffix against the live store that already
    // holds every event. Every replay must be a DUPLICATE (deduplicated
    // exactly, no double-apply, no loss).
    const lostAckLog: LocalEventLog = {
      append: (input) => companion.eventLog.append(input),
      events: () => companion.eventLog.events(),
      pendingAfter: (seq) => companion.eventLog.pendingAfter(seq),
      acknowledge: () => undefined,
      watermark: () => 0,
    };
    const replay = await reconcileLocalEventLog({ log: lostAckLog, observationEvents: store.observationEvents });
    expect(replay.replayed).toBe(3);
    expect(replay.applied).toBe(0);
    expect(replay.duplicates).toBe(3);
    const listed = await store.observationEvents.list();
    expect(listed.items.length).toBe(3);
    for (const item of listed.items) {
      expect(item.source).toBe('local-companion:device-reference-0001');
      expect(item.provenance).toContain(`device:device-reference-0001`);
      expect(item.id.startsWith('local-companion:device-reference-0001:evt-')).toBe(true);
    }
  });

  it('a gap in the local event log sequence is a typed COMPANION_RECONCILIATION_GAP violation — never silent', async () => {
    const clock = new ManualClock(T0);
    const store = createInMemoryLiveStore({ clock });
    // A deliberately gappy fake log: seq jumps from 1 to 3.
    const gappy: LocalEventLog = {
      append: () => {
        throw new Error('not used');
      },
      events: () => [],
      pendingAfter: (seq) =>
        seq === 0
          ? [
              {
                event_id: 'evt-0001',
                seq: 1,
                source: 'local-companion:filesystem',
                kind: 'local.workspace.read',
                payload: { path: 'acme/README.md' },
                device_id: 'device-reference-0001',
                provenance: ['local-companion:filesystem', 'device:device-reference-0001'],
                occurred_at: '2026-01-15T09:00:00Z',
              },
              {
                event_id: 'evt-0003',
                seq: 3,
                source: 'local-companion:filesystem',
                kind: 'local.workspace.read',
                payload: { path: 'acme/README.md' },
                device_id: 'device-reference-0001',
                provenance: ['local-companion:filesystem', 'device:device-reference-0001'],
                occurred_at: '2026-01-15T09:00:01Z',
              },
            ]
          : [],
      acknowledge: () => undefined,
      watermark: () => 0,
    };
    await expect(reconcileLocalEventLog({ log: gappy, observationEvents: store.observationEvents })).rejects.toThrow('COMPANION_RECONCILIATION_GAP');
  });

  it('the in-memory log enforces contiguous sequences and monotonic watermarks', () => {
    const clock = new ManualClock(T0);
    const log = new InMemoryLocalEventLog({ deviceId: 'device-reference-0001', clock });
    log.append({ source: 'local-companion:queue', kind: 'local.queue.queued', payload: { task_id: 't' } });
    log.append({ source: 'local-companion:queue', kind: 'local.queue.released', payload: { task_id: 't' } });
    expect(log.events().map((event) => event.seq)).toEqual([1, 2]);
    expect(log.pendingAfter(0).length).toBe(2);
    log.acknowledge(1);
    expect(log.pendingAfter(log.watermark()).map((event) => event.seq)).toEqual([2]);
    log.acknowledge(0);
    expect(log.watermark()).toBe(1);
  });
});

describe('the §9 harness body (the local body path)', () => {
  it('implements the merged P5 Harness Contract with an honest advertisement (placement user-device)', () => {
    const { companion } = pairedCompanion();
    const body = new LocalCompanionBody({ bodyId: 'reference-local-companion', companion });
    expect(body.identity().placement).toBe('user-device');
    expect(body.identity().harness_id).toBe('harness:companion-reference-local-companion');
    const capabilities = body.capabilities();
    expect(capabilities.capabilities).toEqual(['terminal', 'filesystem']);
    expect(capabilities.shell).toEqual(['exec']);
    expect(capabilities.git).toEqual([]);
    expect(capabilities.browser).toEqual([]);
  });

  it('executes a bounded local task through the contract surface (typed denials surface as truthful FAILED)', () => {
    const { companion } = pairedCompanion();
    const body = new LocalCompanionBody({ bodyId: 'reference-local-companion', companion });
    const created = body.createTask({ task_ref: 'task-local-0001', input: { steps: 2 } });
    expect(created.status).toBe('OK');
    if (created.status === 'OK') {
      expect(created.value.accepted).toBe(true);
      expect(created.value.workspace_root).toBe('/local/workspace/task-local-0001');
    }
    const write = body.workspace.write({ task_ref: 'task-local-0001', path: 'acme/src/feature.ts', content: 'export const feature = 3;\n' });
    expect(write.status).toBe('OK');
    const exec = body.shell.exec({ task_ref: 'task-local-0001', command: 'cat', args: ['acme/src/feature.ts'], cwd: null });
    expect(exec.status).toBe('OK');
    if (exec.status === 'OK') {
      expect(exec.value.stdout).toBe('export const feature = 3;\n');
    }
    // Out-of-scope access through the §9 surface: a truthful FAILED result
    // carrying the typed denial code.
    const escape = body.workspace.read({ task_ref: 'task-local-0001', path: 'outside/secret.txt' });
    expect(escape.status).toBe('FAILED');
    if (escape.status === 'FAILED') {
      expect(escape.error).toContain('COMPANION_SCOPE_DENIED');
    }
    // Un-granted process operation through the §9 surface.
    const denied = body.shell.exec({ task_ref: 'task-local-0001', command: 'rm', args: ['-rf', '/'], cwd: null });
    expect(denied.status).toBe('FAILED');
    if (denied.status === 'FAILED') {
      expect(denied.error).toContain('COMPANION_PROCESS_DENIED');
    }
    // Observations are provenance-labelled into the local event log.
    const emitted = body.observations.emit({ task_ref: 'task-local-0001', observation_kind: 'body.progress', payload: { stage: 'half' } });
    expect(emitted.status).toBe('OK');
    const last = companion.eventLog.events().at(-1);
    expect(last?.kind).toBe('body.progress');
    expect(last?.source).toBe('local-companion:body');
    expect(last?.device_id).toBe('device-reference-0001');
    // The cursor-based event stream.
    const subscribed = body.events.subscribe({ task_ref: 'task-local-0001', filter: null, cursor: null });
    expect(subscribed.status === 'OK' && subscribed.value.events.length).toBeGreaterThan(0);
  });

  it('unadvertised operations answer typed UNSUPPORTED (git/browser — explicit, never silent)', () => {
    const { companion } = pairedCompanion();
    const body = new LocalCompanionBody({ bodyId: 'reference-local-companion', companion });
    body.createTask({ task_ref: 'task-local-0002', input: null });
    const git = body.git.status({ task_ref: 'task-local-0002' });
    expect(git.status).toBe('UNSUPPORTED');
    if (git.status === 'UNSUPPORTED') {
      expect(git.operation).toBe('git.status');
    }
    const browser = body.browser.open({ task_ref: 'task-local-0002', url: 'https://example.com' });
    expect(browser.status).toBe('UNSUPPORTED');
  });

  it('createTask refuses truthfully while the companion session is not ACTIVE', () => {
    const { companion } = companionFixture();
    const body = new LocalCompanionBody({ bodyId: 'reference-local-companion', companion });
    const created = body.createTask({ task_ref: 'task-local-0003', input: null });
    expect(created.status).toBe('FAILED');
    if (created.status === 'FAILED') {
      expect(created.error).toContain('no ACTIVE paired session');
    }
  });
});
