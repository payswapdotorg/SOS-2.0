/**
 * Conformance classifier — deterministic, rule-based classification of
 * differences between an observed ImplementationModel and a declared
 * ArchitectureGraphRef (minimal typed node/edge subset; the full
 * ArchitectureGraph is W2's work — this input is deliberately narrow).
 *
 * RULE SET (deterministic; first matching rule wins per subject).
 *
 * Subjects are component ids (nodes) and edge keys "<source>-><target>".
 * Let D = declared nodes, O = observed components,
 *     R = declared ids listed in some observed component's `realizes`,
 *     E = config.expectedVariations, I = config.intentionalEvolutions.
 *
 * Node rules (for each id in sortedUnion(D, O)):
 *   N1  id in D and O, kinds differ:
 *         I contains id  -> INTENTIONAL_EVOLUTION (pre-authorized)
 *         otherwise      -> UNKNOWN (correspondence ambiguous)
 *   N2  id in D and O, kinds equal (or matched): match -> not reported.
 *   N3  id in D only (declared, missing from implementation):
 *         I contains id  -> INTENTIONAL_EVOLUTION (pre-authorized removal)
 *         R contains id  -> PRESERVING_REFINEMENT (realized by refinement
 *                           components listed in the reason)
 *         criticality=critical -> CONTRADICTION
 *         otherwise     -> DRIFT
 *   N4  id in O only (present but undeclared):
 *         E contains id  -> EXPECTED_VARIATION
 *         policy EXPECTED_VARIATION -> EXPECTED_VARIATION
 *         otherwise      -> IMPLEMENTATION_DETAIL
 *
 * Edge rules (for each key in sortedUnion(declared edges, observed deps)):
 *   X1  key in both, kinds differ: I -> INTENTIONAL_EVOLUTION, else UNKNOWN.
 *   X2  key in both, kinds equal: match -> not reported.
 *   X3  key declared only: I -> INTENTIONAL_EVOLUTION;
 *         criticality=critical -> CONTRADICTION; otherwise DRIFT.
 *   X4  key observed only: E -> EXPECTED_VARIATION;
 *         policy EXPECTED_VARIATION -> EXPECTED_VARIATION;
 *         otherwise IMPLEMENTATION_DETAIL.
 *
 * Scope: W0.5 classifies components and dependency edges. Interfaces, tests,
 * builds, deployments and runtime mappings are carried by the
 * ImplementationModel but are classified by W2/W4 extensions, not here.
 *
 * Output: node findings (subjects ascending), then edge findings (subjects
 * ascending). The function is total and deterministic: identical inputs and
 * config produce identical outputs.
 */

import { isConformanceClass, isImplementationModel } from '@sos-2/contracts';
import type { ConformanceClass, ImplementationModel } from '@sos-2/contracts';
import { ConformanceError } from './errors.js';

export type NodeCriticality = 'critical' | 'normal';

export interface ArchitectureGraphNode {
  id: string;
  kind: string;
  /** Defaults to 'normal'. */
  criticality?: NodeCriticality;
}

export interface ArchitectureGraphEdge {
  source: string;
  target: string;
  kind: string;
  /** Defaults to 'normal'. */
  criticality?: NodeCriticality;
}

/** Minimal typed node/edge subset sufficient for classification (W2 owns the full graph). */
export interface ArchitectureGraphRef {
  nodes: ArchitectureGraphNode[];
  edges: ArchitectureGraphEdge[];
}

export type UndeclaredPolicy = 'IMPLEMENTATION_DETAIL' | 'EXPECTED_VARIATION';

export interface ClassificationConfig {
  /** How present-but-undeclared subjects are classified. Default: IMPLEMENTATION_DETAIL. */
  undeclaredPolicy?: UndeclaredPolicy;
  /** Subjects pre-authorized as expected variations (classified EXPECTED_VARIATION). */
  expectedVariations?: string[];
  /** Subjects whose divergence is pre-authorized (classified INTENTIONAL_EVOLUTION). */
  intentionalEvolutions?: string[];
}

export interface ConformanceFinding {
  classification: ConformanceClass;
  subject: string;
  reason: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function requireNonEmptyStringArray(value: unknown, field: string): void {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    throw new ConformanceError(`${field} must be an array of non-empty strings`);
  }
}

function edgeKey(source: string, target: string): string {
  return `${source}->${target}`;
}

function sortedUnion(a: Iterable<string>, b: Iterable<string>): string[] {
  const set = new Set<string>([...a, ...b]);
  return [...set].sort();
}

