import { describe, expect, it } from 'vitest';
import { InMemoryEventLog } from '@sos-2/action-gateway';
import type { ActionEvent } from '@sos-2/action-gateway';
import { buildFixture, commitRequest, expectExecuted } from './helpers.js';

describe('P9 idempotency + replay protection', () => {
  it('a replayed idempotency key returns the recorded original outcome without a second execution', () => {
    const fx = buildFixture();
    fx.authority.grant('body-1', 'commit', 'workspace', {});
    const firstReceipt = expectExecuted(fx.gateway.execute(commitRequest()));
    const second = fx.gateway.execute(commitRequest());
    expect(second.kind).toBe('replayed');
    if (second.kind !== 'replayed') throw new Error('unreachable');
    expect(second.receipt).toEqual(firstReceipt);
    expect(fx.executor.calls).toHaveLength(1);
    expect(fx.idempotency.size()).toBe(1);
  });

  it('replay events themselves deduplicate in the durable log', () => {
    const fx = buildFixture();
    fx.authority.grant('body-1', 'commit', 'workspace', {});
    fx.gateway.execute(commitRequest());
    fx.gateway.execute(commitRequest());
    fx.gateway.execute(commitRequest());
    const types = fx.events.entries().map((e) => e.type);
    expect(types.filter((t) => t === 'action.succeeded')).toHaveLength(1);
    expect(types.filter((t) => t === 'action.replayed')).toHaveLength(1);
  });

  it('the event log enforces replay protection at the append level', () => {
    const log = new InMemoryEventLog();
    const event: ActionEvent = {
      type: 'action.succeeded',
      actionId: 'a',
      family: 'commit',
      actor: { kind: 'body', id: 'b' },
      sourceRevision: 's',
      deploymentRevision: null,
      at: 1,
      payloadDigest: 'd',
    };
    const first = log.append(event);
    const second = log.append({ ...event });
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
    expect(second.duplicateOf).toBe(first.sequence);
    expect(log.entries()).toHaveLength(1);
  });

  it('a different idempotency key is a new action even with identical content', () => {
    const fx = buildFixture();
    fx.authority.grant('body-1', 'commit', 'workspace', {});
    fx.gateway.execute(commitRequest());
    const second = fx.gateway.execute(commitRequest({ idempotencyKey: 'idem-commit-2' }));
    expect(second.kind).toBe('executed');
    expect(fx.executor.calls).toHaveLength(2);
  });
});
