/**
 * Property tests — deterministic: fast-check is seeded globally (424242) in
 * test/setup.ts, so repeated runs generate identical sequences and yield
 * identical results (the W0.5 determinism discipline).
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import {
  checkMissionSubordination,
  createValueModel,
  validateValueModel,
  validateValueModelContent,
} from '../src/index.js';
import type { MissionConstraintView, MissionView, ValueModelContent } from '../src/index.js';

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

const slugArb = fc
  .tuple(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), fc.stringMatching(/^[a-z0-9-]{0,10}$/))
  .map(([first, rest]) => `${first}${rest}`);
const statementArb = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ,.:;-]{3,60}/);
const axisArb = fc.stringMatching(/^[a-z][a-z0-9_.-]{0,15}/);
const rfc3339Arb = fc
  .date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2099-12-31T23:59:59Z') })
  .map((d) => d.toISOString());

const valueContentArb: fc.Arbitrary<ValueModelContent> = fc
  .record({
    objectiveIds: fc.uniqueArray(slugArb, { minLength: 0, maxLength: 4 }),
    budgetIds: fc.uniqueArray(slugArb, { minLength: 0, maxLength: 3 }),
    incentiveIds: fc.uniqueArray(slugArb, { minLength: 0, maxLength: 3 }),
    opportunityIds: fc.uniqueArray(slugArb, { minLength: 0, maxLength: 3 }),
    constraintIds: fc.uniqueArray(slugArb, { minLength: 0, maxLength: 4 }),
    seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
  })
  .filter(({ objectiveIds, budgetIds, incentiveIds, opportunityIds, constraintIds }) => {
    const all = [...objectiveIds, ...budgetIds, ...incentiveIds, ...opportunityIds, ...constraintIds];
    return new Set(all).size === all.length;
  })
  .map(({ objectiveIds, budgetIds, incentiveIds, opportunityIds, constraintIds, seed }) => {
    const pick = <T>(items: T[], count: number): T[] => {
      if (items.length === 0 || count <= 0) return [];
      const start = seed % items.length;
      return items.slice(start, start + count);
    };
    const boundedType = (['BUDGET_LIMIT', 'SERVICE_LEVEL', 'RISK_TOLERANCE'] as const)[seed % 3]!;
    return {
      objectives: objectiveIds.map((id, i) => ({
        id,
        statement: `Objective ${id}.`,
        direction: (['MAXIMIZE', 'MINIMIZE', 'MAINTAIN'] as const)[(seed + i) % 3]!,
        metric: `metric-${(seed + i) % 97}`,
      })),
      budgets: budgetIds.map((id, i) => ({
        id,
        resource: ['monthly-cost', 'compute-hours', 'storage-gb'][(seed + i) % 3]!,
        limit: ((seed + i * 7) % 5000) + 1,
        unit: 'USD',
      })),
      incentives: incentiveIds.map((id, i) => ({
        id,
        statement: `Incentive ${id}.`,
        aligns_with: pick(objectiveIds, (seed + i) % 2),
      })),
      opportunities: opportunityIds.map((id, i) => ({
        id,
        statement: `Opportunity ${id}.`,
        expected_value: (seed + i) % 2 === 0 ? ((seed + i * 13) % 10000) + 1 : null,
      })),
      constraints: constraintIds.map((id, i) =>
        (seed + i) % 4 === 3
          ? { id, type: 'PREFERENCE' as const, statement: `Preference ${id}.`, bound: null }
          : {
              id,
              type: boundedType,
              statement: `Constraint ${id}.`,
              bound: {
                axis: ['monthly-cost', 'p95-latency', 'uptime'][(seed + i) % 3]!,
                direction: (['MAX', 'MIN'] as const)[(seed + i) % 2]!,
                limit: ((seed + i * 11) % 1000) + 1,
              },
            },
      ),
      approved: seed % 2 === 0,
    } satisfies ValueModelContent;
  });

describe('property: value model content', () => {
  it('generated contents are valid', () => {
    fc.assert(
      fc.property(valueContentArb, (content) => validateValueModelContent(content)),
      { numRuns: 200 },
    );
  });

  it('value model artifacts round-trip through the canonical serializer with stable ids', () => {
    fc.assert(
      fc.property(valueContentArb, rfc3339Arb, (content, createdAt) => {
        const input = { content, provenance: ['W1:property'], created_at: createdAt };
        const { artifact } = createValueModel(input);
        const text = canonicalSerialize(artifact);
        const parsed = JSON.parse(text);
        if (canonicalSerialize(parsed) !== text) return false;
        if (!validateValueModel(parsed)) return false;
        // determinism: identical input -> identical id
        if (createValueModel(input).artifact.envelope.id !== artifact.envelope.id) return false;
        // key-order invariance
        const reordered = reverseKeyOrder(parsed);
        return canonicalSerialize(reordered) === text && validateValueModel(reordered);
      }),
      { numRuns: 200 },
    );
  });
});

const missionConstraintArb: fc.Arbitrary<MissionConstraintView> = fc.record({
  id: slugArb,
  statement: statementArb,
  hard: fc.boolean(),
  bound: fc.option(
    fc.record({
      axis: fc.constantFrom('monthly-cost', 'p95-latency', 'uptime'),
      direction: fc.constantFrom('MAX' as const, 'MIN' as const),
      limit: fc.integer({ min: 1, max: 2000 }),
    }),
    { nil: null },
  ),
});

const missionViewArb: fc.Arbitrary<MissionView> = fc.record({
  artifact_id: fc
    .hexaString({ minLength: 32, maxLength: 32 })
    .map((segment) => `sos://Mission/${segment}`),
  constraints: fc.uniqueArray(missionConstraintArb, { minLength: 0, maxLength: 5, selector: (c) => c.id }),
});

describe('property: mission subordination', () => {
  it('is deterministic and total: same inputs -> identical results', () => {
    fc.assert(
      fc.property(valueContentArb, missionViewArb, (content, mission) => {
        const a = checkMissionSubordination(content, mission);
        const b = checkMissionSubordination(content, mission);
        return JSON.stringify(a) === JSON.stringify(b) && (a.status === 'CONFLICT') === (a.conflicts.length > 0);
      }),
      { numRuns: 200 },
    );
  });

  it('value limits within (or equal to) hard mission limits never conflict', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.constantFrom('MAX' as const, 'MIN' as const),
        (missionLimit, slack, direction) => {
          const mission: MissionView = {
            artifact_id: `sos://Mission/${'4'.repeat(32)}`,
            constraints: [
              { id: 'hard-bound', statement: 'Hard bound.', hard: true, bound: { axis: 'monthly-cost', direction, limit: missionLimit } },
            ],
          };
          const valueLimit = direction === 'MAX' ? Math.max(1, missionLimit - slack % missionLimit) : missionLimit + slack;
          const content: ValueModelContent = {
            objectives: [],
            budgets: [],
            incentives: [],
            opportunities: [],
            constraints: [
              { id: 'within', type: 'BUDGET_LIMIT', statement: 'Within.', bound: { axis: 'monthly-cost', direction, limit: valueLimit } },
            ],
            approved: true,
          };
          return checkMissionSubordination(content, mission).status === 'SUBORDINATE';
        },
      ),
      { numRuns: 200 },
    );
  });

  it('value limits exceeding hard mission limits ALWAYS conflict (value never outranks mission)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.constantFrom('MAX' as const, 'MIN' as const),
        (missionLimit, excess, direction) => {
          const mission: MissionView = {
            artifact_id: `sos://Mission/${'5'.repeat(32)}`,
            constraints: [
              { id: 'hard-bound', statement: 'Hard bound.', hard: true, bound: { axis: 'monthly-cost', direction, limit: missionLimit } },
            ],
          };
          const valueLimit = direction === 'MAX' ? missionLimit + excess : Math.max(0, missionLimit - excess);
          const content: ValueModelContent = {
            objectives: [],
            budgets: [],
            incentives: [],
            opportunities: [],
            constraints: [
              { id: 'beyond', type: 'BUDGET_LIMIT', statement: 'Beyond.', bound: { axis: 'monthly-cost', direction, limit: valueLimit } },
            ],
            approved: true,
          };
          const result = checkMissionSubordination(content, mission);
          return (
            result.status === 'CONFLICT' &&
            result.conflicts.length === 1 &&
            result.conflicts[0]!.mission_constraint_id === 'hard-bound'
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
