/**
 * Execution/body provider configuration tests (Work Order P3): capability
 * envelope validation, unsafe-combination rejections, capability-based
 * selection, user-device placement semantics, and the STRUCTURAL
 * ISOLATION from packages/* (pinned by source scanning via ?raw imports).
 */

import {
  BODY_CAPABILITIES,
  BODY_ISOLATION_LEVELS,
  BODY_MAX_DURATION_HARD_LIMIT_MS,
  BodyProviderConfigError,
  selectBodyProvidersForCapabilities,
  validateBodyProviderConfig,
  worksWithoutUserDevice,
} from '../src/execution/body-providers.ts';
import { referenceCloudBodyConfig } from './fixtures.ts';

// Source text imported raw (vite ?raw) — the structural isolation proof
// scans the ACTUAL module source, not a copy.
import bodyProvidersSrc from '../src/execution/body-providers.ts?raw';
import delegationSrc from '../src/execution/delegation.ts?raw';

describe('body provider configuration validation', () => {
  it('accepts the reference cloud body configuration', () => {
    expect(() => validateBodyProviderConfig(referenceCloudBodyConfig())).not.toThrow();
  });

  it('requires a non-empty provider id and at least one capability', () => {
    const config = referenceCloudBodyConfig();
    expect(() => validateBodyProviderConfig({ ...config, providerId: '' })).toThrow(/providerId/);
    expect(() => validateBodyProviderConfig({ ...config, capabilities: [] })).toThrow(/at least one capability/);
  });

  it('type-rejects unknown and duplicate capabilities', () => {
    const config = referenceCloudBodyConfig();
    expect(() => validateBodyProviderConfig({ ...config, capabilities: ['telepathy'] as never })).toThrow(
      /unknown capability/,
    );
    expect(() =>
      validateBodyProviderConfig({ ...config, capabilities: ['terminal', 'terminal'] }),
    ).toThrow(/duplicate capability/);
  });

  it('type-rejects the unsafe isolation/network combination (none + open egress)', () => {
    const config = referenceCloudBodyConfig();
    const unsafe = {
      ...config,
      isolationLevel: 'none',
      networkPolicy: { egress: 'open' },
    };
    expect(() => validateBodyProviderConfig(unsafe)).toThrow(/unconfined execution/);
  });

  it('type-rejects an empty allowlist (egress none is the honest declaration)', () => {
    const config = referenceCloudBodyConfig();
    expect(() =>
      validateBodyProviderConfig({
        ...config,
        networkPolicy: { egress: 'allowlist', allowedHosts: [] },
      }),
    ).toThrow(/empty allowlist/);
    expect(() =>
      validateBodyProviderConfig({
        ...config,
        networkPolicy: { egress: 'allowlist', allowedHosts: ['good.example.com', 'has space.example.com'] },
      }),
    ).toThrow(/invalid host/);
  });

  it('type-rejects host filesystem scope without account isolation', () => {
    const config = referenceCloudBodyConfig();
    expect(() => validateBodyProviderConfig({ ...config, filesystem: { mode: 'host' } })).toThrow(
      /host filesystem scope without account-level isolation/,
    );
    expect(() =>
      validateBodyProviderConfig({
        ...config,
        isolationLevel: 'account',
        filesystem: { mode: 'host' },
      }),
    ).not.toThrow();
  });

  it('requires a workspace root for workspace scope', () => {
    const config = referenceCloudBodyConfig();
    expect(() => validateBodyProviderConfig({ ...config, filesystem: { mode: 'workspace' } })).toThrow(
      /workspaceRoot/,
    );
  });

  it('type-rejects unbounded or absurd cost envelopes', () => {
    const config = referenceCloudBodyConfig();
    expect(() =>
      validateBodyProviderConfig({ ...config, costEnvelope: { ...config.costEnvelope, maxDurationMs: 0 } }),
    ).toThrow(/maxDurationMs/);
    expect(() =>
      validateBodyProviderConfig({
        ...config,
        costEnvelope: { ...config.costEnvelope, maxDurationMs: BODY_MAX_DURATION_HARD_LIMIT_MS + 1 },
      }),
    ).toThrow(/maxDurationMs/);
    expect(() =>
      validateBodyProviderConfig({ ...config, costEnvelope: { ...config.costEnvelope, maxMemoryMb: -1 } }),
    ).toThrow(/maxMemoryMb/);
    expect(() =>
      validateBodyProviderConfig({ ...config, costEnvelope: { ...config.costEnvelope, maxCostUsdPerTask: 0 } }),
    ).toThrow(/maxCostUsdPerTask/);
  });

  it('requires lifecycle create and checkpoint-or-resume durability', () => {
    const config = referenceCloudBodyConfig();
    expect(() =>
      validateBodyProviderConfig({
        ...config,
        taskLifecycle: { supportsCreate: true, supportsResume: false, supportsPause: false, supportsCancel: true, supportsCheckpoints: false },
      }),
    ).toThrow(/neither checkpoints nor resume/);
    const noCreate = { ...config, taskLifecycle: { ...config.taskLifecycle, supportsCreate: false } };
    expect(() => validateBodyProviderConfig(noCreate as never)).toThrow(/must support create/);
  });

  it('type-rejects unknown isolation levels and placements', () => {
    const config = referenceCloudBodyConfig();
    expect(() => validateBodyProviderConfig({ ...config, isolationLevel: 'vibes' as never })).toThrow(
      /unknown isolation level/,
    );
    expect(() => validateBodyProviderConfig({ ...config, placement: 'somewhere' as never })).toThrow(
      /unknown placement/,
    );
    expect(BODY_ISOLATION_LEVELS).toEqual(['none', 'process', 'container', 'vm', 'account']);
    expect(BODY_CAPABILITIES).toContain('repository-operations');
  });
});

