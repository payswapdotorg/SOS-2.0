/**
 * Harness capability advertisement tests (Work Order P5): the §3 mirror,
 * guard strictness, and the BINDING advertisement map.
 */

import { describe, expect, it } from 'vitest';
import {
  HARNESS_CAPABILITIES,
  HARNESS_OPERATIONS,
  InvalidHarnessContractError,
  advertisedOperations,
  assertValidHarnessCapabilities,
  assertValidHarnessIdentity,
  isOperationAdvertised,
} from '../src/index.js';
import type { HarnessCapabilities } from '../src/index.js';

/** The reference advertisement used across the suite (cloud coding body). */
export function capabilitiesFixture(overrides: Record<string, unknown> = {}): HarnessCapabilities {
  return {
    capabilities: ['terminal', 'filesystem', 'repository-operations'],
    isolationLevel: 'container',
    networkPolicy: { egress: 'allowlist', allowedHosts: ['api.github.com', 'registry.npmjs.org'] },
    filesystemScope: { mode: 'workspace', root: '/workspace/task' },
    browser: [],
    shell: ['exec'],
    git: ['status', 'diff', 'commit', 'push', 'createBranch', 'createPullRequest'],
    runtimeIntegrations: [],
    taskLifecycle: { create: true, resume: true, pause: true, cancel: true, checkpoints: true },
    evidenceCapture: { artifacts: true, observations: true, events: true },
    costEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 1024, maxCostUsdPerTask: 0.5 },
    ...overrides,
  } as HarnessCapabilities;
}

describe('the §3 advertisement mirror (field-for-field)', () => {
  it('mirrors every §3 advertisement field exactly', () => {
    const advertisement = capabilitiesFixture();
    // §3 list: capabilities, isolation level, network policy, filesystem
    // scope, browser capability, shell capability, git capability,
    // runtime/cloud integrations, supported task lifecycle,
    // evidence/artifact capture, cost and resource envelope.
    for (const field of [
      'capabilities',
      'isolationLevel',
      'networkPolicy',
      'filesystemScope',
      'browser',
      'shell',
      'git',
      'runtimeIntegrations',
      'taskLifecycle',
      'evidenceCapture',
      'costEnvelope',
    ]) {
      expect(Object.hasOwn(advertisement, field)).toBe(true);
    }
    expect(Object.keys(advertisement)).toHaveLength(11);
  });

  it('the capability vocabulary mirrors the §1 body surfaces', () => {
    // §1: terminal and filesystem access, repository operations,
    // browser/UI interaction, runtime/cloud APIs, IDE or desktop
    // interaction, deployment operations.
    expect(HARNESS_CAPABILITIES).toEqual([
      'terminal',
      'filesystem',
      'repository-operations',
      'browser-ui',
      'runtime-cloud-apis',
      'ide-desktop',
      'deployment-operations',
    ]);
  });
});

describe('advertisement guard (loud, typed rejections)', () => {
  it('accepts the reference advertisement', () => {
    expect(() => assertValidHarnessCapabilities(capabilitiesFixture())).not.toThrow();
  });

  it('rejects unknown and duplicate capabilities', () => {
    expect(() => assertValidHarnessCapabilities(capabilitiesFixture({ capabilities: ['telepathy'] }))).toThrow(/unknown capability/);
    expect(() =>
      assertValidHarnessCapabilities(capabilitiesFixture({ capabilities: ['terminal', 'terminal'] })),
    ).toThrow(/duplicate capability/);
  });

  it('rejects an empty capability list (capability-based selection is the contract)', () => {
    expect(() => assertValidHarnessCapabilities(capabilitiesFixture({ capabilities: [] }))).toThrow(/at least one capability/);
  });

  it('rejects browser/shell/git operations without their surface capability (consistent advertisement)', () => {
    expect(() => assertValidHarnessCapabilities(capabilitiesFixture({ browser: ['open'] }))).toThrow(/browser-ui/);
    expect(() =>
      assertValidHarnessCapabilities(
        capabilitiesFixture({ capabilities: ['filesystem', 'repository-operations'], shell: ['exec'] }),
      ),
    ).toThrow(/terminal/);
    expect(() =>
      assertValidHarnessCapabilities(capabilitiesFixture({ capabilities: ['terminal', 'filesystem'], git: ['commit'] })),
    ).toThrow(/repository-operations/);
  });

  it('rejects the filesystem capability with scope mode none (inconsistent)', () => {
    expect(() =>
      assertValidHarnessCapabilities(capabilitiesFixture({ filesystemScope: { mode: 'none', root: null } })),
    ).toThrow(/consistent/);
  });

  it('rejects lifecycle without create, and without resume-or-checkpoints (task state outlives bodies)', () => {
    expect(() =>
      assertValidHarnessCapabilities(capabilitiesFixture({ taskLifecycle: { create: false, resume: true, pause: true, cancel: true, checkpoints: true } })),
    ).toThrow(/cannot be summoned/);
    expect(() =>
      assertValidHarnessCapabilities(capabilitiesFixture({ taskLifecycle: { create: true, resume: false, pause: true, cancel: true, checkpoints: false } })),
    ).toThrow(/survive replacement/);
  });

  it('rejects unbounded or absurd cost envelopes', () => {
    expect(() =>
      assertValidHarnessCapabilities(capabilitiesFixture({ costEnvelope: { maxDurationMs: 0, maxMemoryMb: null, maxCostUsdPerTask: null } })),
    ).toThrow(/costEnvelope/);
    expect(() =>
      assertValidHarnessCapabilities(
        capabilitiesFixture({ costEnvelope: { maxDurationMs: 24 * 60 * 60_000 + 1, maxMemoryMb: null, maxCostUsdPerTask: null } }),
      ),
    ).toThrow(/costEnvelope/);
  });

  it('rejects an extra field (exact field set — no smuggled vendor/authority fields)', () => {
    const forged = { ...capabilitiesFixture(), vendor_ranking: 'acme-first' } as unknown;
    expect(() => assertValidHarnessCapabilities(forged)).toThrow(InvalidHarnessContractError);
  });
});

