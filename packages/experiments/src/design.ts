/**
 * Experiment DESIGN — the typed design vocabulary of the controlled
 * evolution plane (Work Order W9; spec/architecture.md §5:
 * "Experiment: treatment/control or alternatives, population, allocation,
 * metrics, guardrails, stopping and rollback criteria").
 *
 * Everything here is a REALIZATION of frozen semantics, never a redefinition
 * (spec/architecture-lock.md: "Experiment semantics" is outside ordinary
 * redefinition). The design vocabulary is deliberately closed and typed:
 *
 *   design kinds     TREATMENT_CONTROL (exactly one control + one treatment)
 *                    or ALTERNATIVES (>= 2 alternative arms, no control)
 *   allocation units the typed unit of assignment (REQUEST, SESSION, USER,
 *                    SERVICE_INSTANCE, DEPLOYMENT) — allocation and
 *                    population must agree on the SAME typed unit
 *   assignment modes RANDOM or DETERMINISTIC_HASH
 *   metric roles     PRIMARY (>= 1), SECONDARY (>= 0) and GUARDRAIL (>= 1 —
 *                    guardrails are MANDATORY: "before optimizing any
 *                    metric, define population, denominator, validity,
 *                    confounders, guardrails and stopping rules",
 *                    docs/probabilistic-learning.md)
 *   stopping rules   MAX_SAMPLES, MAX_DURATION_SECONDS, EARLY_SUCCESS and
 *                    SAFETY — typed criteria with exact conditions
 *   rollback rules   one per rollback criterion, each wired to explicit
 *                    guardrail metric ids (rollback triggers are wired to
 *                    experiment guardrail records, never free-floating)
 *
 * docs/probabilistic-learning.md discipline is baked in: a design without a
 * declared population, without typed allocation, without guardrails or
 * without stopping rules is REJECTED at construction — never minted.
 */

import { isArtifactId } from '@sos-2/semantic-spine';
import { ExperimentError } from './errors.js';

// ---------------------------------------------------------------------------
// Design kinds
// ---------------------------------------------------------------------------

export const EXPERIMENT_DESIGN_KINDS = ['TREATMENT_CONTROL', 'ALTERNATIVES'] as const;

export type ExperimentDesignKind = (typeof EXPERIMENT_DESIGN_KINDS)[number];

const DESIGN_KIND_SET: ReadonlySet<string> = new Set(EXPERIMENT_DESIGN_KINDS);

/** Structural check: is this one of the two design kinds? */
export function isExperimentDesignKind(value: unknown): value is ExperimentDesignKind {
  return typeof value === 'string' && DESIGN_KIND_SET.has(value);
}

// ---------------------------------------------------------------------------
// Typed allocation units and assignment modes
// ---------------------------------------------------------------------------

export const ALLOCATION_UNITS = [
  'REQUEST',
  'SESSION',
  'USER',
  'SERVICE_INSTANCE',
  'DEPLOYMENT',
] as const;

export type AllocationUnit = (typeof ALLOCATION_UNITS)[number];

const ALLOCATION_UNIT_SET: ReadonlySet<string> = new Set(ALLOCATION_UNITS);

/** Structural check: is this one of the typed allocation units? */
export function isAllocationUnit(value: unknown): value is AllocationUnit {
  return typeof value === 'string' && ALLOCATION_UNIT_SET.has(value);
}

export const ASSIGNMENT_MODES = ['RANDOM', 'DETERMINISTIC_HASH'] as const;

export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];

const ASSIGNMENT_MODE_SET: ReadonlySet<string> = new Set(ASSIGNMENT_MODES);

/** Structural check: is this one of the two assignment modes? */
export function isAssignmentMode(value: unknown): value is AssignmentMode {
  return typeof value === 'string' && ASSIGNMENT_MODE_SET.has(value);
}

// ---------------------------------------------------------------------------
// Arms
// ---------------------------------------------------------------------------

export const ARM_ROLES = ['CONTROL', 'TREATMENT', 'ALTERNATIVE'] as const;

export type ArmRole = (typeof ARM_ROLES)[number];

