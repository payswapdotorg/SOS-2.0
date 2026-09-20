/**
 * PackageComposition artifacts — versioned first-class composition instances.
 *
 * A PackageCompositionArtifact is a Semantic Spine envelope (kind
 * "PackageComposition" — one of the 19 frozen core kinds; no kind
 * registration is needed and none is performed) plus the composition
 * content. The envelope is ALWAYS obtained from the spine; identities are
 * ALWAYS minted by the spine. This package never invents identifiers and
 * never duplicates envelope logic (AGENTS.md §4).
 *
 * Identity discipline (mirrors the W1/W2/W6-packages pattern): the artifact
 * id is content-addressed over the exact creation address (every envelope
 * field except `id`, plus the content). Identical creation input reproduces
 * the identical id; identity is preserved across lifecycle transitions.
 *
 * Because composition evidence references the composition's own ids (see
 * own-evidence.ts), two sanctioned creation flows exist:
 *   (a) DETERMINISTIC: create at DISCOVERED/FORMING (id content-addressed,
 *       evidence_refs may already cite evidence about an EARLIER chain
 *       revision or about other support artifacts — validated structurally
 *       here and by the own-evidence discipline where records are
 *       available), then promote with own evidence through the registry;
 *   (b) EXPLICIT-ID: mint a random composition id first
 *       (mintRandomArtifactId('PackageComposition')), create evidence about
 *       that id, then create the composition with the explicit id.
 */

import {
  assertValidEnvelope,
  canonicalSerialize,
  contentHash,
  createEnvelope,
  deriveDeterministicArtifactId,
  isArtifactId,
  parseArtifactId,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { CompositionError } from './errors.js';
import { PACKAGE_COMPOSITION_ARTIFACT_KIND, assertValidCompositionContent } from './content.js';
import type { PackageCompositionContent } from './content.js';

export interface PackageCompositionArtifact {
  /** Semantic Spine envelope; kind is always "PackageComposition". */
  envelope: ArtifactEnvelope;
  /** Composition content (exact field set, see content.ts). */
  content: PackageCompositionContent;
}

export interface CreateCompositionInput {
  /** Composition content (validated against the exact field set). */
  content: PackageCompositionContent;
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
  /** Composition artifact id superseded by this one, or null (roots). */
  supersedes?: string | null;
  /** Explicit id override (randomly-minted envelopes; must be a well-formed sos://PackageComposition id). */
  id?: string;
}

/** The exact value a composition artifact id is derived from (exported for bit-exact reproduction). */
export interface CompositionCreationAddress {
  kind: 'PackageComposition';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: PackageCompositionContent;
}

export function compositionCreationAddress(input: CreateCompositionInput): CompositionCreationAddress {
  const version = input.version ?? 1;
  const status: ArtifactStatus = input.status ?? 'DRAFT';
  const authorityRef = input.authority_ref ?? null;
  const supersedes = input.supersedes ?? null;
  return {
    kind: PACKAGE_COMPOSITION_ARTIFACT_KIND,
    version,
    status,
    authority_ref: authorityRef,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes,
    content: input.content,
  };
}

/** Derive the deterministic composition artifact id for a creation input. */
export function compositionArtifactId(input: CreateCompositionInput): string {
  return deriveDeterministicArtifactId(PACKAGE_COMPOSITION_ARTIFACT_KIND, compositionCreationAddress(input));
}

/** Create a composition artifact (deterministic id by default; explicit id for random-minted envelopes). */
export function createPackageComposition(input: CreateCompositionInput): PackageCompositionArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new CompositionError('composition creation input must be an object');
  }
  assertValidCompositionContent(input.content);

  let id: string;
  if (input.id !== undefined) {
    if (!isArtifactId(input.id)) {
      throw new CompositionError(`explicit composition id must be well-formed, received: ${JSON.stringify(input.id)}`);
    }
    const parsed = parseArtifactId(input.id);
    if (parsed.kind !== PACKAGE_COMPOSITION_ARTIFACT_KIND) {
      throw new CompositionError(
        `explicit composition id must be a ${PACKAGE_COMPOSITION_ARTIFACT_KIND} id ` +
          `(sos://${PACKAGE_COMPOSITION_ARTIFACT_KIND}/...), received: ${JSON.stringify(input.id)}`,
      );
    }
    id = input.id;
  } else {
    id = compositionArtifactId(input);
  }

  const envelope = createEnvelope({
    kind: PACKAGE_COMPOSITION_ARTIFACT_KIND,
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

/** Full semantic validation with a specific error message (throws CompositionError). */
export function assertValidCompositionArtifact(value: unknown): asserts value is PackageCompositionArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CompositionError('composition artifact must be an object { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !('envelope' in record) || !('content' in record)) {
    throw new CompositionError('composition artifact must have the exact field set { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new CompositionError(`composition envelope is invalid: ${(cause as Error).message}`);
  }
  const envelope = record['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== PACKAGE_COMPOSITION_ARTIFACT_KIND) {
    throw new CompositionError(
      `composition envelope kind must be "${PACKAGE_COMPOSITION_ARTIFACT_KIND}", received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  // Same note as the W0.5/W2 validators: identity is minted at creation and
  // preserved across transitions; the validator checks contract shape.
  assertValidCompositionContent(record['content']);
}

/** Predicate form of assertValidCompositionArtifact. */
export function validateCompositionArtifact(value: unknown): value is PackageCompositionArtifact {
  try {
    assertValidCompositionArtifact(value);
    return true;
  } catch {
    return false;
  }
}

/** Canonical JSON text of the whole artifact (spine canonical serializer). */
export function canonicalCompositionText(artifact: PackageCompositionArtifact): string {
  return canonicalSerialize({ envelope: artifact.envelope, content: artifact.content });
}

/** SHA-256 content hash over the canonical artifact text. */
export function compositionHash(artifact: PackageCompositionArtifact): string {
  return contentHash({ envelope: artifact.envelope, content: artifact.content });
}
