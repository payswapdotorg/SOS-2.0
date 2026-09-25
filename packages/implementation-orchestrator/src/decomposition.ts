/**
 * WORKER DECOMPOSITION (Work Order P13) — the §11 journey stage
 * "worker task graph".
 *
 * Turns an ImplementationPlan into TYPED TASK-NODE SPECS for the P6
 * durable task graph (@sos-2/task-graph — THIS graph, consumed never
 * re-defined): one spec per planned component, with
 *
 *   - DEPENDENCY EDGES derived from the component graph (validated
 *     acyclic by the plan's own guards),
 *   - CAPABILITY REQUIREMENTS per node (which §3 body capabilities the
 *     assigned body must advertise, and the placement it must run at),
 *   - EVALUATION REQUIREMENTS per node (which P9 evaluators must pass
 *     before the node counts complete — the no-self-approval gate),
 *   - the WORK PROGRAM as canonical JSON (the component's files + intent —
 *     data the summoned body realizes, never an interpreter).
 *
 * The decomposition is DETERMINISTIC CODE over the plan (the P6
 * decomposeMissionDeterministically discipline): no reasoning provider,
 * no randomness, no clocks. Task ids are derived runtime identifiers
 * (`p13-<component-id>`) — never minted semantic identities.
 */

import type { EvaluationType } from '@sos-2/evaluator';
import type { HarnessCapability, HarnessPlacement } from '@sos-2/harness';
import type { JsonValue } from '@sos-2/semantic-spine';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { InvalidDecompositionError } from './errors.js';
import type { ImplementationPlan, PlannedComponent } from './planning.js';
import { assertValidImplementationPlan } from './planning.js';

/** The typed work program a node carries (canonical JSON in the P6 steps field). */
export interface TaskWorkProgram {
  /** What the node realizes (human-readable intent). */
  readonly intent: string;
  /** The planned files (path + exact deterministic contents). */
  readonly files: readonly { readonly path: string; readonly contents: string }[];
  /** The component id this node realizes (plan traceability). */
  readonly componentId: string;
}

/** One typed task-node spec — the P6 graph input (plus P13 requirements). */
export interface TaskNodeSpec {
  /** Derived runtime identifier (caller of graph.addNode supplies it verbatim). */
  readonly taskId: string;
  readonly title: string;
  /** The exclusive owned-path scope (disjoint across concurrent nodes). */
  readonly ownedPaths: readonly string[];
  /** Dependency edges (task ids; acyclic by construction). */
  readonly dependencies: readonly string[];
  /** Body capability requirements for assignment (§3 vocabulary). */
  readonly requiredCapabilities: readonly HarnessCapability[];
  /** Required body placement (the flagship journey summons CLOUD bodies). */
  readonly placement: HarnessPlacement;
  /** Which P9 evaluators must pass before this node counts complete. */
  readonly evaluationTypes: readonly EvaluationType[];
  /** The work program (canonical JSON — data, never an interpreter). */
  readonly steps: JsonValue;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a work program (throws InvalidDecompositionError). */
export function assertValidTaskWorkProgram(value: unknown): asserts value is TaskWorkProgram {
  if (!isPlainObject(value)) {
    throw new InvalidDecompositionError('task work program must be an object { intent, files, componentId }');
  }
  const keys = Object.keys(value);
  if (keys.length !== 3 || !keys.includes('intent') || !keys.includes('files') || !keys.includes('componentId')) {
    throw new InvalidDecompositionError('task work program must have the exact field set { intent, files, componentId }');
  }
  if (typeof value['intent'] !== 'string' || value['intent'].length === 0) {
    throw new InvalidDecompositionError('task work program intent must be a non-empty string');
  }
  if (typeof value['componentId'] !== 'string' || value['componentId'].length === 0) {
    throw new InvalidDecompositionError('task work program componentId must be a non-empty string');
  }
  const files = value['files'];
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    !files.every(
      (file) =>
        isPlainObject(file) && typeof file['path'] === 'string' && (file['path'] as string).length > 0 && typeof file['contents'] === 'string',
    )
  ) {
    throw new InvalidDecompositionError('task work program files must be a non-empty array of { path, contents }');
  }
}

/** Parse a node's steps back into the typed work program (throws when malformed). */
export function parseTaskWorkProgram(steps: JsonValue): TaskWorkProgram {
  assertValidTaskWorkProgram(steps);
  return {
    intent: steps['intent'] as string,
    componentId: steps['componentId'] as string,
    files: (steps['files'] as { path: string; contents: string }[]).map((file) => ({ path: file.path, contents: file.contents })),
  };
}

