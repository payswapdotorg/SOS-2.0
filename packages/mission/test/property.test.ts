/**
 * Property tests — deterministic: fast-check is seeded globally (424242) in
 * test/setup.ts, so repeated runs generate identical sequences and yield
 * identical results (the W0.5 determinism discipline).
 *
 * The core property: RANDOMIZED REVISION CHAINS round-trip through the
 * canonical serializer — every artifact in every chain survives
 * serialize -> parse -> validate with byte-identical canonical form and a
 * content-addressed id that is stable under key reordering, and the chain
 * itself is complete, ordered and contiguous.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import {
  MissionStore,
  createMission,
  validateMission,
  validateMissionContent,
} from '../src/index.js';
import type { MissionContent, MissionGoalStatus } from '../src/index.js';

/** Recursively reverse the key order of every object (order-invariance probe). */
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

const uniqueSlugsArb = (minLength: number, maxLength: number) =>
  fc.uniqueArray(slugArb, { minLength, maxLength });

const statementArb = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ,.:;-]{3,60}/);
const axisArb = fc.stringMatching(/^[a-z][a-z0-9_.-]{0,15}/);
const rfc3339Arb = fc
  .date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2099-12-31T23:59:59Z') })
  .map((d) => d.toISOString());
const hex32Arb = fc.hexaString({ minLength: 32, maxLength: 32 }).noShrink();

/** Random VALID mission content (all invariants satisfied by construction). */
const missionContentArb: fc.Arbitrary<MissionContent> = fc
  .record({
    purpose: statementArb,
    measureIds: uniqueSlugsArb(0, 4),
    goalIds: uniqueSlugsArb(0, 4),
    outcomeIds: uniqueSlugsArb(0, 3),
    stakeholderIds: uniqueSlugsArb(0, 3),
    assumptionIds: uniqueSlugsArb(0, 3),
    ambiguityIds: uniqueSlugsArb(0, 3),
    constraintIds: uniqueSlugsArb(0, 3),
    seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
  })
  .map(({ purpose, measureIds, goalIds, outcomeIds, stakeholderIds, assumptionIds, ambiguityIds, constraintIds, seed }) => {
    // deterministic sub-selections from the seed
    const pick = <T>(items: T[], count: number): T[] => {
      if (items.length === 0 || count <= 0) return [];
      const start = seed % items.length;
      return items.slice(start, start + count);
    };
    const content: MissionContent = {
      purpose,
      goals: goalIds.map((id, index) => {
        const measures = measureIds.length > 0 ? pick(measureIds, (seed + index) % 2 === 0 ? 1 : 0) : [];
        const status: MissionGoalStatus = measures.length > 0 ? ((seed + index) % 2 === 0 ? 'MEASURABLE' : 'PROPOSED') : 'PROPOSED';
        return { id, statement: `Goal ${id}.`, status, measures };
      }),
      outcomes: outcomeIds.map((id) => ({
        id,
        description: `Outcome ${id}.`,
        goal_refs: pick(goalIds, (seed + id.length) % 3),
      })),
      stakeholders: stakeholderIds.map((id) => ({
        id,
        name: `Stakeholder ${id}`,
        interest: (seed + id.length) % 2 === 0 ? `Interest of ${id}.` : null,
      })),
      measures: measureIds.map((id) => ({
        id,
        description: `Measure ${id}.`,
        target: (seed + id.length) % 2 === 0 ? `<= ${((seed + id.length) % 100) + 1}` : null,
        unit: (seed + id.length) % 3 === 0 ? 'events/month' : null,
      })),
      assumptions: assumptionIds.map((id) => ({ id, statement: `Assumption ${id}.` })),
      ambiguities: ambiguityIds.map((id) => ({
        id,
        statement: `Ambiguity ${id}.`,
        resolution: (seed + id.length) % 2 === 0 ? `Resolved by ${id}.` : null,
      })),
      constraints: constraintIds.map((id) => ({
        id,
        statement: `Constraint ${id}.`,
        hard: (seed + id.length) % 2 === 0,
        bound:
          (seed + id.length) % 3 === 0
            ? { axis: pick(['monthly-cost', 'p95-latency', 'uptime'], 1)[0]!, direction: (seed + id.length) % 2 === 0 ? 'MAX' : 'MIN', limit: ((seed + id.length) % 1000) + 1 }
            : null,
      })),
    };
    return content;
  })
  .filter((content) => {
    // flat local-id namespace across the whole content
    const ids = [
      ...content.goals.map((g) => g.id),
      ...content.outcomes.map((o) => o.id),
      ...content.stakeholders.map((s) => s.id),
      ...content.measures.map((m) => m.id),
      ...content.assumptions.map((a) => a.id),
      ...content.ambiguities.map((a) => a.id),
      ...content.constraints.map((c) => c.id),
    ];
    return new Set(ids).size === ids.length;
  });

