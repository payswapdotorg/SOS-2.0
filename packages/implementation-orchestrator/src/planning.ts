/**
 * ARCHITECTURE / CAPABILITY PLANNING (Work Order P13) — the §11 journey
 * stages "architecture/capability plan -> candidate + assurance".
 *
 * The ImplementationPlan is a TYPED, INSPECTABLE, CONTENT-ADDRESSED
 * RECORD: the mission link, the capability requirements the implementation
 * needs, the CANDIDATE STRUCTURE (the planned components — what the
 * realized system will contain) and the ASSURANCE CONSTRAINTS (which P9
 * evaluators must pass, with the bounded repair attempts the P9 repair
 * discipline allows).
 *
 * THE PLAN IS DATA, NEVER AN INTERPRETER: nothing in this package executes
 * a plan. The greenfield runtime turns a plan into P6 task-graph nodes
 * (decomposition.ts) and drives them; the plan itself carries zero
 * imperatives.
 *
 * Planning runs through the INJECTABLE ArchitecturePlannerPort (the
 * replaceable brain — managed default, BYO optional; output is typed
 * records validated here and never authoritative). When the planner
 * cannot produce a complete plan, it answers a TYPED ASK — planning never
 * guesses.
 */

import { contentAddress } from '@sos-2/action-gateway';
import type { FileChange } from '@sos-2/action-gateway';
import type { EvaluationType } from '@sos-2/evaluator';
import { EVALUATION_TYPES } from '@sos-2/evaluator';
import type { HarnessCapability, HarnessPlacement } from '@sos-2/harness';
import { HARNESS_CAPABILITIES } from '@sos-2/harness';
import type { MissionArtifact } from '@sos-2/mission';
import { assertValidMission } from '@sos-2/mission';
import type { JsonValue } from '@sos-2/semantic-spine';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { InvalidImplementationPlanError } from './errors.js';
import type { PipelineAsk } from './asks.js';

/** A capability the implementation requires (mission-level requirement). */
export interface CapabilityRequirement {
  /** Local slug id (unique within the plan). */
  readonly id: string;
  readonly description: string;
  /** The §3 harness capabilities the requirement maps onto (validated vocabulary). */
  readonly harnessCapabilities: readonly HarnessCapability[];
}

/** An assurance constraint — which P9 evaluator must pass before work counts. */
export interface AssuranceConstraint {
  /** Local slug id (unique within the plan). */
  readonly id: string;
  readonly description: string;
  /** The P9 evaluation type that must pass (validated vocabulary). */
  readonly evaluationType: EvaluationType;
}

/** One planned file of a component (path + exact deterministic contents). */
export interface PlannedFile {
  readonly path: string;
  readonly contents: string;
}

/**
 * One component of the CANDIDATE STRUCTURE: a coherent unit of the
 * realized system with an exclusive owned-path scope, its files, its body
 * capability requirements and its per-node evaluation requirements.
 */
export interface PlannedComponent {
  /** Local slug id (unique within the plan; also names the derived task). */
  readonly id: string;
  readonly title: string;
  /** The exclusive owned-path scope (disjoint from every other component). */
  readonly ownedPaths: readonly string[];
  /** The files this component contributes to the realized repository. */
  readonly files: readonly PlannedFile[];
  /** Body capabilities required to implement this component (§3 vocabulary). */
  readonly requiredCapabilities: readonly HarnessCapability[];
  /** Body placement required (the flagship journey summons CLOUD bodies). */
  readonly placement: HarnessPlacement;
  /** Which P9 evaluators must pass before this component's task counts complete. */
  readonly evaluationTypes: readonly EvaluationType[];
  /** Component ids this component depends on (edges of the work graph). */
  readonly dependsOn: readonly string[];
}