/** An experiment arm: a candidate variant exposed to part of the population. */
export interface Arm {
  /** Arm id, unique within the experiment design (non-empty). */
  id: string;
  /** The arm's role. */
  role: ArmRole;
  /**
   * The CandidateState spine id exposed in this arm, or null for the CONTROL
   * arm (the control is the current/baseline system, not a candidate).
   */
  candidate_ref: string | null;
}

// ---------------------------------------------------------------------------
// Population and allocation
// ---------------------------------------------------------------------------

/**
 * The declared POPULATION (docs/probabilistic-learning.md: population and
 * denominator are defined BEFORE optimizing any metric).
 */
export interface Population {
  /** What population is experimented on (non-empty description). */
  description: string;
  /** The typed unit of allocation for this population. */
  unit: AllocationUnit;
  /** Cohort/context facts (>= 1 fact — an empty context carries no applicability information). */
  context: Record<string, unknown>;
}

/**
 * The declared ALLOCATION semantics: typed unit + assignment mode + arms +
 * ratios.
 */
export interface Allocation {
  /** The typed unit of assignment (must EQUAL the population unit). */
  unit: AllocationUnit;
  /** How units are assigned to arms. */
  assignment: AssignmentMode;
  /** The arms (validated against the design kind — see below). */
  arms: Arm[];
  /**
   * Allocation ratio weights, aligned with `arms` by index (positive
   * integers; a fixed integer ratio keeps allocation semantics explicit and
   * deterministic).
   */
  ratios: number[];
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export const METRIC_ROLES = ['PRIMARY', 'SECONDARY', 'GUARDRAIL'] as const;

export type MetricRole = (typeof METRIC_ROLES)[number];

const METRIC_ROLE_SET: ReadonlySet<string> = new Set(METRIC_ROLES);

export const METRIC_DIRECTIONS = ['INCREASE', 'DECREASE'] as const;

export type MetricDirection = (typeof METRIC_DIRECTIONS)[number];

const METRIC_DIRECTION_SET: ReadonlySet<string> = new Set(METRIC_DIRECTIONS);

/**
 * A declared experiment metric. Guardrail metrics REQUIRE an explicit
 * breach threshold: a guardrail without a threshold cannot be evaluated and
 * is rejected at construction.
 */
export interface ExperimentMetric {
  /** Metric id, unique within the design (non-empty). */
  id: string;
  /** PRIMARY, SECONDARY or GUARDRAIL. */
  role: MetricRole;
  /** What the metric measures (non-empty). */
  description: string;
  /** The direction of improvement. */
  direction: MetricDirection;
  /**
   * The breach threshold for GUARDRAIL metrics (required for GUARDRAIL,
   * forbidden otherwise): an INCREASE guardrail is breached when the
   * observed value falls strictly below it; a DECREASE guardrail is breached
   * when the observed value rises strictly above it.
   */
  guardrail_threshold?: number;
}

// ---------------------------------------------------------------------------
// Stopping and rollback criteria
// ---------------------------------------------------------------------------

export const STOPPING_CRITERION_KINDS = [
  'MAX_SAMPLES',
  'MAX_DURATION_SECONDS',
  'EARLY_SUCCESS',
  'SAFETY',
] as const;

export type StoppingCriterionKind = (typeof STOPPING_CRITERION_KINDS)[number];

/** A typed stopping criterion (exact conditions are evaluated per rule). */
export type StoppingCriterion =
  | { kind: 'MAX_SAMPLES'; max_samples: number }
  | { kind: 'MAX_DURATION_SECONDS'; max_duration_seconds: number }
  | { kind: 'EARLY_SUCCESS'; description: string }
  | { kind: 'SAFETY'; description: string };

/**
 * A typed rollback criterion, WIRED to explicit guardrail metric ids: the
 * rollback trigger fires exactly when a referenced guardrail is breached (or
 * cannot be established — fail-closed; see evaluation.ts).
 */
export interface RollbackCriterion {
  /** Criterion id, unique within the design (non-empty). */
  id: string;
  /** The guardrail metric ids this rollback is wired to (non-empty). */
  guardrail_metric_ids: string[];
  /** Why this rollback exists (non-empty). */
  description: string;
}

// ---------------------------------------------------------------------------
// The design
// ---------------------------------------------------------------------------

/** The full experiment design (the exact field set). */
export interface ExperimentDesign {
  /** TREATMENT_CONTROL or ALTERNATIVES. */
  kind: ExperimentDesignKind;
  /** The declared population. */
  population: Population;
  /** The declared allocation semantics. */
  allocation: Allocation;
  /** Primary (>= 1), secondary (>= 0) and guardrail (>= 1) metrics. */
  metrics: ExperimentMetric[];
  /** Stopping criteria (>= 1 — an experiment without stopping rules is rejected). */
  stopping_criteria: StoppingCriterion[];
  /** Rollback criteria (>= 1, each wired to guardrail metric ids). */
  rollback_criteria: RollbackCriterion[];
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return true;
  }
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      return value.every((entry) => isPlainJsonValue(entry));
    }
    return Object.values(value).every((entry) => isPlainJsonValue(entry));
  }
  return false;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

