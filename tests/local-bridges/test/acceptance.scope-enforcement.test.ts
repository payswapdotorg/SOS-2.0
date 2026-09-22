/**
 * ACCEPTANCE (Work Order P11): SCOPE ENFORCEMENT — the companion cannot
 * exceed granted scope. Out-of-scope file access and un-granted
 * consequential operations are typed denials surfacing as truthful FAILED
 * results through the PUBLIC §9 contract behind the P5 broker — never
 * silent, never a crash.
 */

import { describe, expect, it } from 'vitest';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { acceptanceWorld, SECRET_OUT_OF_SCOPE_CONTENT, T0 } from './acceptance-world.js';
import { formatRfc3339 } from '@sos-2/live-store';

/** The self-contained authority grant of the expired-scope journey. */
function world0Grant(): AuthorityGrantArtifact {
  return createGrant({
    grantee: 'spirit:persistent',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['READ', 'REVISE'],
    expiry: { kind: 'TIME', at: formatRfc3339(T0 + 86_400_000) },
    provenance: ['p11-scope-acceptance'],
    created_at: formatRfc3339(T0),
    status: 'ACTIVE',
  });
}

describe('acceptance: the companion cannot exceed granted scope', () => {
  it('out-of-scope file access through the §9 contract is a truthful FAILED result carrying the typed denial', async () => {
    const world = acceptanceWorld();
    world.pair();
    const task = await world.createTask({ task_id: 'task-scope-0001' });
    expect(task.status).toBe('RUNNING');

    // An unknown root, an absolute path and a '..' escape all refuse
    // (typed denial inside truthful FAILED results — never silent, never
    // a crash: the refusal is a typed observable fact, not an exception).
    const expectedReasons: Record<string, string> = {
      'outside/secret.txt': 'no granted scope covers root',
      '/etc/passwd': 'absolute paths are outside the granted-scope model',
      'acme/../../outside/secret.txt': 'escapes the granted-scope discipline',
      'unknown/file.txt': 'no granted scope covers root',
    };
    for (const [path, expectedReason] of Object.entries(expectedReasons)) {
      const escape = await world.fabric.execute('task-scope-0001', { kind: 'workspace.read', path });
      expect(escape.status, `path ${path} must refuse through the fabric`).toBe('EXECUTED');
      if (escape.status === 'EXECUTED') {
        expect(escape.availability).toBe('FAILURE');
        expect(escape.error).toContain('COMPANION_SCOPE_DENIED');
        expect(escape.error).toContain(expectedReason);
      }
    }

    // The out-of-scope private content NEVER surfaced through any path.
    const stored = await world.store.observationEvents.list();
    expect(JSON.stringify(stored.items)).not.toContain(SECRET_OUT_OF_SCOPE_CONTENT);
    // And the file port never handed it out: reading the granted roots
    // lists only granted content.
    const list = await world.fabric.execute('task-scope-0001', { kind: 'workspace.read', path: 'acme/README.md' });
    expect(list.status === 'EXECUTED' && list.availability).toBe('SUCCESS');
  });

  it('writing a READ-ONLY granted root is an un-granted consequential operation (typed denial)', async () => {
    const world = acceptanceWorld();
    world.pair();
    await world.createTask({ task_id: 'task-scope-0002' });
    const write = await world.fabric.execute('task-scope-0002', { kind: 'workspace.write', path: 'notes/new-note.txt', content: 'x' });
    expect(write.status).toBe('EXECUTED');
    if (write.status === 'EXECUTED') {
      expect(write.availability).toBe('FAILURE');
      expect(write.error).toContain('COMPANION_SCOPE_DENIED');
      expect(write.error).toContain('read-only');
    }
    // Reading the same root still works (the grant mode is honored exactly).
    const read = await world.fabric.execute('task-scope-0002', { kind: 'workspace.read', path: 'notes/private.txt' });
    expect(read.status === 'EXECUTED' && read.availability).toBe('SUCCESS');
  });

  it('an un-granted process operation is a typed COMPANION_PROCESS_DENIED denial (truthful FAILED)', async () => {
    const world = acceptanceWorld();
    world.pair();
    await world.createTask({ task_id: 'task-scope-0003' });
    const denied = await world.fabric.execute('task-scope-0003', { kind: 'shell.exec', command: 'rm', args: ['-rf', '/'], cwd: null });
    expect(denied.status).toBe('EXECUTED');
    if (denied.status === 'EXECUTED') {
      expect(denied.availability).toBe('FAILURE');
      expect(denied.error).toContain('COMPANION_PROCESS_DENIED');
    }
    // A GRANTED command still executes through the same surface.
    const allowed = await world.fabric.execute('task-scope-0003', { kind: 'shell.exec', command: 'echo', args: ['local-scope-ok'], cwd: null });
    expect(allowed.status === 'EXECUTED' && allowed.availability).toBe('SUCCESS');
  });

  it('an EXPIRED scope grant authorizes NOTHING (re-evaluated before consequential operations)', async () => {
    // A SELF-CONTAINED world: only the expiring companion body is
    // registered (deterministic selection — no other user-device body).
    const { ReferencePairingAuthority, LocalCompanion, InMemoryCredentialStore, InMemoryLocalFilePort, SimulatedLocalProcess, LocalCompanionBody } = await import('@sos-2/local-companion');
    const { BodyBroker } = await import('@sos-2/body-broker');
    const { ExecutionFabric } = await import('@sos-2/execution-fabric');
    const { ManualClock, createInMemoryLiveStore } = await import('@sos-2/live-store');
    const clock = new ManualClock(Date.parse('2026-01-15T09:00:00Z'));
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
    await store.authorityGrants.put(world0Grant());
    const authority = new ReferencePairingAuthority([
      {
        code: 'pair-expiring-0001',
        scopes: [
          {
            grant_id: 'grant-expiring',
            roots: [{ name: 'acme', mode: 'read-write' }],
            process_allowlist: ['echo'],
            granted_by: 'user:pairing',
            granted_at: '2026-01-15T09:00:00Z',
            expires_at: '2026-01-15T10:00:00Z',
          },
        ],
        sessionDurationMs: null,
      },
    ]);
    const filePort = new InMemoryLocalFilePort();
    filePort.seed({ 'acme/README.md': '# acme\n' });
    const companion = new LocalCompanion({
      deviceId: 'device-expiring-0001',
      deviceLabel: 'expiring laptop',
      pairingAuthority: authority,
      credentials: new InMemoryCredentialStore(),
      files: filePort,
      process: new SimulatedLocalProcess(),
      clock,
    });
    const body = new LocalCompanionBody({ bodyId: 'expiring-local-companion', companion });
    broker.registerBody({
      body_id: 'expiring-local-companion',
      provider: { name: 'reference-local-companion', version: '1.0.0' },
      capabilities: body.capabilitiesValue,
      placement: 'user-device',
      harness: body,
    });
    const paired = companion.pair({ pairing_code: 'pair-expiring-0001', device_id: 'device-expiring-0001', device_label: 'expiring laptop' });
    expect(paired.status).toBe('PAIRED');

    const created = await fabric.createBoundedTask({
      task_id: 'task-scope-0004',
      mission_ref: null,
      plan: { steps: ['expiring-grant'] },
      grant_refs: [world0Grant().envelope.id],
      requirements: { requiredCapabilities: ['terminal', 'filesystem'], placement: 'user-device' },
      holder: 'spirit:persistent',
      expires_at: null,
    });
    expect(created.status).toBe('CREATED');

    // Before expiry: the granted access works.
    const before = await fabric.execute('task-scope-0004', { kind: 'workspace.read', path: 'acme/README.md' });
    expect(before.status === 'EXECUTED' && before.availability).toBe('SUCCESS');

    // Advance past the grant expiry: EVERY consequential operation refuses
    // (the grant is re-evaluated per access — never cached as truth).
    clock.advance(3_600_001);
    const after = await fabric.execute('task-scope-0004', { kind: 'workspace.read', path: 'acme/README.md' });
    expect(after.status).toBe('EXECUTED');
    if (after.status === 'EXECUTED') {
      expect(after.availability).toBe('FAILURE');
      expect(after.error).toContain('COMPANION_SCOPE_DENIED');
      expect(after.error).toContain('no granted scope covers root');
    }
    const exec = await fabric.execute('task-scope-0004', { kind: 'shell.exec', command: 'echo', args: [], cwd: null });
    expect(exec.status).toBe('EXECUTED');
    if (exec.status === 'EXECUTED') {
      expect(exec.availability).toBe('FAILURE');
      expect(exec.error).toContain('COMPANION_PROCESS_DENIED');
    }
  });

  it('scope denials are OBSERVED (durable violation observations) and un-granted state never fabricates files', async () => {
    const world = acceptanceWorld();
    world.pair();
    await world.createTask({ task_id: 'task-scope-0005' });
    await world.fabric.execute('task-scope-0005', { kind: 'workspace.read', path: 'outside/secret.txt' });
    // The refusal landed in the durable observation boundary (task record).
    const task = await world.store.tasks.get('task-scope-0005');
    expect(task?.observations.length).toBeGreaterThan(0);
    // The local event log carries the typed denial observation too.
    const denialEvents = world.companion.eventLog.events().filter((event) => event.kind === 'local.scope.denied');
    expect(denialEvents.length).toBeGreaterThan(0);
    expect(denialEvents[0]?.source).toBe('local-companion:filesystem');
  });
});
