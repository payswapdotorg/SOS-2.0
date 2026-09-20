/**
 * Unit tests: scoped authority enforcement (evaluateAuthorityCoverage and
 * evaluateAutonomy) — grants, raises, level satisfaction, the matrix.
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateAuthorityCoverage,
  evaluateAutonomy,
} from '../src/index.js';
import type { AutonomyVerdict } from '../src/index.js';
import {
  DEFAULT_TARGET,
  EXPLICIT_DECISION_REF,
  T3,
  enforcementRequest,
  expiredGrant,
  midLifeGrant,
  revokedGrant,
  sampleRaise,
  validGrant,
} from './helpers.js';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';

describe('evaluateAuthorityCoverage — PERMITTED', () => {
  it('permits a BOUNDED action with a valid covering grant', () => {
    const verdict = evaluateAuthorityCoverage(enforcementRequest());
    expect(verdict.verdict).toBe('PERMITTED');
    if (verdict.verdict === 'PERMITTED') {
      expect(verdict.required_level).toBe('BOUNDED');
      expect(verdict.effective_level).toBe('BOUNDED');
      expect(verdict.authorizing).toBe('GRANT');
      expect(verdict.grant_ref).toBeTruthy();
      expect(verdict.reason).toContain('BOUNDED');
    }
  });

  it('permits an AUTONOMOUS_LOW_RISK action while the risk profile stays low', () => {
    const verdict = evaluateAuthorityCoverage(
      enforcementRequest({ action_kind: 'READ', blast_radius: 'COMPONENT', risk: 'LOW', reversibility: 'REVERSIBLE' }),
    );
    expect(verdict.verdict).toBe('PERMITTED');
    expect(verdict.required_level).toBe('AUTONOMOUS_LOW_RISK');
  });

  it('permits a SUPERVISED action only with grant AND explicit authority decision', () => {
    const base = { action_kind: 'PROMOTE' as const, blast_radius: 'SYSTEM' as const };
    const withoutDecision = evaluateAuthorityCoverage(enforcementRequest({ ...base }));
    expect(withoutDecision.verdict).toBe('ESCALATED');

    const withDecision = evaluateAuthorityCoverage(
      enforcementRequest({ ...base, explicit_authority_decision_ref: EXPLICIT_DECISION_REF }),
    );
    expect(withDecision.verdict).toBe('PERMITTED');
    if (withDecision.verdict === 'PERMITTED') {
      expect(withDecision.authorizing).toBe('GRANT_AND_EXPLICIT_DECISION');
    }
  });

  it('picks the first qualifying grant in sorted-id order (deterministic, order-independent)', () => {
    const grants = [
      validGrant({ grantee: 'actor-b' }),
      validGrant({ grantee: 'actor-a' }),
    ];
    const sorted = [grants[0]!.envelope.id, grants[1]!.envelope.id].sort();
    const verdict = evaluateAuthorityCoverage(enforcementRequest({ grants }));
    expect(verdict.verdict).toBe('PERMITTED');
    if (verdict.verdict === 'PERMITTED') {
      expect(verdict.grant_ref).toBe(sorted[0]);
    }
    const reordered = evaluateAuthorityCoverage(enforcementRequest({ grants: [grants[1]!, grants[0]!] }));
    expect(reordered).toEqual(verdict);
  });
});

describe('evaluateAuthorityCoverage — DENIED (structured reasons)', () => {
  it('DENIED NO_GRANT when no grant is presented', () => {
    const verdict = evaluateAuthorityCoverage(enforcementRequest({ grants: [] }));
    expect(verdict.verdict).toBe('DENIED');
    if (verdict.verdict === 'DENIED') {
      expect(verdict.code).toBe('NO_GRANT');
      expect(verdict.reason).toContain('nothing is authorized implicitly');
    }
  });

  it('DENIED EXPIRED — an expired grant never permits', () => {
    const verdict = evaluateAuthorityCoverage(enforcementRequest({ grants: [expiredGrant()] }));
    expect(verdict.verdict).toBe('DENIED');
    if (verdict.verdict === 'DENIED') {
      expect(verdict.code).toBe('EXPIRED');
    }
  });

  it('DENIED REVOKED — a revoked grant never permits', () => {
    const verdict = evaluateAuthorityCoverage(enforcementRequest({ grants: [revokedGrant()] }));
    expect(verdict.verdict).toBe('DENIED');
    if (verdict.verdict === 'DENIED') {
      expect(verdict.code).toBe('REVOKED');
    }
  });

  it('dead grants dominate alive-but-insufficient grants', () => {
    const verdict = evaluateAuthorityCoverage(
      enforcementRequest({
        grants: [
          validGrant({ permissions: ['READ'] }), // alive, permission missing
          expiredGrant(), // dead
        ],
      }),
    );
    expect(verdict.verdict).toBe('DENIED');
    if (verdict.verdict === 'DENIED') {
      expect(verdict.code).toBe('EXPIRED');
    }
  });

  it('DENIED PERMISSION_MISSING when grants are alive and in scope but lack the permission', () => {
    const verdict = evaluateAuthorityCoverage(
      enforcementRequest({ grants: [validGrant({ permissions: ['READ'] })] }),
    );
    expect(verdict.verdict).toBe('DENIED');
    if (verdict.verdict === 'DENIED') {
      expect(verdict.code).toBe('PERMISSION_MISSING');
    }
  });

  it('DENIED SCOPE_MISMATCH when grants are alive and permissive but do not cover the target', () => {
    const verdict = evaluateAuthorityCoverage(
      enforcementRequest({ grants: [validGrant({ scope: { kind: 'KIND', artifact_kind: 'Evidence' } })] }),
    );
    expect(verdict.verdict).toBe('DENIED');
    if (verdict.verdict === 'DENIED') {
      expect(verdict.code).toBe('SCOPE_MISMATCH');
    }
  });

  it('DENIED INDETERMINATE_EVALUATION for a revision-bound grant evaluated at a clock — never silently VALID', () => {
    const grant = validGrant({
      expiry: { kind: 'REVISION', artifact_id: EXPLICIT_DECISION_REF, max_version: 3 },
    });
    const verdict = evaluateAuthorityCoverage(enforcementRequest({ grants: [grant] }));
    expect(verdict.verdict).toBe('DENIED');
    if (verdict.verdict === 'DENIED') {
      expect(verdict.code).toBe('INDETERMINATE_EVALUATION');
      expect(verdict.reason).toContain('never silently treated as VALID');
    }
  });
});

describe('evaluateAuthorityCoverage — ESCALATED', () => {
  it('ESCALATED SUPERVISED_REQUIRES_EXPLICIT_DECISION when grants alone are presented', () => {
    const verdict = evaluateAuthorityCoverage(
      enforcementRequest({ action_kind: 'PROMOTE', blast_radius: 'SYSTEM' }),
    );
    expect(verdict.verdict).toBe('ESCALATED');
    if (verdict.verdict === 'ESCALATED') {
      expect(verdict.code).toBe('SUPERVISED_REQUIRES_EXPLICIT_DECISION');
      expect(verdict.grant_ref).not.toBeNull(); // the grant was found and consulted
    }
  });

  it('ESCALATED LOW_RISK_PROFILE_VIOLATION when the profile leaves the autonomous-safe region', () => {
    const verdict = evaluateAuthorityCoverage(
      enforcementRequest({ action_kind: 'READ', blast_radius: 'COMPONENT', risk: 'MODERATE', reversibility: 'REVERSIBLE' }),
    );
    expect(verdict.verdict).toBe('ESCALATED');
    if (verdict.verdict === 'ESCALATED') {
      expect(verdict.code).toBe('LOW_RISK_PROFILE_VIOLATION');
    }
  });
});

describe('evaluateAuthorityCoverage — governed raises', () => {
  it('applies a grant-backed raise (SUPERVISED -> BOUNDED at organization breadth)', () => {
    const grant = validGrant();
    const raise = sampleRaise(grant, { action_kind: 'REVISE', blast_radius: 'ORGANIZATION', to_level: 'BOUNDED' });
    const verdict = evaluateAuthorityCoverage(
      enforcementRequest({ action_kind: 'REVISE', blast_radius: 'ORGANIZATION', raises: [raise] }),
    );
    expect(verdict.verdict).toBe('PERMITTED');
    expect(verdict.required_level).toBe('SUPERVISED');
    expect(verdict.effective_level).toBe('BOUNDED');
    expect(verdict.applied_raise_refs).toEqual([raise.envelope.id]);
  });

  it('ignores a raise whose backing grant is NOT presented (fail-closed to the default)', () => {
    const backing = validGrant({ grantee: 'someone-else' });
    const raise = sampleRaise(backing, { action_kind: 'REVISE', blast_radius: 'ORGANIZATION', to_level: 'BOUNDED' });
    const verdict = evaluateAuthorityCoverage(
      enforcementRequest({
        action_kind: 'REVISE',
        blast_radius: 'ORGANIZATION',
        grants: [validGrant()], // a DIFFERENT grant — not the raise's backing grant
        raises: [raise],
      }),
    );
    expect(verdict.verdict).toBe('ESCALATED'); // default SUPERVISED applies
    expect(verdict.effective_level).toBe('SUPERVISED');
    expect(verdict.applied_raise_refs).toEqual([]);
  });

  it('ignores a raise whose backing grant died after minting (fail-closed to the default)', () => {
    // The backing grant is VALID at T1 (the raise mints legitimately) but
    // EXPIRED at T3 (the evaluation instant) — the raise must not apply, and
    // the dead grant dominates with DENIED.
    const backing = midLifeGrant();
    const raise = sampleRaise(backing, { action_kind: 'REVISE', blast_radius: 'ORGANIZATION', to_level: 'BOUNDED' });
    const verdict = evaluateAuthorityCoverage(
      enforcementRequest({
        action_kind: 'REVISE',
        blast_radius: 'ORGANIZATION',
        grants: [backing],
        raises: [raise],
        now: T3,
      }),
    );
    expect(verdict.verdict).toBe('DENIED');
    if (verdict.verdict === 'DENIED') {
      expect(verdict.code).toBe('EXPIRED');
    }
    expect(verdict.applied_raise_refs).toEqual([]);
    expect(verdict.effective_level).toBe('SUPERVISED');
  });

  it('a raise to AUTONOMOUS_LOW_RISK arms the profile check (low-risk condition applies)', () => {
    const grant = validGrant();
    const raise = sampleRaise(grant, {
      action_kind: 'REVISE',
      blast_radius: 'COMPONENT',
      to_level: 'AUTONOMOUS_LOW_RISK',
    });
    const safe = evaluateAuthorityCoverage(
      enforcementRequest({ action_kind: 'REVISE', blast_radius: 'COMPONENT', risk: 'LOW', reversibility: 'REVERSIBLE', raises: [raise] }),
    );
    expect(safe.verdict).toBe('PERMITTED');
    expect(safe.effective_level).toBe('AUTONOMOUS_LOW_RISK');

    const unsafe = evaluateAuthorityCoverage(
      enforcementRequest({ action_kind: 'REVISE', blast_radius: 'COMPONENT', risk: 'HIGH', reversibility: 'IRREVERSIBLE', raises: [raise] }),
    );
    expect(unsafe.verdict).toBe('ESCALATED');
    if (unsafe.verdict === 'ESCALATED') {
      expect(unsafe.code).toBe('LOW_RISK_PROFILE_VIOLATION');
    }
  });

  it('raises only ever INCREASE the effective level (max rank among applicable)', () => {
    const grant = validGrant();
    const bounded = sampleRaise(grant, { action_kind: 'REVISE', blast_radius: 'ORGANIZATION', to_level: 'BOUNDED' });
    const lowRisk = sampleRaise(grant, {
      action_kind: 'REVISE',
      blast_radius: 'ORGANIZATION',
      to_level: 'AUTONOMOUS_LOW_RISK',
    });
    const verdict = evaluateAuthorityCoverage(
      enforcementRequest({
        action_kind: 'REVISE',
        blast_radius: 'ORGANIZATION',
        risk: 'LOW',
        reversibility: 'REVERSIBLE',
        raises: [bounded, lowRisk],
      }),
    );
    expect(verdict.effective_level).toBe('AUTONOMOUS_LOW_RISK');
    expect(new Set(verdict.applied_raise_refs).size).toBe(2);
  });
});

describe('evaluateAutonomy — coverage + escalation matrix', () => {
  it('a PERMITTED coverage escalates when the matrix corner fires', () => {
    const verdict: AutonomyVerdict = evaluateAutonomy(
      enforcementRequest({ risk: 'HIGH', reversibility: 'IRREVERSIBLE' }),
    );
    expect(verdict.verdict).toBe('ESCALATED');
    if (verdict.verdict === 'ESCALATED') {
      expect(verdict.code).toBe('RISK_IRREVERSIBILITY_ESCALATION');
      expect(verdict.reason).toContain('confidence is not authorization');
    }
  });

  it('stays PERMITTED when both coverage and matrix are clean', () => {
    const verdict = evaluateAutonomy(enforcementRequest());
    expect(verdict.verdict).toBe('PERMITTED');
  });

  it('passes coverage failures through unchanged (authority first)', () => {
    const verdict = evaluateAutonomy(enforcementRequest({ grants: [expiredGrant()] }));
    expect(verdict.verdict).toBe('DENIED');
  });

  it('NO level escapes the escalation corner: every level escalates for SEVERE/irreversible', () => {
    // SUPERVISED (with the explicit decision presented), BOUNDED and
    // AUTONOMOUS_LOW_RISK all end ESCALATED in the corner — through the
    // profile check, the matrix, or the supervised requirement.
    const supervised = evaluateAutonomy(
      enforcementRequest({
        action_kind: 'PROMOTE',
        blast_radius: 'SYSTEM',
        risk: 'SEVERE',
        reversibility: 'IRREVERSIBLE',
        explicit_authority_decision_ref: EXPLICIT_DECISION_REF,
      }),
    );
    expect(supervised.verdict).toBe('ESCALATED');
    if (supervised.verdict === 'ESCALATED') {
      expect(supervised.code).toBe('RISK_IRREVERSIBILITY_ESCALATION');
    }

    const bounded = evaluateAutonomy(
      enforcementRequest({ action_kind: 'REVISE', blast_radius: 'SERVICE', risk: 'SEVERE', reversibility: 'IRREVERSIBLE' }),
    );
    expect(bounded.verdict).toBe('ESCALATED');
    if (bounded.verdict === 'ESCALATED') {
      expect(bounded.code).toBe('RISK_IRREVERSIBILITY_ESCALATION');
    }

    const lowRisk = evaluateAutonomy(
      enforcementRequest({ action_kind: 'READ', blast_radius: 'COMPONENT', risk: 'SEVERE', reversibility: 'REVERSIBLE' }),
    );
    expect(lowRisk.verdict).toBe('ESCALATED'); // LOW_RISK_PROFILE_VIOLATION: the profile gate fired
  });
});

describe('enforcement input validation (loud)', () => {
  it('throws on malformed targets, vocabularies and grants', () => {
    expect(() =>
      evaluateAuthorityCoverage(enforcementRequest({ target: { kind: 'ARTIFACT', artifact_id: 'not-an-id' } as never })),
    ).toThrow(/well-formed spine artifact id/);
    expect(() =>
      evaluateAuthorityCoverage(enforcementRequest({ blast_radius: 'GALAXY' as never })),
    ).toThrow(/blast_radius/);
    expect(() => evaluateAuthorityCoverage(enforcementRequest({ grants: [{} as never] }))).toThrow();
    expect(() =>
      evaluateAuthorityCoverage(
        enforcementRequest({ explicit_authority_decision_ref: 'not-a-spine-id' }),
      ),
    ).toThrow(/explicit_authority_decision_ref/);
  });
});

describe('determinism of enforcement', () => {
  it('identical requests yield identical verdicts (deep equality)', () => {
    const request = enforcementRequest({
      action_kind: 'PROMOTE',
      blast_radius: 'SYSTEM',
      risk: 'MODERATE',
      reversibility: 'PARTIALLY_REVERSIBLE',
      explicit_authority_decision_ref: EXPLICIT_DECISION_REF,
    });
    expect(evaluateAutonomy(request)).toEqual(evaluateAutonomy(request));
  });

  it('verdicts do not depend on grant presentation order', () => {
    const a = validGrant({ grantee: 'actor-a' });
    const b = validGrant({ grantee: 'actor-b' });
    const one = evaluateAutonomy(enforcementRequest({ grants: [a, b] }));
    const two = evaluateAutonomy(enforcementRequest({ grants: [b, a] }));
    expect(one).toEqual(two);
  });

  it('reports consulted grants deterministically (sorted, unique)', () => {
    const a = validGrant({ grantee: 'actor-a' });
    const b = validGrant({ grantee: 'actor-b' });
    const verdict = evaluateAutonomy(enforcementRequest({ grants: [b, a] }));
    expect(verdict.consulted_grant_refs).toEqual([a.envelope.id, b.envelope.id].sort());
  });
});
