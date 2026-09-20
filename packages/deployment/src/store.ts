/**
 * The deployment store — deployment records, validated lifecycle
 * transitions and truthful outcome bookkeeping.
 *
 * Lifecycle discipline (validated, loud):
 *   - records enter PLANNED (envelope DRAFT; ACTIVE on explicit creation);
 *   - deploy() moves PLANNED -> DEPLOYED (envelope ACTIVE);
 *   - rollback() moves DEPLOYED -> ROLLED_BACK (envelope RETIRED);
 *   - every transition is logged with the caller-supplied instant and
 *     provenance (audit trail: who/what transitioned, when);
 *   - identity is preserved across transitions (the spine discipline);
 *   - deployment_id values are unique within a store.
 *
 * Outcome discipline (failures preserve truth states):
 *   - recordOutcome() refuses SIMULATED outcomes (they are evaluation
 *     data, never real deployment status);
 *   - statusOf() reports the deployment's truthful availability as the
 *     max-severity aggregation over its recorded outcomes — UNKNOWN is
 *     never reported as SUCCESS or FAILURE (pinned by tests using the
 *     spine's assertTruthStateIs);
 *   - a deployment with NO outcomes reports UNAVAILABLE (a gap — no data
 *     exists; never zero, never absence-of-failure).
 */

import { assertValidEnvelope } from '@sos-2/semantic-spine';
import type { ArtifactEnvelope } from '@sos-2/semantic-spine';
import { withStatus } from '@sos-2/semantic-spine';
import { DeploymentLifecycleError } from './errors.js';
import { DeploymentOutcomeError } from './errors.js';
import {
  DEPLOYMENT_LIFECYCLE_TO_ENVELOPE,
  deploymentLifecycle,
  transitionDeploymentLifecycle,
} from './record.js';
import type { DeploymentLifecycleStatus, DeploymentRecord } from './record.js';
import { assertValidDeploymentOutcome } from './outcome.js';
import type { DeploymentOutcome, DeploymentOutcomeSummary } from './outcome.js';
import { aggregateAvailability, summarizeDeploymentOutcomes } from './outcome.js';

/** One lifecycle transition in the audit trail. */
export interface DeploymentTransition {
  /** The DeploymentRecord spine id. */
  deployment_ref: string;
  /** From lifecycle status. */
  from: DeploymentLifecycleStatus;
  /** To lifecycle status. */
  to: DeploymentLifecycleStatus;
  /** RFC3339 transition instant (caller-supplied; no hidden clocks). */
  at: string;
  /** Provenance of the transition (non-empty entries). */
  provenance: string[];
}

/** Validated transition input. */
export interface TransitionInput {
  /** RFC3339 transition instant. */
  at: string;
  /** REQUIRED non-empty provenance entries. */
  provenance: string[];
}

export class DeploymentStore {
  private readonly records = new Map<string, DeploymentRecord>();
  private readonly byDeploymentId = new Map<string, string>();
  private readonly outcomes = new Map<string, DeploymentOutcome[]>();
  private readonly transitionLog: DeploymentTransition[] = [];

  /** Store a deployment record (validated; duplicate ids/deployment_ids rejected). */
  put(record: DeploymentRecord): DeploymentRecord {
    if (typeof record !== 'object' || record === null) {
      throw new DeploymentLifecycleError('deployment record must be an object { envelope, content }');
    }
    try {
      assertValidEnvelope(record.envelope);
    } catch (cause) {
      throw new DeploymentLifecycleError(`deployment envelope is invalid: ${(cause as Error).message}`);
    }
    const existingEnvelopeId = this.records.get(record.envelope.id);
    if (existingEnvelopeId !== undefined) {
      throw new DeploymentLifecycleError(`deployment already registered: ${record.envelope.id}`);
    }
    const existingDeploymentId = this.byDeploymentId.get(record.content.deployment_id);
    if (existingDeploymentId !== undefined) {
      throw new DeploymentLifecycleError(
        `deployment_id already registered: ${record.content.deployment_id} (${existingDeploymentId})`,
      );
    }
    this.records.set(record.envelope.id, { envelope: { ...record.envelope }, content: structuredClone(record.content) });
    this.byDeploymentId.set(record.content.deployment_id, record.envelope.id);
    this.outcomes.set(record.envelope.id, []);
    return record;
  }

  get(id: string): DeploymentRecord | undefined {
    const record = this.records.get(id);
    return record === undefined ? undefined : { envelope: { ...record.envelope }, content: structuredClone(record.content) };
  }

