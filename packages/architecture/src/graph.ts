/**
 * Architecture Graph structure — typed nodes and edges (spec/architecture.md
 * §5 "Architecture Graph: typed nodes and edges representing capabilities,
 * components, interfaces, data stores, deployment, trust, policies, models,
 * adapters and dependencies").
 *
 * Node identity is the node id; edge identity is the (source, target, kind)
 * triple. Node ids are slug-like (see NODE_ID_PATTERN) so composite edge
 * keys stay unambiguous. Attributes are plain JSON values (the spine's
 * canonical serializer handles them deterministically).
 *
 * A canonical ArchitectureGraphContent always stores nodes sorted by id and
 * edges sorted by edge key — deterministic iteration for free.
 */

import { isArtifactId, parseArtifactId } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import type { SystemStateRevisionRef } from '@sos-2/system-state';
import { GraphError } from './errors.js';
import { isRegisteredEdgeKind, isRegisteredNodeKind } from './kinds.js';

export type NodeCriticality = 'critical' | 'normal';

/** Slug-like node ids (unambiguous composite edge keys). */
export const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export interface GraphNode {
  /** Stable node id within the graph (e.g. "auth-service", "iface:auth-api"). */
  id: string;
  /** Registered node kind (one of the nine §5 categories or an extension). */
  kind: string;
  /** Node criticality (drives conformance classification of removals). */
  criticality: NodeCriticality;
  /** Plain JSON attributes (deterministic under canonical serialization). */
  attributes: Record<string, JsonValue>;
}

/** Edge identity triple. */
export interface EdgeKey {
  source: string;
  target: string;
  kind: string;
}

export interface GraphEdge extends EdgeKey {
  /** Edge criticality. */
  criticality: NodeCriticality;
  /** Plain JSON attributes. */
  attributes: Record<string, JsonValue>;
}

export function edgeKeyString(key: EdgeKey): string {
  return `${key.source}->${key.target}->${key.kind}`;
}

export function sameEdgeKey(a: EdgeKey, b: EdgeKey): boolean {
  return a.source === b.source && a.target === b.target && a.kind === b.kind;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return Number.isFinite(value) || typeof value !== 'number';
  }
  if (typeof value === 'string') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isPlainJsonValue);
  }
  if (typeof value === 'object' && value !== null) {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return false;
    }
    return Object.values(value).every(isPlainJsonValue);
  }
  return false;
}

function assertAttributes(value: unknown, field: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GraphError(`${field} must be a plain JSON object`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new GraphError(`${field} must be a plain JSON object`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key.length === 0) {
      throw new GraphError(`${field} keys must be non-empty strings`);
    }
    if (!isPlainJsonValue(entry)) {
      throw new GraphError(`${field}.${key} is not a plain JSON value (finite numbers, strings, booleans, null, arrays, plain objects)`);
    }
  }
}

function assertCriticality(value: unknown, field: string): void {
  if (value !== 'critical' && value !== 'normal') {
    throw new GraphError(`${field} must be "critical" or "normal", received: ${JSON.stringify(value)}`);
  }
}

/** Builder input for a node (criticality defaults to "normal", attributes to {}). */
export interface BuildNodeInput {
  id: string;
  kind: string;
  criticality?: NodeCriticality;
  attributes?: Record<string, JsonValue>;
}

/** Build a validated node. Kind membership in the default registry is checked. */
export function buildNode(input: BuildNodeInput): GraphNode {
  if (typeof input !== 'object' || input === null) {
    throw new GraphError('node input must be an object');
  }
  if (!isNonEmptyString(input.id) || !NODE_ID_PATTERN.test(input.id)) {
    throw new GraphError(
      `node id must match ${NODE_ID_PATTERN.toString()}, received: ${JSON.stringify(input.id)}`,
    );
  }
  if (!isNonEmptyString(input.kind)) {
    throw new GraphError(`node ${input.id}: kind must be a non-empty string`);
  }
  if (!isRegisteredNodeKind(input.kind)) {
    throw new GraphError(
      `node ${input.id}: unknown node kind "${input.kind}" (register extensions via registerNodeKind first)`,
    );
  }
  const criticality: NodeCriticality = input.criticality ?? 'normal';
  assertCriticality(criticality, `node ${input.id}: criticality`);
  const attributes = input.attributes ?? {};
  assertAttributes(attributes, `node ${input.id}: attributes`);
  return { id: input.id, kind: input.kind, criticality, attributes };
}

