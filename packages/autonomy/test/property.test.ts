/**
 * Property tests: randomized requests — enforcement determinism, total
 * escalation-matrix coverage, verdict totality over the randomized space.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AUTONOMY_LEVELS,
  BLAST_RADII,
  ESCALATION_MATRIX,
  REVERSIBILITY_CLASSES,
  escalates,
  evaluateAutonomy,
  evaluateAuthorityCoverage,
  requiredLevel,
} from '../src/index.js';
import type { AutonomyEnforcementRequest } from '../src/index.js';
import { DEFAULT_TARGET, enforcementRequest, validGrant } from './helpers.js';
import { createGrant } from '@sos-2/authority';

const actionKindArb = fc.constantFrom<'READ' | 'REVISE' | 'RETIRE' | 'PROMOTE' | 'DELEGATE'>(
  'READ',
  'REVISE',
  'RETIRE',
  'PROMOTE',
  'DELEGATE',
);
const blastArb = fc.constantFrom<'COMPONENT' | 'SERVICE' | 'SYSTEM' | 'ORGANIZATION'>(
  'COMPONENT',
  'SERVICE',
  'SYSTEM',
  'ORGANIZATION',
);
const riskArb = fc.constantFrom<'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE'>('LOW', 'MODERATE', 'HIGH', 'SEVERE');
const reversibilityArb = fc.constantFrom<'REVERSIBLE' | 'PARTIALLY_REVERSIBLE' | 'IRREVERSIBLE'>(
  'REVERSIBLE',
  'PARTIALLY_REVERSIBLE',
  'IRREVERSIBLE',
);
const permissionSubsetArb = fc
  .uniqueArray(fc.constantFrom('READ', 'REVISE', 'RETIRE', 'PROMOTE', 'DELEGATE'), { minLength: 1, maxLength: 5 });

const requestArb = fc
  .record({
    action_kind: actionKindArb,
    blast_radius: blastArb,
    risk: riskArb,
    reversibility: reversibilityArb,
    with_grant: fc.boolean(),
    grant_permissions: permissionSubsetArb,
    with_explicit_decision: fc.boolean(),
  })
  .map((flags) => {
    const grant = flags.with_grant
      ? createGrant({
          grantee: 'property-actor',
          scope: { kind: 'KIND', artifact_kind: 'Mission' },
          permissions: flags.grant_permissions,
          expiry: { kind: 'TIME', at: '2025-01-05T00:00:00.000Z' },
          provenance: ['W10:autonomy-property'],
          created_at: '2025-01-01T00:00:00.000Z',
          status: 'ACTIVE',
        })
      : null;
    const request: AutonomyEnforcementRequest = {
      action_kind: flags.action_kind,
      target: DEFAULT_TARGET,
      blast_radius: flags.blast_radius,
      risk: flags.risk,
      reversibility: flags.reversibility,
      grants: grant === null ? [] : [grant],
      evaluation_point: { kind: 'TIME', now: '2025-01-02T00:00:00.000Z' },
      explicit_authority_decision_ref: flags.with_explicit_decision
        ? 'sos://Decision/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        : null,
    };
    return { request, flags };
  });

describe('property: enforcement is deterministic and total', () => {
  it('identical randomized requests produce identical verdicts (deep equality)', () => {
    fc.assert(
      fc.property(requestArb, ({ request }) => {
        const first = evaluateAutonomy(request);
        const second = evaluateAutonomy(structuredClone(request));
        expect(second).toEqual(first);
      }),
      { numRuns: 120 },
    );
  });

  it('every randomized request produces exactly one of the three verdicts with a non-empty reason', () => {
    fc.assert(
      fc.property(requestArb, ({ request }) => {
        const verdict = evaluateAuthorityCoverage(request);
        expect(['PERMITTED', 'DENIED', 'ESCALATED']).toContain(verdict.verdict);
        expect(verdict.reason.length).toBeGreaterThan(0);
        expect(AUTONOMY_LEVELS).toContain(verdict.required_level);
        expect(AUTONOMY_LEVELS).toContain(verdict.effective_level);
      }),
      { numRuns: 120 },
    );
  });

  it('no randomized request ever permits without a qualifying grant', () => {
    fc.assert(
      fc.property(requestArb, ({ request, flags }) => {
        const verdict = evaluateAuthorityCoverage(request);
        if (verdict.verdict === 'PERMITTED') {
          // Permission was enforced: the granted set must carry the action.
          expect(flags.with_grant).toBe(true);
          expect(flags.grant_permissions).toContain(request.action_kind);
          // Level conditions were enforced too.
          if (verdict.effective_level === 'SUPERVISED') {
            expect(request.explicit_authority_decision_ref).not.toBeNull();
          }
          if (verdict.effective_level === 'AUTONOMOUS_LOW_RISK') {
            expect(request.risk).toBe('LOW');
            expect(request.reversibility).toBe('REVERSIBLE');
          }
        }
      }),
      { numRuns: 120 },
    );
  });

  it('grant presentation order never changes the verdict', () => {
    fc.assert(
      fc.property(requestArb, fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 0, maxLength: 4 }), ({ request }) => {
        const grants = [...request.grants, ...request.grants.map((g) => validGrant({ grantee: `extra-${g.envelope.id.slice(-4)}` }))];
        if (grants.length === 0) {
          return true;
        }
        const shuffled = [...grants].reverse();
        const a = evaluateAuthorityCoverage({ ...request, grants });
        const b = evaluateAuthorityCoverage({ ...request, grants: shuffled });
        expect(b.verdict).toBe(a.verdict);
        expect(b.code ?? null).toBe(a.code ?? null);
        return true;
      }),
      { numRuns: 60 },
    );
  });
});

describe('property: escalation matrix total coverage', () => {
  it('every one of the 12 (risk x reversibility) cells matches the frozen table', () => {
    fc.assert(
      fc.property(riskArb, reversibilityArb, (risk, reversibility) => {
        expect(escalates(risk, reversibility)).toBe(ESCALATION_MATRIX[risk][reversibility]);
        // The documented rules in words:
        const byRule =
          risk === 'SEVERE' ||
          (risk === 'HIGH' && reversibility !== 'REVERSIBLE') ||
          (risk === 'MODERATE' && reversibility === 'IRREVERSIBLE');
        expect(escalates(risk, reversibility)).toBe(byRule);
      }),
      { numRuns: 120 },
    );
  });

  it('the matrix corner escalates the combined evaluation regardless of everything else', () => {
    fc.assert(
      fc.property(requestArb, ({ request }) => {
        const corner: AutonomyEnforcementRequest = {
          ...request,
          risk: 'SEVERE',
          reversibility: 'PARTIALLY_REVERSIBLE',
        };
        const verdict = evaluateAutonomy(corner);
        // Authority DENIED-dead can still dominate (authority first), but a
        // PERMITTED coverage in the corner ALWAYS escalates.
        if (verdict.verdict !== 'DENIED') {
          expect(verdict.verdict).toBe('ESCALATED');
        }
      }),
      { numRuns: 120 },
    );
  });
});

describe('property: policy table totals', () => {
  it('requiredLevel is defined for every (action, blast) pair and ranks within the ladder', () => {
    fc.assert(
      fc.property(actionKindArb, blastArb, (action, blast) => {
        const level = requiredLevel(action, blast);
        expect(AUTONOMY_LEVELS).toContain(level);
        expect(BLAST_RADII).toContain(blast);
        expect(REVERSIBILITY_CLASSES.length).toBe(3);
      }),
      { numRuns: 60 },
    );
  });
});
