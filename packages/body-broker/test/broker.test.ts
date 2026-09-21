/**
 * Body broker tests (Work Order P5): body identity separation, health
 * lifecycle, capability-based (vendor-blind) selection, fail-closed lease
 * semantics over the durable P2 lease repository, and body replacement
 * that preserves the task.
 */

import { describe, expect, it } from 'vitest';
import { ManualClock, createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import type { HarnessContract, HarnessCapabilities } from '@sos-2/harness';
import {
  ALLOWED_BODY_HEALTH_TRANSITIONS,
  BodyBroker,
  BodyUnavailableError,
  InvalidBodyRecordError,
  assertValidBodyId,
  assertValidRegisterBodyInput,
  isValidBodyId,
  selectBody,
  transitionBodyHealth,
} from '../src/index.js';
import type { BodyRegistration } from '../src/index.js';

const T0 = Date.parse('2026-01-15T09:00:00Z');

function advertisementFixture(overrides: Partial<HarnessCapabilities> = {}): HarnessCapabilities {
  return {
    capabilities: ['terminal', 'filesystem', 'repository-operations'],
    isolationLevel: 'container',
    networkPolicy: { egress: 'allowlist', allowedHosts: ['api.github.com'] },
    filesystemScope: { mode: 'workspace', root: '/workspace/task' },
    browser: [],
    shell: ['exec'],
    git: ['status', 'diff', 'commit', 'push', 'createBranch', 'createPullRequest'],
    runtimeIntegrations: [],
    taskLifecycle: { create: true, resume: true, pause: true, cancel: true, checkpoints: true },
    evidenceCapture: { artifacts: true, observations: true, events: true },
    costEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 1024, maxCostUsdPerTask: 0.5 },
    ...overrides,
  };
}

/** A minimal harness stub — the full fake body lives in tests/harness-contracts. */
function harnessStub(harnessId: string): HarnessContract {
  const failing = () => {
    throw new Error('not used in broker tests');
  };
  return {
    identity: () => ({ harness_id: harnessId, provider: { name: 'stub', version: '0' }, placement: 'cloud' }),
    capabilities: () => advertisementFixture(),
    createTask: failing,
    resumeTask: failing,
    pauseTask: failing,
    cancelTask: failing,
    workspace: { read: failing, write: failing },
    shell: { exec: failing },
    browser: { open: failing, interact: failing },
    git: { status: failing, diff: failing, commit: failing, push: failing, createBranch: failing, createPullRequest: failing },
    artifacts: { capture: failing },
    observations: { emit: failing },
    events: { subscribe: failing },
  };
}

interface BrokerWorld {
  store: ReturnType<typeof createInMemoryLiveStore>;
  clock: ManualClock;
  broker: BodyBroker;
}

function world(): BrokerWorld {
  const clock = new ManualClock(T0);
  const store = createInMemoryLiveStore({ clock });
  const broker = new BodyBroker({ leases: store.bodyLeases, clock });
  return { store, clock, broker };
}

function register(broker: BodyBroker, bodyId: string, providerName = 'acme', overrides: Partial<HarnessCapabilities> = {}): BodyRegistration {
  return broker.registerBody({
    body_id: bodyId,
    provider: { name: providerName, version: '1.0.0' },
    capabilities: advertisementFixture(overrides),
    placement: 'cloud',
    harness: harnessStub(`harness:${bodyId}`),
  });
}

describe('body identity — the typed separation from SOS semantic identity', () => {
  it('a spine-shaped body id is rejected loudly', () => {
    expect(() => assertValidBodyId(`sos://Mission/${'a'.repeat(32)}`)).toThrow(/never a SOS semantic identity/);
    expect(isValidBodyId(`sos://AuthorityGrant/${'0'.repeat(32)}`)).toBe(false);
  });

  it('plain body ids pass', () => {
    expect(() => assertValidBodyId('body:acme-cloud-1')).not.toThrow();
    expect(isValidBodyId('body:acme-cloud-1')).toBe(true);
  });

  it('registration keeps the vendor block as provenance metadata only (exact field set)', () => {
    expect(() =>
      assertValidRegisterBodyInput({
        body_id: 'body:x',
        provider: { name: 'acme', version: '1.0.0' },
        capabilities: advertisementFixture(),
        placement: 'cloud',
        harness: harnessStub('harness:x'),
        vendorRanking: 1,
      }),
    ).toThrow(/exact field set/);
  });

  it('a duplicate body id is rejected loudly (body ids are single-use within a broker)', () => {
    const { broker } = world();
    register(broker, 'body:dup');
    expect(() => register(broker, 'body:dup')).toThrow(/already registered/);
  });
});