// ---------------------------------------------------------------------------
// Arm validation (per design kind)
// ---------------------------------------------------------------------------

/**
 * Validate the arms against the design kind:
 *
 *   TREATMENT_CONTROL  exactly 2 arms: one CONTROL (candidate_ref null — the
 *                      control is the current system, never a candidate) and
 *                      one TREATMENT (candidate_ref non-null).
 *   ALTERNATIVES       >= 2 arms, all role ALTERNATIVE, every candidate_ref
 *                      non-null and distinct (comparing one candidate
 *                      against itself is meaningless).
 */
export function assertValidArms(arms: readonly Arm[], designKind: ExperimentDesignKind): void {
  if (!Array.isArray(arms) || arms.length < 2) {
    throw new ExperimentError(`an experiment design requires at least 2 arms, received: ${String(arms?.length)}`);
  }
  const ids = new Set<string>();
  for (const arm of arms) {
    if (!isPlainObject(arm)) {
      throw new ExperimentError('arms entries must be objects { id, role, candidate_ref }');
    }
    const keys = Object.keys(arm);
    if (keys.length !== 3 || !keys.includes('id') || !keys.includes('role') || !keys.includes('candidate_ref')) {
      throw new ExperimentError(`arm must have the exact field set { id, role, candidate_ref }, received keys: ${JSON.stringify(keys)}`);
    }
    if (!isNonEmptyString(arm.id)) {
      throw new ExperimentError(`arm id must be a non-empty string, received: ${JSON.stringify(arm.id)}`);
    }
    if (ids.has(arm.id)) {
      throw new ExperimentError(`duplicate arm id rejected: ${JSON.stringify(arm.id)}`);
    }
    ids.add(arm.id);
    if (typeof arm.role !== 'string' || !(ARM_ROLES as readonly string[]).includes(arm.role)) {
      throw new ExperimentError(`arm role must be one of ${ARM_ROLES.join(', ')}, received: ${JSON.stringify(arm.role)}`);
    }
    if (arm.candidate_ref !== null && !isArtifactId(arm.candidate_ref)) {
      throw new ExperimentError(
        `arm candidate_ref must be null or a well-formed spine artifact id, received: ${JSON.stringify(arm.candidate_ref)}`,
      );
    }
  }
  if (designKind === 'TREATMENT_CONTROL') {
    if (arms.length !== 2) {
      throw new ExperimentError(
        `TREATMENT_CONTROL requires exactly 2 arms (one CONTROL, one TREATMENT), received: ${arms.length}`,
      );
    }
    const control = arms.find((arm) => arm.role === 'CONTROL');
    const treatment = arms.find((arm) => arm.role === 'TREATMENT');
    if (control === undefined || treatment === undefined) {
      throw new ExperimentError('TREATMENT_CONTROL requires exactly one CONTROL arm and exactly one TREATMENT arm');
    }
    if (arms.filter((arm) => arm.role === 'CONTROL').length !== 1) {
      throw new ExperimentError('TREATMENT_CONTROL must have exactly one CONTROL arm');
    }
    if (arms.filter((arm) => arm.role === 'TREATMENT').length !== 1) {
      throw new ExperimentError('TREATMENT_CONTROL must have exactly one TREATMENT arm');
    }
    if (control.candidate_ref !== null) {
      throw new ExperimentError(
        'the CONTROL arm carries the current/baseline system and must have candidate_ref null ' +
          `(received: ${JSON.stringify(control.candidate_ref)})`,
      );
    }
    if (treatment.candidate_ref === null) {
      throw new ExperimentError('the TREATMENT arm must expose a candidate (candidate_ref non-null)');
    }
    return;
  }
  // ALTERNATIVES
  for (const arm of arms) {
    if (arm.role !== 'ALTERNATIVE') {
      throw new ExperimentError(
        `ALTERNATIVES designs have no CONTROL/TREATMENT roles; arm ${JSON.stringify(arm.id)} has role ${JSON.stringify(arm.role)}`,
      );
    }
    if (arm.candidate_ref === null) {
      throw new ExperimentError(`ALTERNATIVES arm ${JSON.stringify(arm.id)} must expose a candidate (candidate_ref non-null)`);
    }
  }
  const candidateRefs = arms.map((arm) => arm.candidate_ref);
  if (new Set(candidateRefs).size !== candidateRefs.length) {
    throw new ExperimentError('ALTERNATIVES arms must expose DISTINCT candidates (comparing a candidate against itself is meaningless)');
  }
}

