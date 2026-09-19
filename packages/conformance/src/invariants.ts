/**
 * Executable architecture invariants — the typed, small invariant DSL of
 * spec/architecture.md §7 ("Where practical, architecture invariants are
 * machine checked").
 *
 * Four frozen invariant kinds (each machine-checkable over an Architecture
 * Graph shape):
 *
 *   REQUIRED_INTERFACE   component of kind K must expose interface I
 *                        (a Provides edge from a K-kind node to the
 *                        interface node with id I)
 *
 *   FORBIDDEN_DEPENDENCY  component kinds A -> B are forbidden
 *                         (no edge of the dependency edge kind — default
 *                         "Dependency" — from an A-kind node to a B-kind
 *                         node)
 *
 *   LAYERING             path constraints over an ordered list of node-kind
 *                         layers (ordered bottom -> top): a dependency edge
 *                         pointing to a HIGHER layer than its source (an
 *                         "upward dependency") is a violation. Because any
 *                         upward PATH must contain at least one upward edge,
 *                         forbidding upward edges also forbids upward paths
 *                         (documented closure).
 *
 *   DATA_OWNERSHIP       every data store has exactly one owning component
 *                        (exactly one Owns edge targets each DataStore node;
 *                         any Owns edge claims ownership, so zero or
 *                         multiple owners are violations)
 *
 * check(invariant, graph) -> { status: PASS | FAIL | NOT_APPLICABLE,
 *                              evidence: subject ids, reason } — total and
 * deterministic on valid inputs.
 */

import { assertValidGraphShape } from '@sos-2/architecture';
import type { GraphShape } from '@sos-2/architecture';
import { InvariantError } from './errors.js';

export const INVARIANT_KINDS = [
  'REQUIRED_INTERFACE',
  'FORBIDDEN_DEPENDENCY',
  'LAYERING',
  'DATA_OWNERSHIP',
] as const;

export type InvariantKind = (typeof INVARIANT_KINDS)[number];

const INVARIANT_KIND_SET: ReadonlySet<string> = new Set(INVARIANT_KINDS);

export type InvariantStatus = 'PASS' | 'FAIL' | 'NOT_APPLICABLE';

/** The canonical dependency edge kind used by path/dependency invariants. */
export const DEPENDENCY_EDGE_KIND = 'Dependency';

/** The canonical ownership edge kind used by DATA_OWNERSHIP. */
export const OWNERSHIP_EDGE_KIND = 'Owns';

/** The canonical exposure edge kind used by REQUIRED_INTERFACE. */
export const EXPOSURE_EDGE_KIND = 'Provides';

/** The canonical data store node kind used by DATA_OWNERSHIP. */
export const DATA_STORE_NODE_KIND = 'DataStore';

export interface RequiredInterfaceInvariant {
  kind: 'REQUIRED_INTERFACE';
  /** Node kind whose members must expose the interface (the "component of kind K"). */
  componentKind: string;
  /** The interface node id that must be exposed. */
  interfaceId: string;
}

export interface ForbiddenDependencyInvariant {
  kind: 'FORBIDDEN_DEPENDENCY';
  /** Forbidden source node kind (A in A -> B). */
  fromKind: string;
  /** Forbidden target node kind (B in A -> B). */
  toKind: string;
  /** The edge kind that counts as a dependency. Defaults to "Dependency". */
  edgeKind?: string;
}

export interface LayeringInvariant {
  kind: 'LAYERING';
  /** Ordered node-kind layers, bottom -> top (upward dependencies are violations). */
  layers: string[];
}

export interface DataOwnershipInvariant {
  kind: 'DATA_OWNERSHIP';
}

export type Invariant =
  | RequiredInterfaceInvariant
  | ForbiddenDependencyInvariant
  | LayeringInvariant
  | DataOwnershipInvariant;

