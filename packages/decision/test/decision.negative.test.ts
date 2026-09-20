/**
 * NEGATIVE tests: the forbidden decision artifacts are REJECTED.
 *
 * Pinned (Work Order W10 acceptance + spec/architecture-lock.md):
 *   - an outcome OUTSIDE the frozen six                REJECTED;
 *   - a decision WITHOUT a rule trace                  REJECTED;
 *   - CONFIDENCE-ONLY authorization of high-risk/
 *     low-reversibility actions                        REJECTED (still ASK);
 *   - a NON-REPRODUCIBLE decision                      REJECTED;
 *   - a resolution record that breaks its ask binding  REJECTED.
 */

import { describe, expect, it } from 'vitest';
import { createAskRequest } from '@sos-2/authority';
import {
  assertValidDecisionRecord,
  evaluate,
  mintResolutionDecision,
  validateDecisionRecord,
  verifyDecision,
} from '../src/index.js';
import {
  CALIBRATION_REF,
  decisionMeta,
  decisionRequest,
  evidenceRecord,
  highCalibratedConfidence,
} from './helpers.js';

describe('outcome outside the frozen six is REJECTED', () => {
  it('an action outside the six fails record validation loudly', () => {
    const { record } = evaluate(decisionRequest(), decisionMeta());
    const forged = structuredClone(record);
    forged.content = { ...forged.content, action: 'APPROVE' as never };
    expect(() => assertValidDecisionRecord(forged)).toThrow(/one of the frozen six/);
    expect(validateDecisionRecord(forged)).toBe(false);
  });

  it('a rule-trace outcome outside the six fails validation', () => {
    const { record } = evaluate(decisionRequest(), decisionMeta());
    const forged = structuredClone(record);
    forged.content = {
      ...forged.content,
      rule_trace: [{ ...forged.content.rule_trace[0]!, outcome: 'DEFER' as never }],
    };
    expect(() => assertValidDecisionRecord(forged)).toThrow(/frozen six/);
  });
});

describe('decision without a rule trace is REJECTED', () => {
  it('an empty rule trace fails validation', () => {
    const { record } = evaluate(decisionRequest(), decisionMeta());
    const forged = structuredClone(record);
    forged.content = { ...forged.content, rule_trace: [] };
    expect(() => assertValidDecisionRecord(forged)).toThrow(/NON-EMPTY array/);
    expect(validateDecisionRecord(forged)).toBe(false);
  });

  it('a non-contiguous rule trace (orders 1, 3) fails validation', () => {
    const { record } = evaluate(decisionRequest(), decisionMeta());
    const forged = structuredClone(record);
    const trace = forged.content.rule_trace.map((entry) => ({ ...entry }));
    trace[1] = { ...trace[1]!, order: 3 };
    forged.content = { ...forged.content, rule_trace: trace };
    expect(() => assertValidDecisionRecord(forged)).toThrow(/1, 2, 3/);
  });
});

describe('structural forgeries are REJECTED', () => {
  it('a non-ASK record carrying an escalation block fails validation', () => {
    const { record } = evaluate(decisionRequest(), decisionMeta());
    const forged = structuredClone(record);
    forged.content = {
      ...forged.content,
      escalation: { code: 'X', message: 'an ACT record cannot escalate' },
    };
    expect(() => assertValidDecisionRecord(forged)).toThrow(/carries no escalation block/);
  });

  it('an ASK record without an escalation block fails validation', () => {
    const { record } = evaluate(decisionRequest({ grants: [] }), decisionMeta());
    expect(record.content.action).toBe('ASK');
    const forged = structuredClone(record);
    forged.content = { ...forged.content, escalation: null };
    expect(() => assertValidDecisionRecord(forged)).toThrow(/REQUIRES a structured escalation block/);
  });

  it('an engine record carrying a resolution block fails validation', () => {
    const { record } = evaluate(decisionRequest(), decisionMeta());
    const forged = structuredClone(record);
    forged.content = {
      ...forged.content,
      resolution: {
        resolved_by: 'x',
        alternative_id: 'y',
        ask_ref: 'z',
        origin_decision_ref: 'w',
        note: 'n',
      },
    };
    expect(() => assertValidDecisionRecord(forged)).toThrow(/no resolution block/);
  });

  it('a foreign envelope kind fails validation', () => {
    const { record } = evaluate(decisionRequest(), decisionMeta());
    const forged = structuredClone(record);
    forged.envelope = { ...forged.envelope, kind: 'Mission' };
    expect(() => assertValidDecisionRecord(forged)).toThrow(/spine-valid|"Decision"/);
  });

  it('a malformed input digest fails validation', () => {
    const { record } = evaluate(decisionRequest(), decisionMeta());
    const forged = structuredClone(record);
    forged.content = { ...forged.content, input_digest: 'not-a-hash' };
    expect(() => assertValidDecisionRecord(forged)).toThrow(/64-hex/);
  });
});

