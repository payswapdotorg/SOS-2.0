/**
 * THE CANDIDATE / ASSURANCE / EXPERIMENT / ASK DECISION DISCIPLINE (P15
 * Lane A). Drives the frozen SOS decision discipline end-to-end through
 * the merged @sos-2/promotion gate + @sos-2/experiments candidate +
 * @sos-2/evidence + @sos-2/authority surfaces:
 *
 *   candidate (the change hypothesis)
 *     -> assurance (the safety case)
 *     -> experiment (the controlled evaluation)
 *     -> ASK / ACT / ROLLBACK / REJECT (the decision)
 *
 * The journey asserts the P15 acceptance shape:
 *   (a) composition: every step driven through merged public exports
 *       (no internal package mutation, no fabricated authority).
 *   (b) terminal state: a typed DecisionAction (one of ACT / ROLLBACK /
 *       ASK / REJECT) per scenario.
 *   (c) evidence graph: every decision record carries provenance + an
 *       exact authority_ref + the candidate envelope id + the
 *       assurance-case id + the experiment-result evidence refs.
 *   (d) retained uncertainty: VISIBLE — every REJECT/ASK records the
 *       missing gate explicitly (no silent gating).
 *   (e) the same inputs reproduce the same decision bit-exactly
 *       (determinism).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createGrant, revokeGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import {
  createCandidateState,
  createExperiment,
  createExperimentResult,
  evaluateExperimentResult,
  simulateExperiment,
} from '@sos-2/experiments';
import type { CandidateStateFixture, ExperimentResultRecord, TriggerRecord } from '@sos-2/experiments';
import { evaluatePromotion } from '@sos-2/promotion';
import type {
  AssuranceCaseFixture,
  BoundedRecoveryDeclaration,
  PromotionEvaluation,
} from '@sos-2/promotion';
import { deriveDeterministicArtifactId, canonicalSerialize } from '@sos-2/semantic-spine';

/** Constitution anchor id (the same anchor the merged promotion tests use — read from the W0.5 golden fixture). */
const here = dirname(fileURLToPath(import.meta.url));
const CONSTITUTION_ANCHOR_ID: string = (
  JSON.parse(readFileSync(join(here, '../../../packages/semantic-spine/fixtures/artifact-envelope.json'), 'utf8')) as {
    authority_ref: string;
  }
).authority_ref;

/** Deterministic scenario instants (RFC3339). */
const T0 = '2026-03-01T00:00:00.000Z';
const T1 = '2026-03-02T00:00:00.000Z';
const T2 = '2026-03-05T00:00:00.000Z';
const T_PAST = '2026-02-01T00:00:00.000Z';

const PROVENANCE = ['P15:decision-discipline'];
const HYPOTHESIS_ID = deriveDeterministicArtifactId('CausalHypothesis', {
  note: 'p15a decision discipline hypothesis',
  claim: 'write-through cache drops p99 read latency below 200ms',
});

/** A producer record (tool-produced, non-LLM — never authoritative). */
function toolProducer() {
  return {
    tool: 'sos-p15a-decision-discipline',
    tool_version: '0.1.0',
    model: null,
    model_version: null,
    command: 'pnpm --filter @sos-2/tests-product-dogfood exec vitest run',
    environment: 'ci:local',
  };
}

/** The golden candidate fixture (causal claim on the write-through cache). */
function sampleCandidate(): CandidateStateFixture {
  return createCandidateState({
    content: {
      invariants: ['p99 read latency stays below 500ms', 'no data loss on cache eviction'],
      predicted_effects: ['p99 read latency drops below 200ms', 'primary datastore read QPS falls'],
      causal_claim: true,
      confidence: null,
      base_subject_revision: 'system-state:r1',
      hypothesis_ref: HYPOTHESIS_ID,
      bounded_subgraph_ref: null,
      context: { environment: 'production', service: 'checkout' },
    },
    provenance: PROVENANCE,
    created_at: T0,
    authority_ref: CONSTITUTION_ANCHOR_ID,
  });
}

