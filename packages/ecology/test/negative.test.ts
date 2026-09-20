/**
 * Negative tests: everything the ecology layer REJECTS loudly (Work Order
 * W13 acceptance: evidence-free compatibility edge REJECTED is pinned here).
 */

import { describe, expect, it } from 'vitest';
import { EcologyError } from '../src/index.js';
import { EcologyGraph, InteractionStore, MaturityReviewQueue } from '../src/index.js';
import type { DecaySignalInput, EdgeAssertionInput, RecordInteractionInput } from '../src/index.js';
import { compositionId, evidenceRefId, failureEvidence, makeEvidence, packageId } from './helpers.js';

const A = packageId('neg-a');
const B = packageId('neg-b');
const EV1 = evidenceRefId('neg-ev-1');

describe('ecology negative discipline', () => {
  it('REJECTS an evidence-free compatibility edge', () => {
    const graph = new EcologyGraph();
    const input: EdgeAssertionInput = {
      source: A,
      target: B,
      kind: 'COMPATIBLE_WITH',
      evidence_refs: [],
      provenance: ['agent:architect'],
    };
    expect(() => graph.addAssertion(input)).toThrow(EcologyError);
    expect(() => graph.addAssertion(input)).toThrow(/NON-EMPTY array/);
    expect(graph.size).toBe(0);
  });

  it('REJECTS an evidence-free conflict edge (both kinds are evidence-gated)', () => {
    const graph = new EcologyGraph();
    expect(() =>
      graph.addAssertion({
        source: A,
        target: B,
        kind: 'CONFLICTS_WITH',
        evidence_refs: [],
        provenance: ['agent:sre'],
      }),
    ).toThrow(EcologyError);
  });

  it('REJECTS edge assertions with non-Evidence refs', () => {
    const graph = new EcologyGraph();
    expect(() =>
      graph.addAssertion({
        source: A,
        target: B,
        kind: 'COMPATIBLE_WITH',
        evidence_refs: [A], // a Package id is not an Evidence id
        provenance: ['agent:architect'],
      }),
    ).toThrow(/Evidence ids/);
  });

  it('REJECTS non-Package graph nodes', () => {
    const graph = new EcologyGraph();
    const composition = compositionId('neg-comp');
    expect(() =>
      graph.addAssertion({
        source: composition,
        target: B,
        kind: 'COMPATIBLE_WITH',
        evidence_refs: [EV1],
        provenance: ['agent:architect'],
      }),
    ).toThrow(/Package id/);
  });

  it('REJECTS self-edges and malformed ids', () => {
    const graph = new EcologyGraph();
    expect(() =>
      graph.addAssertion({
        source: A,
        target: A,
        kind: 'COMPATIBLE_WITH',
        evidence_refs: [EV1],
        provenance: ['agent:architect'],
      }),
    ).toThrow(/must differ/);
    expect(() =>
      graph.addAssertion({
        source: 'not-an-id',
        target: B,
        kind: 'COMPATIBLE_WITH',
        evidence_refs: [EV1],
        provenance: ['agent:architect'],
      }),
    ).toThrow(/well-formed/);
  });

  it('REJECTS unknown edge kinds and provenance-less assertions', () => {
    const graph = new EcologyGraph();
    expect(() =>
      graph.addAssertion({
        source: A,
        target: B,
        kind: 'SUPERSEDES' as never,
        evidence_refs: [EV1],
        provenance: ['agent:architect'],
      }),
    ).toThrow(/frozen trace types/);
    expect(() =>
      graph.addAssertion({
        source: A,
        target: B,
        kind: 'COMPATIBLE_WITH',
        evidence_refs: [EV1],
        provenance: [],
      }),
    ).toThrow(/provenance/);
  });

  it('REJECTS canCoexist with fewer than 2 distinct members', () => {
    const graph = new EcologyGraph();
    expect(() => graph.canCoexist([A])).toThrow(/at least 2/);
    expect(() => graph.canCoexist([A, A])).toThrow(/DISTINCT/);
    expect(() => graph.canCoexist(['nope', B])).toThrow(/well-formed/);
  });

  it('REJECTS interaction evidence about a MEMBER (member success does not imply composition success)', () => {
    const store = new InteractionStore();
    const comp = compositionId('neg-comp');
    const memberEvidence = makeEvidence(packageId('neg-member'), 7);
    const input: RecordInteractionInput = {
      composition_id: comp,
      outcome: 'SYNERGY',
      evidence: [memberEvidence],
      provenance: ['agent:architect'],
      recorded_at: '2025-01-02T00:00:00.000Z',
    };
    expect(() => store.record(input)).toThrow(EcologyError);
    expect(() => store.record(input)).toThrow(/member evidence never substitutes/);
    expect(store.size).toBe(0);
  });

  it('REJECTS a synergy claim without a cited SUCCESS record', () => {
    const store = new InteractionStore();
    const comp = compositionId('neg-comp-2');
    expect(() =>
      store.record({
        composition_id: comp,
        outcome: 'SYNERGY',
        evidence: [failureEvidence(comp, 8)],
        provenance: ['agent:architect'],
        recorded_at: '2025-01-02T00:00:00.000Z',
      }),
    ).toThrow(/availability SUCCESS/);
  });

  it('REJECTS an interference claim without an observed failure', () => {
    const store = new InteractionStore();
    const comp = compositionId('neg-comp-3');
    expect(() =>
      store.record({
        composition_id: comp,
        outcome: 'INTERFERENCE',
        evidence: [makeEvidence(comp, 9)],
        provenance: ['agent:architect'],
        recorded_at: '2025-01-02T00:00:00.000Z',
      }),
    ).toThrow(/availability FAILURE/);
  });

  it('REJECTS evidence-free interaction records and missing provenance', () => {
    const store = new InteractionStore();
    const comp = compositionId('neg-comp-4');
    expect(() =>
      store.record({
        composition_id: comp,
        outcome: 'NEUTRAL',
        evidence: [],
        provenance: ['agent:architect'],
        recorded_at: '2025-01-02T00:00:00.000Z',
      }),
    ).toThrow(/NON-EMPTY/);
    expect(() =>
      store.record({
        composition_id: comp,
        outcome: 'NEUTRAL',
        evidence: [makeEvidence(comp, 10)],
        provenance: [],
        recorded_at: '2025-01-02T00:00:00.000Z',
      }),
    ).toThrow(/provenance/);
  });

  it('REJECTS interaction records about non-compositions', () => {
    const store = new InteractionStore();
    expect(() =>
      store.record({
        composition_id: packageId('neg-not-a-comp'),
        outcome: 'SYNERGY',
        evidence: [makeEvidence(packageId('neg-not-a-comp'), 11)],
        provenance: ['agent:architect'],
        recorded_at: '2025-01-02T00:00:00.000Z',
      }),
    ).toThrow(/PackageComposition id/);
  });

  it('REJECTS evidence-free decay signals (signals are Evidence-shaped input only)', () => {
    const queue = new MaturityReviewQueue();
    const input: DecaySignalInput = {
      package_id: A,
      kind: 'USAGE_DECAY',
      observed_at: '2025-01-02T00:00:00.000Z',
      evidence_refs: [],
      provenance: ['agent:sre'],
    };
    expect(() => queue.recordSignal(input)).toThrow(EcologyError);
    expect(() => queue.recordSignal(input)).toThrow(/NON-EMPTY array/);
    expect(queue.size).toBe(0);
  });

  it('REJECTS invented signal kinds — there is no signal that demotes', () => {
    const queue = new MaturityReviewQueue();
    expect(() =>
      queue.recordSignal({
        package_id: A,
        kind: 'DEMOTE' as never,
        observed_at: '2025-01-02T00:00:00.000Z',
        evidence_refs: [EV1],
        provenance: ['agent:sre'],
      }),
    ).toThrow(/frozen vocabulary/);
    expect(() =>
      queue.recordSignal({
        package_id: A,
        kind: 'RETIRED' as never,
        observed_at: '2025-01-02T00:00:00.000Z',
        evidence_refs: [EV1],
        provenance: ['agent:sre'],
      }),
    ).toThrow(/frozen vocabulary/);
  });

  it('REJECTS signals about non-packages, bad timestamps and missing provenance', () => {
    const queue = new MaturityReviewQueue();
    expect(() =>
      queue.recordSignal({
        package_id: compositionId('neg-comp-5'),
        kind: 'USAGE_DECAY',
        observed_at: '2025-01-02T00:00:00.000Z',
        evidence_refs: [EV1],
        provenance: ['agent:sre'],
      }),
    ).toThrow(/Package id/);
    expect(() =>
      queue.recordSignal({
        package_id: A,
        kind: 'USAGE_DECAY',
        observed_at: 'yesterday',
        evidence_refs: [EV1],
        provenance: ['agent:sre'],
      }),
    ).toThrow(/RFC3339/);
    expect(() =>
      queue.recordSignal({
        package_id: A,
        kind: 'USAGE_DECAY',
        observed_at: '2025-01-02T00:00:00.000Z',
        evidence_refs: [EV1],
        provenance: [],
      }),
    ).toThrow(/provenance/);
  });

  it('REJECTS snapshots with tampered content (content-address discipline)', () => {
    const graph = new EcologyGraph();
    graph.addAssertion({
      source: A,
      target: B,
      kind: 'COMPATIBLE_WITH',
      evidence_refs: [EV1],
      provenance: ['agent:architect'],
    });
    const snapshot = graph.snapshot();
    const tampered = structuredClone(snapshot);
    tampered.assertions[0]!.evidence_refs = [evidenceRefId('neg-tampered')];
    expect(() => EcologyGraph.restore(tampered)).toThrow(/does not match its content/);
  });
});
