/**
 * ADVERSARIAL CLASS 3 — CONTRADICTORY EVIDENCE (contradiction surfaced,
 * never averaged away).
 *
 * The fault: the evidence pool contains a fresh FAILURE record that
 * CONTRADICTS a claim the assurance case also marks as supported by fresh
 * SUCCESS evidence. The system must SURFACE the contradiction as a typed
 * invalidation (verdict INVALID) — averaging, majority voting or silently
 * picking the supporting record are all forbidden. The ecology layer
 * likewise surfaces CONFLICTS_WITH assertions instead of netting them out.
 */

import { describe, expect, test } from 'vitest';
import { createAssuranceCase, evaluateAssuranceCase } from '@sos-2/assurance';
import { EcologyGraph } from '@sos-2/ecology';
import { createEvidence } from '@sos-2/evidence';
import { createTraceLink, deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { ADVERSARIAL_PROVENANCE, T0, T1, T2, assertTraceQueryable, makeEvidence, subjectId, toolProducer } from './helpers.js';

const CLAIM_ID = 'claim-checkout-availability';

function contradictoryCase() {
  const supporting = makeEvidence(subjectId('SystemState', 'adversarial-3-state'), {
    provenance: ['observation:sha256:' + '1'.repeat(64)],
  });
  const contradicting = makeEvidence(subjectId('SystemState', 'adversarial-3-state'), {
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
    provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:3:contradictory-case'],
    created_at: T0,
    status: 'ACTIVE',
  });
  return { artifact, supporting, contradicting };
}

describe('adversarial class 3: contradictory evidence', () => {
  test('a fresh contradiction INVALIDATES the case (surfaced, not averaged away)', () => {
    const { artifact, supporting, contradicting } = contradictoryCase();
    const evaluation = evaluateAssuranceCase(artifact, {
      now: T1,
      evidence: [supporting, contradicting],
    });
    // The verdict is INVALID — the supporting SUCCESS record does NOT cancel
    // the fresh FAILURE contradiction.
    expect(evaluation.verdict).toBe('INVALID');
    expect(evaluation.invalidations.length).toBeGreaterThan(0);
    const contradiction = evaluation.invalidations.find(
      (invalidation) => invalidation.reason === 'CONTRADICTED_BY_EVIDENCE',
    );
    expect(contradiction).toBeDefined();
    expect(contradiction!.subject).toBe(contradicting.id);
    expect(contradiction!.message).toContain(CLAIM_ID);
  });

  test('a FAILED support is surfaced as SUPPORTING_EVIDENCE_FAILED (not ignored)', () => {
    const failed = makeEvidence(subjectId('SystemState', 'adversarial-3-state-b'), {
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
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:3:failed-support'],
      created_at: T0,
      status: 'ACTIVE',
    });
    const evaluation = evaluateAssuranceCase(artifact, { now: T1, evidence: [failed] });
    expect(evaluation.verdict).toBe('INVALID');
    expect(evaluation.invalidations.some((invalidation) => invalidation.reason === 'SUPPORTING_EVIDENCE_FAILED')).toBe(true);
  });

  test('the ecology layer surfaces CONFLICTS_WITH pairs (compatible:false, pairs listed)', () => {
    const packageA = subjectId('Package', 'adversarial-3-package-a');
    const packageB = subjectId('Package', 'adversarial-3-package-b');
    const evidenceFor = (note: string) =>
      createEvidence({
        kind: 'telemetry',
        subject_ref: packageA,
        availability: 'SUCCESS',
        evidence_class: 'OBSERVATIONAL',
        method: 'telemetry:capture-availability',
        provenance: ['observation:sha256:' + note.padEnd(64, '0').slice(0, 64)],
        window: { start: T0, end: T2 },
        subject_revision: null,
        producer: toolProducer(),
      });
    const graph = new EcologyGraph();
    graph.addAssertion({
      source: packageA,
      target: packageB,
      kind: 'COMPATIBLE_WITH',
      evidence_refs: [evidenceFor('c1').id],
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:3:compatible-claim'],
      note: 'deployed together without interference in the observed window',
    });
    graph.addAssertion({
      source: packageA,
      target: packageB,
      kind: 'CONFLICTS_WITH',
      evidence_refs: [evidenceFor('c2').id],
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:3:conflict-claim'],
      note: 'a later incident report links the pair to interference',
    });
    // BOTH assertions are retained; the conflict is surfaced, never netted.
    expect(graph.size).toBe(2);
    expect(graph.hasConflict(packageA, packageB)).toBe(true);
    const report = graph.canCoexist([packageA, packageB]);
    expect(report.compatible).toBe(false);
    expect(report.conflicting_pairs.length).toBe(1);
    expect(report.conflicting_pairs[0]!.evidence_refs.length).toBeGreaterThan(0);
  });

  test('the trace chain stays queryable after the surfaced contradiction', () => {
    const { supporting, contradicting } = contradictoryCase();
    const caseId = subjectId('AssuranceCase', 'adversarial-3-case');
    const links = [
      createTraceLink({
        source: supporting.id,
        target: caseId,
        type: 'VERIFIES',
        provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:3:support-verifies'],
      }),
      createTraceLink({
        source: contradicting.id,
        target: caseId,
        type: 'CONTRADICTS',
        provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:3:evidence-contradicts'],
      }),
    ];
    const { queryFrom, queryTo } = assertTraceQueryable(links);
    expect(queryTo(caseId).length).toBe(2);
    expect(queryFrom(contradicting.id)[0]!.type).toBe('CONTRADICTS');
    expect(queryFrom(supporting.id)[0]!.type).toBe('VERIFIES');
  });
});
