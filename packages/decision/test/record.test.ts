/**
 * Unit tests: decision record validation + the resolution path.
 */

import { describe, expect, it } from 'vitest';
import { createAskRequest } from '@sos-2/authority';
import type { AskRequestArtifact } from '@sos-2/authority';
import {
  assertValidDecisionRecord,
  createDecisionRecord,
  decisionRecordId,
  evaluate,
  mintResolutionDecision,
  validateDecisionRecord,
  verifyDecision,
} from '../src/index.js';
import type { DecisionRecord } from '../src/index.js';
import { decisionMeta, decisionRequest, evidenceRecord } from './helpers.js';

function askFixture(origin: DecisionRecord, askIdVersion = 1): AskRequestArtifact {
  return createAskRequest({
    content: {
      decision: 'Decide the escalated action: revise the checkout mission document (action REVISE at blast radius SERVICE, risk LOW, reversibility REVERSIBLE).',
      alternatives: [
        { id: 'act-under-authority', action: 'ACT', description: 'Proceed with the revision under the granted authority.' },
        { id: 'experiment-first', action: 'EXPERIMENT', description: 'Run a controlled experiment before revising.' },
        { id: 'reject', action: 'REJECT', description: 'Refuse the revision.' },
      ],
      evidence_quality: { quality: 'MODERATE', summary: '3 current SUCCESS test-run records about the target.' },
      uncertainty: { uncertainty_class: 'LOW', basis: 'the revision is fully specified and reviewed' },
      trade_offs: ['risk LOW vs reversibility REVERSIBLE', 'impact MODERATE vs evidence quality MODERATE'],
      risk: { description: 'The revision carries LOW risk with REVERSIBLE changes at blast radius SERVICE.', severity: 'LOW' },
      authority_insufficiency: 'no grant was presented — nothing is authorized implicitly',
    },
    provenance: ['W10:decision-test:ask'],
    created_at: '2025-01-02T00:00:00.000Z',
    version: askIdVersion,
  });
}

describe('record validation', () => {
  it('a minted record validates (assert + predicate)', () => {
    const { record } = evaluate(decisionRequest({ causal_claim: true, evidence: [evidenceRecord()] }), decisionMeta());
    expect(() => assertValidDecisionRecord(record)).not.toThrow();
    expect(validateDecisionRecord(record)).toBe(true);
  });

  it('createDecisionRecord is deterministic (id over meta + content)', () => {
    const { record } = evaluate(decisionRequest(), decisionMeta());
    const reminted = createDecisionRecord(decisionMeta(), record.content);
    expect(reminted).toEqual(record);
    expect(decisionRecordId(decisionMeta(), record.content)).toBe(record.envelope.id);
  });

  it('a different meta (provenance/created_at) yields a different id but the same content semantics', () => {
    const { record } = evaluate(decisionRequest(), decisionMeta());
    const otherMeta = { ...decisionMeta(), provenance: ['W10:decision-test:other'] };
    const reminted = createDecisionRecord(otherMeta, record.content);
    expect(reminted.envelope.id).not.toBe(record.envelope.id);
  });
});

