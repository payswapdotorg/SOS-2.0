/**
 * Typed Value constraints.
 *
 * A value constraint is TYPED: it names a constraint type from an explicit
 * registry (built-ins seeded, extensions registered via explicit API —
 * mirroring the spine's kind-registry discipline) and, when the type is
 * bounded, carries a machine-checkable bound { axis, direction, limit }.
 * Bounded typed constraints are the surface checked against bounded HARD
 * mission constraints (see subordination.ts).
 *
 * NOTE: this registry is a domain extension point explicitly required by
 * Work Order W1 ("typed Value constraints"). It is NOT a second semantic
 * registry in the sense of AGENTS.md §4 — Semantic Spine identities, kinds
 * and trace types remain solely in @sos-2/contracts/@sos-2/semantic-spine.
 */

import { ValueModelError } from './errors.js';

export const VALUE_BOUND_DIRECTIONS = ['MAX', 'MIN'] as const;

export type ValueBoundDirection = (typeof VALUE_BOUND_DIRECTIONS)[number];

const BOUND_DIRECTION_SET: ReadonlySet<string> = new Set(VALUE_BOUND_DIRECTIONS);

export function isValueBoundDirection(value: unknown): value is ValueBoundDirection {
  return typeof value === 'string' && BOUND_DIRECTION_SET.has(value);
}

export const VALUE_AXIS_PATTERN = /^[a-z][a-z0-9_.-]*$/;

/** Machine-checkable bound of a typed value constraint. */
export interface ValueBound {
  /** Measured quantity, e.g. "monthly-cost" (must match a mission bound axis to interact). */
  axis: string;
  /** MAX = at most; MIN = at least. */
  direction: ValueBoundDirection;
  /** Numeric bound (finite). */
  limit: number;
}

/** Spec of a registered value-constraint type. */
export interface ValueConstraintTypeSpec {
  /** UPPER_SNAKE type name. */
  type: string;
  /** Whether instances carry a machine-checkable bound. */
  bounded: boolean;
  description: string;
}

export const VALUE_CONSTRAINT_TYPE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export const BUILT_IN_VALUE_CONSTRAINT_TYPES: readonly ValueConstraintTypeSpec[] = [
  {
    type: 'BUDGET_LIMIT',
    bounded: true,
    description: 'A budget ceiling/floor on a resource axis (e.g. monthly-cost <= 8000).',
  },
  {
    type: 'SERVICE_LEVEL',
    bounded: true,
    description: 'A service-level objective on an axis (e.g. p95-latency MAX 250ms, uptime MIN 99.9).',
  },
  {
    type: 'RISK_TOLERANCE',
    bounded: true,
    description: 'A risk threshold on an axis (e.g. max acceptable blast radius).',
  },
  {
    type: 'PREFERENCE',
    bounded: false,
    description: 'A soft preference. Never conflicts structurally; always subordinate to Mission and hard constraints.',
  },
];

export interface ValueConstraintTypeRegistry {
  /** Register a new constraint type. Throws on invalid format or duplicates. */
  register(spec: ValueConstraintTypeSpec): void;
  isRegistered(type: string): boolean;
  get(type: string): ValueConstraintTypeSpec | undefined;
  /** Sorted list of registered type specs (deterministic). */
  list(): ValueConstraintTypeSpec[];
}

function validateTypeSpec(spec: ValueConstraintTypeSpec): void {
  if (typeof spec !== 'object' || spec === null) {
    throw new ValueModelError('value constraint type spec must be an object');
  }
  if (typeof spec.type !== 'string' || !VALUE_CONSTRAINT_TYPE_PATTERN.test(spec.type)) {
    throw new ValueModelError(
      `value constraint type name must match ${VALUE_CONSTRAINT_TYPE_PATTERN.toString()}, received: ${JSON.stringify(spec.type)}`,
    );
  }
  if (typeof spec.bounded !== 'boolean') {
    throw new ValueModelError(`value constraint type ${spec.type}: bounded must be a boolean`);
  }
  if (typeof spec.description !== 'string' || spec.description.length === 0) {
    throw new ValueModelError(`value constraint type ${spec.type}: description must be a non-empty string`);
  }
}

export function createValueConstraintTypeRegistry(
  seed: readonly ValueConstraintTypeSpec[] = BUILT_IN_VALUE_CONSTRAINT_TYPES,
): ValueConstraintTypeRegistry {
  const types = new Map<string, ValueConstraintTypeSpec>();
  for (const spec of seed) {
    validateTypeSpec(spec);
    if (types.has(spec.type)) {
      throw new ValueModelError(`value constraint type already registered: ${spec.type}`);
    }
    types.set(spec.type, { ...spec });
  }
  return {
    register(spec: ValueConstraintTypeSpec): void {
      validateTypeSpec(spec);
      if (types.has(spec.type)) {
        throw new ValueModelError(`value constraint type already registered: ${spec.type}`);
      }
      types.set(spec.type, { ...spec });
    },
    isRegistered(type: string): boolean {
      return types.has(type);
    },
    get(type: string): ValueConstraintTypeSpec | undefined {
      return types.get(type);
    },
    list(): ValueConstraintTypeSpec[] {
      return [...types.values()].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
    },
  };
}

