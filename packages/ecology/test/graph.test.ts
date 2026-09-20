/**
 * Unit tests: the compatibility/conflict graph (Work Order W13).
 */

import { describe, expect, it } from 'vitest';
import { isArtifactId } from '@sos-2/semantic-spine';
import { edgeAssertionId } from '../src/index.js';
import type { EdgeAssertionInput } from '../src/index.js';
import { EcologyGraph } from '../src/index.js';
import { evidenceRefId, packageId } from './helpers.js';

const A = packageId('graph-a');
const B = packageId('graph-b');
const C = packageId('graph-c');
const EV1 = evidenceRefId('graph-ev-1');
const EV2 = evidenceRefId('graph-ev-2');

function compatibleInput(overrides: Partial<EdgeAssertionInput> = {}): EdgeAssertionInput {
  return {
    source: A,
    target: B,
    kind: 'COMPATIBLE_WITH',
    evidence_refs: [EV1],
    provenance: ['agent:architect'],
    note: 'co-deployed without interference in 3 evaluations',
    ...overrides,
  };
}

describe('EcologyGraph — evidence-backed edges', () => {
  it('adds an evidence-backed assertion and exposes it through queries', () => {
    const graph = new EcologyGraph();
    const assertion = graph.addAssertion(compatibleInput());
    expect(assertion.source).toBe(A);
    expect(assertion.target).toBe(B);
    expect(assertion.kind).toBe('COMPATIBLE_WITH');
    expect(assertion.evidence_refs).toEqual([EV1]);
    expect(graph.size).toBe(1);
    expect(graph.nodeCount).toBe(2);
    expect(graph.edgeCount).toBe(1);
    expect(graph.nodesList()).toEqual([A, B].sort());
    expect(graph.compatibleWith(A)).toEqual([B]);
    expect(graph.compatibleWith(B)).toEqual([A]); // symmetric
    expect(graph.conflictsOf(A)).toEqual([]);
    expect(graph.hasConflict(A, B)).toBe(false);
  });

  it('is idempotent for identical assertion content', () => {
    const graph = new EcologyGraph();
    const first = graph.addAssertion(compatibleInput());
    const second = graph.addAssertion(compatibleInput());
    expect(second).toEqual(first);
    expect(graph.size).toBe(1);
  });

  it('accumulates multiple assertions per relation into one aggregated edge', () => {
    const graph = new EcologyGraph();
    graph.addAssertion(compatibleInput());
    graph.addAssertion(compatibleInput({ evidence_refs: [EV2], provenance: ['agent:architect-2'] }));
    expect(graph.size).toBe(2);
    const edge = graph.edgeBetween(A, B, 'COMPATIBLE_WITH');
    expect(edge).not.toBeNull();
    expect(edge!.assertions).toHaveLength(2);
    expect(edge!.evidence_refs).toEqual([EV1, EV2].sort());
    // evidence refs are canonically sorted unique in the aggregate
    expect(edge!.evidence_refs).toEqual([...edge!.evidence_refs].sort());
  });

  it('treats the relation symmetrically regardless of assertion direction', () => {
    const graph = new EcologyGraph();
    graph.addAssertion(compatibleInput()); // A -> B
    graph.addAssertion(compatibleInput({ source: B, target: A, evidence_refs: [EV2] })); // B -> A
    const forward = graph.edgeBetween(A, B, 'COMPATIBLE_WITH');
    const backward = graph.edgeBetween(B, A, 'COMPATIBLE_WITH');
    expect(forward).toEqual(backward);
    expect(forward!.assertions).toHaveLength(2);
    expect(forward!.source).toBe([A, B].sort()[0]);
    expect(forward!.target).toBe([A, B].sort()[1]);
    expect(graph.edgeCount).toBe(1); // one aggregated relation
  });

  it('derives deterministic ids (content-addressed; citation order irrelevant)', () => {
    const one = edgeAssertionId(compatibleInput({ evidence_refs: [EV1, EV2] }));
    const two = edgeAssertionId(compatibleInput({ evidence_refs: [EV2, EV1] }));
    expect(one).toBe(two);
    expect(one).toMatch(/^[0-9a-f]{64}$/);
  });

  it('projects every assertion to a spine trace link with frozen type and provenance', () => {
    const graph = new EcologyGraph();
    graph.addAssertion(compatibleInput());
    graph.addAssertion(compatibleInput({ source: B, target: C, kind: 'CONFLICTS_WITH' }));
    const links = graph.toTraceLinks();
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(isArtifactId(link.source)).toBe(true);
      expect(isArtifactId(link.target)).toBe(true);
      expect(['COMPATIBLE_WITH', 'CONFLICTS_WITH']).toContain(link.type);
      expect(link.provenance).toEqual(['agent:architect']);
    }
    const conflictLink = links.find((link) => link.type === 'CONFLICTS_WITH');
    expect(conflictLink).toBeDefined();
    expect(conflictLink!.source).toBe(B);
    expect(conflictLink!.target).toBe(C);
  });

  it('answers coexistence over a member set with conflicting pairs and evidence', () => {
    const graph = new EcologyGraph();
    graph.addAssertion(compatibleInput({ source: A, target: B, kind: 'COMPATIBLE_WITH' }));
    graph.addAssertion(
      compatibleInput({ source: A, target: C, kind: 'CONFLICTS_WITH', evidence_refs: [EV2], provenance: ['agent:sre'] }),
    );
    const ok = graph.canCoexist([A, B]);
    expect(ok.compatible).toBe(true);
    expect(ok.conflicting_pairs).toEqual([]);
    const bad = graph.canCoexist([B, C, A]);
    expect(bad.compatible).toBe(false);
    expect(bad.members).toEqual([A, B, C].sort());
    expect(bad.conflicting_pairs).toEqual([{ a: [A, C].sort()[0], b: [A, C].sort()[1], evidence_refs: [EV2] }]);
    expect(graph.hasConflict(A, C)).toBe(true);
    expect(graph.hasConflict(C, A)).toBe(true); // symmetric
  });

  it('snapshots and restores canonically (round trip)', () => {
    const graph = new EcologyGraph();
    graph.addAssertion(compatibleInput());
    graph.addAssertion(compatibleInput({ source: B, target: C, kind: 'CONFLICTS_WITH' }));
    const snapshot = graph.snapshot();
    const restored = EcologyGraph.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.size).toBe(2);
    expect(restored.edges()).toEqual(graph.edges());
  });
});