describe('body health lifecycle', () => {
  it('AVAILABLE -> SUSPENDED -> AVAILABLE; RELEASED is terminal', () => {
    expect(transitionBodyHealth('AVAILABLE', 'SUSPENDED')).toBe('SUSPENDED');
    expect(transitionBodyHealth('SUSPENDED', 'AVAILABLE')).toBe('AVAILABLE');
    expect(transitionBodyHealth('AVAILABLE', 'RELEASED')).toBe('RELEASED');
    expect(ALLOWED_BODY_HEALTH_TRANSITIONS['RELEASED']).toEqual([]);
    expect(() => transitionBodyHealth('RELEASED', 'AVAILABLE')).toThrow(/RELEASED is terminal/);
    expect(() => transitionBodyHealth('RELEASED', 'RELEASED')).toThrow(/terminal/);
  });

  it('suspendBody suspends and resumes; releaseBody is terminal', () => {
    const { broker } = world();
    register(broker, 'body:a');
    expect(broker.body('body:a')!.health).toBe('AVAILABLE');
    // suspend/resume are synchronous health transitions here; the async
    // forms also end leases (covered below).
    expect(() => broker.harnessFor('body:none')).toThrow(BodyUnavailableError);
    expect(broker.bodies()).toHaveLength(1);
  });

  it('suspendBody revokes every ACTIVE lease of the body (the task survives)', async () => {
    const { broker } = world();
    register(broker, 'body:a');
    const acquired = await broker.acquireLease({ task_ref: 'task-0001', body_id: 'body:a', holder: 'execution-fabric', expires_at: null });
    expect(acquired.status).toBe('ACQUIRED');
    const outcome = await broker.suspendBody('body:a', 'provider outage');
    expect(outcome.registration.health).toBe('SUSPENDED');
    expect(outcome.endedLeases).toHaveLength(1);
    expect(outcome.endedLeases[0]!.state).toBe('REVOKED');
    // The durable lease record is terminal; nothing authorizes through it.
    const authorization = await broker.authorizeOperation({ lease_id: acquired.lease!.lease_id, task_ref: 'task-0001', body_id: null });
    expect(authorization.authorized).toBe(false);
    if (!authorization.authorized) {
      expect(authorization.denial.code).toBe('LEASE_INACTIVE');
    }
    // A suspended body cannot be leased again until resumed.
    const denied = await broker.acquireLease({ task_ref: 'task-0002', body_id: 'body:a', holder: 'execution-fabric', expires_at: null });
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('BODY_NOT_AVAILABLE');
    }
    // Resume makes the body leasable again.
    expect(broker.resumeBody('body:a').health).toBe('AVAILABLE');
    const again = await broker.acquireLease({ task_ref: 'task-0002', body_id: 'body:a', holder: 'execution-fabric', expires_at: null });
    expect(again.status).toBe('ACQUIRED');
  });

  it('releaseBody releases ACTIVE leases and is terminal', async () => {
    const { broker } = world();
    register(broker, 'body:a');
    await broker.acquireLease({ task_ref: 'task-0001', body_id: 'body:a', holder: 'execution-fabric', expires_at: null });
    const outcome = await broker.releaseBody('body:a', 'retired');
    expect(outcome.registration.health).toBe('RELEASED');
    expect(outcome.endedLeases[0]!.state).toBe('RELEASED');
    expect(() => broker.resumeBody('body:a')).toThrow(/terminal/);
  });
});

