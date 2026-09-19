/**
 * Context dimensions — realization of spec/architecture.md §5 "Context":
 *
 *     "Context: user/cohort, platform, device, environment, workload,
 *      geography, time and regulatory context."
 *
 * The eight built-in dimensions are seeded in an explicit, extensible
 * registry. New dimensions are registered via the explicit API
 * (`registerContextDimension` or an isolated `createDimensionRegistry`);
 * UNKNOWN dimensions are rejected at Context construction. Every dimension
 * is TYPED: values must satisfy the dimension's value type
 * (text / number / boolean / enum / string-list), machine-checked in
 * values.ts.
 *
 * NOTE: this registry is a domain extension point explicitly required by
 * Work Order W1 ("Extensible dimension registry"). It is NOT a second
 * semantic registry in the sense of AGENTS.md §4 — Semantic Spine
 * identities, kinds and trace types remain solely in
 * @sos-2/contracts/@sos-2/semantic-spine.
 */

import { ContextError } from './errors.js';

/** The frozen value-type vocabulary for dimension specs. */
export const CONTEXT_VALUE_TYPES = ['text', 'number', 'boolean', 'enum', 'string-list'] as const;

export type ContextValueType = (typeof CONTEXT_VALUE_TYPES)[number];

const VALUE_TYPE_SET: ReadonlySet<string> = new Set(CONTEXT_VALUE_TYPES);

export function isContextValueType(value: unknown): value is ContextValueType {
  return typeof value === 'string' && VALUE_TYPE_SET.has(value);
}

/** Dimension names are lowercase snake_case. */
export const CONTEXT_DIMENSION_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** A registered context dimension. */
export interface ContextDimensionSpec {
  /** Dimension name (lowercase snake_case), e.g. "user_cohort". */
  name: string;
  /** Value type every value of this dimension must satisfy. */
  valueType: ContextValueType;
  /** Human description of the dimension. */
  description: string;
  /** Allowed values; REQUIRED and non-empty iff valueType is "enum". */
  enumValues?: string[];
}

