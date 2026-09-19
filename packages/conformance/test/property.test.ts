import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { checkInvariant, checkInvariants, reconcile } from '../src/index.js';
import type { Invariant } from '../src/index.js';
import { createArchitectureGraph } from '@sos-2/architecture';
import { CORE_EDGE_KINDS, CORE_NODE_KINDS } from '@sos-2/architecture';
import type { GraphEdge, GraphNode, GraphShape } from '@sos-2/architecture';
import type { ImplementationModel } from '@sos-2/semantic-spine';
import { CREATED_AT, PROVENANCE, PROJECTS } from './helpers.js';

/**
 * Property tests — deterministic: fast-check is seeded globally (424242) in
 * test/setup.ts, so repeated runs generate identical sequences and yield
 * identical results.
 */

function hex32(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

const nodeIdArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,9}$/);
const criticalityArb = fc.constantFrom('critical' as const, 'normal' as const);

interface GraphSeed {
  nodes: Array<{ id: string; kind: string; criticality: 'critical' | 'normal' }>;
  edgeSpecs: Array<{ s: number; t: number; kind: string; criticality: 'critical' | 'normal' }>;
}

const graphSeedArb: fc.Arbitrary<GraphSeed> = fc.record({
  nodes: fc.uniqueArray(
    fc.record({
      id: nodeIdArb,
      kind: fc.constantFrom(...CORE_NODE_KINDS),
      criticality: criticalityArb,
    }),
    { maxLength: 8, selector: (n) => n.id },
  ),
  edgeSpecs: fc.array(
    fc.record({
      s: fc.nat(20),
      t: fc.nat(20),
      kind: fc.constantFrom(...CORE_EDGE_KINDS),
      criticality: criticalityArb,
    }),
    { maxLength: 10 },
  ),
});

function buildGraph(seed: GraphSeed): GraphShape {
  const nodes: GraphNode[] = seed.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    criticality: node.criticality,
    attributes: {},
  }));
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const spec of seed.edgeSpecs) {
    if (nodes.length === 0) break;
    const source = nodes[spec.s % nodes.length]!;
    const target = nodes[spec.t % nodes.length]!;
    const edge: GraphEdge = {
      source: source.id,
      target: target.id,
      kind: spec.kind,
      criticality: spec.criticality,
      attributes: {},
    };
    const key = `${edge.source}->${edge.target}->${edge.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(edge);
  }
  return { nodes, edges };
}

const graphArb = graphSeedArb.map(buildGraph);

const invariantArb: fc.Arbitrary<Invariant> = fc.oneof(
  fc.record({
    kind: fc.constant('REQUIRED_INTERFACE' as const),
    componentKind: fc.constantFrom(...CORE_NODE_KINDS),
    interfaceId: nodeIdArb,
  }),
  fc.record({
    kind: fc.constant('FORBIDDEN_DEPENDENCY' as const),
    fromKind: fc.constantFrom(...CORE_NODE_KINDS),
    toKind: fc.constantFrom(...CORE_NODE_KINDS),
  }),
  fc
    .record({
      kind: fc.constant('LAYERING' as const),
      layers: fc.uniqueArray(fc.constantFrom(...CORE_NODE_KINDS), { minLength: 2, maxLength: 4 }),
    })
    .filter((inv) => inv.layers.length >= 2),
  fc.record({
    kind: fc.constant('DATA_OWNERSHIP' as const),
  }),
);

describe('property: invariant evaluation determinism', () => {
  it('checkInvariant is deterministic on randomized graphs (identical results on re-run)', () => {
    fc.assert(
      fc.property(invariantArb, graphArb, (invariant, graph) => {
        const first = checkInvariant(invariant, graph);
        const second = checkInvariant(invariant, JSON.parse(JSON.stringify(graph)) as GraphShape);
        return JSON.stringify(first) === JSON.stringify(second);
      }),
      { numRuns: 300 },
    );
  });

  it('results are well-formed: status vocabulary, sorted unique evidence, non-empty reason', () => {
    fc.assert(
      fc.property(invariantArb, graphArb, (invariant, graph) => {
        const result = checkInvariant(invariant, graph);
        if (!['PASS', 'FAIL', 'NOT_APPLICABLE'].includes(result.status)) return false;
        if (result.reason.length === 0) return false;
        if (new Set(result.evidence).size !== result.evidence.length) return false;
        const sorted = [...result.evidence].sort();
        return result.evidence.every((entry, i) => entry === sorted[i]);
      }),
      { numRuns: 300 },
    );
  });

  it('checkInvariants preserves input order and is deterministic', () => {
    fc.assert(
      fc.property(fc.array(invariantArb, { maxLength: 5 }), graphArb, (invariants, graph) => {
        const first = checkInvariants(invariants, graph);
        const second = checkInvariants(invariants, graph);
        if (JSON.stringify(first) !== JSON.stringify(second)) return false;
        return first.every((result, i) => result.invariant === invariants[i]);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Reconciliation properties
// ---------------------------------------------------------------------------

const implComponentKindArb = fc.constantFrom('service', 'library', 'datastore', 'adapter');

interface ReconcileSeed {
  graph: GraphSeed;
  observedIds: string[];
  observedKinds: string[];
  depSpecs: Array<{ s: number; t: number; kind: string }>;
  revision: string;
}

const reconcileSeedArb: fc.Arbitrary<ReconcileSeed> = fc.record({
  graph: graphSeedArb,
  observedIds: fc.uniqueArray(nodeIdArb, { maxLength: 6 }),
  observedKinds: fc.array(implComponentKindArb, { minLength: 1, maxLength: 4 }),
  depSpecs: fc.array(
    fc.record({
      s: fc.nat(20),
      t: fc.nat(20),
      kind: fc.constantFrom('uses', 'imports', 'owns'),
    }),
    { maxLength: 6 },
  ),
  revision: fc.hexaString({ minLength: 40, maxLength: 40 }).noShrink(),
});

interface ReconcileCase {
  model: ImplementationModel;
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
}

function buildReconcileCase(seed: ReconcileSeed): ReconcileCase {
  const graph = buildGraph(seed.graph);
  const componentPool = [
    ...graph.nodes.map((node) => node.id),
    ...seed.observedIds,
  ];
  const components = (seed.observedIds.length > 0 ? seed.observedIds : ['fallback-component']).map((id, i) => ({
    id,
    kind: seed.observedKinds[i % seed.observedKinds.length] ?? 'service',
    realized_by: [],
    realizes: [],
  }));
  const dependencies: Array<{ source: string; target: string; kind: string }> = [];
  const seen = new Set<string>();
  for (const spec of seed.depSpecs) {
    if (componentPool.length === 0) break;
    const source = componentPool[spec.s % componentPool.length]!;
    const target = componentPool[spec.t % componentPool.length]!;
    const key = `${source}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dependencies.push({ source, target, kind: spec.kind });
  }
  const model: ImplementationModel = {
    id: `sos://ImplementationModel/${hex32(`model-${seed.revision}`)}`,
    revision: seed.revision,
    components,
    source_artifacts: [],
    interfaces: [],
    dependencies,
    tests: [],
    builds: [],
    deployments: [],
    runtime_mappings: [],
  };
  return { model, graphNodes: graph.nodes, graphEdges: graph.edges };
}

