/**
 * LANE C, NEGATIVE CASE 03 — CONTRADICTORY EVIDENCE (the P7
 * honest-status discipline under fault injection).
 *
 * The fault: the evidence pool contains a fresh FAILURE record that
 * CONTRADICTS a claim the assurance case also marks as supported by
 * fresh SUCCESS evidence. The system must SURFACE the contradiction as
 * a typed invalidation (verdict INVALID) — averaging, majority voting
 * or silently picking the supporting record are all forbidden — and
 * the trace chain stays queryable. Never a silent pass, never a crash.
 */

import { describe, expect, test } from 'vitest';
import { createAssuranceCase, evaluateAssuranceCase } from '@sos-2/assurance';
import { createTraceLink } from '@sos-2/semantic-spine';
import { LANE_PROVENANCE, T0, T1, assertTraceQueryable, makeEvidence, subjectId } from './helpers.js';

const CLAIM_ID = 'claim-checkout-availability';

function contradictoryCase() {
  const supporting = makeEvidence(subjectId('SystemState', 'p15c-03-state'), {
    provenance: ['observation:sha256:' + '1'.repeat(64)],
  });
  const contradicting = makeEvidence(subjectId('SystemState', 'p15c-03-state'), {
    availability: 'FAILURE',
    kind: 'incident-report',
    method: 'incident:postmortem',
    provenance: ['incident:sha256:' + '2'.repeat(64)],
  });
  const artifact = createAssuranceCase({
    content: {
      claims: [{ id: CLAIM_ID, statement: 'The checkout service meets its availability target.' }],
      arguments: [],
      assumptions: [],
      hazards: [],
      controls: [],
      evidence: [
        { evidence_id: supporting.id, role: 'SUPPORTS', claim_ref: CLAIM_ID },
        { evidence_id: contradicting.id, role: 'CONTRADICTS', claim_ref: CLAIM_ID },
      ],
      validity_conditions: [],
      objections: [],
    },
    provenance: [...LANE_PROVENANCE, 'p15c-03:contradictory-case'],
    created_at: T0,
    status: 'ACTIVE',
  });
  return { artifact, supporting, contradicting };
}

describe('P15 lane C negative case: contradictory evidence', () => {
  test('DETECTED: a fresh contradiction INVALIDATES the case — the supporting SUCCESS record does NOT cancel it', () => {
    const { artifact, supporting, contradicting } = contradictoryCase();
    const evaluation = evaluateAssuranceCase(artifact, {
      now: T1,
      evidence: [supporting, contradicting],
    });
    expect(evaluation.verdict).toBe('INVALID');
    expect(evaluation.invalidations.length).toBeGreaterThan(0);
    const contradiction = evaluation.invalidations.find(
      (invalidation) => invalidation.reason === 'CONTRADICTED_BY_EVIDENCE',
    );
    expect(contradiction).toBeDefined();
    expect(contradiction!.subject).toBe(contradicting.id);
    expect(contradiction!.message).toContain(CLAIM_ID);
  });

  test('DETECTED: a FAILED support is surfaced as SUPPORTING_EVIDENCE_FAILED (not ignored, never averaged away)', () => {
    const failed = makeEvidence(subjectId('SystemState', 'p15c-03-state-b'), {
      availability: 'FAILURE',
      provenance: ['incident:sha256:' + '3'.repeat(64)],
    });
    const artifact = createAssuranceCase({
      content: {
        claims: [{ id: CLAIM_ID, statement: 'The checkout service meets its availability target.' }],
        arguments: [],
        assumptions: [],
        hazards: [],
        controls: [],
        evidence: [{ evidence_id: failed.id, role: 'SUPPORTS', claim_ref: CLAIM_ID }],
        validity_conditions: [],
        objections: [],
      },
      provenance: [...LANE_PROVENANCE, 'p15c-03:failed-support'],
      created_at: T0,
      status: 'ACTIVE',
    });
    const evaluation = evaluateAssuranceCase(artifact, { now: T1, evidence: [failed] });
    expect(evaluation.verdict).toBe('INVALID');
    expect(evaluation.invalidations.some((invalidation) => invalidation.reason === 'SUPPORTING_EVIDENCE_FAILED')).toBe(true);
  });

  test('the trace chain stays queryable after the surfaced contradiction (both records retained)', () => {
    const { supporting, contradicting } = contradictoryCase();
    const caseId = subjectId('AssuranceCase', 'p15c-03-case');
    const links = [
      createTraceLink({
        source: supporting.id,
        target: caseId,
        type: 'VERIFIES',
        provenance: [...LANE_PROVENANCE, 'p15c-03:support-verifies'],
      }),
      createTraceLink({
        source: contradicting.id,
        target: caseId,
        type: 'CONTRADICTS',
        provenance: [...LANE_PROVENANCE, 'p15c-03:evidence-contradicts'],
      }),
    ];
    const { queryFrom, queryTo } = assertTraceQueryable(links);
    expect(queryTo(caseId).length).toBe(2);
    expect(queryFrom(contradicting.id)[0]!.type).toBe('CONTRADICTS');
    expect(queryFrom(supporting.id)[0]!.type).toBe('VERIFIES');
  });
});