/** The deterministic task id for a planned component. */
export function taskIdForComponent(componentId: string): string {
  return `p13-${componentId}`;
}

/** The work program of a planned component (canonical JSON data). */
export function workProgramForComponent(component: PlannedComponent): TaskWorkProgram {
  return {
    intent: component.title,
    componentId: component.id,
    files: component.files.map((file) => ({ path: file.path, contents: file.contents })),
  };
}

/**
 * Decompose a plan into typed task-node specs — deterministic code over
 * the validated plan: one spec per component, dependencies derived from
 * the component graph. The scopes are disjoint and the edges acyclic
 * because the plan's own guards already pinned it; the decomposition
 * re-checks and fails loudly otherwise (defense in depth).
 */
export function decomposePlan(plan: ImplementationPlan): TaskNodeSpec[] {
  assertValidImplementationPlan(plan);
  const specs = plan.components.map((component): TaskNodeSpec => {
    const program = workProgramForComponent(component);
    return {
      taskId: taskIdForComponent(component.id),
      title: component.title,
      ownedPaths: [...component.ownedPaths],
      dependencies: component.dependsOn.map((dependency) => taskIdForComponent(dependency)),
      requiredCapabilities: [...component.requiredCapabilities],
      placement: component.placement,
      evaluationTypes: [...component.evaluationTypes],
      steps: JSON.parse(canonicalSerialize(program)) as JsonValue,
    };
  });
  assertValidDecomposition(specs);
  return specs;
}

/** Validate a decomposition (throws InvalidDecompositionError). */
export function assertValidDecomposition(specs: readonly TaskNodeSpec[]): void {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new InvalidDecompositionError('a decomposition must be a non-empty array of task node specs');
  }
  const ids = new Set<string>();
  for (const spec of specs) {
    if (typeof spec.taskId !== 'string' || spec.taskId.length === 0 || spec.taskId.includes('sos://')) {
      throw new InvalidDecompositionError(
        `task id must be a non-empty RUNTIME identifier (never sos:// shaped), received: ${JSON.stringify(spec.taskId)}`,
      );
    }
    if (ids.has(spec.taskId)) {
      throw new InvalidDecompositionError(`duplicate task id ${JSON.stringify(spec.taskId)} — task ids are single-use`);
    }
    ids.add(spec.taskId);
    assertValidTaskWorkProgram(spec.steps);
    if (spec.ownedPaths.length === 0) {
      throw new InvalidDecompositionError(`task ${JSON.stringify(spec.taskId)} carries an empty owned-path scope — every task owns a scope`);
    }
    if (spec.requiredCapabilities.length === 0) {
      throw new InvalidDecompositionError(`task ${JSON.stringify(spec.taskId)} carries no capability requirements — assignment is capability-based`);
    }
    if (spec.evaluationTypes.length === 0) {
      throw new InvalidDecompositionError(
        `task ${JSON.stringify(spec.taskId)} carries no evaluation requirements — a node never counts complete without its evaluator gate`,
      );
    }
  }
  // Disjoint scopes across every spec (concurrent safety — the P6 rule).
  for (let i = 0; i < specs.length; i += 1) {
    for (let j = i + 1; j < specs.length; j += 1) {
      const a = specs[i]!;
      const b = specs[j]!;
      for (const pathA of a.ownedPaths) {
        for (const pathB of b.ownedPaths) {
          if (pathA === pathB || pathA.startsWith(`${pathB}/`) || pathB.startsWith(`${pathA}/`)) {
            throw new InvalidDecompositionError(
              `owned-path scope collision between tasks ${JSON.stringify(a.taskId)} and ${JSON.stringify(b.taskId)} — concurrent tasks own DISJOINT scopes`,
            );
          }
        }
      }
    }
  }
  // Edges resolve + stay acyclic.
  for (const spec of specs) {
    for (const dependency of spec.dependencies) {
      if (!ids.has(dependency)) {
        throw new InvalidDecompositionError(`task ${JSON.stringify(spec.taskId)} depends on unknown task ${JSON.stringify(dependency)}`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      throw new InvalidDecompositionError(`dependency cycle through task ${JSON.stringify(id)} — the work graph is acyclic`);
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const spec = specs.find((candidate) => candidate.taskId === id);
    for (const dependency of spec?.dependencies ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const spec of specs) visit(spec.taskId);
}
