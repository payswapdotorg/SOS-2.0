/**
 * Experiment RESULT records — the typed outcome records of experiment runs
 * (Work Order W9; spec/architecture.md §5 "Experiment", §18 truth states;
 * docs/implementation/TESTING-AND-EVIDENCE.md layer 6).
 *
 * A result record is a TYPED RECORD (not a spine envelope artifact): it
 * carries a deterministic, content-addressed spine id minted under the
 * frozen core kind "Evaluation" (spec/meta-model.md: "Evaluation:
 * benchmark/scenario/protocol/results") — the same precedent @sos-2/causal
 * uses for calibration Evaluation ids. Evidence MINTING stays with
 * @sos-2/evidence (W3): real experiment results become Evidence records by
 * ingestion through W3's createEvidence; this type is the experiment-plane
 * outcome carrier that ingestion cites.
 *
 * LINKED, NOT FLOATING: every result is linked to the CANDIDATE (spine id)
 * AND the CAUSAL HYPOTHESIS (spine id) AND the experiment itself, both by
 * reference fields and by the three typed trace links produced by
 * resultTraceLinks (the spine's frozen link types, USED not extended):
 *
 *   result --VERIFIES-->     candidate   (the result verifies the
 *                                      candidate's predicted effects)
 *   result --OBSERVES-->     hypothesis  (the result observes the causal
 *                                      hypothesis's predicted outcomes)
 *   result --CAUSED_BY-->    experiment  (the experiment caused the result)
 *
 * TRUTHFUL AVAILABILITY: every metric outcome carries one of the 6 frozen
 * truth states (imported from the spine — never redefined), and the value
 * is null EXACTLY when the availability cannot carry a number (UNKNOWN,
 * UNAVAILABLE, UNSUPPORTED). A FAILING or UNKNOWN guardrail outcome is
 * never silently treated as success — evaluation.ts makes that decision
 * structurally impossible.
 *
 * SIMULATION PROVENANCE: results produced by the deterministic simulator
 * carry simulated: true plus the simulator version and the exact seed.
 * Simulated results are EVALUATION INFRASTRUCTURE, never intervention
 * evidence (docs/implementation/TESTING-AND-EVIDENCE.md layer-6 semantics
 * — the promotion gate rejects them loudly).
 */

import {
  createTraceLink,
  deriveDeterministicArtifactId,
  isArtifactId,
  isEvidenceTruthState,
  parseArtifactId,
  canonicalSerialize,
  RFC3339_PATTERN,
} from '@sos-2/semantic-spine';
import type { EvidenceTruthState, TraceLink } from '@sos-2/semantic-spine';
import { assertValidProducer } from '@sos-2/provenance';
import type { Producer } from '@sos-2/provenance';
import { ExperimentError } from './errors.js';
import type { ExperimentArtifact } from './artifact.js';

/** The (core, frozen) artifact kind segment used for result record ids. */
export const EXPERIMENT_RESULT_KIND = 'Evaluation';

/** Availability states that structurally cannot carry a numeric value. */
export const VALUELESS_AVAILABILITIES: readonly EvidenceTruthState[] = [
  'UNKNOWN',
  'UNAVAILABLE',
  'UNSUPPORTED',
];

/** The outcome of one metric on one arm. */
export interface MetricOutcome {
  /** The metric id (must be declared by the experiment design). */
  metric_id: string;
  /** The arm id (must be declared by the experiment allocation). */
  arm_id: string;
  /** The observed value; null EXACTLY when availability is UNKNOWN/UNAVAILABLE/UNSUPPORTED. */
  value: number | null;
  /** One of the 6 distinct truth states. */
  availability: EvidenceTruthState;
}

/** Simulator provenance — present exactly when simulated is true. */
export interface SimulatorProvenance {
  /** The simulator implementation identity (versioned). */
  version: string;
  /** The exact fixed seed the run used (deterministic reproduction). */
  seed: number;
}