/** Builder input for an edge (criticality defaults to "normal", attributes to {}). */
export interface BuildEdgeInput extends EdgeKey {
  criticality?: NodeCriticality;
  attributes?: Record<string, JsonValue>;
}

/** Build a validated edge. Kind membership in the default registry is checked. */
export function buildEdge(input: BuildEdgeInput): GraphEdge {
  if (typeof input !== 'object' || input === null) {
    throw new GraphError('edge input must be an object');
  }
  if (!isNonEmptyString(input.source) || !isNonEmptyString(input.target)) {
    throw new GraphError('edge source and target must be non-empty node ids');
  }
  if (!isNonEmptyString(input.kind)) {
    throw new GraphError('edge kind must be a non-empty string');
  }
  if (!isRegisteredEdgeKind(input.kind)) {
    throw new GraphError(
      `edge ${input.source}->${input.target}: unknown edge kind "${input.kind}" (register extensions via registerEdgeKind first)`,
    );
  }
  const criticality: NodeCriticality = input.criticality ?? 'normal';
  assertCriticality(criticality, `edge ${input.source}->${input.target}: criticality`);
  const attributes = input.attributes ?? {};
  assertAttributes(attributes, `edge ${input.source}->${input.target}: attributes`);
  return { source: input.source, target: input.target, kind: input.kind, criticality, attributes };
}

// ---------------------------------------------------------------------------
// Graph content
// ---------------------------------------------------------------------------

/**
 * The content of an ArchitectureGraph artifact: a versioned HYPOTHESIS over
 * System State (spec/architecture.md §6) — it references the exact
 * SystemState revision it projects, and is NOT a copy of code.
 */
export interface ArchitectureGraphContent {
  /** The exact SystemState revision this architecture hypothesis projects. */
  projects_system_state: SystemStateRevisionRef;
  /** Nodes sorted by id (canonical form). */
  nodes: GraphNode[];
  /** Edges sorted by edge key (canonical form). */
  edges: GraphEdge[];
}

/** A minimal structural graph shape (used by diff/check APIs). */
export interface GraphShape {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function assertValidSystemStateRevisionRef(value: unknown): asserts value is SystemStateRevisionRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GraphError('projects_system_state must be an object { system_state_id, version }');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) {
    throw new GraphError('projects_system_state must have the exact field set { system_state_id, version }');
  }
  if (!isNonEmptyString(record.system_state_id) || !isArtifactId(record.system_state_id)) {
    throw new GraphError(
      `projects_system_state.system_state_id must be a well-formed artifact id, received: ${JSON.stringify(record.system_state_id)}`,
    );
  }
  const parsed = parseArtifactId(record.system_state_id);
  if (parsed.kind !== 'SystemState') {
    throw new GraphError(
      `projects_system_state.system_state_id must be a sos://SystemState/ artifact id, received kind "${parsed.kind}"`,
    );
  }
  if (typeof record.version !== 'number' || !Number.isInteger(record.version) || record.version < 1) {
    throw new GraphError(
      `projects_system_state.version must be an integer >= 1, received: ${String(record.version)}`,
    );
  }
}

/**
 * Structural validation of a graph shape (no registry checks — those happen
 * at node/edge build time; this validates well-formedness: unique node ids,
 * unique edge keys, no dangling edge endpoints).
 */
