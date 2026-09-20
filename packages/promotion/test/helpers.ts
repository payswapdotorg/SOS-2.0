/**
 * Shared test fixtures for @sos-2/promotion tests.
 *
 * - The Constitution anchor id is CONSUMED from the W0.5 golden contract
 *   fixtures (packages/semantic-spine/fixtures).
 * - The candidate is a CandidateState fixture from @sos-2/experiments (the
 *   frozen-kind contract shape — never a hand-invented shape).
 * - Grants are minted through @sos-2/authority's createGrant/revokeGrant.
 * - Evidence records are minted through @sos-2/evidence's createEvidence.
 * - Recovery declarations are wired to REAL guardrail trigger records from
 *   @sos-2/experiments' evaluateExperimentResult.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
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
import type { BoundedRecoveryDeclaration, PromotionEvidenceRecord, AssuranceCaseFixture } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Constitution anchor id from the W0.5 golden fixture artifact-envelope.json. */
export const CONSTITUTION_ANCHOR_ID: string = (
  JSON.parse(readFileSync(join(here, '../../semantic-spine/fixtures/artifact-envelope.json'), 'utf8')) as {
    authority_ref: string;
  }
).authority_ref;

export const PROVENANCE = ['W9:promotion-test'];
export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-01-02T00:00:00.000Z'; // the promotion instant `now`
export const T2 = '2025-01-05T00:00:00.000Z'; // fresh window end (after now)
export const T_PAST = '2024-12-01T00:00:00.000Z'; // stale window end (before now)

/** Deterministic CausalHypothesis id linked to the golden candidate. */
export const HYPOTHESIS_ID = deriveDeterministicArtifactId('CausalHypothesis', {
  note: 'w9 promotion test hypothesis',
  claim: 'write-through cache drops p99',
});

export function toolProducer() {
  return {
    tool: 'sos-promotion',
    tool_version: '0.1.0',
    model: null,
    model_version: null,
    command: 'pnpm -r test',
    environment: 'ci:local',
  };
}

export function llmProducer() {
  return {
    tool: 'promotion-assistant',
    tool_version: null,
    model: 'glm-4.5',
    model_version: '2025.1',
    command: null,
    environment: null,
  };
}

export interface CandidateOptions {
  causalClaim?: boolean;
  confidence?: { kind: 'CALIBRATED'; value: number; calibration_ref: string } | null;
  baseRevision?: string | null;
}

/** The golden candidate fixture (causal claim on the write-through cache). */
export function sampleCandidate(options: CandidateOptions = {}): CandidateStateFixture {
  return createCandidateState({
    content: {
      invariants: ['p99 read latency stays below 500ms', 'no data loss on cache eviction'],
      predicted_effects: ['p99 read latency drops below 200ms', 'primary datastore read QPS falls'],
      causal_claim: options.causalClaim ?? true,
      confidence: options.confidence ?? null,
      base_subject_revision: options.baseRevision ?? 'system-state:r1',
      hypothesis_ref: HYPOTHESIS_ID,
      bounded_subgraph_ref: null,
      context: { environment: 'production', service: 'checkout' },
    },
    provenance: PROVENANCE,
    created_at: T0,
    authority_ref: CONSTITUTION_ANCHOR_ID,
  });
}

/** A calibrated confidence mark for the confidence-is-not-authorization tests. */
export function highConfidence() {
  return {
    kind: 'CALIBRATED' as const,
    value: 0.99,
    calibration_ref: deriveDeterministicArtifactId('Evaluation', {
      note: 'w9 promotion test calibration',
      brier_score: 0.07,
    }),
  };
}

// ---------------------------------------------------------------------------
// Authority grants (minted through @sos-2/authority)
// ---------------------------------------------------------------------------

export interface GrantOptions {
  scope?: { kind: 'KIND'; artifact_kind: string } | { kind: 'ARTIFACT'; artifact_id: string };
  permissions?: string[];
  expiry?: { kind: 'TIME'; at: string } | { kind: 'REVISION'; artifact_id: string; max_version: number };
}

/** A VALID grant covering the candidate with the PROMOTE permission. */
export function validGrant(candidate: CandidateStateFixture, options: GrantOptions = {}): AuthorityGrantArtifact {
  return createGrant({
    grantee: 'w9-promotion-gate',
    scope: options.scope ?? { kind: 'KIND', artifact_kind: 'CandidateState' },
    permissions: options.permissions ?? ['READ', 'PROMOTE'],
    expiry: options.expiry ?? { kind: 'TIME', at: T2 },
    provenance: PROVENANCE,
    created_at: T0,
    status: 'ACTIVE',
  });
}

/** An EXPIRED (time-bound, in the past) grant. */
export function expiredGrant(candidate: CandidateStateFixture): AuthorityGrantArtifact {
  return validGrant(candidate, { expiry: { kind: 'TIME', at: T_PAST } });
}

/** A REVOKED grant (explicit revocation through @sos-2/authority). */
export function revokedGrant(candidate: CandidateStateFixture): AuthorityGrantArtifact {
  const head = validGrant(candidate);
  return revokeGrant(head, {
    at: { kind: 'TIME', now: T1 },
    provenance: ['W9:promotion-test:revocation'],
    created_at: T1,
  });
}

/** A grant scoped to a DIFFERENT kind (scope violation). */
export function scopeMismatchGrant(candidate: CandidateStateFixture): AuthorityGrantArtifact {
  return validGrant(candidate, { scope: { kind: 'KIND', artifact_kind: 'Mission' } });
}

