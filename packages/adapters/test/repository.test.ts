/**
 * RepositoryAdapter tests — the storage contract for spine envelopes and
 * trace links (in-memory reference implementation).
 */

import { describe, expect, it } from 'vitest';
import { createTraceLink } from '@sos-2/semantic-spine';
import { InMemoryRepositoryAdapter } from '../src/index.js';
import { envelopeFixture, T0, T1 } from './helpers.js';

describe('InMemoryRepositoryAdapter', () => {
  it('stores and returns spine envelopes (round trip is identity)', () => {
    const repo = new InMemoryRepositoryAdapter();
    const envelope = envelopeFixture();
    repo.putEnvelope(envelope);
    expect(repo.hasEnvelope(envelope.id)).toBe(true);
    expect(repo.getEnvelope(envelope.id)).toEqual(envelope);
    expect(repo.getEnvelope('sos://Decision/00000000000000000000000000000000')).toBeUndefined();
  });

  it('lists envelopes sorted by id and filters by kind', () => {
    const repo = new InMemoryRepositoryAdapter();
    const a = envelopeFixture({ created_at: T0 });
    const b = envelopeFixture({ created_at: T1 });
    const c = envelopeFixture({ kind: 'Mission', provenance: ['w12'], created_at: T0 });
    for (const envelope of [a, b, c]) {
      repo.putEnvelope(envelope);
    }
    expect(repo.listEnvelopes().map((e) => e.id)).toEqual([a.id, b.id, c.id].sort());
    expect(repo.envelopesOfKind('Mission')).toHaveLength(1);
    expect(repo.envelopesOfKind('Decision')).toHaveLength(2);
    expect(repo.envelopeCount).toBe(3);
  });

  it('rejects duplicate envelope ids (spine store semantics)', () => {
    const repo = new InMemoryRepositoryAdapter();
    const envelope = envelopeFixture();
    repo.putEnvelope(envelope);
    expect(() => repo.putEnvelope(envelope)).toThrow();
  });

  it('rejects envelopes that are not spine-valid', () => {
    const repo = new InMemoryRepositoryAdapter();
    const envelope = envelopeFixture();
    expect(() => repo.putEnvelope({ ...envelope, provenance: [] })).toThrow(/spine-valid/);
    expect(repo.envelopeCount).toBe(0);
  });

  it('performs validated envelope status transitions (identity preserved)', () => {
    const repo = new InMemoryRepositoryAdapter();
    const envelope = repo.putEnvelope(envelopeFixture());
    const active = repo.setEnvelopeStatus(envelope.id, 'ACTIVE');
    expect(active.status).toBe('ACTIVE');
    expect(active.id).toBe(envelope.id);
    expect(repo.getEnvelope(envelope.id)?.status).toBe('ACTIVE');
    // Invalid transition DRAFT -> SUPERSEDED skipped via ACTIVE; terminal transitions throw.
    repo.setEnvelopeStatus(envelope.id, 'RETIRED');
    expect(() => repo.setEnvelopeStatus(envelope.id, 'ACTIVE')).toThrow();
  });

  it('stores trace links and answers forward/backward queries', () => {
    const repo = new InMemoryRepositoryAdapter();
    const source = envelopeFixture().id;
    const target = envelopeFixture({ created_at: T1 }).id;
    const other = envelopeFixture({ created_at: T0, provenance: ['w12:other'] }).id;
    repo.putEnvelope(envelopeFixture());
    const link = repo.putTraceLink(
      createTraceLink({ source, target, type: 'OBSERVES', provenance: ['w12:link'] }),
    );
    repo.putTraceLink(createTraceLink({ source: other, target, type: 'VERIFIES', provenance: ['w12:link'] }));
    expect(repo.traceLinkCount).toBe(2);
    expect(repo.traceLinksFrom(source)).toEqual([link]);
    expect(repo.traceLinksTo(target).map((l) => l.type).sort()).toEqual(['OBSERVES', 'VERIFIES']);
    expect(repo.listTraceLinks()).toHaveLength(2);
  });

  it('rejects duplicate (source, target, type) link triples', () => {
    const repo = new InMemoryRepositoryAdapter();
    const source = envelopeFixture().id;
    const target = envelopeFixture({ created_at: T1 }).id;
    const link = createTraceLink({ source, target, type: 'OBSERVES', provenance: ['w12:link'] });
    repo.putTraceLink(link);
    expect(() => repo.putTraceLink(link)).toThrow();
    // The same pair with a different type is a distinct link and is allowed.
    expect(() =>
      repo.putTraceLink(createTraceLink({ source, target, type: 'VERIFIES', provenance: ['w12:link'] })),
    ).not.toThrow();
  });

  it('rejects trace links that are not spine-valid', () => {
    const repo = new InMemoryRepositoryAdapter();
    expect(() =>
      repo.putTraceLink({ source: 'not-an-id', target: 'also-not', type: 'OBSERVES' } as never),
    ).toThrow(/spine-valid/);
  });

  it('exposes its contract descriptor for the semantic guard', () => {
    const repo = new InMemoryRepositoryAdapter();
    expect(repo.descriptor.contract).toBe('RepositoryAdapter');
    expect(repo.descriptor.outputs).toEqual({ envelope: 'ArtifactEnvelope', traceLink: 'TraceLink' });
  });
});
