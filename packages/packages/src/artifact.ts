/**
 * Package artifacts — versioned package instances.
 *
 * A PackageArtifact is a Semantic Spine envelope (kind "Package" — one of
 * the 19 frozen core kinds) plus the §5 package content. The envelope is
 * ALWAYS obtained from the spine (`createEnvelope`); identities are ALWAYS
 * minted by the spine (`deriveDeterministicArtifactId`, or an explicit
 * well-formed id for randomly-minted envelopes). This package never
 * invents identifiers and never duplicates envelope logic (AGENTS.md §4,
 * W0.5 export discipline).
 *
 * Identity discipline (mirrors the W1/W2 pattern): the artifact id is
 * content-addressed over the exact creation address — every envelope field
 * except `id`, plus the package content:
 *
 *     sos://Package/<first 32 hex of sha-256 over the canonical
 *                    serialization of { kind, version, status,
 *                    authority_ref, provenance, created_at, supersedes,
 *                    content }>
 *
 * Identical creation input reproduces the identical id; identity is
 * preserved across later lifecycle transitions (the spine preserves `id`).
 *
 * THE NORMATIVE PROJECTION: `toPackageRecord` projects the artifact onto
 * the closed 8-key PackageRecord contract (spec/contracts/package.schema.json,
 * additionalProperties: false) — the schema-conformant form validated by
 * ajv in tests and consumed by the frozen golden fixture
 * (packages/semantic-spine/fixtures/package-record.json, reproduced
 * bit-exactly by this projection in the W6 golden fixture test).
 */

import {
  assertValidEnvelope,
  canonicalSerialize,
  contentHash,
  createEnvelope,
  deriveDeterministicArtifactId,
  isArtifactId,
  isPackageRecord,
  parseArtifactId,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus, PackageRecord } from '@sos-2/semantic-spine';
import { PackageError } from './errors.js';
import { PACKAGE_ARTIFACT_KIND, assertValidPackageContent } from './content.js';
import type { PackageContent } from './content.js';

export interface PackageArtifact {
  /** Semantic Spine envelope; kind is always "Package". */
  envelope: ArtifactEnvelope;
  /** Package content (exact §5 field set, see content.ts). */
  content: PackageContent;
}

export interface CreatePackageInput {
  /** Package content (validated against the exact §5 field set). */
  content: PackageContent;
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
  /** Package artifact id superseded by this one, or null (roots). */
  supersedes?: string | null;
  /**
   * Explicit id override. When omitted, the id is derived deterministically
   * (content-addressed) from the creation address. Supply an explicit id
   * only for randomly-minted envelopes (spine-minted or golden-fixture ids).
   */
  id?: string;
}

/** The exact value a package artifact id is derived from (exported for bit-exact reproduction). */
export interface PackageCreationAddress {
  kind: 'Package';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: PackageContent;
}

export function packageCreationAddress(input: CreatePackageInput): PackageCreationAddress {
  const version = input.version ?? 1;
  const status: ArtifactStatus = input.status ?? 'DRAFT';
  const authorityRef = input.authority_ref ?? null;
  const supersedes = input.supersedes ?? null;
  return {
    kind: PACKAGE_ARTIFACT_KIND,
    version,
    status,
    authority_ref: authorityRef,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes,
    content: input.content,
  };
}

/** Derive the deterministic package artifact id for a creation input. */
export function packageArtifactId(input: CreatePackageInput): string {
  return deriveDeterministicArtifactId(PACKAGE_ARTIFACT_KIND, packageCreationAddress(input));
}

/**
 * Create a package artifact. Ids are deterministic (content-addressed) by
 * default; an explicit id is accepted only for randomly-minted or golden
 * ids (it must be a well-formed sos://Package/<segment> id).
 */
export function createPackageArtifact(input: CreatePackageInput): PackageArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new PackageError('package creation input must be an object');
  }
  assertValidPackageContent(input.content);

  let id: string;
  if (input.id !== undefined) {
    if (!isArtifactId(input.id)) {
      throw new PackageError(`explicit package id must be well-formed, received: ${JSON.stringify(input.id)}`);
    }
    const parsed = parseArtifactId(input.id);
    if (parsed.kind !== PACKAGE_ARTIFACT_KIND) {
      throw new PackageError(
        `explicit package id must be a ${PACKAGE_ARTIFACT_KIND} id (sos://${PACKAGE_ARTIFACT_KIND}/...), received: ${JSON.stringify(input.id)}`,
      );
    }
    id = input.id;
  } else {
    id = packageArtifactId(input);
  }

  const envelope = createEnvelope({
    kind: PACKAGE_ARTIFACT_KIND,
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

/** Full semantic validation with a specific error message (throws PackageError). */
export function assertValidPackageArtifact(value: unknown): asserts value is PackageArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PackageError('package artifact must be an object { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !('envelope' in record) || !('content' in record)) {
    throw new PackageError('package artifact must have the exact field set { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new PackageError(`package envelope is invalid: ${(cause as Error).message}`);
  }
  const envelope = record['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== PACKAGE_ARTIFACT_KIND) {
    throw new PackageError(
      `package envelope kind must be "${PACKAGE_ARTIFACT_KIND}", received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  // NOTE: identity is minted at creation (content-addressed over the CREATION
  // address) and preserved across lifecycle transitions (the spine preserves
  // `id`); after a status transition the id is no longer reproducible from
  // the CURRENT envelope fields, so this validator checks contract shape
  // only — the same discipline as W0.5/W2 validators.
  assertValidPackageContent(record['content']);
}

/** Predicate form of assertValidPackageArtifact. */
export function validatePackageArtifact(value: unknown): value is PackageArtifact {
  try {
    assertValidPackageArtifact(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Project a package artifact onto the NORMATIVE PackageRecord contract
 * (spec/contracts/package.schema.json, additionalProperties: false).
 *
 * The projection is EXACT: the closed 8-key record whose id is the
 * envelope id, whose maturity/evidence/failure/compatibility/composition
 * refs come from the content, and whose contracts and semantic_capability
 * are the content's. Every projection is schema-valid (pinned by ajv tests)
 * and reproduces the W0.5 golden fixture bit-exactly for the golden
 * package artifact.
 */
export function toPackageRecord(artifact: PackageArtifact): PackageRecord {
  assertValidPackageArtifact(artifact);
  const record: PackageRecord = {
    id: artifact.envelope.id,
    semantic_capability: artifact.content.semantic_capability,
    contracts: [...artifact.content.contracts],
    maturity: artifact.content.maturity,
    evidence_refs: [...artifact.content.evidence_refs],
    failure_refs: [...artifact.content.failure_refs],
    compatibility_refs: [...artifact.content.compatibility_refs],
    composition_refs: [...artifact.content.composition_refs],
  };
  if (!isPackageRecord(record)) {
    // Unreachable for validated artifacts; kept as a loud invariant guard.
    throw new PackageError(
      'internal invariant: package projection does not satisfy the normative PackageRecord contract',
    );
  }
  return record;
}

/** Canonical JSON text of the whole artifact (spine canonical serializer). */
export function canonicalPackageText(artifact: PackageArtifact): string {
  return canonicalSerialize({ envelope: artifact.envelope, content: artifact.content });
}

/** SHA-256 content hash over the canonical artifact text. */
export function packageHash(artifact: PackageArtifact): string {
  return contentHash({ envelope: artifact.envelope, content: artifact.content });
}
