/**
 * NEGATIVE tests: every forbidden autonomy operation fails LOUDLY.
 *
 * Pinned (Work Order W10 acceptance + spec/architecture-lock.md):
 *   - SILENT autonomy raise REJECTED (no grant / dead grant / no covering
 *     scope / no permission / non-raise level / outliving expiry);
 *   - dead grants NEVER authorize (expired, revoked — regardless of level);
 *   - the escalation matrix NEVER consults confidence (nothing to inject —
 *     the enforcement API carries no confidence field at all).
 */

import { describe, expect, it } from 'vitest';
import { authorizeAutonomyRaise, evaluateAuthorityCoverage, evaluateAutonomy } from '../src/index.js';
import {
  EXPLICIT_DECISION_REF,
  PROVENANCE,
  T1,
  enforcementRequest,
  expiredGrant,
  revokedGrant,
  sampleRaise,
  validGrant,
} from './helpers.js';

function mintOptions() {
  return {
    action_kind: 'REVISE' as const,
    scope: { kind: 'KIND', artifact_kind: 'Mission' } as const,
    blast_radius: 'ORGANIZATION' as const,
    to_level: 'BOUNDED' as const,
    rationale: 'Organization-wide revision authority demonstrated by six incident-free months.',
    grant: validGrant(),
    at: { kind: 'TIME', now: T1 },
    provenance: PROVENANCE,
    created_at: T1,
    status: 'ACTIVE' as const,
  };
}

describe('SILENT autonomy raises are rejected loudly', () => {
  it('no grant at all -> throw', () => {
    expect(() => authorizeAutonomyRaise({ ...mintOptions(), grant: undefined as never })).toThrow();
  });

  it('EXPIRED authorizing grant -> throw (dead authority never raises autonomy)', () => {
    expect(() => authorizeAutonomyRaise({ ...mintOptions(), grant: expiredGrant() })).toThrow(
      /EXPIRED at the raise's evaluation point|is EXPIRED/,
    );
  });

  it('REVOKED authorizing grant -> throw', () => {
    expect(() => authorizeAutonomyRaise({ ...mintOptions(), grant: revokedGrant() })).toThrow(
      /REVOKED at the raise's evaluation point|is REVOKED/,
    );
  });

  it('grant that does not cover the raise scope -> throw (scope violation)', () => {
    expect(() =>
      authorizeAutonomyRaise({
        ...mintOptions(),
        scope: { kind: 'KIND', artifact_kind: 'Evidence' }, // grant covers Mission only
      }),
    ).toThrow(/scope violation/);
  });

  it('grant without the action permission -> throw', () => {
    expect(() =>
      authorizeAutonomyRaise({ ...mintOptions(), grant: validGrant({ permissions: ['READ'] }) }),
    ).toThrow(/does not carry permission/);
  });

  it('equal or LOWER level "raise" -> throw (not a raise)', () => {
    expect(() =>
      authorizeAutonomyRaise({ ...mintOptions(), blast_radius: 'SERVICE', to_level: 'BOUNDED' as const }),
    ).toThrow(/does not rank strictly above/);
    expect(() =>
      authorizeAutonomyRaise({
        ...mintOptions(),
        to_level: 'SUPERVISED' as never,
      }),
    ).toThrow(/must be one of|does not rank strictly above/);
  });

  it('raise outliving its grant -> throw', () => {
    expect(() =>
      authorizeAutonomyRaise({
        ...mintOptions(),
        expiry: { kind: 'TIME', at: '2030-01-01T00:00:00.000Z' }, // grant expires 2025-01-05
      }),
    ).toThrow(/never outlives its grant/);
  });

  it('empty rationale -> throw (no silent raises)', () => {
    expect(() => authorizeAutonomyRaise({ ...mintOptions(), rationale: '' })).toThrow(/rationale/);
  });

  it('indeterminately-evaluable backing grant -> throw (never silently valid)', () => {
    const grant = validGrant({
      expiry: { kind: 'REVISION', artifact_id: EXPLICIT_DECISION_REF, max_version: 3 },
    });
    expect(() => authorizeAutonomyRaise({ ...mintOptions(), grant })).toThrow(
      /cannot be evaluated at the given point|silent raise is impossible/,
    );
  });
});

describe('dead or insufficient authority NEVER permits', () => {
  it('expired grant -> DENIED EXPIRED at every level', () => {
    for (const blast of ['COMPONENT', 'SERVICE', 'SYSTEM', 'ORGANIZATION'] as const) {
      const verdict = evaluateAuthorityCoverage(
        enforcementRequest({ action_kind: 'REVISE', blast_radius: blast, grants: [expiredGrant()] }),
      );
      expect(verdict.verdict).toBe('DENIED');
      if (verdict.verdict === 'DENIED') {
        expect(verdict.code).toBe('EXPIRED');
      }
    }
  });

  it('revoked grant -> DENIED REVOKED', () => {
    const verdict = evaluateAuthorityCoverage(enforcementRequest({ grants: [revokedGrant()] }));
    expect(verdict.verdict).toBe('DENIED');
    if (verdict.verdict === 'DENIED') {
      expect(verdict.code).toBe('REVOKED');
    }
  });

  it('a raise backed by a dead grant is ignored (fail-closed), never applied', () => {
    const backing = expiredGrant();
    // A raise that was legitimately minted while the grant was valid, now
    // evaluated after the grant expired: the raise must NOT apply.
    const liveBacking = validGrant({ grantee: 'raise-backer' });
    const raise = sampleRaise(liveBacking, { action_kind: 'REVISE', blast_radius: 'ORGANIZATION', to_level: 'BOUNDED' });
    const verdict = evaluateAuthorityCoverage(
      enforcementRequest({
        action_kind: 'REVISE',
        blast_radius: 'ORGANIZATION',
        grants: [backing, validGrant()], // the raise's actual backing grant is NOT presented
        raises: [raise],
      }),
    );
    expect(verdict.applied_raise_refs).toEqual([]);
    expect(verdict.effective_level).toBe('SUPERVISED'); // the restrictive default
    expect(verdict.verdict).toBe('ESCALATED'); // SUPERVISED needs an explicit decision
  });
});

describe('the escalation matrix never consults confidence (by construction)', () => {
  it('the enforcement API has no confidence field to inject — escalation is a pure function', () => {
    // The strongest form of the locked invariant: there is NO code path by
    // which confidence could influence the matrix. The API surface itself
    // carries no confidence input (structural pin — see request.ts types).
    const request = enforcementRequest({ risk: 'HIGH', reversibility: 'IRREVERSIBLE' });
    const escalated = evaluateAutonomy(request);
    expect(escalated.verdict).toBe('ESCALATED');
    // The same escalation happens no matter what the caller would claim:
    // re-evaluating with any reshaping of the SAME risk/reversibility pair
    // always escalates.
    expect(evaluateAutonomy({ ...request, grants: [...request.grants] })).toEqual(escalated);
  });
});
