/**
 * Runtime descriptor tests — typed descriptors (kind, version,
 * capabilities, constraints, context constraints) and context matching
 * (platform behavior is Context/Adapter data).
 */

import { describe, expect, it } from 'vitest';
import {
  assertValidRuntimeDescriptor,
  runtimeMatchesContext,
  selectRuntimesForContext,
  validateRuntimeDescriptor,
} from '../src/index.js';
import type { RuntimeDescriptor } from '../src/index.js';
import { contextFixture } from './helpers.js';

describe('runtime descriptor validation', () => {
  it('accepts a well-formed descriptor', () => {
    const descriptor = {
      id: 'runtime:checkout-sandbox',
      kind: 'in-memory',
      version: '1.0.0',
      capabilities: ['evaluate-candidate'],
      constraints: [
        { kind: 'MAX_DURATION_MS', max_ms: 5000 },
        { kind: 'NETWORK_ACCESS', allowed: false },
      ],
      context_constraints: { platform: 'server' },
    };
    expect(() => assertValidRuntimeDescriptor(descriptor)).not.toThrow();
    expect(validateRuntimeDescriptor(descriptor)).toBe(true);
  });

  it('rejects malformed ids, kinds, versions', () => {
    expect(() =>
      assertValidRuntimeDescriptor({
        id: '',
        kind: 'in-memory',
        version: '1',
        capabilities: ['op'],
        constraints: [],
        context_constraints: {},
      }),
    ).toThrow();
    expect(() =>
      assertValidRuntimeDescriptor({
        id: 'r',
        kind: 'quantum',
        version: '1',
        capabilities: ['op'],
        constraints: [],
        context_constraints: {},
      }),
    ).toThrow(/kind/);
    expect(() =>
      assertValidRuntimeDescriptor({
        id: 'r',
        kind: 'container',
        version: '',
        capabilities: ['op'],
        constraints: [],
        context_constraints: {},
      }),
    ).toThrow();
  });

  it('rejects empty or duplicate capabilities (the host executes DECLARED operations)', () => {
    for (const capabilities of [[], ['op', 'op'], ['op', '']]) {
      expect(() =>
        assertValidRuntimeDescriptor({
          id: 'r',
          kind: 'container',
          version: '1',
          capabilities,
          constraints: [],
          context_constraints: {},
        }),
      ).toThrow(/capabilit/);
    }
  });

  it('rejects malformed constraints and duplicates', () => {
    expect(() =>
      assertValidRuntimeDescriptor({
        id: 'r',
        kind: 'container',
        version: '1',
        capabilities: ['op'],
        constraints: [{ kind: 'MAX_DURATION_MS', max_ms: 0 }],
        context_constraints: {},
      }),
    ).toThrow();
    expect(() =>
      assertValidRuntimeDescriptor({
        id: 'r',
        kind: 'container',
        version: '1',
        capabilities: ['op'],
        constraints: [{ kind: 'NETWORK_ACCESS', allowed: 'yes' }],
        context_constraints: {},
      }),
    ).toThrow();
    expect(() =>
      assertValidRuntimeDescriptor({
        id: 'r',
        kind: 'container',
        version: '1',
        capabilities: ['op'],
        constraints: [
          { kind: 'MAX_MEMORY_MB', max_mb: 512 },
          { kind: 'MAX_MEMORY_MB', max_mb: 1024 },
        ],
        context_constraints: {},
      }),
    ).toThrow(/duplicate-free/);
  });

  it('rejects context constraints over UNKNOWN dimensions (platform behavior is typed context data)', () => {
    expect(() =>
      assertValidRuntimeDescriptor({
        id: 'r',
        kind: 'edge-function',
        version: '1',
        capabilities: ['op'],
        constraints: [],
        context_constraints: { mystery_dimension: 'x' },
      }),
    ).toThrow(/UNKNOWN context dimension/);
  });
});

describe('runtime context matching (platform behavior is Context/Adapter data)', () => {
  const iosRuntime: RuntimeDescriptor = {
    id: 'runtime:ios',
    kind: 'edge-function',
    version: '1',
    capabilities: ['op'],
    constraints: [],
    context_constraints: { platform: 'ios', environment: 'production' },
  };
  const unconstrainedRuntime: RuntimeDescriptor = {
    id: 'runtime:any',
    kind: 'container',
    version: '1',
    capabilities: ['op'],
    constraints: [],
    context_constraints: {},
  };

  it('matches when every declared dimension value equals the context value', () => {
    expect(runtimeMatchesContext(iosRuntime, contextFixture({ platform: 'ios', environment: 'production' }))).toBe(true);
    expect(runtimeMatchesContext(iosRuntime, contextFixture({ platform: 'web', environment: 'production' }))).toBe(false);
    expect(runtimeMatchesContext(iosRuntime, contextFixture({ platform: 'ios', environment: 'staging' }))).toBe(false);
  });

  it('does not match when the context lacks a constrained dimension', () => {
    expect(runtimeMatchesContext(iosRuntime, contextFixture({ platform: 'ios' }))).toBe(false);
  });

  it('unconstrained runtimes match any context', () => {
    expect(runtimeMatchesContext(unconstrainedRuntime, contextFixture({ platform: 'web' }))).toBe(true);
    expect(runtimeMatchesContext(unconstrainedRuntime, contextFixture({}))).toBe(true);
  });

  it('matches typed dimensions per their value type (enum/text/boolean/number/string-list)', () => {
    const typed: RuntimeDescriptor = {
      id: 'runtime:typed',
      kind: 'process',
      version: '1',
      capabilities: ['op'],
      constraints: [],
      context_constraints: { regulatory: 'GDPR', device: 'phone' },
    };
    expect(
      runtimeMatchesContext(typed, contextFixture({ regulatory: ['GDPR', 'HIPAA'], device: 'phone' })),
    ).toBe(true); // string-list membership + text equality
    expect(
      runtimeMatchesContext(typed, contextFixture({ regulatory: ['CCPA'], device: 'phone' })),
    ).toBe(false);
  });

  it('selects deterministically in input order', () => {
    const context = contextFixture({ platform: 'ios', environment: 'production' });
    const selected = selectRuntimesForContext([unconstrainedRuntime, iosRuntime, unconstrainedRuntime], context);
    expect(selected.map((r) => r.id)).toEqual(['runtime:any', 'runtime:ios', 'runtime:any']);
    const none = selectRuntimesForContext([iosRuntime], contextFixture({ platform: 'web' }));
    expect(none).toEqual([]);
  });
});
