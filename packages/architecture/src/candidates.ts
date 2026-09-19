/**
 * LocalCandidate — bounded subgraph replacement over an ArchitectureGraph
 * (spec/architecture.md §8 "Evolution operators" + §5 "Candidate State:
 * bounded subgraph replacement with explicit invariants and predicted
 * effects", realized here in the scoped W2 form).
 *
 * The typed operation set covers exactly the W2-scoped §8 operators:
 *   add/remove/split/merge/replace component,
 *   change interface / data store / topology / policy / model.
 *
 * BOUNDING RULE (machine-enforced, the point of this module): the declared
 * `boundedSubgraph` is the exact set of BASE elements the candidate may
 * remove or modify. Any operator that removes or modifies a base element
 * outside the declared subgraph is REJECTED — the replacement can never
 * silently touch undeclared elements. Implicit removals count: removing a
 * node removes its incident edges, so those edge keys must be declared too.
 * Additions (new node ids / new edge keys) are the replacement content and
 * are always new identities — re-adding an existing id is REJECTED (that is
 * modification, and must be declared + expressed with a change op).
 */

import { isArtifactId, parseArtifactId } from '@sos-2/semantic-spine';
import { CandidateError } from './errors.js';
import { assertValidGraphShape, buildEdge, buildNode, edgeKeyString, sameEdgeKey } from './graph.js';
import type { ArchitectureGraphContent, BuildEdgeInput, BuildNodeInput, EdgeKey, GraphEdge, GraphNode } from './graph.js';
import type { ArchitectureGraphArtifact } from './artifact.js';
import { diffGraphs } from './diff.js';
import type { GraphDiff } from './diff.js';
import type { NodeCriticality } from './graph.js';
import type { JsonValue } from '@sos-2/semantic-spine';

// ---------------------------------------------------------------------------
// Evolution operators (spec/architecture.md §8, W2-scoped)
// ---------------------------------------------------------------------------

export const EVOLUTION_OPERATOR_KINDS = [
  'ADD_COMPONENT',
  'REMOVE_COMPONENT',
  'SPLIT_COMPONENT',
  'MERGE_COMPONENTS',
  'REPLACE_COMPONENT',
  'CHANGE_INTERFACE',
  'CHANGE_DATA_STORE',
  'CHANGE_TOPOLOGY',
  'CHANGE_POLICY',
  'CHANGE_MODEL',
] as const;

export type EvolutionOperatorKind = (typeof EVOLUTION_OPERATOR_KINDS)[number];

/** Shared shape of the four CHANGE_* node-mutation operators. */
interface ChangeNodeOpShape {
  /** Target node id (must exist in the base graph, be of the required kind, and be declared). */
  target: string;
  /** Replacement attributes (wholesale replace — explicit and deterministic). */
  attributes: Record<string, JsonValue>;
  /** Optional criticality change (defaults to keeping the base value). */
  criticality?: NodeCriticality;
}

export type EvolutionOperation =
  | { op: 'ADD_COMPONENT'; node: BuildNodeInput; edges?: BuildEdgeInput[] }
  | { op: 'REMOVE_COMPONENT'; component: string }
  | { op: 'SPLIT_COMPONENT'; component: string; into: BuildNodeInput[]; edges?: BuildEdgeInput[] }
  | { op: 'MERGE_COMPONENTS'; components: string[]; into: BuildNodeInput; edges?: BuildEdgeInput[] }
  | { op: 'REPLACE_COMPONENT'; component: string; with: BuildNodeInput; edges?: BuildEdgeInput[] }
  | ({ op: 'CHANGE_INTERFACE' } & ChangeNodeOpShape)
  | ({ op: 'CHANGE_DATA_STORE' } & ChangeNodeOpShape)
  | ({ op: 'CHANGE_TOPOLOGY'; add: BuildEdgeInput[]; remove: EdgeKey[] })
  | ({ op: 'CHANGE_POLICY' } & ChangeNodeOpShape)
  | ({ op: 'CHANGE_MODEL' } & ChangeNodeOpShape);

// ---------------------------------------------------------------------------
// LocalCandidate
// ---------------------------------------------------------------------------