export interface InvariantCheckResult {
  /** The checked invariant (echoed for evidence binding). */
  invariant: Invariant;
  status: InvariantStatus;
  /** Subject ids backing the verdict (violating or conforming subjects). */
  evidence: string[];
  /** Human-readable, deterministic reason. */
  reason: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Full semantic validation with a specific error message (throws InvariantError). */
export function assertValidInvariant(value: unknown): asserts value is Invariant {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvariantError('invariant must be an object');
  }
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.kind) || !INVARIANT_KIND_SET.has(record.kind)) {
    throw new InvariantError(
      `unknown invariant kind: ${JSON.stringify(record.kind)} (expected one of ${INVARIANT_KINDS.join(', ')})`,
    );
  }
  switch (record.kind) {
    case 'REQUIRED_INTERFACE': {
      if (Object.keys(record).length !== 3) {
        throw new InvariantError('REQUIRED_INTERFACE must have the exact field set { kind, componentKind, interfaceId }');
      }
      if (!isNonEmptyString(record.componentKind)) {
        throw new InvariantError('REQUIRED_INTERFACE.componentKind must be a non-empty string');
      }
      if (!isNonEmptyString(record.interfaceId)) {
        throw new InvariantError('REQUIRED_INTERFACE.interfaceId must be a non-empty string');
      }
      break;
    }
    case 'FORBIDDEN_DEPENDENCY': {
      const allowed = record.edgeKind === undefined ? 3 : 4;
      if (Object.keys(record).length !== allowed) {
        throw new InvariantError(
          'FORBIDDEN_DEPENDENCY must have the exact field set { kind, fromKind, toKind [, edgeKind] }',
        );
      }
      if (!isNonEmptyString(record.fromKind) || !isNonEmptyString(record.toKind)) {
        throw new InvariantError('FORBIDDEN_DEPENDENCY.fromKind and toKind must be non-empty strings');
      }
      if (record.edgeKind !== undefined && !isNonEmptyString(record.edgeKind)) {
        throw new InvariantError('FORBIDDEN_DEPENDENCY.edgeKind must be a non-empty string when present');
      }
      break;
    }
    case 'LAYERING': {
      if (Object.keys(record).length !== 2) {
        throw new InvariantError('LAYERING must have the exact field set { kind, layers }');
      }
      if (!Array.isArray(record.layers) || record.layers.length < 2) {
        throw new InvariantError('LAYERING.layers must be an array of at least two layer kinds');
      }
      if (!record.layers.every(isNonEmptyString)) {
        throw new InvariantError('LAYERING.layers entries must be non-empty strings');
      }
      if (new Set(record.layers).size !== record.layers.length) {
        throw new InvariantError('LAYERING.layers must not contain duplicate kinds');
      }
      break;
    }
    case 'DATA_OWNERSHIP': {
      if (Object.keys(record).length !== 1) {
        throw new InvariantError('DATA_OWNERSHIP must have the exact field set { kind }');
      }
      break;
    }
  }
}

/** Predicate form of assertValidInvariant. */
export function validateInvariant(value: unknown): value is Invariant {
  try {
    assertValidInvariant(value);
    return true;
  } catch {
    return false;
  }
}

function sortedIds(ids: readonly string[]): string[] {
  return [...ids].sort();
}

function checkRequiredInterface(
  invariant: RequiredInterfaceInvariant,
  graph: GraphShape,
): InvariantCheckResult {
  const subjects = graph.nodes.filter((node) => node.kind === invariant.componentKind);
  if (subjects.length === 0) {
    return {
      invariant,
      status: 'NOT_APPLICABLE',
      evidence: [],
      reason: `no nodes of kind "${invariant.componentKind}" are present in the graph`,
    };
  }
  const interfaceNode = graph.nodes.find((node) => node.id === invariant.interfaceId);
  if (interfaceNode === undefined) {
    return {
      invariant,
      status: 'FAIL',
      evidence: sortedIds(subjects.map((node) => node.id)),
      reason: `interface node "${invariant.interfaceId}" is not present in the graph, so no "${invariant.componentKind}" can expose it`,
    };
  }
  const violators = subjects.filter(
    (node) =>
      !graph.edges.some(
        (edge) =>
          edge.kind === EXPOSURE_EDGE_KIND && edge.source === node.id && edge.target === invariant.interfaceId,
      ),
  );
  if (violators.length > 0) {
    return {
      invariant,
      status: 'FAIL',
      evidence: sortedIds(violators.map((node) => node.id)),
      reason: `component(s) of kind "${invariant.componentKind}" do not expose interface "${invariant.interfaceId}" via a ${EXPOSURE_EDGE_KIND} edge`,
    };
  }
  return {
    invariant,
    status: 'PASS',
    evidence: sortedIds(subjects.map((node) => node.id)),
    reason: `every component of kind "${invariant.componentKind}" exposes interface "${invariant.interfaceId}" via a ${EXPOSURE_EDGE_KIND} edge`,
  };
}

function checkForbiddenDependency(
  invariant: ForbiddenDependencyInvariant,
  graph: GraphShape,
): InvariantCheckResult {
  const edgeKind = invariant.edgeKind ?? DEPENDENCY_EDGE_KIND;
  const fromNodes = graph.nodes.filter((node) => node.kind === invariant.fromKind);
  const toNodes = graph.nodes.filter((node) => node.kind === invariant.toKind);
  if (fromNodes.length === 0 || toNodes.length === 0) {
    return {
      invariant,
      status: 'NOT_APPLICABLE',
      evidence: [],
      reason: `no nodes of kind "${invariant.fromKind}" or of kind "${invariant.toKind}" are present in the graph`,
    };
  }
  const fromIds = new Set(fromNodes.map((node) => node.id));
  const toIds = new Set(toNodes.map((node) => node.id));
  const violations = graph.edges
    .filter((edge) => edge.kind === edgeKind && fromIds.has(edge.source) && toIds.has(edge.target))
    .map((edge) => `${edge.source}->${edge.target}`);
  if (violations.length > 0) {
    return {
      invariant,
      status: 'FAIL',
      evidence: sortedIds(violations),
      reason: `forbidden ${edgeKind} edge(s) from "${invariant.fromKind}" nodes to "${invariant.toKind}" nodes`,
    };
  }
  return {
    invariant,
    status: 'PASS',
    evidence: [],
    reason: `no ${edgeKind} edge from a "${invariant.fromKind}" node to a "${invariant.toKind}" node exists`,
  };
}