/** The typed implementation plan — DATA for the P6 task graph. */
export interface ImplementationPlan {
  /** Content-derived deterministic id. */
  readonly planId: string;
  /** The formalized mission this plan realizes (sos://Mission/...). */
  readonly missionRef: string;
  /** RFC3339 planning instant (caller-supplied; no hidden clocks). */
  readonly createdAt: string;
  /** Mission-level capability requirements. */
  readonly capabilityRequirements: readonly CapabilityRequirement[];
  /** Assurance constraints — the P9 evaluators that gate completion. */
  readonly assuranceConstraints: readonly AssuranceConstraint[];
  /** The candidate structure (the planned components). */
  readonly components: readonly PlannedComponent[];
  /** Bounded repair attempts before the P9 repair discipline escalates to ASK. */
  readonly maxRepairAttempts: number;
}

/** The typed outcome of planning. */
export type PlanningOutcome =
  | { readonly kind: 'PLANNED'; readonly plan: ImplementationPlan }
  | { readonly kind: 'ASK'; readonly ask: PipelineAsk };

/**
 * The planning seam. Implementations are replaceable MECHANISMS; their
 * output is validated here and is never authority. A planner that cannot
 * produce a complete plan answers a TYPED ASK.
 */
export interface ArchitecturePlannerPort {
  plan(input: { readonly mission: MissionArtifact }): PlanningOutcome;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSlug(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);
}

function isHarnessCapability(value: unknown): value is HarnessCapability {
  return typeof value === 'string' && (HARNESS_CAPABILITIES as readonly string[]).includes(value);
}

function isEvaluationType(value: unknown): value is EvaluationType {
  return typeof value === 'string' && (EVALUATION_TYPES as readonly string[]).includes(value);
}

function isPlacement(value: unknown): value is HarnessPlacement {
  return value === 'cloud' || value === 'remote' || value === 'user-device';
}

function isFileChangeLike(value: unknown): value is FileChange {
  return isPlainObject(value) && isNonEmptyString(value['path']) && typeof value['contents'] === 'string';
}

/** Validate a capability requirement (throws InvalidImplementationPlanError). */
function assertValidCapabilityRequirement(value: unknown, at: string): asserts value is CapabilityRequirement {
  if (!isPlainObject(value)) {
    throw new InvalidImplementationPlanError(`${at} must be an object`);
  }
  const keys = Object.keys(value);
  if (keys.length !== 3 || !keys.includes('id') || !keys.includes('description') || !keys.includes('harnessCapabilities')) {
    throw new InvalidImplementationPlanError(`${at} must have the exact field set { id, description, harnessCapabilities }`);
  }
  if (!isSlug(value['id'])) {
    throw new InvalidImplementationPlanError(`${at}.id must be a lowercase slug, received: ${JSON.stringify(value['id'])}`);
  }
  if (!isNonEmptyString(value['description'])) {
    throw new InvalidImplementationPlanError(`${at}.description must be a non-empty string`);
  }
  const capabilities = value['harnessCapabilities'];
  if (
    !Array.isArray(capabilities) ||
    capabilities.length === 0 ||
    !capabilities.every(isHarnessCapability) ||
    new Set(capabilities as string[]).size !== (capabilities as string[]).length
  ) {
    throw new InvalidImplementationPlanError(
      `${at}.harnessCapabilities must be a non-empty, duplicate-free array from [${HARNESS_CAPABILITIES.join(', ')}]`,
    );
  }
}

/** Validate an assurance constraint (throws InvalidImplementationPlanError). */
function assertValidAssuranceConstraint(value: unknown, at: string): asserts value is AssuranceConstraint {
  if (!isPlainObject(value)) {
    throw new InvalidImplementationPlanError(`${at} must be an object`);
  }
  const keys = Object.keys(value);
  if (keys.length !== 3 || !keys.includes('id') || !keys.includes('description') || !keys.includes('evaluationType')) {
    throw new InvalidImplementationPlanError(`${at} must have the exact field set { id, description, evaluationType }`);
  }
  if (!isSlug(value['id'])) {
    throw new InvalidImplementationPlanError(`${at}.id must be a lowercase slug, received: ${JSON.stringify(value['id'])}`);
  }
  if (!isNonEmptyString(value['description'])) {
    throw new InvalidImplementationPlanError(`${at}.description must be a non-empty string`);
  }
  if (!isEvaluationType(value['evaluationType'])) {
    throw new InvalidImplementationPlanError(
      `${at}.evaluationType must be one of [${EVALUATION_TYPES.join(', ')}] — the P9 evaluator vocabulary is consumed, never re-defined`,
    );
  }
}

