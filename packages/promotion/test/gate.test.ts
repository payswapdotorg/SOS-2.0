import { describe, expect, it } from 'vitest';
import { DECISION_ACTIONS } from '@sos-2/authority';
import { evaluatePromotion, PROMOTION_PERMISSION } from '../src/index.js';
import type { PromotionInput } from '../src/index.js';
import {
  CONSTITUTION_ANCHOR_ID,
  expiredGrant,
  healthyResult,
  highConfidence,
  interventionalEvidence,
  noPermissionGrant,
  PROVENANCE,
  revokedGrant,
  rollbackTriggersOf,
  sampleCandidate,
  sampleExperimentFor,
  scopeMismatchGrant,
  simulatedResult,
  staleInterventionalEvidence,
  T1,
  validAssuranceCase,
  validGrant,
  validRecovery,
} from './helpers.js';

function baseInput(overrides: Partial<PromotionInput> = {}): PromotionInput {
  const candidate = sampleCandidate();
  const experiment = sampleExperimentFor(candidate);
  const result = healthyResult(experiment);
  return {
    authority: { grant: validGrant(candidate), now: T1 },
    assurance: validAssuranceCase(),
    evidence: [interventionalEvidence(candidate)],
    liveTriggers: [],
    systemState: { revision: 'system-state:r1' },
    recovery: validRecovery(experiment, rollbackTriggersOf(experiment, result)),
    provenance: PROVENANCE,
    created_at: T1,
    ...overrides,
  };
}