describe('confidence-only authorization of high-risk/low-reversibility is REJECTED', () => {
  it('a 0.99-calibrated, fresh-evidence, valid-grant request in the corner still ASKs', () => {
    const result = evaluate(
      decisionRequest({
        risk: 'HIGH',
        reversibility: 'IRREVERSIBLE',
        causal_claim: true,
        evidence: [evidenceRecord()],
        confidence: highCalibratedConfidence(),
      }),
      decisionMeta(),
    );
    expect(result.action).toBe('ASK');
    expect(result.record.content.escalation!.code).toBe('RISK_IRREVERSIBILITY_ESCALATION');
    expect(result.record.content.confidence).toEqual(highCalibratedConfidence()); // carried, recorded...
    // ...and the safety rule's own reason proves confidence was not consulted:
    expect(result.record.content.rule_trace.at(-1)!.reason).toContain('confidence');
    expect(result.record.content.rule_trace.at(-1)!.reason).toContain('NOT consulted');
  });

  it('an extreme 0.999999 calibrated mark changes nothing in the corner', () => {
    const result = evaluate(
      decisionRequest({
        risk: 'SEVERE',
        reversibility: 'PARTIALLY_REVERSIBLE',
        confidence: { kind: 'CALIBRATED', value: 0.999999, calibration_ref: CALIBRATION_REF },
      }),
      decisionMeta(),
    );
    expect(result.action).toBe('ASK');
  });
});

describe('non-reproducible decisions are REJECTED', () => {
  it('a tampered trace fails verifyDecision', () => {
    const request = decisionRequest();
    const meta = decisionMeta();
    const { record } = evaluate(request, meta);
    const tampered = structuredClone(record);
    tampered.content = {
      ...tampered.content,
      rule_trace: [
        ...tampered.content.rule_trace.slice(0, -1),
        { ...tampered.content.rule_trace.at(-1)!, reason: 'fabricated reason' },
      ],
    };
    expect(verifyDecision(request, meta, record)).toBe(true);
    expect(verifyDecision(request, meta, tampered)).toBe(false);
  });

  it('a record evaluated under a different request fails verification', () => {
    const { record } = evaluate(decisionRequest(), decisionMeta());
    expect(verifyDecision(decisionRequest({ risk: 'SEVERE' }), decisionMeta(), record)).toBe(false);
  });
});

describe('resolution bindings are REJECTED when broken', () => {
  it('an empty resolved_by is rejected', () => {
    const origin = evaluate(decisionRequest({ grants: [] }), decisionMeta()).record;
    const ask = createAskRequest({
      content: {
        decision: 'Decide the escalated action.',
        alternatives: [{ id: 'reject', action: 'REJECT', description: 'Refuse.' }],
        evidence_quality: { quality: 'NONE', summary: 'none' },
        uncertainty: { uncertainty_class: 'LOW', basis: 'x' },
        trade_offs: ['t'],
        risk: { description: 'r', severity: 'LOW' },
        authority_insufficiency: 'no grant',
      },
      provenance: ['W10:decision-test:ask'],
      created_at: '2025-01-02T00:00:00.000Z',
    });
    expect(() =>
      mintResolutionDecision({
        ask,
        origin_decision: origin,
        resolved_by: '',
        alternative_id: 'reject',
        note: 'x',
        meta: { provenance: ['W10:decision-test:resolution'], created_at: '2025-01-02T06:00:00.000Z' },
      }),
    ).toThrow(/resolved_by/);
  });
});
