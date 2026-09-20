/**
 * Property tests for @sos-2/adapters — randomized adapter scenarios:
 * determinism + canonical round trips (the W12 property-test requirement).
 *
 * All generators use fast-check with the globally pinned seed (424242):
 * repeated runs produce identical results (the determinism discipline).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize, contentHash } from '@sos-2/semantic-spine';
import {
  InMemoryExecutionAdapter,
  InMemoryReasoningProviderAdapter,
  InMemoryRepositoryAdapter,
  InMemoryTelemetryIngestionAdapter,
  reasoningOutputAsEvidence,
} from '../src/index.js';
import { envelopeFixture, grantFixture, otelSpanFixture, SUBJECT_ID } from './helpers.js';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const provenanceArb = fc.array(fc.stringMatching(/^[a-z0-9:-]{1,24}/), { minLength: 1, maxLength: 4 });

const createdAtArb = fc
  .integer({ min: 1_600_000_000_000, max: 1_900_000_000_000 })
  .map((ms) => new Date(ms).toISOString());

const kindArb = fc.constantFrom('Decision', 'Mission', 'Evidence', 'Context', 'SystemState');

/** Distinct envelopes (distinct created_at seconds guarantee distinct deterministic ids). */
const envelopesArb = (maxCount: number) =>
  fc
    .tuple(kindArb, createdAtArb, provenanceArb, fc.integer({ min: 0, max: 200 }))
    .map(([kind, created_at, provenance, salt]) =>
      envelopeFixture({ kind, provenance, created_at: new Date(Date.parse(created_at) + salt).toISOString() }),
    )
    .map((envelope) => ({ envelope, key: `${envelope.kind}:${envelope.created_at}` }));

const spanStatusArb = fc.constantFrom('UNSET', 'OK', 'ERROR') as fc.Arbitrary<'UNSET' | 'OK' | 'ERROR'>;

const spanArb = fc
  .tuple(spanStatusArb, fc.integer({ min: 0, max: 1_000_000 }))
  .map(([code, suffix]) =>
    otelSpanFixture({
      status: { code, message: code === 'ERROR' ? 'boom' : null },
      traceId: suffix.toString(16).padStart(32, '0'),
    }),
  );

/** (grant, expectedStatusAtT0) pairs: revoked beats expiry (evaluation order). */
const grantCaseArb = fc.constantFrom(
  { expired: false, revoked: false }, // VALID at T0
  { expired: true, revoked: false }, // EXPIRED at the evaluation instant
  { expired: false, revoked: true }, // REVOKED (beats expiry)
  { expired: true, revoked: true }, // REVOKED (revocation beats expiry)
);

const jsonArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc.string(),
  fc.array(fc.jsonValue(), { maxLength: 3 }),
);

// ---------------------------------------------------------------------------
// Repository: determinism + canonical round trips
// ---------------------------------------------------------------------------

