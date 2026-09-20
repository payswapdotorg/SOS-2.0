import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize, isArtifactId } from '@sos-2/semantic-spine';
import {
  CausalKnowledgeStore,
  createCausalHypothesis,
  createCorrelationRecord,
  hypothesisEvidenceSupport,
  validateCausalHypothesis,
  validateCorrelationRecord,
} from '../src/index.js';
import type { CreateCausalHypothesisInput } from '../src/index.js';
import {
  PROVENANCE,
  T0,
  T1,
  T2,
  llmProducer,
  sampleCorrelationContent,
  sampleHypothesisContent,
  toolProducer,
} from './helpers.js';

const TIMESTAMPS = [T0, T1, T2] as const;

/** Valid hypothesis option tuples (CAUSAL implies >= 1 interventional SUCCESS; >= 1 ref total). */
interface Options {
  claimStrength: 'CAUSAL' | 'CORRELATIONAL';
  observational: number;
  interventionalSuccess: number;
  interventionalOther: number;
  producer: 'tool' | 'llm';
}

const fcOptions: fc.Arbitrary<Options> = fc
  .record({
    claimStrength: fc.constantFrom<'CAUSAL' | 'CORRELATIONAL'>('CAUSAL', 'CORRELATIONAL'),
    observational: fc.integer({ min: 0, max: 4 }),
    interventionalSuccess: fc.integer({ min: 0, max: 3 }),
    interventionalOther: fc.integer({ min: 0, max: 2 }),
    producer: fc.constantFrom<'tool' | 'llm'>('tool', 'llm'),
  })
  .map((raw) => {
    const o = { ...raw };
    if (o.claimStrength === 'CAUSAL' && o.interventionalSuccess === 0) {
      o.interventionalSuccess = 1;
    }
    if (o.observational + o.interventionalSuccess + o.interventionalOther === 0) {
      o.observational = 1;
    }
    return o;
  });

const fcCreateInput: fc.Arbitrary<CreateCausalHypothesisInput> = fc
  .record({
    options: fcOptions,
    created_at: fc.constantFrom(...TIMESTAMPS),
  })
  .map(({ options, created_at }) => ({
    content: sampleHypothesisContent({
      claimStrength: options.claimStrength,
      observational: options.observational,
      interventionalSuccess: options.interventionalSuccess,
      interventionalOther: options.interventionalOther,
      producer: options.producer === 'llm' ? llmProducer() : toolProducer(),
    }),
    provenance: PROVENANCE,
    created_at,
  }));

describe('causal hypothesis properties (deterministic, contract-conformant)', () => {
  it('always mints valid artifacts with spine CausalHypothesis ids', () => {
    fc.assert(
      fc.property(fcCreateInput, (input) => {
        const artifact = createCausalHypothesis(input);
        expect(validateCausalHypothesis(artifact)).toBe(true);
        expect(artifact.envelope.id).toMatch(/^sos:\/\/CausalHypothesis\/[0-9a-f]{32}$/);
        expect(isArtifactId(artifact.envelope.id)).toBe(true);
        return true;
      }),
    );
  });

  it('evidence support is exactly consistent with the asserted claim strength', () => {
    fc.assert(
      fc.property(fcCreateInput, (input) => {
        const artifact = createCausalHypothesis(input);
        const support = hypothesisEvidenceSupport(artifact.content);
        if (artifact.content.claim_strength === 'CAUSAL') {
          expect(support.supported).toBe(true);
          expect(support.interventionalSupport).toBeGreaterThanOrEqual(1);
        } else {
          // CORRELATIONAL claims may be backed by anything.
          expect(typeof support.supported).toBe('boolean');
        }
        return true;
      }),
    );
  });

  it('is deterministic: identical inputs yield identical artifacts and ids', () => {
    fc.assert(
      fc.property(fcCreateInput, (input) => {
        const a = createCausalHypothesis(input);
        const b = createCausalHypothesis(JSON.parse(JSON.stringify(input)) as CreateCausalHypothesisInput);
        expect(a).toEqual(b);
        expect(a.envelope.id).toBe(b.envelope.id);
        return true;
      }),
    );
  });

  it('canonical round trips are byte-stable', () => {
    fc.assert(
      fc.property(fcCreateInput, (input) => {
        const artifact = createCausalHypothesis(input);
        const text = canonicalSerialize(artifact);
        const roundTripped = JSON.parse(text);
        expect(validateCausalHypothesis(roundTripped)).toBe(true);
        expect(canonicalSerialize(roundTripped)).toBe(text);
        return true;
      }),
    );
  });
});