/** Reference to the exact ArchitectureGraph revision a candidate is based on. */
export interface GraphArtifactRef {
  /** sos://ArchitectureGraph/<segment> artifact id. */
  graph_id: string;
  /** Envelope version of the referenced graph revision. */
  version: number;
}

/** The declared set of base elements a candidate may remove or modify. */
export interface BoundedSubgraph {
  /** Base node ids that may be removed or modified. */
  nodes: string[];
  /** Base edge keys that may be removed or modified. */
  edges: EdgeKey[];
}

export interface LocalCandidate {
  /** The exact base graph revision this candidate evolves. */
  baseGraphRef: GraphArtifactRef;
  /** Declared bounds: base elements that may be removed or modified. */
  boundedSubgraph: BoundedSubgraph;
  /** The typed operation set producing the replacement subgraph (non-empty). */
  replacement: EvolutionOperation[];
  /** Invariants the candidate explicitly preserves (non-empty; statements or invariant ids). */
  invariants: string[];
  /** Predicted effects (may be empty). */
  predictedEffects: string[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function requireNonEmptyStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    throw new CandidateError(`${field} must be an array of non-empty strings`);
  }
  return [...value];
}

function assertGraphArtifactRef(value: unknown): asserts value is GraphArtifactRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CandidateError('baseGraphRef must be an object { graph_id, version }');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) {
    throw new CandidateError('baseGraphRef must have the exact field set { graph_id, version }');
  }
  if (!isNonEmptyString(record.graph_id) || !isArtifactId(record.graph_id)) {
    throw new CandidateError(
      `baseGraphRef.graph_id must be a well-formed artifact id, received: ${JSON.stringify(record.graph_id)}`,
    );
  }
  const parsed = parseArtifactId(record.graph_id);
  if (parsed.kind !== 'ArchitectureGraph') {
    throw new CandidateError(
      `baseGraphRef.graph_id must be a sos://ArchitectureGraph/ artifact id, received kind "${parsed.kind}"`,
    );
  }
  if (typeof record.version !== 'number' || !Number.isInteger(record.version) || record.version < 1) {
    throw new CandidateError(`baseGraphRef.version must be an integer >= 1, received: ${String(record.version)}`);
  }
}

function assertBoundedSubgraph(value: unknown): asserts value is BoundedSubgraph {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CandidateError('boundedSubgraph must be an object { nodes, edges }');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) {
    throw new CandidateError('boundedSubgraph must have the exact field set { nodes, edges }');
  }
  const nodes = requireNonEmptyStringArray(record.nodes, 'boundedSubgraph.nodes');
  const nodeSet = new Set(nodes);
  if (nodeSet.size !== nodes.length) {
    throw new CandidateError('boundedSubgraph.nodes must not contain duplicates');
  }
  if (!Array.isArray(record.edges)) {
    throw new CandidateError('boundedSubgraph.edges must be an array');
  }
  const edgeKeys = new Set<string>();
  for (const key of record.edges) {
    if (typeof key !== 'object' || key === null || Array.isArray(key)) {
      throw new CandidateError('boundedSubgraph.edges entries must be { source, target, kind }');
    }
    const keyRecord = key as Record<string, unknown>;
    if (Object.keys(keyRecord).length !== 3) {
      throw new CandidateError('boundedSubgraph.edges entries must have the exact field set { source, target, kind }');
    }
    if (!isNonEmptyString(keyRecord.source) || !isNonEmptyString(keyRecord.target) || !isNonEmptyString(keyRecord.kind)) {
      throw new CandidateError('boundedSubgraph.edges entries require non-empty source, target and kind');
    }
    const keyString = edgeKeyString(key as EdgeKey);
    if (edgeKeys.has(keyString)) {
      throw new CandidateError(`boundedSubgraph.edges must not contain duplicates: ${keyString}`);
    }
    edgeKeys.add(keyString);
  }
}

function assertEvolutionOperation(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CandidateError('replacement entries must be evolution operation objects');
  }
  const record = value as Record<string, unknown>;
  const op = record.op;
  if (typeof op !== 'string' || !(EVOLUTION_OPERATOR_KINDS as readonly string[]).includes(op)) {
    throw new CandidateError(
      `unknown evolution operator: ${JSON.stringify(op)} (expected one of ${EVOLUTION_OPERATOR_KINDS.join(', ')})`,
    );
  }
}

