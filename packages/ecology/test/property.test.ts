/**
 * Property tests: randomized populations — graph/query determinism, canonical
 * round trips, archive-style determinism for the ecology stores
 * (Work Order W13 verification: "randomized populations — graph/query
 * determinism, canonical round trips").
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { EcologyGraph, InteractionStore, MaturityReviewQueue } from '../src/index.js';
import type { DecaySignalInput, EdgeAssertionInput, RecordInteractionInput } from '../src/index.js';
import { compositionId, evidenceRefId, failureEvidence, makeEvidence, packageId } from './helpers.js';

/** A small deterministic universe of package ids / evidence refs / compositions. */
const PACKAGES = [0, 1, 2, 3, 4, 5].map((i) => packageId(`prop-pkg-${i}`));
const EVIDENCE = [0, 1, 2, 3].map((i) => evidenceRefId(`prop-ev-${i}`));
const COMPOSITIONS = [0, 1, 2].map((i) => compositionId(`prop-comp-${i}`));
const TIMESTAMPS = [
  '2025-01-01T00:00:00.000Z',
  '2025-01-02T00:00:00.000Z',
  '2025-01-03T00:00:00.000Z',
  '2025-01-04T00:00:00.000Z',
];

const packageArb = fc.constantFrom(...PACKAGES);
const evidenceArb = fc.constantFrom(...EVIDENCE);
const compositionArb = fc.constantFrom(...COMPOSITIONS);
const timestampArb = fc.constantFrom(...TIMESTAMPS);

/** Distinct package pairs only (self-edges are invalid). */
const pairArb = packageArb.chain((a) =>
  fc.constantFrom(...PACKAGES.filter((p) => p !== a)).map((b) => [a, b] as const),
);

const edgeAssertionArb: fc.Arbitrary<EdgeAssertionInput> = fc
  .record({
    pair: pairArb,
    kind: fc.constantFrom<'COMPATIBLE_WITH' | 'CONFLICTS_WITH'>('COMPATIBLE_WITH', 'CONFLICTS_WITH'),
    evidence: fc.uniqueArray(evidenceArb, { minLength: 1, maxLength: 3 }),
    note: fc.option(fc.string({ minLength: 1, maxLength: 24 }), { nil: undefined }),
  })
  .map((value) => ({
    source: value.pair[0],
    target: value.pair[1],
    kind: value.kind,
    evidence_refs: value.evidence,
    provenance: ['agent:property-test'],
    note: value.note ?? null,
  }));

const interactionArb: fc.Arbitrary<RecordInteractionInput> = fc
  .record({
    composition: compositionArb,
    outcome: fc.constantFrom<'SYNERGY' | 'INTERFERENCE' | 'NEUTRAL'>('SYNERGY', 'INTERFERENCE', 'NEUTRAL'),
    successIndex: fc.integer({ min: 0, max: 98 }),
    failureIndex: fc.integer({ min: 99, max: 198 }),
    timestamp: timestampArb,
  })
  .map((value) => {
    // Build an evidence set satisfying the truth-state consistency rule.
    const success = makeEvidence(value.composition, value.successIndex);
    const failure = failureEvidence(value.composition, value.failureIndex);
    const evidence =
      value.outcome === 'SYNERGY' ? [success] : value.outcome === 'INTERFERENCE' ? [failure] : [success, failure];
    return {
      composition_id: value.composition,
      outcome: value.outcome,
      evidence,
      provenance: ['agent:property-test'],
      recorded_at: value.timestamp,
    };
  });

const signalArb: fc.Arbitrary<DecaySignalInput> = fc
  .record({
    pkg: packageArb,
    kind: fc.constantFrom<'USAGE_DECAY' | 'FAILURE_RATE_GROWTH' | 'DEPENDENCY_DEPRECATION' | 'SUPERSESSION_AGE'>(
      'USAGE_DECAY',
      'FAILURE_RATE_GROWTH',
      'DEPENDENCY_DEPRECATION',
      'SUPERSESSION_AGE',
    ),
    evidence: fc.uniqueArray(evidenceArb, { minLength: 1, maxLength: 2 }),
    timestamp: timestampArb,
  })
  .map((value) => ({
    package_id: value.pkg,
    kind: value.kind,
    observed_at: value.timestamp,
    evidence_refs: value.evidence,
    provenance: ['agent:property-test'],
  }));