describe('the BINDING advertisement map', () => {
  it('every §9 operation resolves against the advertisement', () => {
    const noBrowser = capabilitiesFixture();
    expect(isOperationAdvertised(noBrowser, 'browser.open')).toBe(false);
    expect(isOperationAdvertised(noBrowser, 'browser.interact')).toBe(false);
    expect(isOperationAdvertised(noBrowser, 'workspace.read')).toBe(true);
    expect(isOperationAdvertised(noBrowser, 'workspace.write')).toBe(true);
    expect(isOperationAdvertised(noBrowser, 'shell.exec')).toBe(true);
    expect(isOperationAdvertised(noBrowser, 'git.status')).toBe(true);
    expect(isOperationAdvertised(noBrowser, 'git.commit')).toBe(true);
    expect(isOperationAdvertised(noBrowser, 'artifacts.capture')).toBe(true);
    expect(isOperationAdvertised(noBrowser, 'observations.emit')).toBe(true);
    expect(isOperationAdvertised(noBrowser, 'events.subscribe')).toBe(true);
    expect(isOperationAdvertised(noBrowser, 'createTask')).toBe(true);
  });

  it('a git-operation subset advertisement leaves the rest explicitly unsupported', () => {
    const readOnly = capabilitiesFixture({ git: ['status', 'diff'] });
    expect(isOperationAdvertised(readOnly, 'git.status')).toBe(true);
    expect(isOperationAdvertised(readOnly, 'git.commit')).toBe(false);
    expect(isOperationAdvertised(readOnly, 'git.push')).toBe(false);
  });

  it('evidence capture flags map onto their operations', () => {
    const none = capabilitiesFixture({ evidenceCapture: { artifacts: false, observations: false, events: false } });
    expect(advertisedOperations(none)).not.toContain('artifacts.capture');
    expect(advertisedOperations(none)).not.toContain('observations.emit');
    expect(advertisedOperations(none)).not.toContain('events.subscribe');
  });

  it('advertisedOperations covers the closed §9 vocabulary deterministically', () => {
    const ops = advertisedOperations(capabilitiesFixture());
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      expect(HARNESS_OPERATIONS).toContain(op);
    }
    expect(advertisedOperations(capabilitiesFixture())).toEqual(ops);
  });
});

describe('harness identity (never a semantic identity)', () => {
  it('accepts a runtime-identifier harness id', () => {
    expect(() =>
      assertValidHarnessIdentity({ harness_id: 'harness:acme-cloud-runner-1', provider: { name: 'acme', version: '1.0.0' }, placement: 'cloud' }),
    ).not.toThrow();
  });

  it('rejects a spine-shaped harness id loudly', () => {
    expect(() =>
      assertValidHarnessIdentity({ harness_id: `sos://Mission/${'a'.repeat(32)}`, provider: { name: 'acme', version: '1.0.0' }, placement: 'cloud' }),
    ).toThrow(/never a SOS semantic identity/);
  });

  it('rejects an unknown placement', () => {
    expect(() =>
      assertValidHarnessIdentity({ harness_id: 'harness:x', provider: { name: 'acme', version: '1.0.0' }, placement: 'low-orbit' }),
    ).toThrow(/placement/);
  });

  it('requires the exact field set (provider block is provenance metadata only)', () => {
    expect(() =>
      assertValidHarnessIdentity({ harness_id: 'harness:x', provider: { name: 'acme' }, placement: 'cloud' }),
    ).toThrow(/provider/);
  });
});