function validateClassifierInputs(
  observed: ImplementationModel,
  declared: ArchitectureGraphRef,
  config: ClassificationConfig,
): void {
  if (!isImplementationModel(observed)) {
    throw new ConformanceError('observed value does not match the ImplementationModel contract');
  }
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    throw new ConformanceError('declared must be an ArchitectureGraphRef { nodes, edges }');
  }
  if (!Array.isArray(declared.nodes) || !Array.isArray(declared.edges)) {
    throw new ConformanceError('declared must be an ArchitectureGraphRef { nodes, edges }');
  }
  const nodeIds = new Set<string>();
  for (const node of declared.nodes) {
    if (!isNonEmptyString(node.id) || !isNonEmptyString(node.kind)) {
      throw new ConformanceError('declared nodes require non-empty id and kind');
    }
    if (node.criticality !== undefined && node.criticality !== 'critical' && node.criticality !== 'normal') {
      throw new ConformanceError(`declared node ${node.id} has invalid criticality: ${String(node.criticality)}`);
    }
    if (nodeIds.has(node.id)) {
      throw new ConformanceError(`duplicate declared node id: ${node.id}`);
    }
    nodeIds.add(node.id);
  }
  const edgeKeys = new Set<string>();
  for (const edge of declared.edges) {
    if (
      !isNonEmptyString(edge.source) ||
      !isNonEmptyString(edge.target) ||
      !isNonEmptyString(edge.kind)
    ) {
      throw new ConformanceError('declared edges require non-empty source, target and kind');
    }
    if (edge.criticality !== undefined && edge.criticality !== 'critical' && edge.criticality !== 'normal') {
      throw new ConformanceError(`declared edge ${edgeKey(edge.source, edge.target)} has invalid criticality`);
    }
    const key = edgeKey(edge.source, edge.target);
    if (edgeKeys.has(key)) {
      throw new ConformanceError(`duplicate declared edge: ${key}`);
    }
    edgeKeys.add(key);
  }
  const componentIds = new Set<string>();
  for (const component of observed.components) {
    if (componentIds.has(component.id)) {
      throw new ConformanceError(`duplicate observed component id: ${component.id}`);
    }
    componentIds.add(component.id);
  }
  const dependencyKeys = new Set<string>();
  for (const dependency of observed.dependencies) {
    const key = edgeKey(dependency.source, dependency.target);
    if (dependencyKeys.has(key)) {
      throw new ConformanceError(`duplicate observed dependency pair: ${key} (normalize the model first)`);
    }
    dependencyKeys.add(key);
  }
  if (
    config.undeclaredPolicy !== undefined &&
    config.undeclaredPolicy !== 'IMPLEMENTATION_DETAIL' &&
    config.undeclaredPolicy !== 'EXPECTED_VARIATION'
  ) {
    throw new ConformanceError(
      `invalid undeclaredPolicy: ${String(config.undeclaredPolicy)} (expected IMPLEMENTATION_DETAIL or EXPECTED_VARIATION)`,
    );
  }
  if (config.expectedVariations !== undefined) {
    requireNonEmptyStringArray(config.expectedVariations, 'config.expectedVariations');
  }
  if (config.intentionalEvolutions !== undefined) {
    requireNonEmptyStringArray(config.intentionalEvolutions, 'config.intentionalEvolutions');
  }
}

/**
 * Classify differences between the observed implementation and the declared
 * architecture. Deterministic and total on valid inputs.
 */