describe('property: repository adapter', () => {
  it('put/get round trips are identity for arbitrary spine envelopes', () => {
    fc.assert(
      fc.property(fc.uniqueArray(envelopesArb(1), { maxLength: 10, selector: (x) => x.key }), (entries) => {
        const envelopes = entries.map((e) => e.envelope);
        const repo = new InMemoryRepositoryAdapter();
        for (const envelope of envelopes) {
          repo.putEnvelope(envelope);
        }
        for (const envelope of envelopes) {
          expect(repo.getEnvelope(envelope.id)).toEqual(envelope);
        }
        expect(repo.listEnvelopes().map((e) => e.id)).toEqual(envelopes.map((e) => e.id).sort());
      }),
    );
  });

  it('two repositories built from the same envelopes (any order) list identically', () => {
    fc.assert(
      fc.property(fc.uniqueArray(envelopesArb(1), { maxLength: 8, selector: (x) => x.key }), (entries) => {
        const envelopes = entries.map((e) => e.envelope);
        const a = new InMemoryRepositoryAdapter();
        const b = new InMemoryRepositoryAdapter();
        for (const envelope of envelopes) {
          a.putEnvelope(envelope);
        }
        for (const envelope of [...envelopes].reverse()) {
          b.putEnvelope(envelope);
        }
        expect(canonicalSerialize(a.listEnvelopes())).toBe(canonicalSerialize(b.listEnvelopes()));
      }),
    );
  });

  it('envelope content hashes are stable across repositories (canonical round trip)', () => {
    fc.assert(
      fc.property(envelopesArb(1), ({ envelope }) => {
        const a = new InMemoryRepositoryAdapter();
        const b = new InMemoryRepositoryAdapter();
        a.putEnvelope(envelope);
        b.putEnvelope(envelope);
        const fromA = a.getEnvelope(envelope.id)!;
        const fromB = b.getEnvelope(envelope.id)!;
        expect(contentHash(fromA)).toBe(contentHash(fromB));
        expect(contentHash(fromA)).toBe(contentHash(envelope));
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Telemetry ingestion: determinism + idempotence
// ---------------------------------------------------------------------------

describe('property: telemetry ingestion adapter', () => {
  it('ingesting the same batch twice yields identical observation sequences', () => {
    fc.assert(
      fc.property(fc.array(spanArb, { minLength: 1, maxLength: 5 }), (spans) => {
        const a = new InMemoryTelemetryIngestionAdapter();
        const b = new InMemoryTelemetryIngestionAdapter();
        const first = a.ingest({ spans });
        const fromB = b.ingest({ spans });
        expect(canonicalSerialize(first)).toBe(canonicalSerialize(fromB));
        const aAfterFirst = a.allObservations();
        // Idempotent re-ingestion: the same batch converts identically.
        const again = a.ingest({ spans });
        expect(canonicalSerialize(again)).toBe(canonicalSerialize(first));
        expect(canonicalSerialize(aAfterFirst)).toBe(canonicalSerialize(b.allObservations()));
      }),
    );
  });

  it('never invents truth states: availability is always one of the frozen six', () => {
    fc.assert(
      fc.property(fc.array(spanArb, { maxLength: 4 }), (spans) => {
        const adapter = new InMemoryTelemetryIngestionAdapter();
        for (const observation of adapter.ingest({ spans })) {
          expect(['SUCCESS', 'FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL']).toContain(
            observation.availability,
          );
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Reasoning provider: determinism + non-authoritative bridge
// ---------------------------------------------------------------------------

describe('property: reasoning provider adapter', () => {
  it('deterministic handlers yield bit-identical completions', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), jsonArb, (prompt, payload) => {
        const model = { model: 'm', model_version: 'v' };
        const a = new InMemoryReasoningProviderAdapter(model, () => payload as never);
        const b = new InMemoryReasoningProviderAdapter(model, () => payload as never);
        const outA = a.complete({ system: null, prompt, inputs: null });
        const outB = b.complete({ system: null, prompt, inputs: null });
        expect(canonicalSerialize(outA)).toBe(canonicalSerialize(outB));
      }),
    );
  });

  it('every minted reasoning evidence record is non-authoritative (llm_output exactly true)', () => {
    fc.assert(
      fc.property(jsonArb, (payload) => {
        const provider = new InMemoryReasoningProviderAdapter(
          { model: 'm', model_version: 'v' },
          () => (payload === undefined ? null : (payload as never)),
        );
        const output = provider.complete({ system: null, prompt: 'p', inputs: null });
        const record = reasoningOutputAsEvidence({ output, subject: SUBJECT_ID });
        expect(record.llm_output).toBe(true);
        expect(record.producer.model).not.toBeNull();
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Execution adapter: authority gate correspondence
// ---------------------------------------------------------------------------

describe('property: execution adapter', () => {
  it('execution happens iff the grant is VALID at the evaluation point (mirrors evaluateGrant)', () => {
    fc.assert(
      fc.property(grantCaseArb, ({ expired, revoked }) => {
        let ran = false;
        const adapter = new InMemoryExecutionAdapter({
          op: () => {
            ran = true;
            return null;
          },
        });
        const grant = grantFixture({
          expiryAt: expired ? '2025-01-01T00:00:00.000Z' : '2030-01-01T00:00:00.000Z',
          revoked,
        });
        const at = { kind: 'TIME' as const, now: '2025-07-01T00:00:00.000Z' };
        // evaluation order: revocation beats expiry (the W1 rule)
        const expected = revoked ? 'REVOKED' : expired ? 'EXPIRED' : 'VALID';
        const result = adapter.execute({ operation: 'op', input: null, grant, at });
        if (expected === 'VALID') {
          expect(result.status).toBe('EXECUTED');
          expect(ran).toBe(true);
        } else {
          expect(result.status).toBe('EXECUTION_DENIED');
          expect(ran).toBe(false);
          if (result.status === 'EXECUTION_DENIED') {
            expect(result.denial.code).toBe(expected === 'EXPIRED' ? 'GRANT_EXPIRED' : 'GRANT_REVOKED');
          }
        }
      }),
    );
  });

  it('deterministic handlers yield identical executed results (canonical)', () => {
    fc.assert(
      fc.property(jsonArb, jsonArb, (input, output) => {
        const make = () =>
          new InMemoryExecutionAdapter({
            op: () => (output === undefined ? null : (output as never)),
          });
        const grant = grantFixture();
        const at = { kind: 'TIME' as const, now: '2025-03-01T00:00:00.000Z' };
        const r1 = make().execute({ operation: 'op', input: (input ?? null) as never, grant, at });
        const r2 = make().execute({ operation: 'op', input: (input ?? null) as never, grant, at });
        expect(canonicalSerialize(r1)).toBe(canonicalSerialize(r2));
      }),
    );
  });
});