describe('the promotion gate produces exactly the frozen six decision outcomes', () => {
  it('ACT: current authority + current assurance + current intervention evidence + compatible system state + bounded recovery', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, baseInput());
    expect(evaluation.decision).toBe('ACT');
    expect(evaluation.gates.authority.passes).toBe(true);
    expect(evaluation.gates.assurance.passes).toBe(true);
    expect(evaluation.gates.evidence.satisfied).toBe(true);
    expect(evaluation.gates.systemState?.compatible).toBe(true);
    expect(evaluation.gates.recovery?.valid).toBe(true);
    expect(evaluation.record.envelope.kind).toBe('Decision');
    expect(evaluation.record.content.action).toBe('ACT');
    expect(evaluation.record.content.recovery).not.toBeNull();
    expect(evaluation.record.content.evidence_refs).toHaveLength(1);
    expect(evaluation.reasons.join(' ')).toContain('all promotion gates passed');
  });

  it('ROLLBACK: a triggered live guardrail rollback trigger rolls the change back', () => {
    const candidate = sampleCandidate();
    const experiment = sampleExperimentFor(candidate);
    const result = healthyResult(experiment);
    const triggers = rollbackTriggersOf(experiment, result);
    const fired = triggers.map((trigger) => ({ ...trigger, triggered: true }));
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      liveTriggers: fired,
    });
    expect(evaluation.decision).toBe('ROLLBACK');
    expect(evaluation.gates.guardrails?.triggered).toHaveLength(1);
    expect(evaluation.record.content.live_trigger_rule_ids).toEqual(['error-budget']);
    // The record carries NO recovery declaration (only ACT promotes a live change)
    expect(evaluation.record.content.recovery).toBeNull();
  });

  it('REJECT: no authority grant presented — confidence is NOT authorization', () => {
    const candidate = sampleCandidate({ confidence: highConfidence() });
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      authority: { grant: null, now: T1 },
    });
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.reasons.join(' ')).toContain('CONFIDENCE IS NOT AUTHORIZATION');
    expect(evaluation.gates.authority.grant_ref).toBeNull();
  });

  it('REJECT: an expired grant never authorizes promotion', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      authority: { grant: expiredGrant(candidate), now: T1 },
    });
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.reasons.join(' ')).toContain('EXPIRED');
  });

  it('REJECT: a revoked grant never authorizes promotion', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      authority: { grant: revokedGrant(candidate), now: T1 },
    });
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.reasons.join(' ')).toContain('REVOKED');
  });

  it('REJECT: a scope violation never authorizes promotion', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      authority: { grant: scopeMismatchGrant(candidate), now: T1 },
    });
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.reasons.join(' ')).toContain('scope violation');
  });

  it('REJECT: a grant without the PROMOTE permission never authorizes promotion', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      authority: { grant: noPermissionGrant(candidate), now: T1 },
    });
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.reasons.join(' ')).toContain(PROMOTION_PERMISSION);
  });

  it('ASK: an indeterminate (revision-bound, foreign-artifact) grant evaluation asks the authority', () => {
    const candidate = sampleCandidate();
    const foreignRevisionBound = validGrant(candidate, {
      expiry: {
        kind: 'REVISION',
        artifact_id: 'sos://SystemState/' + 'a'.repeat(32),
        max_version: 9,
      },
    });
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      authority: { grant: foreignRevisionBound, now: T1 },
    });
    expect(evaluation.decision).toBe('ASK');
    expect(evaluation.reasons.join(' ')).toContain('INDETERMINATE');
    expect(evaluation.reasons.join(' ')).toContain('first-class');
  });

  it('ASK is a SUCCESS state (a valid outcome), never an error', () => {
    const candidate = sampleCandidate();
    const foreignRevisionBound = validGrant(candidate, {
      expiry: { kind: 'REVISION', artifact_id: 'sos://Mission/' + 'b'.repeat(32), max_version: 9 },
    });
    expect(() =>
      evaluatePromotion(candidate, { ...baseInput(), authority: { grant: foreignRevisionBound, now: T1 } }),
    ).not.toThrow();
  });

  it('a revision-bound grant ON the candidate evaluates deterministically against the candidate version', () => {
    const candidate = sampleCandidate();
    const boundToCandidate = validGrant(candidate, {
      expiry: { kind: 'REVISION', artifact_id: candidate.envelope.id, max_version: 1 },
    });
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      authority: { grant: boundToCandidate, now: T1 },
    });
    expect(evaluation.gates.authority.passes).toBe(true);
    expect(evaluation.decision).toBe('ACT');
  });

  it('REJECT: incompatible current System State', () => {
    const candidate = sampleCandidate({ baseRevision: 'system-state:r0' });
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      systemState: { revision: 'system-state:r2' },
    });
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.gates.systemState?.compatible).toBe(false);
    expect(evaluation.reasons.join(' ')).toContain('compatible current System State');
  });

  it('GATHER_EVIDENCE: an INCOMPLETE assurance case blocks promotion', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      assurance: validAssuranceCase({ verdict: 'INCOMPLETE' }),
    });
    expect(evaluation.decision).toBe('GATHER_EVIDENCE');
    expect(evaluation.reasons.join(' ')).toContain('INCOMPLETE');
  });

  it('GATHER_EVIDENCE: an EXPIRED-validity assurance case blocks promotion', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      assurance: validAssuranceCase({ validityStatus: 'EXPIRED' }),
    });
    expect(evaluation.decision).toBe('GATHER_EVIDENCE');
    expect(evaluation.gates.assurance.effective_validity).toBe('EXPIRED');
  });

  it('GATHER_EVIDENCE: a case claiming CURRENT whose expiry passed is truthfully EXPIRED', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      assurance: validAssuranceCase({ validityStatus: 'CURRENT', expiresAt: '2024-12-01T00:00:00.000Z' }),
    });
    expect(evaluation.decision).toBe('GATHER_EVIDENCE');
    expect(evaluation.gates.assurance.effective_validity).toBe('EXPIRED');
    expect(evaluation.reasons.join(' ')).toContain('truthfully evaluated EXPIRED');
  });

  it('REJECT: a REFUTED assurance case rejects promotion', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      assurance: validAssuranceCase({ verdict: 'REFUTED' }),
    });
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.reasons.join(' ')).toContain('REFUTED');
  });

  it('EXPERIMENT: no evidence at all -> run a controlled experiment', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      evidence: [],
    });
    expect(evaluation.decision).toBe('EXPERIMENT');
    expect(evaluation.reasons.join(' ')).toContain('run a controlled experiment');
  });

  it('GATHER_EVIDENCE: intervention evidence exists but is stale', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      evidence: [staleInterventionalEvidence(candidate)],
    });
    expect(evaluation.decision).toBe('GATHER_EVIDENCE');
    expect(evaluation.gates.evidence.satisfied).toBe(false);
    expect(evaluation.gates.evidence.real_interventional_considered).toBe(1);
    expect(evaluation.reasons.join(' ')).toContain('not current');
  });

  it('EXPERIMENT: only observational evidence for a causal candidate -> run an experiment', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      evidence: [interventionalEvidence(candidate, { evidenceClass: 'OBSERVATIONAL' })],
    });
    expect(evaluation.decision).toBe('EXPERIMENT');
    expect(evaluation.reasons.join(' ')).toContain('intervention-grade');
  });

  it('REJECT: simulated records presented as intervention evidence', () => {
    const candidate = sampleCandidate();
    const experiment = sampleExperimentFor(candidate);
    const simulated = simulatedResult(experiment);
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      evidence: [simulated],
    });
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.gates.evidence.rejected_simulated).toHaveLength(1);
    expect(evaluation.reasons.join(' ')).toContain('simulation is evaluation infrastructure');
  });

  it('REJECT: an otherwise-green promotion without a bounded recovery declaration', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      recovery: null,
    });
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.gates.recovery?.declared).toBe(false);
    expect(evaluation.reasons.join(' ')).toContain('bounded recovery');
  });

  it('safety first: a triggered rollback trigger wins over every other gate (precedence)', () => {
    const candidate = sampleCandidate();
    const experiment = sampleExperimentFor(candidate);
    const result = healthyResult(experiment);
    const fired = rollbackTriggersOf(experiment, result).map((trigger) => ({ ...trigger, triggered: true }));
    const evaluation = evaluatePromotion(candidate, {
      ...baseInput(),
      authority: { grant: null, now: T1 }, // would be REJECT...
      liveTriggers: fired, // ...but ROLLBACK wins
    });
    expect(evaluation.decision).toBe('ROLLBACK');
  });

  it('every produced decision is one of the frozen six from @sos-2/authority', () => {
    const candidate = sampleCandidate();
    const inputs: PromotionInput[] = [
      baseInput(),
      { ...baseInput(), authority: { grant: null, now: T1 } },
      { ...baseInput(), assurance: validAssuranceCase({ verdict: 'INCOMPLETE' }) },
      { ...baseInput(), evidence: [] },
      { ...baseInput(), recovery: null },
    ];
    for (const input of inputs) {
      const evaluation = evaluatePromotion(candidate, input);
      expect((DECISION_ACTIONS as readonly string[]).includes(evaluation.decision)).toBe(true);
    }
    expect(DECISION_ACTIONS).toEqual(['ACT', 'EXPERIMENT', 'GATHER_EVIDENCE', 'ASK', 'REJECT', 'ROLLBACK']);
  });
});

// Sanity: the Constitution anchor fixture is consumed, never invented.
expect(CONSTITUTION_ANCHOR_ID).toMatch(/^sos:\/\/Constitution\/[0-9a-f]{32}$/);
