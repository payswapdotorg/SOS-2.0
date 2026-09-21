/**
 * Runtime integration selection tests (Work Order P5): the deterministic
 * highest-control-surface selection, the never-require-an-extension rule,
 * honest unavailability, and the bounded-environment guard.
 */

import { describe, expect, it } from 'vitest';
import {
  assertValidAllowedTiers,
  assertValidBoundedEnvironment,
  assertValidRuntimeCapabilityEnvelope,
  availableTiers,
  selectRuntimeIntegration,
} from '../src/index.js';
import type { RuntimeIntegration } from '../src/index.js';

const native: RuntimeIntegration = {
  integration_id: 'github-api',
  tier: 'native-api',
  capability: 'github',
  endpoint: 'https://api.github.com',
  operations: ['push', 'createPullRequest'],
  available: true,
};
const mcp: RuntimeIntegration = {
  integration_id: 'github-mcp',
  tier: 'mcp-protocol',
  capability: 'github',
  endpoint: 'mcp:github-server',
  operations: ['push', 'createPullRequest'],
  available: true,
};
const extension: RuntimeIntegration = {
  integration_id: 'github-ext',
  tier: 'extension',
  capability: 'github',
  endpoint: 'extension:github-workflow',
  operations: ['push', 'createPullRequest'],
  available: true,
};
const uiAutomation: RuntimeIntegration = {
  integration_id: 'github-ui',
  tier: 'ui-automation',
  capability: 'github',
  endpoint: 'driver:github.com',
  operations: ['push', 'createPullRequest'],
  available: true,
};

