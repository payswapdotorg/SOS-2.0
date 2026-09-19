/**
 * Artifact identity.
 *
 * Artifact ids are globally unique and stable, of the form:
 *
 *     sos://<kind>/<opaque-unique-segment>
 *
 * W0.5 realization detail: the segment is exactly 32 lowercase hex characters
 * (128 bits). Two minting modes exist:
 *
 *   (a) RANDOM — UUID v4, dashes stripped (mintRandomArtifactId).
 *   (b) DETERMINISTIC — content-addressed: sha-256 over the canonical
 *       serialization of the content, first 32 hex chars
 *       (deriveDeterministicArtifactId).
 *
 * The segment is derived from the content only; the kind is part of the id
 * namespace. Identical content under two different kinds therefore yields two
 * distinct ids (different artifacts, no silent collision). Minting the same
 * (kind, content) pair always yields the same id.
 *
 * The registry detects collisions: registering the same id with a different
 * full content hash throws. Different content never collides silently.
 */

import { isValidArtifactKindFormat } from '@sos-2/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { contentHash, canonicalSerialize } from './canonical.js';
import { IdentityError } from './errors.js';

/** sos://<PascalCaseKind>/<32 lowercase hex> */
export const ARTIFACT_ID_PATTERN = /^sos:\/\/([A-Za-z][A-Za-z0-9]*)\/([0-9a-f]{32})$/;

/** Length of the opaque unique segment produced by both minting modes. */
export const DETERMINISTIC_SEGMENT_LENGTH = 32;

export interface ParsedArtifactId {
  kind: string;
  segment: string;
}

/** Structural check: is this a well-formed sos:// artifact id? */
export function isArtifactId(value: unknown): value is string {
  return typeof value === 'string' && ARTIFACT_ID_PATTERN.test(value);
}

/** Parse an artifact id. Throws IdentityError on malformed ids. */
export function parseArtifactId(id: string): ParsedArtifactId {
  const match = ARTIFACT_ID_PATTERN.exec(id);
  if (!match || match.length !== 3) {
    throw new IdentityError(`malformed artifact id: ${JSON.stringify(id)}`);
  }
  return { kind: match[1]!, segment: match[2]! };
}

/** Compose an artifact id from kind + segment (both validated). */
export function buildArtifactId(kind: string, segment: string): string {
  if (!isValidArtifactKindFormat(kind)) {
    throw new IdentityError(`invalid artifact kind: ${JSON.stringify(kind)} (expected PascalCase)`);
  }
  if (!/^[0-9a-f]{32}$/.test(segment)) {
    throw new IdentityError(`invalid id segment: ${JSON.stringify(segment)} (expected 32 lowercase hex chars)`);
  }
  return `sos://${kind}/${segment}`;
}

/**
 * (a) Random minting — UUID v4, dashes stripped.
 * Uniqueness is probabilistic (122 random bits per segment).
 */
export function mintRandomArtifactId(kind: string): string {
  if (!isValidArtifactKindFormat(kind)) {
    throw new IdentityError(`invalid artifact kind: ${JSON.stringify(kind)} (expected PascalCase)`);
  }
  return buildArtifactId(kind, randomUUID().replaceAll('-', ''));
}

/**
 * (b) Deterministic content-addressed minting — sha-256 over the canonical
 * serialization, first 32 hex chars. Same (kind, content) -> same id.
 */
export function deriveDeterministicArtifactId(kind: string, content: unknown): string {
  if (!isValidArtifactKindFormat(kind)) {
    throw new IdentityError(`invalid artifact kind: ${JSON.stringify(kind)} (expected PascalCase)`);
  }
  const full = contentHash(content);
  return buildArtifactId(kind, full.slice(0, DETERMINISTIC_SEGMENT_LENGTH));
}

export interface RegistryEntry {
  id: string;
  kind: string;
  /** Full 64-hex content hash for deterministic ids; null for random ids. */
  contentHash: string | null;
}

/**
 * Registry with collision detection.
 *
 * - registerDeterministic(kind, content) is idempotent for the same content
 *   and throws if the same id was already registered with DIFFERENT content
 *   (128-bit prefix collision, or a forced low-level registration conflict).
 * - register(id, kind, contentHash) re-registers ids loaded from durable
 *   storage; same (id, hash) is idempotent, different hash is a collision.
 * - registerRandom never returns an already-registered id.
 */
export class ArtifactIdRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  register(id: string, kind: string, contentHash: string | null): void {
    if (!isArtifactId(id)) {
      throw new IdentityError(`malformed artifact id: ${JSON.stringify(id)}`);
    }
    const parsed = parseArtifactId(id);
    if (parsed.kind !== kind) {
      throw new IdentityError(
        `id kind mismatch: id ${id} declares kind ${parsed.kind}, registration says ${kind}`,
      );
    }
    if (contentHash !== null && !/^[0-9a-f]{64}$/.test(contentHash)) {
      throw new IdentityError(`invalid content hash: ${JSON.stringify(contentHash)} (expected 64 lowercase hex chars)`);
    }
    const existing = this.entries.get(id);
    if (existing !== undefined) {
      if (existing.contentHash === contentHash) {
        return; // idempotent re-registration of the same content
      }
      throw new IdentityError(
        `artifact id collision detected for ${id}: registered content hash ${String(
          existing.contentHash,
        )} differs from ${String(contentHash)}`,
      );
    }
    this.entries.set(id, { id, kind, contentHash });
  }

  /** Deterministic minting + registration. Returns the id. */
  registerDeterministic(kind: string, content: unknown): string {
    const full = contentHash(content);
    const id = buildArtifactId(kind, full.slice(0, DETERMINISTIC_SEGMENT_LENGTH));
    this.register(id, kind, full);
    return id;
  }

  /** Random minting + registration. Returns the id. */
  registerRandom(kind: string): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = mintRandomArtifactId(kind);
      if (!this.entries.has(id)) {
        this.entries.set(id, { id, kind, contentHash: null });
        return id;
      }
    }
    throw new IdentityError('unable to mint a unique random artifact id after 8 attempts');
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  resolve(id: string): RegistryEntry | undefined {
    return this.entries.get(id);
  }

  /** Entries sorted by id (deterministic). */
  list(): RegistryEntry[] {
    return [...this.entries.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Utility: canonical text of a content value (used by callers that need the
 * exact bytes a deterministic id was derived from).
 */
export function canonicalContentText(content: unknown): string {
  return canonicalSerialize(content);
}

/** Re-exported for completeness: full sha-256 of canonical content. */
export function fullContentHash(content: unknown): string {
  return createHash('sha256').update(canonicalSerialize(content)).digest('hex');
}