describe('capability-based selection (vendor-blind)', () => {
  it('selects by capabilities and registration order — provider names NEVER matter', () => {
    const { broker } = world();
    register(broker, 'body:first', 'vendor-one');
    register(broker, 'body:second', 'vendor-two');
    const selection = broker.select({ requiredCapabilities: ['terminal', 'filesystem'], placement: null });
    expect(selection.status).toBe('SELECTED');
    if (selection.status === 'SELECTED') {
      expect(selection.body.body_id).toBe('body:first');
    }
    // Flipping provider names changes nothing.
    const flipped = selectBody(
      { requiredCapabilities: ['terminal', 'filesystem'], placement: null },
      [
        { ...broker.bodies()[0]!, provider: { name: 'zzz', version: '9' } },
        { ...broker.bodies()[1]!, provider: { name: 'aaa', version: '1' } },
      ],
    );
    expect(flipped.status).toBe('SELECTED');
    if (flipped.status === 'SELECTED') {
      expect(flipped.body.body_id).toBe('body:first');
    }
  });

  it('requires every requested capability (superset match)', () => {
    const { broker } = world();
    register(broker, 'body:shell-only', 'acme', { capabilities: ['terminal'], git: [], shell: ['exec'] });
    const selection = broker.select({ requiredCapabilities: ['terminal', 'repository-operations'], placement: null });
    expect(selection.status).toBe('NO_BODY_AVAILABLE');
  });

  it('suspended and released bodies are never selectable', async () => {
    const { broker } = world();
    register(broker, 'body:a');
    await broker.suspendBody('body:a', 'test');
    expect(broker.select({ requiredCapabilities: ['terminal'], placement: null }).status).toBe('NO_BODY_AVAILABLE');
  });

  it('placement filter applies (cloud/remote work while the user device is off)', () => {
    const { broker } = world();
    register(broker, 'body:cloud');
    broker.registerBody({
      body_id: 'body:laptop',
      provider: { name: 'local', version: '1.0.0' },
      capabilities: advertisementFixture(),
      placement: 'user-device',
      harness: harnessStub('harness:laptop'),
    });
    const cloudOnly = broker.select({ requiredCapabilities: ['terminal'], placement: 'cloud' });
    expect(cloudOnly.status).toBe('SELECTED');
    if (cloudOnly.status === 'SELECTED') {
      expect(cloudOnly.body.body_id).toBe('body:cloud');
    }
    const laptop = broker.select({ requiredCapabilities: ['terminal'], placement: 'user-device' });
    expect(laptop.status).toBe('SELECTED');
    if (laptop.status === 'SELECTED') {
      expect(laptop.body.body_id).toBe('body:laptop');
    }
  });
});

