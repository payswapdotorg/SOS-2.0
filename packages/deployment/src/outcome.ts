/**
 * Deployment outcomes — FAILURES PRESERVE TRUTH STATES (Work Order W12;
 * spec/architecture.md section 18: "Unknown, failed, unavailable and
 * unsupported remain distinct"; R21).
 *
 * A DeploymentOutcome is the typed record of what was observed about a
 * deployment: an availability from the 6 FROZEN truth states, a detail
 * payload, a window and the producer. Outcomes are never coerced: an
 * UNKNOWN deployment is recorded as UNKNOWN and reported as UNKNOWN —
 * never as SUCCESS and never as FAILURE (pinned by tests using the
 * spine's own assertTruthStateIs).
 *
 * AGGREGATION (documented severity lattice, deterministic): the truthful
 * status of a deployment with several observations is the MAXIMUM
 * severity among them, in the order
 *
 *   FAILURE > PARTIAL > UNKNOWN > UNAVAILABLE > UNSUPPORTED > SUCCESS
 *
 * Combining observations never INCREASES apparent success: any UNKNOWN
 * observation keeps the deployment UNKNOWN (never SUCCESS/FAILURE); a
 * known FAILURE dominates; SUCCESS is the identity. A deployment with NO
 * recorded outcomes has no data — statusOf reports UNAVAILABLE (a gap:
 * never zero, never absence-of-failure; the architecture-lock discipline).
 *
 * SIMULATED outcomes (from the deterministic simulator) are marked and
 * are NEVER intervention evidence: asInterventionEvidenceInput refuses
 * them loudly (the W9 simulator discipline), and the store refuses to
 * record them as real deployment status.
 */

import { canonicalSerialize, isArtifactId, isEvidenceTruthState } from '@sos-2/semantic-spine';
import type { EvidenceTruthState, JsonValue } from '@sos-2/semantic-spine';
import { isTimeWindow, validateProducer } from '@sos-2/provenance';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import { DeploymentOutcomeError } from './errors.js';

/** A deployment outcome — what was observed about a deployment. */
export interface DeploymentOutcome {
  /** The DeploymentRecord spine id the outcome is about. */
  deployment_ref: string;
  /** Truthful availability — one of the 6 frozen truth states, verbatim. */
  availability: EvidenceTruthState;
  /** Outcome detail (JSON), or null. */
  detail: JsonValue | null;
  /** The observation time window, or null. */
  window: TimeWindow | null;
  /** WHO/WHAT observed (the deployment executor / telemetry backend). */
  producer: Producer;
  /** True iff produced by the deterministic simulator (never intervention evidence). */
  simulated: boolean;
}

/**
 * The severity lattice (max wins). Combining observations never increases
 * apparent success: an UNKNOWN observation keeps a deployment UNKNOWN, a
 * known FAILURE dominates everything, and SUCCESS is the identity.
 */
export const AVAILABILITY_SEVERITY_ORDER: readonly EvidenceTruthState[] = [
  'SUCCESS',
  'UNSUPPORTED',
  'UNAVAILABLE',
  'UNKNOWN',
  'PARTIAL',
  'FAILURE',
];

function severity(state: EvidenceTruthState): number {
  const index = AVAILABILITY_SEVERITY_ORDER.indexOf(state);
  if (index < 0) {
    throw new DeploymentOutcomeError(`unknown truth state: ${JSON.stringify(state)}`);
  }
  return index;
}

/**
 * Deterministic max-severity aggregation over a NON-EMPTY sequence of
 * truth states (throws on empty — the no-data case is UNAVAILABLE, not an
 * aggregation; see statusOf).
 */
