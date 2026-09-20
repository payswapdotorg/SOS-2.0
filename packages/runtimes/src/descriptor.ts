/**
 * Runtime descriptors — the typed runtime contract (Work Order W12:
 * "typed runtime descriptor (kind, version, capabilities, constraints)").
 *
 * A RuntimeDescriptor DECLARES a runtime: what KIND of substrate it is, its
 * VERSION, the OPERATIONS it can execute (capabilities — the host executes
 * DECLARED operations against DECLARED runtimes only) and its CONSTRAINTS
 * (typed resource/access bounds honored by concrete runtimes; the in-memory
 * reference host enforces MAX_OUTPUT_BYTES deterministically).
 *
 * PLATFORM BEHAVIOR IS CONTEXT/ADAPTER DATA (spec/architecture.md section
 * 17; Work Order W12): runtime/platform specifics live in `context_
 * constraints`, a map over TYPED, REGISTERED context dimensions consumed
 * from @sos-2/context (unknown dimensions are rejected loudly). Runtime
 * SELECTION against a context artifact is adapter-level behavior driven by
 * dimension VALUES; the execution path (RuntimeHost.execute) never reads
 * context — there is no semantic branch on platform anywhere in this
 * package.
 */

import { isRegisteredContextDimension } from '@sos-2/context';
import type { ContextArtifact, ContextDimensionSpec } from '@sos-2/context';
import { getContextDimension } from '@sos-2/context';
import { RuntimeDescriptorError } from './errors.js';

/** The runtime substrate kinds (typed vocabulary; extensible set is frozen for W12). */
export const RUNTIME_KINDS = [
  'in-memory',
  'process',
  'container',
  'edge-function',
  'vm-isolate',
] as const;

export type RuntimeKind = (typeof RUNTIME_KINDS)[number];

export function isRuntimeKind(value: unknown): value is RuntimeKind {
  return typeof value === 'string' && (RUNTIME_KINDS as readonly string[]).includes(value);
}

/** Typed resource/access constraints a runtime declares. */
export const RUNTIME_CONSTRAINT_KINDS = [
  'MAX_DURATION_MS',
  'MAX_MEMORY_MB',
  'MAX_OUTPUT_BYTES',
  'NETWORK_ACCESS',
  'FILESYSTEM_ACCESS',
] as const;

export type RuntimeConstraintKind = (typeof RUNTIME_CONSTRAINT_KINDS)[number];

export type RuntimeConstraint =
  | { kind: 'MAX_DURATION_MS'; max_ms: number }
  | { kind: 'MAX_MEMORY_MB'; max_mb: number }
  | { kind: 'MAX_OUTPUT_BYTES'; max_bytes: number }
  | { kind: 'NETWORK_ACCESS'; allowed: boolean }
  | { kind: 'FILESYSTEM_ACCESS'; allowed: boolean };

/**
 * The typed runtime descriptor. `id` is a stable, caller-assigned runtime
 * identifier (non-empty; NOT a spine artifact id — a runtime is adapter
 * plane, not a semantic artifact).
 */
