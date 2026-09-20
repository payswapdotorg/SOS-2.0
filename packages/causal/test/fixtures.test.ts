/**
 * Golden contract fixtures for @sos-2/causal (W5) — the canonical baseline
 * instances of this package's artifacts. The fixtures are PINNED: they must
 * reproduce bit-exactly from the documented sample inputs (the defaults of
 * test/helpers.ts sampleHypothesisContent / sampleCorrelationContent with
 * provenance ['W5:fixture'] and created_at T0). A drift between the
 * documented input and the fixture fails here loudly.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import {
  assertValidCausalHypothesis,
  assertValidCorrelationRecord,
  createCausalHypothesis,
  createCorrelationRecord,
  validateCausalHypothesis,
  validateCorrelationRecord,
} from '../src/index.js';
import type { CausalHypothesisArtifact, CorrelationRecordArtifact } from '../src/index.js';
import { T0, sampleCorrelationContent, sampleHypothesisContent } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(here, '../fixtures', name), 'utf8')) as T;
}

const GOLDEN_PROVENANCE = ['W5:fixture'];

describe('golden fixture: causal-hypothesis.json', () => {
  const golden = readFixture<CausalHypothesisArtifact>('causal-hypothesis.json');

  it('is a valid causal hypothesis artifact', () => {
    expect(() => assertValidCausalHypothesis(golden)).not.toThrow();
    expect(validateCausalHypothesis(golden)).toBe(true);
    expect(golden.envelope.id).toMatch(/^sos:\/\/CausalHypothesis\/[0-9a-f]{32}$/);
    expect(golden.content.claim_strength).toBe('CAUSAL');
  });

  it('reproduces bit-exactly from the documented golden sample input', () => {
    const reproduced = createCausalHypothesis({
      content: sampleHypothesisContent(),
      provenance: GOLDEN_PROVENANCE,
      created_at: T0,
    });
    expect(reproduced).toEqual(golden);
    expect(reproduced.envelope.id).toBe(golden.envelope.id);
    expect(canonicalSerialize(reproduced)).toBe(canonicalSerialize(golden));
  });
});

describe('golden fixture: correlation.json', () => {
  const golden = readFixture<CorrelationRecordArtifact>('correlation.json');

  it('is a valid correlation record artifact', () => {
    expect(() => assertValidCorrelationRecord(golden)).not.toThrow();
    expect(validateCorrelationRecord(golden)).toBe(true);
    expect(golden.envelope.id).toMatch(/^sos:\/\/CorrelationRecord\/[0-9a-f]{32}$/);
  });

  it('reproduces bit-exactly from the documented golden sample input', () => {
    const reproduced = createCorrelationRecord({
      content: sampleCorrelationContent(),
      provenance: GOLDEN_PROVENANCE,
      created_at: T0,
    });
    expect(reproduced).toEqual(golden);
    expect(reproduced.envelope.id).toBe(golden.envelope.id);
    expect(canonicalSerialize(reproduced)).toBe(canonicalSerialize(golden));
  });
});