describe('resolution minting', () => {
  function askOrigin() {
    const origin = evaluate(decisionRequest({ grants: [] }), decisionMeta()); // ASK: AUTHORITY_INSUFFICIENT
    expect(origin.action).toBe('ASK');
    const ask = askFixture(origin.record);
    return { ask, origin: origin.record };
  }

  it('an ASK resolved by an authority produces a DecisionRecord via the decision machinery', () => {
    const { ask, origin } = askOrigin();
    const resolved = mintResolutionDecision({
      ask,
      origin_decision: origin,
      resolved_by: 'human:principal-engineer',
      alternative_id: 'act-under-authority',
      note: 'I reviewed the revision and grant the authority explicitly.',
      meta: { provenance: ['W10:decision-test:resolution'], created_at: '2025-01-02T06:00:00.000Z' },
    });
    expect(resolved.content.action).toBe('ACT');
    expect(resolved.content.input_digest).toBe(origin.content.input_digest); // bound to the EXACT escalated input
    expect(resolved.content.rule_trace).toEqual([
      {
        rule: 'RESOLUTION',
        order: 1,
        outcome: 'ACT',
        code: 'RESOLVED_BY_AUTHORITY',
        reason: expect.stringContaining('human:principal-engineer'),
      },
    ]);
    expect(resolved.content.resolution).toEqual({
      resolved_by: 'human:principal-engineer',
      alternative_id: 'act-under-authority',
      ask_ref: ask.envelope.id,
      origin_decision_ref: origin.envelope.id,
      note: 'I reviewed the revision and grant the authority explicitly.',
    });
    expect(resolved.content.escalation).toBeNull();
    expect(validateDecisionRecord(resolved)).toBe(true);
  });

  it('the provenance carries WHO resolved it (part of the artifact)', () => {
    const { ask, origin } = askOrigin();
    const resolved = mintResolutionDecision({
      ask,
      origin_decision: origin,
      resolved_by: 'human:principal-engineer',
      alternative_id: 'reject',
      note: 'Rejecting: the trade-offs do not favor the revision.',
      meta: { provenance: ['W10:decision-test:resolution'], created_at: '2025-01-02T06:00:00.000Z' },
    });
    expect(resolved.envelope.provenance).toContain('resolved-by:human:principal-engineer');
    expect(resolved.envelope.provenance).toContain(`ask:${ask.envelope.id}`);
    expect(resolved.content.action).toBe('REJECT');
  });

  it('resolution minting is deterministic', () => {
    const { ask, origin } = askOrigin();
    const input = {
      ask,
      origin_decision: origin,
      resolved_by: 'human:principal-engineer',
      alternative_id: 'act-under-authority',
      note: 'Same note, same everything.',
      meta: { provenance: ['W10:decision-test:resolution'], created_at: '2025-01-02T06:00:00.000Z' },
    };
    expect(mintResolutionDecision(input)).toEqual(mintResolutionDecision(structuredClone(input)));
  });

  it('rejects a resolution whose alternative id is foreign to the ask', () => {
    const { ask, origin } = askOrigin();
    expect(() =>
      mintResolutionDecision({
        ask,
        origin_decision: origin,
        resolved_by: 'human:principal-engineer',
        alternative_id: 'does-not-exist',
        note: 'x',
        meta: { provenance: ['W10:decision-test:resolution'], created_at: '2025-01-02T06:00:00.000Z' },
      }),
    ).toThrow(/not one of the ask's alternatives/);
  });

  it('rejects a resolution whose origin is not an ASK record', () => {
    const { ask } = askOrigin();
    const actRecord = evaluate(decisionRequest(), decisionMeta()).record;
    expect(() =>
      mintResolutionDecision({
        ask,
        origin_decision: actRecord,
        resolved_by: 'human:principal-engineer',
        alternative_id: 'act-under-authority',
        note: 'x',
        meta: { provenance: ['W10:decision-test:resolution'], created_at: '2025-01-02T06:00:00.000Z' },
      }),
    ).toThrow(/must be an ASK record/);
  });

  it('rejects resolving an ASK with an ASK alternative (re-asking is a new AskRequest)', () => {
    const origin = evaluate(decisionRequest({ grants: [] }), decisionMeta()).record;
    const ask = createAskRequest({
      content: {
        decision: 'Decide the escalated action.',
        alternatives: [
          { id: 're-ask', action: 'ASK', description: 'Ask a different authority.' },
          { id: 'reject', action: 'REJECT', description: 'Refuse.' },
        ],
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
        resolved_by: 'human:principal-engineer',
        alternative_id: 're-ask',
        note: 'x',
        meta: { provenance: ['W10:decision-test:resolution'], created_at: '2025-01-02T06:00:00.000Z' },
      }),
    ).toThrow(/resolving an ASK with ASK is a contradiction/);
  });
});

describe('verifyDecision (reproducibility verification)', () => {
  it('verifies a faithful record', () => {
    const request = decisionRequest({ causal_claim: true, evidence: [evidenceRecord()] });
    const meta = decisionMeta();
    const { record } = evaluate(request, meta);
    expect(verifyDecision(request, meta, record)).toBe(true);
  });

  it('rejects a tampered record (action, digest, trace)', () => {
    // Baseline: an ASK record (grants: []) — tampering it to ACT must fail.
    const request = decisionRequest({ grants: [] });
    const meta = decisionMeta();
    const { record } = evaluate(request, meta);
    expect(record.content.action).toBe('ASK');
    expect(verifyDecision(request, meta, record)).toBe(true);
    expect(verifyDecision(request, meta, { ...record, content: { ...record.content, action: 'ACT' } })).toBe(false);
    expect(
      verifyDecision(request, meta, {
        ...record,
        content: { ...record.content, input_digest: '0'.repeat(64) },
      }),
    ).toBe(false);
    expect(
      verifyDecision(request, meta, {
        ...record,
        content: { ...record.content, rule_trace: [...record.content.rule_trace.slice(0, -1)] },
      }),
    ).toBe(false);
  });
});
