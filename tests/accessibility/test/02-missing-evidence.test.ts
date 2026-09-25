/**
 * LANE C, NEGATIVE CASE 02 — MISSING EVIDENCE (the P7 honest-status
 * discipline under fault injection).
 *
 * The fault: an assurance case references evidence records that are NOT
 * in the pool (the evidence is absent). The system must fail SAFE: the
 * referenced-but-absent record surfaces as a typed EVIDENCE_MISSING
 * invalidation, the verdict is INVALID (never a pass on absent
 * evidence), and the trace chain stays queryable. Never a silent pass,
 * never a crash.
 */

import { describe, expect, test } from 'vitest';
import { createAssuranceCase, evaluateAssuranceCase } from '@sos-2/assurance';
import { createTraceLink } from '@sos-2/semantic-spine';
import { LANE_ANCHOR, LANE_PROVENANCE, T0, T1, assertTraceQueryable, makeEvidence, subjectId } from './helpers.js';

const CLAIM_ID = 'claim-checkout-availability';

describe('P15 lane C negative case: missing evidence', () => {
  test('DETECTED: a referenced evidence record absent from the pool is a typed EVIDENCE_MISSING invalidation (fail-safe)', () => {
    // The case references ONE evidence record that exists and ONE that
    // was never produced (the fault: absent evidence).
    const present = makeEvidence(subjectId('SystemState', 'p15c-02-state'));
    const absentId = makeEvidence(subjectId('SystemState', 'p15c-02-state'), {
      provenance: ['incident:sha256:' + 'f'.repeat(64)],
    }).id;

    const artifact = createAssuranceCase({
      content: {
        claims: [{ id: CLAIM_ID, statement: 'The checkout service meets its availability target.' }],
        arguments: [],
        assumptions: [],
        hazards: [],
        controls: [],
        evidence: [
          { evidence_id: present.id, role: 'SUPPORTS', claim_ref: CLAIM_ID },
          { evidence_id: absentId, role: 'SUPPORTS', claim_ref: CLAIM_ID },
        ],
        validity_conditions: [],
        objections: [],
      },
      provenance: [...LANE_PROVENANCE, 'p15c-02:missing-evidence-case'],
      created_at: T0,
      status: 'ACTIVE',
    });

    // The pool contains ONLY the present record.
    const evaluation = evaluateAssuranceCase(artifact, { now: T1, evidence: [present] });

    // DETECTED: the absent reference invalidates the case — the missing
    // evidence is named, never ignored, never assumed fresh.
    expect(evaluation.verdict).toBe('INVALID');
    const missing = evaluation.invalidations.find((invalidation) => invalidation.reason === 'EVIDENCE_MISSING');
    expect(missing).toBeDefined();
    expect(missing!.subject).toBe(absentId);
    expect(missing!.message.length).toBeGreaterThan(0);
  });

  test('CONTAINED: absence is never success — every reference absent fails the case; an unchecked assumption never keeps it VALID', () => {
    // (a) EVERY referenced evidence record is absent from the pool.
    const absentA = makeEvidence(subjectId('SystemState', 'p15c-02-state-b'), {
      provenance: ['incident:sha256:' + 'e'.repeat(64)],
    }).id;
    const absentB = makeEvidence(subjectId('SystemState', 'p15c-02-state-b'), {
      provenance: ['incident:sha256:' + 'f'.repeat(64)],
    }).id;
    const allAbsent = createAssuranceCase({
      content: {
        claims: [{ id: CLAIM_ID, statement: 'The checkout service meets its availability target.' }],
        arguments: [],
        assumptions: [],
        hazards: [],
        controls: [],
        evidence: [
          { evidence_id: absentA, role: 'SUPPORTS', claim_ref: CLAIM_ID },
          { evidence_id: absentB, role: 'SUPPORTS', claim_ref: CLAIM_ID },
        ],
        validity_conditions: [],
        objections: [],
      },
      provenance: [...LANE_PROVENANCE, 'p15c-02:all-evidence-absent'],
      created_at: T0,
      status: 'ACTIVE',
    });
    const allAbsentEvaluation = evaluateAssuranceCase(allAbsent, { now: T1, evidence: [] });
    expect(allAbsentEvaluation.verdict).toBe('INVALID');
    const missing = allAbsentEvaluation.invalidations.filter((invalidation) => invalidation.reason === 'EVIDENCE_MISSING');
    expect(missing.length).toBe(2);

    // (b) An assumption that received NO check: the fail-safe — an
    // unchecked assumption never keeps a case VALID.
    const unchecked = createAssuranceCase({
      content: {
        claims: [{ id: CLAIM_ID, statement: 'The checkout service meets its availability target.' }],
        arguments: [],
        assumptions: [{ id: 'assumption-load-stays-bounded', statement: 'The observed load stays within the provisioned capacity.' }],
        hazards: [],
        controls: [],
        evidence: [],
        validity_conditions: [],
        objections: [],
      },
      provenance: [...LANE_PROVENANCE, 'p15c-02:unchecked-assumption'],
      created_at: T0,
      status: 'ACTIVE',
    });
    const uncheckedEvaluation = evaluateAssuranceCase(unchecked, { now: T1, evidence: [] });
    expect(uncheckedEvaluation.verdict).not.toBe('VALID');
    expect(
      uncheckedEvaluation.invalidations.some((invalidation) => invalidation.reason === 'ASSUMPTION_UNCHECKED'),
    ).toBe(true);
  });

  test('the trace chain stays queryable after the missing-evidence rejection', () => {
    const present = makeEvidence(subjectId('SystemState', 'p15c-02-state-2'));
    const caseId = subjectId('AssuranceCase', 'p15c-02-case');
    const links = [
      createTraceLink({
        source: present.id,
        target: caseId,
        type: 'VERIFIES',
        provenance: [...LANE_PROVENANCE, 'p15c-02:support-verifies'],
      }),
    ];
    const { queryFrom, queryTo } = assertTraceQueryable(links);
    expect(queryFrom(present.id).length).toBe(1);
    expect(queryTo(caseId)[0]!.type).toBe('VERIFIES');
    // The governance anchor the case hangs from is a well-formed spine id.
    expect(LANE_ANCHOR.startsWith('sos://')).toBe(true);
  });
});
