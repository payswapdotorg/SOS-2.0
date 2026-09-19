/**
 * Property tests — deterministic: fast-check is seeded globally (424242) in
 * test/setup.ts (the W0.5 determinism discipline).
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { createContext, createDimensionRegistry, validateContext, validateContextDimensions } from '../src/index.js';
import type { ContextDimensionSpec } from '../src/index.js';

function reverseKeyOrder<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(reverseKeyOrder) as unknown as T;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    const result: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      result[key] = reverseKeyOrder(val);
    }
    return result as T;
  }
  return value;
}

const rfc3339Arb = fc
  .date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2099-12-31T23:59:59Z') })
  .map((d) => d.toISOString());

/** An isolated registry with randomized extra dimensions on top of the built-ins. */
const registryArb: fc.Arbitrary<{ registry: ReturnType<typeof createDimensionRegistry>; specs: ContextDimensionSpec[] }> = fc
  .record({
    names: fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9_]{2,12}$/), { minLength: 0, maxLength: 4 }),
    types: fc.array(fc.constantFrom(...(['number', 'boolean', 'text', 'string-list'] as const)), { minLength: 0, maxLength: 4 }),
  })
  .map(({ names, types }) => {
    const registry = createDimensionRegistry();
    const specs: ContextDimensionSpec[] = [];
    names.forEach((name, index) => {
      const valueType = types[index % Math.max(types.length, 1)] ?? 'text';
      const spec: ContextDimensionSpec = { name, valueType, description: `Property dimension ${name}.` };
      registry.register(spec);
      specs.push(spec);
    });
    return { registry, specs };
  });

function valueFor(spec: ContextDimensionSpec, seed: number): unknown {
  switch (spec.valueType) {
    case 'number':
      return seed % 1000;
    case 'boolean':
      return seed % 2 === 0;
    case 'string-list':
      return [`regime-${seed % 5}`, `regime-${(seed + 1) % 5}`];
    case 'enum':
      return (spec.enumValues ?? ['x'])[seed % Math.max(spec.enumValues?.length ?? 1, 1)];
    case 'text':
    default:
      return `value-${seed % 97}`;
  }
}

const builtInValueArb = fc
  .record({
    seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
    useUserCohort: fc.boolean(),
    usePlatform: fc.boolean(),
    useDevice: fc.boolean(),
    useEnvironment: fc.boolean(),
    useWorkload: fc.boolean(),
    useGeography: fc.boolean(),
    useTime: fc.boolean(),
    useRegulatory: fc.boolean(),
  })
  .map(({ seed, ...flags }) => {
    const dimensions: Record<string, unknown> = {};
    if (flags.useUserCohort) dimensions['user_cohort'] = `cohort-${seed % 13}`;
    if (flags.usePlatform) dimensions['platform'] = `platform-${seed % 17}`;
    if (flags.useDevice) dimensions['device'] = `device-${seed % 11}`;
    if (flags.useEnvironment) dimensions['environment'] = ['development', 'test', 'staging', 'production'][seed % 4]!;
    if (flags.useWorkload) dimensions['workload'] = `workload-${seed % 7}`;
    if (flags.useGeography) dimensions['geography'] = `geo-${seed % 5}`;
    if (flags.useTime) dimensions['time'] = new Date(Date.UTC(2020 + (seed % 5), 0, 1 + (seed % 27))).toISOString();
    if (flags.useRegulatory) dimensions['regulatory'] = ['GDPR', 'HIPAA', 'SOC2'].filter((_, index) => (seed + index) % 2 === 0);
    return dimensions;
  })
  .filter((dimensions) => (dimensions['regulatory'] as string[] | undefined)?.length !== 0);

describe('property: context artifacts', () => {
  it('random valid dimension sets create artifacts that round-trip canonically with stable ids', () => {
    fc.assert(
      fc.property(builtInValueArb, rfc3339Arb, (dimensions, createdAt) => {
        const input = { dimensions, provenance: ['W1:property'], created_at: createdAt };
        const context = createContext(input);
        const text = canonicalSerialize(context);
        const parsed = JSON.parse(text);
        if (canonicalSerialize(parsed) !== text) return false;
        if (!validateContext(parsed)) return false;
        if (createContext(input).envelope.id !== context.envelope.id) return false;
        const reordered = reverseKeyOrder(parsed);
        return canonicalSerialize(reordered) === text && validateContext(reordered);
      }),
      { numRuns: 250 },
    );
  });

  it('random dimension maps validate deterministically (same input -> same outcome)', () => {
    fc.assert(
      fc.property(builtInValueArb, (dimensions) => {
        const first = (() => {
          try {
            validateContextDimensions(dimensions);
            return 'ok';
          } catch (error) {
            return (error as Error).message;
          }
        })();
        const second = (() => {
          try {
            validateContextDimensions(dimensions);
            return 'ok';
          } catch (error) {
            return (error as Error).message;
          }
        })();
        return first === second;
      }),
      { numRuns: 250 },
    );
  });

  it('random values for custom registered dimensions are accepted iff type-correct (registry isolation)', () => {
    fc.assert(
      fc.property(
        registryArb,
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        fc.option(fc.constantFrom('corrupt'), { nil: undefined }),
        ({ registry, specs }, seed, corruption) => {
          if (specs.length === 0) return true;
          const dimensions: Record<string, unknown> = {};
          for (const spec of specs) {
            dimensions[spec.name] = valueFor(spec, seed);
          }
          if (corruption === 'corrupt') {
            // corrupt the first dimension's value in a type-breaking way
            const [first] = specs;
            dimensions[first!.name] =
              first!.valueType === 'boolean' ? 'not-a-boolean'
              : first!.valueType === 'number' ? 'not-a-number'
              : 12345;
          }
          let accepted: boolean;
          try {
            validateContextDimensions(dimensions, registry);
            accepted = true;
          } catch {
            accepted = false;
          }
          // values generated by valueFor are type-correct BY CONSTRUCTION;
          // corrupted values must be rejected for these value types.
          return corruption === undefined ? accepted : !accepted;
        },
      ),
      { numRuns: 150 },
    );
  });
});
