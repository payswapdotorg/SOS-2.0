/**
 * NEGATIVE tests — the architecture-lock forbidden shortcuts, rejected
 * loudly at the promotion gate (spec/architecture-lock.md: "confidence
 * alone authorizing risky changes", "package promoted after one lucky
 * success"; spec/architecture.md §13/§14/§18).
 */
import { describe, expect, it } from 'vitest';
import { evaluatePromotion } from '../src/index.js';
import type { PromotionInput } from '../src/index.js';
import {
  healthyResult,
  highConfidence,
  interventionalEvidence,
  PROVENANCE,
  rollbackTriggersOf,
  sampleCandidate,
  sampleExperimentFor,
  simulatedResult,
  validAssuranceCase,
  validGrant,
  validRecovery,
  T1,
} from './helpers.js';

function greenInput(): PromotionInput {
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
  };
}

describe('NEGATIVE: confidence alone never authorizes risky changes', () => {
  it('a HIGH-CONFIDENCE candidate without an authority grant is REJECTED', () => {
    const candidate = sampleCandidate({ confidence: highConfidence() });
    const evaluation = evaluatePromotion(candidate, {
      ...greenInput(),
      authority: { grant: null, now: T1 },
    });
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.reasons.join(' ')).toContain('CONFIDENCE IS NOT AUTHORIZATION');
  });

  it('a high-confidence candidate with an EXPIRED grant is still REJECTED', () => {
    const candidate = sampleCandidate({ confidence: highConfidence() });
    const evaluation = evaluatePromotion(candidate, {
      ...greenInput(),
      authority: {
        grant: validGrant(candidate, { expiry: { kind: 'TIME', at: '2024-06-01T00:00:00.000Z' } }),
        now: T1,
      },
    });
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.reasons.join(' ')).toContain('EXPIRED');
  });

  it('confidence never substitutes for evidence either (EXPERIMENT, not ACT)', () => {
    const candidate = sampleCandidate({ confidence: highConfidence() });
    const evaluation = evaluatePromotion(candidate, {
      ...greenInput(),
      evidence: [],
    });
    expect(evaluation.decision).toBe('EXPERIMENT');
    expect(evaluation.decision).not.toBe('ACT');
  });
});

describe('NEGATIVE: simulated evidence never satisfies intervention requirements', () => {
  it('a simulated interventional-style SUCCESS record is REJECTED as intervention evidence', () => {
    const candidate = sampleCandidate();
    const experiment = sampleExperimentFor(candidate);
    const evaluation = evaluatePromotion(candidate, {
      ...greenInput(),
      evidence: [simulatedResult(experiment)],
    });
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.gates.evidence.satisfied).toBe(false);
    expect(evaluation.gates.evidence.rejected_simulated).toHaveLength(1);
    expect(evaluation.reasons.join(' ')).toContain('never satisfies intervention evidence requirements');
  });

  it('simulated records never rescue a stale-evidence promotion either', () => {
    const candidate = sampleCandidate();
    const experiment = sampleExperimentFor(candidate);
    const evaluation = evaluatePromotion(candidate, {
      ...greenInput(),
      evidence: [
        simulatedResult(experiment),
        interventionalEvidence(candidate, { window: { start: '2024-11-01T00:00:00.000Z', end: '2024-12-01T00:00:00.000Z' } }),
      ],
    });
    expect(evaluation.decision).toBe('GATHER_EVIDENCE');
    expect(evaluation.gates.evidence.satisfying).toHaveLength(0);
  });
});

describe('NEGATIVE: unknown guardrails are never treated as success', () => {
  it('a live experiment with an UNKNOWN guardrail produces a triggered rollback trigger -> ROLLBACK (never ACT)', () => {
    const candidate = sampleCandidate();
    const experiment = sampleExperimentFor(candidate);
    const unknownGuardrail = simulatedResult(experiment, { 'error-rate': 'UNKNOWN' });
    const triggers = rollbackTriggersOf(experiment, unknownGuardrail);
    expect(triggers[0]!.triggered).toBe(true);
    const evaluation = evaluatePromotion(candidate, {
      ...greenInput(),
      liveTriggers: triggers,
    });
    expect(evaluation.decision).toBe('ROLLBACK');
    expect(evaluation.decision).not.toBe('ACT');
  });

  it('an UNAVAILABLE guardrail is likewise fail-closed (ROLLBACK, never ACT)', () => {
    const candidate = sampleCandidate();
    const experiment = sampleExperimentFor(candidate);
    const unavailable = simulatedResult(experiment, { 'error-rate': 'UNAVAILABLE' });
    const triggers = rollbackTriggersOf(experiment, unavailable);
    const evaluation = evaluatePromotion(candidate, {
      ...greenInput(),
      liveTriggers: triggers,
    });
    expect(evaluation.decision).toBe('ROLLBACK');
  });
});

describe('NEGATIVE: invalid assurance blocks promotion', () => {
  it('a structurally malformed assurance case is REJECTED', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, {
      ...greenInput(),
      assurance: { nonsense: true } as never,
    });
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.gates.assurance.structurally_valid).toBe(false);
  });

  it('a null assurance case is REJECTED (never assumed valid)', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, {
      ...greenInput(),
      assurance: null,
    });
    expect(evaluation.decision).toBe('REJECT');
  });

  it('a VIOLATED-validity case blocks promotion (GATHER_EVIDENCE)', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, {
      ...greenInput(),
      assurance: validAssuranceCase({ validityStatus: 'VIOLATED' }),
    });
    expect(evaluation.decision).toBe('GATHER_EVIDENCE');
    expect(evaluation.decision).not.toBe('ACT');
  });

  it('a SUPERSEDED-validity case blocks promotion', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, {
      ...greenInput(),
      assurance: validAssuranceCase({ validityStatus: 'SUPERSEDED' }),
    });
    expect(evaluation.decision).toBe('GATHER_EVIDENCE');
  });
});

describe('NEGATIVE: malformed gate inputs fail loudly', () => {
  it('rejects a malformed authority block', () => {
    const candidate = sampleCandidate();
    expect(() =>
      evaluatePromotion(candidate, { ...greenInput(), authority: { grant: null, now: 'nope' } as never }),
    ).toThrow(/RFC3339/);
  });

  it('rejects malformed live trigger records', () => {
    const candidate = sampleCandidate();
    expect(() =>
      evaluatePromotion(candidate, {
        ...greenInput(),
        liveTriggers: [{ kind: 'ROLLBACK' } as never],
      }),
    ).toThrow(/TriggerRecord/);
  });

  it('rejects a structurally invalid candidate fixture before evaluating gates', () => {
    const evaluation = evaluatePromotion({ not: 'a-candidate' } as never, greenInput());
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.reasons.join(' ')).toContain('structurally invalid');
  });

  it('rejects an invalid recovery declaration on the ACT path', () => {
    const candidate = sampleCandidate();
    const experiment = sampleExperimentFor(candidate);
    const result = healthyResult(experiment);
    const brokenRecovery = validRecovery(experiment, rollbackTriggersOf(experiment, result));
    (brokenRecovery as { max_recovery_seconds: number }).max_recovery_seconds = -1;
    const evaluation = evaluatePromotion(candidate, {
      ...greenInput(),
      recovery: brokenRecovery,
    });
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.gates.recovery?.valid).toBe(false);
  });
});
