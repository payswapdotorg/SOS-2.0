import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import {
  BUILT_IN_CONTEXT_DIMENSIONS,
  CONTEXT_VALUE_TYPES,
  createContext,
  createDimensionRegistry,
  isRegisteredContextDimension,
  isValidDimensionValue,
  listContextDimensions,
  registerContextDimension,
  validateContext,
  validateContextDimensions,
} from '../src/index.js';
import type { ContextDimensionSpec } from '../src/index.js';

const PROVENANCE = ['W1:test'];
const T0 = '2025-01-01T00:00:00.000Z';

describe('dimension registry (unit)', () => {
  it('seeds exactly the eight §5 built-in dimensions', () => {
    const names = BUILT_IN_CONTEXT_DIMENSIONS.map((d) => d.name).sort();
    expect(names).toEqual(
      [
        'device',
        'environment',
        'geography',
        'platform',
        'regulatory',
        'time',
        'user_cohort',
        'workload',
      ].sort(),
    );
    expect(listContextDimensions().map((d) => d.name)).toEqual(names);
  });

  it('built-ins are typed (the value-type vocabulary is frozen)', () => {
    expect(CONTEXT_VALUE_TYPES).toEqual(['text', 'number', 'boolean', 'enum', 'string-list']);
    const byName = new Map(BUILT_IN_CONTEXT_DIMENSIONS.map((d) => [d.name, d]));
    expect(byName.get('environment')!.valueType).toBe('enum');
    expect(byName.get('environment')!.enumValues).toEqual(['development', 'test', 'staging', 'production']);
    expect(byName.get('regulatory')!.valueType).toBe('string-list');
    expect(byName.get('user_cohort')!.valueType).toBe('text');
  });

  it('registers new dimensions via the explicit API (default and isolated registries)', () => {
    const spec: ContextDimensionSpec = {
      name: 'tenant_tier',
      valueType: 'enum',
      description: 'Contract tier.',
      enumValues: ['free', 'pro', 'enterprise'],
    };
    registerContextDimension(spec);
    expect(isRegisteredContextDimension('tenant_tier')).toBe(true);

    const isolated = createDimensionRegistry();
    expect(isolated.isRegistered('tenant_tier')).toBe(false);
    isolated.register({ name: 'peak_qps', valueType: 'number', description: 'Observed peak queries per second.' });
    expect(isolated.isRegistered('peak_qps')).toBe(true);
    expect(isolated.list().map((d) => d.name)).toContain('peak_qps');
  });

  it('rejects duplicate registrations and invalid specs (no unregister)', () => {
    expect(() => registerContextDimension({ name: 'user_cohort', valueType: 'text', description: 'dup' })).toThrow(
      /already registered/,
    );
    expect(() => registerContextDimension({ name: 'BadName', valueType: 'text', description: 'x' })).toThrow(
      /name must match/,
    );
    expect(() =>
      registerContextDimension({ name: 'ok_name', valueType: 'vector' as never, description: 'x' }),
    ).toThrow(/valueType must be one of/);
    expect(() => registerContextDimension({ name: 'ok_name', valueType: 'text', description: '' })).toThrow(
      /description must be a non-empty string/,
    );
    expect(() =>
      registerContextDimension({ name: 'ok_name', valueType: 'enum', description: 'x', enumValues: [] }),
    ).toThrow(/enumValues/);
    expect(() =>
      registerContextDimension({ name: 'ok_name', valueType: 'enum', description: 'x', enumValues: ['a', 'a'] }),
    ).toThrow(/enumValues/);
    expect(() =>
      registerContextDimension({
        name: 'ok_name',
        valueType: 'text',
        description: 'x',
        enumValues: ['a'],
      } as ContextDimensionSpec),
    ).toThrow(/must not carry enumValues/);
  });
});