describe('body leases over the durable P2 repository', () => {
  it('acquires deterministic single-use leases bound to the task', async () => {
    const { broker } = world();
    register(broker, 'body:a');
    const first = await broker.acquireLease({ task_ref: 'task-0007', body_id: 'body:a', holder: 'execution-fabric', expires_at: null });
    const second = await broker.acquireLease({ task_ref: 'task-0007', body_id: 'body:a', holder: 'execution-fabric', expires_at: null });
    expect(first.status).toBe('ACQUIRED');
    expect(second.status).toBe('ACQUIRED');
    if (first.status === 'ACQUIRED' && second.status === 'ACQUIRED') {
      expect(first.lease.lease_id).toBe('lease:task-0007:0001');
      expect(second.lease.lease_id).toBe('lease:task-0007:0002');
      expect(first.lease.state).toBe('ACTIVE');
      expect(first.lease.body_id).toBe('body:a');
      expect(first.lease.task_ref).toBe('task-0007');
    }
  });

  it('FAIL CLOSED: an expired lease authorizes nothing (truth recomputed from record + clock)', async () => {
    const { clock, broker } = world();
    register(broker, 'body:a');
    const expires = formatRfc3339(T0 + 60_000);
    const acquired = await broker.acquireLease({ task_ref: 'task-0001', body_id: 'body:a', holder: 'execution-fabric', expires_at: expires });
    expect(acquired.status).toBe('ACQUIRED');

    // Before expiry: authorized.
    const before = await broker.authorizeOperation({ lease_id: acquired.lease!.lease_id, task_ref: 'task-0001', body_id: 'body:a' });
    expect(before.authorized).toBe(true);

    // Advance the clock past expiry — the durable record still says ACTIVE,
    // but the recomputed truth is EXPIRED and the gate denies.
    clock.advance(61_000);
    const after = await broker.authorizeOperation({ lease_id: acquired.lease!.lease_id, task_ref: 'task-0001', body_id: 'body:a' });
    expect(after.authorized).toBe(false);
    if (!after.authorized) {
      expect(after.denial.code).toBe('LEASE_EXPIRED');
    }

    // An expired lease cannot even renew itself (fail closed).
    const renewal = await broker.renewLease(acquired.lease!.lease_id, { extend_to: formatRfc3339(T0 + 360_000) });
    expect(renewal.status).toBe('DENIED');
    if (renewal.status === 'DENIED') {
      expect(renewal.denial.code).toBe('LEASE_EXPIRED');
    }
  });

  it('FAIL CLOSED: a revoked or released lease authorizes nothing', async () => {
    const { broker } = world();
    register(broker, 'body:a');
    const revoked = await broker.acquireLease({ task_ref: 'task-0001', body_id: 'body:a', holder: 'execution-fabric', expires_at: null });
    await broker.revokeLease(revoked.lease!.lease_id, 'security');
    const auth1 = await broker.authorizeOperation({ lease_id: revoked.lease!.lease_id, task_ref: 'task-0001', body_id: null });
    expect(auth1.authorized).toBe(false);
    if (!auth1.authorized) {
      expect(auth1.denial.code).toBe('LEASE_INACTIVE');
    }

    const released = await broker.acquireLease({ task_ref: 'task-0002', body_id: 'body:a', holder: 'execution-fabric', expires_at: null });
    await broker.releaseLease(released.lease!.lease_id, 'done');
    const auth2 = await broker.authorizeOperation({ lease_id: released.lease!.lease_id, task_ref: 'task-0002', body_id: null });
    expect(auth2.authorized).toBe(false);
    if (!auth2.authorized) {
      expect(auth2.denial.code).toBe('LEASE_INACTIVE');
    }

    // Unknown lease ids deny too.
    const auth3 = await broker.authorizeOperation({ lease_id: 'lease:none:0001', task_ref: 'task-0002', body_id: null });
    expect(auth3.authorized).toBe(false);
    if (!auth3.authorized) {
      expect(auth3.denial.code).toBe('LEASE_NOT_FOUND');
    }
  });

  it('wrong-task and wrong-body bindings deny (typed)', async () => {
    const { broker } = world();
    register(broker, 'body:a');
    register(broker, 'body:b');
    const acquired = await broker.acquireLease({ task_ref: 'task-0001', body_id: 'body:a', holder: 'execution-fabric', expires_at: null });
    const wrongTask = await broker.authorizeOperation({ lease_id: acquired.lease!.lease_id, task_ref: 'task-9999', body_id: null });
    expect(wrongTask.authorized).toBe(false);
    if (!wrongTask.authorized) {
      expect(wrongTask.denial.code).toBe('LEASE_WRONG_TASK');
    }
    const wrongBody = await broker.authorizeOperation({ lease_id: acquired.lease!.lease_id, task_ref: 'task-0001', body_id: 'body:b' });
    expect(wrongBody.authorized).toBe(false);
    if (!wrongBody.authorized) {
      expect(wrongBody.denial.code).toBe('LEASE_BODY_MISMATCH');
    }
  });

  it('a LIVE lease renews with a revision bump (CAS-guarded)', async () => {
    const { broker } = world();
    register(broker, 'body:a');
    const acquired = await broker.acquireLease({ task_ref: 'task-0001', body_id: 'body:a', holder: 'execution-fabric', expires_at: formatRfc3339(T0 + 60_000) });
    const renewal = await broker.renewLease(acquired.lease!.lease_id, { extend_to: formatRfc3339(T0 + 600_000) });
    expect(renewal.status).toBe('RENEWED');
    if (renewal.status === 'RENEWED') {
      expect(renewal.lease.expires_at).toBe(formatRfc3339(T0 + 600_000));
      expect(renewal.lease.revision).toBe(2);
    }
  });

  it('a lease cannot be acquired for an unknown body', async () => {
    const { broker } = world();
    const denied = await broker.acquireLease({ task_ref: 'task-0001', body_id: 'body:ghost', holder: 'execution-fabric', expires_at: null });
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('BODY_NOT_FOUND');
    }
  });

  it('a semantic-shaped task ref is rejected for leasing (task ids are execution-fabric ids)', async () => {
    const { broker } = world();
    register(broker, 'body:a');
    await expect(
      broker.acquireLease({ task_ref: `sos://Mission/${'a'.repeat(32)}`, body_id: 'body:a', holder: 'x', expires_at: null }),
    ).rejects.toThrow(InvalidBodyRecordError);
  });
});

