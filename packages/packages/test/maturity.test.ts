import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MATURITY_TRANSITIONS,
  assertMaturityPromotion,
  canTransitionMaturity,
  evaluateMaturityPromotion,
  isOneLuckySuccess,
  isTerminalMaturity,
  isValidatedMaturity,
  MATURITY_PROMOTION_REQUIREMENTS,
  MATURITY_RANK,
  summarizeEvidenceSet,
  transitionMaturity,
} from '../src/index.js';
import type { EvidenceRecordW3, PromotionGateInput } from '../src/index.js';
import {
  comparativeEvidence,
  failureEvidence,
  interventionalEvidence,
  successEvidence,
  transferEvidence,
  unclassifiedEvidence,
} from './helpers.js';

function gateInput(
  from: PromotionGateInput['from'],
  to: PromotionGateInput['to'],
  records: EvidenceRecordW3[],
  extra: Partial<PromotionGateInput> = {},
): PromotionGateInput {
  return {
    from,
    to,
    evidence_refs: records.map((record) => record.id),
    evidence: records,
    hasRealizations: true,
    hasCalibratedApplicability: false,
    superseded_by: null,
    ...extra,
  };
}

describe('maturity transition table (strict lifecycle)', () => {
  it('allows exactly the documented strict transitions', () => {
    expect(ALLOWED_MATURITY_TRANSITIONS.DISCOVERED).toEqual(['FORMING', 'RETIRED']);
    expect(ALLOWED_MATURITY_TRANSITIONS.FORMING).toEqual(['VALIDATED', 'RETIRED']);
    expect(ALLOWED_MATURITY_TRANSITIONS.VALIDATED).toEqual(['MATURE', 'SUPERSEDED', 'RETIRED']);
    expect(ALLOWED_MATURITY_TRANSITIONS.MATURE).toEqual(['CONTEXTUALIZED', 'SUPERSEDED', 'RETIRED']);
    expect(ALLOWED_MATURITY_TRANSITIONS.CONTEXTUALIZED).toEqual(['SUPERSEDED', 'RETIRED']);
    expect(ALLOWED_MATURITY_TRANSITIONS.SUPERSEDED).toEqual([]);
    expect(ALLOWED_MATURITY_TRANSITIONS.RETIRED).toEqual([]);
  });

  it('REJECTS skipping stages (DISCOVERED -> VALIDATED)', () => {
    expect(canTransitionMaturity('DISCOVERED', 'VALIDATED')).toBe(false);
    expect(() => transitionMaturity('DISCOVERED', 'VALIDATED')).toThrow(/strict lifecycle/);
    expect(() => transitionMaturity('DISCOVERED', 'MATURE')).toThrow(/strict lifecycle/);
    expect(() => transitionMaturity('FORMING', 'MATURE')).toThrow(/strict lifecycle/);
    expect(() => transitionMaturity('VALIDATED', 'CONTEXTUALIZED')).toThrow(/strict lifecycle/);
  });

  it('REJECTS going backwards and leaving terminal states', () => {
    expect(() => transitionMaturity('VALIDATED', 'FORMING')).toThrow(/strict lifecycle/);
    expect(() => transitionMaturity('MATURE', 'VALIDATED')).toThrow(/strict lifecycle/);
    expect(() => transitionMaturity('SUPERSEDED', 'FORMING')).toThrow(/terminal/);
    expect(() => transitionMaturity('RETIRED', 'DISCOVERED')).toThrow(/terminal/);
  });

  it('REJECTS unknown maturity values', () => {
    expect(() => transitionMaturity('BLOOMING' as never, 'FORMING')).toThrow(/frozen vocabulary/);
    expect(() => transitionMaturity('FORMING', 'DEPRECATED' as never)).toThrow(/frozen vocabulary/);
  });

  it('ranks and classifies the live vs terminal states', () => {
    expect(MATURITY_RANK.DISCOVERED).toBeLessThan(MATURITY_RANK.FORMING);
    expect(MATURITY_RANK.FORMING).toBeLessThan(MATURITY_RANK.VALIDATED);
    expect(MATURITY_RANK.VALIDATED).toBeLessThan(MATURITY_RANK.MATURE);
    expect(MATURITY_RANK.MATURE).toBeLessThan(MATURITY_RANK.CONTEXTUALIZED);
    expect(isValidatedMaturity('VALIDATED')).toBe(true);
    expect(isValidatedMaturity('CONTEXTUALIZED')).toBe(true);
    expect(isValidatedMaturity('FORMING')).toBe(false);
    expect(isTerminalMaturity('SUPERSEDED')).toBe(true);
    expect(isTerminalMaturity('RETIRED')).toBe(true);
    expect(isTerminalMaturity('MATURE')).toBe(false);
  });

  it('the frozen requirements match the documented gates', () => {
    expect(MATURITY_PROMOTION_REQUIREMENTS.FORMING_TO_VALIDATED.rejectOneLuckySuccess).toBe(true);
    expect(MATURITY_PROMOTION_REQUIREMENTS.FORMING_TO_VALIDATED.requiresRealizations).toBe(true);
    expect(MATURITY_PROMOTION_REQUIREMENTS.MATURE_TO_CONTEXTUALIZED.requiresCalibratedApplicability).toBe(true);
    expect(MATURITY_PROMOTION_REQUIREMENTS.VALIDATED_TO_MATURE.minEvidenceRefs).toBe(4);
    expect(MATURITY_PROMOTION_REQUIREMENTS.VALIDATED_TO_MATURE.minSuccesses).toBe(2);
  });
});

