/**
 * NEGATIVE tests: ASK is a SUCCESS state — valid ask workflows never throw.
 * Invalid ask OPERATIONS (a non-ASK origin, a malformed instant, a foreign
 * alternative, an already-resolved entry) fail LOUDLY.
 */

import { describe, expect, it } from 'vitest';
import { createAskRequest } from '@sos-2/authority';
import { evaluate } from '@sos-2/decision';
import { AskQueue, assembleEscalationContext, composeAskContent } from '../src/index.js';
import {
  PROVENANCE,
  T1,
  decisionMeta,
  escalatingRequest,
  validGrant,
} from './helpers.js';

function mintedAsk() {
  const evaluation = evaluate(escalatingRequest(), decisionMeta());
  expect(evaluation.action).toBe('ASK');
  const ask = createAskRequest({
    content: composeAskContent({ decision: evaluation.record }),
    provenance: ['W10:ask-test'],
    created_at: T1,
  });
  return { ask, record: evaluation.record };
}

describe('non-ASK origins are rejected loudly', () => {
  it('composeAskContent throws for an ACT decision record', () => {
    const act = evaluate({ ...escalatingRequest(), grants: [validGrant()] }, decisionMeta());
    expect(act.action).toBe('ACT');
    expect(() => composeAskContent({ decision: act.record })).toThrow(/only be composed from an ASK decision record/);
  });

  it('assembleEscalationContext throws for an ACT decision record', () => {
    const act = evaluate({ ...escalatingRequest(), grants: [validGrant()] }, decisionMeta());
    const { ask } = mintedAsk();
    expect(() => assembleEscalationContext({ ask, decision: act.record, now: T1 })).toThrow(
      /only be assembled from an ASK decision record/,
    );
  });

  it('AskQueue.enqueue throws for an ACT origin decision', () => {
    const act = evaluate({ ...escalatingRequest(), grants: [validGrant()] }, decisionMeta());
    const { ask } = mintedAsk();
    const queue = new AskQueue();
    expect(() => queue.enqueue({ ask, origin_decision: act.record, enqueued_at: T1 })).toThrow(
      /only an ASK decision record can originate/,
    );
  });
});

describe('malformed ask operations fail loudly (never silently valid)', () => {
  it('a non-RFC3339 presentation instant is rejected by context assembly', () => {
    const { ask, record } = mintedAsk();
    expect(() => assembleEscalationContext({ ask, decision: record, now: 'yesterday-ish' })).toThrow(/RFC3339/);
  });

  it('a non-RFC3339 enqueue instant is rejected', () => {
    const { ask, record } = mintedAsk();
    const queue = new AskQueue();
    expect(() => queue.enqueue({ ask, origin_decision: record, enqueued_at: 'not-a-time' })).toThrow(/RFC3339/);
  });

  it('resolving an unknown entry throws', () => {
    const queue = new AskQueue();
    expect(() =>
      queue.resolve('sos://AskRequest/00000000000000000000000000000000', {
        resolved_by: 'x',
        chosen_alternative_id: 'y',
        note: 'n',
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/unknown ask queue entry/);
  });

  it('an empty resolved_by throws (the provenance of who resolved is mandatory)', () => {
    const queue = new AskQueue();
    const { ask, record } = mintedAsk();
    const entry = queue.enqueue({ ask, origin_decision: record, enqueued_at: T1 });
    expect(() =>
      queue.resolve(entry.id, {
        resolved_by: '',
        chosen_alternative_id: 'act-under-granted-authority',
        note: 'n',
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/resolved_by/);
  });

  it('a foreign alternative id throws at resolution', () => {
    const queue = new AskQueue();
    const { ask, record } = mintedAsk();
    const entry = queue.enqueue({ ask, origin_decision: record, enqueued_at: T1 });
    expect(() =>
      queue.resolve(entry.id, {
        resolved_by: 'human:principal-engineer',
        chosen_alternative_id: 'foreign-alternative',
        note: 'n',
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/not one of the ask's alternatives/);
  });

  it('resolving an already-resolved entry throws (terminal)', () => {
    const queue = new AskQueue();
    const { ask, record } = mintedAsk();
    const entry = queue.enqueue({ ask, origin_decision: record, enqueued_at: T1 });
    queue.resolve(entry.id, {
      resolved_by: 'human:principal-engineer',
      chosen_alternative_id: 'reject',
      note: 'Refused.',
      provenance: PROVENANCE,
      created_at: T1,
    });
    expect(() =>
      queue.resolve(entry.id, {
        resolved_by: 'human:principal-engineer',
        chosen_alternative_id: 'reject',
        note: 'Again.',
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/already RESOLVED/);
  });
});