  getByDeploymentId(deploymentId: string): DeploymentRecord | undefined {
    const id = this.byDeploymentId.get(deploymentId);
    return id === undefined ? undefined : this.get(id);
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  /** All deployment records, sorted by envelope id (deterministic). */
  list(): DeploymentRecord[] {
    return [...this.records.keys()].sort().map((id) => this.get(id)!);
  }

  get size(): number {
    return this.records.size;
  }

  private require(id: string): DeploymentRecord {
    const record = this.records.get(id);
    if (record === undefined) {
      throw new DeploymentLifecycleError(`unknown deployment: ${id}`);
    }
    return record;
  }

  /** PLANNED -> DEPLOYED (validated; logged with at + provenance). */
  deploy(id: string, input: TransitionInput): DeploymentRecord {
    return this.transition(id, 'DEPLOYED', input);
  }

  /** DEPLOYED -> ROLLED_BACK (validated; logged with at + provenance). */
  rollback(id: string, input: TransitionInput): DeploymentRecord {
    return this.transition(id, 'ROLLED_BACK', input);
  }

  private transition(id: string, to: DeploymentLifecycleStatus, input: TransitionInput): DeploymentRecord {
    if (typeof input !== 'object' || input === null) {
      throw new DeploymentLifecycleError('transition input must be an object { at, provenance }');
    }
    if (typeof input.at !== 'string' || input.at.length === 0) {
      throw new DeploymentLifecycleError('transition at must be an RFC3339 timestamp (caller-supplied)');
    }
    if (
      !Array.isArray(input.provenance) ||
      input.provenance.length === 0 ||
      !input.provenance.every((entry) => typeof entry === 'string' && entry.length > 0)
    ) {
      throw new DeploymentLifecycleError('transition provenance must be a non-empty array of non-empty strings');
    }
    const current = this.require(id);
    const from = deploymentLifecycle(current);
    transitionDeploymentLifecycle(from, to);
    const nextEnvelopeStatus = DEPLOYMENT_LIFECYCLE_TO_ENVELOPE[to]!;
    // The spine's own transition validation runs inside withStatus (identity
    // preserved; illegal transitions throw).
    const envelope: ArtifactEnvelope = withStatus(current.envelope, nextEnvelopeStatus);
    current.envelope = envelope;
    this.transitionLog.push({
      deployment_ref: id,
      from,
      to,
      at: input.at,
      provenance: [...input.provenance],
    });
    return { envelope: { ...envelope }, content: structuredClone(current.content) };
  }

  /** The transition audit trail (insertion order). */
  transitions(id?: string): DeploymentTransition[] {
    if (id === undefined) {
      return this.transitionLog.map((entry) => ({ ...entry, provenance: [...entry.provenance] }));
    }
    return this.transitionLog
      .filter((entry) => entry.deployment_ref === id)
      .map((entry) => ({ ...entry, provenance: [...entry.provenance] }));
  }

  /**
   * Record a REAL deployment outcome. SIMULATED outcomes are refused
   * loudly — they are evaluation data, never real deployment status.
   */
  recordOutcome(outcome: DeploymentOutcome): void {
    assertValidDeploymentOutcome(outcome);
    if (outcome.simulated) {
      throw new DeploymentOutcomeError(
        'simulated deployment outcomes are never recorded as real deployment status ' +
          '(simulation is evaluation infrastructure — inspect the simulated run instead)',
      );
    }
    const record = this.require(outcome.deployment_ref);
    const bucket = this.outcomes.get(record.envelope.id)!;
    bucket.push(structuredClone(outcome));
  }

  /** All recorded outcomes for a deployment, insertion order. */
  outcomesOf(id: string): DeploymentOutcome[] {
    const record = this.require(id);
    const bucket = this.outcomes.get(record.envelope.id)!;
    return bucket.map((outcome) => structuredClone(outcome));
  }

  /** Honest per-state summary over a deployment's outcomes (all 6 keys). */
  summarizeOutcomes(id: string): DeploymentOutcomeSummary {
    return summarizeDeploymentOutcomes(this.outcomesOf(id));
  }

  /**
   * The deployment's TRUTHFUL status: the max-severity aggregation over
   * its recorded outcomes; UNAVAILABLE when NO outcomes exist (a gap —
   * never zero, never absence-of-failure). A deployment whose status is
   * UNKNOWN is reported as exactly UNKNOWN — never SUCCESS, never FAILURE.
   */
  statusOf(id: string): import('@sos-2/semantic-spine').EvidenceTruthState {
    const outcomes = this.outcomesOf(id);
    if (outcomes.length === 0) {
      return 'UNAVAILABLE';
    }
    return aggregateAvailability(outcomes.map((outcome) => outcome.availability));
  }
}
