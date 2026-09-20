/**
 * The minimal causal graph (Work Order W5): factors plus TYPED edges.
 *
 * Scope discipline (explicit): this graph is the MINIMAL shape sufficient to
 * express causal hypotheses — which factors participate, which factors
 * CONTRIBUTE TO which effects, and which factors CONFOUND which
 * contribute-to relationships. Full causal inference (identification,
 * do-calculus, estimation) is OUT OF SCOPE for W5 and is NOT attempted here.
 *
 * Shapes:
 *
 *   CausalFactor          { id, description } — locally unique within a graph
 *   ContributesToEdge     cause -CONTRIBUTES_TO-> effect
 *   ConfoundsRelation     confounder CONFOUNDS the (cause -> effect) relation
 *
 * A confounder is a common cause of both sides of a confounded relation; a
 * factor therefore cannot confound a relation it already participates in
 * (confounder must differ from both cause and effect).
 *
 * Validation (loud, CausalError): unique factor ids; edges reference known
 * factors; no self-edges; no duplicate edges (same endpoints and type);
 * confounder distinct from the relation it confounds. Cycles are PERMITTED
 * and documented: feedback loops are real phenomena, and adjudicating them
 * is causal inference, which is out of scope.
 */

import { CausalError } from './errors.js';

/** The typed edge vocabulary of the minimal causal graph (frozen for W5). */
export const CAUSAL_EDGE_TYPES = ['CONTRIBUTES_TO', 'CONFOUNDS'] as const;

export type CausalEdgeType = (typeof CAUSAL_EDGE_TYPES)[number];

/** A participating factor (a cause candidate, an effect, or a confounder). */
export interface CausalFactor {
  /** Non-empty identifier, unique within the graph. */
  id: string;
  /** Human-readable factor description (non-empty). */
  description: string;
}

/** A typed CONTRIBUTES_TO edge: `cause` contributes to `effect`. */
export interface ContributesToEdge {
  type: 'CONTRIBUTES_TO';
  /** Factor id of the contributing cause. */
  cause: string;
  /** Factor id of the affected outcome. */
  effect: string;
}

/** A typed CONFOUNDS relation: `confounder` confounds cause -> effect. */
export interface ConfoundsRelation {
  type: 'CONFOUNDS';
  /** Factor id of the confounding common cause. */
  confounder: string;
  /** Factor id of the confounded relation's cause side. */
  cause: string;
  /** Factor id of the confounded relation's effect side. */
  effect: string;
}

export type CausalEdge = ContributesToEdge | ConfoundsRelation;