describe('property: mission content', () => {
  it('generated contents are valid; arbitrary contents accept/reject consistently', () => {
    fc.assert(
      fc.property(missionContentArb, (content) => validateMissionContent(content)),
      { numRuns: 200 },
    );
  });

  it('contents are invariant under key reordering (canonical identity)', () => {
    fc.assert(
      fc.property(missionContentArb, (content) => {
        const reordered = reverseKeyOrder(JSON.parse(canonicalSerialize(content)));
        return canonicalSerialize(reordered) === canonicalSerialize(content);
      }),
      { numRuns: 200 },
    );
  });
});

describe('property: randomized revision chains round-trip through the canonical serializer', () => {
  const revisionArb = fc.record({
    created_at: rfc3339Arb,
    grant_segment: hex32Arb,
    purpose: statementArb,
  });

  it('every artifact in a random chain survives serialize -> parse -> validate with a stable id', () => {
    fc.assert(
      fc.property(
        missionContentArb,
        fc.array(revisionArb, { minLength: 0, maxLength: 5 }),
        (baseContent, revisions) => {
          const store = new MissionStore();
          const root = store.put(
            createMission({
              content: baseContent,
              provenance: ['W1:property'],
              created_at: '2025-01-01T00:00:00.000Z',
              status: 'ACTIVE',
            }),
          );
          let current = root.envelope.id;
          for (let i = 0; i < revisions.length; i += 1) {
            const content = JSON.parse(JSON.stringify(baseContent)) as MissionContent;
            content.purpose = revisions[i]!.purpose;
            current = store.revise(current, {
              content,
              authority_grant: `sos://AuthorityGrant/${revisions[i]!.grant_segment}`,
              provenance: ['W1:property', `revision-${i + 1}`],
              created_at: revisions[i]!.created_at,
            }).revised.envelope.id;
          }

          const chainLength = revisions.length + 1;
          const history = store.history(current);
          if (history.length !== chainLength) return false;
          if (store.size !== chainLength) return false;
          if (!history.every((m, index) => m.envelope.version === index + 1)) return false;

          for (const mission of store.list()) {
            // canonical round trip
            const text = canonicalSerialize(mission);
            const parsed = JSON.parse(text);
            if (canonicalSerialize(parsed) !== text) return false;
            if (!validateMission(parsed)) return false;
            // id stability under key reordering
            const reordered = reverseKeyOrder(parsed);
            if (canonicalSerialize(reordered) !== text) return false;
            if (!validateMission(reordered)) return false;
          }

          // deterministic replay: identical chain construction -> identical ids
          const replayStore = new MissionStore();
          const replayRoot = replayStore.put(
            createMission({
              content: baseContent,
              provenance: ['W1:property'],
              created_at: '2025-01-01T00:00:00.000Z',
              status: 'ACTIVE',
            }),
          );
          if (replayRoot.envelope.id !== root.envelope.id) return false;
          let replayCurrent = replayRoot.envelope.id;
          for (let i = 0; i < revisions.length; i += 1) {
            const content = JSON.parse(JSON.stringify(baseContent)) as MissionContent;
            content.purpose = revisions[i]!.purpose;
            replayCurrent = replayStore.revise(replayCurrent, {
              content,
              authority_grant: `sos://AuthorityGrant/${revisions[i]!.grant_segment}`,
              provenance: ['W1:property', `revision-${i + 1}`],
              created_at: revisions[i]!.created_at,
            }).revised.envelope.id;
          }
          return replayCurrent === current;
        },
      ),
      { numRuns: 60 },
    );
  });

  it('revision chains never branch: exactly one ACTIVE mission per chain', () => {
    fc.assert(
      fc.property(
        missionContentArb,
        fc.array(revisionArb, { minLength: 1, maxLength: 4 }),
        (baseContent, revisions) => {
          const store = new MissionStore();
          const root = store.put(
            createMission({
              content: baseContent,
              provenance: ['W1:property'],
              created_at: '2025-01-01T00:00:00.000Z',
              status: 'ACTIVE',
            }),
          );
          let current = root.envelope.id;
          for (const revision of revisions) {
            current = store.revise(current, {
              content: baseContent,
              authority_grant: `sos://AuthorityGrant/${revision.grant_segment}`,
              provenance: ['W1:property'],
              created_at: revision.created_at,
            }).revised.envelope.id;
          }
          const active = store.active();
          return (
            active.length === 1 &&
            active[0]!.envelope.id === current &&
            store.revisionLinks().length === revisions.length
          );
        },
      ),
      { numRuns: 60 },
    );
  });
});
