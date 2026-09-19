/**
 * Deterministic graph diffs.
 *
 * diff(graphA, graphB) -> { added/removed/modified nodes and edges } with:
 *   - stable ordering: nodes sorted by id, edges sorted by edge key string;
 *   - byte-identical output on re-run (canonical serialization + sorted
 *     arrays — pinned by tests);
 *   - structural asymmetry: diff(A, B) and diff(B, A) describe the same
 *     changes from opposite directions (added <-> removed swap; modified
 *     entries carry before/after snapshots that swap accordingly).
 *
 * `applyGraphDiff(base, diff)` reconstructs the target graph STRICTLY: every
 * removed/modified element must exist in the base with exactly the recorded
 * `before` value, every added element must be a new identity. This makes
 * apply(base, diff(base, target)) === target a machine-checked round trip.
 */

import { canonicalSerialize } from '@sos-2/semantic-spine';
import { GraphDiffError } from './errors.js';
import { assertValidGraphShape, edgeKeyString, sameEdgeKey } from './graph.js';
import type { GraphEdge, GraphNode, GraphShape, EdgeKey } from './graph.js';

export interface ModifiedNode {
  /** The (unchanged) node id. */
  id: string;
  /** The node as it exists in graph A. */
  before: GraphNode;
  /** The node as it exists in graph B. */
  after: GraphNode;
}

export interface ModifiedEdge {
  /** The (unchanged) edge identity triple. */
  key: EdgeKey;
  /** The edge as it exists in graph A. */
  before: GraphEdge;
  /** The edge as it exists in graph B. */
  after: GraphEdge;
}

export interface GraphDiff {
  /** Nodes present in B but not in A (sorted by id). */
  added_nodes: GraphNode[];
  /** Nodes present in A but not in B (sorted by id). */
  removed_nodes: GraphNode[];
  /** Nodes with the same id but different content (sorted by id). */
  modified_nodes: ModifiedNode[];
  /** Edges present in B but not in A (sorted by edge key). */
  added_edges: GraphEdge[];
  /** Edges present in A but not in B (sorted by edge key). */
  removed_edges: GraphEdge[];
  /** Edges with the same key but different content (sorted by edge key). */
  modified_edges: ModifiedEdge[];
}

/** A fresh empty diff (all six sections empty). */
export function emptyGraphDiff(): GraphDiff {
  return {
    added_nodes: [],
    removed_nodes: [],
    modified_nodes: [],
    added_edges: [],
    removed_edges: [],
    modified_edges: [],
  };
}

function nodeEquals(a: GraphNode, b: GraphNode): boolean {
  return canonicalSerialize(a) === canonicalSerialize(b);
}

function edgeEquals(a: GraphEdge, b: GraphEdge): boolean {
  return canonicalSerialize(a) === canonicalSerialize(b);
}

function compareNodes(a: GraphNode, b: GraphNode): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareEdges(a: GraphEdge, b: GraphEdge): number {
  return edgeKeyString(a) < edgeKeyString(b) ? -1 : edgeKeyString(a) > edgeKeyString(b) ? 1 : 0;
}

/**
 * Compute the deterministic diff between two graph shapes.
 * Both inputs are structurally validated; the output arrays are canonically
 * sorted; the function is total and deterministic.
 */