const reconcileCaseArb = reconcileSeedArb.map(buildReconcileCase);

describe('property: reconciliation determinism', () => {
  it('reconcile is deterministic: identical inputs produce identical results', () => {
    fc.assert(
      fc.property(reconcileCaseArb, ({ model, graphNodes, graphEdges }) => {
        const artifact = createArchitectureGraph({
          projects_system_state: PROJECTS,
          nodes: graphNodes.map((node) => ({ ...node })),
          edges: graphEdges.map((edge) => ({ ...edge })),
          provenance: PROVENANCE,
          created_at: CREATED_AT,
          status: 'ACTIVE',
        });
        const first = reconcile(model, artifact);
        const second = reconcile(JSON.parse(JSON.stringify(model)) as ImplementationModel, artifact);
        return JSON.stringify(first) === JSON.stringify(second);
      }),
      { numRuns: 150 },
    );
  });

  it('drift records only ever cover DRIFT and CONTRADICTION subjects, with stable ids', () => {
    fc.assert(
      fc.property(reconcileCaseArb, ({ model, graphNodes, graphEdges }) => {
        const artifact = createArchitectureGraph({
          projects_system_state: PROJECTS,
          nodes: graphNodes.map((node) => ({ ...node })),
          edges: graphEdges.map((edge) => ({ ...edge })),
          provenance: PROVENANCE,
          created_at: CREATED_AT,
          status: 'ACTIVE',
        });
        const result = reconcile(model, artifact);
        if (result.drift.length !== new Set(result.drift.map((r) => r.id)).size) return false;
        return result.drift.every((record) => {
          const match = result.records.find((r) => r.subject === record.subject);
          return (
            match !== undefined &&
            (match.classification === 'DRIFT' || match.classification === 'CONTRADICTION') &&
            record.id.startsWith('sos://Evidence/') &&
            record.source_revision === model.revision
          );
        });
      }),
      { numRuns: 150 },
    );
  });

  it('every record links the two compared semantic ids with a frozen trace-link type', () => {
    fc.assert(
      fc.property(reconcileCaseArb, ({ model, graphNodes, graphEdges }) => {
        const artifact = createArchitectureGraph({
          projects_system_state: PROJECTS,
          nodes: graphNodes.map((node) => ({ ...node })),
          edges: graphEdges.map((edge) => ({ ...edge })),
          provenance: PROVENANCE,
          created_at: CREATED_AT,
          status: 'ACTIVE',
        });
        const result = reconcile(model, artifact);
        const frozen = new Set([
          'SATISFIES', 'REALIZES', 'REFINES', 'CONSTRAINS', 'IMPLEMENTS', 'VERIFIES', 'OBSERVES',
          'SUPPORTS', 'CONTRADICTS', 'CAUSED_BY', 'CAUSED', 'DERIVED_FROM', 'COMPATIBLE_WITH',
          'CONFLICTS_WITH', 'COMPOSES', 'SPECIALIZES', 'GENERALIZES',
        ]);
        return result.records.every((record) => {
          if (record.link.source !== model.id) return false;
          if (record.link.target !== artifact.envelope.id) return false;
          if (!frozen.has(record.link.type)) return false;
          return (record.link.provenance?.length ?? 0) > 0;
        });
      }),
      { numRuns: 150 },
    );
  });
});
