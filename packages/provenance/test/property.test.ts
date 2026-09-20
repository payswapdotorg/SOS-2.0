import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import {
  ProvenanceChainBuilder,
  ProvenanceStore,
  createProvenanceRecord,
  provenanceRecordId,
  validateProvenanceRecord,
  verifyProvenanceChain,
} from '../src/index.js';
import type { Producer, ProvenanceRecord } from '../src/index.js';

// Deterministic property tests (seed pinned in test/setup.ts — W0.5/W1 discipline).

const nonEmptyString = fc.string({ minLength: 1, maxLength: 24 }).filter((s) => s.trim().length > 0);

const producerArb: fc.Arbitrary<Producer> = fc
  .record({
    tool: nonEmptyString,
    tool_version: fc.option(nonEmptyString, { nil: null }),
    model: fc.option(nonEmptyString, { nil: null }),
    model_version: fc.option(nonEmptyString, { nil: null }),
    command: fc.option(nonEmptyString, { nil: null }),
    environment: fc.option(nonEmptyString, { nil: null }),
  })
  .filter((producer) => producer.model !== null || producer.model_version === null);

const chainArb = fc.array(
  fc.record({
    token: nonEmptyString.filter((token) => !token.startsWith('sos://')),
    note: fc.option(nonEmptyString, { nil: null }),
  }),
  { maxLength: 6 },
);

const truthStateArb = fc.constantFrom('SUCCESS', 'FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL') as fc.Arbitrary<
  'SUCCESS' | 'FAILURE' | 'UNKNOWN' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'PARTIAL'
>;

const recordArb: fc.Arbitrary<ProvenanceRecord> = fc
  .record({
    producer: producerArb,
    source_revision: fc.option(nonEmptyString, { nil: null }),
    deployment_revision: fc.option(nonEmptyString, { nil: null }),
    window: fc.option(
      fc.record({ start: fc.constant('2025-01-01T00:00:00.000Z'), end: fc.constant('2025-01-02T00:00:00.000Z') }),
      { nil: null },
    ),
    context: fc.option(fc.record({ key: nonEmptyString, value: fc.jsonValue() }, { requiredKeys: ['key', 'value'] }), {
      nil: null,
    }),
    chainTokens: chainArb,
    source_availability: truthStateArb,
  })
  .map((input) => {
    const builder = new ProvenanceChainBuilder();
    for (const hop of input.chainTokens) {
      builder.externalRevision(hop.token, hop.note);
    }
    const context =
      input.context === null ? null : ({ [input.context.key]: input.context.value } as Record<string, JsonValue>);
    return createProvenanceRecord({
      producer: input.producer,
      source_revision: input.source_revision,
      deployment_revision: input.deployment_revision,
      window: input.window,
      context,
      chain: builder.build(),
      source_availability: input.source_availability,
    });
  });

describe('provenance property tests', () => {
  it('deterministic identity: identical creation input always reproduces the identical id', () => {
    fc.assert(
      fc.property(recordArb, fc.integer({ min: 1, max: 3 }), (record, reruns) => {
        const expected = record.id;
        for (let i = 0; i < reruns; i += 1) {
          const again = createProvenanceRecord({
            producer: record.producer,
            source_revision: record.source_revision,
            deployment_revision: record.deployment_revision,
            window: record.window,
            context: record.context,
            chain: record.chain,
            source_availability: record.source_availability,
          });
          expect(again.id).toBe(expected);
        }
        return true;
      }),
    );
  });

  it('different content yields different ids (no silent collisions)', () => {
    fc.assert(
      fc.property(recordArb, truthStateArb, (record, otherState) => {
        const mutated = createProvenanceRecord({
          producer: record.producer,
          source_revision: record.source_revision,
          deployment_revision: record.deployment_revision,
          window: record.window,
          context: record.context,
          chain: record.chain,
          source_availability: otherState,
        });
        if (otherState === record.source_availability) {
          expect(mutated.id).toBe(record.id);
        } else {
          expect(mutated.id).not.toBe(record.id);
        }
        return true;
      }),
    );
  });

  it('every generated record canonicalizes and round-trips through JSON', () => {
    fc.assert(
      fc.property(recordArb, (record) => {
        const text = canonicalSerialize(record);
        const round = JSON.parse(text) as ProvenanceRecord;
        expect(canonicalSerialize(round)).toBe(text);
        expect(round).toEqual(record);
        expect(validateProvenanceRecord(round)).toBe(true);
        return true;
      }),
    );
  });

  it('chain verification is deterministic: same record + resolver, same verdict', () => {
    fc.assert(
      fc.property(recordArb, fc.func(fc.boolean()), (record, resolver) => {
        const first = verifyProvenanceChain(record, resolver);
        const second = verifyProvenanceChain(JSON.parse(JSON.stringify(record)) as ProvenanceRecord, resolver);
        expect(second).toEqual(first);
        expect(first.status === 'VERIFIED' ? first.unresolved.length === 0 : first.unresolved.length > 0).toBe(true);
        return true;
      }),
    );
  });

  it('store listings are deterministic and id-sorted under randomized insertions', () => {
    fc.assert(
      fc.property(fc.array(recordArb, { minLength: 0, maxLength: 12 }), (records) => {
        const store = new ProvenanceStore();
        const shuffled = [...records].sort((a, b) => (a.producer.tool < b.producer.tool ? -1 : 1));
        for (const record of shuffled) {
          store.put(record);
        }
        const ids = store.list().map((record) => record.id);
        expect(ids).toEqual([...ids].sort());
        const unique = new Set(records.map((record) => provenanceRecordId({
          producer: record.producer,
          source_revision: record.source_revision,
          deployment_revision: record.deployment_revision,
          window: record.window,
          context: record.context,
          chain: record.chain,
          source_availability: record.source_availability,
        })));
        expect(store.size).toBe(unique.size);
        return true;
      }),
    );
  });
});
