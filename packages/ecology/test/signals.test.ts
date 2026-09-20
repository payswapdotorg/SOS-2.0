/**
 * Unit tests: decay/obsolescence signals + the maturity REVIEW queue
 * (Work Order W13).
 */

import { describe, expect, it } from 'vitest';
import { MaturityReviewQueue } from '../src/index.js';
import type { DecaySignalInput } from '../src/index.js';
import { evidenceRefId, packageId } from './helpers.js';

const P1 = packageId('signals-p1');
const P2 = packageId('signals-p2');
const EV1 = evidenceRefId('signals-ev-1');
const EV2 = evidenceRefId('signals-ev-2');
const EV3 = evidenceRefId('signals-ev-3');

function signalInput(overrides: Partial<DecaySignalInput> = {}): DecaySignalInput {
  return {
    package_id: P1,
    kind: 'USAGE_DECAY',
    observed_at: '2025-01-02T00:00:00.000Z',
    evidence_refs: [EV1],
    provenance: ['agent:sre'],
    note: 'weekly active deployments down 70% over two quarters',
    ...overrides,
  };
}

describe('MaturityReviewQueue — decay/obsolescence signals', () => {
  it('records a typed, evidence-backed decay signal', () => {
    const queue = new MaturityReviewQueue();
    const signal = queue.recordSignal(signalInput());
    expect(signal.package_id).toBe(P1);
    expect(signal.kind).toBe('USAGE_DECAY');
    expect(signal.evidence_refs).toEqual([EV1]);
    expect(queue.size).toBe(1);
  });

  it('is idempotent for identical signal content', () => {
    const queue = new MaturityReviewQueue();
    queue.recordSignal(signalInput());
    queue.recordSignal(signalInput({ evidence_refs: [EV1, EV1] })); // duplicate ref canonicalizes to the same signal
    expect(queue.size).toBe(1);
  });

  it('accepts all four frozen signal kinds', () => {
    const queue = new MaturityReviewQueue();
    queue.recordSignal(signalInput({ kind: 'USAGE_DECAY' }));
    queue.recordSignal(signalInput({ kind: 'FAILURE_RATE_GROWTH', evidence_refs: [EV2], observed_at: '2025-01-03T00:00:00.000Z' }));
    queue.recordSignal(signalInput({ kind: 'DEPENDENCY_DEPRECATION', evidence_refs: [EV3], observed_at: '2025-01-04T00:00:00.000Z' }));
    queue.recordSignal(signalInput({ kind: 'SUPERSESSION_AGE', observed_at: '2025-01-05T00:00:00.000Z' }));
    expect(queue.size).toBe(4);
    const item = queue.reviewQueueFor(P1);
    expect(item).not.toBeNull();
    expect(item!.signals).toHaveLength(4);
    expect(item!.signal_counts).toEqual({
      USAGE_DECAY: 1,
      FAILURE_RATE_GROWTH: 1,
      DEPENDENCY_DEPRECATION: 1,
      SUPERSESSION_AGE: 1,
    });
    // signals sorted by (observed_at, id)
    expect(item!.signals[0]!.observed_at).toBe('2025-01-02T00:00:00.000Z');
    expect(item!.signals[3]!.observed_at).toBe('2025-01-05T00:00:00.000Z');
  });

  it('groups the review queue by package in canonical order', () => {
    const queue = new MaturityReviewQueue();
    queue.recordSignal(signalInput({ package_id: P2, kind: 'SUPERSESSION_AGE', evidence_refs: [EV2] }));
    queue.recordSignal(signalInput());
    const review = queue.reviewQueue();
    expect(review).toHaveLength(2);
    expect(review.map((item) => item.package_id)).toEqual([P1, P2].sort());
    expect(review[0]!.signal_counts.USAGE_DECAY).toBe(1);
    expect(review[1]!.signal_counts.SUPERSESSION_AGE).toBe(1);
  });

  it('exposes NO maturity-mutating API — signals never auto-demote', () => {
    const queue = new MaturityReviewQueue();
    queue.recordSignal(signalInput());
    const ownMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(queue)).filter((name) => name !== 'constructor');
    const mutators = ownMethods.filter((name) =>
      /demote|retire|supersede|promote|matur|deprecate|transition/i.test(name),
    );
    expect(mutators).toEqual([]);
    // the queue surface is read-only consumption
    expect(typeof (queue as unknown as Record<string, unknown>)['demote']).toBe('undefined');
    expect(queue.reviewQueue()).toEqual(queue.reviewQueue()); // consuming changes nothing
  });

  it('reviewQueueFor returns null for un-signaled packages', () => {
    const queue = new MaturityReviewQueue();
    expect(queue.reviewQueueFor(P1)).toBeNull();
  });

  it('snapshots and restores canonically (round trip)', () => {
    const queue = new MaturityReviewQueue();
    queue.recordSignal(signalInput());
    queue.recordSignal(signalInput({ package_id: P2, kind: 'FAILURE_RATE_GROWTH', evidence_refs: [EV3] }));
    const snapshot = queue.snapshot();
    const restored = MaturityReviewQueue.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.reviewQueue()).toEqual(queue.reviewQueue());
  });
});
