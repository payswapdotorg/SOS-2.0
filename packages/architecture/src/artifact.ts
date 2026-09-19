/**
 * ArchitectureGraph artifacts — the versioned architecture HYPOTHESIS.
 *
 * spec/architecture.md §6: "Architecture is a versioned projection/hypothesis
 * over System State, not a copy of source code." Accordingly, every
 * ArchitectureGraph artifact carries `projects_system_state` — the EXACT
 * SystemState revision (artifact id + envelope version) it projects — and
 * the graph content is a typed hypothesis, never a code dump.
 *
 * Identity discipline (W0.5/W1/W2 pattern): the artifact id is
 * content-addressed over the creation address (every envelope field except
 * `id`, plus the graph content):
 *
 *     sos://ArchitectureGraph/<first 32 hex of sha-256 over the canonical
 *                              serialization of { kind, version, status,
 *                              authority_ref, provenance, created_at,
 *                              supersedes, content }>
 */

import {
  assertValidEnvelope,
  canonicalSerialize,
  contentHash,
  createEnvelope,
  deriveDeterministicArtifactId,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { ArchitectureError } from './errors.js';
import { assertValidGraphShape, assertValidSystemStateRevisionRef, buildGraphContent } from './graph.js';
import type { ArchitectureGraphContent, BuildEdgeInput, BuildNodeInput } from './graph.js';
import type { SystemStateRevisionRef } from '@sos-2/system-state';

export const ARCHITECTURE_GRAPH_KIND = 'ArchitectureGraph';

export interface ArchitectureGraphArtifact {
  /** Semantic Spine envelope; kind is always "ArchitectureGraph". */
  envelope: ArtifactEnvelope;
  /** Graph content: exact SystemState projection reference + nodes + edges. */
  content: ArchitectureGraphContent;
}

export interface CreateArchitectureGraphInput {
  /** The exact SystemState revision this architecture hypothesis projects. */
  projects_system_state: SystemStateRevisionRef;
  /** Graph nodes (validated and canonically sorted). */
  nodes: readonly BuildNodeInput[];
  /** Graph edges (validated and canonically sorted). */
  edges: readonly BuildEdgeInput[];
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
  /** ArchitectureGraph artifact id superseded by this one, or null (roots). */
  supersedes?: string | null;
}

/** The exact value an architecture graph artifact id is derived from. */
export interface ArchitectureGraphCreationAddress {
  kind: 'ArchitectureGraph';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: ArchitectureGraphContent;
}

export function architectureGraphCreationAddress(
  input: CreateArchitectureGraphInput,
): ArchitectureGraphCreationAddress {
  const version = input.version ?? 1;
  const status: ArtifactStatus = input.status ?? 'DRAFT';
  const authorityRef = input.authority_ref ?? null;
  const supersedes = input.supersedes ?? null;
  return {
    kind: ARCHITECTURE_GRAPH_KIND,
    version,
    status,
    authority_ref: authorityRef,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes,
    content: buildGraphContent({
      projects_system_state: input.projects_system_state,
      nodes: input.nodes,
      edges: input.edges,
    }),
  };
}

/** Derive the deterministic architecture graph artifact id for a creation input. */
export function architectureGraphArtifactId(input: CreateArchitectureGraphInput): string {
  return deriveDeterministicArtifactId(ARCHITECTURE_GRAPH_KIND, architectureGraphCreationAddress(input));
}

/** Create an architecture graph artifact (deterministic identity, spine envelope). */
export function createArchitectureGraph(input: CreateArchitectureGraphInput): ArchitectureGraphArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new ArchitectureError('architecture graph creation input must be an object');
  }
  const content = buildGraphContent({
    projects_system_state: input.projects_system_state,
    nodes: input.nodes,
    edges: input.edges,
  });
  const id = architectureGraphArtifactId(input);
  const envelope = createEnvelope({
    kind: ARCHITECTURE_GRAPH_KIND,
    version: input.version,
    status: input.status,
    authority_ref: input.authority_ref ?? null,
    provenance: input.provenance,
    created_at: input.created_at,
    supersedes: input.supersedes ?? null,
    id,
  });
  return { envelope, content };
}

/** Full semantic validation with a specific error message (throws ArchitectureError). */
export function assertValidArchitectureGraphArtifact(
  value: unknown,
): asserts value is ArchitectureGraphArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ArchitectureError('architecture graph artifact must be an object { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) {
    throw new ArchitectureError('architecture graph artifact must have the exact field set { envelope, content }');
  }
  if (
    !Object.prototype.hasOwnProperty.call(record, 'envelope') ||
    !Object.prototype.hasOwnProperty.call(record, 'content')
  ) {
    throw new ArchitectureError('architecture graph artifact must have the exact field set { envelope, content }');
  }
  try {
    assertValidEnvelope(record.envelope);
  } catch (error) {
    throw new ArchitectureError(`architecture graph envelope is invalid: ${(error as Error).message}`);
  }
  const envelope = record.envelope as ArtifactEnvelope;
  if (envelope.kind !== ARCHITECTURE_GRAPH_KIND) {
    throw new ArchitectureError(
      `architecture graph envelope kind must be "${ARCHITECTURE_GRAPH_KIND}", received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  const content = record.content as Record<string, unknown>;
  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    throw new ArchitectureError('architecture graph content must be an object');
  }
  assertValidSystemStateRevisionRef(content.projects_system_state);
  assertValidGraphShape({ nodes: content.nodes, edges: content.edges });
}

/** Predicate form of assertValidArchitectureGraphArtifact. */
export function validateArchitectureGraphArtifact(value: unknown): value is ArchitectureGraphArtifact {
  try {
    assertValidArchitectureGraphArtifact(value);
    return true;
  } catch {
    return false;
  }
}

/** Canonical JSON text of the whole artifact (spine canonical serializer). */
export function canonicalArchitectureGraphText(artifact: ArchitectureGraphArtifact): string {
  return canonicalSerialize({ envelope: artifact.envelope, content: artifact.content });
}

/** SHA-256 content hash over the canonical artifact text. */
export function architectureGraphHash(artifact: ArchitectureGraphArtifact): string {
  return contentHash({ envelope: artifact.envelope, content: artifact.content });
}
