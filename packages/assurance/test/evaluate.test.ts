import { describe, expect, it } from 'vitest';
import { evaluateAssuranceCase } from '../src/index.js';
import type { AssuranceCaseContent } from '../src/index.js';
import {
  SYSTEM_STATE_ID,
  T1,
  T3,
  goldenCaseContent,
  goldenValidInput,
  makeEvidence,
} from './helpers.js';
import { createAssuranceCase } from '../src/index.js';

/** A minimal content builder: the golden content with overridable sections. */
function contentWith(overrides: Partial<AssuranceCaseContent> = {}): AssuranceCaseContent {
  return { ...goldenCaseContent(), ...overrides };
}

function caseWith(overrides: Partial<AssuranceCaseContent> = {}) {
  return createAssuranceCase({
    content: contentWith(overrides),
    provenance: ['W8:evaluate-test'],
    created_at: T1,
    status: 'ACTIVE',
  });
}

describe('validity evaluation — verdicts', () => {
  it('VALID: all bounds hold, assumptions checked, evidence fresh and conclusive, no open objections', () => {
    const content = contentWith({ objections: [] });
    const artifact = createAssuranceCase({
      content,
      provenance: ['W8:evaluate-test'],
      created_at: T1,
      status: 'ACTIVE',
    });
    const evaluation = evaluateAssuranceCase(artifact, goldenValidInput());
    expect(evaluation.verdict).toBe('VALID');
    expect(evaluation.invalidations).toEqual([]);
    expect(evaluation.open_objections).toEqual([]);
    expect(evaluation.case_id).toBe(artifact.envelope.id);
    expect(evaluation.case_version).toBe(artifact.envelope.version);
    expect(evaluation.evaluated_at).toBe(goldenValidInput().now);
  });

  it('OBJECTIONED: mechanically valid but an unresolved objection stands (objections surface in verdicts)', () => {
    const evaluation = evaluateAssuranceCase(caseWith(), goldenValidInput());
    expect(evaluation.verdict).toBe('OBJECTIONED');
    expect(evaluation.open_objections.length).toBe(1);
  });

  it('INVALID dominates OBJECTIONED', () => {
    const evaluation = evaluateAssuranceCase(
      caseWith(),
      { ...goldenValidInput(), implementation_revisions: { 'payments-service': 'rev-9999' } },
    );
    expect(evaluation.verdict).toBe('INVALID');
    expect(evaluation.invalidations.length).toBeGreaterThan(0);
  });
});

