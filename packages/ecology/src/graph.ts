/**
 * The compatibility/conflict GRAPH over the package population (Work Order
 * W13; spec/architecture.md §5 Package, §18 "Packages require evidence";
 * docs/package-ecology.md Composition: "reuse never bypasses compatibility").
 *
 * DESIGN:
 *   - NODES are package SPINE identities (sos://Package/<32 hex>) — never
 *     invented here; the graph references the population, it does not own it
 *     (the W6 registry stays THE package authority — no second registry).
 *   - EDGES are typed assertions over the two frozen trace types that carry
 *     ecological semantics: COMPATIBLE_WITH and CONFLICTS_WITH (two of the 17
 *     frozen Semantic Spine trace types, consumed from @sos-2/contracts via
 *     @sos-2/semantic-spine — never redefined).
 *   - EVIDENCE-BACKED ASSERTIONS ONLY (machine-checked): an edge assertion
 *     without evidence refs is REJECTED — there is no code path that adds an
 *     evidence-free compatibility/conflict edge to the graph. Compatibility
 *     and conflict are claims about system reality, and claims about system
 *     reality require evidence (spec/architecture.md §18: "Evidence outranks
 *     assertion about system reality").
 *   - Edge RELATIONS are treated as SYMMETRIC at the query level (if A is
 *     compatible with B, B is compatible with A): assertions record the
 *     direction their evidence spoke about, and the aggregated EDGE view
 *     canonicalizes the pair (lexicographic order) so (a,b) and (b,a)
 *     assertions about the same relation aggregate into one edge.
 *   - DETERMINISM: every query output is canonically ordered (sorted); the
 *     graph snapshot is a pure function of the assertion SET (insertion
 *     order never changes it — property-tested with random shuffles); the
 *     snapshot round-trips through restore() byte-identically.
 *   - SPINE INTEGRATION: every assertion carries a spine trace link
 *     projection (toTraceLinks) with mandatory provenance — the graph is
 *     consumable by the Semantic Spine trace store without a second link
 *     authority.
 *
 * Record identity (documented discipline, mirrors the W5 memory-entries
 * pattern): assertions are records INSIDE the ecology aggregate; their ids
 * are deterministic content-addressed hashes (full sha-256 over the spine's
 * canonical serialization of the content minus the id) — reproducible,
 * order-insensitive where the content is canonical, and NOT new spine
 * artifact kinds (no second semantic registry is created).
 */

import { createTraceLink, fullContentHash, isArtifactId, parseArtifactId } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import { EcologyError } from './errors.js';

/** The two frozen trace types that carry ecological edge semantics. */
export const ECOLOGY_EDGE_KINDS = ['COMPATIBLE_WITH', 'CONFLICTS_WITH'] as const;

export type EcologyEdgeKind = (typeof ECOLOGY_EDGE_KINDS)[number];

const ECOLOGY_EDGE_KIND_SET: ReadonlySet<string> = new Set(ECOLOGY_EDGE_KINDS);

/** Structural check: one of the two ecology edge kinds (frozen trace types)? */
export function isEcologyEdgeKind(value: unknown): value is EcologyEdgeKind {
  return typeof value === 'string' && ECOLOGY_EDGE_KIND_SET.has(value);
}

/**
 * One evidence-backed compatibility/conflict assertion between two packages.
 * Multiple assertions per relation accumulate (different studies, more
 * evidence); an assertion without evidence refs cannot exist.
 */
export interface EdgeAssertion {
  /** Deterministic content-addressed id (64 lowercase hex; NOT a spine artifact id). */
  id: string;
  /** Source package spine id (sos://Package/<32 hex>). */
  source: string;
  /** Target package spine id (sos://Package/<32 hex>; different from source). */
  target: string;
  /** COMPATIBLE_WITH or CONFLICTS_WITH (frozen trace types). */
  kind: EcologyEdgeKind;
  /** Evidence backing the assertion — NON-EMPTY, well-formed sos://Evidence ids, canonically sorted unique. */
  evidence_refs: string[];
  /** Who/what asserted this — non-empty entries. */
  provenance: string[];
  /** Optional statement, or null. */
  note: string | null;
}