/** A grant WITHOUT the PROMOTE permission. */
export function noPermissionGrant(candidate: CandidateStateFixture): AuthorityGrantArtifact {
  return validGrant(candidate, { permissions: ['READ'] });
}

// ---------------------------------------------------------------------------
// Assurance case fixtures
// ---------------------------------------------------------------------------

export interface AssuranceOptions {
  verdict?: 'SATISFIED' | 'REFUTED' | 'INCOMPLETE';
  validityStatus?: 'CURRENT' | 'EXPIRED' | 'SUPERSEDED' | 'VIOLATED';
  expiresAt?: string | null;
}

/** A well-formed, satisfied, current assurance case. */
export function validAssuranceCase(options: AssuranceOptions = {}): AssuranceCaseFixture {
  return {
    id: deriveDeterministicArtifactId('AssuranceCase', {
      note: 'w9 promotion test assurance case',
      claims: 2,
    }),
    claims: [
      { id: 'latency-safety', statement: 'The cache layer preserves the p99 latency safety invariant under load.' },
      { id: 'data-durability', statement: 'No data is lost on cache eviction (write-through discipline).' },
    ],
    verdict: options.verdict ?? 'SATISFIED',
    validity: {
      status: options.validityStatus ?? 'CURRENT',
      expires_at: options.expiresAt ?? T2,
      reason: 'assurance case revalidated against the current implementation, dependencies and environment',
    },
  };
}

/** An assurance case claiming CURRENT whose expiry has passed (truthfully evaluated EXPIRED). */
export function staleCurrentAssuranceCase(): AssuranceCaseFixture {
  return validAssuranceCase({ validityStatus: 'CURRENT', expiresAt: T_PAST });
}

// ---------------------------------------------------------------------------
// Evidence records (minted through @sos-2/evidence)
// ---------------------------------------------------------------------------

export interface EvidenceOptions {
  evidenceClass?: 'OBSERVATIONAL' | 'INTERVENTIONAL';
  availability?: 'SUCCESS' | 'FAILURE' | 'UNKNOWN' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'PARTIAL';
  window?: { start: string; end: string } | null;
  producer?: ReturnType<typeof toolProducer> | ReturnType<typeof llmProducer>;
  subject?: string;
}

/** A fresh, interventional, SUCCESS evidence record about the candidate. */
export function interventionalEvidence(
  candidate: CandidateStateFixture,
  options: EvidenceOptions = {},
): EvidenceRecordW3 {
  return createEvidence({
    kind: 'experiment',
    subject_ref: options.subject ?? candidate.envelope.id,
    availability: options.availability ?? 'SUCCESS',
    evidence_class: options.evidenceClass ?? 'INTERVENTIONAL',
    method: 'experiment:controlled-experiment-result',
    provenance: ['experiment:sha256:' + '9'.repeat(64)],
    source_revision: 'git:f2f20663d84b55da7dcd7ac34125b2b7ce896e34',
    deployment_revision: null,
    window: options.window ?? { start: T0, end: T2 },
    subject_revision: 'candidate:v1',
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' },
    producer: options.producer ?? toolProducer(),
  });
}

/** A fresh OBSERVATIONAL record about the candidate (correlation only). */
export function observationalEvidence(candidate: CandidateStateFixture): EvidenceRecordW3 {
  return interventionalEvidence(candidate, { evidenceClass: 'OBSERVATIONAL' });
}

/** A stale (closed window) interventional SUCCESS record. */
export function staleInterventionalEvidence(candidate: CandidateStateFixture): EvidenceRecordW3 {
  return interventionalEvidence(candidate, { window: { start: '2024-11-01T00:00:00.000Z', end: T_PAST } });
}

/** An LLM-produced interventional SUCCESS record (never authoritative). */
export function llmEvidence(candidate: CandidateStateFixture): EvidenceRecordW3 {
  return interventionalEvidence(candidate, { producer: llmProducer() });
}

// ---------------------------------------------------------------------------
// Experiment trigger records + simulated results (from @sos-2/experiments)
// ---------------------------------------------------------------------------

/** The golden experiment artifact for the candidate (SHADOW stage). */
export function sampleExperimentFor(candidate: CandidateStateFixture) {
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
export function healthyResult(experiment: ReturnType<typeof sampleExperimentFor>): ExperimentResultRecord {
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
export function rollbackTriggersOf(
  experiment: ReturnType<typeof sampleExperimentFor>,
  result: ExperimentResultRecord,
): TriggerRecord[] {
  return evaluateExperimentResult(experiment, result).rollback;
}

/** A SIMULATED result record (evaluation infrastructure, never evidence). */
export function simulatedResult(
  experiment: ReturnType<typeof sampleExperimentFor>,
  overrides?: Record<string, string>,
): ExperimentResultRecord {
  return simulateExperiment({
    experiment,
    effects: [
      { arm_id: 'control', metric_id: 'p99-latency', true_mean: 240, noise_std: 1 },
      { arm_id: 'treatment', metric_id: 'p99-latency', true_mean: 180, noise_std: 1 },
      { arm_id: 'control', metric_id: 'error-rate', true_mean: 0.005, noise_std: 0.0001 },
      { arm_id: 'treatment', metric_id: 'error-rate', true_mean: 0.006, noise_std: 0.0001 },
    ],
    seed: 424242,
    samples_per_arm: 100,
    observed_at: T1,
    provenance: PROVENANCE,
    producer: toolProducer(),
    availability_overrides: overrides,
  });
}

// ---------------------------------------------------------------------------
// Recovery declarations (wired to real experiment guardrail trigger records)
// ---------------------------------------------------------------------------

/** A valid bounded recovery declaration wired to the golden experiment's rollback triggers. */
export function validRecovery(
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