/** Full validation of a LocalCandidate (throws CandidateError). */
export function assertValidLocalCandidate(value: unknown): asserts value is LocalCandidate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CandidateError('local candidate must be an object');
  }
  const record = value as Record<string, unknown>;
  const keys = ['baseGraphRef', 'boundedSubgraph', 'replacement', 'invariants', 'predictedEffects'];
  if (Object.keys(record).length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    throw new CandidateError(`local candidate must have the exact field set { ${keys.join(', ')} }`);
  }
  assertGraphArtifactRef(record.baseGraphRef);
  assertBoundedSubgraph(record.boundedSubgraph);
  const replacement = record.replacement;
  if (!Array.isArray(replacement) || replacement.length === 0) {
    throw new CandidateError('replacement must be a non-empty array of evolution operations');
  }
  for (const operation of replacement) {
    assertEvolutionOperation(operation);
  }
  const invariants = requireNonEmptyStringArray(record.invariants, 'invariants');
  if (invariants.length === 0) {
    throw new CandidateError(
      'invariants must be non-empty (a candidate without declared preserved invariants is rejected — Architecture Delta discipline)',
    );
  }
  requireNonEmptyStringArray(record.predictedEffects, 'predictedEffects');
}

/** Predicate form of assertValidLocalCandidate. */
export function validateLocalCandidate(value: unknown): value is LocalCandidate {
  try {
    assertValidLocalCandidate(value);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Application (bounded, strict, deterministic)
// ---------------------------------------------------------------------------

export interface AppliedCandidate {
  /** The resulting graph content (projects the same SystemState revision as the base). */
  content: ArchitectureGraphContent;
  /** The deterministic diff base -> result. */
  diff: GraphDiff;
}

interface WorkingGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
}

function workingToShape(working: WorkingGraph): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return {
    nodes: [...working.nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    edges: [...working.edges.values()].sort((a, b) => {
      const ka = edgeKeyString(a);
      const kb = edgeKeyString(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    }),
  };
}

function requireDeclaredNode(id: string, declaredNodes: ReadonlySet<string>): void {
  if (!declaredNodes.has(id)) {
    throw new CandidateError(
      `out-of-bounds candidate operation: node "${id}" is not declared in boundedSubgraph.nodes ` +
        `(the replacement must not silently touch nodes outside the declared subgraph)`,
    );
  }
}

function requireDeclaredEdge(key: EdgeKey, declaredEdges: ReadonlySet<string>): void {
  const keyString = edgeKeyString(key);
  if (!declaredEdges.has(keyString)) {
    throw new CandidateError(
      `out-of-bounds candidate operation: edge ${keyString} is not declared in boundedSubgraph.edges ` +
        `(the replacement must not silently touch edges outside the declared subgraph)`,
    );
  }
}

function removeNodeWithIncidentEdges(
  working: WorkingGraph,
  nodeId: string,
  declaredEdges: ReadonlySet<string>,
): void {
  const node = working.nodes.get(nodeId);
  if (node === undefined) {
    throw new CandidateError(`component "${nodeId}" does not exist in the base graph`);
  }
  // incident edges are implicitly removed — they must ALL be declared
  for (const edge of [...working.edges.values()]) {
    if (edge.source === nodeId || edge.target === nodeId) {
      requireDeclaredEdge(edge, declaredEdges);
      working.edges.delete(edgeKeyString(edge));
    }
  }
  working.nodes.delete(nodeId);
}

function addReplacementEdges(
  working: WorkingGraph,
  edges: readonly BuildEdgeInput[] | undefined,
): void {
  for (const edgeInput of edges ?? []) {
    const edge = buildEdge(edgeInput);
    const keyString = edgeKeyString(edge);
    if (working.edges.has(keyString)) {
      throw new CandidateError(`cannot add edge ${keyString}: already present (additions must be new identities)`);
    }
    if (!working.nodes.has(edge.source)) {
      throw new CandidateError(`cannot add edge ${keyString}: source node "${edge.source}" does not exist`);
    }
    if (!working.nodes.has(edge.target)) {
      throw new CandidateError(`cannot add edge ${keyString}: target node "${edge.target}" does not exist`);
    }
    working.edges.set(keyString, edge);
  }
}

function addReplacementNode(working: WorkingGraph, nodeInput: BuildNodeInput, op: string): GraphNode {
  const node = buildNode(nodeInput);
  if (working.nodes.has(node.id)) {
    throw new CandidateError(`cannot ${op} with node "${node.id}": already present (additions must be new identities)`);
  }
  if (node.kind !== 'Component') {
    throw new CandidateError(`${op} requires a node of kind "Component", received kind "${node.kind}"`);
  }
  working.nodes.set(node.id, node);
  return node;
}

function requireBaseNode(working: WorkingGraph, baseNodes: ReadonlyMap<string, GraphNode>, id: string): GraphNode {
  const base = baseNodes.get(id);
  if (base === undefined) {
    throw new CandidateError(
      `operator target "${id}" is not a base graph element (operators mutate only declared base elements; additions are new identities)`,
    );
  }
  const current = working.nodes.get(id);
  if (current === undefined) {
    throw new CandidateError(`operator target "${id}" was already removed by an earlier operation`);
  }
  return current;
}

/**
 * Apply a LocalCandidate to its EXACT base graph artifact.
 *
 * Order of checks:
 *   1. the candidate is structurally valid;
 *   2. the provided base artifact matches baseGraphRef exactly (id + version)
 *      — candidates never apply to a different revision (exact-revision
 *      discipline);
 *   3. operators apply sequentially with full bound enforcement;
 *   4. the result is structurally valid and its diff against the base is
 *      returned alongside.
 */
export function applyLocalCandidate(
  candidate: LocalCandidate,
  base: ArchitectureGraphArtifact,
): AppliedCandidate {
  assertValidLocalCandidate(candidate);
  assertValidGraphShape({ nodes: base.content.nodes, edges: base.content.edges });

  if (base.envelope.id !== candidate.baseGraphRef.graph_id) {
    throw new CandidateError(
      `base graph id mismatch: candidate declares ${candidate.baseGraphRef.graph_id}, provided artifact is ${base.envelope.id}`,
    );
  }
  if (base.envelope.version !== candidate.baseGraphRef.version) {
    throw new CandidateError(
      `base graph version mismatch: candidate declares version ${candidate.baseGraphRef.version}, provided artifact is version ${base.envelope.version} (exact-revision discipline)`,
    );
  }

  const baseNodes = new Map(base.content.nodes.map((node) => [node.id, node]));
  const declaredNodes = new Set(candidate.boundedSubgraph.nodes);
  const declaredEdges = new Set(candidate.boundedSubgraph.edges.map((key) => edgeKeyString(key)));
  const working: WorkingGraph = {
    nodes: new Map(baseNodes),
    edges: new Map(base.content.edges.map((edge) => [edgeKeyString(edge), edge])),
  };

  for (const operation of candidate.replacement) {
    switch (operation.op) {
      case 'ADD_COMPONENT': {
        addReplacementNode(working, operation.node, 'ADD_COMPONENT');
        addReplacementEdges(working, operation.edges);
        break;
      }
      case 'REMOVE_COMPONENT': {
        requireBaseNode(working, baseNodes, operation.component);
        requireDeclaredNode(operation.component, declaredNodes);
        removeNodeWithIncidentEdges(working, operation.component, declaredEdges);
        break;
      }
      case 'SPLIT_COMPONENT': {
        requireBaseNode(working, baseNodes, operation.component);
        requireDeclaredNode(operation.component, declaredNodes);
        if (!Array.isArray(operation.into) || operation.into.length === 0) {
          throw new CandidateError('SPLIT_COMPONENT requires a non-empty "into" array of replacement nodes');
        }
        removeNodeWithIncidentEdges(working, operation.component, declaredEdges);
        for (const nodeInput of operation.into) {
          addReplacementNode(working, nodeInput, 'SPLIT_COMPONENT');
        }
        addReplacementEdges(working, operation.edges);
        break;
      }
      case 'MERGE_COMPONENTS': {
        if (!Array.isArray(operation.components) || operation.components.length < 2) {
          throw new CandidateError('MERGE_COMPONENTS requires at least two components (use REPLACE_COMPONENT for one)');
        }
        for (const componentId of operation.components) {
          requireBaseNode(working, baseNodes, componentId);
          requireDeclaredNode(componentId, declaredNodes);
          const node = working.nodes.get(componentId)!;
          if (node.kind !== 'Component') {
            throw new CandidateError(
              `MERGE_COMPONENTS target "${componentId}" must be of kind "Component", received kind "${node.kind}"`,
            );
          }
        }
        for (const componentId of operation.components) {
          removeNodeWithIncidentEdges(working, componentId, declaredEdges);
        }
        addReplacementNode(working, operation.into, 'MERGE_COMPONENTS');
        addReplacementEdges(working, operation.edges);
        break;
      }
      case 'REPLACE_COMPONENT': {
        requireBaseNode(working, baseNodes, operation.component);
        requireDeclaredNode(operation.component, declaredNodes);
        removeNodeWithIncidentEdges(working, operation.component, declaredEdges);
        addReplacementNode(working, operation.with, 'REPLACE_COMPONENT');
        addReplacementEdges(working, operation.edges);
        break;
      }
      case 'CHANGE_INTERFACE':
      case 'CHANGE_DATA_STORE':
      case 'CHANGE_POLICY':
      case 'CHANGE_MODEL': {
        const requiredKind =
          operation.op === 'CHANGE_INTERFACE'
            ? 'Interface'
            : operation.op === 'CHANGE_DATA_STORE'
              ? 'DataStore'
              : operation.op === 'CHANGE_POLICY'
                ? 'Policy'
                : 'Model';
        const current = requireBaseNode(working, baseNodes, operation.target);
        requireDeclaredNode(operation.target, declaredNodes);
        if (current.kind !== requiredKind) {
          throw new CandidateError(
            `${operation.op} target "${operation.target}" must be of kind "${requiredKind}", received kind "${current.kind}"`,
          );
        }
        working.nodes.set(
          operation.target,
          buildNode({
            id: current.id,
            kind: current.kind,
            criticality: operation.criticality ?? current.criticality,
            attributes: operation.attributes,
          }),
        );
        break;
      }
      case 'CHANGE_TOPOLOGY': {
        if (!Array.isArray(operation.add) || !Array.isArray(operation.remove)) {
          throw new CandidateError('CHANGE_TOPOLOGY requires "add" and "remove" arrays');
        }
        for (const key of operation.remove) {
          const keyString = edgeKeyString(key);
          const existing = working.edges.get(keyString);
          if (existing === undefined) {
            throw new CandidateError(`CHANGE_TOPOLOGY cannot remove edge ${keyString}: not present`);
          }
          if (existing.kind !== 'DeploysTo') {
            throw new CandidateError(
              `CHANGE_TOPOLOGY removes deployment topology edges; ${keyString} has kind "${existing.kind}"`,
            );
          }
          requireDeclaredEdge(existing, declaredEdges);
          working.edges.delete(keyString);
        }
        for (const edgeInput of operation.add) {
          const edge = buildEdge(edgeInput);
          if (edge.kind !== 'DeploysTo') {
            throw new CandidateError(
              `CHANGE_TOPOLOGY adds deployment topology edges; received kind "${edge.kind}" (expected "DeploysTo")`,
            );
          }
          const keyString = edgeKeyString(edge);
          if (working.edges.has(keyString)) {
            throw new CandidateError(`cannot add edge ${keyString}: already present (additions must be new identities)`);
          }
          if (!working.nodes.has(edge.source) || !working.nodes.has(edge.target)) {
            throw new CandidateError(`cannot add edge ${keyString}: endpoints do not exist`);
          }
          working.edges.set(keyString, edge);
        }
        break;
      }
      // no default: the union is exhaustive over the 10 operator kinds
    }
  }

  const shape = workingToShape(working);
  assertValidGraphShape(shape);
  const content: ArchitectureGraphContent = {
    projects_system_state: base.content.projects_system_state,
    nodes: shape.nodes,
    edges: shape.edges,
  };
  const diff = diffGraphs(
    { nodes: base.content.nodes, edges: base.content.edges },
    { nodes: content.nodes, edges: content.edges },
  );
  return { content, diff };
}
