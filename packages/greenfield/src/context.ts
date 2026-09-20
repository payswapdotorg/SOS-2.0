/**
 * The greenfield pipeline's typed inputs (Work Order W14).
 *
 * Everything here is ORCHESTRATION WIRING over the merged W0.5-W12
 * packages — every domain vocabulary is CONSUMED from its owning
 * authority, never redefined:
 *
 *   mission content shapes     @sos-2/mission
 *   risk/reversibility         @sos-2/autonomy
 *   impact / decision request  @sos-2/decision
 *   risk severity / uncertainty classes / grants  @sos-2/authority
 *   registry + evidence resolver                 @sos-2/registry
 *   candidate generators (search lower rungs)    @sos-2/search
 *   system state reference types                 @sos-2/system-state
 *   raw telemetry observations                   @sos-2/telemetry
 *
 * DETERMINISM CONTRACT (the W14 harness discipline): the pipeline is a
 * PURE function of its input. Every instant is caller-supplied and fixed
 * (no hidden clocks), every identity is content-addressed by the spine,
 * and there is no I/O, no network and no randomness anywhere in the
 * orchestrator. Identical input produces a byte-identical result.
 */

import type { AuthorityGrantArtifact, UncertaintyClass } from '@sos-2/authority';
import type { BlastRadius, ReversibilityClass } from '@sos-2/autonomy';
import type { ImpactClass } from '@sos-2/decision';
import type { EvidenceResolver } from '@sos-2/registry';
import type { PackageRegistry } from '@sos-2/registry';
import type {
  ConfigurationReference,
  DeploymentReference,
  EnvironmentRelationship,
  PolicyReference,
} from '@sos-2/system-state';
import type { RawObservation } from '@sos-2/telemetry';
import { RFC3339_PATTERN } from '@sos-2/semantic-spine';
import type { CandidateGenerator } from '@sos-2/search';
import type { MissionAmbiguity, MissionAssumption, MissionConstraint, MissionOutcome, MissionStakeholder } from '@sos-2/mission';
import { GreenfieldError } from './errors.js';

// ---------------------------------------------------------------------------
// The deterministic run context
// ---------------------------------------------------------------------------

/**
 * The fixed instants + provenance of one pipeline run. One timestamp per
 * stage boundary (the ask instant covers both enqueue and resolve of the
 * ASK path). All instants must be RFC3339 and NON-DECREASING in pipeline
 * order — a run whose stages go backwards in time is rejected loudly
 * (determinism is a contract, not an accident).
 */
export interface GreenfieldRunContext {
  /** Non-empty provenance entries (spine discipline; identifies the run). */
  provenance: string[];
  /** Stage 1 — mission formalization instant. */
  t_mission: string;
  /** Stage 2 — capability derivation + candidate composition instant. */
  t_candidate: string;
  /** Stage 3 — human decision flow instant (the evaluation point). */
  t_decision: string;
  /** Stage 3b — ask enqueue/resolve instant (used only on the ASK path). */
  t_ask: string;
  /** Stage 4 — realization instant. */
  t_realization: string;
  /** Stage 5 — reconciliation instant. */
  t_reconciliation: string;
  /** Stage 6 — evidence ingestion + freshness evaluation instant. */
  t_evidence: string;
}