describe('ecology property tests — determinism and canonical round trips', () => {
  it('graph snapshots and queries are pure functions of the assertion SET (insertion-order independent)', () => {
    fc.assert(
      fc.property(fc.uniqueArray(edgeAssertionArb, { minLength: 1, maxLength: 24 }), (assertions) => {
        const forward = new EcologyGraph();
        for (const assertion of assertions) {
          forward.addAssertion(assertion);
        }
        const shuffled = [...assertions];
        // deterministic Fisher-Yates with a fixed pattern (fc shuffles via uniqueArray already;
        // reverse + rotate for a second independent order)
        shuffled.reverse();
        if (shuffled.length > 1) {
          shuffled.push(shuffled.shift()!);
        }
        const backward = new EcologyGraph();
        for (const assertion of shuffled) {
          backward.addAssertion(assertion);
        }
        expect(canonicalSerialize(backward.snapshot())).toBe(canonicalSerialize(forward.snapshot()));
        expect(backward.edges()).toEqual(forward.edges());
        expect(backward.nodesList()).toEqual(forward.nodesList());
        for (const pkg of PACKAGES) {
          expect(backward.compatibleWith(pkg)).toEqual(forward.compatibleWith(pkg));
          expect(backward.conflictsOf(pkg)).toEqual(forward.conflictsOf(pkg));
          expect(backward.neighborsOf(pkg)).toEqual(forward.neighborsOf(pkg));
        }
        expect(backward.canCoexist(PACKAGES.slice(0, 3))).toEqual(forward.canCoexist(PACKAGES.slice(0, 3)));
        return true;
      }),
      { numRuns: 60 },
    );
  });

  it('graph snapshots round-trip canonically through restore', () => {
    fc.assert(
      fc.property(fc.uniqueArray(edgeAssertionArb, { minLength: 1, maxLength: 16 }), (assertions) => {
        const graph = new EcologyGraph();
        for (const assertion of assertions) {
          graph.addAssertion(assertion);
        }
        const snapshot = graph.snapshot();
        const restored = EcologyGraph.restore(JSON.parse(canonicalSerialize(snapshot)));
        expect(canonicalSerialize(restored.snapshot())).toBe(canonicalSerialize(snapshot));
        expect(restored.toTraceLinks()).toEqual(graph.toTraceLinks());
        return true;
      }),
      { numRuns: 40 },
    );
  });

  it('edgeBetween is symmetric for every populated relation', () => {
    fc.assert(
      fc.property(fc.uniqueArray(edgeAssertionArb, { minLength: 1, maxLength: 12 }), (assertions) => {
        const graph = new EcologyGraph();
        for (const assertion of assertions) {
          graph.addAssertion(assertion);
        }
        for (const edge of graph.edges()) {
          expect(graph.edgeBetween(edge.source, edge.target, edge.kind)).toEqual(
            graph.edgeBetween(edge.target, edge.source, edge.kind),
          );
        }
        return true;
      }),
      { numRuns: 40 },
    );
  });

  it('interaction store snapshots are insertion-order independent and round-trip', () => {
    fc.assert(
      fc.property(fc.uniqueArray(interactionArb, { minLength: 1, maxLength: 16 }), (inputs) => {
        const forward = new InteractionStore();
        for (const input of inputs) {
          forward.record(input);
        }
        const backward = new InteractionStore();
        for (const input of [...inputs].reverse()) {
          backward.record(input);
        }
        expect(canonicalSerialize(backward.snapshot())).toBe(canonicalSerialize(forward.snapshot()));
        const restored = InteractionStore.restore(JSON.parse(canonicalSerialize(forward.snapshot())));
        expect(canonicalSerialize(restored.snapshot())).toBe(canonicalSerialize(forward.snapshot()));
        for (const comp of COMPOSITIONS) {
          expect(restored.interactionsFor(comp)).toEqual(forward.interactionsFor(comp));
        }
        return true;
      }),
      { numRuns: 40 },
    );
  });

  it('review queue snapshots are insertion-order independent and round-trip', () => {
    fc.assert(
      fc.property(fc.uniqueArray(signalArb, { minLength: 1, maxLength: 16 }), (inputs) => {
        const forward = new MaturityReviewQueue();
        for (const input of inputs) {
          forward.recordSignal(input);
        }
        const backward = new MaturityReviewQueue();
        for (const input of [...inputs].reverse()) {
          backward.recordSignal(input);
        }
        expect(canonicalSerialize(backward.snapshot())).toBe(canonicalSerialize(forward.snapshot()));
        expect(backward.reviewQueue()).toEqual(forward.reviewQueue());
        const restored = MaturityReviewQueue.restore(JSON.parse(canonicalSerialize(forward.snapshot())));
        expect(canonicalSerialize(restored.snapshot())).toBe(canonicalSerialize(forward.snapshot()));
        // the review queue output is deterministic (canonical ordering by package id)
        const review = restored.reviewQueue();
        const packageIds = review.map((item) => item.package_id);
        expect(packageIds).toEqual([...packageIds].sort());
        return true;
      }),
      { numRuns: 40 },
    );
  });
});
