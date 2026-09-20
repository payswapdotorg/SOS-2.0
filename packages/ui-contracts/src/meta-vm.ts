/**
 * MetaStateVM — the SOS self-evolution review view model (Work Order W11;
 * spec/architecture.md §16: "SOS applies the same loop to itself";
 * spec/requirements.md R20/R31).
 *
 * A READ-ONLY projection of the program's machine state — the canonical
 * development-state data (spec/development-state/implementation-state.json):
 * work orders, their statuses, dependencies, merged heads and the current
 * frontier. There is NO mutation path in this projection: the console can
 * LOOK at SOS's own evolution, never steer it (meta-adaptation cannot
 * disable the mechanism that judges meta-adaptation).
 *
 * NOTE ON THE INPUT CONTRACT: MachineStateSnapshot is a VIEW-INPUT contract
 * mirroring the canonical machine-state JSON shape. It is NOT a semantic
 * spine type and introduces no second semantic registry — the spine remains
 * the only identity authority; this type only types the governance data
 * the console displays read-only.
 */

import { UIContractError } from './errors.js';
import { assertValidRationaleChain } from './rationale.js';
import type { RationaleChain } from './rationale.js';

/**
 * The machine-state snapshot input (view-input contract mirroring
 * spec/development-state/implementation-state.json).
 */
export interface MachineStateSnapshot {
  schemaVersion: string;
  program: string;
  status: string;
  currentFrontier: string[];
  currentTask: string;
  tasks: Record<string, MachineStateTask>;
}

/** One work-order task entry of the machine state. */
export interface MachineStateTask {
  status: string;
  dependencies: string[];
  mergedAs: string | null;
}

/** One work-order row of the self-evolution review. */
export interface MetaTaskVM {
  id: string;
  status: string;
  dependencies: string[];
  mergedAs: string | null;
}

/** The self-evolution review view model (read-only). */
export interface MetaStateVM {
  program: string;
  status: string;
  frontier: string[];
  current_task: string;
  /** Work orders sorted by id (deterministic). */
  tasks: MetaTaskVM[];
  /** Number of merged work orders. */
  merged_count: number;
  /** The currently eligible work orders (sorted). */
  eligible: string[];
  /**
   * The self-evolution statement (spec/architecture.md §16): SOS applies
   * the same discipline to itself; the console is a read-only projection.
   */
  self_evolution_note: string;
  /** Upstream/downstream rationale + evidence (W11 acceptance). */
  rationale: RationaleChain;
}

export const META_SELF_EVOLUTION_NOTE =
  'SOS applies the same evolution loop to itself (spec/architecture.md section 16): work orders are versioned, ' +
  'dependency-gated and evidence-bound, and this view is a READ-ONLY projection of that meta state — the console ' +
  'can observe SOS self-evolution but never steer it (meta-adaptation cannot disable the mechanism that judges meta-adaptation).';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validate a MachineStateSnapshot (throws UIContractError). */