export function classifyDifferences(
  observed: ImplementationModel,
  declared: ArchitectureGraphRef,
  config: ClassificationConfig = {},
): ConformanceFinding[] {
  validateClassifierInputs(observed, declared, config);

  const policy: UndeclaredPolicy = config.undeclaredPolicy ?? 'IMPLEMENTATION_DETAIL';
  const expected = new Set(config.expectedVariations ?? []);
  const intentional = new Set(config.intentionalEvolutions ?? []);

  const declaredNodes = new Map(declared.nodes.map((node) => [node.id, node]));
  const observedComponents = new Map(observed.components.map((component) => [component.id, component]));

  // declared id -> observed component ids that (partially) realize it
  const refiners = new Map<string, string[]>();
  for (const component of observed.components) {
    for (const declaredId of component.realizes) {
      const list = refiners.get(declaredId) ?? [];
      list.push(component.id);
      refiners.set(declaredId, list);
    }
  }

  const findings: ConformanceFinding[] = [];

  for (const id of sortedUnion(declaredNodes.keys(), observedComponents.keys())) {
    const declaredNode = declaredNodes.get(id);
    const observedComponent = observedComponents.get(id);
    if (declaredNode !== undefined && observedComponent !== undefined) {
      if (declaredNode.kind !== observedComponent.kind) {
        findings.push(
          intentional.has(id)
            ? {
                classification: 'INTENTIONAL_EVOLUTION',
                subject: id,
                reason: `declared kind "${declaredNode.kind}" and observed kind "${observedComponent.kind}" differ; divergence pre-authorized by configuration`,
              }
            : {
                classification: 'UNKNOWN',
                subject: id,
                reason: `declared kind "${declaredNode.kind}" conflicts with observed kind "${observedComponent.kind}"; correspondence is ambiguous`,
              },
        );
      }
      // kinds match -> declared-and-present -> not reported
    } else if (declaredNode !== undefined) {
      const realizing = (refiners.get(id) ?? []).sort();
      if (intentional.has(id)) {
        findings.push({
          classification: 'INTENTIONAL_EVOLUTION',
          subject: id,
          reason: 'declared node absent from the implementation; divergence pre-authorized by configuration',
        });
      } else if (realizing.length > 0) {
        findings.push({
          classification: 'PRESERVING_REFINEMENT',
          subject: id,
          reason: `declared node realized by refinement component(s): ${realizing.join(', ')}`,
        });
      } else if ((declaredNode.criticality ?? 'normal') === 'critical') {
        findings.push({
          classification: 'CONTRADICTION',
          subject: id,
          reason: `declared critical node "${id}" is missing from the implementation`,
        });
      } else {
        findings.push({
          classification: 'DRIFT',
          subject: id,
          reason: `declared node "${id}" is missing from the implementation`,
        });
      }
    } else if (observedComponent !== undefined) {
      if (expected.has(id)) {
        findings.push({
          classification: 'EXPECTED_VARIATION',
          subject: id,
          reason: `observed component "${id}" is not declared; pre-authorized as expected variation`,
        });
      } else if (policy === 'EXPECTED_VARIATION') {
        findings.push({
          classification: 'EXPECTED_VARIATION',
          subject: id,
          reason: `observed component "${id}" is not declared; undeclared policy classifies it as expected variation`,
        });
      } else {
        findings.push({
          classification: 'IMPLEMENTATION_DETAIL',
          subject: id,
          reason: `observed component "${id}" is not declared; treated as implementation detail`,
        });
      }
    }
  }

  const declaredEdges = new Map(declared.edges.map((edge) => [edgeKey(edge.source, edge.target), edge]));
  const observedEdges = new Map(
    observed.dependencies.map((dependency) => [edgeKey(dependency.source, dependency.target), dependency]),
  );

  for (const key of sortedUnion(declaredEdges.keys(), observedEdges.keys())) {
    const declaredEdge = declaredEdges.get(key);
    const observedEdge = observedEdges.get(key);
    if (declaredEdge !== undefined && observedEdge !== undefined) {
      if (declaredEdge.kind !== observedEdge.kind) {
        findings.push(
          intentional.has(key)
            ? {
                classification: 'INTENTIONAL_EVOLUTION',
                subject: key,
                reason: `declared dependency kind "${declaredEdge.kind}" and observed kind "${observedEdge.kind}" differ on ${key}; divergence pre-authorized by configuration`,
              }
            : {
                classification: 'UNKNOWN',
                subject: key,
                reason: `declared dependency kind "${declaredEdge.kind}" conflicts with observed kind "${observedEdge.kind}" on ${key}; correspondence is ambiguous`,
              },
        );
      }
    } else if (declaredEdge !== undefined) {
      if (intentional.has(key)) {
        findings.push({
          classification: 'INTENTIONAL_EVOLUTION',
          subject: key,
          reason: `declared dependency ${key} absent from the implementation; divergence pre-authorized by configuration`,
        });
      } else if ((declaredEdge.criticality ?? 'normal') === 'critical') {
        findings.push({
          classification: 'CONTRADICTION',
          subject: key,
          reason: `declared critical dependency ${key} is missing from the implementation`,
        });
      } else {
        findings.push({
          classification: 'DRIFT',
          subject: key,
          reason: `declared dependency ${key} is missing from the implementation`,
        });
      }
    } else if (observedEdge !== undefined) {
      if (expected.has(key)) {
        findings.push({
          classification: 'EXPECTED_VARIATION',
          subject: key,
          reason: `observed dependency ${key} is not declared; pre-authorized as expected variation`,
        });
      } else if (policy === 'EXPECTED_VARIATION') {
        findings.push({
          classification: 'EXPECTED_VARIATION',
          subject: key,
          reason: `observed dependency ${key} is not declared; undeclared policy classifies it as expected variation`,
        });
      } else {
        findings.push({
          classification: 'IMPLEMENTATION_DETAIL',
          subject: key,
          reason: `observed dependency ${key} is not declared; treated as implementation detail`,
        });
      }
    }
  }

  return findings;
}

/** Guard for consumers that want to check finding arrays. */
export function isConformanceFinding(value: unknown): value is ConformanceFinding {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    isConformanceClass(record['classification']) &&
    isNonEmptyString(record['subject']) &&
    isNonEmptyString(record['reason'])
  );
}
