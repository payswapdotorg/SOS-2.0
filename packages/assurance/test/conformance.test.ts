import { describe, expect, it } from 'vitest';
import {
  CONFORMANCE_EVIDENCE_KINDS,
  adoptConformanceEvidence,
  assertConformanceRoleAllowed,
  createAssuranceCase,
  evaluateAssuranceCase,
} from '../src/index.js';
import { validateTraceLink } from '@sos-2/semantic-spine';
import { T1, T2, goldenCaseContent, goldenValidInput, makeEvidence } from './helpers.js';

function activeCase() {
  return createAssuranceCase({
    content: goldenCaseContent(),
    provenance: ['W8:conformance-test'],
    created_at: T1,
    status: 'ACTIVE',
  });
}

describe('conformance evidence integration', () => {
  it('consumes the merged conformance evidence kinds (never re-declared)', () => {
    expect(CONFORMANCE_EVIDENCE_KINDS).toEqual([
      'architecture-drift',
      'architecture-contradiction',
      'runtime-conformance',
    ]);
  });

  it('adopts a passing runtime-conformance record as VERIFIES with a spine trace link', () => {
    const head = activeCase();
    const record = makeEvidence({ kind: 'runtime-conformance', provenance: ['W8:conformance-test:adopt-verifies'] });
    const { case: next, link } = adoptConformanceEvidence(head, {
      evidence: record,
      role: 'VERIFIES',
      claim_ref: 'claim-payments-correct',
      provenance: ['W8:conformance-test:adopt'],
      created_at: T2,
    });
    expect(next.envelope.version).toBe(head.envelope.version + 1);
    expect(next.envelope.supersedes).toBe(head.envelope.id);
    expect(next.content.evidence.some((ref) => ref.evidence_id === record.id && ref.role === 'VERIFIES')).toBe(true);
    expect(validateTraceLink(link)).toBe(true);
    expect(link.source).toBe(record.id);
    expect(link.target).toBe(next.envelope.id);
    expect(link.type).toBe('VERIFIES');
    expect(link.provenance.join('\n')).toContain('W8:adopt-conformance-evidence');
  });

  it('adopted conformance evidence participates in validity evaluation', () => {
    const head = activeCase();
    const record = makeEvidence({ kind: 'runtime-conformance', provenance: ['W8:conformance-test:adopt-supports'] });
    const { case: next } = adoptConformanceEvidence(head, {
      evidence: record,
      role: 'SUPPORTS',
      claim_ref: 'claim-payments-correct',
      provenance: ['W8:conformance-test:adopt'],
      created_at: T2,
    });
    // Fresh + SUCCESS: no evidence invalidations.
    const evaluation = evaluateAssuranceCase(next, {
      ...goldenValidInput(),
      evidence: [record, ...goldenValidInput().evidence],
    });
    expect(evaluation.verdict).toBe('OBJECTIONED'); // the standing objection
    expect(evaluation.invalidations).toEqual([]);

    // A FAILING runtime-conformance record adopted as CONTRADICTS invalidates.
    const failing = makeEvidence({
      kind: 'runtime-conformance',
      availability: 'FAILURE',
      provenance: ['W8:conformance-test:adopt-failing'],
    });
    const contradicted = adoptConformanceEvidence(next, {
      evidence: failing,
      role: 'CONTRADICTS',
      claim_ref: 'claim-payments-correct',
      provenance: ['W8:conformance-test:adopt-failing'],
      created_at: T2,
    }).case;
    const contradictedEvaluation = evaluateAssuranceCase(contradicted, {
      ...goldenValidInput(),
      evidence: [record, failing, ...goldenValidInput().evidence],
    });
    expect(contradictedEvaluation.verdict).toBe('INVALID');
    expect(contradictedEvaluation.invalidations.map((entry) => entry.reason)).toContain(
      'CONTRADICTED_BY_EVIDENCE',
    );
  });

  it('drift records are adoptable ONLY as CONTRADICTS (they document non-conformance)', () => {
    const drift = makeEvidence({ kind: 'architecture-drift' });
    expect(() => assertConformanceRoleAllowed(drift, 'CONTRADICTS')).not.toThrow();
    expect(() => assertConformanceRoleAllowed(drift, 'SUPPORTS')).toThrow(
      /can only be adopted with the CONTRADICTS role/,
    );
    expect(() => assertConformanceRoleAllowed(drift, 'VERIFIES')).toThrow(
      /can only be adopted with the CONTRADICTS role/,
    );

    const head = activeCase();
    const { case: next, link } = adoptConformanceEvidence(head, {
      evidence: drift,
      role: 'CONTRADICTS',
      claim_ref: 'claim-payments-safe',
      provenance: ['W8:conformance-test:adopt-drift'],
      created_at: T2,
    });
    expect(link.type).toBe('CONTRADICTS');
    const evaluation = evaluateAssuranceCase(next, {
      ...goldenValidInput(),
      evidence: [drift, ...goldenValidInput().evidence],
    });
    expect(evaluation.verdict).toBe('INVALID');
    expect(evaluation.invalidations.map((entry) => entry.reason)).toContain('CONTRADICTED_BY_EVIDENCE');
  });

  it('runtime-monitor evidence from @sos-2/verification follows the same adoption rules', () => {
    // A monitor evidence record (kind runtime-monitor) with SUCCESS supports;
    // one with FAILURE contradicts — verified purely through the shared
    // evidence contract (the verification package mints W3 records).
    const monitorPass = makeEvidence({ kind: 'runtime-monitor' });
    const monitorFail = makeEvidence({ kind: 'runtime-monitor', availability: 'FAILURE' });
    expect(() => assertConformanceRoleAllowed(monitorPass, 'SUPPORTS')).not.toThrow();
    expect(() => assertConformanceRoleAllowed(monitorPass, 'CONTRADICTS')).toThrow(
      /CONTRADICTS role requires availability FAILURE/,
    );
    expect(() => assertConformanceRoleAllowed(monitorFail, 'CONTRADICTS')).not.toThrow();
    expect(() => assertConformanceRoleAllowed(monitorFail, 'SUPPORTS')).toThrow(
      /SUPPORTS role requires availability SUCCESS/,
    );
  });
});
