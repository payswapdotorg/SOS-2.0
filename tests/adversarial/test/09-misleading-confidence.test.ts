/**
 * ADVERSARIAL CLASS 9 — MISLEADING CONFIDENCE (overconfident uncertainty is
 * REJECTED, never authorized).
 *
 * The fault: an LLM-produced record carries a CALIBRATED confidence it
 * cannot legitimately have, and a CAUSAL claim is made over purely
 * observational evidence. The system must REJECT both (typed errors — LLM
 * output is never calibrated truth; strong causal claims require
 * interventional evidence), the decision engine must never let a
 * self-reported confidence authorize a risky change, and the trace chain
 * stays queryable.
 */

import { describe, expect, test } from 'vitest';
import { CausalError, createCausalHypothesis, observationalEvidenceRef } from '@sos-2/causal';
import type { CausalHypothesisContent } from '@sos-2/causal';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { isNonAuthoritativeEvidence } from '@sos-2/evidence';
import { createCandidateState, createExperiment, isSimulatedRecord, simulateExperiment } from '@sos-2/experiments';
import { evaluate } from '@sos-2/decision';
import type { DecisionRequest } from '@sos-2/decision';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { createTraceLink, deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { ADVERSARIAL_ANCHOR, ADVERSARIAL_PROVENANCE, T0, T1, WINDOW, assertTraceQueryable, llmProducer, makeEvidence, subjectId, toolProducer } from './helpers.js';

const CALIBRATION = deriveDeterministicArtifactId('Evaluation', {
  note: 'adversarial-9 legitimate calibration',
  brier_score: 0.08,
});

describe('adversarial class 9: misleading confidence', () => {
  test('an LLM-produced record CANNOT carry CALIBRATED confidence (typed rejection)', () => {
    expect(() =>
      createEvidence({
        kind: 'reasoning-output',
        subject_ref: subjectId('SystemState', 'adversarial-9-state'),
        availability: 'SUCCESS',
        evidence_class: 'OBSERVATIONAL',
        method: 'llm:assessment',
        provenance: ['llm:sha256:' + '9'.repeat(64)],
        window: WINDOW,
        subject_revision: null,
        confidence: { kind: 'CALIBRATED', value: 0.99, calibration_ref: CALIBRATION },
        producer: llmProducer(),
      }),
    ).toThrow(/calibrat/i);
    // The honest form: an LLM producer may carry only qualitative classes.
    const honest = createEvidence({
      kind: 'reasoning-output',
      subject_ref: subjectId('SystemState', 'adversarial-9-state'),
      availability: 'SUCCESS',
      evidence_class: 'OBSERVATIONAL',
      method: 'llm:assessment',
      provenance: ['llm:sha256:' + '8'.repeat(64)],
      window: WINDOW,
      subject_revision: null,
      confidence: { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' },
      producer: llmProducer(),
    });
    expect(honest.llm_output).toBe(true);
    expect(isNonAuthoritativeEvidence(honest)).toBe(true);
  });

  test('a CAUSAL claim over purely observational evidence is REJECTED by the claim gate', () => {
    const subject = subjectId('SystemState', 'adversarial-9-causal-subject');
    const observational: EvidenceRecordW3 = makeEvidence(subject);
    const content: CausalHypothesisContent = {
      statement: 'The cache layer CAUSED the latency drop.',
      claim_strength: 'CAUSAL',
      intervention: { description: 'Enable the cache layer on the read path.', target_ref: subject },
      mechanism: 'Cache hits bypass the datastore round-trip.',
      predicted_outcomes: [{ id: 'p99-drop', description: 'p99 latency falls', metric: 'p99-latency', direction: 'DECREASE' }],
      assumptions: [{ id: 'traffic-stable', statement: 'Traffic is comparable across windows.' }],
      context: { environment: 'production' },
      alternatives: [],
      refutations: [{ id: 'latency-flat', description: 'p99 unchanged with the cache enabled.' }],
      graph: {
        factors: [
          { id: 'cache-enabled', description: 'cache on the read path' },
          { id: 'p99-latency', description: 'observed latency' },
        ],
        edges: [{ type: 'CONTRIBUTES_TO', cause: 'cache-enabled', effect: 'p99-latency' }],
      },
      // ONLY observational evidence — the strong causal claim is overconfidence.
      observational_evidence: [observationalEvidenceRef(observational)],
      interventional_evidence: [],
      uncertainty: { kind: 'QUALITATIVE', uncertainty_class: 'STRONG' },
      producer: toolProducer(),
      correlation_origin: null,
    };
    expect(() =>
      createCausalHypothesis({
        content,
        provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:9:overconfident-causal-claim'],
        created_at: T1,
      }),
    ).toThrow(CausalError);
    // The honest form downgrades to CORRELATIONAL (allowed without intervention).
    const honestContent: CausalHypothesisContent = { ...content, claim_strength: 'CORRELATIONAL' as const };
    const honest = createCausalHypothesis({
      content: honestContent,
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:9:honest-correlational-claim'],
      created_at: T1,
    });
    expect(honest.content.claim_strength).toBe('CORRELATIONAL');
  });

  test('the decision engine NEVER lets confidence authorize risky changes (simulated evidence still rejects)', () => {
    const candidate = createCandidateState({
      content: {
        invariants: ['i'],
        predicted_effects: ['e'],
        causal_claim: true,
        confidence: null,
        base_subject_revision: 'system-state@v1',
        hypothesis_ref: null,
        bounded_subgraph_ref: null,
        context: { environment: 'production' },
      },
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:9:candidate'],
      created_at: T0,
    });
    const experiment = createExperiment({
      content: {
        design: {
          kind: 'TREATMENT_CONTROL',
          population: { description: 'p', unit: 'REQUEST', context: { environment: 'production' } },
          allocation: {
            unit: 'REQUEST',
            assignment: 'RANDOM',
            arms: [
              { id: 'control', role: 'CONTROL', candidate_ref: null },
              { id: 'treatment', role: 'TREATMENT', candidate_ref: candidate.envelope.id },
            ],
            ratios: [1, 1],
          },
          metrics: [
            { id: 'm', role: 'PRIMARY', description: 'primary metric', direction: 'DECREASE' },
            { id: 'g', role: 'GUARDRAIL', description: 'guardrail', direction: 'DECREASE', guardrail_threshold: 0.05 },
          ],
          stopping_criteria: [{ kind: 'MAX_SAMPLES', max_samples: 100 }],
          rollback_criteria: [{ id: 'r', guardrail_metric_ids: ['g'], description: 'rollback on guardrail' }],
        },
        stage: { phase: 'SHADOW', exposure_percent: 0 },
        canary_ladder: [1, 5, 25, 50],
        candidate_ref: candidate.envelope.id,
        hypothesis_ref: subjectId('CausalHypothesis', 'adversarial-9-hypothesis'),
        producer: toolProducer(),
      },
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:9:experiment'],
      created_at: T0,
    });
    const simulated = simulateExperiment({
      experiment,
      effects: [
        { arm_id: 'control', metric_id: 'm', true_mean: 100, noise_std: 1 },
        { arm_id: 'treatment', metric_id: 'm', true_mean: 90, noise_std: 1 },
        { arm_id: 'control', metric_id: 'g', true_mean: 0.01, noise_std: 0.001 },
        { arm_id: 'treatment', metric_id: 'g', true_mean: 0.01, noise_std: 0.001 },
      ],
      seed: 424242,
      samples_per_arm: 50,
      observed_at: T1,
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:9:simulation'],
      producer: toolProducer(),
    });
    expect(simulated.simulated).toBe(true);
    expect(isSimulatedRecord(simulated)).toBe(true);

    // The overconfident request: simulated evidence + a glowing CALIBRATED
    // confidence + a VALID GRANT (so the authority rule passes and the
    // EVIDENCE rule is what decides). The engine must still REJECT —
    // confidence is never consulted, and simulation is never evidence.
    const grant: AuthorityGrantArtifact = createGrant({
      grantee: 'w17-adversarial-runner',
      scope: { kind: 'KIND', artifact_kind: 'CandidateState' },
      permissions: ['READ', 'PROMOTE'],
      expiry: { kind: 'TIME', at: '2025-12-31T00:00:00.000Z' },
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:9:grant'],
      created_at: T0,
      status: 'ACTIVE',
    });
    const request: DecisionRequest = {
      action_kind: 'PROMOTE',
      action_description: 'Promote the candidate despite simulated evidence.',
      target: { kind: 'ARTIFACT', artifact_id: candidate.envelope.id },
      blast_radius: 'SERVICE',
      impact: 'MODERATE',
      risk: 'LOW',
      reversibility: 'REVERSIBLE',
      causal_claim: true,
      uncertainty: { uncertainty_class: 'LOW', basis: 'the glowing self-report' },
      rollback_signals: [],
      evidence: [simulated as unknown as EvidenceRecordW3],
      grants: [grant],
      evaluation_point: { kind: 'TIME', now: T1 },
      explicit_authority_decision_ref: null,
      confidence: { kind: 'CALIBRATED', value: 0.99, calibration_ref: CALIBRATION },
    };
    const evaluation = evaluate(request, {
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:9:decision'],
      created_at: T1,
      status: 'ACTIVE',
    });
    expect(evaluation.action).not.toBe('ACT');
    expect(evaluation.action).toBe('REJECT');
    expect(evaluation.record.content.rule_trace.some((entry) => entry.rule === 'R3_EVIDENCE' && entry.code === 'SIMULATED_EVIDENCE')).toBe(true);
  });

  test('the trace chain stays queryable after the misleading-confidence rejection', () => {
    const honest = makeEvidence(subjectId('SystemState', 'adversarial-9-state-c'));
    const hypothesisId = subjectId('CausalHypothesis', 'adversarial-9-hypothesis-c');
    const links = [
      createTraceLink({
        source: honest.id,
        target: hypothesisId,
        type: 'SUPPORTS',
        provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:9:evidence-supports-hypothesis'],
      }),
    ];
    const { queryFrom, queryTo } = assertTraceQueryable(links);
    expect(queryFrom(honest.id).length).toBe(1);
    expect(queryTo(hypothesisId).length).toBe(1);
  });
});