export function diffGraphs(a: GraphShape, b: GraphShape): GraphDiff {
  assertValidGraphShape(a);
  assertValidGraphShape(b);

  const aNodes = new Map(a.nodes.map((node) => [node.id, node]));
  const bNodes = new Map(b.nodes.map((node) => [node.id, node]));
  const addedNodes: GraphNode[] = [];
  const removedNodes: GraphNode[] = [];
  const modifiedNodes: ModifiedNode[] = [];
  for (const node of aNodes.values()) {
    const other = bNodes.get(node.id);
    if (other === undefined) {
      removedNodes.push(node);
    } else if (!nodeEquals(node, other)) {
      modifiedNodes.push({ id: node.id, before: node, after: other });
    }
  }
  for (const node of bNodes.values()) {
    if (!aNodes.has(node.id)) {
      addedNodes.push(node);
    }
  }

  const aEdges = new Map(a.edges.map((edge) => [edgeKeyString(edge), edge]));
  const bEdges = new Map(b.edges.map((edge) => [edgeKeyString(edge), edge]));
  const addedEdges: GraphEdge[] = [];
  const removedEdges: GraphEdge[] = [];
  const modifiedEdges: ModifiedEdge[] = [];
  for (const edge of aEdges.values()) {
    const other = bEdges.get(edgeKeyString(edge));
    if (other === undefined) {
      removedEdges.push(edge);
    } else if (!edgeEquals(edge, other)) {
      modifiedEdges.push({ key: { source: edge.source, target: edge.target, kind: edge.kind }, before: edge, after: other });
    }
  }
  for (const edge of bEdges.values()) {
    if (!aEdges.has(edgeKeyString(edge))) {
      addedEdges.push(edge);
    }
  }

  return {
    added_nodes: addedNodes.sort(compareNodes),
    removed_nodes: removedNodes.sort(compareNodes),
    modified_nodes: modifiedNodes.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)),
    added_edges: addedEdges.sort(compareEdges),
    removed_edges: removedEdges.sort(compareEdges),
    modified_edges: modifiedEdges.sort((x, y) => {
      const kx = edgeKeyString(x.key);
      const ky = edgeKeyString(y.key);
      return kx < ky ? -1 : kx > ky ? 1 : 0;
    }),
  };
}

/** Canonical JSON text of a diff (byte-identical for identical diffs). */
export function canonicalGraphDiffText(diff: GraphDiff): string {
  return canonicalSerialize(diff);
}

function requireArray<T>(value: unknown, field: string): T[] {
  if (!Array.isArray(value)) {
    throw new GraphDiffError(`${field} must be an array`);
  }
  return value as T[];
}

function validateDiffShape(diff: unknown): asserts diff is GraphDiff {
  if (typeof diff !== 'object' || diff === null || Array.isArray(diff)) {
    throw new GraphDiffError('graph diff must be an object');
  }
  const record = diff as Record<string, unknown>;
  const keys = [
    'added_nodes',
    'removed_nodes',
    'modified_nodes',
    'added_edges',
    'removed_edges',
    'modified_edges',
  ];
  if (Object.keys(record).length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    throw new GraphDiffError(`graph diff must have the exact field set { ${keys.join(', ')} }`);
  }
  for (const nodeSection of ['added_nodes', 'removed_nodes'] as const) {
    for (const node of requireArray<GraphNode>(record[nodeSection], nodeSection)) {
      if (typeof node !== 'object' || node === null) {
        throw new GraphDiffError(`${nodeSection} entries must be nodes`);
      }
    }
  }
  for (const edgeSection of ['added_edges', 'removed_edges'] as const) {
    for (const edge of requireArray<GraphEdge>(record[edgeSection], edgeSection)) {
      if (typeof edge !== 'object' || edge === null) {
        throw new GraphDiffError(`${edgeSection} entries must be edges`);
      }
    }
  }
  for (const node of requireArray<ModifiedNode>(record.modified_nodes, 'modified_nodes')) {
    if (typeof node !== 'object' || node === null) {
      throw new GraphDiffError('modified_nodes entries must be { id, before, after }');
    }
    if (node.before.id !== node.id || node.after.id !== node.id) {
      throw new GraphDiffError(`modified node ${node.id}: before/after ids must match the entry id`);
    }
  }
  for (const edge of requireArray<ModifiedEdge>(record.modified_edges, 'modified_edges')) {
    if (typeof edge !== 'object' || edge === null) {
      throw new GraphDiffError('modified_edges entries must be { key, before, after }');
    }
    if (
      !sameEdgeKey(edge.before, edge.key) ||
      !sameEdgeKey(edge.after, edge.key) ||
      !sameEdgeKey(edge.before, edge.after)
    ) {
      throw new GraphDiffError(
        `modified edge ${edgeKeyString(edge.key)}: before/after keys must match the entry key`,
      );
    }
  }
}