export function aggregateAvailability(states: readonly EvidenceTruthState[]): EvidenceTruthState {
  if (!Array.isArray(states) || states.length === 0) {
    throw new DeploymentOutcomeError('aggregateAvailability requires a non-empty array of truth states');
  }
  let worst: EvidenceTruthState = 'SUCCESS';
  for (const state of states) {
    if (!isEvidenceTruthState(state)) {
      throw new DeploymentOutcomeError(`unknown truth state: ${JSON.stringify(state)}`);
    }
    if (severity(state) > severity(worst)) {
      worst = state;
    }
  }
  return worst;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonOrNull(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  try {
    canonicalSerialize(value);
    return true;
  } catch {
    return false;
  }
}

/** Full semantic validation of a deployment outcome (throws DeploymentOutcomeError). */
export function assertValidDeploymentOutcome(value: unknown): asserts value is DeploymentOutcome {
  if (!isPlainObject(value)) {
    throw new DeploymentOutcomeError('deployment outcome must be an object');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = ['deployment_ref', 'availability', 'detail', 'window', 'producer', 'simulated'];
  if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) {
    throw new DeploymentOutcomeError(
      `deployment outcome must have the exact field set { ${expected.join(', ')} }`,
    );
  }
  if (typeof record['deployment_ref'] !== 'string' || !isArtifactId(record['deployment_ref'])) {
    throw new DeploymentOutcomeError(
      `deployment outcome deployment_ref must be a well-formed spine artifact id, received: ${JSON.stringify(record['deployment_ref'])}`,
    );
  }
  if (!isEvidenceTruthState(record['availability'])) {
    throw new DeploymentOutcomeError(
      `deployment outcome availability must be one of the 6 distinct truth states, received: ${JSON.stringify(record['availability'])}`,
    );
  }
  if (!isJsonOrNull(record['detail'])) {
    throw new DeploymentOutcomeError('deployment outcome detail must be null or a JSON value');
  }
  if (record['window'] !== null && !isTimeWindow(record['window'])) {
    throw new DeploymentOutcomeError('deployment outcome window must be null or a valid time window');
  }
  try {
    validateProducer(record['producer']);
  } catch (cause) {
    throw new DeploymentOutcomeError(`deployment outcome producer is invalid: ${(cause as Error).message}`);
  }
  if (typeof record['simulated'] !== 'boolean') {
    throw new DeploymentOutcomeError('deployment outcome simulated must be a boolean');
  }
}

/** Predicate form of assertValidDeploymentOutcome. */
export function validateDeploymentOutcome(value: unknown): value is DeploymentOutcome {
  try {
    assertValidDeploymentOutcome(value);
    return true;
  } catch {
    return false;
  }
}

/** Counts per truth state — ALL 6 keys are ALWAYS present (never conflated). */
export type DeploymentOutcomeSummary = Record<EvidenceTruthState, number>;

/** Honest per-state summary over deployment outcomes (all 6 keys, zero-filled). */
export function summarizeDeploymentOutcomes(outcomes: readonly DeploymentOutcome[]): DeploymentOutcomeSummary {
  if (!Array.isArray(outcomes)) {
    throw new DeploymentOutcomeError('summarizeDeploymentOutcomes requires an array of deployment outcomes');
  }
  const summary: DeploymentOutcomeSummary = {
    SUCCESS: 0,
    FAILURE: 0,
    UNKNOWN: 0,
    UNAVAILABLE: 0,
    UNSUPPORTED: 0,
    PARTIAL: 0,
  };
  for (const outcome of outcomes) {
    assertValidDeploymentOutcome(outcome);
    summary[outcome.availability] += 1;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// The intervention-evidence bridge (simulated outcomes are NEVER it)
// ---------------------------------------------------------------------------

/** The evidence-creation input shape for a REAL deployment outcome. */
export interface DeploymentEvidenceInput {
  /** Evidence kind (defaults to 'deployment'). */
  kind?: string;
  /** Spine artifact id of the subject the evidence is about. */
  subject: string;
  /** The deployment's exact artifact revision (carried into source_revision). */
  artifactRevision?: string;
  /** The deployment's exact deployment identifier (carried into deployment_revision). */
  deploymentRevision?: string;
  /** Extra provenance entries (recorded after the bridge's own). */
  provenance?: string[];
}

/**
 * The intervention-evidence bridge: deploying IS an intervention, so a REAL
 * deployment outcome mints INTERVENTIONAL evidence. SIMULATED outcomes are
 * NEVER intervention evidence — the bridge refuses them loudly (the W9
 * simulator discipline; spec/architecture.md section 18: intervention
 * evidence outranks observational correlation, and simulation is
 * evaluation infrastructure, not intervention).
 */
export function asInterventionEvidenceInput(
  outcome: DeploymentOutcome,
  input: DeploymentEvidenceInput,
): {
  kind: string;
  subject_ref: string;
  availability: EvidenceTruthState;
  evidence_class: 'INTERVENTIONAL';
  method: string;
  provenance: string[];
  source_revision: string | null;
  deployment_revision: string | null;
  window: TimeWindow | null;
  producer: Producer;
} {
  assertValidDeploymentOutcome(outcome);
  if (outcome.simulated) {
    throw new DeploymentOutcomeError(
      'simulated deployment outcomes are NEVER intervention evidence ' +
        '(they are deterministic evaluation infrastructure, marked simulated — ' +
        'the W9 simulator discipline); mint evidence only from real deployment outcomes',
    );
  }
  if (typeof input !== 'object' || input === null) {
    throw new DeploymentOutcomeError('deployment evidence input must be an object');
  }
  if (typeof input.subject !== 'string' || !isArtifactId(input.subject)) {
    throw new DeploymentOutcomeError(
      `deployment evidence subject must be a well-formed spine artifact id, received: ${JSON.stringify(input.subject)}`,
    );
  }
  return {
    kind: input.kind ?? 'deployment',
    subject_ref: input.subject,
    // VERBATIM: the outcome's truth state becomes the evidence truth state.
    availability: outcome.availability,
    evidence_class: 'INTERVENTIONAL',
    method: 'deployment:outcome-availability',
    provenance: [
      `deployment:${outcome.deployment_ref}`,
      ...(outcome.simulated ? ['simulated:true'] : []),
      ...(input.provenance ?? []),
    ],
    source_revision: input.artifactRevision ?? null,
    deployment_revision: input.deploymentRevision ?? null,
    window: outcome.window === null ? null : { ...outcome.window },
    producer: { ...outcome.producer },
  };
}
