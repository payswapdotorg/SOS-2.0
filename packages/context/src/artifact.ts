/**
 * Context artifacts — typed, dimensioned context instances.
 *
 * A ContextArtifact is a Semantic Spine envelope (kind "Context") plus a
 * content of exactly { dimensions }, where every dimension name must be
 * REGISTERED (unknown dimensions rejected) and every value must satisfy the
 * dimension's type. Ids are minted by the spine over the exact creation
 * address (same discipline as @sos-2/mission/@sos-2/value).
 *
 * Contexts are per-situation snapshots; evolution flows through new context
 * artifacts (contextual realization, spec/requirements.md R5), not through
 * mutation.
 */

import {
  assertValidEnvelope,
  createEnvelope,
  deriveDeterministicArtifactId,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { ContextError } from './errors.js';
import { requireContextDimension } from './dimensions.js';
import type { ContextDimensionRegistry } from './dimensions.js';
import { validateDimensionValue } from './values.js';

export const CONTEXT_KIND = 'Context';

/** A dimension name -> value map (validated against a registry). */
export type ContextDimensions = Record<string, unknown>;

export interface ContextContent {
  dimensions: ContextDimensions;
}

export interface ContextArtifact {
  envelope: ArtifactEnvelope;
  content: ContextContent;
}

export interface CreateContextInput {
  /** Dimension values; every key must be a registered dimension name. */
  dimensions: ContextDimensions;
  provenance: string[];
  created_at: string;
  authority_ref?: string | null;
  version?: number;
  status?: ArtifactStatus;
  supersedes?: string | null;
  /** Isolated dimension registry (defaults to the process-wide registry). */
  registry?: ContextDimensionRegistry;
}

export interface ContextCreationAddress {
  kind: 'Context';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: ContextContent;
}

export function contextCreationAddress(input: CreateContextInput): ContextCreationAddress {
  return {
    kind: CONTEXT_KIND,
    version: input.version ?? 1,
    status: input.status ?? 'DRAFT',
    authority_ref: input.authority_ref ?? null,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes: input.supersedes ?? null,
    content: { dimensions: input.dimensions },
  };
}

/** Derive the deterministic context artifact id for a creation input. */
export function contextArtifactId(input: CreateContextInput): string {
  return deriveDeterministicArtifactId(CONTEXT_KIND, contextCreationAddress(input));
}

/**
 * Validate a dimensions map against a registry (throws ContextError):
 * every name registered, every value type-correct. Returns a defensively
 * copied, key-sorted content.
 */
export function validateContextDimensions(
  dimensions: unknown,
  registry?: ContextDimensionRegistry,
): asserts dimensions is ContextDimensions {
  if (typeof dimensions !== 'object' || dimensions === null || Array.isArray(dimensions)) {
    throw new ContextError(`context dimensions must be an object (dimension name -> value), received: ${JSON.stringify(dimensions)}`);
  }
  for (const [name, value] of Object.entries(dimensions)) {
    const spec = requireContextDimension(name, registry);
    validateDimensionValue(spec, value);
  }
}

/** Create a context artifact: unknown dimensions and mistyped values are rejected. */
export function createContext(input: CreateContextInput): ContextArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new ContextError('context creation input must be an object');
  }
  validateContextDimensions(input.dimensions, input.registry);

  const version = input.version ?? 1;
  const status: ArtifactStatus = input.status ?? 'DRAFT';
  const authorityRef = input.authority_ref ?? null;
  const supersedes = input.supersedes ?? null;
  const content: ContextContent = { dimensions: structuredClone(input.dimensions) };

  const id = deriveDeterministicArtifactId(CONTEXT_KIND, {
    kind: CONTEXT_KIND,
    version,
    status,
    authority_ref: authorityRef,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes,
    content,
  });

  const envelope = createEnvelope({
    kind: CONTEXT_KIND,
    version,
    status,
    authority_ref: authorityRef,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes,
    id,
  });

  return { envelope, content };
}

const ARTIFACT_KEYS = ['envelope', 'content'] as const;
const CONTENT_KEYS = ['dimensions'] as const;

/**
 * Full semantic validation of a context artifact (throws ContextError):
 * exact artifact shape, spine-valid envelope of kind Context, exact content
 * shape, and every dimension registered + type-correct.
 */
export function assertValidContext(
  value: unknown,
  registry?: ContextDimensionRegistry,
): asserts value is ContextArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ContextError('context artifact must be an object with exact fields { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  const expected = new Set<string>(ARTIFACT_KEYS);
  if (actualKeys.length !== ARTIFACT_KEYS.length || !actualKeys.every((key) => expected.has(key))) {
    throw new ContextError('context artifact must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new ContextError(`context envelope is not spine-valid: ${(cause as Error).message}`);
  }
  const envelope = record['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== CONTEXT_KIND) {
    throw new ContextError(`context artifact envelope kind must be "${CONTEXT_KIND}", received: ${JSON.stringify(envelope.kind)}`);
  }
  const content = record['content'];
  if (
    typeof content !== 'object' ||
    content === null ||
    Array.isArray(content) ||
    Object.keys(content).length !== CONTENT_KEYS.length ||
    !Object.prototype.hasOwnProperty.call(content, 'dimensions')
  ) {
    throw new ContextError('context content must be an object with exact fields { dimensions }');
  }
  validateContextDimensions((content as ContextContent).dimensions, registry);
}

/** Predicate form of assertValidContext. */
export function validateContext(value: unknown, registry?: ContextDimensionRegistry): value is ContextArtifact {
  try {
    assertValidContext(value, registry);
    return true;
  } catch {
    return false;
  }
}