/** The default (process-wide) registry, seeded with the built-in types. */
const defaultRegistry: ValueConstraintTypeRegistry = createValueConstraintTypeRegistry();

/** Register a value-constraint type in the default registry (explicit extension API). */
export function registerValueConstraintType(spec: ValueConstraintTypeSpec): void {
  defaultRegistry.register(spec);
}

export function isRegisteredValueConstraintType(type: string): boolean {
  return defaultRegistry.isRegistered(type);
}

export function listValueConstraintTypes(): ValueConstraintTypeSpec[] {
  return defaultRegistry.list();
}

function defaultRegistryGet(type: string): ValueConstraintTypeSpec {
  const spec = defaultRegistry.get(type);
  if (spec === undefined) {
    throw new ValueModelError(
      `unknown value constraint type: ${JSON.stringify(type)} (register extensions via registerValueConstraintType first)`,
    );
  }
  return spec;
}

/** A typed value constraint. */
export interface ValueConstraint {
  /** Local id (lowercase slug), unique within the value model content. */
  id: string;
  /** Registered constraint type. */
  type: string;
  /** Human statement of the constraint. */
  statement: string;
  /** Machine-checkable bound; REQUIRED iff the type is bounded. */
  bound: ValueBound | null;
}

const CONSTRAINT_KEYS = ['id', 'type', 'statement', 'bound'] as const;
const BOUND_KEYS = ['axis', 'direction', 'limit'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  if (actual.length !== keys.length) {
    return false;
  }
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/**
 * Validate one typed value constraint (throws ValueModelError). `registry`
 * defaults to the process-wide registry.
 */
export function validateValueConstraint(
  value: unknown,
  registry: ValueConstraintTypeRegistry = defaultRegistry,
): asserts value is ValueConstraint {
  if (!isPlainObject(value) || !hasExactKeys(value, CONSTRAINT_KEYS)) {
    throw new ValueModelError(`value constraint must be an object with exact fields { ${CONSTRAINT_KEYS.join(', ')} }`);
  }
  const id = value['id'];
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new ValueModelError(`value constraint id must be a lowercase slug, received: ${JSON.stringify(id)}`);
  }
  const type = value['type'];
  if (typeof type !== 'string') {
    throw new ValueModelError(`value constraint ${JSON.stringify(id)} type must be a string`);
  }
  const typeSpec = registry.get(type);
  if (typeSpec === undefined) {
    throw new ValueModelError(
      `value constraint ${JSON.stringify(id)} uses unknown type ${JSON.stringify(type)} (register extensions via registerValueConstraintType first)`,
    );
  }
  if (typeof value['statement'] !== 'string' || (value['statement'] as string).length === 0) {
    throw new ValueModelError(`value constraint ${JSON.stringify(id)} statement must be a non-empty string`);
  }
  const bound = value['bound'];
  if (typeSpec.bounded) {
    if (!isPlainObject(bound) || !hasExactKeys(bound, BOUND_KEYS)) {
      throw new ValueModelError(
        `value constraint ${JSON.stringify(id)} of bounded type ${type} requires a bound with exact fields { ${BOUND_KEYS.join(', ')} }`,
      );
    }
    const axis = bound['axis'];
    if (typeof axis !== 'string' || !VALUE_AXIS_PATTERN.test(axis)) {
      throw new ValueModelError(
        `value constraint ${JSON.stringify(id)} bound axis must match ${VALUE_AXIS_PATTERN.toString()}, received: ${JSON.stringify(axis)}`,
      );
    }
    const direction = bound['direction'];
    if (!isValueBoundDirection(direction)) {
      throw new ValueModelError(
        `value constraint ${JSON.stringify(id)} bound direction must be MAX or MIN, received: ${JSON.stringify(direction)}`,
      );
    }
    const limit = bound['limit'];
    if (typeof limit !== 'number' || !Number.isFinite(limit)) {
      throw new ValueModelError(
        `value constraint ${JSON.stringify(id)} bound limit must be a finite number, received: ${JSON.stringify(limit)}`,
      );
    }
  } else if (bound !== null) {
    throw new ValueModelError(
      `value constraint ${JSON.stringify(id)} of unbounded type ${type} must carry bound: null (use a bounded type for machine-checkable bounds)`,
    );
  }
}

/** Predicate form of validateValueConstraint. */
export function isValidValueConstraint(
  value: unknown,
  registry?: ValueConstraintTypeRegistry,
): value is ValueConstraint {
  try {
    validateValueConstraint(value, registry);
    return true;
  } catch {
    return false;
  }
}

export { defaultRegistryGet as requireValueConstraintType };
