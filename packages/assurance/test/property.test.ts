import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addObjection,
  createAssuranceCase,
  evaluateAssuranceCase,
  resolveObjection,
  validateAssuranceCase,
} from '../src/index.js';
import type { AssuranceCaseContent, Objection } from '../src/index.js';
import { SYSTEM_STATE_ID, T0, T1, T2, makeEvidence } from './helpers.js';

/**
 * Property tests for @sos-2/assurance (fixed seed — deterministic and
 * reproducible across runs, same discipline as the sibling packages):
 * randomized cases — evaluation determinism + canonical round trips.
 */

const fcId = fc
  .stringMatching(/^[a-z][a-z0-9-]{2,24}$/)
  .filter((value) => !value.includes('--'));

const fcStatement = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 .,'()-]{8,80}$/);

const fcClaim = fc.record({ id: fcId, statement: fcStatement });

const fcObjection: fc.Arbitrary<Objection> = fc
  .record({
    id: fcId,
    statement: fcStatement,
    raised_at: fc.constantFrom(T0, T1),
    status: fc.constantFrom<'OPEN' | 'RESOLVED'>('OPEN'),
  })
  .map((partial) => ({
    ...partial,
    resolution: null,
  }));

const fcCaseContent: fc.Arbitrary<AssuranceCaseContent> = fc
  .record({
    claims: fc.uniqueArray(fcClaim, { selector: (claim) => claim.id, minLength: 1, maxLength: 5 }),
    assumptions: fc.uniqueArray(fc.record({ id: fcId, statement: fcStatement }), {
      selector: (assumption) => assumption.id,
      maxLength: 3,
    }),
    objections: fc.uniqueArray(fcObjection, { selector: (objection) => objection.id, maxLength: 3 }),
  })
  .map((partial) => {
    const claimIds = partial.claims.map((claim) => claim.id);
    return {
      claims: partial.claims,
      arguments:
        claimIds.length >= 2
          ? [
              {
                id: 'argument-generated',
                strategy: 'The premises jointly support the conclusion.',
                conclusion: claimIds[0]!,
                premises: claimIds.slice(1),
              },
            ]
          : [],
      assumptions: partial.assumptions,
      hazards: [{ id: 'hazard-generated', description: 'A generated hazard.' }],
      controls: [{ id: 'control-generated', mechanism: 'A generated control.', addresses: ['hazard-generated'] }],
      evidence: [] as AssuranceCaseContent['evidence'],
      validity_conditions: [] as AssuranceCaseContent['validity_conditions'],
      objections: partial.objections,
    } satisfies AssuranceCaseContent;
  });

function makeCase(content: AssuranceCaseContent) {
  return createAssuranceCase({
    content,
    provenance: ['W8:property-test'],
    created_at: T1,
    status: 'ACTIVE',
  });
}

describe('property: randomized assurance cases', () => {
  it('every generated case creates a valid artifact with a spine AssuranceCase id', () => {
    fc.assert(
      fc.property(fcCaseContent, (content) => {
        const artifact = makeCase(content);
        expect(validateAssuranceCase(artifact)).toBe(true);
        expect(artifact.envelope.id).toMatch(/^sos:\/\/AssuranceCase\/[0-9a-f]{32}$/);
        return true;
      }),
    );
  });

  it('creation is deterministic and canonical round trips preserve validity', () => {
    fc.assert(
      fc.property(fcCaseContent, (content) => {
        const a = makeCase(content);
        const b = makeCase(JSON.parse(JSON.stringify(content)));
        expect(a).toEqual(b);
        const round = JSON.parse(JSON.stringify(a));
        expect(validateAssuranceCase(round)).toBe(true);
        expect(round).toEqual(a);
        return true;
      }),
    );
  });

  it('evaluation is deterministic: identical (case, input) pairs yield identical evaluations', () => {
    fc.assert(
      fc.property(fcCaseContent, fc.option(fc.constantFrom(T0, T1, T2), { nil: null }), (content, nowOverride) => {
        const artifact = makeCase(content);
        const now = nowOverride ?? T1;
        const input = {
          now,
          systemStateRevision: `${SYSTEM_STATE_ID}@v1` as string | null,
          implementation_revisions: {} as Record<string, string>,
          dependency_revisions: {} as Record<string, string>,
          environment_revisions: {} as Record<string, string>,
          evidence: [makeEvidence()] as const,
          assumption_checks: Object.fromEntries(content.assumptions.map((assumption) => [assumption.id, true])),
        };
        const first = evaluateAssuranceCase(artifact, input);
        const second = evaluateAssuranceCase(artifact, JSON.parse(JSON.stringify(input)));
        expect(first).toEqual(second);
        // Structural invariants on every verdict.
        expect(['VALID', 'OBJECTIONED', 'INVALID']).toContain(first.verdict);
        expect(first.invalidations.length > 0).toBe(first.verdict === 'INVALID');
        expect(first.open_objections.length > 0).toBe(first.verdict === 'OBJECTIONED');
        // The verdicts partition: exactly one of the three.
        expect(
          (first.verdict === 'VALID' ? 1 : 0) +
            (first.verdict === 'OBJECTIONED' ? 1 : 0) +
            (first.verdict === 'INVALID' ? 1 : 0),
        ).toBe(1);
        return true;
      }),
    );
  });

  it('with all bounds satisfied, no evidence refs and all assumptions checked, the verdict is driven only by objections', () => {
    fc.assert(
      fc.property(fcCaseContent, (content) => {
        const artifact = makeCase(content);
        const input = {
          now: T1,
          systemStateRevision: null,
          assumption_checks: Object.fromEntries(content.assumptions.map((assumption) => [assumption.id, true])),
        };
        const evaluation = evaluateAssuranceCase(artifact, input);
        const hasOpen = content.objections.some((objection) => objection.status === 'OPEN');
        expect(evaluation.verdict).toBe(hasOpen ? 'OBJECTIONED' : 'VALID');
        expect(evaluation.invalidations).toEqual([]);
        return true;
      }),
    );
  });

  it('objection revisions preserve the never-dropped and determinism invariants', () => {
    fc.assert(
      fc.property(fcCaseContent, fcObjection, (content, objection) => {
        const head = makeCase(content);
        fc.pre(!content.objections.some((existing) => existing.id === objection.id));
        const next = addObjection(head, {
          objection,
          provenance: ['W8:property-test:add'],
          created_at: T2,
        });
        // Retention: every previous objection id survives.
        for (const existing of content.objections) {
          expect(next.content.objections.some((entry) => entry.id === existing.id)).toBe(true);
        }
        // Determinism.
        const again = addObjection(head, {
          objection: JSON.parse(JSON.stringify(objection)),
          provenance: ['W8:property-test:add'],
          created_at: T2,
        });
        expect(again).toEqual(next);
        // Resolving the first OPEN objection keeps it on record.
        const firstOpen = next.content.objections.find((entry) => entry.status === 'OPEN');
        if (firstOpen !== undefined) {
          const resolved = resolveObjection(next, {
            objection_id: firstOpen.id,
            note: 'Property-test resolution.',
            resolved_at: T2,
            provenance: ['W8:property-test:resolve'],
            created_at: T2,
          });
          expect(
            resolved.content.objections.find((entry) => entry.id === firstOpen.id)?.status,
          ).toBe('RESOLVED');
        }
        return true;
      }),
    );
  });
});
