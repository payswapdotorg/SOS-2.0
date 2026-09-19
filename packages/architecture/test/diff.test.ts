import { describe, expect, it } from 'vitest';
import {
  applyGraphDiff,
  canonicalGraphDiffText,
  canonicalSerialize,
  diffGraphs,
  graphDiffSize,
  graphDiffsEqual,
  isGraphDiffEmpty,
  buildGraphContent,
} from '../src/index.js';
import type { GraphShape } from '../src/index.js';
import { edgeKeyString } from '../src/index.js';
import { PROJECTS, edgeOf, nodeOf } from './helpers.js';

/** Canonical (sorted) form of a graph — graphs are SETS of nodes/edges; array order is not semantic. */
function canon(shape: GraphShape): GraphShape {
  return {
    nodes: [...shape.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    edges: [...shape.edges].sort((a, b) => (edgeKeyString(a) < edgeKeyString(b) ? -1 : edgeKeyString(a) > edgeKeyString(b) ? 1 : 0)),
  };
}

function graphA(): GraphShape {
  return {
    nodes: [
      nodeOf('component:checkout', 'Component', { runtime: 'node' }),
      nodeOf('component:payment', 'Component', { runtime: 'jvm' }),
      nodeOf('iface:checkout-api', 'Interface'),
      nodeOf('store:orders', 'DataStore'),
    ],
    edges: [
      edgeOf('component:checkout', 'iface:checkout-api', 'Provides'),
      edgeOf('component:checkout', 'store:orders', 'Owns'),
      edgeOf('component:checkout', 'component:payment', 'Dependency'),
    ],
  };
}

function graphB(): GraphShape {
  return {
    nodes: [
      nodeOf('component:checkout', 'Component', { runtime: 'bun' }), // modified attributes
      nodeOf('component:payment', 'Component', { runtime: 'jvm' }),
      nodeOf('component:payment-v2', 'Component'), // added
      nodeOf('iface:checkout-api', 'Interface'),
      nodeOf('store:orders', 'DataStore'),
      nodeOf('policy:gdpr', 'Policy'), // added
    ],
    edges: [
      edgeOf('component:checkout', 'iface:checkout-api', 'Provides'),
      edgeOf('component:checkout', 'store:orders', 'Owns'),
      edgeOf('component:payment-v2', 'component:payment', 'Dependency'), // added
    ],
    // removed: component:checkout -> component:payment Dependency
  };
}

describe('graph diff determinism', () => {
  it('diff(A, B) run twice is byte-identical (canonical text)', () => {
    const first = diffGraphs(graphA(), graphB());
    const second = diffGraphs(graphA(), graphB());
    expect(canonicalGraphDiffText(first)).toBe(canonicalGraphDiffText(second));
    // also across fresh deep-cloned inputs (key order must not matter)
    const cloned = diffGraphs(
      JSON.parse(JSON.stringify(graphA())) as GraphShape,
      JSON.parse(JSON.stringify(reverseKeys(graphB()))) as GraphShape,
    );
    expect(canonicalGraphDiffText(cloned)).toBe(canonicalGraphDiffText(first));
  });

  it('diff(A, B) is structurally different from diff(B, A)', () => {
    const forward = diffGraphs(graphA(), graphB());
    const backward = diffGraphs(graphB(), graphA());
    expect(canonicalGraphDiffText(forward)).not.toBe(canonicalGraphDiffText(backward));
    // directional semantics: added in one direction are removed in the other
    expect(forward.added_nodes.map((n) => n.id)).toEqual(backward.removed_nodes.map((n) => n.id));
    expect(forward.removed_nodes.map((n) => n.id)).toEqual(backward.added_nodes.map((n) => n.id));
    expect(forward.added_edges.map((e) => `${e.source}->${e.target}`)).toEqual(
      backward.removed_edges.map((e) => `${e.source}->${e.target}`),
    );
    expect(forward.removed_edges.map((e) => `${e.source}->${e.target}`)).toEqual(
      backward.added_edges.map((e) => `${e.source}->${e.target}`),
    );
    // modified entries swap before/after
    expect(forward.modified_nodes).toHaveLength(1);
    expect(backward.modified_nodes).toHaveLength(1);
    expect(forward.modified_nodes[0]!.before).toEqual(backward.modified_nodes[0]!.after);
    expect(forward.modified_nodes[0]!.after).toEqual(backward.modified_nodes[0]!.before);
  });

  it('diff(A, A) is empty', () => {
    const diff = diffGraphs(graphA(), JSON.parse(JSON.stringify(graphA())) as GraphShape);
    expect(isGraphDiffEmpty(diff)).toBe(true);
    expect(graphDiffSize(diff)).toBe(0);
  });

  it('reports added/removed/modified nodes and edges with stable ordering', () => {
    const diff = diffGraphs(graphA(), graphB());
    expect(diff.added_nodes.map((n) => n.id)).toEqual(['component:payment-v2', 'policy:gdpr']);
    expect(diff.removed_nodes.map((n) => n.id)).toEqual([]);
    expect(diff.modified_nodes.map((m) => m.id)).toEqual(['component:checkout']);
    expect(diff.modified_nodes[0]!.before.attributes).toEqual({ runtime: 'node' });
    expect(diff.modified_nodes[0]!.after.attributes).toEqual({ runtime: 'bun' });
    expect(diff.added_edges).toHaveLength(1);
    expect(diff.removed_edges.map((e) => `${e.source}->${e.target}->${e.kind}`)).toEqual([
      'component:checkout->component:payment->Dependency',
    ]);
    expect(diff.modified_edges).toHaveLength(0);
    expect(graphDiffSize(diff)).toBe(5);
  });

  it('detects edge modifications (criticality/attributes) with the same key', () => {
    const a: GraphShape = { nodes: [nodeOf('component:x', 'Component')], edges: [] };
    const b: GraphShape = {
      nodes: [nodeOf('component:x', 'Component')],
      edges: [{ source: 'component:x', target: 'component:x', kind: 'Trusts', criticality: 'critical', attributes: { level: 'high' } }],
    };
    const diff = diffGraphs(a, b);
    expect(diff.added_edges).toHaveLength(1);
    const c: GraphShape = {
      nodes: [nodeOf('component:x', 'Component')],
      edges: [{ source: 'component:x', target: 'component:x', kind: 'Trusts', criticality: 'normal', attributes: {} }],
    };
    const modified = diffGraphs(b, c);
    expect(modified.modified_edges).toHaveLength(1);
    expect(modified.modified_edges[0]!.before.criticality).toBe('critical');
    expect(modified.modified_edges[0]!.after.criticality).toBe('normal');
  });
});

describe('graph diff application', () => {
  it('apply(A, diff(A, B)) reconstructs B exactly (round trip)', () => {
    const a = graphA();
    const b = graphB();
    const diff = diffGraphs(a, b);
    const reconstructed = applyGraphDiff(a, diff);
    expect(canonicalSerialize(canon(reconstructed))).toBe(canonicalSerialize(canon(b)));
    // and the diff of A -> reconstructed is the same diff again
    expect(graphDiffsEqual(diffGraphs(a, reconstructed), diff)).toBe(true);
  });

  it('apply round trips in the reverse direction too', () => {
    const a = graphA();
    const b = graphB();
    const backward = diffGraphs(b, a);
    const reconstructed = applyGraphDiff(b, backward);
    expect(canonicalSerialize(canon(reconstructed))).toBe(canonicalSerialize(canon(a)));
  });

  it('apply of an empty diff is the identity', () => {
    const a = graphA();
    const diff = diffGraphs(a, JSON.parse(JSON.stringify(a)) as GraphShape);
    const result = applyGraphDiff(a, diff);
    expect(canonicalSerialize(canon(result))).toBe(canonicalSerialize(canon(a)));
  });

  it('apply works on canonical graph contents (projects_system_state preserved by callers)', () => {
    const contentA = buildGraphContent({
      projects_system_state: PROJECTS,
      nodes: [
        { id: 'component:x', kind: 'Component' },
        { id: 'component:y', kind: 'Component' },
      ],
      edges: [{ source: 'component:x', target: 'component:y', kind: 'Dependency' }],
    });
    const contentB = buildGraphContent({
      projects_system_state: PROJECTS,
      nodes: [{ id: 'component:x', kind: 'Component' }],
      edges: [],
    });
    const diff = diffGraphs(contentA, contentB);
    const applied = applyGraphDiff(contentA, diff);
    expect(applied.nodes.map((n) => n.id)).toEqual(['component:x']);
    expect(applied.edges).toEqual([]);
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
