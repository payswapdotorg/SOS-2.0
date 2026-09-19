/**
 * Artifact envelope lifecycle.
 *
 * Status vocabulary (W0.5 realization of the meta-model envelope contract):
 *
 *     DRAFT --> ACTIVE --> SUPERSEDED     (terminal)
 *     DRAFT --> ACTIVE --> RETIRED        (terminal)
 *     DRAFT --> RETIRED                   (abandoned before activation)
 *
 * SUPERSEDED and RETIRED are terminal — no transitions leave them.
 * Envelopes may be created in DRAFT (default) or ACTIVE (used when a new
 * version supersedes an old one); never in SUPERSEDED or RETIRED.
 *
 * `supersedes` must reference an existing id — enforced by EnvelopeStore.put.
 * Identity is minted at creation (content-addressed by default) and is
 * PRESERVED across lifecycle transitions (stable identity is the point).
 */

import {
  isArtifactEnvelope,
  isArtifactStatus,
  isRegisteredArtifactKind,
} from '@sos-2/contracts';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/contracts';
import { deriveDeterministicArtifactId, isArtifactId, parseArtifactId } from './identity.js';
import { LifecycleError } from './errors.js';

export const ALLOWED_STATUS_TRANSITIONS: Readonly<Record<ArtifactStatus, readonly ArtifactStatus[]>> = {
  DRAFT: ['ACTIVE', 'RETIRED'],
  ACTIVE: ['SUPERSEDED', 'RETIRED'],
  SUPERSEDED: [],
  RETIRED: [],
};

/** RFC3339 date-time (no hidden clocks: created_at is always caller-supplied). */
export const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

export function canTransition(from: ArtifactStatus, to: ArtifactStatus): boolean {
  if (!isArtifactStatus(from) || !isArtifactStatus(to)) {
    return false;
  }
  return ALLOWED_STATUS_TRANSITIONS[from]!.includes(to);
}

/** Validate a transition and return the target status; throws when invalid. */
export function transitionStatus(from: ArtifactStatus, to: ArtifactStatus): ArtifactStatus {
  if (!isArtifactStatus(from)) {
    throw new LifecycleError(`unknown artifact status: ${JSON.stringify(from)}`);
  }
  if (!isArtifactStatus(to)) {
    throw new LifecycleError(`unknown artifact status: ${JSON.stringify(to)}`);
  }
  if (!canTransition(from, to)) {
    throw new LifecycleError(`invalid status transition: ${from} -> ${to}`);
  }
  return to;
}

export interface CreateEnvelopeInput {
  /** Registered artifact kind. */
  kind: string;
  /** Version (integer >= 1). Defaults to 1. */
  version?: number;
  /** DRAFT (default) or ACTIVE. Terminal states are not creatable. */
  status?: ArtifactStatus;
  /** Authorizing artifact id, or null. */
  authority_ref?: string | null;
  /** Provenance entries: REQUIRED, non-empty, every entry a non-empty string. */
  provenance: string[];
  /** RFC3339 creation timestamp, caller-supplied. */
  created_at: string;
  /** Artifact id superseded by this one, or null. */
  supersedes?: string | null;
  /**
   * Explicit id override. When omitted, the id is derived
   * deterministically (content-addressed) from the creation content.
   * Supply an explicit id only for randomly-minted envelopes.
   */
  id?: string;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

/** Create an envelope with full SOS discipline validation. */
export function createEnvelope(input: CreateEnvelopeInput): ArtifactEnvelope {
  if (typeof input !== 'object' || input === null) {
    throw new LifecycleError('envelope input must be an object');
  }
  if (!isRegisteredArtifactKind(input.kind)) {
    throw new LifecycleError(
      `unknown artifact kind: ${JSON.stringify(input.kind)} (register extensions via registerArtifactKind first)`,
    );
  }
  const version = input.version ?? 1;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new LifecycleError(`version must be an integer >= 1, received: ${String(version)}`);
  }
  const status = input.status ?? 'DRAFT';
  if (!isArtifactStatus(status)) {
    throw new LifecycleError(`unknown artifact status: ${JSON.stringify(status)}`);
  }
  if (status !== 'DRAFT' && status !== 'ACTIVE') {
    throw new LifecycleError(`envelopes cannot be created in terminal status ${status}`);
  }
  if (!isNonEmptyStringArray(input.provenance)) {
    throw new LifecycleError('provenance must be a non-empty array of non-empty strings');
  }
  if (typeof input.created_at !== 'string' || !RFC3339_PATTERN.test(input.created_at)) {
    throw new LifecycleError(`created_at must be an RFC3339 timestamp, received: ${JSON.stringify(input.created_at)}`);
  }
  const authority_ref = input.authority_ref ?? null;
  if (authority_ref !== null && !isArtifactId(authority_ref)) {
    throw new LifecycleError(
      `authority_ref must be a well-formed artifact id or null, received: ${JSON.stringify(authority_ref)}`,
    );
  }
  const supersedes = input.supersedes ?? null;
  if (supersedes !== null && !isArtifactId(supersedes)) {
    throw new LifecycleError(
      `supersedes must be a well-formed artifact id or null, received: ${JSON.stringify(supersedes)}`,
    );
  }

  let id: string;
  if (input.id !== undefined) {
    if (!isArtifactId(input.id)) {
      throw new LifecycleError(`id must be a well-formed artifact id, received: ${JSON.stringify(input.id)}`);
    }
    const parsed = parseArtifactId(input.id);
    if (parsed.kind !== input.kind) {
      throw new LifecycleError(
        `id kind mismatch: id ${input.id} declares kind ${parsed.kind}, envelope kind is ${input.kind}`,
      );
    }
    id = input.id;
  } else {
    id = deriveDeterministicArtifactId(input.kind, {
      kind: input.kind,
      version,
      status,
      authority_ref,
      provenance: [...input.provenance],
      created_at: input.created_at,
      supersedes,
    });
  }

