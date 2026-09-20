/**
 * Unit tests: the AskQueue — ordering, deduplication, resolution handling,
 * and the ASK-is-a-success-state discipline.
 */

import { describe, expect, it } from 'vitest';
import { createAskRequest } from '@sos-2/authority';
import { evaluate, validateDecisionRecord } from '@sos-2/decision';
import { AskQueue, composeAskContent } from '../src/index.js';
import type { AskQueueEntry } from '../src/index.js';
import {
  PROVENANCE,
  T1,
  cornerRequest,
  decisionMeta,
  escalatingRequest,
} from './helpers.js';

function enqueueFor(
  queue: AskQueue,
  request: Parameters<typeof evaluate>[0],
  enqueuedAt: string,
  version = 1,
): AskQueueEntry {
  const evaluation = evaluate(request, decisionMeta());
  if (evaluation.action !== 'ASK') {
    throw new Error(`fixture expects ASK, received ${evaluation.action}`);
  }
  const ask = createAskRequest({
    content: composeAskContent({ decision: evaluation.record }),
    provenance: ['W10:ask-test:ask'],
    created_at: T1,
    version,
  });
  return queue.enqueue({ ask, origin_decision: evaluation.record, enqueued_at: enqueuedAt });
}

describe('AskQueue enqueue — ASK IS A SUCCESS STATE', () => {
  it('a valid ask never fails to enqueue; entries are PENDING and reference the origin', () => {
    const queue = new AskQueue();
    const entry = enqueueFor(queue, escalatingRequest(), T1);
    expect(entry.status).toBe('PENDING');
    expect(entry.resolution).toBeNull();
    expect(entry.id).toMatch(/^sos:\/\/AskRequest\/[0-9a-f]{32}$/);
    expect(entry.origin_input_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(queue.size).toBe(1);
    expect(queue.pendingCount).toBe(1);
  });

  it('deduplicates by the ORIGIN input digest (idempotent enqueue, no duplicates)', () => {
    const queue = new AskQueue();
    const first = enqueueFor(queue, escalatingRequest(), T1);
    // The same request evaluated again -> same digest -> same entry:
    const second = enqueueFor(queue, escalatingRequest(), '2025-01-02T01:00:00.000Z');
    expect(second).toBe(first);
    expect(queue.size).toBe(1);
    // A DIFFERENT input (the corner request has a different digest) enqueues:
    const corner = enqueueFor(queue, cornerRequest(), '2025-01-02T02:00:00.000Z');
    expect(corner.id).not.toBe(first.id);
    expect(queue.size).toBe(2);
    // The digest lookup works:
    expect(queue.byInputDigest(first.origin_input_digest)!.id).toBe(first.id);
    expect(queue.byInputDigest(corner.origin_input_digest)!.id).toBe(corner.id);
  });

  it('the same DIGEST with a DIFFERENT ask wording still deduplicates (digest is the key)', () => {
    const queue = new AskQueue();
    const evaluation = evaluate(escalatingRequest(), decisionMeta());
    const askA = createAskRequest({
      content: composeAskContent({ decision: evaluation.record }),
      provenance: ['W10:ask-test:ask'],
      created_at: T1,
    });
    const askB = createAskRequest({
      content: composeAskContent({
        decision: evaluation.record,
        overrides: { trade_offs: ['a differently-worded trade-off'] },
      }),
      provenance: ['W10:ask-test:ask'],
      created_at: T1,
      version: 2,
    });
    const a = queue.enqueue({ ask: askA, origin_decision: evaluation.record, enqueued_at: T1 });
    const b = queue.enqueue({ ask: askB, origin_decision: evaluation.record, enqueued_at: T1 });
    expect(b).toBe(a);
    expect(queue.size).toBe(1);
  });
});

describe('AskQueue ordering — severity first, FIFO within severity, id tiebreak', () => {
  it('orders by priority (SEVERE > HIGH > MODERATE > LOW)', () => {
    const queue = new AskQueue();
    const low = enqueueFor(queue, escalatingRequest(), T1); // LOW severity
    const corner = enqueueFor(queue, cornerRequest(), '2025-01-02T03:00:00.000Z'); // HIGH severity
    const severe = enqueueFor(
      queue,
      { ...cornerRequest(), risk: 'SEVERE' as const, reversibility: 'REVERSIBLE' as const },
      '2025-01-02T04:00:00.000Z',
    );
    expect(queue.list().map((entry) => entry.priority)).toEqual(['SEVERE', 'HIGH', 'LOW']);
    expect(queue.pending()[0]!.id).toBe(severe.id);
    expect(queue.pending().at(-1)!.id).toBe(low.id);
    expect(corner.priority).toBe('HIGH');
  });

  it('FIFO within the same severity (enqueued_at ascending)', () => {
    const queue = new AskQueue();
    const first = enqueueFor(queue, escalatingRequest(), '2025-01-02T01:00:00.000Z');
    const second = enqueueFor(
      queue,
      { ...escalatingRequest(), action_description: 'A second, later escalation.' },
      '2025-01-02T02:00:00.000Z',
    );
    const order = queue.list().map((entry) => entry.id);
    expect(order.indexOf(first.id)).toBeLessThan(order.indexOf(second.id));
  });
});

describe('AskQueue resolution — DecisionRecord via the decision machinery', () => {
  it('resolving an ASK produces a spine-valid DecisionRecord bound to the exact input digest', () => {
    const queue = new AskQueue();
    const entry = enqueueFor(queue, escalatingRequest(), T1);
    const record = queue.resolve(entry.id, {
      resolved_by: 'human:principal-engineer',
      chosen_alternative_id: 'act-under-granted-authority',
      note: 'I grant the authority for this specific revision.',
      provenance: PROVENANCE,
      created_at: '2025-01-02T06:00:00.000Z',
    });
    expect(record.content.action).toBe('ACT');
    expect(record.content.input_digest).toBe(entry.origin_input_digest);
    expect(record.content.resolution!.resolved_by).toBe('human:principal-engineer');
    expect(record.content.resolution!.ask_ref).toBe(entry.id);
    expect(record.content.resolution!.origin_decision_ref).toBe(entry.origin_decision_ref);
    expect(record.envelope.provenance).toContain('resolved-by:human:principal-engineer');
    expect(validateDecisionRecord(record)).toBe(true);

    // The entry is now RESOLVED (terminal) with the resolution recorded:
    const resolvedEntry = queue.get(entry.id)!;
    expect(resolvedEntry.status).toBe('RESOLVED');
    expect(resolvedEntry.resolution!.decision_ref).toBe(record.envelope.id);
    expect(queue.pendingCount).toBe(0);
  });

  it('an entry resolves AT MOST ONCE (terminal)', () => {
    const queue = new AskQueue();
    const entry = enqueueFor(queue, escalatingRequest(), T1);
    queue.resolve(entry.id, {
      resolved_by: 'human:principal-engineer',
      chosen_alternative_id: 'reject',
      note: 'Refused.',
      provenance: PROVENANCE,
      created_at: '2025-01-02T06:00:00.000Z',
    });
    expect(() =>
      queue.resolve(entry.id, {
        resolved_by: 'human:principal-engineer',
        chosen_alternative_id: 'reject',
        note: 'Refused again.',
        provenance: PROVENANCE,
        created_at: '2025-01-02T07:00:00.000Z',
      }),
    ).toThrow(/already RESOLVED/);
  });

  it('a re-escalation of the SAME input is idempotent (the authority already decided it)', () => {
    const queue = new AskQueue();
    const entry = enqueueFor(queue, escalatingRequest(), T1);
    queue.resolve(entry.id, {
      resolved_by: 'human:principal-engineer',
      chosen_alternative_id: 'reject',
      note: 'Refused.',
      provenance: PROVENANCE,
      created_at: '2025-01-02T06:00:00.000Z',
    });
    const reescalated = enqueueFor(queue, escalatingRequest(), '2025-01-03T00:00:00.000Z');
    expect(reescalated.status).toBe('RESOLVED'); // the same digest -> the SAME (resolved) entry
    expect(queue.size).toBe(1);
  });

  it('a CHANGED input (different digest) enqueues a fresh ask', () => {
    const queue = new AskQueue();
    const entry = enqueueFor(queue, escalatingRequest(), T1);
    queue.resolve(entry.id, {
      resolved_by: 'human:principal-engineer',
      chosen_alternative_id: 'reject',
      note: 'Refused — gather evidence instead.',
      provenance: PROVENANCE,
      created_at: '2025-01-02T06:00:00.000Z',
    });
    // The changed request (different description -> different digest):
    const changed = enqueueFor(
      queue,
      { ...escalatingRequest(), action_description: 'The revised, evidence-backed mission revision.' },
      '2025-01-03T00:00:00.000Z',
    );
    expect(changed.status).toBe('PENDING');
    expect(queue.size).toBe(2);
    expect(queue.pendingCount).toBe(1);
  });

  it('resolution decisions are deterministic (same resolution input -> same record)', () => {
    const queueA = new AskQueue();
    const queueB = new AskQueue();
    const entryA = enqueueFor(queueA, escalatingRequest(), T1);
    const entryB = enqueueFor(queueB, escalatingRequest(), T1);
    const resolution = {
      resolved_by: 'human:principal-engineer',
      chosen_alternative_id: 'act-under-granted-authority',
      note: 'Same note.',
      provenance: PROVENANCE,
      created_at: '2025-01-02T06:00:00.000Z',
    } as const;
    const recordA = queueA.resolve(entryA.id, resolution);
    const recordB = queueB.resolve(entryB.id, resolution);
    expect(JSON.stringify(recordB)).toBe(JSON.stringify(recordA));
  });
});