/** A VALID grant covering the candidate with the PROMOTE permission. */
function validGrant(candidate: CandidateStateFixture): AuthorityGrantArtifact {
  return createGrant({
    grantee: 'p15a-decision-discipline',
    scope: { kind: 'KIND', artifact_kind: 'CandidateState' },
    permissions: ['READ', 'PROMOTE'],
    expiry: { kind: 'TIME', at: T2 },
    provenance: PROVENANCE,
    created_at: T0,
    status: 'ACTIVE',
  });
}

/** A well-formed, satisfied, current assurance case. */
function validAssuranceCase(): AssuranceCaseFixture {
  return {
    id: deriveDeterministicArtifactId('AssuranceCase', {
      note: 'p15a decision discipline assurance case',
      claims: 2,
    }),
    claims: [
      { id: 'latency-safety', statement: 'The cache layer preserves the p99 latency safety invariant under load.' },
      { id: 'data-durability', statement: 'No data is lost on cache eviction (write-through discipline).' },
    ],
    verdict: 'SATISFIED',
    validity: {
      status: 'CURRENT',
      expires_at: T2,
      reason: 'assurance case revalidated against the current implementation, dependencies and environment',
    },
  };
}

/** A fresh, interventional, SUCCESS evidence record about the candidate. */
function interventionalEvidence(candidate: CandidateStateFixture): EvidenceRecordW3 {
  return createEvidence({
    kind: 'experiment',
    subject_ref: candidate.envelope.id,
    availability: 'SUCCESS',
    evidence_class: 'INTERVENTIONAL',
    method: 'experiment:controlled-experiment-result',
    provenance: ['experiment:sha256:' + '9'.repeat(64)],
    source_revision: 'git:p15a-decision-discipline-0001',
    deployment_revision: null,
    window: { start: T0, end: T2 },
    subject_revision: 'candidate:v1',
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' },
    producer: toolProducer(),
  });
}

/** The golden experiment artifact for the candidate (SHADOW stage). */
function sampleExperimentFor(candidate: CandidateStateFixture) {
  return createExperiment({
    content: {
      design: {
        kind: 'TREATMENT_CONTROL',
        population: {
          description: 'Checkout read traffic in the production region.',
          unit: 'REQUEST',
          context: { environment: 'production', service: 'checkout' },
        },
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
          { id: 'p99-latency', role: 'PRIMARY', description: 'p99 read latency (ms).', direction: 'DECREASE' },
          {
            id: 'error-rate',
            role: 'GUARDRAIL',
            description: 'Read error rate (fraction) — lower is safer.',
            direction: 'DECREASE',
            guardrail_threshold: 0.01,
          },
        ],
        stopping_criteria: [
          { kind: 'EARLY_SUCCESS', description: 'Stop when the primary metric is satisfied and guardrails hold.' },
        ],
        rollback_criteria: [
          {
            id: 'error-budget',
            guardrail_metric_ids: ['error-rate'],
            description: 'Roll back when the error-rate guardrail is breached or cannot be established.',
          },
        ],
      },
      stage: { phase: 'CONTROLLED_EXPERIMENT', exposure_percent: 100 },
      canary_ladder: [1, 5, 25, 50],
      candidate_ref: candidate.envelope.id,
      hypothesis_ref: HYPOTHESIS_ID,
      producer: toolProducer(),
    },
    provenance: PROVENANCE,
    created_at: T0,
  });
}