describe('validity evaluation — distinct invalidation reasons', () => {
  it('IMPLEMENTATION_OUT_OF_BOUNDS: a reported revision outside the recorded bounds', () => {
    const evaluation = evaluateAssuranceCase(
      caseWith(),
      { ...goldenValidInput(), implementation_revisions: { 'payments-service': 'rev-9999' } },
    );
    expect(evaluation.verdict).toBe('INVALID');
    expect(evaluation.invalidations.map((entry) => entry.reason)).toContain('IMPLEMENTATION_OUT_OF_BOUNDS');
  });

  it('IMPLEMENTATION_UNREPORTED: a bounded subject with no reported revision never keeps the case VALID', () => {
    const evaluation = evaluateAssuranceCase(
      caseWith(),
      { ...goldenValidInput(), implementation_revisions: {} },
    );
    expect(evaluation.invalidations.map((entry) => entry.reason)).toContain('IMPLEMENTATION_UNREPORTED');
  });

  it('DEPENDENCY_OUT_OF_BOUNDS and DEPENDENCY_UNREPORTED', () => {
    const content = contentWith({
      validity_conditions: [
        ...goldenCaseContent().validity_conditions,
        { kind: 'DEPENDENCY', subject: 'payments-db', valid_revisions: ['pg-15.2'] },
      ],
    });
    const artifact = createAssuranceCase({
      content,
      provenance: ['W8:evaluate-test'],
      created_at: T1,
      status: 'ACTIVE',
    });
    const unreported = evaluateAssuranceCase(artifact, goldenValidInput());
    expect(unreported.invalidations.map((entry) => entry.reason)).toContain('DEPENDENCY_UNREPORTED');
    const outOfBounds = evaluateAssuranceCase(artifact, {
      ...goldenValidInput(),
      dependency_revisions: { 'payments-db': 'pg-16.0' },
    });
    expect(outOfBounds.invalidations.map((entry) => entry.reason)).toContain('DEPENDENCY_OUT_OF_BOUNDS');
    const inBounds = evaluateAssuranceCase(artifact, {
      ...goldenValidInput(),
      dependency_revisions: { 'payments-db': 'pg-15.2' },
    });
    expect(inBounds.invalidations.map((entry) => entry.reason)).not.toContain('DEPENDENCY_OUT_OF_BOUNDS');
  });

  it('ENVIRONMENT_OUT_OF_BOUNDS and ENVIRONMENT_UNREPORTED', () => {
    const unreported = evaluateAssuranceCase(
      caseWith(),
      { ...goldenValidInput(), environment_revisions: {} },
    );
    expect(unreported.invalidations.map((entry) => entry.reason)).toContain('ENVIRONMENT_UNREPORTED');
    const changed = evaluateAssuranceCase(
      caseWith(),
      { ...goldenValidInput(), environment_revisions: { 'prod-eu': 'env-2025-06' } },
    );
    expect(changed.invalidations.map((entry) => entry.reason)).toContain('ENVIRONMENT_OUT_OF_BOUNDS');
  });

  it('EVIDENCE_EXPIRED: expired evidence keeps the case INVALID (never silently VALID)', () => {
    // Evidence window closed at T2; evaluate at T3 with the same subject revision.
    const evaluation = evaluateAssuranceCase(caseWith(), {
      ...goldenValidInput(),
      now: T3,
    });
    expect(evaluation.verdict).toBe('INVALID');
    expect(evaluation.invalidations.map((entry) => entry.reason)).toContain('EVIDENCE_EXPIRED');
  });

  it('EVIDENCE_SUPERSEDED: evidence bound to an older subject revision', () => {
    const evaluation = evaluateAssuranceCase(caseWith(), {
      ...goldenValidInput(),
      systemStateRevision: `${SYSTEM_STATE_ID}@v2`,
    });
    expect(evaluation.verdict).toBe('INVALID');
    expect(evaluation.invalidations.map((entry) => entry.reason)).toContain('EVIDENCE_SUPERSEDED');
  });

  it('EVIDENCE_FRESHNESS_UNKNOWN: evidence bound to neither window nor subject revision', () => {
    const unbound = makeEvidence({ window: null, subject_revision: null });
    const content = contentWith({
      evidence: [{ evidence_id: unbound.id, role: 'SUPPORTS', claim_ref: 'claim-payments-correct' }],
    });
    const artifact = createAssuranceCase({
      content,
      provenance: ['W8:evaluate-test'],
      created_at: T1,
      status: 'ACTIVE',
    });
    const evaluation = evaluateAssuranceCase(artifact, {
      ...goldenValidInput(),
      evidence: [unbound],
    });
    expect(evaluation.verdict).toBe('INVALID');
    expect(evaluation.invalidations.map((entry) => entry.reason)).toContain('EVIDENCE_FRESHNESS_UNKNOWN');
  });

  it('EVIDENCE_MISSING: a referenced record absent from the pool', () => {
    const evaluation = evaluateAssuranceCase(caseWith(), {
      ...goldenValidInput(),
      evidence: [],
    });
    expect(evaluation.verdict).toBe('INVALID');
    const missing = evaluation.invalidations.filter((entry) => entry.reason === 'EVIDENCE_MISSING');
    expect(missing.length).toBe(2);
  });

  it('CONTRADICTED_BY_EVIDENCE: fresh contradicting evidence invalidates', () => {
    const contradicting = makeEvidence({ availability: 'FAILURE' });
    const supporting = makeEvidence();
    const runtime = makeEvidence({ kind: 'runtime-conformance' });
    const content = contentWith({
      evidence: [
        { evidence_id: supporting.id, role: 'SUPPORTS', claim_ref: 'claim-payments-correct' },
        { evidence_id: runtime.id, role: 'VERIFIES', claim_ref: 'claim-payments-correct' },
        { evidence_id: contradicting.id, role: 'CONTRADICTS', claim_ref: 'claim-payments-correct' },
      ],
    });
    const artifact = createAssuranceCase({
      content,
      provenance: ['W8:evaluate-test'],
      created_at: T1,
      status: 'ACTIVE',
    });
    const fresh = evaluateAssuranceCase(artifact, {
      ...goldenValidInput(),
      evidence: [supporting, runtime, contradicting],
    });
    expect(fresh.verdict).toBe('INVALID');
    expect(fresh.invalidations.map((entry) => entry.reason)).toContain('CONTRADICTED_BY_EVIDENCE');
  });

  it('a STALE contradiction is not a current one (no CONTRADICTED_BY_EVIDENCE)', () => {
    const contradicting = makeEvidence({ availability: 'FAILURE' });
    const supporting = makeEvidence();
    const runtime = makeEvidence({ kind: 'runtime-conformance' });
    const content = contentWith({
      evidence: [
        { evidence_id: supporting.id, role: 'SUPPORTS', claim_ref: 'claim-payments-correct' },
        { evidence_id: runtime.id, role: 'VERIFIES', claim_ref: 'claim-payments-correct' },
        { evidence_id: contradicting.id, role: 'CONTRADICTS', claim_ref: 'claim-payments-correct' },
      ],
    });
    const artifact = createAssuranceCase({
      content,
      provenance: ['W8:evaluate-test'],
      created_at: T1,
      status: 'ACTIVE',
    });
    // Evaluate after the contradicting record's window closed: it is stale.
    const stale = evaluateAssuranceCase(artifact, {
      ...goldenValidInput(),
      now: T3,
      evidence: [supporting, runtime, contradicting],
    });
    const reasons = stale.invalidations.map((entry) => entry.reason);
    expect(reasons).not.toContain('CONTRADICTED_BY_EVIDENCE');
    // The SUPPORTING records expired at the same time (documented consequence).
    expect(reasons).toContain('EVIDENCE_EXPIRED');
  });

  it('SUPPORTING_EVIDENCE_FAILED: fresh supporting evidence with truth state FAILURE', () => {
    const failed = makeEvidence({ availability: 'FAILURE', subject_revision: `${SYSTEM_STATE_ID}@v1` });
    const content = contentWith({
      evidence: [{ evidence_id: failed.id, role: 'SUPPORTS', claim_ref: 'claim-payments-correct' }],
    });
    const artifact = createAssuranceCase({
      content,
      provenance: ['W8:evaluate-test'],
      created_at: T1,
      status: 'ACTIVE',
    });
    const evaluation = evaluateAssuranceCase(artifact, {
      ...goldenValidInput(),
      evidence: [failed],
    });
    expect(evaluation.invalidations.map((entry) => entry.reason)).toContain('SUPPORTING_EVIDENCE_FAILED');
  });

  it('SUPPORTING_EVIDENCE_INCONCLUSIVE: fresh supporting evidence in a non-conclusive state stays distinct', () => {
    for (const availability of ['UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL'] as const) {
      const record = makeEvidence({ availability, subject_revision: `${SYSTEM_STATE_ID}@v1` });
      const content = contentWith({
        evidence: [{ evidence_id: record.id, role: 'VERIFIES', claim_ref: 'claim-payments-correct' }],
      });
      const artifact = createAssuranceCase({
        content,
        provenance: ['W8:evaluate-test'],
        created_at: T1,
        status: 'ACTIVE',
      });
      const evaluation = evaluateAssuranceCase(artifact, {
        ...goldenValidInput(),
        evidence: [record],
      });
      expect(evaluation.verdict).toBe('INVALID');
      expect(evaluation.invalidations.map((entry) => entry.reason)).toContain('SUPPORTING_EVIDENCE_INCONCLUSIVE');
    }
  });

  it('ASSUMPTION_VIOLATED and ASSUMPTION_UNCHECKED (distinct)', () => {
    const violated = evaluateAssuranceCase(caseWith(), {
      ...goldenValidInput(),
      assumption_checks: { 'assumption-corpus-representative': false },
    });
    expect(violated.invalidations.map((entry) => entry.reason)).toContain('ASSUMPTION_VIOLATED');

    const unchecked = evaluateAssuranceCase(caseWith(), {
      ...goldenValidInput(),
      assumption_checks: {},
    });
    expect(unchecked.invalidations.map((entry) => entry.reason)).toContain('ASSUMPTION_UNCHECKED');

    const omitted = evaluateAssuranceCase(caseWith(), {
      ...goldenValidInput(),
      assumption_checks: undefined,
    });
    expect(omitted.invalidations.map((entry) => entry.reason)).toContain('ASSUMPTION_UNCHECKED');
  });

  it('multiple reasons are all tracked and deterministically sorted', () => {
    const evaluation = evaluateAssuranceCase(caseWith(), {
      now: T3,
      systemStateRevision: `${SYSTEM_STATE_ID}@v2`,
      implementation_revisions: {},
      evidence: [],
      assumption_checks: {},
    });
    expect(evaluation.verdict).toBe('INVALID');
    const reasons = evaluation.invalidations.map((entry) => entry.reason);
    expect(reasons).toContain('IMPLEMENTATION_UNREPORTED');
    expect(reasons).toContain('ENVIRONMENT_UNREPORTED');
    expect(reasons.filter((reason) => reason === 'EVIDENCE_MISSING').length).toBe(2);
    expect(reasons).toContain('ASSUMPTION_UNCHECKED');
    // Sorted by (reason, subject).
    const sorted = [...evaluation.invalidations].sort((a, b) =>
      a.reason === b.reason
        ? a.subject < b.subject
          ? -1
          : 1
        : a.reason < b.reason
          ? -1
          : 1,
    );
    expect(evaluation.invalidations).toEqual(sorted);
  });
});

describe('validity evaluation — determinism and totality', () => {
  it('identical (case, input) pairs produce byte-identical evaluations', () => {
    const artifact = caseWith();
    const input = goldenValidInput();
    const a = evaluateAssuranceCase(artifact, input);
    const b = evaluateAssuranceCase(artifact, JSON.parse(JSON.stringify(input)));
    expect(a).toEqual(b);
  });

  it('evidence availability never conflates the 6 distinct truth states', () => {
    const evaluation = evaluateAssuranceCase(caseWith(), {
      ...goldenValidInput(),
      evidence: [makeEvidence(), makeEvidence({ kind: 'runtime-conformance' })],
    });
    // Golden pool: both SUCCESS — no invalidations from evidence.
    expect(
      evaluation.invalidations.filter((entry) => entry.reason.startsWith('EVIDENCE_')),
    ).toEqual([]);
  });
});