describe('correlation record properties', () => {
  it('is deterministic and canonically round-trip stable', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TIMESTAMPS), (created_at) => {
        const input = { content: sampleCorrelationContent(), provenance: PROVENANCE, created_at };
        const a = createCorrelationRecord(input);
        const b = createCorrelationRecord(JSON.parse(JSON.stringify(input)) as typeof input);
        expect(a).toEqual(b);
        expect(validateCorrelationRecord(a)).toBe(true);
        const text = canonicalSerialize(a);
        expect(canonicalSerialize(JSON.parse(text))).toBe(text);
        return true;
      }),
    );
  });
});

describe('store query determinism over randomized sets', () => {
  it('listings are identical regardless of insertion order (sorted by id)', () => {
    fc.assert(
      fc.property(
        fc.array(fcCreateInput, { minLength: 0, maxLength: 12 }),
        fc.option(fc.integer({ min: 0, max: 100 }), { nil: 42 }),
        (inputs, rotationSeed) => {
          const seen = new Set<string>();
          const artifacts: ReturnType<typeof createCausalHypothesis>[] = [];
          for (const input of inputs) {
            const artifact = createCausalHypothesis({ ...input, status: 'ACTIVE' as const });
            if (seen.has(artifact.envelope.id)) continue; // duplicate ids are rejected on put
            seen.add(artifact.envelope.id);
            artifacts.push(artifact);
          }
          const forward = new CausalKnowledgeStore();
          for (const artifact of artifacts) forward.putHypothesis(artifact);
          const rotated = new CausalKnowledgeStore();
          const shift = rotationSeed % (artifacts.length + 1);
          for (const artifact of [...artifacts.slice(shift), ...artifacts.slice(0, shift)]) {
            rotated.putHypothesis(artifact);
          }
          const forwardIds = forward.listHypotheses().map((h) => h.envelope.id);
          const rotatedIds = rotated.listHypotheses().map((h) => h.envelope.id);
          expect(rotatedIds).toEqual(forwardIds);
          expect(forwardIds).toEqual([...forwardIds].sort());
          // Evidence traceability is order-independent too:
          const forwardSupport = forward.allLinks().map((l) => `${l.source}\u0000${l.target}`).sort();
          const rotatedSupport = rotated.allLinks().map((l) => `${l.source}\u0000${l.target}`).sort();
          expect(rotatedSupport).toEqual(forwardSupport);
          return true;
        },
      ),
      { numRuns: 30 },
    );
  });

  it('repeated queries return identical results (query determinism)', () => {
    fc.assert(
      fc.property(fc.array(fcCreateInput, { minLength: 1, maxLength: 8 }), (inputs) => {
        const store = new CausalKnowledgeStore();
        const seen = new Set<string>();
        for (const input of inputs) {
          const artifact = createCausalHypothesis({ ...input, status: 'ACTIVE' as const });
          if (seen.has(artifact.envelope.id)) continue; // duplicate ids are rejected on put
          seen.add(artifact.envelope.id);
          store.putHypothesis(artifact);
        }
        const first = store.listHypotheses();
        const second = store.listHypotheses();
        expect(second).toEqual(first);
        const activeFirst = store.activeHypotheses();
        expect(store.activeHypotheses()).toEqual(activeFirst);
        return true;
      }),
      { numRuns: 30 },
    );
  });
});
