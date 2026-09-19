/**
 * ValueModel artifacts — versioned value models, deterministically
 * subordinate to Mission at construction.
 *
 * Identity discipline (same as @sos-2/mission): the artifact id is
 * content-addressed over the exact creation address — every envelope field
 * except `id`, plus the value model content — minted by the spine's
 * `deriveDeterministicArtifactId`. Envelopes come from the spine's
 * `createEnvelope`. Nothing here duplicates spine logic.
 */

import {
  assertValidEnvelope,
  createEnvelope,
  deriveDeterministicArtifactId,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus, TraceLink } from '@sos-2/semantic-spine';
import { ValueModelError } from './errors.js';
import { validateValueModelContent } from './model.js';
import type { ValueModelContent } from './model.js';
import type { ValueConstraintTypeRegistry } from './constraints.js';
import {
  buildConflictLink,
  checkMissionSubordination,
} from './subordination.js';
import type { MissionView, SubordinationResult } from './subordination.js';

export const VALUE_MODEL_KIND = 'ValueModel';

export interface ValueModelArtifact {
  envelope: ArtifactEnvelope;
  content: ValueModelContent;
}

/** How construction reacts to a mission conflict. */
export type SubordinationPolicy = 'REJECT' | 'FLAG';

export interface CreateValueModelInput {
  content: ValueModelContent;
  provenance: string[];
  created_at: string;
  /** Authorizing artifact id (typically the Mission artifact id), or null. */
  authority_ref?: string | null;
  /**
   * The mission surface to check subordination against. When provided,
   * typed value constraints and budgets conflicting with HARD mission
   * constraints are rejected (REJECT, default) or flagged (FLAG).
   */
  mission?: MissionView | null;
  /** REJECT (default) or FLAG. */
  policy?: SubordinationPolicy;
  version?: number;
  status?: ArtifactStatus;
  supersedes?: string | null;
  /** Isolated constraint-type registry (defaults to the process-wide registry). */
  constraintTypeRegistry?: ValueConstraintTypeRegistry;
}

export interface CreateValueModelResult {
  artifact: ValueModelArtifact;
  /** The subordination outcome for the (optional) mission surface. */
  subordination: SubordinationResult;
  /**
   * CONFLICTS_WITH trace links (value model -> mission). Non-empty iff
   * policy FLAG was used and conflicts were found. Callers add these to
   * their TraceLinkStore.
   */
  conflict_links: TraceLink[];
}

export interface ValueModelCreationAddress {
  kind: 'ValueModel';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: ValueModelContent;
}

export function valueModelCreationAddress(input: CreateValueModelInput): ValueModelCreationAddress {
  return {
    kind: VALUE_MODEL_KIND,
    version: input.version ?? 1,
    status: input.status ?? 'DRAFT',
    authority_ref: input.authority_ref ?? null,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes: input.supersedes ?? null,
    content: input.content,
  };
}

/** Derive the deterministic value model artifact id for a creation input. */
export function valueModelArtifactId(input: CreateValueModelInput): string {
  return deriveDeterministicArtifactId(VALUE_MODEL_KIND, valueModelCreationAddress(input));
}

function buildArtifact(input: CreateValueModelInput): ValueModelArtifact {
  validateValueModelContent(input.content, input.constraintTypeRegistry);
  const address = valueModelCreationAddress(input);
  const id = deriveDeterministicArtifactId(VALUE_MODEL_KIND, address);
  const envelope = createEnvelope({
    kind: VALUE_MODEL_KIND,
    version: address.version,
    status: address.status,
    authority_ref: address.authority_ref,
    provenance: address.provenance,
    created_at: address.created_at,
    supersedes: address.supersedes,
    id,
  });
  return { envelope, content: structuredClone(input.content) };
}

/**
 * Create a value model with mission subordination enforced.
 *
 * - No mission surface: the value model is created (subordination result is
 *   vacuously SUBORDINATE with no conflicts recorded).
 * - Mission + REJECT (default): any conflict throws ValueModelError —
 *   the conflicting value constraint is rejected at construction.
 * - Mission + FLAG: the value model is created and each conflict is carried
 *   by a CONFLICTS_WITH trace link (value model -> mission). The mission
 *   constraint stands; value never outranks mission.
 */