export function assertValidGraphShape(value: unknown): asserts value is GraphShape {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GraphError('graph must be an object { nodes, edges }');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length < 2 || !Array.isArray(record.nodes) || !Array.isArray(record.edges)) {
    throw new GraphError('graph must be an object { nodes, edges }');
  }
  const nodeIds = new Set<string>();
  for (const node of record.nodes) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      throw new GraphError('graph nodes must be objects');
    }
    const nodeRecord = node as Record<string, unknown>;
    if (Object.keys(nodeRecord).length !== 4) {
      throw new GraphError(`graph node must have the exact field set { id, kind, criticality, attributes }`);
    }
    if (!isNonEmptyString(nodeRecord.id) || !NODE_ID_PATTERN.test(nodeRecord.id)) {
      throw new GraphError(`graph node id must match ${NODE_ID_PATTERN.toString()}, received: ${JSON.stringify(nodeRecord.id)}`);
    }
    if (!isNonEmptyString(nodeRecord.kind)) {
      throw new GraphError(`graph node ${nodeRecord.id}: kind must be a non-empty string`);
    }
    assertCriticality(nodeRecord.criticality, `graph node ${nodeRecord.id}: criticality`);
    assertAttributes(nodeRecord.attributes, `graph node ${nodeRecord.id}: attributes`);
    if (nodeIds.has(nodeRecord.id)) {
      throw new GraphError(`duplicate node id: ${nodeRecord.id}`);
    }
    nodeIds.add(nodeRecord.id);
  }
  const edgeKeys = new Set<string>();
  for (const edge of record.edges) {
    if (typeof edge !== 'object' || edge === null || Array.isArray(edge)) {
      throw new GraphError('graph edges must be objects');
    }
    const edgeRecord = edge as Record<string, unknown>;
    if (Object.keys(edgeRecord).length !== 5) {
      throw new GraphError(`graph edge must have the exact field set { source, target, kind, criticality, attributes }`);
    }
    if (!isNonEmptyString(edgeRecord.source) || !isNonEmptyString(edgeRecord.target) || !isNonEmptyString(edgeRecord.kind)) {
      throw new GraphError('graph edge source, target and kind must be non-empty strings');
    }
    const key = `${edgeRecord.source}->${edgeRecord.target}->${edgeRecord.kind}`;
    if (edgeKeys.has(key)) {
      throw new GraphError(`duplicate edge: ${key}`);
    }
    edgeKeys.add(key);
    if (!nodeIds.has(edgeRecord.source)) {
      throw new GraphError(`edge ${key}: source node "${edgeRecord.source}" does not exist (dangling edge)`);
    }
    if (!nodeIds.has(edgeRecord.target)) {
      throw new GraphError(`edge ${key}: target node "${edgeRecord.target}" does not exist (dangling edge)`);
    }
    assertCriticality(edgeRecord.criticality, `edge ${key}: criticality`);
    assertAttributes(edgeRecord.attributes, `edge ${key}: attributes`);
  }
}

/** Predicate form of assertValidGraphShape. */
export function validateGraphShape(value: unknown): value is GraphShape {
  try {
    assertValidGraphShape(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a canonical graph content: nodes and edges are validated (kinds
 * checked against the default registries), sorted (nodes by id, edges by
 * edge key), with a validated exact SystemState revision reference.
 */
export function buildGraphContent(input: {
  projects_system_state: SystemStateRevisionRef;
  nodes: readonly BuildNodeInput[];
  edges: readonly BuildEdgeInput[];
}): ArchitectureGraphContent {
  assertValidSystemStateRevisionRef(input.projects_system_state);
  const nodes = input.nodes.map((node) => buildNode(node)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const shape: GraphShape = { nodes, edges: [] };
  // validate node uniqueness + build edges against the node id set
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      throw new GraphError(`duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);
  }
  const edges = input.edges.map((edge) => buildEdge(edge)).sort((a, b) => {
    const ka = edgeKeyString(a);
    const kb = edgeKeyString(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const edgeKeys = new Set<string>();
  for (const edge of edges) {
    const key = edgeKeyString(edge);
    if (edgeKeys.has(key)) {
      throw new GraphError(`duplicate edge: ${key}`);
    }
    edgeKeys.add(key);
    if (!nodeIds.has(edge.source)) {
      throw new GraphError(`edge ${key}: source node "${edge.source}" does not exist (dangling edge)`);
    }
    if (!nodeIds.has(edge.target)) {
      throw new GraphError(`edge ${key}: target node "${edge.target}" does not exist (dangling edge)`);
    }
  }
  shape.edges = edges;
  assertValidGraphShape(shape);
  return { projects_system_state: input.projects_system_state, nodes, edges };
}