/** The eight built-in dimensions from spec/architecture.md §5. */
export const BUILT_IN_CONTEXT_DIMENSIONS: readonly ContextDimensionSpec[] = [
  {
    name: 'user_cohort',
    valueType: 'text',
    description: 'User or cohort the realization targets (e.g. "beta-testers", "tenant:acme").',
  },
  {
    name: 'platform',
    valueType: 'text',
    description: 'Execution platform (e.g. "web", "ios", "server").',
  },
  {
    name: 'device',
    valueType: 'text',
    description: 'Device class (e.g. "phone", "rack-server").',
  },
  {
    name: 'environment',
    valueType: 'enum',
    description: 'Deployment environment.',
    enumValues: ['development', 'test', 'staging', 'production'],
  },
  {
    name: 'workload',
    valueType: 'text',
    description: 'Workload shape (e.g. "read-heavy", "batch", "bursty").',
  },
  {
    name: 'geography',
    valueType: 'text',
    description: 'Geographic scope (e.g. "eu-west", "global").',
  },
  {
    name: 'time',
    valueType: 'text',
    description: 'Point or interval of applicability (RFC3339 timestamp or documented expression).',
  },
  {
    name: 'regulatory',
    valueType: 'string-list',
    description: 'Applicable regulatory regimes (e.g. ["GDPR", "HIPAA"]).',
  },
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateDimensionSpec(spec: ContextDimensionSpec): void {
  if (!isPlainObject(spec)) {
    throw new ContextError('context dimension spec must be an object');
  }
  if (typeof spec.name !== 'string' || !CONTEXT_DIMENSION_NAME_PATTERN.test(spec.name)) {
    throw new ContextError(
      `context dimension name must match ${CONTEXT_DIMENSION_NAME_PATTERN.toString()}, received: ${JSON.stringify(spec.name)}`,
    );
  }
  if (!isContextValueType(spec.valueType)) {
    throw new ContextError(
      `context dimension ${JSON.stringify(spec.name)} valueType must be one of ${CONTEXT_VALUE_TYPES.join(', ')}, received: ${JSON.stringify(spec.valueType)}`,
    );
  }
  if (typeof spec.description !== 'string' || spec.description.length === 0) {
    throw new ContextError(`context dimension ${JSON.stringify(spec.name)} description must be a non-empty string`);
  }
  if (spec.valueType === 'enum') {
    if (
      !Array.isArray(spec.enumValues) ||
      spec.enumValues.length === 0 ||
      !spec.enumValues.every((entry) => typeof entry === 'string' && entry.length > 0) ||
      new Set(spec.enumValues).size !== spec.enumValues.length
    ) {
      throw new ContextError(
        `context dimension ${JSON.stringify(spec.name)} (enum) requires non-empty, unique, non-empty-string enumValues`,
      );
    }
  } else if (spec.enumValues !== undefined) {
    throw new ContextError(
      `context dimension ${JSON.stringify(spec.name)} (valueType ${spec.valueType}) must not carry enumValues (only enum dimensions may)`,
    );
  }
}

export interface ContextDimensionRegistry {
  /** Register a new dimension. Throws on invalid specs or duplicates. No unregister: the built-ins cannot be silently removed. */
  register(spec: ContextDimensionSpec): void;
  isRegistered(name: string): boolean;
  get(name: string): ContextDimensionSpec | undefined;
  /** Sorted list of registered dimension specs (deterministic). */
  list(): ContextDimensionSpec[];
}

/** Create an isolated dimension registry (seed defaults to the §5 built-ins). */
export function createDimensionRegistry(
  seed: readonly ContextDimensionSpec[] = BUILT_IN_CONTEXT_DIMENSIONS,
): ContextDimensionRegistry {
  const dimensions = new Map<string, ContextDimensionSpec>();
  for (const spec of seed) {
    validateDimensionSpec(spec);
    if (dimensions.has(spec.name)) {
      throw new ContextError(`context dimension already registered: ${spec.name}`);
    }
    dimensions.set(spec.name, { ...spec, enumValues: spec.enumValues ? [...spec.enumValues] : undefined });
  }
  return {
    register(spec: ContextDimensionSpec): void {
      validateDimensionSpec(spec);
      if (dimensions.has(spec.name)) {
        throw new ContextError(`context dimension already registered: ${spec.name}`);
      }
      dimensions.set(spec.name, { ...spec, enumValues: spec.enumValues ? [...spec.enumValues] : undefined });
    },
    isRegistered(name: string): boolean {
      return dimensions.has(name);
    },
    get(name: string): ContextDimensionSpec | undefined {
      return dimensions.get(name);
    },
    list(): ContextDimensionSpec[] {
      return [...dimensions.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    },
  };
}

/** The default (process-wide) registry, seeded with the §5 built-ins. */
const defaultRegistry: ContextDimensionRegistry = createDimensionRegistry();

/** Register a context dimension in the default registry (explicit extension API). */
export function registerContextDimension(spec: ContextDimensionSpec): void {
  defaultRegistry.register(spec);
}

export function isRegisteredContextDimension(name: string): boolean {
  return defaultRegistry.isRegistered(name);
}

export function listContextDimensions(): ContextDimensionSpec[] {
  return defaultRegistry.list();
}

export function getContextDimension(name: string): ContextDimensionSpec | undefined {
  return defaultRegistry.get(name);
}

/** Resolve a dimension spec or throw (unknown dimensions are rejected loudly). */
export function requireContextDimension(
  name: string,
  registry: ContextDimensionRegistry = defaultRegistry,
): ContextDimensionSpec {
  const spec = registry.get(name);
  if (spec === undefined) {
    throw new ContextError(
      `unknown context dimension: ${JSON.stringify(name)} (register extensions via registerContextDimension first; unknown dimensions are rejected)`,
    );
  }
  return spec;
}

export { defaultRegistry as defaultContextDimensionRegistry };