describe('evidence classification (deterministic, normative fields only)', () => {
  it('classifies the seven ecology evidence classes from record fields', async () => {
    const { classifyPackageEvidence } = await import('../src/index.js');
    expect(classifyPackageEvidence(successEvidence())).toBe('OBSERVATIONAL_SUCCESS');
    expect(classifyPackageEvidence(failureEvidence())).toBe('FAILURE');
    expect(classifyPackageEvidence(comparativeEvidence())).toBe('COMPARATIVE');
    expect(classifyPackageEvidence(interventionalEvidence())).toBe('INTERVENTIONAL');
    expect(classifyPackageEvidence(transferEvidence())).toBe('TRANSFER');
    const compositionRun = unclassifiedEvidence();
    // A record with kind 'composition-run' is composition evidence.
    const { makeEvidence } = await import('./helpers.js');
    expect(classifyPackageEvidence(makeEvidence({ kind: 'composition-run' }))).toBe('COMPOSITION');
    expect(classifyPackageEvidence(makeEvidence({ kind: 'longevity-review' }))).toBe('LONGEVITY_DECAY');
    expect(classifyPackageEvidence(unclassifiedEvidence())).toBe('UNCLASSIFIED');
  });

  it('failure retention comes first: a failed interventional record is FAILURE evidence', async () => {
    const { classifyPackageEvidence } = await import('../src/index.js');
    expect(classifyPackageEvidence({ ...interventionalEvidence(), availability: 'FAILURE' })).toBe('FAILURE');
  });

  it('summarizeEvidenceSet counts classes, availability, successes and comparative-or-interventional', () => {
    const records = [
      successEvidence(undefined, 0),
      successEvidence(undefined, 1),
      failureEvidence(),
      comparativeEvidence(),
      interventionalEvidence(),
    ];
    const summary = summarizeEvidenceSet(records);
    expect(summary.total).toBe(5);
    // availability SUCCESS spans classes: 2 plain + the comparative + the
    // interventional record all carry SUCCESS.
    expect(summary.successes).toBe(4);
    expect(summary.failures).toBe(1);
    expect(summary.classCounts.OBSERVATIONAL_SUCCESS).toBe(2);
    expect(summary.classCounts.COMPARATIVE).toBe(1);
    expect(summary.classCounts.INTERVENTIONAL).toBe(1);
    expect(summary.comparativeOrInterventional).toBe(2);
    expect(summary.availabilityCounts.SUCCESS).toBe(4);
    expect(summary.availabilityCounts.FAILURE).toBe(1);
  });

  it('summarizeEvidenceSet is order-independent and rejects non-frozen truth states', () => {
    const a = [successEvidence(), comparativeEvidence()];
    const b = [comparativeEvidence(), successEvidence()];
    expect(summarizeEvidenceSet(a)).toEqual(summarizeEvidenceSet(b));
    expect(() =>
      summarizeEvidenceSet([{ ...successEvidence(), availability: 'MAYBE' as never }]),
    ).toThrow(/frozen 6|outside the frozen 6/);
  });
});

