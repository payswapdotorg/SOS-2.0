import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  applyGraphDiff,
  canonicalGraphDiffText,
  canonicalSerialize,
  diffGraphs,
  edgeKeyString,
  graphDiffsEqual,
  buildGraphContent,
} from '../src/index.js';
import type { GraphEdge, GraphNode, GraphShape } from '../src/index.js';
import { CORE_EDGE_KINDS, CORE_NODE_KINDS } from '../src/index.js';
import { PROJECTS } from './helpers.js';

/**
 * Property tests — deterministic: fast-check is seeded globally (424242) in
 * test/setup.ts, so repeated runs generate identical sequences and yield
 * identical results.
 */

const nodeIdArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,9}$/);
const criticalityArb = fc.constantFrom('critical' as const, 'normal' as const);
const attributesArb = fc.dictionary(fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/), fc.jsonValue());

const nodeArb = fc.record({
  id: nodeIdArb,
  kind: fc.constantFrom(...CORE_NODE_KINDS),
  criticality: criticalityArb,
  attributes: attributesArb,
});

interface GraphSeed {
  nodes: Array<{ id: string; kind: string; criticality: 'critical' | 'normal'; attributes: Record<string, unknown> }>;
  edgeSpecs: Array<{ s: number; t: number; kind: string; criticality: 'critical' | 'normal'; attributes: Record<string, unknown> }>;
}

const graphSeedArb: fc.Arbitrary<GraphSeed> = fc.record({
  nodes: fc.uniqueArray(nodeArb, { maxLength: 8, selector: (n) => n.id }),
  edgeSpecs: fc.array(
    fc.record({
      s: fc.nat(20),
      t: fc.nat(20),
      kind: fc.constantFrom(...CORE_EDGE_KINDS),
      criticality: criticalityArb,
      attributes: attributesArb,
    }),
    { maxLength: 10 },
  ),
});

function buildGraph(seed: GraphSeed): GraphShape {
  const nodes: GraphNode[] = seed.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    criticality: node.criticality,
    attributes: node.attributes as GraphNode['attributes'],
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
      attributes: spec.attributes as GraphEdge['attributes'],
    };
    const key = `${edge.source}->${edge.target}->${edge.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(edge);
  }
  return { nodes, edges };
}

const graphArb = graphSeedArb.map(buildGraph);

/** Canonical (sorted) form — graphs are SETS of nodes/edges; array order is not semantic. */
function canon(shape: GraphShape): GraphShape {
  return {
    nodes: [...shape.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    edges: [...shape.edges].sort((a, b) =>
      edgeKeyString(a) < edgeKeyString(b) ? -1 : edgeKeyString(a) > edgeKeyString(b) ? 1 : 0,
    ),
  };
}

describe('property: graph diff determinism', () => {
  it('diff(a, b) is byte-identical on re-run and under key reordering', () => {
    fc.assert(
      fc.property(graphArb, graphArb, (a, b) => {
        const first = canonicalGraphDiffText(diffGraphs(a, b));
        const second = canonicalGraphDiffText(diffGraphs(a, b));
        if (first !== second) return false;
        const reordered = canonicalGraphDiffText(
          diffGraphs(reverseKeys(JSON.parse(JSON.stringify(a))) as GraphShape, b),
        );
        return reordered === first;
      }),
      { numRuns: 200 },
    );
  });

  it('diff(a, a) is always empty', () => {
    fc.assert(
      fc.property(graphArb, (a) => {
        const diff = diffGraphs(a, JSON.parse(JSON.stringify(a)) as GraphShape);
        return (
          diff.added_nodes.length === 0 &&
          diff.removed_nodes.length === 0 &&
          diff.modified_nodes.length === 0 &&
          diff.added_edges.length === 0 &&
          diff.removed_edges.length === 0 &&
          diff.modified_edges.length === 0
        );
      }),
      { numRuns: 200 },
    );
  });
});

describe('property: graph diff round trip', () => {
  it('apply(a, diff(a, b)) reconstructs b exactly', () => {
    fc.assert(
      fc.property(graphArb, graphArb, (a, b) => {
        const diff = diffGraphs(a, b);
        const reconstructed = applyGraphDiff(a, diff);
        return canonicalSerialize(canon(reconstructed)) === canonicalSerialize(canon(b));
      }),
      { numRuns: 300 },
    );
  });

  it('diff(a, apply(a, diff(a, b))) is the same diff again (fixed point)', () => {
    fc.assert(
      fc.property(graphArb, graphArb, (a, b) => {
        const diff = diffGraphs(a, b);
        const reconstructed = applyGraphDiff(a, diff);
        return graphDiffsEqual(diffGraphs(a, reconstructed), diff);
      }),
      { numRuns: 300 },
    );
  });

  it('diff(a, b) differs structurally from diff(b, a) whenever the graphs differ', () => {
    fc.assert(
      fc.property(graphArb, graphArb, (a, b) => {
        if (canonicalSerialize(canon(a)) === canonicalSerialize(canon(b))) return true; // equal graphs -> symmetric empty diffs
        const forward = canonicalGraphDiffText(diffGraphs(a, b));
        const backward = canonicalGraphDiffText(diffGraphs(b, a));
        return forward !== backward;
      }),
      { numRuns: 200 },
    );
  });

  it('round trips compose: apply(b, diff(b, a)) then diff back equals the reverse diff', () => {
    fc.assert(
      fc.property(graphArb, graphArb, (a, b) => {
        const backward = diffGraphs(b, a);
        const reconstructed = applyGraphDiff(b, backward);
        return graphDiffsEqual(diffGraphs(b, reconstructed), backward);
      }),
      { numRuns: 200 },
    );
  });
});

describe('property: canonical graph contents', () => {
  it('built contents are deterministically sorted regardless of input order', () => {
    fc.assert(
      fc.property(graphSeedArb, (seed) => {
        const content = buildGraphContent({
          projects_system_state: PROJECTS,
          nodes: [...seed.nodes].reverse(),
          edges: [],
        });
        const ids = content.nodes.map((node) => node.id);
        return ids.every((id, i) => i === 0 || ids[i - 1]! <= id);
      }),
      { numRuns: 150 },
    );
  });
});

/** Recursively reverse object key order (order-invariance probe). */
function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(reverseKeys) as unknown as T;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    const result: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      result[key] = reverseKeys(val);
    }
    return result as T;
  }
  return value;
}