describe('capability-based selection (never vendor-based)', () => {
  it('selects bodies by required capabilities, deterministically in input order', () => {
    const cloud = referenceCloudBodyConfig();
    const browserBody = {
      ...cloud,
      providerId: 'browser-body',
      capabilities: ['browser-ui', 'runtime-cloud-apis'] as never,
    };
    const selected = selectBodyProvidersForCapabilities(['browser-ui'], [cloud, browserBody]);
    expect(selected.length).toBe(1);
    expect(selected[0]?.providerId).toBe('browser-body');
    expect(() => selectBodyProvidersForCapabilities(['telepathy'], [cloud])).toThrow(/not part of the vocabulary/);
  });

  it('user-device placement semantics: cloud/remote work offline; user-device does not', () => {
    const cloud = referenceCloudBodyConfig();
    expect(worksWithoutUserDevice(cloud)).toBe(true);
    expect(worksWithoutUserDevice({ ...cloud, placement: 'remote' })).toBe(true);
    expect(worksWithoutUserDevice({ ...cloud, placement: 'user-device' })).toBe(false);
  });
});

describe('structural isolation from semantic packages (the adapter rule)', () => {
  it('the execution modules import NOTHING from packages/* (no @sos-2/ or packages/ specifiers)', () => {
    for (const [label, source] of [
      ['body-providers.ts', bodyProvidersSrc],
      ['delegation.ts', delegationSrc],
    ] as const) {
      const importSpecifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
      expect(importSpecifiers.length).toBeGreaterThan(0);
      for (const specifier of importSpecifiers) {
        expect(
          specifier.startsWith('@sos-2/') || specifier.includes('packages/'),
          `${label} must not import '${specifier}' — execution/body provider configuration stays isolated from semantic packages (providers remain adapters)`,
        ).toBe(false);
      }
    }
  });

  it('the isolation proof covers the shared-primitives module too', () => {
    // The execution modules' only allowed dependency is the package's own
    // core module — verify the import set is exactly that (plus vercel
    // contract for delegation's budget constants).
    const bodyImports = [...bodyProvidersSrc.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(bodyImports).toEqual(['../core/types.ts']);
    const delegationImports = [...delegationSrc.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(delegationImports.sort()).toEqual(['../core/types.ts', '../providers/vercel.ts']);
  });

  it('the capability vocabulary mirrors the execution architecture surfaces (documented alignment)', () => {
    // spec/productization-execution-architecture.md section 3 surfaces:
    // terminal+filesystem access, repository operations, browser/UI
    // interaction, runtime/cloud APIs, IDE or desktop interaction,
    // deployment operations.
    for (const surface of [
      'terminal',
      'filesystem',
      'repository-operations',
      'browser-ui',
      'runtime-cloud-apis',
      'ide-desktop',
      'deployment-operations',
    ]) {
      expect((BODY_CAPABILITIES as readonly string[]).includes(surface)).toBe(true);
    }
  });
});