describe('promotion gates (evidence-gated maturity)', () => {
  it('DISCOVERED -> FORMING requires at least one resolvable evidence ref', () => {
    const verdict = evaluateMaturityPromotion(gateInput('DISCOVERED', 'FORMING', [successEvidence()]));
    expect(verdict.allowed).toBe(true);
    expect(verdict.reasons).toEqual([]);
    const none = evaluateMaturityPromotion(gateInput('DISCOVERED', 'FORMING', []));
    expect(none.allowed).toBe(false);
    expect(none.reasons.join(' ')).toMatch(/at least 1 evidence refs/);
  });

  it('REJECTS promotion after ONE LUCKY SUCCESS (the locked forbidden shortcut)', () => {
    // Exactly one SUCCESS evidence, no comparative/intervention evidence.
    const records = [successEvidence()];
    const verdict = evaluateMaturityPromotion(gateInput('FORMING', 'VALIDATED', records));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/one lucky success/);
    expect(() => assertMaturityPromotion(gateInput('FORMING', 'VALIDATED', records))).toThrow(/one lucky success/);
    expect(isOneLuckySuccess(verdict.summary)).toBe(true);
  });

  it('replication escapes the lucky-success regime (2 successes)', () => {
    const records = [successEvidence(undefined, 0), successEvidence(undefined, 1)];
    const verdict = evaluateMaturityPromotion(gateInput('FORMING', 'VALIDATED', records));
    expect(verdict.allowed).toBe(true);
    expect(isOneLuckySuccess(verdict.summary)).toBe(false);
  });

  it('a single comparative study escapes the lucky-success regime', () => {
    const records = [successEvidence(), comparativeEvidence()];
    expect(evaluateMaturityPromotion(gateInput('FORMING', 'VALIDATED', records)).allowed).toBe(true);
  });

  it('a single interventional study escapes the lucky-success regime', () => {
    const records = [successEvidence(), interventionalEvidence()];
    expect(evaluateMaturityPromotion(gateInput('FORMING', 'VALIDATED', records)).allowed).toBe(true);
  });

  it('promotion without ANY evidence is rejected (packages require evidence)', () => {
    const verdict = evaluateMaturityPromotion(gateInput('FORMING', 'VALIDATED', []));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/at least 1 evidence record/);
  });

  it('dangling evidence refs reject the promotion (evidence outranks assertion)', () => {
    const records = [successEvidence(), comparativeEvidence()];
    const verdict = evaluateMaturityPromotion({
      ...gateInput('FORMING', 'VALIDATED', records),
      evidence_refs: [...records.map((record) => record.id), 'sos://Evidence/' + '0'.repeat(32)],
      evidence: records,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/dangling evidence refs/);
    expect(verdict.unresolved_refs).toEqual(['sos://Evidence/' + '0'.repeat(32)]);
  });

  it('FORMING -> VALIDATED requires a realization (validated capabilities are realized)', () => {
    const records = [successEvidence(), comparativeEvidence()];
    const verdict = evaluateMaturityPromotion({
      ...gateInput('FORMING', 'VALIDATED', records),
      hasRealizations: false,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/at least one realization/);
  });

  it('VALIDATED -> MATURE requires sustained + comparative evidence (4 refs, 2 successes, 1 comparative-or-interventional)', () => {
    const weak = [successEvidence(undefined, 0), successEvidence(undefined, 1), comparativeEvidence()];
    expect(evaluateMaturityPromotion(gateInput('VALIDATED', 'MATURE', weak)).allowed).toBe(false);
    const strong = [
      successEvidence(undefined, 0),
      successEvidence(undefined, 1),
      comparativeEvidence(),
      failureEvidence(),
    ];
    const verdict = evaluateMaturityPromotion(gateInput('VALIDATED', 'MATURE', strong));
    expect(verdict.allowed).toBe(true);
    // Failures do not block promotion — they are retained memory.
    expect(verdict.summary.failures).toBe(1);
  });

  it('MATURE -> CONTEXTUALIZED requires a CALIBRATED applicability estimate', () => {
    const strong = [
      successEvidence(undefined, 0),
      successEvidence(undefined, 1),
      comparativeEvidence(),
      failureEvidence(),
    ];
    const without = evaluateMaturityPromotion(gateInput('MATURE', 'CONTEXTUALIZED', strong));
    expect(without.allowed).toBe(false);
    expect(without.reasons.join(' ')).toMatch(/CALIBRATED applicability estimate/);
    const withCalibrated = evaluateMaturityPromotion({
      ...gateInput('MATURE', 'CONTEXTUALIZED', strong),
      hasCalibratedApplicability: true,
    });
    expect(withCalibrated.allowed).toBe(true);
  });

  it('SUPERSEDED is administrative but requires the replacement id', () => {
    const missing = evaluateMaturityPromotion(gateInput('VALIDATED', 'SUPERSEDED', []));
    expect(missing.allowed).toBe(false);
    expect(missing.reasons.join(' ')).toMatch(/superseded_by/);
    const declared = evaluateMaturityPromotion({
      ...gateInput('VALIDATED', 'SUPERSEDED', []),
      superseded_by: 'sos://Package/' + '1'.repeat(32),
    });
    expect(declared.allowed).toBe(true);
  });

  it('RETIRED is administrative (no evidence requirements)', () => {
    const verdict = evaluateMaturityPromotion(gateInput('FORMING', 'RETIRED', []));
    expect(verdict.allowed).toBe(true);
  });

  it('the verdict is a pure deterministic function of its input', () => {
    const records = [successEvidence(), comparativeEvidence()];
    const first = evaluateMaturityPromotion(gateInput('FORMING', 'VALIDATED', records));
    const second = evaluateMaturityPromotion(gateInput('FORMING', 'VALIDATED', records));
    expect(first).toEqual(second);
  });
});