describe('dimension value validation (unit)', () => {
  const registry = createDimensionRegistry();
  const text = registry.get('platform')!;
  const env = registry.get('environment')!;
  const regulatory = registry.get('regulatory')!;

  it('accepts type-correct values', () => {
    expect(isValidDimensionValue(text, 'web')).toBe(true);
    expect(isValidDimensionValue(env, 'production')).toBe(true);
    expect(isValidDimensionValue(regulatory, ['GDPR', 'HIPAA'])).toBe(true);
  });

  it('rejects type-incorrect values', () => {
    expect(isValidDimensionValue(text, '')).toBe(false);
    expect(isValidDimensionValue(text, 42)).toBe(false);
    expect(isValidDimensionValue(env, 'prod')).toBe(false);
    expect(isValidDimensionValue(env, 'production '.trim() + ' ')).toBe(false);
    expect(isValidDimensionValue(regulatory, [])).toBe(false);
    expect(isValidDimensionValue(regulatory, ['GDPR', 'GDPR'])).toBe(false);
    expect(isValidDimensionValue(regulatory, ['GDPR', 3])).toBe(false);
    expect(isValidDimensionValue(regulatory, 'GDPR')).toBe(false);
  });

  it('number and boolean dimensions (via custom registrations) validate strictly', () => {
    const isolated = createDimensionRegistry();
    isolated.register({ name: 'peak_qps', valueType: 'number', description: 'Peak qps.' });
    isolated.register({ name: 'is_canary', valueType: 'boolean', description: 'Canary flag.' });
    expect(isValidDimensionValue(isolated.get('peak_qps')!, 123.5)).toBe(true);
    expect(isValidDimensionValue(isolated.get('peak_qps')!, Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidDimensionValue(isolated.get('peak_qps')!, '123')).toBe(false);
    expect(isValidDimensionValue(isolated.get('is_canary')!, true)).toBe(true);
    expect(isValidDimensionValue(isolated.get('is_canary')!, 'true')).toBe(false);
  });
});

describe('context artifact creation (unit)', () => {
  it('creates a context artifact with deterministic id and round-trips canonically', () => {
    const input = {
      dimensions: {
        user_cohort: 'beta-testers',
        platform: 'web',
        environment: 'production',
        regulatory: ['GDPR'],
      },
      provenance: PROVENANCE,
      created_at: T0,
    };
    const context = createContext(input);
    expect(context.envelope.kind).toBe('Context');
    expect(context.envelope.status).toBe('DRAFT');
    expect(context.envelope.id.startsWith('sos://Context/')).toBe(true);
    expect(createContext(input).envelope.id).toBe(context.envelope.id);
    expect(validateContext(context)).toBe(true);

    const text = canonicalSerialize(context);
    const parsed = JSON.parse(text);
    expect(canonicalSerialize(parsed)).toBe(text);
    expect(validateContext(parsed)).toBe(true);
  });

  it('an empty context (no dimensions) is valid', () => {
    const context = createContext({ dimensions: {}, provenance: PROVENANCE, created_at: T0 });
    expect(validateContext(context)).toBe(true);
    expect(context.content.dimensions).toEqual({});
  });

  it('a context may use custom registered dimensions', () => {
    const isolated = createDimensionRegistry();
    // a dimension name NEVER registered in the default (process-wide) registry
    isolated.register({ name: 'isolated_tier', valueType: 'enum', description: 'Contract tier.', enumValues: ['free', 'pro'] });
    const context = createContext({
      dimensions: { isolated_tier: 'pro' },
      provenance: PROVENANCE,
      created_at: T0,
      registry: isolated,
    });
    expect(validateContext(context, isolated)).toBe(true);
    // without the registry it was created against, validation rejects (unknown dimension)
    expect(validateContext(context)).toBe(false);
  });

  it('validateContextDimensions is order-invariant (canonical identity)', () => {
    const dimensions = { platform: 'web', environment: 'test' };
    validateContextDimensions(dimensions);
    validateContextDimensions({ environment: 'test', platform: 'web' });
    expect(
      createContext({ dimensions, provenance: PROVENANCE, created_at: T0 }).envelope.id,
    ).toBe(
      createContext({ dimensions: { environment: 'test', platform: 'web' }, provenance: PROVENANCE, created_at: T0 }).envelope.id,
    );
  });
});