describe('deterministic highest-control-surface selection (§4)', () => {
  it('prefers the native API over MCP, extension and UI automation', () => {
    const selection = selectRuntimeIntegration([uiAutomation, extension, mcp, native]);
    expect(selection.status).toBe('SELECTED');
    if (selection.status === 'SELECTED') {
      expect(selection.selected.tier).toBe('native-api');
      expect(selection.selected.integration_id).toBe('github-api');
    }
  });

  it('NEVER requires an extension when an equivalent safe API is available', () => {
    const selection = selectRuntimeIntegration([extension, native, mcp]);
    expect(selection.status).toBe('SELECTED');
    if (selection.status === 'SELECTED') {
      expect(selection.selected.tier).not.toBe('extension');
      expect(selection.selected.tier).not.toBe('ui-automation');
    }
  });

  it('falls through to the extension only when no higher surface is available', () => {
    const selection = selectRuntimeIntegration([
      { ...native, available: false },
      { ...mcp, available: false },
      extension,
    ]);
    expect(selection.status).toBe('SELECTED');
    if (selection.status === 'SELECTED') {
      expect(selection.selected.tier).toBe('extension');
    }
  });

  it('an unavailable higher tier is never selected (honest availability)', () => {
    const selection = selectRuntimeIntegration([{ ...native, available: false }, mcp]);
    expect(selection.status).toBe('SELECTED');
    if (selection.status === 'SELECTED') {
      expect(selection.selected.tier).toBe('mcp-protocol');
    }
  });

  it('UI automation is the LAST resort (§4 order is frozen)', () => {
    const selection = selectRuntimeIntegration([
      { ...native, available: false },
      { ...mcp, available: false },
      { ...extension, available: false },
      uiAutomation,
    ]);
    expect(selection.status).toBe('SELECTED');
    if (selection.status === 'SELECTED') {
      expect(selection.selected.tier).toBe('ui-automation');
    }
  });

  it('no available surface => typed UNAVAILABLE, never a fabricated selection', () => {
    const selection = selectRuntimeIntegration([{ ...native, available: false }]);
    expect(selection.status).toBe('UNAVAILABLE');
    if (selection.status === 'UNAVAILABLE') {
      expect(selection.selected).toBeNull();
      expect(selection.reason).toContain('available');
    }
  });

  it('operation filter restricts to surfaces exposing the operation', () => {
    const readerOnly: RuntimeIntegration = {
      integration_id: 'github-readonly-api',
      tier: 'native-api',
      capability: 'github',
      endpoint: 'https://api.github.com/readonly',
      operations: ['listPullRequests'],
      available: true,
    };
    const selection = selectRuntimeIntegration([readerOnly, mcp], { operation: 'push' });
    expect(selection.status).toBe('SELECTED');
    if (selection.status === 'SELECTED') {
      expect(selection.selected.integration_id).toBe('github-mcp');
    }
  });

  it('same-rank ties break deterministically by integration id (never vendor identity)', () => {
    const a: RuntimeIntegration = { ...mcp, integration_id: 'bbb-mcp' };
    const b: RuntimeIntegration = { ...mcp, integration_id: 'aaa-mcp' };
    for (const order of [
      [a, b],
      [b, a],
    ] as const) {
      const selection = selectRuntimeIntegration([...order]);
      expect(selection.status).toBe('SELECTED');
      if (selection.status === 'SELECTED') {
        expect(selection.selected.integration_id).toBe('aaa-mcp');
      }
    }
  });

  it('selection is a pure function: identical input => identical output', () => {
    const first = selectRuntimeIntegration([mcp, native, extension]);
    const second = selectRuntimeIntegration([mcp, native, extension]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('availableTiers reports reachable §4 tiers without fabricating unavailable ones', () => {
    expect(availableTiers([{ ...native, available: false }, mcp])).toEqual(['mcp-protocol']);
    expect(availableTiers([native, mcp])).toEqual(['native-api', 'mcp-protocol']);
    expect(availableTiers([])).toEqual([]);
  });

  it('allowedTiers restricts selection; unknown tiers are loud', () => {
    const selection = selectRuntimeIntegration([native, uiAutomation], { allowedTiers: ['extension', 'ui-automation'] });
    expect(selection.status).toBe('SELECTED');
    if (selection.status === 'SELECTED') {
      expect(selection.selected.tier).toBe('ui-automation');
    }
    expect(() => assertValidAllowedTiers(['telepathy'])).toThrow(/unknown tier/);
  });
});

describe('bounded environment guard', () => {
  function environmentFixture(overrides: Record<string, unknown> = {}) {
    return {
      filesystem: { mode: 'workspace', root: '/workspace' },
      network: { egress: 'allowlist', allowedHosts: ['api.github.com'] },
      isolation: 'container',
      limits: { maxDurationMs: 3_600_000, maxMemoryMb: 512 },
      environmentVariables: ['GITHUB_TOKEN', 'NODE_ENV'],
      ...overrides,
    };
  }

  it('accepts a well-formed bounded environment', () => {
    expect(() => assertValidBoundedEnvironment(environmentFixture())).not.toThrow();
  });

  it('environment variables are NAMES only — a "NAME=value" shape is rejected (secrets never echoed)', () => {
    expect(() =>
      assertValidBoundedEnvironment(environmentFixture({ environmentVariables: ['GITHUB_TOKEN=ghp_secretvalue'] })),
    ).toThrow(/NAME=value/);
  });

  it('a scoped filesystem requires a root; mode none requires root null', () => {
    expect(() => assertValidBoundedEnvironment(environmentFixture({ filesystem: { mode: 'workspace', root: null } }))).toThrow(/root/);
    expect(() => assertValidBoundedEnvironment(environmentFixture({ filesystem: { mode: 'none', root: '/x' } }))).toThrow(/none/);
  });

  it('an empty allowlist is rejected (egress none is the honest declaration)', () => {
    expect(() =>
      assertValidBoundedEnvironment(environmentFixture({ network: { egress: 'allowlist', allowedHosts: [] } })),
    ).toThrow(/allowedHosts/);
  });

  it('durations must be positive and bounded (<= 24h, aligned with P3 by spec)', () => {
    expect(() => assertValidBoundedEnvironment(environmentFixture({ limits: { maxDurationMs: 0, maxMemoryMb: null } }))).toThrow(/limits/);
    expect(() =>
      assertValidBoundedEnvironment(environmentFixture({ limits: { maxDurationMs: 24 * 60 * 60_000 + 1, maxMemoryMb: null } })),
    ).toThrow(/limits/);
  });
});

describe('runtime capability envelope guard', () => {
  it('accepts a well-formed envelope and requires integrations to target the envelope capability', () => {
    const envelope = {
      capability: 'github',
      operations: ['push', 'createPullRequest'],
      integrations: [native, mcp],
      boundedEnvironment: null,
    };
    expect(() => assertValidRuntimeCapabilityEnvelope(envelope)).not.toThrow();
    expect(() =>
      assertValidRuntimeCapabilityEnvelope({
        ...envelope,
        integrations: [{ ...native, capability: 'gitlab' }],
      }),
    ).toThrow(/targets capability/);
  });

  it('integration operations must stay inside the envelope vocabulary', () => {
    const envelope = {
      capability: 'github',
      operations: ['push'],
      integrations: [native], // native exposes push AND createPullRequest
      boundedEnvironment: null,
    };
    expect(() => assertValidRuntimeCapabilityEnvelope(envelope)).toThrow(/outside the envelope vocabulary/);
  });

  it('an envelope with no integration surfaces is rejected loudly', () => {
    const envelope = {
      capability: 'github',
      operations: ['push'],
      integrations: [],
      boundedEnvironment: null,
    };
    expect(() => assertValidRuntimeCapabilityEnvelope(envelope)).toThrow(/at least one integration surface/);
  });
});
