/**
 * Property tests: randomized transfer records and lineage — determinism,
 * canonical round trips, copied-forward invariants (Work Order W13
 * verification: "randomized populations — ... canonical round trips").
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { matchesCondition, sameCondition } from '@sos-2/packages';
import { TransferStore, deriveTargetEstimate, specializePackage, generalizePackage, LineageStore } from '../src/index.js';
import type { RecordTransferInput } from '../src/index.js';
import {
  basePackageArtifact,
  failureEvidence,
  interventionalEvidence,
  observationalEvidence,
  packageId,
  T1,
} from './helpers.js';

const CONTEXT_KEYS = ['region', 'tier', 'scale', 'tenant', 'cell'] as const;
const CONTEXT_VALUES = ['eu', 'us', 'apac', 'prod', 'dev', 'large', 'small', 'acme'] as const;

const contextArb = fc
  .uniqueArray(fc.constantFrom(...CONTEXT_KEYS), { minLength: 1, maxLength: 3 })
  .chain((keys) =>
    fc
      .uniqueArray(fc.constantFrom(...CONTEXT_VALUES), { minLength: keys.length, maxLength: keys.length })
      .map((values) => Object.fromEntries(keys.map((key, i) => [key, values[i]!])) as Record<string, string>),
  );

const distinctContextPairArb = contextArb.chain((source) =>
  contextArb.filter((target) => !sameCondition(source, target)).map((target) => ({ source, target })),
);

const transferArb: fc.Arbitrary<RecordTransferInput> = fc
  .record({
    source: fc.constantFrom(packageId('prop-a'), packageId('prop-b')),
    contexts: distinctContextPairArb,
    outcome: fc.constantFrom<'TRANSFER_SUCCESS' | 'TRANSFER_FAILURE' | 'TRANSFER_INCONCLUSIVE'>(
      'TRANSFER_SUCCESS',
      'TRANSFER_FAILURE',
      'TRANSFER_INCONCLUSIVE',
    ),
    causal: fc.boolean(),
    evidenceIndex: fc.integer({ min: 0, max: 500 }),
    timestamp: fc.constantFrom(
      '2025-01-01T00:00:00.000Z',
      '2025-01-02T00:00:00.000Z',
      '2025-01-03T00:00:00.000Z',
      '2025-01-04T00:00:00.000Z',
    ),
  })
  .map((value) => {
    const observational = observationalEvidence(value.source, value.evidenceIndex);
    const interventional = interventionalEvidence(value.source, value.evidenceIndex + 1000);
    const failure = failureEvidence(value.source, value.evidenceIndex + 2000);
    // §18 discipline: a CAUSAL claim requires interventional SUCCESS evidence —
    // generate CAUSAL only where the cited evidence can support it.
    const causal = value.causal && value.outcome === 'TRANSFER_SUCCESS';
    const evidence = value.outcome === 'TRANSFER_FAILURE' ? [failure] : causal ? [interventional] : [observational];
    return {
      source_ref: value.source,
      source_context: value.contexts.source,
      target_context: value.contexts.target,
      outcome: value.outcome,
      evidence,
      claim_strength: causal ? ('CAUSAL' as const) : ('CORRELATIONAL' as const),
      provenance: ['agent:property-test'],
      recorded_at: value.timestamp,
    };
  });

describe('transfer property tests — determinism and canonical round trips', () => {
  it('transfer ids and store snapshots are insertion-order independent', () => {
    fc.assert(
      fc.property(fc.uniqueArray(transferArb, { minLength: 1, maxLength: 16 }), (inputs) => {
        const forward = new TransferStore();
        for (const input of inputs) {
          forward.recordTransfer(input);
        }
        const backward = new TransferStore();
        for (const input of [...inputs].reverse()) {
          backward.recordTransfer(input);
        }
        expect(canonicalSerialize(backward.snapshot())).toBe(canonicalSerialize(forward.snapshot()));
        return true;
      }),
      { numRuns: 40 },
    );
  });

  it('store snapshots round-trip canonically through restore (negative evidence survives)', () => {
    fc.assert(
      fc.property(fc.uniqueArray(transferArb, { minLength: 1, maxLength: 12 }), (inputs) => {
        const store = new TransferStore();
        for (const input of inputs) {
          store.recordTransfer(input);
        }
        const snapshot = store.snapshot();
        const restored = TransferStore.restore(JSON.parse(canonicalSerialize(snapshot)));
        expect(canonicalSerialize(restored.snapshot())).toBe(canonicalSerialize(snapshot));
        // failures survive the round trip
        const failuresBefore = store.allTransfers().filter((record) => record.outcome === 'TRANSFER_FAILURE').length;
        const failuresAfter = restored.allTransfers().filter((record) => record.outcome === 'TRANSFER_FAILURE').length;
        expect(failuresAfter).toBe(failuresBefore);
        return true;
      }),
      { numRuns: 40 },
    );
  });

  it('derived target estimates are ALWAYS conditioned within the target context (never the source)', () => {
    fc.assert(
      fc.property(fc.uniqueArray(transferArb, { minLength: 1, maxLength: 12 }), (inputs) => {
        const store = new TransferStore();
        for (const input of inputs) {
          store.recordTransfer(input);
        }
        for (const record of store.allTransfers()) {
          const estimate = deriveTargetEstimate(record);
          if (estimate !== null) {
            expect(matchesCondition(estimate.context, record.target_context)).toBe(true);
          }
        }
        return true;
      }),
      { numRuns: 40 },
    );
  });

  it('specialize/generalize are deterministic and copy-forward is a superset invariant', () => {
    fc.assert(
      fc.property(
        fc.record({
          // extra keys must not collide with the base context keys (region, tier)
          extraKeys: fc.uniqueArray(fc.constantFrom('scale', 'tenant', 'cell', 'zone'), { minLength: 1, maxLength: 3 }),
          values: fc.uniqueArray(fc.constantFrom(...CONTEXT_VALUES), { minLength: 4, maxLength: 8 }),
          extraLimitations: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 3 }),
        }),
        (value) => {
          const base = basePackageArtifact();
          // build a strict refinement of the base context {region: eu, tier: prod}
          const refined: Record<string, string> = { region: 'eu', tier: 'prod' };
          for (let i = 0; i < value.extraKeys.length; i += 1) {
            refined[value.extraKeys[i]!] = value.values[i % value.values.length]!;
          }
          const input = {
            base,
            context: refined,
            evidence_refs: [observationalEvidence(base.envelope.id, 11).id],
            provenance: ['agent:property-test'],
            created_at: T1,
            changes: 'property-test specialization',
            added_limitations: value.extraLimitations,
          };
          const one = specializePackage(input);
          const two = specializePackage(input);
          expect(one.artifact.envelope.id).toBe(two.artifact.envelope.id);
          expect(one.lineage.id).toBe(two.lineage.id);
          // copied-forward superset invariants
          for (const ref of base.content.evidence_refs) {
            expect(one.artifact.content.evidence_refs).toContain(ref);
          }
          for (const ref of base.content.failure_refs) {
            expect(one.artifact.content.failure_refs).toContain(ref);
          }
          for (const limitation of base.content.learned_limitations) {
            expect(one.artifact.content.learned_limitations).toContain(limitation);
          }
          for (const obligation of base.content.assurance_obligations) {
            expect(one.artifact.content.assurance_obligations).toContainEqual(obligation);
          }
          return true;
        },
      ),
      { numRuns: 40 },
    );
  });

  it('lineage stores round-trip canonically and ancestry is insertion-order independent', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), (depth) => {
        // a chain of specializations of depth N
        const results = [];
        let current = basePackageArtifact();
        for (let i = 0; i < depth; i += 1) {
          const refined = { ...current.content.context, [`level${i}`]: `v${i}` };
          const result = specializePackage({
            base: current,
            context: refined,
            evidence_refs: [observationalEvidence(current.envelope.id, 20 + i).id],
            provenance: ['agent:property-test'],
            created_at: T1,
            changes: `chain level ${i}`,
          });
          results.push(result);
          current = result.artifact;
        }
        const forward = new LineageStore();
        for (const result of results) {
          forward.add(result.lineage);
        }
        const backward = new LineageStore();
        for (const result of [...results].reverse()) {
          backward.add(result.lineage);
        }
        expect(canonicalSerialize(backward.snapshot())).toBe(canonicalSerialize(forward.snapshot()));
        const tipId = current.envelope.id;
        expect(forward.ancestryOf(tipId)).toHaveLength(depth);
        const restored = LineageStore.restore(JSON.parse(canonicalSerialize(forward.snapshot())));
        expect(canonicalSerialize(restored.snapshot())).toBe(canonicalSerialize(forward.snapshot()));
        // generalizing the tip keeps the chain walkable in both directions
        const generalized = generalizePackage({
          base: current,
          context: { region: 'eu' },
          evidence_refs: [observationalEvidence(current.envelope.id, 99).id],
          provenance: ['agent:property-test'],
          created_at: T1,
          changes: 'generalized back to region eu',
        });
        const store = LineageStore.restore(JSON.parse(canonicalSerialize(restored.snapshot())));
        store.add(generalized.lineage);
        expect(store.ancestryOf(generalized.artifact.envelope.id)).toHaveLength(depth + 1);
        return true;
      }),
      { numRuns: 25 },
    );
  });
});
