/**
 * Golden contract fixture for @sos-2/memory (W5) — the canonical baseline
 * instance of this package's artifact. The fixture is PINNED: it must
 * reproduce bit-exactly from the documented golden sample input
 * (test/helpers.ts sampleMemoryContent with provenance ['W5:fixture'] and
 * created_at T0). A drift between the documented input and the fixture
 * fails here loudly.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import {
  assertValidArchitectureMemory,
  createArchitectureMemory,
  memoryEvidenceRefs,
  validateArchitectureMemory,
} from '../src/index.js';
import type { ArchitectureMemoryArtifact } from '../src/index.js';
import { T0, sampleMemoryContent } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));

const GOLDEN_PROVENANCE = ['W5:fixture'];

describe('golden fixture: architecture-memory.json', () => {
  const golden = readFixture();

  it('is a valid architecture memory artifact with all seven entry kinds', () => {
    expect(() => assertValidArchitectureMemory(golden)).not.toThrow();
    expect(validateArchitectureMemory(golden)).toBe(true);
    expect(golden.envelope.id).toMatch(/^sos:\/\/ArchitectureMemory\/[0-9a-f]{32}$/);
    expect(golden.content.entries.map((entry) => entry.entry_kind).sort()).toEqual([
      'FAILURE',
      'LEARNED_RULE',
      'LIABILITY',
      'OBSERVATION',
      'OUTCOME',
      'PREDICTION',
      'ROLLBACK',
    ]);
  });

  it('reproduces bit-exactly from the documented golden sample input', () => {
    const reproduced = createArchitectureMemory({
      content: sampleMemoryContent(),
      provenance: GOLDEN_PROVENANCE,
      created_at: T0,
    });
    expect(reproduced).toEqual(golden);
    expect(reproduced.envelope.id).toBe(golden.envelope.id);
    expect(canonicalSerialize(reproduced)).toBe(canonicalSerialize(golden));
  });

  it('references only Evidence-kind spine ids', () => {
    for (const ref of memoryEvidenceRefs(golden.content)) {
      expect(ref).toMatch(/^sos:\/\/Evidence\/[0-9a-f]{32}$/);
    }
    expect(memoryEvidenceRefs(golden.content).length).toBe(6);
  });
});

function readFixture(): ArchitectureMemoryArtifact {
  return JSON.parse(readFileSync(join(here, '../fixtures', 'architecture-memory.json'), 'utf8')) as ArchitectureMemoryArtifact;
}
