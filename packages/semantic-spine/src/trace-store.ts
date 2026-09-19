/**
 * Typed trace links — creation, validation and the link store.
 *
 * Validation layers (documented):
 *   - contracts layer (@sos-2/contracts isTraceLink): schema-faithful shape.
 *   - spine layer (this module): source/target must be WELL-FORMED artifact
 *     ids; type must be one of the 17 frozen types; provenance entries (when
 *     present) must be non-empty strings. createTraceLink additionally
 *     REQUIRES provenance (SOS discipline: no provenance-less links are
 *     minted, even though the schema permits absence).
 *
 * The store rejects duplicate (source, target, type) pairs and answers
 * forward/backward queries.
 */

import { isTraceLink, isTraceLinkType, TRACE_LINK_TYPES } from '@sos-2/contracts';
import type { TraceLink, TraceLinkType } from '@sos-2/contracts';
import { isArtifactId } from './identity.js';
import { TraceLinkError } from './errors.js';

export interface CreateTraceLinkInput {
  source: string;
  target: string;
  type: TraceLinkType;
  /** Required, non-empty entries. */
  provenance: string[];
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

/** Create a trace link with full SOS discipline validation. */
export function createTraceLink(input: CreateTraceLinkInput): TraceLink {
  if (!isArtifactId(input.source)) {
    throw new TraceLinkError(
      `source must be a well-formed artifact id, received: ${JSON.stringify(input.source)}`,
    );
  }
  if (!isArtifactId(input.target)) {
    throw new TraceLinkError(
      `target must be a well-formed artifact id, received: ${JSON.stringify(input.target)}`,
    );
  }
  if (!isTraceLinkType(input.type)) {
    throw new TraceLinkError(
      `unknown trace link type: ${JSON.stringify(input.type)} (expected one of the ${TRACE_LINK_TYPES.length} frozen types)`,
    );
  }
  if (!isNonEmptyStringArray(input.provenance)) {
    throw new TraceLinkError('provenance must be a non-empty array of non-empty strings');
  }
  return { source: input.source, target: input.target, type: input.type, provenance: [...input.provenance] };
}

/** Full semantic validation with a specific error message (throws TraceLinkError). */
export function assertValidTraceLink(value: unknown): asserts value is TraceLink {
  if (!isTraceLink(value)) {
    throw new TraceLinkError(
      'value does not match the trace link contract (fields: source, target, type [, provenance]; additional properties are forbidden)',
    );
  }
  if (!isArtifactId(value.source)) {
    throw new TraceLinkError(`source is not a well-formed artifact id: ${JSON.stringify(value.source)}`);
  }
  if (!isArtifactId(value.target)) {
    throw new TraceLinkError(`target is not a well-formed artifact id: ${JSON.stringify(value.target)}`);
  }
  if (value.provenance !== undefined && !isNonEmptyStringArray(value.provenance)) {
    throw new TraceLinkError('trace link provenance entries must be non-empty strings (when present)');
  }
}

/** Predicate form of assertValidTraceLink. */
export function validateTraceLink(value: unknown): value is TraceLink {
  try {
    assertValidTraceLink(value);
    return true;
  } catch {
    return false;
  }
}

function linkKey(source: string, target: string, type: string): string {
  return `${source}\u0000${target}\u0000${type}`;
}

/**
 * In-memory trace link store.
 * Rejects duplicate (source, target, type) pairs; the same pair with a
 * different type is a distinct link and is allowed.
 */
export class TraceLinkStore {
  private readonly links: TraceLink[] = [];
  private readonly keys = new Set<string>();

  /** Add an already-validated link (defensive copy stored). */
  add(link: TraceLink): TraceLink {
    assertValidTraceLink(link);
    const key = linkKey(link.source, link.target, link.type);
    if (this.keys.has(key)) {
      throw new TraceLinkError(
        `duplicate trace link rejected: (${link.source}, ${link.target}, ${link.type})`,
      );
    }
    this.keys.add(key);
    const stored: TraceLink = { ...link };
    this.links.push(stored);
    return stored;
  }

  /** Create and add a link in one step. */
  addLink(input: CreateTraceLinkInput): TraceLink {
    return this.add(createTraceLink(input));
  }

  has(source: string, target: string, type: TraceLinkType): boolean {
    return this.keys.has(linkKey(source, target, type));
  }

  /** Forward query: all links whose source is `source` (insertion order). */
  from(source: string): TraceLink[] {
    return this.links.filter((link) => link.source === source).map((link) => ({ ...link }));
  }

  /** Backward query: all links whose target is `target` (insertion order). */
  to(target: string): TraceLink[] {
    return this.links.filter((link) => link.target === target).map((link) => ({ ...link }));
  }

  all(): TraceLink[] {
    return this.links.map((link) => ({ ...link }));
  }

  get size(): number {
    return this.links.length;
  }
}
