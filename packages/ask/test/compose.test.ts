/**
 * Unit tests: ask content composition + escalation context assembly.
 */

import { describe, expect, it } from 'vitest';
import { createAskRequest, validateAskRequest } from '@sos-2/authority';
import { evaluate, validateDecisionRecord } from '@sos-2/decision';
import {
  assembleEscalationContext,
  composeAskContent,
  DEFAULT_ALTERNATIVES,
  defaultAlternativesFor,
  deriveEvidenceQuality,
  documentedEscalationCodes,
} from '../src/index.js';
import {
  T1,
  cornerRequest,
  decisionMeta,
  escalatingRequest,
  evidenceRecord,
  validGrant,
} from './helpers.js';

describe('composeAskContent', () => {
  it('composes valid AskContent from an ASK decision record (ASK IS A SUCCESS STATE — no throws)', () => {
    const evaluation = evaluate(escalatingRequest(), decisionMeta());
    expect(evaluation.action).toBe('ASK');
    const content = composeAskContent({ decision: evaluation.record });
    expect(content.decision).toContain('Revise the checkout mission document');
    expect(content.decision).toContain(evaluation.input_digest);
    expect(content.authority_insufficiency).toBe(evaluation.record.content.escalation!.message);
    expect(content.risk.severity).toBe('LOW');
    expect(content.uncertainty.uncertainty_class).toBe('LOW');
    expect(content.trade_offs.length).toBeGreaterThan(0);
    expect(content.alternatives.length).toBeGreaterThan(0);
    expect(content.evidence_quality.quality).toBe('NONE');
    // The composed content validates against the AUTHORITY contract:
    const ask = createAskRequest({
      content,
      provenance: ['W10:ask-test'],
      created_at: T1,
    });
    expect(validateAskRequest(ask)).toBe(true);
  });

  it('derives the documented default alternatives per escalation code (typed, frozen-six actions)', () => {
    for (const code of documentedEscalationCodes()) {
      const alternatives = defaultAlternativesFor(code);
      expect(alternatives.length).toBeGreaterThan(0);
      for (const alternative of alternatives) {
        expect(['ACT', 'EXPERIMENT', 'GATHER_EVIDENCE', 'ASK', 'REJECT', 'ROLLBACK']).toContain(alternative.action);
      }
    }
    // The corner escalation carries the rollback alternative:
    expect(DEFAULT_ALTERNATIVES['RISK_IRREVERSIBILITY_ESCALATION']!.map((a) => a.action)).toContain('ROLLBACK');
    // An unknown code falls back to the documented pair:
    expect(defaultAlternativesFor('SOMETHING_ELSE')).toHaveLength(2);
  });

  it('the matrix-corner ask composes with the corner alternative set and severity', () => {
    const evaluation = evaluate(cornerRequest(), decisionMeta());
    expect(evaluation.action).toBe('ASK');
    expect(evaluation.record.content.escalation!.code).toBe('RISK_IRREVERSIBILITY_ESCALATION');
    const content = composeAskContent({ decision: evaluation.record });
    expect(content.risk.severity).toBe('HIGH');
    expect(content.alternatives.map((alternative) => alternative.id)).toContain('rollback');
    expect(content.authority_insufficiency).toContain('confidence is not authorization');
  });

  it('overrides replace the derived defaults', () => {
    const evaluation = evaluate(escalatingRequest(), decisionMeta());
    const content = composeAskContent({
      decision: evaluation.record,
      overrides: {
        alternatives: [{ id: 'custom-choice', action: 'REJECT', description: 'A caller-supplied alternative.' }],
        trade_offs: ['a single caller-supplied trade-off'],
        evidence_quality: { quality: 'STRONG', summary: 'caller says strong' },
      },
    });
    expect(content.alternatives).toEqual([
      { id: 'custom-choice', action: 'REJECT', description: 'A caller-supplied alternative.' },
    ]);
    expect(content.trade_offs).toEqual(['a single caller-supplied trade-off']);
    expect(content.evidence_quality).toEqual({ quality: 'STRONG', summary: 'caller says strong' });
  });

  it('composition is deterministic (same ASK record -> same content)', () => {
    const evaluation = evaluate(escalatingRequest(), decisionMeta());
    expect(composeAskContent({ decision: evaluation.record })).toEqual(
      composeAskContent({ decision: structuredClone(evaluation.record) }),
    );
  });
});