export function createValueModel(input: CreateValueModelInput): CreateValueModelResult {
  if (typeof input !== 'object' || input === null) {
    throw new ValueModelError('value model creation input must be an object');
  }
  const policy: SubordinationPolicy = input.policy ?? 'REJECT';

  const subordination: SubordinationResult =
    input.mission !== undefined && input.mission !== null
      ? checkMissionSubordination(input.content, input.mission)
      : { status: 'SUBORDINATE', conflicts: [] };

  if (subordination.status === 'CONFLICT' && policy === 'REJECT') {
    const details = subordination.conflicts.map((conflict) => conflict.explanation).join('; ');
    throw new ValueModelError(
      `value model conflicts with hard mission constraints and is rejected at construction (value never outranks mission): ${details}`,
    );
  }

  const artifact = buildArtifact(input);

  const conflict_links =
    subordination.status === 'CONFLICT' && policy === 'FLAG'
      ? [buildConflictLink(artifact.envelope.id, input.mission!, subordination, [...input.provenance])]
      : [];

  return { artifact, subordination, conflict_links };
}

export interface ReviseValueModelInput {
  content: ValueModelContent;
  provenance: string[];
  created_at: string;
  /** The mission surface re-checked at revision time (the mission may have changed). */
  mission?: MissionView | null;
  policy?: SubordinationPolicy;
  constraintTypeRegistry?: ValueConstraintTypeRegistry;
}

export interface ValueModelRevisionResult {
  previous: ValueModelArtifact;
  revised: ValueModelArtifact;
  subordination: SubordinationResult;
  conflict_links: TraceLink[];
}

/**
 * Revise a value model: only ACTIVE value models can be revised; the
 * revision is version + 1, supersedes the previous id, status ACTIVE,
 * authority_ref inherited. Subordination is RE-CHECKED against the supplied
 * mission surface (missions evolve; a revision must not smuggle in a
 * conflict).
 */
export function reviseValueModel(
  current: ValueModelArtifact,
  input: ReviseValueModelInput,
): ValueModelRevisionResult {
  assertValidValueModel(current);
  if (current.envelope.status !== 'ACTIVE') {
    throw new ValueModelError(
      `only ACTIVE value models can be revised; current status: ${current.envelope.status}`,
    );
  }
  const result = createValueModel({
    content: input.content,
    provenance: input.provenance,
    created_at: input.created_at,
    authority_ref: current.envelope.authority_ref,
    mission: input.mission ?? null,
    policy: input.policy,
    version: current.envelope.version + 1,
    status: 'ACTIVE',
    supersedes: current.envelope.id,
    constraintTypeRegistry: input.constraintTypeRegistry,
  });
  return {
    previous: current,
    revised: result.artifact,
    subordination: result.subordination,
    conflict_links: result.conflict_links,
  };
}

const ARTIFACT_KEYS = ['envelope', 'content'] as const;

/**
 * Full semantic validation of a value model artifact (throws ValueModelError):
 * exact artifact shape, spine-valid envelope of kind ValueModel, valid
 * content. (Identity is minted at creation and preserved across transitions —
 * re-derivation is intentionally not part of validation, mirroring the spine.)
 */
export function assertValidValueModel(
  value: unknown,
  registry?: ValueConstraintTypeRegistry,
): asserts value is ValueModelArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValueModelError('value model artifact must be an object with exact fields { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  const expected = new Set<string>(ARTIFACT_KEYS);
  if (actualKeys.length !== ARTIFACT_KEYS.length || !actualKeys.every((key) => expected.has(key))) {
    throw new ValueModelError('value model artifact must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new ValueModelError(`value model envelope is not spine-valid: ${(cause as Error).message}`);
  }
  const envelope = record['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== VALUE_MODEL_KIND) {
    throw new ValueModelError(
      `value model artifact envelope kind must be "${VALUE_MODEL_KIND}", received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  validateValueModelContent(record['content'], registry);
}

/** Predicate form of assertValidValueModel. */
export function validateValueModel(
  value: unknown,
  registry?: ValueConstraintTypeRegistry,
): value is ValueModelArtifact {
  try {
    assertValidValueModel(value, registry);
    return true;
  } catch {
    return false;
  }
}
