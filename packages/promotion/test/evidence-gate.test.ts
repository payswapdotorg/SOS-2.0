import { describe, expect, it } from 'vitest';
import { evaluateEvidenceGate } from '../src/index.js';
import {
  interventionalEvidence,
  llmEvidence,
  observationalEvidence,
  sampleCandidate,
  sampleExperimentFor,
  simulatedResult,
  staleInterventionalEvidence,
  T1,
} from './helpers.js';

describe('the promotion evidence gate (intervention-grade, fresh, never simulated)', () => {
  it('satisfied by a fresh interventional SUCCESS record about the candidate', () => {
    const candidate = sampleCandidate();
    const record = interventionalEvidence(candidate);
    const evaluation = evaluateEvidenceGate(candidate, [record], T1);
    expect(evaluation.satisfied).toBe(true);
    expect(evaluation.satisfying).toEqual([record.id]);
    expect(evaluation.requires).toBe('INTERVENTIONAL');
  });

  it('observational records never satisfy a causal candidate (spec §18)', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluateEvidenceGate(candidate, [observationalEvidence(candidate)], T1);
    expect(evaluation.satisfied).toBe(false);
    expect(evaluation.real_interventional_considered).toBe(0);
    expect(evaluation.reasons.join(' ')).toContain('OBSERVATIONAL');
  });

  it('stale (expired window) intervention evidence is not current', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluateEvidenceGate(candidate, [staleInterventionalEvidence(candidate)], T1);
    expect(evaluation.satisfied).toBe(false);
    expect(evaluation.reasons.join(' ')).toContain('EXPIRED_TIME_WINDOW');
  });

  it('UNAVAILABLE intervention evidence is never counted as satisfying', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluateEvidenceGate(
      candidate,
      [interventionalEvidence(candidate, { availability: 'UNAVAILABLE' })],
      T1,
    );
    expect(evaluation.satisfied).toBe(false);
    expect(evaluation.reasons.join(' ')).toContain('UNAVAILABLE');
  });

  it('evidence about a DIFFERENT subject is not counted (subject binding)', () => {
    const candidate = sampleCandidate();
    const other = sampleCandidate({ baseRevision: 'system-state:r9' });
    const evaluation = evaluateEvidenceGate(
      candidate,
      [interventionalEvidence(candidate, { subject: other.envelope.id })],
      T1,
    );
    expect(evaluation.satisfied).toBe(false);
    expect(evaluation.reasons.join(' ')).toContain('not the candidate');
  });

  it('simulated records are rejected loudly and never satisfy intervention requirements', () => {
    const candidate = sampleCandidate();
    const experiment = sampleExperimentFor(candidate);
    const simulated = simulatedResult(experiment);
    const evaluation = evaluateEvidenceGate(candidate, [simulated], T1);
    expect(evaluation.satisfied).toBe(false);
    expect(evaluation.rejected_simulated).toEqual([simulated.id]);
    expect(evaluation.reasons.join(' ')).toContain('never satisfies intervention evidence requirements');
    expect(evaluation.real_interventional_considered).toBe(0);
  });

  it('a mixed set: simulated records are rejected while the real record satisfies', () => {
    const candidate = sampleCandidate();
    const experiment = sampleExperimentFor(candidate);
    const real = interventionalEvidence(candidate);
    const evaluation = evaluateEvidenceGate(candidate, [simulatedResult(experiment), real], T1);
    expect(evaluation.satisfied).toBe(true);
    expect(evaluation.satisfying).toEqual([real.id]);
    expect(evaluation.rejected_simulated).toHaveLength(1);
  });

  it('LLM-produced evidence is never authoritative (llm_output rejects)', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluateEvidenceGate(candidate, [llmEvidence(candidate)], T1);
    expect(evaluation.satisfied).toBe(false);
    expect(evaluation.reasons.join(' ')).toContain('LLM-produced');
  });

  it('a non-causal candidate accepts fresh observational evidence (claiming less than intervention grade)', () => {
    const candidate = sampleCandidate({ causalClaim: false });
    const evaluation = evaluateEvidenceGate(candidate, [observationalEvidence(candidate)], T1);
    expect(evaluation.satisfied).toBe(true);
    expect(evaluation.requires).toBe('OBSERVATIONAL_OR_INTERVENTIONAL');
  });

  it('rejects malformed gate input loudly', () => {
    const candidate = sampleCandidate();
    expect(() => evaluateEvidenceGate(candidate, [], 'not-a-timestamp')).toThrow(/RFC3339/);
  });
});