describe('deriveEvidenceQuality', () => {
  it('NONE when no evidence refs', () => {
    expect(deriveEvidenceQuality([], [])).toBe('NONE');
  });

  it('MODERATE when refs exist but records are not supplied (never inflated, never deflated)', () => {
    expect(deriveEvidenceQuality(['sos://Evidence/00000000000000000000000000000000'], [])).toBe('MODERATE');
  });

  it('STRONG for SUCCESS records with calibrated or STRONG confidence', () => {
    const record = evidenceRecord();
    const calibrated = {
      ...record,
      confidence: { kind: 'CALIBRATED' as const, value: 0.9, calibration_ref: 'sos://Evaluation/dddddddddddddddddddddddddddddddd' },
    };
    expect(deriveEvidenceQuality([record.id], [calibrated])).toBe('STRONG');
    const strong = { ...record, confidence: { kind: 'QUALITATIVE' as const, uncertainty_class: 'STRONG' as const } };
    expect(deriveEvidenceQuality([record.id], [strong])).toBe('STRONG');
  });

  it('MODERATE for SUCCESS records without strong marks', () => {
    const record = evidenceRecord();
    expect(deriveEvidenceQuality([record.id], [record])).toBe('MODERATE');
  });

  it('WEAK when only non-SUCCESS records match', () => {
    const record = { ...evidenceRecord(), availability: 'UNKNOWN' as const };
    expect(deriveEvidenceQuality([record.id], [record])).toBe('WEAK');
  });
});

describe('assembleEscalationContext', () => {
  /** An ASK decision that carries evidence refs: permitted + evidenced + IRREDUCIBLE uncertainty -> R4 ASK. */
  function uncertainAskWithEvidence() {
    const request = {
      ...escalatingRequest(),
      grants: [validGrant()],
      causal_claim: true,
      evidence: [evidenceRecord()],
      uncertainty: {
        uncertainty_class: 'IRREDUCIBLE' as const,
        basis: 'stakeholder preferences are unknowable in advance',
      },
    };
    const evaluation = evaluate(request, decisionMeta());
    expect(evaluation.action).toBe('ASK');
    expect(evaluation.record.content.evidence_refs.length).toBeGreaterThan(0);
    return evaluation;
  }

  it('assembles everything the decider needs to see', () => {
    const evaluation = evaluate(escalatingRequest(), decisionMeta());
    const ask = createAskRequest({
      content: composeAskContent({ decision: evaluation.record }),
      provenance: ['W10:ask-test'],
      created_at: T1,
    });
    const context = assembleEscalationContext({ ask, decision: evaluation.record, now: T1 });
    expect(context.ask_id).toBe(ask.envelope.id);
    expect(context.decision_record_ref).toBe(evaluation.record.envelope.id);
    expect(context.origin_input_digest).toBe(evaluation.input_digest);
    expect(context.priority).toBe('LOW');
    expect(context.decision_request.action_kind).toBe('REVISE');
    expect(context.decision_request.risk).toBe('LOW');
    expect(context.alternatives.length).toBeGreaterThan(0);
    expect(context.evidence_summary).toEqual([]); // no evidence refs on this escalation
    expect(context.uncertainty.uncertainty_class).toBe('LOW');
    expect(context.authority_insufficiency).toContain('no grant was presented');
    expect(context.rule_trace.at(-1)!.rule).toBe('R1_AUTHORITY');
    expect(context.authority.verdict_code).toBe('NO_GRANT');
  });

  it('reports evidence with CURRENT freshness (re-evaluated at the presentation instant)', () => {
    const evaluation = uncertainAskWithEvidence();
    const record = evidenceRecord();
    const ask = createAskRequest({
      content: composeAskContent({ decision: evaluation.record, evidence: [record] }),
      provenance: ['W10:ask-test'],
      created_at: T1,
    });
    const context = assembleEscalationContext({
      ask,
      decision: evaluation.record,
      evidence: [record],
      now: T1,
    });
    expect(context.evidence_summary).toHaveLength(1);
    const row = context.evidence_summary[0]!;
    expect(row.ref).toBe(record.id);
    expect(row.provided).toBe(true);
    expect(row.availability).toBe('SUCCESS');
    expect(row.evidence_class).toBe('INTERVENTIONAL');
    expect(row.freshness).toBe('FRESH');
    expect(validateDecisionRecord(evaluation.record)).toBe(true);
  });

  it('missing evidence records are reported truthfully (provided: false, freshness null)', () => {
    const evaluation = uncertainAskWithEvidence();
    const ask = createAskRequest({
      content: composeAskContent({ decision: evaluation.record }),
      provenance: ['W10:ask-test'],
      created_at: T1,
    });
    const context = assembleEscalationContext({ ask, decision: evaluation.record, now: T1 });
    expect(context.evidence_summary).toHaveLength(evaluation.record.content.evidence_refs.length);
    for (const row of context.evidence_summary) {
      expect(row.provided).toBe(false);
      expect(row.freshness).toBeNull();
      expect(row.availability).toBeNull();
    }
  });

});
