/**
 * ADVERSARIAL CLASS 8 — PACKAGE INTERACTION FAILURE (composition fault
 * contained).
 *
 * The fault: two packages that were asserted compatible are LATER observed
 * interfering (a fresh failure), and a composition's interaction outcomes
 * are claimed without the required evidence. The system must surface the
 * interference as typed ecology records (conflicting pair, INTERFERENCE
 * outcome with FAILURE evidence), REJECT unevidenced synergy claims with a
 * typed error, contain the fault (the composition is never marked
 * compatible), and keep the trace chain queryable.
 */

import { describe, expect, test } from 'vitest';
import { EcologyError, EcologyGraph, InteractionStore } from '@sos-2/ecology';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { createTraceLink } from '@sos-2/semantic-spine';
import { ADVERSARIAL_PROVENANCE, T0, T1, assertTraceQueryable, makeEvidence, subjectId, toolProducer } from './helpers.js';

const PACKAGE_A = subjectId('Package', 'adversarial-8-package-a');
const PACKAGE_B = subjectId('Package', 'adversarial-8-package-b');
const COMPOSITION = subjectId('PackageComposition', 'adversarial-8-composition');

function evidenceFor(subject: string, note: string, availability: 'SUCCESS' | 'FAILURE' = 'SUCCESS'): EvidenceRecordW3 {
  return createEvidence({
    kind: 'telemetry',
    subject_ref: subject,
    availability,
    evidence_class: 'OBSERVATIONAL',
    method: 'telemetry:capture-availability',
    provenance: ['observation:sha256:' + note.padEnd(64, '0').slice(0, 64)],
    window: { start: T0, end: T1 },
    subject_revision: null,
    producer: toolProducer(),
  });
}

describe('adversarial class 8: package interaction failure', () => {
  test('an observed interference SURFACES the conflicting pair (never averaged away)', () => {
    const graph = new EcologyGraph();
    graph.addAssertion({
      source: PACKAGE_A,
      target: PACKAGE_B,
      kind: 'COMPATIBLE_WITH',
      evidence_refs: [evidenceFor(PACKAGE_A, 'compat-obs').id],
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:8:compatible-assertion'],
      note: 'co-deployed without interference in the observation window',
    });
    // The LATER interference observation (a fresh failure).
    graph.addAssertion({
      source: PACKAGE_A,
      target: PACKAGE_B,
      kind: 'CONFLICTS_WITH',
      evidence_refs: [evidenceFor(PACKAGE_A, 'interference-incident', 'FAILURE').id],
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:8:conflict-assertion'],
      note: 'a fresh incident links the pair to mutual interference',
    });
    // CONTAINED: the pair is NOT compatible — both assertions retained.
    expect(graph.size).toBe(2);
    expect(graph.hasConflict(PACKAGE_A, PACKAGE_B)).toBe(true);
    const report = graph.canCoexist([PACKAGE_A, PACKAGE_B]);
    expect(report.compatible).toBe(false);
    expect(report.conflicting_pairs.length).toBe(1);
  });

  test('an INTERFERENCE interaction record requires FAILURE evidence (typed outcome, retained)', () => {
    const store = new InteractionStore();
    const failure = evidenceFor(COMPOSITION, 'interference-evidence', 'FAILURE');
    const record = store.record({
      composition_id: COMPOSITION,
      outcome: 'INTERFERENCE',
      evidence: [failure],
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:8:interference-record'],
      note: 'the composed packages interfered under load',
      recorded_at: T1,
    });
    expect(record.outcome).toBe('INTERFERENCE');
    expect(record.evidence_refs).toEqual([failure.id]);
    // The store retains the fault (no removal API exists).
    expect(store.interactionsFor(COMPOSITION).length).toBe(1);
    expect(store.interactionsWithOutcome('INTERFERENCE').length).toBe(1);
  });

  test('a SYNERGY claim without SUCCESS evidence is REJECTED with a typed error (never fabricated)', () => {
    const store = new InteractionStore();
    const failure = evidenceFor(COMPOSITION, 'failed-synergy-window', 'FAILURE');
    expect(() =>
      store.record({
        composition_id: COMPOSITION,
        outcome: 'SYNERGY',
        evidence: [failure],
        provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:8:unevidenced-synergy'],
        note: 'claiming synergy from a failed window',
        recorded_at: T1,
      }),
    ).toThrow(EcologyError);
    // The unevidenced claim was NOT recorded.
    expect(store.interactionsFor(COMPOSITION)).toEqual([]);
    expect(store.size).toBe(0);
  });

  test('an INTERFERENCE claim without FAILURE evidence is likewise REJECTED', () => {
    const store = new InteractionStore();
    const success = evidenceFor(COMPOSITION, 'healthy-window');
    expect(() =>
      store.record({
        composition_id: COMPOSITION,
        outcome: 'INTERFERENCE',
        evidence: [success],
        provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:8:unevidenced-interference'],
        note: 'claiming interference from a healthy window',
        recorded_at: T1,
      }),
    ).toThrow(EcologyError);
    expect(store.size).toBe(0);
  });

  test('the trace chain stays queryable after the contained interaction failure', () => {
    const graph = new EcologyGraph();
    graph.addAssertion({
      source: PACKAGE_A,
      target: PACKAGE_B,
      kind: 'CONFLICTS_WITH',
      evidence_refs: [evidenceFor(PACKAGE_A, 'conflict-link-evidence').id],
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:8:conflict-for-links'],
      note: null,
    });
    graph.addAssertion({
      source: PACKAGE_A,
      target: subjectId('Package', 'adversarial-8-package-c'),
      kind: 'COMPATIBLE_WITH',
      evidence_refs: [evidenceFor(PACKAGE_A, 'compatible-link-evidence').id],
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:8:compatible-for-links'],
      note: null,
    });
    // The ecology graph projects its assertions as typed trace links.
    const links = [...graph.toTraceLinks(), createTraceLink({
      source: COMPOSITION,
      target: PACKAGE_A,
      type: 'COMPOSES',
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:8:composition-composes-a'],
    })];
    const { queryFrom, queryTo } = assertTraceQueryable(links);
    expect(queryFrom(PACKAGE_A).length).toBe(2);
    expect(queryTo(PACKAGE_B).length).toBe(1);
    expect(queryFrom(COMPOSITION).length).toBe(1);
  });
});
