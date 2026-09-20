/**
 * Experiment artifacts — the W9 realization of the controlled evolution
 * plane's core object (spec/architecture.md §5 "Experiment"; frozen core
 * artifact kind "Experiment").
 *
 * An Experiment is a Semantic Spine envelope artifact plus content:
 *
 *   - the DESIGN (treatment/control or alternatives, population,
 *     allocation, metrics, guardrails, stopping and rollback criteria —
 *     design.ts);
 *   - the current lifecycle STAGE (phase + typed staged exposure —
 *     lifecycle.ts);
 *   - the declared CANARY LADDER (the staged exposure steps a canary may
 *     advance through);
 *   - the CANDIDATE under test (a CandidateState spine id — the treatment);
 *   - the CAUSAL HYPOTHESIS under test (a CausalHypothesis spine id —
 *     experiments test hypotheses, and the link is typed and validated);
 *   - the PRODUCER (who/what drafted the experiment; LLM-drafted
 *     experiments are marked through the W3 Producer contract).
 *
 * Typed trace links (the spine's 17 frozen types, USED not extended):
 *   experiment --VERIFIES--> candidate       (the experiment verifies the
 *                                             candidate's predicted effects)
 *   experiment --DERIVED_FROM--> hypothesis  (the experiment derives from
 *                                             the causal hypothesis)
 *
 * Identity discipline: ids are ALWAYS deterministic (content-addressed over
 * the creation address — envelope fields except id, plus content), exactly
 * like @sos-2/causal. No identifiers are invented here; no envelope logic
 * is duplicated (AGENTS.md §4).
 */

import {
  assertValidEnvelope,
  createTraceLink,
  createEnvelope,
  deriveDeterministicArtifactId,
  isArtifactId,
  parseArtifactId,
  RFC3339_PATTERN,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus, TraceLink } from '@sos-2/semantic-spine';
import { assertValidProducer, isLlmProducer } from '@sos-2/provenance';
import type { Producer } from '@sos-2/provenance';
import { ExperimentError } from './errors.js';
import { assertValidExperimentDesign } from './design.js';
import type { ExperimentDesign } from './design.js';
import { assertValidCanaryLadder, assertValidStageExposure } from './lifecycle.js';
import type { StageExposure } from './lifecycle.js';

/** The (core, frozen) artifact kind segment used for experiment ids. */
export const EXPERIMENT_KIND = 'Experiment';

/** The full experiment content (the exact creation content). */
export interface ExperimentContent {
  /** The experiment design. */
  design: ExperimentDesign;
  /** The current lifecycle stage (phase + typed staged exposure). */
  stage: StageExposure;
  /** The declared canary ladder (strictly increasing steps in (0, 100)). */
  canary_ladder: number[];
  /** The CandidateState spine id under test (the treatment candidate). */
  candidate_ref: string;
  /** The CausalHypothesis spine id under test. */
  hypothesis_ref: string;
  /** WHO/WHAT drafted this experiment. */
  producer: Producer;
}

export interface ExperimentArtifact {
  /** Semantic Spine envelope; kind is always "Experiment". */
  envelope: ArtifactEnvelope;
  /** Experiment content (exact field set). */
  content: ExperimentContent;
}

export interface CreateExperimentInput {
  content: ExperimentContent;
  /** REQUIRED non-empty provenance entries (spine discipline). */
  provenance: string[];
  /** RFC3339 creation timestamp, caller-supplied (no hidden clocks). */
  created_at: string;
  /** Authorizing artifact id, or null. */
  authority_ref?: string | null;
  /** Version (integer >= 1). Defaults to 1. */
  version?: number;
  /** DRAFT (default) or ACTIVE. */
  status?: ArtifactStatus;
  /** Experiment artifact id superseded by this one, or null (roots). */
  supersedes?: string | null;
}

/**
 * The exact value an experiment id is derived from (exported so tests and
 * diagnostics reproduce ids bit-exactly — the W0.5 fixture discipline).
 */