/** Validate a planned component (throws InvalidImplementationPlanError). */
function assertValidPlannedComponent(value: unknown, at: string): asserts value is PlannedComponent {
  if (!isPlainObject(value)) {
    throw new InvalidImplementationPlanError(`${at} must be an object`);
  }
  const keys = Object.keys(value);
  const expected = ['id', 'title', 'ownedPaths', 'files', 'requiredCapabilities', 'placement', 'evaluationTypes', 'dependsOn'];
  if (keys.length !== expected.length || !expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new InvalidImplementationPlanError(`${at} must have the exact field set { ${expected.join(', ')} }`);
  }
  if (!isSlug(value['id'])) {
    throw new InvalidImplementationPlanError(`${at}.id must be a lowercase slug, received: ${JSON.stringify(value['id'])}`);
  }
  if (!isNonEmptyString(value['title'])) {
    throw new InvalidImplementationPlanError(`${at}.title must be a non-empty string`);
  }
  const ownedPaths = value['ownedPaths'];
  if (
    !Array.isArray(ownedPaths) ||
    ownedPaths.length === 0 ||
    !ownedPaths.every(isNonEmptyString) ||
    new Set(ownedPaths as string[]).size !== (ownedPaths as string[]).length ||
    (ownedPaths as string[]).some((path) => path.includes('..') || path.startsWith('/'))
  ) {
    throw new InvalidImplementationPlanError(
      `${at}.ownedPaths must be a non-empty, duplicate-free array of relative repository paths (the exclusive scope)`,
    );
  }
  const files = value['files'];
  if (!Array.isArray(files) || files.length === 0 || !files.every(isFileChangeLike)) {
    throw new InvalidImplementationPlanError(`${at}.files must be a non-empty array of { path, contents }`);
  }
  const filePaths = new Set<string>((files as FileChange[]).map((file) => file.path));
  if (filePaths.size !== (files as FileChange[]).length) {
    throw new InvalidImplementationPlanError(`${at}.files contains duplicate paths — file identity is single-use within a component`);
  }
  const capabilities = value['requiredCapabilities'];
  if (
    !Array.isArray(capabilities) ||
    capabilities.length === 0 ||
    !capabilities.every(isHarnessCapability) ||
    new Set(capabilities as string[]).size !== (capabilities as string[]).length
  ) {
    throw new InvalidImplementationPlanError(
      `${at}.requiredCapabilities must be a non-empty, duplicate-free array from [${HARNESS_CAPABILITIES.join(', ')}]`,
    );
  }
  if (!isPlacement(value['placement'])) {
    throw new InvalidImplementationPlanError(`${at}.placement must be cloud | remote | user-device`);
  }
  const evaluationTypes = value['evaluationTypes'];
  if (
    !Array.isArray(evaluationTypes) ||
    evaluationTypes.length === 0 ||
    !evaluationTypes.every(isEvaluationType) ||
    new Set(evaluationTypes as string[]).size !== (evaluationTypes as string[]).length
  ) {
    throw new InvalidImplementationPlanError(
      `${at}.evaluationTypes must be a non-empty, duplicate-free array of P9 evaluation types [${EVALUATION_TYPES.join(', ')}] — at least one evaluator must gate every node`,
    );
  }
  const dependsOn = value['dependsOn'];
  if (!Array.isArray(dependsOn) || !dependsOn.every(isSlug)) {
    throw new InvalidImplementationPlanError(`${at}.dependsOn must be an array of component slug ids`);
  }
}

