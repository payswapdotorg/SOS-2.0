/**
 * Integration tier model tests (Work Order P5): the frozen §4 order, rank
 * comparisons, guard strictness, and the non-semantic identifier
 * discipline.
 */

import { describe, expect, it } from 'vitest';
import { ARTIFACT_ID_PATTERN } from '@sos-2/semantic-spine';
import {
  INTEGRATION_TIERS,
  INTEGRATION_TIER_RANK,
  InvalidRuntimeContractError,
  RUNTIME_INTEGRATION_PRIORITY_CONTRACT,
  assertValidRuntimeIntegration,
  assertValidRuntimeIdentifier,
  integrationTierRank,
  isHigherControlSurface,
  isIntegrationTier,
  isSemanticIdShaped,
} from '../src/index.js';

function integrationFixture(overrides: Record<string, unknown> = {}) {
  return {
    integration_id: 'github-native-api',
    tier: 'native-api',
    capability: 'github',
    endpoint: 'https://api.github.com',
    operations: ['createPullRequest', 'push'],
    available: true,
    ...overrides,
  };
}

describe('the frozen §4 integration priority order', () => {
  it('lists the five tiers in the architecture order (native API first, UI automation last)', () => {
    expect(INTEGRATION_TIERS).toEqual(['native-api', 'mcp-protocol', 'local-bridge', 'extension', 'ui-automation']);
  });

  it('ranks the tiers 1..5 with native API as the highest control surface', () => {
    expect(INTEGRATION_TIER_RANK['native-api']).toBe(1);
    expect(INTEGRATION_TIER_RANK['mcp-protocol']).toBe(2);
    expect(INTEGRATION_TIER_RANK['local-bridge']).toBe(3);
    expect(INTEGRATION_TIER_RANK['extension']).toBe(4);
    expect(INTEGRATION_TIER_RANK['ui-automation']).toBe(5);
  });

  it('integrationTierRank throws loudly on an unknown tier (never defaulted)', () => {
    expect(() => integrationTierRank('telepathy' as never)).toThrow(InvalidRuntimeContractError);
  });

  it('isHigherControlSurface follows the frozen order', () => {
    expect(isHigherControlSurface('native-api', 'extension')).toBe(true);
    expect(isHigherControlSurface('ui-automation', 'native-api')).toBe(false);
    expect(isHigherControlSurface('mcp-protocol', 'mcp-protocol')).toBe(false);
  });

  it('isIntegrationTier is a closed vocabulary check', () => {
    expect(isIntegrationTier('native-api')).toBe(true);
    expect(isIntegrationTier('carrier-pigeon')).toBe(false);
    expect(isIntegrationTier(null)).toBe(false);
  });

  it('encodes the never-require-an-extension rule as a machine-checkable contract record', () => {
    expect(RUNTIME_INTEGRATION_PRIORITY_CONTRACT.rule).toBe('Use the highest available control surface');
    expect(RUNTIME_INTEGRATION_PRIORITY_CONTRACT.order).toEqual(INTEGRATION_TIERS);
    expect(RUNTIME_INTEGRATION_PRIORITY_CONTRACT.neverRequireAnExtension).toContain(
      'never require an extension when an equivalent safe API is available',
    );
  });
});

describe('runtime integration surface guard', () => {
  it('accepts a well-formed surface', () => {
    expect(() => assertValidRuntimeIntegration(integrationFixture())).not.toThrow();
  });

  it('requires the exact field set (extra fields are loud, not ignored)', () => {
    const forged = { ...integrationFixture(), vendor: 'acme' };
    expect(() => assertValidRuntimeIntegration(forged)).toThrow(/exact field set/);
  });

  it('rejects an empty or duplicate operation list', () => {
    expect(() => assertValidRuntimeIntegration(integrationFixture({ operations: [] }))).toThrow(/operations/);
    expect(() => assertValidRuntimeIntegration(integrationFixture({ operations: ['push', 'push'] }))).toThrow(/operations/);
  });

  it('rejects an unknown tier', () => {
    expect(() => assertValidRuntimeIntegration(integrationFixture({ tier: 'mental-link' }))).toThrow(/tier/);
  });
});

describe('the non-semantic identifier discipline', () => {
  it('a spine-shaped id is NEVER a valid runtime identifier (loud rejection)', () => {
    const semanticId = `sos://Mission/${'a'.repeat(32)}`;
    expect(ARTIFACT_ID_PATTERN.test(semanticId)).toBe(true);
    expect(() => assertValidRuntimeIdentifier(semanticId, 'runtime identifier')).toThrow(/never a SOS semantic identity/);
  });

  it('a value embedding sos:// anywhere is rejected', () => {
    expect(() => assertValidRuntimeIdentifier('bridge:sos://Mission/abc', 'runtime identifier')).toThrow(/sos:\/\/ semantic reference/);
  });

  it('plain runtime identifiers pass', () => {
    expect(() => assertValidRuntimeIdentifier('github-native-api', 'runtime identifier')).not.toThrow();
    expect(() => assertValidRuntimeIdentifier('body:acme-runner-1', 'runtime identifier')).not.toThrow();
  });

  it('empty and non-string values are rejected', () => {
    expect(() => assertValidRuntimeIdentifier('', 'runtime identifier')).toThrow(/non-empty string/);
    expect(() => assertValidRuntimeIdentifier(42, 'runtime identifier')).toThrow(/non-empty string/);
  });

  it('isSemanticIdShaped consumes the spine pattern (no re-implementation)', () => {
    expect(isSemanticIdShaped(`sos://AuthorityGrant/${'0'.repeat(32)}`)).toBe(true);
    expect(isSemanticIdShaped('plain-id')).toBe(false);
  });
});
