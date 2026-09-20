/**
 * ADVERSARIAL CLASS 12 — INVALID AUTHORITY (authority-gated action without
 * a grant is REJECTED).
 *
 * The fault: privileged actions are attempted without any grant, with an
 * expired grant, with a missing permission, or outside the granted scope.
 * The system must REFUSE with typed records (AuthorityError for direct
 * authorize() calls; DENIED verdicts for autonomy evaluation; typed
 * REJECT/ASK decision records for the decision + promotion engines — never
 * a silent pass) and the trace chain stays queryable.
 */

import { describe, expect, test } from 'vitest';
import { AuthorityError, authorize, createGrant, evaluateGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { evaluateAutonomy } from '@sos-2/autonomy';
import { evaluate } from '@sos-2/decision';
import { createCandidateState } from '@sos-2/experiments';
import { evaluatePromotion } from '@sos-2/promotion';
import { createTraceLink } from '@sos-2/semantic-spine';
import { ADVERSARIAL_ANCHOR, ADVERSARIAL_PROVENANCE, T0, T1, assertTraceQueryable, makeEvidence, subjectId } from './helpers.js';

const TARGET_ID = subjectId('Mission', 'adversarial-12-mission');

function readGrant(): AuthorityGrantArtifact {
  return createGrant({
    grantee: 'w17-adversarial-runner',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['READ'],
    expiry: { kind: 'TIME', at: '2025-12-31T00:00:00.000Z' },
    provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:12:read-grant'],
    created_at: T0,
    status: 'ACTIVE',
  });
}

describe('adversarial class 12: invalid authority', () => {
  test('authorize() REFUSES a missing permission (typed AuthorityError)', () => {
    const grant = readGrant();
    expect(() =>
      authorize(grant, {
        action: 'REVISE',
        target: { kind: 'KIND', artifact_kind: 'Mission' },
        at: { kind: 'TIME', now: T1 },
      }),
    ).toThrow(AuthorityError);
    try {
      authorize(grant, {
        action: 'REVISE',
        target: { kind: 'KIND', artifact_kind: 'Mission' },
        at: { kind: 'TIME', now: T1 },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AuthorityError);
      expect((error as Error).message).toMatch(/permission/i);
    }
    // The granted action still works (the refusal is precise, not blanket).
    expect(
      authorize(grant, {
        action: 'READ',
        target: { kind: 'KIND', artifact_kind: 'Mission' },
        at: { kind: 'TIME', now: T1 },
      }).envelope.id,
    ).toBe(grant.envelope.id);
  });

  test('authorize() REFUSES an expired grant and an out-of-scope target (no escalation)', () => {
    const expired = createGrant({
      grantee: 'w17-adversarial-runner',
      scope: { kind: 'KIND', artifact_kind: 'Mission' },
      permissions: ['REVISE'],
      expiry: { kind: 'TIME', at: T0 },
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:12:expired-grant'],
      created_at: T0,
      status: 'ACTIVE',
    });
    expect(evaluateGrant(expired, { kind: 'TIME', now: T1 })).toBe('EXPIRED');
    expect(() =>
      authorize(expired, { action: 'REVISE', target: { kind: 'KIND', artifact_kind: 'Mission' }, at: { kind: 'TIME', now: T1 } }),
    ).toThrow(AuthorityError);
    // An ARTIFACT-scoped grant never authorizes kind-wide actions.
    const artifactGrant = createGrant({
      grantee: 'w17-adversarial-runner',
      scope: { kind: 'ARTIFACT', artifact_id: TARGET_ID },
      permissions: ['REVISE'],
      expiry: { kind: 'TIME', at: '2025-12-31T00:00:00.000Z' },
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:12:artifact-grant'],
      created_at: T0,
      status: 'ACTIVE',
    });
    expect(() =>
      authorize(artifactGrant, {
        action: 'REVISE',
        target: { kind: 'KIND', artifact_kind: 'Mission' },
        at: { kind: 'TIME', now: T1 },
      }),
    ).toThrow(AuthorityError);
  });

  test('the autonomy evaluation DENIES without grants (typed NO_GRANT verdict)', () => {
    const verdict = evaluateAutonomy({
      action_kind: 'REVISE',
      target: { kind: 'KIND', artifact_kind: 'Mission' },
      blast_radius: 'SERVICE',
      risk: 'LOW',
      reversibility: 'REVERSIBLE',
      grants: [],
      evaluation_point: { kind: 'TIME', now: T1 },
      explicit_authority_decision_ref: null,
    });
    expect(verdict.verdict).toBe('DENIED');
    if (verdict.verdict === 'DENIED') {
      expect(verdict.code).toBe('NO_GRANT');
    }
  });

  test('the decision engine ESCALATES to ASK without grants (never a silent ACT)', () => {
    const evidence = makeEvidence(TARGET_ID);
    const evaluation = evaluate(
      {
        action_kind: 'REVISE',
        action_description: 'Revise the mission without presenting authority.',
        target: { kind: 'ARTIFACT', artifact_id: TARGET_ID },
        blast_radius: 'SERVICE',
        impact: 'LOW',
        risk: 'LOW',
        reversibility: 'REVERSIBLE',
        causal_claim: false,
        uncertainty: { uncertainty_class: 'LOW', basis: 'well-understood change' },
        rollback_signals: [],
        evidence: [evidence],
        grants: [],
        evaluation_point: { kind: 'TIME', now: T1 },
        explicit_authority_decision_ref: null,
        confidence: null,
      },
      { provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:12:decision'], created_at: T1, status: 'ACTIVE' },
    );
    expect(evaluation.action).toBe('ASK');
    expect(evaluation.escalation?.code).toBe('AUTHORITY_INSUFFICIENT');
    // ASK is a SUCCESS state (R16) — the typed record, not an exception.
    expect(evaluation.record.content.action).toBe('ASK');
  });

  test('the promotion gate REFUSES promotion without a grant (typed REJECT record)', () => {
    const candidate = createCandidateState({
      content: {
        invariants: ['i'],
        predicted_effects: [],
        causal_claim: false,
        confidence: null,
        base_subject_revision: 'system-state@v1',
        hypothesis_ref: null,
        bounded_subgraph_ref: null,
        context: { environment: 'production' },
      },
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:12:candidate'],
      created_at: T0,
      authority_ref: ADVERSARIAL_ANCHOR,
    });
    const evaluation = evaluatePromotion(candidate, {
      authority: { grant: null, now: T1 },
      assurance: null,
      evidence: [],
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:12:promotion-gate'],
      created_at: T1,
    });
    expect(evaluation.decision).not.toBe('ACT');
    expect(['REJECT', 'ASK']).toContain(evaluation.decision);
    expect(evaluation.gates.authority.passes).toBe(false);
    expect(evaluation.gates.authority.reasons.length).toBeGreaterThan(0);
    expect(evaluation.record.content.action).not.toBe('ACT');
  });

  test('the trace chain stays queryable after the authority rejections', () => {
    const grant = readGrant();
    const links = [
      createTraceLink({
        source: grant.envelope.id,
        target: TARGET_ID,
        type: 'CONSTRAINS',
        provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:12:grant-constrains-mission'],
      }),
    ];
    const { queryFrom, queryTo } = assertTraceQueryable(links);
    expect(queryFrom(grant.envelope.id).length).toBe(1);
    expect(queryTo(TARGET_ID).length).toBe(1);
  });
});