export interface RuntimeDescriptor {
  /** Stable runtime identifier (e.g. "runtime:checkout-sandbox"). */
  id: string;
  /** The substrate kind. */
  kind: RuntimeKind;
  /** Runtime version (non-empty, e.g. "1.4.0"). */
  version: string;
  /** Declared operation names (non-empty, unique, non-empty strings). */
  capabilities: string[];
  /** Declared resource/access constraints. */
  constraints: RuntimeConstraint[];
  /**
   * Typed context constraints: REGISTERED context dimension name -> required
   * value (platform behavior as Context/Adapter data). May be empty
   * (unconstrained — matches any context).
   */
  context_constraints: Record<string, string>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function assertValidConstraint(value: unknown): asserts value is RuntimeConstraint {
  if (!isPlainObject(value)) {
    throw new RuntimeDescriptorError('runtime constraint must be an object');
  }
  switch (value['kind']) {
    case 'MAX_DURATION_MS':
      if (!isPositiveInteger(value['max_ms'])) {
        throw new RuntimeDescriptorError('MAX_DURATION_MS constraint requires a positive integer max_ms');
      }
      return;
    case 'MAX_MEMORY_MB':
      if (!isPositiveInteger(value['max_mb'])) {
        throw new RuntimeDescriptorError('MAX_MEMORY_MB constraint requires a positive integer max_mb');
      }
      return;
    case 'MAX_OUTPUT_BYTES':
      if (!isPositiveInteger(value['max_bytes'])) {
        throw new RuntimeDescriptorError('MAX_OUTPUT_BYTES constraint requires a positive integer max_bytes');
      }
      return;
    case 'NETWORK_ACCESS':
    case 'FILESYSTEM_ACCESS':
      if (typeof value['allowed'] !== 'boolean') {
        throw new RuntimeDescriptorError(`${value['kind']} constraint requires a boolean allowed`);
      }
      return;
    default:
      throw new RuntimeDescriptorError(
        `runtime constraint kind must be one of ${RUNTIME_CONSTRAINT_KINDS.join(' | ')}, received: ${JSON.stringify(value['kind'])}`,
      );
  }
}

function assertValidContextConstraints(value: unknown): asserts value is Record<string, string> {
  if (!isPlainObject(value)) {
    throw new RuntimeDescriptorError('runtime context_constraints must be an object (dimension name -> required value)');
  }
  for (const [dimension, requiredValue] of Object.entries(value)) {
    if (!isRegisteredContextDimension(dimension)) {
      throw new RuntimeDescriptorError(
        `runtime context constraint references an UNKNOWN context dimension: ${JSON.stringify(dimension)} ` +
          '(platform behavior is Context/Adapter data — register extensions through @sos-2/context first)',
      );
    }
    if (!isNonEmptyString(requiredValue)) {
      throw new RuntimeDescriptorError(
        `runtime context constraint for ${JSON.stringify(dimension)} must be a non-empty string value`,
      );
    }
  }
}

/** Full semantic validation of a runtime descriptor (throws RuntimeDescriptorError). */
export function assertValidRuntimeDescriptor(value: unknown): asserts value is RuntimeDescriptor {
  if (!isPlainObject(value)) {
    throw new RuntimeDescriptorError('runtime descriptor must be an object');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = ['id', 'kind', 'version', 'capabilities', 'constraints', 'context_constraints'];
  if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) {
    throw new RuntimeDescriptorError(
      `runtime descriptor must have the exact field set { ${expected.join(', ')} }`,
    );
  }
  if (!isNonEmptyString(record['id'])) {
    throw new RuntimeDescriptorError(`runtime id must be a non-empty string, received: ${JSON.stringify(record['id'])}`);
  }
  if (!isRuntimeKind(record['kind'])) {
    throw new RuntimeDescriptorError(
      `runtime kind must be one of ${RUNTIME_KINDS.join(' | ')}, received: ${JSON.stringify(record['kind'])}`,
    );
  }
  if (!isNonEmptyString(record['version'])) {
    throw new RuntimeDescriptorError(`runtime version must be a non-empty string, received: ${JSON.stringify(record['version'])}`);
  }
  const capabilities = record['capabilities'];
  if (
    !Array.isArray(capabilities) ||
    capabilities.length === 0 ||
    !capabilities.every(isNonEmptyString) ||
    new Set(capabilities as string[]).size !== (capabilities as string[]).length
  ) {
    throw new RuntimeDescriptorError(
      'runtime capabilities must be a non-empty, duplicate-free array of non-empty operation names (the host executes DECLARED operations)',
    );
  }
  if (!Array.isArray(record['constraints'])) {
    throw new RuntimeDescriptorError('runtime constraints must be an array');
  }
  for (const constraint of record['constraints']) {
    assertValidConstraint(constraint);
  }
  const constraintKinds = (record['constraints'] as RuntimeConstraint[]).map((constraint) => constraint.kind);
  if (new Set(constraintKinds).size !== constraintKinds.length) {
    throw new RuntimeDescriptorError('runtime constraints must be duplicate-free (one constraint per kind)');
  }
  assertValidContextConstraints(record['context_constraints']);
}

/** Predicate form of assertValidRuntimeDescriptor. */
export function validateRuntimeDescriptor(value: unknown): value is RuntimeDescriptor {
  try {
    assertValidRuntimeDescriptor(value);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Context matching (platform behavior is Context/Adapter data)
// ---------------------------------------------------------------------------

/**
 * Does `descriptor` match `context`? For every declared context constraint,
 * the context artifact must carry the dimension with a value that satisfies
 * the dimension's TYPE (text/enum: exact string match; number: numeric
 * equality; boolean: 'true'/'false'; string-list: membership). A descriptor
 * without context constraints matches any context (unconstrained).
 *
 * This is ADAPTER-LEVEL selection over typed context data — the execution
 * path never reads context (no semantic branching on platform).
 */
export function runtimeMatchesContext(descriptor: RuntimeDescriptor, context: ContextArtifact): boolean {
  assertValidRuntimeDescriptor(descriptor);
  const constraints = Object.entries(descriptor.context_constraints);
  if (constraints.length === 0) {
    return true;
  }
  for (const [dimension, requiredValue] of constraints) {
    const spec: ContextDimensionSpec | undefined = getContextDimension(dimension);
    if (spec === undefined) {
      return false; // unregistered at match time — cannot match
    }
    const actual = (context.content.dimensions as Record<string, unknown>)[dimension];
    if (actual === undefined) {
      return false; // context does not carry the dimension
    }
    switch (spec.valueType) {
      case 'text':
      case 'enum':
        if (typeof actual !== 'string' || actual !== requiredValue) {
          return false;
        }
        break;
      case 'number':
        if (typeof actual !== 'number' || Number.isNaN(Number(requiredValue)) || actual !== Number(requiredValue)) {
          return false;
        }
        break;
      case 'boolean':
        if (typeof actual !== 'boolean' || actual !== (requiredValue === 'true')) {
          return false;
        }
        break;
      case 'string-list':
        if (
          !Array.isArray(actual) ||
          !actual.every((entry) => typeof entry === 'string') ||
          !actual.includes(requiredValue)
        ) {
          return false;
        }
        break;
    }
  }
  return true;
}

/**
 * Deterministic runtime selection: the descriptors matching the context,
 * in input order (callers sort as they wish; the reference host's
 * listRuntimes is sorted by id).
 */
export function selectRuntimesForContext(
  descriptors: readonly RuntimeDescriptor[],
  context: ContextArtifact,
): RuntimeDescriptor[] {
  return descriptors.filter((descriptor) => runtimeMatchesContext(descriptor, context));
}