/**
 * STRICTLY apply a diff to a base graph shape and return the target shape.
 * Every removed/modified element must exist in the base exactly as recorded
 * (`before` must match); every added element must be a new identity. Throws
 * GraphDiffError on any mismatch — apply never silently invents or drops
 * elements.
 */
export function applyGraphDiff(base: GraphShape, diff: GraphDiff): GraphShape {
  assertValidGraphShape(base);
  validateDiffShape(diff);

  const nodes = new Map(base.nodes.map((node) => [node.id, node]));
  const edges = new Map(base.edges.map((edge) => [edgeKeyString(edge), edge]));

  for (const node of diff.removed_nodes) {
    const existing = nodes.get(node.id);
    if (existing === undefined) {
      throw new GraphDiffError(`cannot remove node "${node.id}": not present in the base graph`);
    }
    if (!nodeEquals(existing, node)) {
      throw new GraphDiffError(`cannot remove node "${node.id}": recorded before-value does not match the base graph`);
    }
    nodes.delete(node.id);
  }
  for (const modification of diff.modified_nodes) {
    const existing = nodes.get(modification.id);
    if (existing === undefined) {
      throw new GraphDiffError(`cannot modify node "${modification.id}": not present in the base graph`);
    }
    if (!nodeEquals(existing, modification.before)) {
      throw new GraphDiffError(`cannot modify node "${modification.id}": recorded before-value does not match the base graph`);
    }
    nodes.set(modification.id, modification.after);
  }
  for (const node of diff.added_nodes) {
    if (nodes.has(node.id)) {
      throw new GraphDiffError(`cannot add node "${node.id}": already present in the base graph`);
    }
    nodes.set(node.id, node);
  }

  for (const edge of diff.removed_edges) {
    const key = edgeKeyString(edge);
    const existing = edges.get(key);
    if (existing === undefined) {
      throw new GraphDiffError(`cannot remove edge ${key}: not present in the base graph`);
    }
    if (!edgeEquals(existing, edge)) {
      throw new GraphDiffError(`cannot remove edge ${key}: recorded before-value does not match the base graph`);
    }
    edges.delete(key);
  }
  for (const modification of diff.modified_edges) {
    const key = edgeKeyString(modification.key);
    const existing = edges.get(key);
    if (existing === undefined) {
      throw new GraphDiffError(`cannot modify edge ${key}: not present in the base graph`);
    }
    if (!edgeEquals(existing, modification.before)) {
      throw new GraphDiffError(`cannot modify edge ${key}: recorded before-value does not match the base graph`);
    }
    edges.set(key, modification.after);
  }
  for (const edge of diff.added_edges) {
    const key = edgeKeyString(edge);
    if (edges.has(key)) {
      throw new GraphDiffError(`cannot add edge ${key}: already present in the base graph`);
    }
    edges.set(key, edge);
  }

  const result: GraphShape = {
    nodes: [...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    edges: [...edges.values()].sort((a, b) => {
      const ka = edgeKeyString(a);
      const kb = edgeKeyString(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    }),
  };
  assertValidGraphShape(result);
  return result;
}

/** Whether a diff is empty (identical graphs). */
export function isGraphDiffEmpty(diff: GraphDiff): boolean {
  return (
    diff.added_nodes.length === 0 &&
    diff.removed_nodes.length === 0 &&
    diff.modified_nodes.length === 0 &&
    diff.added_edges.length === 0 &&
    diff.removed_edges.length === 0 &&
    diff.modified_edges.length === 0
  );
}

/** Count of changes in a diff (all six sections). */
export function graphDiffSize(diff: GraphDiff): number {
  return (
    diff.added_nodes.length +
    diff.removed_nodes.length +
    diff.modified_nodes.length +
    diff.added_edges.length +
    diff.removed_edges.length +
    diff.modified_edges.length
  );
}

/** Structural (deep) equality of two diffs via canonical serialization. */
export function graphDiffsEqual(a: GraphDiff, b: GraphDiff): boolean {
  return canonicalGraphDiffText(a) === canonicalGraphDiffText(b);
}