  return {
    id,
    kind: input.kind,
    version,
    status,
    authority_ref,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes,
  };
}

/** Full semantic validation with a specific error message (throws LifecycleError). */
export function assertValidEnvelope(value: unknown): asserts value is ArtifactEnvelope {
  if (!isArtifactEnvelope(value)) {
    throw new LifecycleError(
      'value does not match the artifact envelope contract (exact fields: id, kind, version, status, authority_ref, provenance, created_at, supersedes)',
    );
  }
  if (!isArtifactId(value.id)) {
    throw new LifecycleError(`envelope id is not a well-formed artifact id: ${JSON.stringify(value.id)}`);
  }
  const parsed = parseArtifactId(value.id);
  if (parsed.kind !== value.kind) {
    throw new LifecycleError(
      `envelope id ${value.id} declares kind ${parsed.kind}, but envelope kind is ${value.kind}`,
    );
  }
  if (!isRegisteredArtifactKind(value.kind)) {
    throw new LifecycleError(`envelope kind is not registered: ${JSON.stringify(value.kind)}`);
  }
  if (value.authority_ref !== null && !isArtifactId(value.authority_ref)) {
    throw new LifecycleError(`authority_ref is not a well-formed artifact id: ${JSON.stringify(value.authority_ref)}`);
  }
  if (value.supersedes !== null && !isArtifactId(value.supersedes)) {
    throw new LifecycleError(`supersedes is not a well-formed artifact id: ${JSON.stringify(value.supersedes)}`);
  }
  if (!isNonEmptyStringArray(value.provenance)) {
    throw new LifecycleError('envelope provenance must be a non-empty array of non-empty strings');
  }
  if (!RFC3339_PATTERN.test(value.created_at)) {
    throw new LifecycleError(`envelope created_at is not an RFC3339 timestamp: ${JSON.stringify(value.created_at)}`);
  }
}

/** Predicate form of assertValidEnvelope. */
export function validateEnvelope(value: unknown): value is ArtifactEnvelope {
  try {
    assertValidEnvelope(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Return a new envelope with a validated status transition.
 * The id is preserved (identity is stable across the lifecycle).
 */
export function withStatus(envelope: ArtifactEnvelope, next: ArtifactStatus): ArtifactEnvelope {
  assertValidEnvelope(envelope);
  transitionStatus(envelope.status, next);
  return { ...envelope, status: next };
}

/**
 * In-memory envelope store.
 *
 * - put(): rejects unknown ids, duplicate ids and supersedes targets that do
 *   not exist in the store ("supersedes must reference an existing id").
 * - setStatus(): validated transition, identity preserved.
 * - supersede(): marks the old envelope SUPERSEDED and registers a new
 *   version (same kind, version bumped by default, status ACTIVE,
 *   supersedes = old id, authority_ref inherited by default).
 */
export class EnvelopeStore {
  private readonly envelopes = new Map<string, ArtifactEnvelope>();

  put(envelope: ArtifactEnvelope): ArtifactEnvelope {
    assertValidEnvelope(envelope);
    if (envelope.supersedes !== null && envelope.supersedes === envelope.id) {
      throw new LifecycleError('an envelope cannot supersede itself');
    }
    if (this.envelopes.has(envelope.id)) {
      throw new LifecycleError(`artifact already registered: ${envelope.id}`);
    }
    if (envelope.supersedes !== null && !this.envelopes.has(envelope.supersedes)) {
      throw new LifecycleError(
        `supersedes target is not registered: ${envelope.supersedes} (supersedes must reference an existing id)`,
      );
    }
    this.envelopes.set(envelope.id, { ...envelope });
    return envelope;
  }

  get(id: string): ArtifactEnvelope | undefined {
    return this.envelopes.get(id);
  }

  has(id: string): boolean {
    return this.envelopes.has(id);
  }

  /** All envelopes, sorted by id (deterministic). */
  list(): ArtifactEnvelope[] {
    return [...this.envelopes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  get size(): number {
    return this.envelopes.size;
  }

  private require(id: string): ArtifactEnvelope {
    const envelope = this.envelopes.get(id);
    if (envelope === undefined) {
      throw new LifecycleError(`unknown artifact id: ${id}`);
    }
    return envelope;
  }

  setStatus(id: string, next: ArtifactStatus): ArtifactEnvelope {
    const envelope = this.require(id);
    const updated = withStatus(envelope, next);
    this.envelopes.set(id, updated);
    return updated;
  }

  supersede(
    id: string,
    input: Omit<CreateEnvelopeInput, 'kind' | 'status' | 'supersedes'>,
  ): { previous: ArtifactEnvelope; supersededBy: ArtifactEnvelope } {
    const previous = this.require(id);
    if (!canTransition(previous.status, 'SUPERSEDED')) {
      throw new LifecycleError(
        `cannot supersede artifact ${id} in status ${previous.status} (only ACTIVE artifacts can be superseded)`,
      );
    }
    const supersededBy = createEnvelope({
      ...input,
      kind: previous.kind,
      version: input.version ?? previous.version + 1,
      status: 'ACTIVE',
      authority_ref: input.authority_ref ?? previous.authority_ref,
      supersedes: id,
    });
    if (supersededBy.id === id) {
      throw new LifecycleError('superseding envelope must have a distinct id');
    }
    this.envelopes.set(id, { ...previous, status: 'SUPERSEDED' });
    this.put(supersededBy);
    return { previous: this.envelopes.get(id)!, supersededBy };
  }
}