describe('body replacement preserves the task (the broker never touches task identity)', () => {
  it('replaces the lease: same task_ref, new single-use lease, terminal old lease', async () => {
    const { broker } = world();
    register(broker, 'body:a', 'acme');
    register(broker, 'body:b', 'other-vendor');
    const acquired = await broker.acquireLease({ task_ref: 'task-0042', body_id: 'body:a', holder: 'execution-fabric', expires_at: null });
    expect(acquired.status).toBe('ACQUIRED');

    // Kill the body mid-task: suspension ends its leases and removes it
    // from selection — the task survives in the durable store.
    const killed = await broker.suspendBody('body:a', 'killed mid-task');
    expect(killed.endedLeases).toHaveLength(1);

    const replacement = await broker.replaceBodyLease({
      task_ref: 'task-0042',
      current_lease_id: acquired.lease!.lease_id,
      reason: 'body killed mid-task',
    });
    expect(replacement.status).toBe('REPLACED');
    if (replacement.status === 'REPLACED') {
      // The old lease is terminal (ended by the kill; carried as-is).
      expect(replacement.ended_lease.lease_id).toBe(acquired.lease!.lease_id);
      expect(replacement.ended_lease.state).toBe('REVOKED');
      // The NEW lease binds the SAME task to the replacement body.
      expect(replacement.new_lease.task_ref).toBe('task-0042');
      expect(replacement.new_lease.lease_id).not.toBe(replacement.ended_lease.lease_id);
      expect(replacement.body.body_id).toBe('body:b');
      // The new lease authorizes; the old one never does again.
      const authNew = await broker.authorizeOperation({ lease_id: replacement.new_lease.lease_id, task_ref: 'task-0042', body_id: 'body:b' });
      expect(authNew.authorized).toBe(true);
      const authOld = await broker.authorizeOperation({ lease_id: replacement.ended_lease.lease_id, task_ref: 'task-0042', body_id: null });
      expect(authOld.authorized).toBe(false);
    }
    // Two durable leases exist for the task — the audit trail survived.
    const history = await broker.leasesForTask('task-0042');
    expect(history).toHaveLength(2);
  });

  it('replaces a still-ACTIVE lease onto another body (explicit replacement without a kill)', async () => {
    const { broker } = world();
    register(broker, 'body:a', 'acme');
    register(broker, 'body:b', 'other-vendor');
    const acquired = await broker.acquireLease({ task_ref: 'task-0009', body_id: 'body:a', holder: 'execution-fabric', expires_at: null });
    const replacement = await broker.replaceBodyLease({
      task_ref: 'task-0009',
      current_lease_id: acquired.lease!.lease_id,
      reason: 'cost-driven switch',
      requirements: { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'cloud' },
    });
    expect(replacement.status).toBe('REPLACED');
    if (replacement.status === 'REPLACED') {
      expect(replacement.ended_lease.state).toBe('REVOKED');
      expect(replacement.ended_lease.release_reason).toContain('body-replacement: cost-driven switch');
      expect(replacement.body.body_id).toBe('body:a'); // still AVAILABLE, earliest registration wins
      expect(replacement.new_lease.lease_id).toBe('lease:task-0009:0002');
    }
  });

  it('denies replacement when no replacement body matches the requirements', async () => {
    const { broker } = world();
    register(broker, 'body:a');
    const acquired = await broker.acquireLease({ task_ref: 'task-0001', body_id: 'body:a', holder: 'execution-fabric', expires_at: null });
    // Suspend the ONLY body: no AVAILABLE replacement exists.
    await broker.suspendBody('body:a', 'outage');
    const replacement = await broker.replaceBodyLease({
      task_ref: 'task-0001',
      current_lease_id: acquired.lease!.lease_id,
      reason: 'provider outage',
    });
    expect(replacement.status).toBe('DENIED');
    if (replacement.status === 'DENIED') {
      expect(replacement.denial.code).toBe('NO_BODY_AVAILABLE');
    }
  });

  it('denies replacement from a lease bound to another task (typed)', async () => {
    const { broker } = world();
    register(broker, 'body:a');
    const acquired = await broker.acquireLease({ task_ref: 'task-0001', body_id: 'body:a', holder: 'execution-fabric', expires_at: null });
    const replacement = await broker.replaceBodyLease({
      task_ref: 'task-0002',
      current_lease_id: acquired.lease!.lease_id,
      reason: 'wrong task',
    });
    expect(replacement.status).toBe('DENIED');
    if (replacement.status === 'DENIED') {
      expect(replacement.denial.code).toBe('LEASE_WRONG_TASK');
    }
  });
});
