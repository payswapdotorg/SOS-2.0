import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { DECISION_ACTIONS } from '@sos-2/authority';
import { evaluatePromotion, validatePromotionDecision } from '../src/index.js';
import type { PromotionInput } from '../src/index.js';
import {
  healthyResult,
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

const fcFlags = fc.record({
  grant: fc.constantFrom<'valid' | 'none' | 'expired' | 'revoked'>('valid', 'none', 'expired', 'revoked'),
  verdict: fc.constantFrom<'SATISFIED' | 'REFUTED' | 'INCOMPLETE'>('SATISFIED', 'REFUTED', 'INCOMPLETE'),
  validity: fc.constantFrom<'CURRENT' | 'EXPIRED' | 'SUPERSEDED' | 'VIOLATED'>(
    'CURRENT',
    'EXPIRED',
    'SUPERSEDED',
    'VIOLATED',
  ),
  evidence: fc.constantFrom<'fresh' | 'stale' | 'observational' | 'none' | 'simulated'>(
    'fresh',
    'stale',
    'observational',
    'none',
    'simulated',
  ),
  recovery: fc.boolean(),
  systemStateMatch: fc.boolean(),
  liveRollbackFired: fc.boolean(),
});

function buildInput(flags: {
  grant: 'valid' | 'none' | 'expired' | 'revoked';
  verdict: 'SATISFIED' | 'REFUTED' | 'INCOMPLETE';
  validity: 'CURRENT' | 'EXPIRED' | 'SUPERSEDED' | 'VIOLATED';
  evidence: 'fresh' | 'stale' | 'observational' | 'none' | 'simulated';
  recovery: boolean;
  systemStateMatch: boolean;
  liveRollbackFired: boolean;
}): PromotionInput {
  const candidate = sampleCandidate();
  const experiment = sampleExperimentFor(candidate);
  const result = healthyResult(experiment);
  const grant =
    flags.grant === 'valid'
      ? validGrant(candidate)
      : flags.grant === 'expired'
        ? validGrant(candidate, { expiry: { kind: 'TIME', at: '2024-06-01T00:00:00.000Z' } })
        : null;
  const evidence =
    flags.evidence === 'fresh'
      ? [interventionalEvidence(candidate)]
      : flags.evidence === 'stale'
        ? [
            interventionalEvidence(candidate, {
              window: { start: '2024-11-01T00:00:00.000Z', end: '2024-12-01T00:00:00.000Z' },
            }),
          ]
        : flags.evidence === 'observational'
          ? [interventionalEvidence(candidate, { evidenceClass: 'OBSERVATIONAL' })]
          : flags.evidence === 'simulated'
            ? [simulatedResult(experiment)]
            : [];
  const triggers = rollbackTriggersOf(experiment, result).map((trigger) => ({
    ...trigger,
    triggered: flags.liveRollbackFired ? true : trigger.triggered,
  }));
  return {
    authority: { grant, now: T1 },
    assurance: validAssuranceCase({ verdict: flags.verdict, validityStatus: flags.validity }),
    evidence,
    liveTriggers: triggers,
    systemState: { revision: flags.systemStateMatch ? 'system-state:r1' : 'system-state:r42' },
    recovery: flags.recovery ? validRecovery(experiment, rollbackTriggersOf(experiment, result)) : null,
    provenance: PROVENANCE,
    created_at: T1,
  };
}

describe('property: the promotion gate is deterministic and total', () => {
  it('every randomized input produces exactly one of the frozen six, a valid Decision record and stable reasons', () => {
    fc.assert(
      fc.property(fcFlags, (flags) => {
        const candidate = sampleCandidate();
        const input = buildInput(flags);
        const first = evaluatePromotion(candidate, input);
        const second = evaluatePromotion(candidate, input);
        expect((DECISION_ACTIONS as readonly string[]).includes(first.decision)).toBe(true);
        expect(first.decision).toBe(second.decision);
        expect(first.reasons).toEqual(second.reasons);
        expect(first.record.envelope.id).toBe(second.record.envelope.id);
        expect(validatePromotionDecision(first.record)).toBe(true);
        expect(first.reasons.length).toBeGreaterThan(0);
        return true;
      }),
      { numRuns: 60 },
    );
  });

  it('ACT is reachable ONLY on the fully-green path (authority + assurance + evidence + system state + recovery)', () => {
    fc.assert(
      fc.property(fcFlags, (flags) => {
        const candidate = sampleCandidate();
        const evaluation = evaluatePromotion(candidate, buildInput(flags));
        if (evaluation.decision === 'ACT') {
          expect(flags.grant).toBe('valid');
          expect(flags.verdict).toBe('SATISFIED');
          expect(flags.validity).toBe('CURRENT');
          expect(flags.evidence).toBe('fresh');
          expect(flags.recovery).toBe(true);
          expect(flags.systemStateMatch).toBe(true);
          expect(flags.liveRollbackFired).toBe(false);
          expect(evaluation.record.content.recovery).not.toBeNull();
        }
        return true;
      }),
      { numRuns: 60 },
    );
  });

  it('the decision record round trips canonically', () => {
    fc.assert(
      fc.property(fcFlags, (flags) => {
        const candidate = sampleCandidate();
        const evaluation = evaluatePromotion(candidate, buildInput(flags));
        const text = canonicalSerialize(evaluation.record);
        expect(canonicalSerialize(JSON.parse(text))).toBe(text);
        return true;
      }),
      { numRuns: 40 },
    );
  });
});