/** A healthy experiment result (all green) for the golden experiment. */
function healthyResult(experiment: ReturnType<typeof sampleExperimentFor>): ExperimentResultRecord {
  return createExperimentResult(experiment, {
    experiment_id: experiment.envelope.id,
    observed_at: T1,
    sample_size: 5000,
    outcomes: [
      { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
      { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
      { metric_id: 'error-rate', arm_id: 'treatment', value: 0.006, availability: 'SUCCESS' },
    ],
    provenance: PROVENANCE,
    producer: toolProducer(),
  });
}

/** Evaluate and return the rollback trigger records of a live experiment result. */
function rollbackTriggersOf(
  experiment: ReturnType<typeof sampleExperimentFor>,
  result: ExperimentResultRecord,
): TriggerRecord[] {
  return evaluateExperimentResult(experiment, result).rollback;
}

/** A valid bounded recovery declaration wired to the golden experiment's rollback triggers. */
function validRecovery(
  experiment: ReturnType<typeof sampleExperimentFor>,
  triggers: TriggerRecord[],
): BoundedRecoveryDeclaration {
  return {
    mechanism: 'Feature-flag kill switch reverting to the direct-read path; stateless components, no data migration.',
    max_recovery_seconds: 30,
    containment_exception: null,
    rollback_triggers: triggers.map((trigger) => ({
      experiment_id: experiment.envelope.id,
      trigger,
    })),
    authority_ref: null,
  };
}

describe('P15 Lane A — candidate / assurance / experiment / ASK decision discipline', () => {
  it('ACT path: candidate + assurance + experiment + valid authority -> ACT (all gates pass)', () => {
    const candidate = sampleCandidate();
    const experiment = sampleExperimentFor(candidate);
    const result = healthyResult(experiment);
    const triggers = rollbackTriggersOf(experiment, result);

    const evaluation = evaluatePromotion(candidate, {
      authority: { grant: validGrant(candidate), now: T1 },
      assurance: validAssuranceCase(),
      evidence: [interventionalEvidence(candidate)],
      liveTriggers: triggers,
      systemState: { revision: 'system-state:r1' },
      recovery: validRecovery(experiment, triggers),
      provenance: PROVENANCE,
      created_at: T1,
    });

    expect(evaluation.decision).toBe('ACT');
    expect(evaluation.record.content.action).toBe('ACT');
    // Evidence graph: the decision record carries the candidate + grant + assurance + evidence refs.
    expect(evaluation.record.content.candidate_ref).toBe(candidate.envelope.id);
    expect(evaluation.record.content.authority_grant_ref).toBeTruthy();
    expect(evaluation.record.content.assurance_case_ref).toBe(validAssuranceCase().id);
    expect(evaluation.record.content.evidence_refs.length).toBeGreaterThan(0);
    // Provenance retained.
    expect(evaluation.record.envelope.provenance).toContain('P15:decision-discipline');
    // Reasons are non-empty (every gate explains its pass).
    expect(evaluation.record.content.reasons.length).toBeGreaterThan(0);
  });

  it('ASK path: candidate + revision-bound-to-OTHER grant -> ASK (authority evaluation is INDETERMINATE — ask the granting authority)', () => {
    const candidate = sampleCandidate();
    const experiment = sampleExperimentFor(candidate);
    const result = healthyResult(experiment);
    const triggers = rollbackTriggersOf(experiment, result);

    // A grant revision-bound to a DIFFERENT artifact than the candidate: the
    // authority evaluation is INDETERMINATE (the gate cannot decide whether
    // this grant covers the candidate) — ASK is the honest escalation,
    // never a silent gating (R16).
    const otherArtifactId = deriveDeterministicArtifactId('Mission', {
      note: 'p15a decision discipline — the OTHER artifact the grant is bound to',
    });
    const indeterminateGrant = createGrant({
      grantee: 'p15a-decision-discipline',
      scope: { kind: 'KIND', artifact_kind: 'CandidateState' },
      permissions: ['READ', 'PROMOTE'],
      expiry: { kind: 'REVISION', artifact_id: otherArtifactId, max_version: 1 },
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
    });

    const evaluation = evaluatePromotion(candidate, {
      authority: { grant: indeterminateGrant, now: T1 },
      assurance: validAssuranceCase(),
      evidence: [interventionalEvidence(candidate)],
      liveTriggers: triggers,
      systemState: { revision: 'system-state:r1' },
      recovery: validRecovery(experiment, triggers),
      provenance: PROVENANCE,
      created_at: T1,
    });

    expect(evaluation.decision).toBe('ASK');
    expect(evaluation.record.content.action).toBe('ASK');
    // Retained uncertainty is VISIBLE — the ASK records the indeterminate authority.
    expect(evaluation.record.content.reasons.some((reason) => reason.includes('INDETERMINATE') || reason.includes('authority'))).toBe(true);
    // The candidate + assurance + evidence refs are STILL retained (the ASK preserves them).
    expect(evaluation.record.content.candidate_ref).toBe(candidate.envelope.id);
  });

  it('REJECT path: candidate + assurance + experiment + EXPIRED authority -> REJECT (expired authority is hard reject)', () => {
    const candidate = sampleCandidate();
    const expiredGrant: AuthorityGrantArtifact = (() => {
      const head = validGrant(candidate);
      return revokeGrant(head, {
        at: { kind: 'TIME', now: T1 },
        provenance: ['P15:decision-discipline:revocation'],
        created_at: T1,
      });
    })();
    const experiment = sampleExperimentFor(candidate);
    const result = healthyResult(experiment);
    const triggers = rollbackTriggersOf(experiment, result);

    const evaluation = evaluatePromotion(candidate, {
      authority: { grant: expiredGrant, now: T1 },
      assurance: validAssuranceCase(),
      evidence: [interventionalEvidence(candidate)],
      liveTriggers: triggers,
      systemState: { revision: 'system-state:r1' },
      recovery: validRecovery(experiment, triggers),
      provenance: PROVENANCE,
      created_at: T1,
    });

    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.record.content.action).toBe('REJECT');
    // Retained uncertainty is VISIBLE — REJECT records the expired authority gate.
    expect(evaluation.record.content.reasons.some((reason) => reason.includes('authority'))).toBe(true);
  });

  it('ROLLBACK path: candidate + assurance + experiment + guardrail-breach -> ROLLBACK (live triggers fire)', () => {
    const candidate = sampleCandidate();
    const experiment = sampleExperimentFor(candidate);
    // A degraded result: the error-rate guardrail is breached (treatment error-rate > 1%).
    const degradedResult = createExperimentResult(experiment, {
      experiment_id: experiment.envelope.id,
      observed_at: T1,
      sample_size: 5000,
      outcomes: [
        { metric_id: 'p99-latency', arm_id: 'control', value: 240, availability: 'SUCCESS' },
        { metric_id: 'p99-latency', arm_id: 'treatment', value: 180, availability: 'SUCCESS' },
        { metric_id: 'error-rate', arm_id: 'control', value: 0.005, availability: 'SUCCESS' },
        { metric_id: 'error-rate', arm_id: 'treatment', value: 0.05, availability: 'SUCCESS' }, // 5% — guardrail breaches
      ],
      provenance: PROVENANCE,
      producer: toolProducer(),
    });
    const triggers = evaluateExperimentResult(experiment, degradedResult).rollback;

    const evaluation = evaluatePromotion(candidate, {
      authority: { grant: validGrant(candidate), now: T1 },
      assurance: validAssuranceCase(),
      evidence: [interventionalEvidence(candidate)],
      liveTriggers: triggers,
      systemState: { revision: 'system-state:r1' },
      recovery: validRecovery(experiment, triggers),
      provenance: PROVENANCE,
      created_at: T1,
    });

    expect(evaluation.decision).toBe('ROLLBACK');
    expect(evaluation.record.content.action).toBe('ROLLBACK');
    // The ROLLBACK decision is never silent: the decision record carries
    // non-empty reasons explaining why (the guardrail gate's verdict).
    expect(evaluation.record.content.reasons.length).toBeGreaterThan(0);
    // The candidate is retained (the ROLLBACK preserves the candidate ref).
    expect(evaluation.record.content.candidate_ref).toBe(candidate.envelope.id);
  });

  it('every decision record carries exact-revision provenance + the authority_ref + the candidate envelope id (evidence graph)', () => {
    const candidate = sampleCandidate();
    const experiment = sampleExperimentFor(candidate);
    const result = healthyResult(experiment);
    const triggers = rollbackTriggersOf(experiment, result);
    const grant = validGrant(candidate);
    const assurance = validAssuranceCase();
    const evidence = interventionalEvidence(candidate);

    const evaluation = evaluatePromotion(candidate, {
      authority: { grant, now: T1 },
      assurance,
      evidence: [evidence],
      liveTriggers: triggers,
      systemState: { revision: 'system-state:r1' },
      recovery: validRecovery(experiment, triggers),
      provenance: PROVENANCE,
      created_at: T1,
    });

    // The decision record is content-addressed by its envelope id.
    expect(evaluation.record.envelope.id).toMatch(/^sos:\/\/Decision\//);
    // The authority_ref of the decision envelope is a well-formed artifact id (no authority fabricated).
    expect(evaluation.record.envelope.authority_ref).toMatch(/^sos:\/\/[A-Za-z]+\/[0-9a-f]{32,}$/);
    // Every consequential reference is linked (candidate + grant + assurance + evidence).
    expect(evaluation.record.content.candidate_ref).toBe(candidate.envelope.id);
    expect(evaluation.record.content.authority_grant_ref).toBe(grant.envelope.id);
    expect(evaluation.record.content.assurance_case_ref).toBe(assurance.id);
    expect(evaluation.record.content.evidence_refs).toContain(evidence.id);
  });

  it('reproduces the same decision bit-exactly across runs (determinism)', () => {
    const runOnce = (): PromotionEvaluation => {
      const candidate = sampleCandidate();
      const experiment = sampleExperimentFor(candidate);
      const result = healthyResult(experiment);
      const triggers = rollbackTriggersOf(experiment, result);
      return evaluatePromotion(candidate, {
        authority: { grant: validGrant(candidate), now: T1 },
        assurance: validAssuranceCase(),
        evidence: [interventionalEvidence(candidate)],
        liveTriggers: triggers,
        systemState: { revision: 'system-state:r1' },
        recovery: validRecovery(experiment, triggers),
        provenance: PROVENANCE,
        created_at: T1,
      });
    };
    const first = runOnce();
    const second = runOnce();
    expect(canonicalSerialize(second.record)).toBe(canonicalSerialize(first.record));
    expect(second.record.envelope.id).toBe(first.record.envelope.id);
  });

  it('the simulated experiment result is honestly SIMULATED (never presented as live evidence)', () => {
    const candidate = sampleCandidate();
    const experiment = sampleExperimentFor(candidate);
    const simEffects = [
      { arm_id: 'control', metric_id: 'p99-latency', true_mean: 240, noise_std: 1 },
      { arm_id: 'treatment', metric_id: 'p99-latency', true_mean: 180, noise_std: 1 },
      { arm_id: 'control', metric_id: 'error-rate', true_mean: 0.005, noise_std: 0.0001 },
      { arm_id: 'treatment', metric_id: 'error-rate', true_mean: 0.006, noise_std: 0.0001 },
    ];
    const simulated = simulateExperiment({
      experiment,
      effects: simEffects,
      seed: 424242,
      samples_per_arm: 100,
      observed_at: T1,
      provenance: PROVENANCE,
      producer: toolProducer(),
    });
    // The simulated result is content-addressed and reproducible for the same seed.
    expect(simulated.id).toMatch(/^sos:\/\/Evaluation\//);
    expect(simulated.simulated).toBe(true);
    expect(simulated.simulator).not.toBeNull();
    expect(simulated.simulator!.seed).toBe(424242);
    // Re-running with the same seed reproduces the SAME result (determinism).
    const resim = simulateExperiment({
      experiment,
      effects: simEffects,
      seed: 424242,
      samples_per_arm: 100,
      observed_at: T1,
      provenance: PROVENANCE,
      producer: toolProducer(),
    });
    expect(canonicalSerialize(resim)).toBe(canonicalSerialize(simulated));
  });
});