/**
 * Validate an implementation plan (throws InvalidImplementationPlanError):
 * shape, unique slugs, DISJOINT owned-path scopes across components (a
 * collision is a loud structural error — the P6 disjoint-scope rule),
 * dependency edges that resolve and stay ACYCLIC, and a positive repair
 * bound.
 */
export function assertValidImplementationPlan(value: unknown): asserts value is ImplementationPlan {
  if (!isPlainObject(value)) {
    throw new InvalidImplementationPlanError('implementation plan must be an object');
  }
  const keys = Object.keys(value);
  const expected = [
    'planId',
    'missionRef',
    'createdAt',
    'capabilityRequirements',
    'assuranceConstraints',
    'components',
    'maxRepairAttempts',
  ];
  if (keys.length !== expected.length || !expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw new InvalidImplementationPlanError(`implementation plan must have the exact field set { ${expected.join(', ')} }`);
  }
  if (!isNonEmptyString(value['planId'])) {
    throw new InvalidImplementationPlanError('planId must be a non-empty string');
  }
  if (typeof value['missionRef'] !== 'string' || !value['missionRef'].startsWith('sos://Mission/')) {
    throw new InvalidImplementationPlanError(
      `missionRef must be a well-formed sos://Mission/... spine artifact id — the plan is mission-linked, received: ${JSON.stringify(value['missionRef'])}`,
    );
  }
  if (typeof value['createdAt'] !== 'string' || value['createdAt'].length === 0) {
    throw new InvalidImplementationPlanError('createdAt must be a non-empty RFC3339 string');
  }
  if (!Array.isArray(value['capabilityRequirements']) || value['capabilityRequirements'].length === 0) {
    throw new InvalidImplementationPlanError('capabilityRequirements must be a non-empty array — every plan states what it needs');
  }
  (value['capabilityRequirements'] as unknown[]).forEach((requirement, index) => {
    assertValidCapabilityRequirement(requirement, `capabilityRequirements[${index}]`);
  });
  if (!Array.isArray(value['assuranceConstraints']) || value['assuranceConstraints'].length === 0) {
    throw new InvalidImplementationPlanError('assuranceConstraints must be a non-empty array — completion is evaluation-gated');
  }
  (value['assuranceConstraints'] as unknown[]).forEach((constraint, index) => {
    assertValidAssuranceConstraint(constraint, `assuranceConstraints[${index}]`);
  });
  if (!Array.isArray(value['components']) || value['components'].length === 0) {
    throw new InvalidImplementationPlanError('components must be a non-empty array — the candidate structure is the plan');
  }
  (value['components'] as unknown[]).forEach((component, index) => {
    assertValidPlannedComponent(component, `components[${index}]`);
  });
  const plan = value as unknown as ImplementationPlan;

  const requirementIds = new Set<string>();
  for (const requirement of plan.capabilityRequirements) {
    if (requirementIds.has(requirement.id)) {
      throw new InvalidImplementationPlanError(`duplicate capability requirement id ${JSON.stringify(requirement.id)}`);
    }
    requirementIds.add(requirement.id);
  }
  const constraintIds = new Set<string>();
  for (const constraint of plan.assuranceConstraints) {
    if (constraintIds.has(constraint.id)) {
      throw new InvalidImplementationPlanError(`duplicate assurance constraint id ${JSON.stringify(constraint.id)}`);
    }
    constraintIds.add(constraint.id);
  }
  const componentIds = new Set<string>();
  for (const component of plan.components) {
    if (componentIds.has(component.id)) {
      throw new InvalidImplementationPlanError(`duplicate component id ${JSON.stringify(component.id)} — component identity is single-use`);
    }
    componentIds.add(component.id);
  }
  // Disjoint owned-path scopes across ALL components (they may run concurrently).
  for (let i = 0; i < plan.components.length; i += 1) {
    for (let j = i + 1; j < plan.components.length; j += 1) {
      const a = plan.components[i]!;
      const b = plan.components[j]!;
      for (const pathA of a.ownedPaths) {
        for (const pathB of b.ownedPaths) {
          if (pathA === pathB || pathA.startsWith(`${pathB}/`) || pathB.startsWith(`${pathA}/`)) {
            throw new InvalidImplementationPlanError(
              `owned-path scope collision between components ${JSON.stringify(a.id)} [${a.ownedPaths.join(', ')}] and ${JSON.stringify(b.id)} [${b.ownedPaths.join(', ')}] — concurrent components own DISJOINT scopes, never a silent overlap`,
            );
          }
        }
      }
    }
  }
  // Dependency edges resolve and stay acyclic.
  for (const component of plan.components) {
    for (const dependency of component.dependsOn) {
      if (!componentIds.has(dependency)) {
        throw new InvalidImplementationPlanError(
          `component ${JSON.stringify(component.id)} depends on unknown component ${JSON.stringify(dependency)} — no orphaned edges`,
        );
      }
      if (dependency === component.id) {
        throw new InvalidImplementationPlanError(`component ${JSON.stringify(component.id)} depends on itself — the work graph is acyclic`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      throw new InvalidImplementationPlanError(`dependency cycle through component ${JSON.stringify(id)} — the work graph is acyclic`);
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const component = plan.components.find((candidate) => candidate.id === id);
    for (const dependency of component?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const component of plan.components) visit(component.id);
  if (typeof value['maxRepairAttempts'] !== 'number' || !Number.isInteger(value['maxRepairAttempts']) || value['maxRepairAttempts'] < 1) {
    throw new InvalidImplementationPlanError(
      `maxRepairAttempts must be a positive integer (the P9 bounded repair discipline — never an unbounded loop), received: ${JSON.stringify(value['maxRepairAttempts'])}`,
    );
  }
}

/** Derive the deterministic plan id for a plan body (without the id field). */
export function implementationPlanId(input: Omit<ImplementationPlan, 'planId'>): string {
  return contentAddress(
    {
      missionRef: input.missionRef,
      createdAt: input.createdAt,
      capabilityRequirements: input.capabilityRequirements,
      assuranceConstraints: input.assuranceConstraints,
      components: input.components,
      maxRepairAttempts: input.maxRepairAttempts,
    },
    'implementation-plan',
  );
}

/** Assemble + validate a plan (the plan id is derived, never caller-supplied). */
export function buildImplementationPlan(input: Omit<ImplementationPlan, 'planId'>): ImplementationPlan {
  const plan: ImplementationPlan = { ...input, planId: implementationPlanId(input) };
  assertValidImplementationPlan(plan);
  return plan;
}

/** The canonical serialization of a plan (for evidence + reproducibility). */
export function serializeImplementationPlan(plan: ImplementationPlan): string {
  return canonicalSerialize(plan as unknown as JsonValue);
}

/**
 * Run planning: validate the mission, route it through the injected
 * planner and return the TYPED outcome. A produced plan is re-validated
 * through this package's own structural guards — the seam's output is
 * validated, never trusted.
 */
export function runPlanning(input: { mission: MissionArtifact }, planner: ArchitecturePlannerPort): PlanningOutcome {
  assertValidMission(input.mission);
  if (typeof planner !== 'object' || planner === null || typeof planner.plan !== 'function') {
    throw new InvalidImplementationPlanError('runPlanning requires an injected ArchitecturePlannerPort (no hidden mechanisms)');
  }
  const outcome = planner.plan({ mission: input.mission });
  if (outcome.kind === 'ASK') {
    return { kind: 'ASK', ask: outcome.ask };
  }
  assertValidImplementationPlan(outcome.plan);
  if (outcome.plan.missionRef !== input.mission.envelope.id) {
    throw new InvalidImplementationPlanError(
      `the plan's mission link ${JSON.stringify(outcome.plan.missionRef)} does not match the formalized mission ${JSON.stringify(input.mission.envelope.id)} — plans are mission-linked`,
    );
  }
  return { kind: 'PLANNED', plan: outcome.plan };
}
