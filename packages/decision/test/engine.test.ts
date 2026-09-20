/**
 * Unit tests: the decision engine — every rule, the rule ORDER (authority
 * first, then safety, then evidence, then uncertainty), and the frozen-six
 * outcome discipline.
 */

import { describe, expect, it } from 'vitest';
import { DECISION_ACTIONS } from '@sos-2/authority';
import { evaluate } from '../src/index.js';
import type { DecisionEvaluation } from '../src/index.js';
import {
  T0,
  T_PAST,
  decisionMeta,
  decisionRequest,
  evidenceRecord,
  expiredGrant,
  highCalibratedConfidence,
  llmProducer,
  revokedGrant,
  sampleRaise,
  validGrant,
} from './helpers.js';

function evaluateRequest(options: Parameters<typeof decisionRequest>[0]): DecisionEvaluation {
  return evaluate(decisionRequest(options), decisionMeta());
}

describe('R5 ACT — the happy path', () => {
  it('a clean request at every gate yields ACT with the full five-rule trace', () => {
    const result = evaluateRequest({});
    expect(result.action).toBe('ACT');
    expect(result.record.content.action).toBe('ACT');
    expect(result.rule_trace.map((entry) => entry.rule)).toEqual([
      'R0_SHAPE',
      'R1_AUTHORITY',
      'R2_SAFETY',
      'R3_EVIDENCE',
      'R4_UNCERTAINTY',
      'R5_ACT',
    ]);
    expect(result.record.content.escalation).toBeNull();
    expect(result.record.content.resolution).toBeNull();
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('a causal claim with fresh interventional SUCCESS evidence also yields ACT', () => {
    const result = evaluateRequest({ causal_claim: true, evidence: [evidenceRecord()] });
    expect(result.action).toBe('ACT');
  });
});

describe('R0 SHAPE — invalid requests are REJECTED', () => {
  it('a foreign action kind is rejected with a trace of exactly one entry', () => {
    const result = evaluateRequest({ action_kind: 'HACK' as never });
    expect(result.action).toBe('REJECT');
    expect(result.rule_trace).toHaveLength(1);
    expect(result.rule_trace[0]!.rule).toBe('R0_SHAPE');
    expect(result.rule_trace[0]!.code).toBe('INVALID_REQUEST_SHAPE');
    // The record still binds to the exact input digest.
    expect(result.input_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a malformed uncertainty statement and malformed evaluation point are rejected; garbage evidence entries are ignored-with-reason (W9 discipline)', () => {
    expect(evaluateRequest({ uncertainty: { uncertainty_class: 'SURE' as never, basis: 'x' } }).action).toBe('REJECT');
    expect(
      evaluateRequest({ evaluation_point: { kind: 'REVISION', artifact_id: 'sos://Mission/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', version: 1 } as never }).action,
    ).toBe('REJECT');
    // A non-object / non-W3 evidence entry is NOT a shape rejection: it is
    // ignored with a reason and counted for nothing (the W9 evidence-gate
    // discipline) — a clean request still reaches its clean outcome.
    expect(evaluateRequest({ evidence: [{} as never] }).action).toBe('ACT');
  });
});

describe('R1 AUTHORITY — authority first', () => {
  it('an expired grant REJECTS (dead authority authorizes nothing)', () => {
    const result = evaluateRequest({ grants: [expiredGrant()] });
    expect(result.action).toBe('REJECT');
    expect(result.rule_trace.at(-1)!.code).toBe('EXPIRED');
  });

  it('a revoked grant REJECTS', () => {
    const result = evaluateRequest({ grants: [revokedGrant()] });
    expect(result.action).toBe('REJECT');
    expect(result.rule_trace.at(-1)!.code).toBe('REVOKED');
  });

  it('no grant at all -> ASK with AUTHORITY_INSUFFICIENT escalation', () => {
    const result = evaluateRequest({ grants: [] });
    expect(result.action).toBe('ASK');
    expect(result.record.content.escalation).not.toBeNull();
    expect(result.record.content.escalation!.code).toBe('AUTHORITY_INSUFFICIENT');
    expect(result.record.content.authority.verdict_code).toBe('NO_GRANT');
  });

  it('an in-scope grant without the action permission -> ASK (insufficient)', () => {
    const result = evaluateRequest({ grants: [validGrant({ permissions: ['READ'] })] });
    expect(result.action).toBe('ASK');
    expect(result.record.content.escalation!.code).toBe('AUTHORITY_INSUFFICIENT');
    expect(result.record.content.authority.verdict_code).toBe('PERMISSION_MISSING');
  });

  it('a SUPERVISED cell without the explicit decision -> ASK', () => {
    const result = evaluateRequest({ action_kind: 'PROMOTE', blast_radius: 'SYSTEM' });
    expect(result.action).toBe('ASK');
    expect(result.record.content.escalation!.code).toBe('SUPERVISED_REQUIRES_EXPLICIT_DECISION');
  });

  it('a governed raise covering the cell unblocks it (SUPERVISED -> BOUNDED)', () => {
    const grant = validGrant();
    const raise = sampleRaise(grant);
    const result = evaluateRequest({
      action_kind: 'REVISE',
      blast_radius: 'ORGANIZATION',
      grants: [grant],
      raises: [raise],
    });
    expect(result.action).toBe('ACT');
    expect(result.record.content.authority.required_level).toBe('SUPERVISED');
    expect(result.record.content.authority.effective_level).toBe('BOUNDED');
    expect(result.record.content.authority.applied_raise_refs).toEqual([raise.envelope.id]);
  });

  it('confidence NEVER substitutes for a grant: a 0.99-calibrated request without grants ASKs', () => {
    const result = evaluateRequest({ grants: [], confidence: highCalibratedConfidence() });
    expect(result.action).toBe('ASK');
    // ...and the confidence mark is faithfully RECORDED, never consulted:
    expect(result.record.content.confidence).toEqual(highCalibratedConfidence());
  });
});

describe('R2 SAFETY — safety before evidence', () => {
  it('wired rollback signals force ROLLBACK (even with zero evidence)', () => {
    const result = evaluateRequest({
      rollback_signals: ['guardrail error-rate BREACHED at 0.02 > 0.01'],
      causal_claim: true,
      evidence: [],
    });
    expect(result.action).toBe('ROLLBACK');
    expect(result.rule_trace.at(-1)!.code).toBe('ROLLBACK_SIGNALS');
  });

  it('the high-risk/low-reversibility corner escalates to ASK regardless of confidence', () => {
    const result = evaluateRequest({
      risk: 'HIGH',
      reversibility: 'IRREVERSIBLE',
      confidence: highCalibratedConfidence(),
    });
    expect(result.action).toBe('ASK');
    expect(result.record.content.escalation!.code).toBe('RISK_IRREVERSIBILITY_ESCALATION');
    expect(result.record.content.escalation!.message).toContain('confidence');
  });

  it('SEVERE risk escalates even when fully reversible', () => {
    const result = evaluateRequest({ risk: 'SEVERE', reversibility: 'REVERSIBLE' });
    expect(result.action).toBe('ASK');
    expect(result.record.content.escalation!.code).toBe('RISK_IRREVERSIBILITY_ESCALATION');
  });

  it('LOW risk with REVERSIBLE actions does not trip the matrix', () => {
    const result = evaluateRequest({ risk: 'LOW', reversibility: 'REVERSIBLE' });
    expect(result.action).toBe('ACT');
  });
});

describe('R3 EVIDENCE — evidence after safety', () => {
  it('a causal claim with NO real interventional evidence -> EXPERIMENT', () => {
    const result = evaluateRequest({ causal_claim: true, evidence: [] });
    expect(result.action).toBe('EXPERIMENT');
    expect(result.rule_trace.at(-1)!.code).toBe('NO_INTERVENTION_EVIDENCE');
  });

  it('a causal claim with only OBSERVATIONAL evidence -> EXPERIMENT (correlation is not causation)', () => {
    const result = evaluateRequest({ causal_claim: true, evidence: [evidenceRecord({ evidenceClass: 'OBSERVATIONAL' })] });
    expect(result.action).toBe('EXPERIMENT');
  });

  it('a causal claim with stale interventional evidence -> GATHER_EVIDENCE', () => {
    const result = evaluateRequest({
      causal_claim: true,
      evidence: [evidenceRecord({ window: { start: '2024-11-01T00:00:00.000Z', end: T_PAST } })],
    });
    expect(result.action).toBe('GATHER_EVIDENCE');
    expect(result.rule_trace.at(-1)!.code).toBe('EVIDENCE_NOT_CURRENT');
  });

  it('a SIMULATED record presented as evidence -> REJECT (simulation is never evidence)', () => {
    const result = evaluateRequest({ causal_claim: true, evidence: [evidenceRecord({ simulated: true })] });
    expect(result.action).toBe('REJECT');
    expect(result.rule_trace.at(-1)!.code).toBe('SIMULATED_EVIDENCE');
  });

  it('LLM-produced evidence never satisfies (falls through to EXPERIMENT for causal claims)', () => {
    const result = evaluateRequest({ causal_claim: true, evidence: [evidenceRecord({ producer: llmProducer() })] });
    expect(result.action).toBe('EXPERIMENT');
  });

  it('evidence about a foreign subject is not counted (subject binding)', () => {
    const result = evaluateRequest({
      causal_claim: true,
      evidence: [evidenceRecord({ subject: 'sos://Evidence/00000000000000000000000000000000' })],
    });
    expect(result.action).toBe('EXPERIMENT');
  });

  it('HIGH impact non-causal actions require current SUCCESS evidence -> GATHER_EVIDENCE when absent', () => {
    const result = evaluateRequest({ impact: 'HIGH', evidence: [] });
    expect(result.action).toBe('GATHER_EVIDENCE');
    expect(result.rule_trace.at(-1)!.code).toBe('EVIDENCE_INSUFFICIENT_FOR_IMPACT');
  });

  it('MODERATE impact non-causal actions need no evidence', () => {
    const result = evaluateRequest({ impact: 'MODERATE', evidence: [] });
    expect(result.action).toBe('ACT');
  });
});

describe('R4 UNCERTAINTY — uncertainty last', () => {
  it('IRREDUCIBLE uncertainty -> ASK (only judgment can decide)', () => {
    const result = evaluateRequest({
      uncertainty: { uncertainty_class: 'IRREDUCIBLE', basis: 'stakeholder preferences are unknowable in advance' },
    });
    expect(result.action).toBe('ASK');
    expect(result.record.content.escalation!.code).toBe('UNCERTAINTY_IRREDUCIBLE');
  });

  it('HIGH uncertainty -> GATHER_EVIDENCE (reduce it first)', () => {
    const result = evaluateRequest({
      uncertainty: { uncertainty_class: 'HIGH', basis: 'no load test exists for the new path' },
    });
    expect(result.action).toBe('GATHER_EVIDENCE');
    expect(result.rule_trace.at(-1)!.code).toBe('UNCERTAINTY_HIGH');
  });
});

describe('RULE ORDER — documented tie priority (authority, safety, evidence)', () => {
  it('authority fires BEFORE evidence: no grant + causal-no-evidence -> ASK (not EXPERIMENT)', () => {
    const result = evaluateRequest({ grants: [], causal_claim: true, evidence: [] });
    expect(result.action).toBe('ASK');
    expect(result.rule_trace.at(-1)!.rule).toBe('R1_AUTHORITY');
  });

  it('authority fires BEFORE safety: dead grant + rollback signals -> REJECT', () => {
    const result = evaluateRequest({ grants: [expiredGrant()], rollback_signals: ['error-rate BREACHED'] });
    expect(result.action).toBe('REJECT');
    expect(result.rule_trace.at(-1)!.rule).toBe('R1_AUTHORITY');
  });

  it('safety fires BEFORE evidence: rollback signals + causal-no-evidence -> ROLLBACK', () => {
    const result = evaluateRequest({ causal_claim: true, evidence: [], rollback_signals: ['error-rate BREACHED'] });
    expect(result.action).toBe('ROLLBACK');
    expect(result.rule_trace.at(-1)!.rule).toBe('R2_SAFETY');
  });

  it('evidence fires BEFORE uncertainty: causal-no-evidence + IRREDUCIBLE -> EXPERIMENT', () => {
    const result = evaluateRequest({
      causal_claim: true,
      evidence: [],
      uncertainty: { uncertainty_class: 'IRREDUCIBLE', basis: 'unknown unknowns' },
    });
    expect(result.action).toBe('EXPERIMENT');
    expect(result.rule_trace.at(-1)!.rule).toBe('R3_EVIDENCE');
  });
});

describe('REPRODUCIBILITY — byte-identical re-evaluation', () => {
  it('re-evaluating the same request yields the byte-identical record', () => {
    const request = decisionRequest({ causal_claim: true, evidence: [evidenceRecord()] });
    const first = evaluate(request, decisionMeta());
    const second = evaluate(structuredClone(request), decisionMeta());
    expect(JSON.stringify(second.record)).toBe(JSON.stringify(first.record));
    expect(second.input_digest).toBe(first.input_digest);
  });

  it('a DIFFERENT input produces a different digest and a different record', () => {
    const first = evaluateRequest({});
    const second = evaluateRequest({ action_description: 'A different proposal entirely.' });
    expect(second.input_digest).not.toBe(first.input_digest);
    expect(second.record.envelope.id).not.toBe(first.record.envelope.id);
  });

  it('every outcome is a member of the frozen six (no seventh outcome exists)', () => {
    const outcomes = [
      evaluateRequest({}).action,
      evaluateRequest({ grants: [expiredGrant()] }).action,
      evaluateRequest({ grants: [] }).action,
      evaluateRequest({ rollback_signals: ['x'] }).action,
      evaluateRequest({ risk: 'SEVERE', reversibility: 'IRREVERSIBLE' }).action,
      evaluateRequest({ causal_claim: true, evidence: [] }).action,
      evaluateRequest({ causal_claim: true, evidence: [evidenceRecord({ window: { start: '2024-11-01T00:00:00.000Z', end: T_PAST } })] }).action,
      evaluateRequest({ uncertainty: { uncertainty_class: 'IRREDUCIBLE', basis: 'x' } }).action,
    ];
    for (const outcome of outcomes) {
      expect(DECISION_ACTIONS).toContain(outcome);
    }
    // The mapping is exhaustive: all six are reachable.
    expect(new Set(outcomes)).toEqual(new Set(DECISION_ACTIONS));
  });
});

describe('records are spine-valid Decision artifacts', () => {
  it('every evaluation mints a Decision-kind artifact with content-addressed id and sorted evidence refs', () => {
    const evidence = evidenceRecord();
    const result = evaluateRequest({ causal_claim: true, evidence: [evidence] });
    expect(result.record.envelope.kind).toBe('Decision');
    expect(result.record.envelope.id).toMatch(/^sos:\/\/Decision\/[0-9a-f]{32}$/);
    expect(result.record.content.evidence_refs).toEqual([evidence.id]);
    expect(result.record.content.engine_version).toBe('1.0.0');
    expect(result.record.content.authority.grant_ref).not.toBeNull();
    expect(result.record.content.authority.consulted_grant_refs).toEqual([validGrant().envelope.id].sort());
  });
});