export function assertValidMachineStateSnapshot(value: unknown): asserts value is MachineStateSnapshot {
  if (!isPlainObject(value)) {
    throw new UIContractError(`machine state snapshot must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  for (const key of ['schemaVersion', 'program', 'status', 'currentFrontier', 'currentTask', 'tasks'] as const) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new UIContractError(`machine state snapshot is missing the field ${JSON.stringify(key)}`);
    }
  }
  if (!isNonEmptyString(record['schemaVersion']) || !isNonEmptyString(record['program']) || !isNonEmptyString(record['status'])) {
    throw new UIContractError('machine state snapshot schemaVersion, program and status must be non-empty strings');
  }
  if (!Array.isArray(record['currentFrontier']) || !record['currentFrontier'].every(isNonEmptyString)) {
    throw new UIContractError('machine state snapshot currentFrontier must be an array of work-order ids');
  }
  if (!isNonEmptyString(record['currentTask'])) {
    throw new UIContractError('machine state snapshot currentTask must be a non-empty string');
  }
  if (!isPlainObject(record['tasks'])) {
    throw new UIContractError('machine state snapshot tasks must be an object keyed by work-order id');
  }
  for (const [id, task] of Object.entries(record['tasks'])) {
    if (!isNonEmptyString(id)) {
      throw new UIContractError('machine state task ids must be non-empty strings');
    }
    if (!isPlainObject(task)) {
      throw new UIContractError(`machine state task ${JSON.stringify(id)} must be an object { status, dependencies, mergedAs }`);
    }
    const taskRecord = task as Record<string, unknown>;
    if (Object.keys(taskRecord).length !== 3 || !isNonEmptyString(taskRecord['status'])) {
      throw new UIContractError(
        `machine state task ${JSON.stringify(id)} must have the exact field set { status, dependencies, mergedAs }`,
      );
    }
    if (!Array.isArray(taskRecord['dependencies']) || !taskRecord['dependencies'].every(isNonEmptyString)) {
      throw new UIContractError(`machine state task ${JSON.stringify(id)} dependencies must be an array of work-order ids`);
    }
    if (taskRecord['mergedAs'] !== null && !isNonEmptyString(taskRecord['mergedAs'])) {
      throw new UIContractError(`machine state task ${JSON.stringify(id)} mergedAs must be null or a non-empty commit sha`);
    }
  }
}

/** Project a machine-state snapshot onto the read-only self-evolution view model. */
export function projectMetaState(
  snapshot: MachineStateSnapshot,
  rationale: RationaleChain,
): MetaStateVM {
  assertValidMachineStateSnapshot(snapshot);
  assertValidRationaleChain(rationale);
  const tasks = Object.entries(snapshot.tasks)
    .map(([id, task]) => ({
      id,
      status: task.status,
      dependencies: [...task.dependencies],
      mergedAs: task.mergedAs,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const vm: MetaStateVM = {
    program: snapshot.program,
    status: snapshot.status,
    frontier: [...snapshot.currentFrontier],
    current_task: snapshot.currentTask,
    tasks,
    merged_count: tasks.filter((task) => task.mergedAs !== null || task.status === 'BOOTSTRAP_COMPLETE').length,
    eligible: tasks.filter((task) => task.status === 'ELIGIBLE').map((task) => task.id),
    self_evolution_note: META_SELF_EVOLUTION_NOTE,
    rationale,
  };
  assertValidMetaStateVM(vm);
  return vm;
}

/** Validate a MetaStateVM (throws UIContractError). */
export function assertValidMetaStateVM(value: unknown): asserts value is MetaStateVM {
  if (!isPlainObject(value)) {
    throw new UIContractError(`meta state view model must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set([
    'program',
    'status',
    'frontier',
    'current_task',
    'tasks',
    'merged_count',
    'eligible',
    'self_evolution_note',
    'rationale',
  ]);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new UIContractError('meta state view model must have the exact W11 field set');
  }
  if (!isNonEmptyString(record['program']) || !isNonEmptyString(record['status'])) {
    throw new UIContractError('meta state view model program and status must be non-empty strings');
  }
  if (!Array.isArray(record['frontier'])) {
    throw new UIContractError('meta state view model frontier must be an array');
  }
  if (!isNonEmptyString(record['current_task'])) {
    throw new UIContractError('meta state view model current_task must be a non-empty string');
  }
  if (!Array.isArray(record['tasks'])) {
    throw new UIContractError('meta state view model tasks must be an array');
  }
  const seen = new Set<string>();
  for (const task of record['tasks'] as MetaTaskVM[]) {
    if (!isPlainObject(task) || Object.keys(task).length !== 4) {
      throw new UIContractError('meta state tasks must have the exact field set { id, status, dependencies, mergedAs }');
    }
    if (!isNonEmptyString(task.id) || seen.has(task.id)) {
      throw new UIContractError(`meta state task ids must be unique non-empty strings, received: ${JSON.stringify(task.id)}`);
    }
    seen.add(task.id);
  }
  if (typeof record['merged_count'] !== 'number' || !Number.isInteger(record['merged_count']) || record['merged_count'] < 0) {
    throw new UIContractError('meta state merged_count must be a non-negative integer');
  }
  if (!Array.isArray(record['eligible'])) {
    throw new UIContractError('meta state eligible must be an array');
  }
  if (!isNonEmptyString(record['self_evolution_note'])) {
    throw new UIContractError('meta state view model must carry the self-evolution note (read-only projection statement)');
  }
  try {
    assertValidRationaleChain(record['rationale']);
  } catch (cause) {
    throw new UIContractError(`meta state view model rationale is invalid: ${(cause as Error).message}`);
  }
}

/** Predicate form of assertValidMetaStateVM. */
export function validateMetaStateVM(value: unknown): value is MetaStateVM {
  try {
    assertValidMetaStateVM(value);
    return true;
  } catch {
    return false;
  }
}