/** The full experiment result record (the exact field set). */
export interface ExperimentResultRecord {
  /** Deterministic result record id: sos://Evaluation/<32 lowercase hex>. */
  id: string;
  /** The experiment this result comes from (sos://Experiment/...). */
  experiment_id: string;
  /** The candidate under test (sos://CandidateState/...) — mirrored from the experiment. */
  candidate_ref: string;
  /** The causal hypothesis under test (sos://CausalHypothesis/...) — mirrored from the experiment. */
  hypothesis_ref: string;
  /** RFC3339 observation instant (caller-supplied; no hidden clocks). */
  observed_at: string;
  /** Number of allocation units the result aggregates (>= 0). */
  sample_size: number;
  /** Outcomes, one per (metric, arm) pair — pairs are unique. */
  outcomes: MetricOutcome[];
  /** True exactly when produced by the simulator (evaluation infrastructure, never evidence). */
  simulated: boolean;
  /** Simulator provenance — REQUIRED when simulated, null otherwise. */
  simulator: SimulatorProvenance | null;
  /** Provenance entries (non-empty). */
  provenance: string[];
  /** WHO/WHAT produced this result. */
  producer: Producer;
}

export interface CreateExperimentResultInput {
  /** The experiment this result belongs to (validated: must be a well-formed Experiment id). */
  experiment_id: string;
  /** RFC3339 observation instant. */
  observed_at: string;
  /** Number of allocation units aggregated (integer >= 0). */
  sample_size: number;
  /** Outcomes (validated against the experiment design). */
  outcomes: MetricOutcome[];
  /** Provenance entries (non-empty). */
  provenance: string[];
  /** WHO/WHAT produced this result. */
  producer: Producer;
  /** Simulation provenance when the result is simulated, else null/undefined. */
  simulator?: SimulatorProvenance | null;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a MetricOutcome for shape and truth-state/value consistency
 * (throws ExperimentError).
 */
export function assertValidMetricOutcome(value: unknown): asserts value is MetricOutcome {
  if (!isPlainObject(value)) {
    throw new ExperimentError('metric outcome must be an object { metric_id, arm_id, value, availability }');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4) {
    throw new ExperimentError('metric outcome must have the exact field set { metric_id, arm_id, value, availability }');
  }
  if (typeof record['metric_id'] !== 'string' || record['metric_id'].length === 0) {
    throw new ExperimentError(`metric_id must be a non-empty string, received: ${JSON.stringify(record['metric_id'])}`);
  }
  if (typeof record['arm_id'] !== 'string' || record['arm_id'].length === 0) {
    throw new ExperimentError(`arm_id must be a non-empty string, received: ${JSON.stringify(record['arm_id'])}`);
  }
  if (!isEvidenceTruthState(record['availability'])) {
    throw new ExperimentError(
      `availability must be one of the 6 distinct evidence truth states, received: ${JSON.stringify(record['availability'])}`,
    );
  }
  const availability = record['availability'];
  const outcomeValue = record['value'];
  if (VALUELESS_AVAILABILITIES.includes(availability)) {
    if (outcomeValue !== null) {
      throw new ExperimentError(
        `a ${availability} outcome cannot carry a value (the truth state is distinct and is never silently numeric)`,
      );
    }
  } else if (typeof outcomeValue !== 'number' || !Number.isFinite(outcomeValue)) {
    throw new ExperimentError(
      `a ${availability} outcome must carry a finite numeric value, received: ${JSON.stringify(outcomeValue)}`,
    );
  }
}

/** Validate a full experiment result record (throws ExperimentError). */
export function assertValidExperimentResult(value: unknown): asserts value is ExperimentResultRecord {
  if (!isPlainObject(value)) {
    throw new ExperimentError(`experiment result must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = [
    'id',
    'experiment_id',
    'candidate_ref',
    'hypothesis_ref',
    'observed_at',
    'sample_size',
    'outcomes',
    'simulated',
    'simulator',
    'provenance',
    'producer',
  ];
  if (
    Object.keys(record).length !== keys.length ||
    !keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))
  ) {
    throw new ExperimentError(`experiment result must have the exact field set { ${keys.join(', ')} }`);
  }
  if (!isArtifactId(record['id'])) {
    throw new ExperimentError(`result id is not a well-formed artifact id: ${JSON.stringify(record['id'])}`);
  }
  if (parseArtifactId(record['id']).kind !== EXPERIMENT_RESULT_KIND) {
    throw new ExperimentError(
      `result id ${JSON.stringify(record['id'])} declares kind ${parseArtifactId(record['id']).kind}, expected ${EXPERIMENT_RESULT_KIND}`,
    );
  }
  if (!isArtifactId(record['experiment_id'])) {
    throw new ExperimentError(
      `experiment_id must be a well-formed spine artifact id, received: ${JSON.stringify(record['experiment_id'])}`,
    );
  }
  if (parseArtifactId(record['experiment_id']).kind !== 'Experiment') {
    throw new ExperimentError(
      `experiment_id must reference an Experiment artifact, received: ${JSON.stringify(record['experiment_id'])}`,
    );
  }
  if (!isArtifactId(record['candidate_ref'])) {
    throw new ExperimentError(
      `candidate_ref must be a well-formed spine artifact id, received: ${JSON.stringify(record['candidate_ref'])}`,
    );
  }
  if (parseArtifactId(record['candidate_ref']).kind !== 'CandidateState') {
    throw new ExperimentError(
      `candidate_ref must reference a CandidateState artifact, received: ${JSON.stringify(record['candidate_ref'])}`,
    );
  }
  if (!isArtifactId(record['hypothesis_ref'])) {
    throw new ExperimentError(
      `hypothesis_ref must be a well-formed spine artifact id, received: ${JSON.stringify(record['hypothesis_ref'])}`,
    );
  }
  if (parseArtifactId(record['hypothesis_ref']).kind !== 'CausalHypothesis') {
    throw new ExperimentError(
      `hypothesis_ref must reference a CausalHypothesis artifact, received: ${JSON.stringify(record['hypothesis_ref'])}`,
    );
  }
  if (typeof record['observed_at'] !== 'string' || !RFC3339_PATTERN.test(record['observed_at'])) {
    throw new ExperimentError(
      `observed_at must be an RFC3339 timestamp, received: ${JSON.stringify(record['observed_at'])}`,
    );
  }
  if (typeof record['sample_size'] !== 'number' || !Number.isInteger(record['sample_size']) || record['sample_size'] < 0) {
    throw new ExperimentError(`sample_size must be a non-negative integer, received: ${String(record['sample_size'])}`);
  }
  if (!Array.isArray(record['outcomes'])) {
    throw new ExperimentError('outcomes must be an array of metric outcomes');
  }
  const pairs = new Set<string>();
  for (const outcome of record['outcomes']) {
    assertValidMetricOutcome(outcome);
    const key = `${(outcome as MetricOutcome).metric_id}\u0000${(outcome as MetricOutcome).arm_id}`;
    if (pairs.has(key)) {
      throw new ExperimentError(
        `duplicate (metric, arm) outcome rejected: ${(outcome as MetricOutcome).metric_id} on ${(outcome as MetricOutcome).arm_id}`,
      );
    }
    pairs.add(key);
  }
  if (typeof record['simulated'] !== 'boolean') {
    throw new ExperimentError(`simulated must be a boolean, received: ${JSON.stringify(record['simulated'])}`);
  }
  if (record['simulated'] === true) {
    const simulator = record['simulator'];
    if (!isPlainObject(simulator) || Object.keys(simulator).length !== 2) {
      throw new ExperimentError(
        'simulated results REQUIRE simulator provenance { version, seed } — simulation without provenance is rejected',
      );
    }
    if (typeof simulator['version'] !== 'string' || simulator['version'].length === 0) {
      throw new ExperimentError(`simulator.version must be a non-empty string, received: ${JSON.stringify(simulator['version'])}`);
    }
    if (typeof simulator['seed'] !== 'number' || !Number.isInteger(simulator['seed']) || simulator['seed'] < 0) {
      throw new ExperimentError(`simulator.seed must be a non-negative integer, received: ${JSON.stringify(simulator['seed'])}`);
    }
  } else if (record['simulator'] !== null) {
    throw new ExperimentError('non-simulated results must carry simulator: null (provenance can never be ambiguous)');
  }
  if (!isNonEmptyStringArray(record['provenance'])) {
    throw new ExperimentError('provenance must be a non-empty array of non-empty strings');
  }
  try {
    assertValidProducer(record['producer']);
  } catch (cause) {
    throw new ExperimentError(`producer is invalid: ${(cause as Error).message}`);
  }
}

/** Predicate form of assertValidExperimentResult. */
export function validateExperimentResult(value: unknown): value is ExperimentResultRecord {
  try {
    assertValidExperimentResult(value);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Creation (deterministic, content-addressed)
// ---------------------------------------------------------------------------

/**
 * The exact value a result id is derived from (exported so tests reproduce
 * ids bit-exactly). Mirrors the experiment's candidate and hypothesis links
 * into the result so the record is LINKED AT CREATION, never floating.
 */
export interface ExperimentResultCreationContent {
  experiment_id: string;
  candidate_ref: string;
  hypothesis_ref: string;
  observed_at: string;
  sample_size: number;
  outcomes: MetricOutcome[];
  simulated: boolean;
  simulator: SimulatorProvenance | null;
  provenance: string[];
  producer: Producer;
}

/**
 * Normalize + validate a CreateExperimentResultInput against its experiment
 * (every outcome's metric and arm must be declared by the design) and
 * derive the exact creation content.
 */
export function experimentResultCreationContent(
  experiment: ExperimentArtifact,
  input: CreateExperimentResultInput,
): ExperimentResultCreationContent {
  if (typeof input !== 'object' || input === null) {
    throw new ExperimentError('result creation input must be an object');
  }
  if (typeof input.experiment_id !== 'string' || input.experiment_id !== experiment.envelope.id) {
    throw new ExperimentError(
      `experiment_id must be the exact experiment artifact id ${experiment.envelope.id}, received: ${JSON.stringify(input.experiment_id)}`,
    );
  }
  if (typeof input.observed_at !== 'string' || !RFC3339_PATTERN.test(input.observed_at)) {
    throw new ExperimentError(`observed_at must be an RFC3339 timestamp, received: ${JSON.stringify(input.observed_at)}`);
  }
  if (typeof input.sample_size !== 'number' || !Number.isInteger(input.sample_size) || input.sample_size < 0) {
    throw new ExperimentError(`sample_size must be a non-negative integer, received: ${String(input.sample_size)}`);
  }
  if (!isNonEmptyStringArray(input.provenance)) {
    throw new ExperimentError('provenance must be a non-empty array of non-empty strings');
  }
  const simulator = input.simulator ?? null;
  if (simulator !== null) {
    if (typeof simulator !== 'object' || Array.isArray(simulator)) {
      throw new ExperimentError('simulator provenance must be an object { version, seed }');
    }
    if (Object.keys(simulator).length !== 2) {
      throw new ExperimentError('simulator provenance must have the exact field set { version, seed }');
    }
    if (typeof simulator.version !== 'string' || simulator.version.length === 0) {
      throw new ExperimentError(`simulator.version must be a non-empty string, received: ${JSON.stringify(simulator.version)}`);
    }
    if (typeof simulator.seed !== 'number' || !Number.isInteger(simulator.seed) || simulator.seed < 0) {
      throw new ExperimentError(`simulator.seed must be a non-negative integer, received: ${JSON.stringify(simulator.seed)}`);
    }
  }
  try {
    assertValidProducer(input.producer);
  } catch (cause) {
    throw new ExperimentError(`producer is invalid: ${(cause as Error).message}`);
  }

  const declaredMetrics = new Set(experiment.content.design.metrics.map((metric) => metric.id));
  const declaredArms = new Set(experiment.content.design.allocation.arms.map((arm) => arm.id));
  if (!Array.isArray(input.outcomes)) {
    throw new ExperimentError('outcomes must be an array of metric outcomes');
  }
  const pairs = new Set<string>();
  for (const outcome of input.outcomes) {
    assertValidMetricOutcome(outcome);
    if (!declaredMetrics.has(outcome.metric_id)) {
      throw new ExperimentError(
        `outcome references metric ${JSON.stringify(outcome.metric_id)} which the design does not declare ` +
          '(results never float outside their experiment design)',
      );
    }
    if (!declaredArms.has(outcome.arm_id)) {
      throw new ExperimentError(
        `outcome references arm ${JSON.stringify(outcome.arm_id)} which the allocation does not declare ` +
          '(results never float outside their experiment design)',
      );
    }
    const key = `${outcome.metric_id}\u0000${outcome.arm_id}`;
    if (pairs.has(key)) {
      throw new ExperimentError(`duplicate (metric, arm) outcome rejected: ${outcome.metric_id} on ${outcome.arm_id}`);
    }
    pairs.add(key);
  }

  return {
    experiment_id: experiment.envelope.id,
    candidate_ref: experiment.content.candidate_ref,
    hypothesis_ref: experiment.content.hypothesis_ref,
    observed_at: input.observed_at,
    sample_size: input.sample_size,
    outcomes: input.outcomes.map((outcome) => ({ ...outcome })),
    simulated: simulator !== null,
    simulator: simulator === null ? null : { ...simulator },
    provenance: [...input.provenance],
    producer: { ...input.producer },
  };
}

/** Derive the deterministic result record id for an experiment + input. */
export function experimentResultId(experiment: ExperimentArtifact, input: CreateExperimentResultInput): string {
  return deriveDeterministicArtifactId(
    EXPERIMENT_RESULT_KIND,
    experimentResultCreationContent(experiment, input),
  );
}

/**
 * Create an experiment result record linked to its experiment, candidate and
 * causal hypothesis (mirrored at creation — never floating). Deterministic,
 * content-addressed id under the frozen core kind "Evaluation".
 */
export function createExperimentResult(
  experiment: ExperimentArtifact,
  input: CreateExperimentResultInput,
): ExperimentResultRecord {
  const content = experimentResultCreationContent(experiment, input);
  const id = deriveDeterministicArtifactId(EXPERIMENT_RESULT_KIND, content);
  return { id, ...structuredClone(content) };
}

// ---------------------------------------------------------------------------
// Typed trace links + simulation discipline
// ---------------------------------------------------------------------------

/**
 * The result's typed trace links (created through the spine's
 * createTraceLink — non-empty provenance, frozen link types):
 *
 *   result --VERIFIES-->    candidate  (verifies the candidate's predicted effects)
 *   result --OBSERVES-->    hypothesis (observes the causal hypothesis's
 *                                      predicted outcomes)
 *   result --CAUSED_BY-->   experiment (the experiment caused the result)
 */
export function resultTraceLinks(result: ExperimentResultRecord): TraceLink[] {
  assertValidExperimentResult(result);
  const provenance = [`result:${result.id}`, 'sos://schema/trace-link'];
  return [
    createTraceLink({ source: result.id, target: result.candidate_ref, type: 'VERIFIES', provenance }),
    createTraceLink({ source: result.id, target: result.hypothesis_ref, type: 'OBSERVES', provenance }),
    createTraceLink({ source: result.id, target: result.experiment_id, type: 'CAUSED_BY', provenance }),
  ];
}

/** Canonical serialization of a result record (deterministic round trips). */
export function canonicalResultText(result: ExperimentResultRecord): string {
  assertValidExperimentResult(result);
  return canonicalSerialize(result);
}

/**
 * Structural check: does this record carry the simulation mark? Any record
 * (evidence-shaped or result-shaped) with simulated === true is SIMULATED —
 * evaluation infrastructure, never intervention evidence. The promotion
 * gate consumes this check (simulated records can never satisfy
 * intervention evidence requirements).
 */
export function isSimulatedRecord(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (value as Record<string, unknown>)['simulated'] === true;
}