/** Input to an edge assertion (id is derived). */
export interface EdgeAssertionInput {
  source: string;
  target: string;
  kind: EcologyEdgeKind;
  /** NON-EMPTY; each entry a well-formed sos://Evidence id (evidence-backed edges only). */
  evidence_refs: string[];
  /** NON-EMPTY entries. */
  provenance: string[];
  note?: string | null;
}

/** The exact value an assertion id is derived from (exported for reproduction). */
export interface EdgeAssertionContent {
  source: string;
  target: string;
  kind: EcologyEdgeKind;
  evidence_refs: string[];
  provenance: string[];
  note: string | null;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

function assertPackageId(value: unknown, field: string): asserts value is string {
  if (!isArtifactId(value)) {
    throw new EcologyError(`${field} must be a well-formed spine artifact id, received: ${JSON.stringify(value)}`);
  }
  const parsed = parseArtifactId(value);
  if (parsed.kind !== 'Package') {
    throw new EcologyError(
      `${field} must be a Package id (sos://Package/...) — graph nodes are packages, received: ${JSON.stringify(value)}`,
    );
  }
}

function assertEvidenceRef(value: unknown, field: string): asserts value is string {
  if (!isArtifactId(value)) {
    throw new EcologyError(`${field} entries must be well-formed spine artifact ids, received: ${JSON.stringify(value)}`);
  }
  const parsed = parseArtifactId(value);
  if (parsed.kind !== 'Evidence') {
    throw new EcologyError(
      `${field} entries must be Evidence ids (sos://Evidence/...), received: ${JSON.stringify(value)}`,
    );
  }
}

/** Validate an assertion input (throws EcologyError with a specific message). */
export function assertValidEdgeAssertionInput(value: unknown): asserts value is EdgeAssertionInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EcologyError(`edge assertion input must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  assertPackageId(record['source'], 'edge source');
  assertPackageId(record['target'], 'edge target');
  if (record['source'] === record['target']) {
    throw new EcologyError(
      `edge source and target must differ — a package's relation to itself carries no ecological information, received: ${JSON.stringify(record['source'])}`,
    );
  }
  if (!isEcologyEdgeKind(record['kind'])) {
    throw new EcologyError(
      `edge kind must be one of ${ECOLOGY_EDGE_KINDS.join(', ')} (frozen trace types), received: ${JSON.stringify(record['kind'])}`,
    );
  }
  const evidenceRefs = record['evidence_refs'];
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    throw new EcologyError(
      'edge evidence_refs must be a NON-EMPTY array — an evidence-free compatibility/conflict edge is REJECTED ' +
        '(claims about system reality require evidence; spec/architecture.md §18)',
    );
  }
  for (const ref of evidenceRefs) {
    assertEvidenceRef(ref, 'edge evidence_refs');
  }
  if (!isNonEmptyStringArray(record['provenance'])) {
    throw new EcologyError('edge provenance must be a non-empty array of non-empty strings');
  }
  if (record['note'] !== undefined && record['note'] !== null && typeof record['note'] !== 'string') {
    throw new EcologyError(`edge note must be null or a string, received: ${JSON.stringify(record['note'])}`);
  }
}