/** The minimal causal graph: factors + typed edges. */
export interface CausalGraph {
  factors: CausalFactor[];
  edges: CausalEdge[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPlainJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCausalEdgeType(value: unknown): value is CausalEdgeType {
  return typeof value === 'string' && (CAUSAL_EDGE_TYPES as readonly string[]).includes(value);
}

/** Structural check: is this a well-formed causal factor? */
export function isCausalFactor(value: unknown): value is CausalFactor {
  if (!isPlainJsonRecord(value)) {
    return false;
  }
  return isNonEmptyString(value['id']) && isNonEmptyString(value['description']);
}

/** Structural check: is this a well-formed typed edge (either kind)? */
export function isCausalEdge(value: unknown): value is CausalEdge {
  if (!isPlainJsonRecord(value)) {
    return false;
  }
  if (value['type'] === 'CONTRIBUTES_TO') {
    return isNonEmptyString(value['cause']) && isNonEmptyString(value['effect']);
  }
  if (value['type'] === 'CONFOUNDS') {
    return (
      isNonEmptyString(value['confounder']) && isNonEmptyString(value['cause']) && isNonEmptyString(value['effect'])
    );
  }
  return false;
}

/** Structural check: is this a well-formed causal graph shape? */
export function isCausalGraph(value: unknown): value is CausalGraph {
  if (!isPlainJsonRecord(value)) {
    return false;
  }
  const factors = value['factors'];
  const edges = value['edges'];
  if (!Array.isArray(factors) || !Array.isArray(edges)) {
    return false;
  }
  return factors.every((factor) => isCausalFactor(factor)) && edges.every((edge) => isCausalEdge(edge));
}

function assertValidFactorIds(values: readonly unknown[], field: string): asserts values is string[] {
  if (!Array.isArray(values)) {
    throw new CausalError(`${field} must be an array of non-empty factor ids`);
  }
  for (const id of values) {
    if (!isNonEmptyString(id)) {
      throw new CausalError(`${field} entries must be non-empty strings, received: ${JSON.stringify(id)}`);
    }
  }
}

/**
 * Full semantic validation with a specific error message (throws CausalError):
 * unique factor ids, known endpoints, no self-edges, no duplicate edges,
 * confounder distinct from the confounded relation.
 */
export function assertValidCausalGraph(value: unknown): asserts value is CausalGraph {
  if (!isPlainJsonRecord(value)) {
    throw new CausalError('causal graph must be an object with exact fields { factors, edges }');
  }
  const factors = value['factors'];
  const edges = value['edges'];
  if (!Array.isArray(factors) || !Array.isArray(edges)) {
    throw new CausalError('causal graph must be an object with exact fields { factors, edges }');
  }
  const factorIds = new Set<string>();
  for (const factor of factors) {
    if (!isCausalFactor(factor)) {
      throw new CausalError(
        `causal graph factor must have exact fields { id, description } (both non-empty), received: ${JSON.stringify(factor)}`,
      );
    }
    if (factorIds.has(factor.id)) {
      throw new CausalError(`duplicate causal factor id rejected: ${JSON.stringify(factor.id)}`);
    }
    factorIds.add(factor.id);
  }
  const seenEdges = new Set<string>();
  for (const edge of edges) {
    if (!isCausalEdge(edge)) {
      throw new CausalError(
        `causal graph edge must be a typed { CONTRIBUTES_TO | CONFOUNDS } edge with non-empty factor-id fields, received: ${JSON.stringify(edge)}`,
      );
    }
    if (edge.type === 'CONTRIBUTES_TO') {
      assertValidFactorIds([edge.cause, edge.effect], 'CONTRIBUTES_TO edge');
      if (!factorIds.has(edge.cause)) {
        throw new CausalError(
          `CONTRIBUTES_TO edge references unknown factor: ${JSON.stringify(edge.cause)} (edges may only reference declared factors)`,
        );
      }
      if (!factorIds.has(edge.effect)) {
        throw new CausalError(
          `CONTRIBUTES_TO edge references unknown factor: ${JSON.stringify(edge.effect)} (edges may only reference declared factors)`,
        );
      }
      if (edge.cause === edge.effect) {
        throw new CausalError(`self-edge rejected: factor ${JSON.stringify(edge.cause)} cannot contribute to itself`);
      }
      const key = `CONTRIBUTES_TO\u0000${edge.cause}\u0000${edge.effect}`;
      if (seenEdges.has(key)) {
        throw new CausalError(
          `duplicate causal edge rejected: CONTRIBUTES_TO ${JSON.stringify(edge.cause)} -> ${JSON.stringify(edge.effect)}`,
        );
      }
      seenEdges.add(key);
      continue;
    }
    assertValidFactorIds([edge.confounder, edge.cause, edge.effect], 'CONFOUNDS relation');
    if (!factorIds.has(edge.confounder)) {
      throw new CausalError(
        `CONFOUNDS relation references unknown factor: ${JSON.stringify(edge.confounder)} (edges may only reference declared factors)`,
      );
    }
    if (!factorIds.has(edge.cause) || !factorIds.has(edge.effect)) {
      throw new CausalError(
        `CONFOUNDS relation references unknown factor(s): ${JSON.stringify(edge.cause)} -> ${JSON.stringify(edge.effect)}`,
      );
    }
    if (edge.cause === edge.effect) {
      throw new CausalError(
        `self-relation rejected: a factor cannot confound a relation with itself (${JSON.stringify(edge.cause)})`,
      );
    }
    if (edge.confounder === edge.cause || edge.confounder === edge.effect) {
      throw new CausalError(
        `confounder rejected: ${JSON.stringify(edge.confounder)} participates in the relation it supposedly confounds ` +
          '(a confounder must be distinct from both sides of the confounded relation)',
      );
    }
    const key = `CONFOUNDS\u0000${edge.confounder}\u0000${edge.cause}\u0000${edge.effect}`;
    if (seenEdges.has(key)) {
      throw new CausalError(
        `duplicate causal edge rejected: CONFOUNDS ${JSON.stringify(edge.confounder)} on ${JSON.stringify(edge.cause)} -> ${JSON.stringify(edge.effect)}`,
      );
    }
    seenEdges.add(key);
  }
}

/** Predicate form of assertValidCausalGraph. */
export function validateCausalGraph(value: unknown): value is CausalGraph {
  try {
    assertValidCausalGraph(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Factors that CONTRIBUTE TO the given effect factor (deterministic:
 * insertion order of the graph's edges).
 */
export function factorsContributingTo(graph: CausalGraph, effect: string): CausalFactor[] {
  assertValidCausalGraph(graph);
  if (!isNonEmptyString(effect)) {
    throw new CausalError(`effect factor id must be a non-empty string, received: ${JSON.stringify(effect)}`);
  }
  const contributing = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === 'CONTRIBUTES_TO' && edge.effect === effect) {
      contributing.add(edge.cause);
    }
  }
  return graph.factors.filter((factor) => contributing.has(factor.id));
}

/**
 * Factors identified as CONFOUNDERS of the relation cause -> effect
 * (deterministic: insertion order of the graph's edges).
 */
export function confoundersOf(graph: CausalGraph, cause: string, effect: string): CausalFactor[] {
  assertValidCausalGraph(graph);
  if (!isNonEmptyString(cause) || !isNonEmptyString(effect)) {
    throw new CausalError(
      `cause and effect factor ids must be non-empty strings, received: ${JSON.stringify(cause)}, ${JSON.stringify(effect)}`,
    );
  }
  const confounderIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === 'CONFOUNDS' && edge.cause === cause && edge.effect === effect) {
      confounderIds.add(edge.confounder);
    }
  }
  return graph.factors.filter((factor) => confounderIds.has(factor.id));
}

/** Defensive copy of a graph (deep for plain-JSON content). */
export function cloneCausalGraph(graph: CausalGraph): CausalGraph {
  assertValidCausalGraph(graph);
  return structuredClone(graph);
}