const RUN_CONTEXT_KEYS = [
  'provenance',
  't_mission',
  't_candidate',
  't_decision',
  't_ask',
  't_realization',
  't_reconciliation',
  't_evidence',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRfc3339(value: unknown): value is string {
  return typeof value === 'string' && RFC3339_PATTERN.test(value);
}

/** Validate a run context (throws GreenfieldError). */
export function assertValidGreenfieldRunContext(value: unknown): asserts value is GreenfieldRunContext {
  if (!isPlainObject(value)) {
    throw new GreenfieldError(`run context must be an object, received: ${JSON.stringify(value)}`);
  }
  const actual = Object.keys(value);
  const expected = new Set<string>(RUN_CONTEXT_KEYS);
  if (actual.length !== RUN_CONTEXT_KEYS.length || !actual.every((key) => expected.has(key))) {
    throw new GreenfieldError(
      `run context must have the exact field set { ${RUN_CONTEXT_KEYS.join(', ')} } (one fixed instant per stage)`,
    );
  }
  const provenance = value['provenance'];
  if (
    !Array.isArray(provenance) ||
    provenance.length === 0 ||
    !provenance.every((entry) => isNonEmptyString(entry))
  ) {
    throw new GreenfieldError('run context provenance must be a non-empty array of non-empty strings');
  }
  const instants = RUN_CONTEXT_KEYS.slice(1).map((key) => {
    const instant = value[key];
    if (!isRfc3339(instant)) {
      throw new GreenfieldError(`run context ${key} must be an RFC3339 timestamp, received: ${JSON.stringify(instant)}`);
    }
    return instant;
  });
  for (let index = 1; index < instants.length; index += 1) {
    if (instants[index]! < instants[index - 1]!) {
      throw new GreenfieldError(
        `run context instants must be non-decreasing in pipeline order: ${instants[index - 1]!} (earlier stage) > ${instants[index]!} (later stage)`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The greenfield world (the package ecology + presented authority)
// ---------------------------------------------------------------------------

/**
 * Everything the pipeline runs against. The registry is THE data authority
 * (W6 — no second package authority); the evidence resolver resolves the
 * ecology's evidence refs; the grants are the authority presented to the
 * decision stage (empty grants are honest — the decision then escalates to
 * ASK). The optional generators plug reasoning mechanisms into the search
 * ladder's lower rungs (replaceable mechanisms, never authorities).
 */
export interface GreenfieldWorld {
  /** THE package/composition registry (the package ecology). */
  registry: PackageRegistry;
  /** Resolves evidence refs cited by ecology entries (unresolved stays honest). */
  evidenceResolver: EvidenceResolver;
  /** The authority grants presented to the human decision flow. */
  grants: readonly AuthorityGrantArtifact[];
  /** Optional generator for the ARCHITECTURE_PATTERN rung (pluggable reasoning). */
  patternSource?: CandidateGenerator;
  /** Optional generator for the NOVEL_ARCHITECTURE rung (pluggable reasoning). */
  novelSource?: CandidateGenerator;
  /** Optional generator for the LOW_LEVEL_SYNTHESIS rung (pluggable reasoning). */
  synthesisSource?: CandidateGenerator;
}

/** Validate a world (throws GreenfieldError). */
export function assertValidGreenfieldWorld(value: unknown): asserts value is GreenfieldWorld {
  if (!isPlainObject(value)) {
    throw new GreenfieldError(`greenfield world must be an object, received: ${JSON.stringify(value)}`);
  }
  const registry = value['registry'];
  if (
    typeof registry !== 'object' ||
    registry === null ||
    typeof (registry as { retrieve?: unknown }).retrieve !== 'function' ||
    typeof (registry as { putPackage?: unknown }).putPackage !== 'function'
  ) {
    throw new GreenfieldError('greenfield world requires a PackageRegistry instance (the data authority)');
  }
  if (typeof value['evidenceResolver'] !== 'function') {
    throw new GreenfieldError('greenfield world requires an evidenceResolver function (refs resolve or stay honest)');
  }
  if (!Array.isArray(value['grants'])) {
    throw new GreenfieldError('greenfield world grants must be an array of AuthorityGrantArtifacts (possibly empty)');
  }
  for (const key of ['patternSource', 'novelSource', 'synthesisSource'] as const) {
    const generator = value[key];
    if (generator !== undefined && typeof generator !== 'function') {
      throw new GreenfieldError(`greenfield world ${key} must be a candidate generator function when present`);
    }
  }
}

// ---------------------------------------------------------------------------
// The raw mission input (stage 1)
// ---------------------------------------------------------------------------

/** A raw goal awaiting formalization (progressive formalization, R2). */
export interface GreenfieldGoalInput {
  id: string;
  statement: string;
  /** References to measures; a goal with >= 1 measure becomes MEASURABLE. */
  measures: string[];
}

/** A raw measure (the machine-checkable formalization anchor). */
export interface GreenfieldMeasureInput {
  id: string;
  description: string;
  target: string | null;
  unit: string | null;
}

/**
 * The RAW mission input of the greenfield journey (spec/architecture.md
 * section 15: "Greenfield starts from mission"). Stage 1 formalizes it
 * into a Mission artifact: goals with measures become MEASURABLE, goals
 * without stay PROPOSED (progressive formalization — R2). The constraints
 * are REAL @sos-2/mission MissionConstraint objects: they are consumed
 * DIRECTLY by the candidate search's hard-constraint filter (the W7
 * integration contract — MissionConstraint satisfies HardConstraintView).
 */
export interface GreenfieldMissionInput {
  /** The mission purpose (the single mandatory semantic anchor). */
  purpose: string;
  /** The semantic capability the mission needs realized (the search key). */
  capability: string;
  /** The mission's required contracts (the composed candidate realizes them). */
  contracts: string[];
  /** Raw goals (formalized by stage 1). */
  goals: readonly GreenfieldGoalInput[];
  /** Measures (the formalization anchors). */
  measures: readonly GreenfieldMeasureInput[];
  /** Outcomes (verbatim passthrough). */
  outcomes?: readonly MissionOutcome[];
  /** Stakeholders (verbatim passthrough). */
  stakeholders?: readonly MissionStakeholder[];
  /** Assumptions (verbatim passthrough). */
  assumptions?: readonly MissionAssumption[];
  /** Ambiguities (verbatim passthrough). */
  ambiguities?: readonly MissionAmbiguity[];
  /** Mission constraints — consumed by the candidate search (W7 contract). */
  constraints: readonly MissionConstraint[];
}

/** Capability keys are slug-like (deterministic search keys). */
export const GREENFIELD_CAPABILITY_PATTERN = /^[a-z][a-z0-9._-]*$/;

/** Validate a raw mission input (throws GreenfieldError). */
export function assertValidGreenfieldMissionInput(value: unknown): asserts value is GreenfieldMissionInput {
  if (!isPlainObject(value)) {
    throw new GreenfieldError(`mission input must be an object, received: ${JSON.stringify(value)}`);
  }
  if (!isNonEmptyString(value['purpose'])) {
    throw new GreenfieldError('mission input purpose must be a non-empty string (the mandatory semantic anchor)');
  }
  const capability = value['capability'];
  if (!isNonEmptyString(capability) || !GREENFIELD_CAPABILITY_PATTERN.test(capability)) {
    throw new GreenfieldError(
      `mission input capability must match ${GREENFIELD_CAPABILITY_PATTERN.toString()} (the deterministic search key), received: ${JSON.stringify(capability)}`,
    );
  }
  const contracts = value['contracts'];
  if (!Array.isArray(contracts) || contracts.length === 0 || !contracts.every(isNonEmptyString)) {
    throw new GreenfieldError('mission input contracts must be a non-empty array of contract ids');
  }
  const goals = value['goals'];
  if (!Array.isArray(goals) || goals.length === 0) {
    throw new GreenfieldError('mission input goals must be a non-empty array (a mission has at least one goal)');
  }
  for (const goal of goals) {
    if (!isPlainObject(goal) || !isNonEmptyString(goal['id']) || !isNonEmptyString(goal['statement'])) {
      throw new GreenfieldError(`mission goal must be { id, statement, measures }, received: ${JSON.stringify(goal)}`);
    }
    if (!Array.isArray(goal['measures']) || !goal['measures'].every(isNonEmptyString)) {
      throw new GreenfieldError(`mission goal ${JSON.stringify(goal['id'])} measures must be an array of measure ids`);
    }
  }
  const measures = value['measures'];
  if (!Array.isArray(measures)) {
    throw new GreenfieldError('mission input measures must be an array of { id, description, target, unit }');
  }
  for (const measure of measures) {
    if (
      !isPlainObject(measure) ||
      !isNonEmptyString(measure['id']) ||
      !isNonEmptyString(measure['description']) ||
      !(typeof measure['target'] === 'string' || measure['target'] === null) ||
      !(typeof measure['unit'] === 'string' || measure['unit'] === null)
    ) {
      throw new GreenfieldError(
        `mission measure must be { id, description, target, unit }, received: ${JSON.stringify(measure)}`,
      );
    }
  }
  const measureIds = new Set(measures.map((measure) => (measure as { id: string }).id));
  for (const goal of goals) {
    for (const ref of (goal as { measures: string[] }).measures) {
      if (!measureIds.has(ref)) {
        throw new GreenfieldError(
          `mission goal ${JSON.stringify((goal as { id: string }).id)} references unknown measure ${JSON.stringify(ref)}`,
        );
      }
    }
  }
  if (!Array.isArray(value['constraints'])) {
    throw new GreenfieldError('mission input constraints must be an array of MissionConstraint objects');
  }
}

// ---------------------------------------------------------------------------
// The decision risk profile (stage 3 input)
// ---------------------------------------------------------------------------

/**
 * The typed risk profile of the realization decision — every vocabulary
 * consumed from its owning authority (blast radius / reversibility:
 * @sos-2/autonomy; impact: @sos-2/decision; risk severity / uncertainty
 * classes: @sos-2/authority). The profile is EXPLICIT input (never a
 * hidden default) — the W10 discipline: the engine's rules consume it,
 * confidence is never part of it.
 */
export interface GreenfieldRiskProfile {
  blast_radius: BlastRadius;
  impact: ImpactClass;
  risk: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
  reversibility: ReversibilityClass;
  causal_claim: boolean;
  uncertainty_class: UncertaintyClass;
  /** Non-empty basis for the uncertainty statement. */
  uncertainty_basis: string;
}

/** Validate a risk profile (throws GreenfieldError). */
export function assertValidGreenfieldRiskProfile(value: unknown): asserts value is GreenfieldRiskProfile {
  if (!isPlainObject(value)) {
    throw new GreenfieldError(`risk profile must be an object, received: ${JSON.stringify(value)}`);
  }
  const fields = ['blast_radius', 'impact', 'risk', 'reversibility', 'causal_claim', 'uncertainty_class', 'uncertainty_basis'] as const;
  for (const field of fields) {
    if (!(field in value)) {
      throw new GreenfieldError(`risk profile is missing the required field ${JSON.stringify(field)}`);
    }
  }
  if (!isNonEmptyString(value['uncertainty_basis'])) {
    throw new GreenfieldError('risk profile uncertainty_basis must be a non-empty string');
  }
}

// ---------------------------------------------------------------------------
// The realization plan (stage 4 input)
// ---------------------------------------------------------------------------

/**
 * The exact-revision plan of the realization (R30: every promoted change
 * is reproducible from exact revisions). The revision is the exact source
 * revision the realization is built from; the configuration / deployment /
 * policy / environment sections become the realized System State's
 * sections (each with its exact revision discipline — W2 contract).
 */
export interface GreenfieldRealizationPlan {
  /** Exact source revision (40-hex git sha) of the realized implementation. */
  revision: string;
  /** The environment the realization deploys into (e.g. "production"). */
  environment: string;
  /** Configurations in force (exact config-version revisions). */
  configuration: ConfigurationReference[];
  /** Deployments in force (exact deployment-id revisions). */
  deployment: DeploymentReference[];
  /** Active policies (versioned). */
  policy: PolicyReference[];
  /** Typed relationships between environments. */
  environment_relationships: EnvironmentRelationship[];
}

const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

/** Validate a realization plan (throws GreenfieldError). */
export function assertValidGreenfieldRealizationPlan(value: unknown): asserts value is GreenfieldRealizationPlan {
  if (!isPlainObject(value)) {
    throw new GreenfieldError(`realization plan must be an object, received: ${JSON.stringify(value)}`);
  }
  const revision = value['revision'];
  if (!isNonEmptyString(revision) || !GIT_SHA_PATTERN.test(revision)) {
    throw new GreenfieldError(
      `realization plan revision must be a 40-hex git sha (the exact realized revision), received: ${JSON.stringify(revision)}`,
    );
  }
  if (!isNonEmptyString(value['environment'])) {
    throw new GreenfieldError('realization plan environment must be a non-empty string');
  }
  for (const field of ['configuration', 'deployment', 'policy', 'environment_relationships'] as const) {
    if (!Array.isArray(value[field])) {
      throw new GreenfieldError(`realization plan ${field} must be an array (W2 reference types)`);
    }
  }
}

// ---------------------------------------------------------------------------
// The human decider (stage 3b, ASK path)
// ---------------------------------------------------------------------------

/**
 * The human/authority who resolves an escalated ASK through the ask queue
 * (R16: first-class ASK). When the decision stage escalates and a decider
 * is supplied, the ask is resolved through @sos-2/ask's queue (the
 * resolution DecisionRecord carries the provenance of who resolved it and
 * binds to the origin's exact input digest). `chosen_alternative_id` may
 * be null, meaning the FIRST ACT-action alternative of the composed ask
 * (a deterministic, documented choice — never an implicit default rule).
 */
export interface GreenfieldAskDecider {
  resolved_by: string;
  /** The chosen alternative id, or null = the first ACT alternative. */
  chosen_alternative_id: string | null;
  /** The resolver's auditable note. */
  note: string;
}

/** Validate a decider (throws GreenfieldError). */
export function assertValidGreenfieldAskDecider(value: unknown): asserts value is GreenfieldAskDecider {
  if (!isPlainObject(value)) {
    throw new GreenfieldError(`decider must be an object, received: ${JSON.stringify(value)}`);
  }
  if (!isNonEmptyString(value['resolved_by'])) {
    throw new GreenfieldError('decider resolved_by must be a non-empty string (who resolved the ask)');
  }
  if (value['chosen_alternative_id'] !== null && !isNonEmptyString(value['chosen_alternative_id'])) {
    throw new GreenfieldError('decider chosen_alternative_id must be null or a non-empty alternative id');
  }
  if (!isNonEmptyString(value['note'])) {
    throw new GreenfieldError('decider note must be a non-empty string (every resolution is auditable)');
  }
}

export type { RawObservation };