function checkLayering(invariant: LayeringInvariant, graph: GraphShape): InvariantCheckResult {
  const layerOf = new Map<string, number>();
  invariant.layers.forEach((kind, index) => layerOf.set(kind, index));
  const layeredNodeCount = graph.nodes.filter((node) => layerOf.has(node.kind)).length;
  if (layeredNodeCount === 0) {
    return {
      invariant,
      status: 'NOT_APPLICABLE',
      evidence: [],
      reason: `no nodes belong to any declared layer (layer order bottom -> top: ${invariant.layers.join(', ')})`,
    };
  }
  const nodeKindById = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  const violations: string[] = [];
  for (const edge of graph.edges) {
    if (edge.kind !== DEPENDENCY_EDGE_KIND) continue;
    const sourceLayer = layerOf.get(nodeKindById.get(edge.source) ?? '');
    const targetLayer = layerOf.get(nodeKindById.get(edge.target) ?? '');
    if (sourceLayer === undefined || targetLayer === undefined) continue;
    if (targetLayer > sourceLayer) {
      violations.push(`${edge.source}->${edge.target}`);
    }
  }
  if (violations.length > 0) {
    return {
      invariant,
      status: 'FAIL',
      evidence: sortedIds(violations),
      reason: `upward ${DEPENDENCY_EDGE_KIND} edge(s) point to a higher layer (layer order bottom -> top: ${invariant.layers.join(', ')})`,
    };
  }
  return {
    invariant,
    status: 'PASS',
    evidence: [],
    reason: `no upward ${DEPENDENCY_EDGE_KIND} edge exists (layer order bottom -> top: ${invariant.layers.join(', ')})`,
  };
}

function checkDataOwnership(invariant: DataOwnershipInvariant, graph: GraphShape): InvariantCheckResult {
  const stores = graph.nodes.filter((node) => node.kind === DATA_STORE_NODE_KIND);
  if (stores.length === 0) {
    return {
      invariant,
      status: 'NOT_APPLICABLE',
      evidence: [],
      reason: `no nodes of kind "${DATA_STORE_NODE_KIND}" are present in the graph`,
    };
  }
  const violations: string[] = [];
  const details: string[] = [];
  for (const store of stores) {
    const owners = graph.edges
      .filter((edge) => edge.kind === OWNERSHIP_EDGE_KIND && edge.target === store.id)
      .map((edge) => edge.source);
    if (owners.length !== 1) {
      violations.push(store.id);
      details.push(`"${store.id}" has ${owners.length} owning component(s) [${sortedIds(owners).join(', ')}]`);
    }
  }
  if (violations.length > 0) {
    return {
      invariant,
      status: 'FAIL',
      evidence: sortedIds(violations),
      reason: `data store ownership violations (exactly one ${OWNERSHIP_EDGE_KIND} edge per ${DATA_STORE_NODE_KIND} required): ${details.join('; ')}`,
    };
  }
  return {
    invariant,
    status: 'PASS',
    evidence: sortedIds(stores.map((node) => node.id)),
    reason: `every ${DATA_STORE_NODE_KIND} node is owned by exactly one component via a ${OWNERSHIP_EDGE_KIND} edge`,
  };
}

/**
 * Machine-check a single invariant against a graph shape.
 * Total and deterministic on valid inputs; the graph is structurally
 * validated first (throws InvariantError/GraphError on malformed graphs).
 */
export function checkInvariant(invariant: Invariant, graph: GraphShape): InvariantCheckResult {
  assertValidInvariant(invariant);
  assertValidGraphShape(graph);
  switch (invariant.kind) {
    case 'REQUIRED_INTERFACE':
      return checkRequiredInterface(invariant, graph);
    case 'FORBIDDEN_DEPENDENCY':
      return checkForbiddenDependency(invariant, graph);
    case 'LAYERING':
      return checkLayering(invariant, graph);
    case 'DATA_OWNERSHIP':
      return checkDataOwnership(invariant, graph);
  }
}

/** Machine-check a list of invariants (results in input order). */
export function checkInvariants(invariants: readonly Invariant[], graph: GraphShape): InvariantCheckResult[] {
  return invariants.map((invariant) => checkInvariant(invariant, graph));
}

/** Guard for consumers that want to check result arrays. */
export function isInvariantCheckResult(value: unknown): value is InvariantCheckResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    validateInvariant(record.invariant) &&
    (record.status === 'PASS' || record.status === 'FAIL' || record.status === 'NOT_APPLICABLE') &&
    Array.isArray(record.evidence) &&
    record.evidence.every((entry) => isNonEmptyString(entry)) &&
    isNonEmptyString(record.reason)
  );
}