export interface ExperimentCreationAddress {
  kind: 'Experiment';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: ExperimentContent;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

/** Validate experiment content (throws ExperimentError). */
export function assertValidExperimentContent(value: unknown): asserts value is ExperimentContent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ExperimentError(`experiment content must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = ['design', 'stage', 'canary_ladder', 'candidate_ref', 'hypothesis_ref', 'producer'];
  if (
    Object.keys(record).length !== keys.length ||
    !keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))
  ) {
    throw new ExperimentError(`experiment content must have the exact field set { ${keys.join(', ')} }`);
  }
  assertValidExperimentDesign(record['design']);
  const design = record['design'] as ExperimentDesign;
  assertValidCanaryLadder(record['canary_ladder']);
  assertValidStageExposure(record['stage'] as StageExposure, record['canary_ladder'] as number[]);

  if (!isArtifactId(record['candidate_ref'])) {
    throw new ExperimentError(
      `candidate_ref must be a well-formed spine artifact id, received: ${JSON.stringify(record['candidate_ref'])}`,
    );
  }
  const parsedCandidate = parseArtifactId(record['candidate_ref']);
  if (parsedCandidate.kind !== 'CandidateState') {
    throw new ExperimentError(
      `candidate_ref must reference a CandidateState artifact, received kind "${parsedCandidate.kind}" ` +
        '(the experiment treatment is a candidate state — the link is typed)',
    );
  }

  if (!isArtifactId(record['hypothesis_ref'])) {
    throw new ExperimentError(
      `hypothesis_ref must be a well-formed spine artifact id, received: ${JSON.stringify(record['hypothesis_ref'])}`,
    );
  }
  const parsedHypothesis = parseArtifactId(record['hypothesis_ref']);
  if (parsedHypothesis.kind !== 'CausalHypothesis') {
    throw new ExperimentError(
      `hypothesis_ref must reference a CausalHypothesis artifact, received kind "${parsedHypothesis.kind}" ` +
        '(experiments test causal hypotheses — the link is typed)',
    );
  }

  // The candidate under test must actually be exposed by an arm.
  const treatmentArms = design.allocation.arms.filter(
    (arm) => arm.candidate_ref === record['candidate_ref'],
  );
  if (treatmentArms.length === 0) {
    throw new ExperimentError(
      `candidate ${JSON.stringify(record['candidate_ref'])} is not exposed by any arm of the design ` +
        '(the candidate under test must be one of the experiment arms)',
    );
  }

  try {
    assertValidProducer(record['producer']);
  } catch (cause) {
    throw new ExperimentError(`producer is invalid: ${(cause as Error).message}`);
  }
}

/** The creation address of an experiment (envelope fields + content). */
export function experimentCreationAddress(
  input: CreateExperimentInput,
  content: ExperimentContent,
): ExperimentCreationAddress {
  return {
    kind: EXPERIMENT_KIND,
    version: input.version ?? 1,
    status: input.status ?? 'DRAFT',
    authority_ref: input.authority_ref ?? null,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes: input.supersedes ?? null,
    content,
  };
}

/** Derive the deterministic experiment artifact id for a creation input + content. */
export function experimentArtifactId(input: CreateExperimentInput, content: ExperimentContent): string {
  return deriveDeterministicArtifactId(EXPERIMENT_KIND, experimentCreationAddress(input, content));
}

/** Create an experiment artifact (deterministic, content-addressed id). */
export function createExperiment(input: CreateExperimentInput): ExperimentArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new ExperimentError('experiment creation input must be an object');
  }
  if (!isNonEmptyStringArray(input.provenance)) {
    throw new ExperimentError('provenance must be a non-empty array of non-empty strings');
  }
  if (typeof input.created_at !== 'string' || !RFC3339_PATTERN.test(input.created_at)) {
    throw new ExperimentError(`created_at must be an RFC3339 timestamp, received: ${JSON.stringify(input.created_at)}`);
  }
  assertValidExperimentContent(input.content);
  const content: ExperimentContent = structuredClone(input.content);

  const address = experimentCreationAddress(input, content);
  const id = deriveDeterministicArtifactId(EXPERIMENT_KIND, address);
  const envelope = createEnvelope({
    kind: EXPERIMENT_KIND,
    version: address.version,
    status: address.status,
    authority_ref: address.authority_ref,
    provenance: address.provenance,
    created_at: address.created_at,
    supersedes: address.supersedes,
    id,
  });
  return { envelope, content };
}

const ARTIFACT_KEYS = ['envelope', 'content'] as const;

/**
 * Full semantic validation of an experiment artifact (throws
 * ExperimentError): exact artifact shape, spine-valid envelope of frozen
 * kind Experiment, valid content.
 */
export function assertValidExperiment(value: unknown): asserts value is ExperimentArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ExperimentError('experiment artifact must be an object with exact fields { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  const expected = new Set<string>(ARTIFACT_KEYS);
  if (actualKeys.length !== ARTIFACT_KEYS.length || !actualKeys.every((key) => expected.has(key))) {
    throw new ExperimentError('experiment artifact must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new ExperimentError(`experiment envelope is not spine-valid: ${(cause as Error).message}`);
  }
  const envelope = record['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== EXPERIMENT_KIND) {
    throw new ExperimentError(
      `experiment envelope kind must be "${EXPERIMENT_KIND}" (frozen core kind), received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  assertValidExperimentContent(record['content']);
}

/** Predicate form of assertValidExperiment. */
export function validateExperiment(value: unknown): value is ExperimentArtifact {
  try {
    assertValidExperiment(value);
    return true;
  } catch {
    return false;
  }
}

/** True iff this experiment was drafted by model output (LLM) — never authoritative (§18). */
export function isLlmDrafted(experiment: ExperimentArtifact): boolean {
  return isLlmProducer(experiment.content.producer);
}

// ---------------------------------------------------------------------------
// Typed trace links from the experiment
// ---------------------------------------------------------------------------

/**
 * The experiment's typed trace links (created through the spine's
 * createTraceLink — non-empty provenance, frozen link types):
 *
 *   experiment --VERIFIES-->      candidate (the experiment verifies the
 *                                 candidate's predicted effects)
 *   experiment --DERIVED_FROM-->  hypothesis (the experiment derives from
 *                                 the causal hypothesis)
 */
export function experimentTraceLinks(experiment: ExperimentArtifact): TraceLink[] {
  assertValidExperiment(experiment);
  const id = experiment.envelope.id;
  return [
    createTraceLink({
      source: id,
      target: experiment.content.candidate_ref,
      type: 'VERIFIES',
      provenance: [`experiment:${id}`, 'sos://schema/trace-link'],
    }),
    createTraceLink({
      source: id,
      target: experiment.content.hypothesis_ref,
      type: 'DERIVED_FROM',
      provenance: [`experiment:${id}`, 'sos://schema/trace-link'],
    }),
  ];
}

/** The arm id exposing the candidate under test (the treatment/candidate arm). */
export function candidateArmId(experiment: ExperimentArtifact): string {
  assertValidExperiment(experiment);
  const arm = experiment.content.design.allocation.arms.find(
    (entry) => entry.candidate_ref === experiment.content.candidate_ref,
  );
  if (arm === undefined) {
    throw new ExperimentError(
      `candidate ${experiment.content.candidate_ref} is not exposed by any arm (validated at construction — unreachable)`,
    );
  }
  return arm.id;
}

/** The control arm id for TREATMENT_CONTROL designs (throws for ALTERNATIVES). */
export function controlArmId(experiment: ExperimentArtifact): string {
  assertValidExperiment(experiment);
  if (experiment.content.design.kind !== 'TREATMENT_CONTROL') {
    throw new ExperimentError('controlArmId is only defined for TREATMENT_CONTROL designs');
  }
  const arm = experiment.content.design.allocation.arms.find((entry) => entry.role === 'CONTROL');
  if (arm === undefined) {
    throw new ExperimentError('TREATMENT_CONTROL design without a CONTROL arm (validated at construction — unreachable)');
  }
  return arm.id;
}
