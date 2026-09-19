/**
 * SystemState artifacts — versioned system state instances.
 *
 * A SystemStateArtifact is a Semantic Spine envelope (kind "SystemState")
 * plus the eight-section content. The envelope is ALWAYS obtained from the
 * spine (`createEnvelope`); identities are ALWAYS minted by the spine
 * (`deriveDeterministicArtifactId`). This package never invents identifiers
 * and never duplicates envelope logic (AGENTS.md §4, W0.5 export discipline).
 *
 * Identity discipline (mirrors the W1/W0.5 pattern): the artifact id is
 * content-addressed over the exact creation address — every envelope field
 * except `id`, plus the system state content:
 *
 *     sos://SystemState/<first 32 hex of sha-256 over the canonical
 *                        serialization of { kind, version, status,
 *                        authority_ref, provenance, created_at, supersedes,
 *                        content }>
 *
 * Identical creation input reproduces the identical id; identity is
 * preserved across later lifecycle transitions (the spine preserves `id`).
 * Canonical serialization of the whole artifact (envelope + content) is
 * provided by the spine's canonical serializer.
 */

import {
  assertValidEnvelope,
  canonicalSerialize,
  contentHash,
  createEnvelope,
  deriveDeterministicArtifactId,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { SystemStateError } from './errors.js';
import { assertValidSystemStateContent } from './model.js';
import type { SystemStateContent } from './model.js';

export const SYSTEM_STATE_KIND = 'SystemState';

export interface SystemStateArtifact {
  /** Semantic Spine envelope; kind is always "SystemState". */
  envelope: ArtifactEnvelope;
  /** System state content (exact eight-section field set, see model.ts). */
  content: SystemStateContent;
}

export interface CreateSystemStateInput {
  /** System state content (validated against the exact §5 field set). */
  content: SystemStateContent;
  /** REQUIRED non-empty provenance entries (spine discipline). */
  provenance: string[];
  /** RFC3339 creation timestamp, caller-supplied (no hidden clocks). */
  created_at: string;
  /** Authorizing artifact id, or null. */
  authority_ref?: string | null;
  /** Version (integer >= 1). Defaults to 1. */
  version?: number;
  /** DRAFT (default) or ACTIVE. */
  status?: ArtifactStatus;
  /** SystemState artifact id superseded by this one, or null (roots). */
  supersedes?: string | null;
}

/**
 * The exact value a system state artifact id is derived from. Exported so
 * tests and diagnostics can reproduce ids bit-exactly.
 */
export interface SystemStateCreationAddress {
  kind: 'SystemState';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: SystemStateContent;
}

export function systemStateCreationAddress(input: CreateSystemStateInput): SystemStateCreationAddress {
  const version = input.version ?? 1;
  const status: ArtifactStatus = input.status ?? 'DRAFT';
  const authorityRef = input.authority_ref ?? null;
  const supersedes = input.supersedes ?? null;
  return {
    kind: SYSTEM_STATE_KIND,
    version,
    status,
    authority_ref: authorityRef,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes,
    content: input.content,
  };
}

/** Derive the deterministic system state artifact id for a creation input. */
export function systemStateArtifactId(input: CreateSystemStateInput): string {
  return deriveDeterministicArtifactId(SYSTEM_STATE_KIND, systemStateCreationAddress(input));
}

/**
 * Create a system state artifact. Ids are ALWAYS deterministic
 * (content-addressed): a SystemState is reproducible from exact revisions
 * and evidence (spec/architecture.md §18). Envelope discipline is delegated
 * to the spine; content discipline to model.ts.
 */
export function createSystemState(input: CreateSystemStateInput): SystemStateArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new SystemStateError('system state creation input must be an object');
  }
  assertValidSystemStateContent(input.content);

  const id = systemStateArtifactId(input);
  const envelope = createEnvelope({
    kind: SYSTEM_STATE_KIND,
    version: input.version,
    status: input.status,
    authority_ref: input.authority_ref ?? null,
    provenance: input.provenance,
    created_at: input.created_at,
    supersedes: input.supersedes ?? null,
    id,
  });

  return { envelope, content: input.content };
}

/** Full semantic validation with a specific error message (throws SystemStateError). */
export function assertValidSystemStateArtifact(value: unknown): asserts value is SystemStateArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SystemStateError('system state artifact must be an object { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) {
    throw new SystemStateError('system state artifact must have the exact field set { envelope, content }');
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'envelope') || !Object.prototype.hasOwnProperty.call(record, 'content')) {
    throw new SystemStateError('system state artifact must have the exact field set { envelope, content }');
  }
  try {
    assertValidEnvelope(record.envelope);
  } catch (error) {
    throw new SystemStateError(`system state envelope is invalid: ${(error as Error).message}`);
  }
  const envelope = record.envelope as ArtifactEnvelope;
  if (envelope.kind !== SYSTEM_STATE_KIND) {
    throw new SystemStateError(
      `system state envelope kind must be "${SYSTEM_STATE_KIND}", received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  // NOTE: identity is minted at creation (content-addressed over the CREATION
  // address) and preserved across lifecycle transitions (the spine preserves
  // `id`); after a status transition the id is no longer reproducible from
  // the CURRENT envelope fields, so this validator checks contract shape
  // only — the same discipline as W0.5/W1 validators.
  assertValidSystemStateContent(record.content);
}

/** Predicate form of assertValidSystemStateArtifact. */
export function validateSystemStateArtifact(value: unknown): value is SystemStateArtifact {
  try {
    assertValidSystemStateArtifact(value);
    return true;
  } catch {
    return false;
  }
}

/** Canonical JSON text of the whole artifact (spine canonical serializer). */
export function canonicalSystemStateText(artifact: SystemStateArtifact): string {
  return canonicalSerialize({ envelope: artifact.envelope, content: artifact.content });
}

/** SHA-256 content hash over the canonical artifact text. */
export function systemStateHash(artifact: SystemStateArtifact): string {
  return contentHash({ envelope: artifact.envelope, content: artifact.content });
}