// ---------------------------------------------------------------------------
// Full design validation
// ---------------------------------------------------------------------------

/** Validate a full ExperimentDesign (throws ExperimentError). */
export function assertValidExperimentDesign(value: unknown): asserts value is ExperimentDesign {
  if (!isPlainObject(value)) {
    throw new ExperimentError(`experiment design must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = ['kind', 'population', 'allocation', 'metrics', 'stopping_criteria', 'rollback_criteria'];
  if (Object.keys(record).length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    throw new ExperimentError(`experiment design must have the exact field set { ${keys.join(', ')} }`);
  }
  if (!isExperimentDesignKind(record['kind'])) {
    throw new ExperimentError(
      `design kind must be TREATMENT_CONTROL or ALTERNATIVES, received: ${JSON.stringify(record['kind'])}`,
    );
  }
  const designKind = record['kind'];

  // --- population ---
  const population = record['population'];
  if (!isPlainObject(population)) {
    throw new ExperimentError('population must be an object { description, unit, context }');
  }
  if (Object.keys(population).length !== 3) {
    throw new ExperimentError('population must have the exact field set { description, unit, context }');
  }
  if (!isNonEmptyString(population['description'])) {
    throw new ExperimentError(`population description must be a non-empty string, received: ${JSON.stringify(population['description'])}`);
  }
  if (!isAllocationUnit(population['unit'])) {
    throw new ExperimentError(
      `population unit must be one of the typed allocation units ${ALLOCATION_UNITS.join(', ')}, received: ${JSON.stringify(population['unit'])}`,
    );
  }
  const populationContext = population['context'];
  if (!isPlainObject(populationContext) || Object.keys(populationContext).length < 1) {
    throw new ExperimentError('population context must carry at least one fact (an empty context carries no applicability information)');
  }
  for (const [key, entry] of Object.entries(populationContext)) {
    if (key.length === 0) {
      throw new ExperimentError('population context keys must be non-empty strings');
    }
    if (!isPlainJsonValue(entry)) {
      throw new ExperimentError(`population context fact "${key}" is not a JSON value`);
    }
  }

  // --- allocation ---
  const allocation = record['allocation'];
  if (!isPlainObject(allocation)) {
    throw new ExperimentError('allocation must be an object { unit, assignment, arms, ratios }');
  }
  if (Object.keys(allocation).length !== 4) {
    throw new ExperimentError('allocation must have the exact field set { unit, assignment, arms, ratios }');
  }
  if (!isAllocationUnit(allocation['unit'])) {
    throw new ExperimentError(
      `allocation unit must be one of the typed allocation units ${ALLOCATION_UNITS.join(', ')}, received: ${JSON.stringify(allocation['unit'])}`,
    );
  }
  if (allocation['unit'] !== population['unit']) {
    throw new ExperimentError(
      `allocation unit (${JSON.stringify(allocation['unit'])}) must EQUAL the population unit (${JSON.stringify(population['unit'])}) — ` +
        'population and allocation must agree on the same typed unit of assignment',
    );
  }
  if (!isAssignmentMode(allocation['assignment'])) {
    throw new ExperimentError(
      `assignment mode must be RANDOM or DETERMINISTIC_HASH, received: ${JSON.stringify(allocation['assignment'])}`,
    );
  }
  if (!Array.isArray(allocation['arms'])) {
    throw new ExperimentError('allocation arms must be an array');
  }
  assertValidArms(allocation['arms'] as Arm[], designKind);
  const ratios = allocation['ratios'];
  const armsArray = allocation['arms'] as Arm[];
  if (!Array.isArray(ratios) || ratios.length !== armsArray.length) {
    throw new ExperimentError(
      `allocation ratios must align with arms by index (${armsArray.length} arms), received: ${
        Array.isArray(ratios) ? String(ratios.length) : 'not-an-array'
      }`,
    );
  }
  if (!ratios.every((entry) => isPositiveInteger(entry))) {
    throw new ExperimentError('allocation ratios must be positive integers (explicit fixed-ratio allocation semantics)');
  }

  // --- metrics ---
  const metrics = record['metrics'];
  if (!Array.isArray(metrics) || metrics.length === 0) {
    throw new ExperimentError('metrics must be a non-empty array');
  }
  const metricIds = new Set<string>();
  let primary = 0;
  let secondary = 0;
  let guardrail = 0;
  for (const metric of metrics) {
    if (!isPlainObject(metric)) {
      throw new ExperimentError('metrics entries must be objects { id, role, description, direction, guardrail_threshold? }');
    }
    const metricKeys = Object.keys(metric);
    if (
      metricKeys.length !== 4 &&
      !(metricKeys.length === 5 && metricKeys.includes('guardrail_threshold'))
    ) {
      throw new ExperimentError(
        'metric must have the exact field set { id, role, description, direction [, guardrail_threshold] }',
      );
    }
    if (!isNonEmptyString(metric['id'])) {
      throw new ExperimentError(`metric id must be a non-empty string, received: ${JSON.stringify(metric['id'])}`);
    }
    if (metricIds.has(metric['id'])) {
      throw new ExperimentError(`duplicate metric id rejected: ${JSON.stringify(metric['id'])}`);
    }
    metricIds.add(metric['id']);
    if (typeof metric['role'] !== 'string' || !METRIC_ROLE_SET.has(metric['role'])) {
      throw new ExperimentError(`metric role must be one of ${METRIC_ROLES.join(', ')}, received: ${JSON.stringify(metric['role'])}`);
    }
    if (!isNonEmptyString(metric['description'])) {
      throw new ExperimentError(`metric description must be a non-empty string, received: ${JSON.stringify(metric['description'])}`);
    }
    if (typeof metric['direction'] !== 'string' || !METRIC_DIRECTION_SET.has(metric['direction'])) {
      throw new ExperimentError(`metric direction must be INCREASE or DECREASE, received: ${JSON.stringify(metric['direction'])}`);
    }
    if (metric['role'] === 'PRIMARY') {
      primary += 1;
    } else if (metric['role'] === 'SECONDARY') {
      secondary += 1;
    } else {
      guardrail += 1;
    }
    if (metric['role'] === 'GUARDRAIL') {
      if (!isPlainObject(metric) || !Object.prototype.hasOwnProperty.call(metric, 'guardrail_threshold')) {
        throw new ExperimentError(
          `GUARDRAIL metric ${JSON.stringify(metric['id'])} requires an explicit guardrail_threshold ` +
            '(a guardrail without a threshold cannot be evaluated and is never minted)',
        );
      }
      const threshold = metric['guardrail_threshold'];
      if (typeof threshold !== 'number' || !Number.isFinite(threshold)) {
        throw new ExperimentError(
          `guardrail_threshold must be a finite number, received: ${JSON.stringify(threshold)}`,
        );
      }
    } else if (metricKeys.includes('guardrail_threshold')) {
      throw new ExperimentError(
        `guardrail_threshold is reserved for GUARDRAIL metrics (metric ${JSON.stringify(metric['id'])} has role ${JSON.stringify(metric['role'])})`,
      );
    }
  }
  if (primary < 1) {
    throw new ExperimentError('an experiment design requires at least one PRIMARY metric');
  }
  if (guardrail < 1) {
    throw new ExperimentError(
      'an experiment design requires at least one GUARDRAIL metric ' +
        '(guardrails are mandatory — before optimizing any metric, define population, denominator, validity, confounders, guardrails and stopping rules)',
    );
  }

  // --- stopping criteria ---
  const stopping = record['stopping_criteria'];
  if (!Array.isArray(stopping) || stopping.length === 0) {
    throw new ExperimentError(
      'stopping_criteria must be a non-empty array (an experiment without stopping rules is rejected — never minted)',
    );
  }
  for (const criterion of stopping) {
    if (!isPlainObject(criterion)) {
      throw new ExperimentError('stopping criteria entries must be typed criterion objects');
    }
    const kind = criterion['kind'];
    if (typeof kind !== 'string' || !(STOPPING_CRITERION_KINDS as readonly string[]).includes(kind)) {
      throw new ExperimentError(
        `unknown stopping criterion: ${JSON.stringify(kind)} (expected one of ${STOPPING_CRITERION_KINDS.join(', ')})`,
      );
    }
    if (kind === 'MAX_SAMPLES') {
      if (Object.keys(criterion).length !== 2 || !isPositiveInteger(criterion['max_samples'])) {
        throw new ExperimentError('MAX_SAMPLES requires exactly { kind, max_samples } with a positive integer');
      }
    } else if (kind === 'MAX_DURATION_SECONDS') {
      if (Object.keys(criterion).length !== 2 || !isPositiveInteger(criterion['max_duration_seconds'])) {
        throw new ExperimentError('MAX_DURATION_SECONDS requires exactly { kind, max_duration_seconds } with a positive integer');
      }
    } else {
      if (
        Object.keys(criterion).length !== 2 ||
        !isNonEmptyString(criterion['description'])
      ) {
        throw new ExperimentError(`${kind} requires exactly { kind, description } with a non-empty description`);
      }
    }
  }

  // --- rollback criteria ---
  const rollback = record['rollback_criteria'];
  if (!Array.isArray(rollback) || rollback.length === 0) {
    throw new ExperimentError(
      'rollback_criteria must be a non-empty array (a live change without declared rollback criteria is rejected)',
    );
  }
  const rollbackIds = new Set<string>();
  for (const criterion of rollback) {
    if (!isPlainObject(criterion)) {
      throw new ExperimentError('rollback criteria entries must be objects { id, guardrail_metric_ids, description }');
    }
    if (Object.keys(criterion).length !== 3) {
      throw new ExperimentError('rollback criterion must have the exact field set { id, guardrail_metric_ids, description }');
    }
    if (!isNonEmptyString(criterion['id'])) {
      throw new ExperimentError(`rollback criterion id must be a non-empty string, received: ${JSON.stringify(criterion['id'])}`);
    }
    if (rollbackIds.has(criterion['id'])) {
      throw new ExperimentError(`duplicate rollback criterion id rejected: ${JSON.stringify(criterion['id'])}`);
    }
    rollbackIds.add(criterion['id']);
    if (!isNonEmptyStringArray(criterion['guardrail_metric_ids'])) {
      throw new ExperimentError(
        `rollback criterion ${JSON.stringify(criterion['id'])} must be wired to at least one guardrail metric id`,
      );
    }
    const referenced = criterion['guardrail_metric_ids'];
    for (const metricId of referenced) {
      const metric = (metrics as ExperimentMetric[]).find((entry) => entry.id === metricId);
      if (metric === undefined) {
        throw new ExperimentError(
          `rollback criterion ${JSON.stringify(criterion['id'])} references unknown metric ${JSON.stringify(metricId)}`,
        );
      }
      if (metric.role !== 'GUARDRAIL') {
        throw new ExperimentError(
          `rollback criterion ${JSON.stringify(criterion['id'])} must be wired to GUARDRAIL metrics only ` +
            `(metric ${JSON.stringify(metricId)} has role ${JSON.stringify(metric.role)})`,
        );
      }
    }
    if (!isNonEmptyString(criterion['description'])) {
      throw new ExperimentError(`rollback criterion description must be a non-empty string, received: ${JSON.stringify(criterion['description'])}`);
    }
  }
}

/** Predicate form of assertValidExperimentDesign. */
export function validateExperimentDesign(value: unknown): value is ExperimentDesign {
  try {
    assertValidExperimentDesign(value);
    return true;
  } catch {
    return false;
  }
}