/** Full semantic validation of a stored assertion (throws EcologyError). */
export function assertValidEdgeAssertion(value: unknown): asserts value is EdgeAssertion {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EcologyError(`edge assertion must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const hasNote = 'note' in record;
  if (Object.keys(record).length !== (hasNote ? 7 : 6) || !('id' in record)) {
    throw new EcologyError('edge assertion must have the exact field set { id, source, target, kind, evidence_refs, provenance, note }');
  }
  if (typeof record['id'] !== 'string' || !/^[0-9a-f]{64}$/.test(record['id'])) {
    throw new EcologyError(`edge assertion id must be 64 lowercase hex chars, received: ${JSON.stringify(record['id'])}`);
  }
  assertValidEdgeAssertionInput(hasNote ? record : { ...record, note: null });
  // Content-address check: the id must equal the hash of the exact content
  // (a snapshot with a tampered id or non-canonical evidence order is rejected).
  const content: EdgeAssertionContent = {
    source: record['source'] as string,
    target: record['target'] as string,
    kind: record['kind'] as EcologyEdgeKind,
    evidence_refs: record['evidence_refs'] as string[],
    provenance: record['provenance'] as string[],
    note: (hasNote ? record['note'] : null) as string | null,
  };
  if (fullContentHash(content) !== record['id']) {
    throw new EcologyError(
      `edge assertion id does not match its content (content-address discipline): ${JSON.stringify(record['id'])}`,
    );
  }
}

/** The exact derivation content of an assertion input (canonical evidence order). */
export function edgeAssertionContent(input: EdgeAssertionInput): EdgeAssertionContent {
  assertValidEdgeAssertionInput(input);
  const note = input.note ?? null;
  return {
    source: input.source,
    target: input.target,
    kind: input.kind,
    evidence_refs: [...new Set(input.evidence_refs)].sort(),
    provenance: [...input.provenance],
    note,
  };
}

/** Deterministic content-addressed assertion id (sha-256 over the canonical content). */
export function edgeAssertionId(input: EdgeAssertionInput): string {
  return fullContentHash(edgeAssertionContent(input));
}

/** Create a validated edge assertion (id derived; evidence canonically sorted unique). */
export function createEdgeAssertion(input: EdgeAssertionInput): EdgeAssertion {
  const content = edgeAssertionContent(input);
  return { id: fullContentHash(content), ...content };
}

/** The aggregated view of one relation: all assertions for a canonical pair + kind. */
export interface AggregatedEdge {
  /** Canonical source (lexicographically smaller package id of the pair). */
  source: string;
  /** Canonical target (lexicographically larger package id of the pair). */
  target: string;
  kind: EcologyEdgeKind;
  /** All assertions for this relation, canonically sorted by id. */
  assertions: EdgeAssertion[];
  /** Sorted unique union of all assertions' evidence refs. */
  evidence_refs: string[];
}

/** The deterministic coexistence report for a member set. */
export interface CoexistenceReport {
  /** The member set, canonically sorted. */
  members: string[];
  /** True iff NO CONFLICTS_WITH edge exists between any member pair. */
  compatible: boolean;
  /** Conflicting pairs with their backing evidence (canonically sorted). */
  conflicting_pairs: { a: string; b: string; evidence_refs: string[] }[];
}

/** A serializable graph snapshot (round-trips through EcologyGraph.restore). */
export interface EcologyGraphSnapshot {
  /** All assertions, canonically sorted by id. */
  assertions: EdgeAssertion[];
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function relationKey(a: string, b: string, kind: EcologyEdgeKind): string {
  const [lo, hi] = canonicalPair(a, b);
  return `${lo}\u0000${hi}\u0000${kind}`;
}

/**
 * The compatibility/conflict graph over the package population.
 * In-memory, deterministic, confluent (insertion order never changes any
 * query output or the snapshot).
 */
export class EcologyGraph {
  private readonly assertions = new Map<string, EdgeAssertion>();
  private readonly nodes = new Set<string>();
  private readonly relations = new Map<string, EdgeAssertion[]>();

  /**
   * Add an assertion. Idempotent by content: the same input returns the
   * already-stored assertion; different content is a new assertion (more
   * evidence for the same relation accumulates).
   */
  addAssertion(input: EdgeAssertionInput): EdgeAssertion {
    const assertion = createEdgeAssertion(input);
    const existing = this.assertions.get(assertion.id);
    if (existing !== undefined) {
      return structuredClone(existing);
    }
    const stored: EdgeAssertion = structuredClone(assertion);
    this.assertions.set(stored.id, stored);
    this.nodes.add(stored.source);
    this.nodes.add(stored.target);
    const key = relationKey(stored.source, stored.target, stored.kind);
    const bucket = this.relations.get(key);
    if (bucket === undefined) {
      this.relations.set(key, [stored]);
    } else {
      bucket.push(stored);
      bucket.sort((a, b) => compareStrings(a.id, b.id));
    }
    return structuredClone(stored);
  }

  /** The stored assertion with this id, or undefined (defensive copy). */
  assertion(id: string): EdgeAssertion | undefined {
    const existing = this.assertions.get(id);
    return existing === undefined ? undefined : structuredClone(existing);
  }

  hasAssertion(id: string): boolean {
    return this.assertions.has(id);
  }

  /** All node ids appearing in any assertion (sorted). */
  nodesList(): string[] {
    return [...this.nodes].sort(compareStrings);
  }

  /** Number of distinct packages in the graph. */
  get nodeCount(): number {
    return this.nodes.size;
  }

  /** Number of stored assertions. */
  get size(): number {
    return this.assertions.size;
  }

  /** Number of distinct aggregated relations (canonical pair + kind). */
  get edgeCount(): number {
    return this.relations.size;
  }

  /**
   * The aggregated edge between two packages of a kind, or null. SYMMETRIC:
   * edgeBetween(a, b, kind) and edgeBetween(b, a, kind) return the same edge.
   */
  edgeBetween(a: string, b: string, kind: EcologyEdgeKind): AggregatedEdge | null {
    if (!isEcologyEdgeKind(kind)) {
      throw new EcologyError(`edge kind must be one of ${ECOLOGY_EDGE_KINDS.join(', ')}, received: ${JSON.stringify(kind)}`);
    }
    const bucket = this.relations.get(relationKey(a, b, kind));
    if (bucket === undefined || bucket.length === 0) {
      return null;
    }
    const [lo, hi] = canonicalPair(a, b);
    const assertions = bucket.map((entry) => structuredClone(entry)).sort((x, y) => compareStrings(x.id, y.id));
    const evidence = [...new Set(assertions.flatMap((entry) => entry.evidence_refs))].sort(compareStrings);
    return { source: lo, target: hi, kind, assertions, evidence_refs: evidence };
  }

  /** All aggregated edges, canonically sorted by (source, target, kind). */
  edges(): AggregatedEdge[] {
    const result: AggregatedEdge[] = [];
    const sortedKeys = [...this.relations.entries()]
      .map(([key, bucket]) => {
        const [lo, hi, kind] = key.split('\u0000');
        return { lo: lo!, hi: hi!, kind: kind as EcologyEdgeKind, bucket };
      })
      .sort((x, y) => compareStrings(`${x.lo}\u0000${x.hi}\u0000${x.kind}`, `${y.lo}\u0000${y.hi}\u0000${y.kind}`));
    for (const entry of sortedKeys) {
      const assertions = entry.bucket.map((a) => structuredClone(a)).sort((x, y) => compareStrings(x.id, y.id));
      result.push({
        source: entry.lo,
        target: entry.hi,
        kind: entry.kind,
        assertions,
        evidence_refs: [...new Set(assertions.flatMap((a) => a.evidence_refs))].sort(compareStrings),
      });
    }
    return result;
  }

  /** Packages connected to `pkg` by any edge (sorted; symmetric). */
  neighborsOf(pkg: string): string[] {
    const neighbors = new Set<string>();
    for (const edge of this.relations.values()) {
      for (const assertion of edge) {
        if (assertion.source === pkg) {
          neighbors.add(assertion.target);
        } else if (assertion.target === pkg) {
          neighbors.add(assertion.source);
        }
      }
    }
    return [...neighbors].sort(compareStrings);
  }

  /** Packages declared COMPATIBLE_WITH `pkg` (sorted; symmetric). */
  compatibleWith(pkg: string): string[] {
    return this.related(pkg, 'COMPATIBLE_WITH');
  }

  /** Packages declared CONFLICTS_WITH `pkg` (sorted; symmetric). */
  conflictsOf(pkg: string): string[] {
    return this.related(pkg, 'CONFLICTS_WITH');
  }

  private related(pkg: string, kind: EcologyEdgeKind): string[] {
    const result = new Set<string>();
    for (const assertion of this.assertions.values()) {
      if (assertion.kind !== kind) {
        continue;
      }
      if (assertion.source === pkg) {
        result.add(assertion.target);
      } else if (assertion.target === pkg) {
        result.add(assertion.source);
      }
    }
    return [...result].sort(compareStrings);
  }

  /** Does ANY CONFLICTS_WITH assertion exist between a and b? (symmetric) */
  hasConflict(a: string, b: string): boolean {
    const bucket = this.relations.get(relationKey(a, b, 'CONFLICTS_WITH'));
    return bucket !== undefined && bucket.length > 0;
  }

  /**
   * The coexistence report for a member set (e.g. the members of a would-be
   * composition): compatible iff no CONFLICTS_WITH edge exists between any
   * pair. Requires >= 2 DISTINCT well-formed Package ids.
   */
  canCoexist(ids: readonly string[]): CoexistenceReport {
    if (!Array.isArray(ids) || ids.length < 2) {
      throw new EcologyError('canCoexist requires at least 2 member ids (a composition composes packages)');
    }
    const members: string[] = [];
    for (const id of ids) {
      assertPackageId(id, 'canCoexist member');
      if (!members.includes(id)) {
        members.push(id);
      }
    }
    if (members.length < 2) {
      throw new EcologyError('canCoexist requires at least 2 DISTINCT member ids');
    }
    const sorted = [...members].sort(compareStrings);
    const conflicting: { a: string; b: string; evidence_refs: string[] }[] = [];
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i]!;
        const b = sorted[j]!;
        const edge = this.edgeBetween(a, b, 'CONFLICTS_WITH');
        if (edge !== null) {
          conflicting.push({ a, b, evidence_refs: [...edge.evidence_refs] });
        }
      }
    }
    conflicting.sort((x, y) => compareStrings(`${x.a}\u0000${x.b}`, `${y.a}\u0000${y.b}`));
    return { members: sorted, compatible: conflicting.length === 0, conflicting_pairs: conflicting };
  }

  /**
   * Spine trace link projection: one TraceLink per assertion
   * (source --kind--> target, mandatory provenance), canonically sorted by
   * (source, target, kind, id).
   */
  toTraceLinks(): TraceLink[] {
    return [...this.assertions.values()]
      .sort(
        (a, b) =>
          compareStrings(
            `${a.source}\u0000${a.target}\u0000${a.kind}\u0000${a.id}`,
            `${b.source}\u0000${b.target}\u0000${b.kind}\u0000${b.id}`,
          ),
      )
      .map((assertion) =>
        createTraceLink({
          source: assertion.source,
          target: assertion.target,
          type: assertion.kind,
          provenance: [...assertion.provenance],
        }),
      );
  }

  /** A serializable snapshot (assertions canonically sorted by id). */
  snapshot(): EcologyGraphSnapshot {
    return {
      assertions: [...this.assertions.values()]
        .sort((a, b) => compareStrings(a.id, b.id))
        .map((assertion) => structuredClone(assertion)),
    };
  }

  /** Rebuild a graph from a snapshot (validated; canonical round trip). */
  static restore(snapshot: EcologyGraphSnapshot): EcologyGraph {
    if (!isPlainObject(snapshot)) {
      throw new EcologyError(`graph snapshot must be an object { assertions }, received: ${JSON.stringify(snapshot)}`);
    }
    const record = snapshot;
    if (Object.keys(record).length !== 1 || !('assertions' in record)) {
      throw new EcologyError('graph snapshot must have the exact field set { assertions }');
    }
    if (!Array.isArray(record['assertions'])) {
      throw new EcologyError('graph snapshot assertions must be an array');
    }
    const graph = new EcologyGraph();
    for (const value of record['assertions']) {
      assertValidEdgeAssertion(value);
      const assertion = value as EdgeAssertion;
      const existing = graph.assertions.get(assertion.id);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(assertion)) {
          throw new EcologyError(`graph snapshot contains conflicting assertions with id ${assertion.id}`);
        }
        continue;
      }
      const stored = structuredClone(assertion);
      graph.assertions.set(stored.id, stored);
      graph.nodes.add(stored.source);
      graph.nodes.add(stored.target);
      const key = relationKey(stored.source, stored.target, stored.kind);
      const bucket = graph.relations.get(key);
      if (bucket === undefined) {
        graph.relations.set(key, [stored]);
      } else {
        bucket.push(stored);
        bucket.sort((a, b) => compareStrings(a.id, b.id));
      }
    }
    return graph;
  }
}
