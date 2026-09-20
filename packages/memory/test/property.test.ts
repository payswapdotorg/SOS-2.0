import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize, isArtifactId } from '@sos-2/semantic-spine';
import {
  ArchitectureMemoryStore,
  assertValidMemoryEvolution,
  assertValidMemoryEntry,
  createArchitectureMemory,
  memoryEvidenceRefs,
  validateArchitectureMemory,
} from '../src/index.js';
import type {
  CreateArchitectureMemoryInput,
  MemoryEntry,
} from '../src/index.js';
import {
  PROVENANCE,
  T0,
  T1,
  T2,
  evidenceRecord,
  llmProducer,
  sampleEntryList,
  sampleMemoryContent,
  toolProducer,
} from './helpers.js';

const TIMESTAMPS = [T0, T1, T2] as const;

/** Random entry subsets always keep ids unique and entries VALID (evidence-bearing kinds keep their refs). */
const fcEntry: fc.Arbitrary<MemoryEntry> = fc
  .record({
    index: fc.integer({ min: 0, max: 6 }),
    llm: fc.boolean(),
    realized: fc.constantFrom<'REALIZED' | 'NOT_REALIZED' | 'UNKNOWN'>('REALIZED', 'NOT_REALIZED', 'UNKNOWN'),
  })
  .map(({ index, llm, realized }) => {
    const base = sampleEntryList()[index]!;
    const entry: MemoryEntry = structuredClone(base);
    if (entry.entry_kind === 'OUTCOME') {
      entry.realized = realized;
    }
    return entry;
  });

const fcEntries: fc.Arbitrary<MemoryEntry[]> = fc
  .uniqueArray(fcEntry, {
    minLength: 0,
    maxLength: 7,
    selector: (entry) => entry.id,
  })
  .map((entries) => {
    // Outcomes may only reference predictions present in the same set:
    const ids = new Set(entries.map((entry) => entry.id));
    return entries.map((entry) => {
      if (entry.entry_kind === 'OUTCOME') {
        const refs = entry.prediction_refs.filter((ref) => ids.has(ref));
        return { ...entry, prediction_refs: refs };
      }
      return entry;
    }) as MemoryEntry[];
  });

const fcCreateInput: fc.Arbitrary<CreateArchitectureMemoryInput> = fc
  .record({
    entries: fcEntries,
    llm: fc.boolean(),
    created_at: fc.constantFrom(...TIMESTAMPS),
  })
  .map(({ entries, llm, created_at }) => {
    const evidenceRefs = entries
      .filter((entry) => entry.entry_kind === 'OBSERVATION')
      .flatMap((entry) => (entry as { evidence_refs: string[] }).evidence_refs);
    const content = {
      entries,
      update: {
        producer: llm ? llmProducer() : toolProducer(),
        evidence_refs: evidenceRefs.length > 0 ? evidenceRefs.slice(0, 1) : [],
      },
    };
    return { content, provenance: PROVENANCE, created_at };
  });

describe('architecture memory properties (deterministic, contract-conformant)', () => {
  it('always mints valid artifacts with spine ArchitectureMemory ids', () => {
    fc.assert(
      fc.property(fcCreateInput, (input) => {
        const artifact = createArchitectureMemory(input);
        expect(validateArchitectureMemory(artifact)).toBe(true);
        expect(artifact.envelope.id).toMatch(/^sos:\/\/ArchitectureMemory\/[0-9a-f]{32}$/);
        expect(isArtifactId(artifact.envelope.id)).toBe(true);
        return true;
      }),
    );
  });

  it('is deterministic: identical inputs yield identical artifacts and ids', () => {
    fc.assert(
      fc.property(fcCreateInput, (input) => {
        const a = createArchitectureMemory(input);
        const b = createArchitectureMemory(
          JSON.parse(JSON.stringify(input)) as CreateArchitectureMemoryInput,
        );
        expect(a).toEqual(b);
        expect(a.envelope.id).toBe(b.envelope.id);
        return true;
      }),
    );
  });

  it('canonical round trips are byte-stable', () => {
    fc.assert(
      fc.property(fcCreateInput, (input) => {
        const artifact = createArchitectureMemory(input);
        const text = canonicalSerialize(artifact);
        const roundTripped = JSON.parse(text);
        expect(validateArchitectureMemory(roundTripped)).toBe(true);
        expect(canonicalSerialize(roundTripped)).toBe(text);
        return true;
      }),
    );
  });

  it('memoryEvidenceRefs is sorted, unique and stable', () => {
    fc.assert(
      fc.property(fcCreateInput, (input) => {
        const artifact = createArchitectureMemory(input);
        const refs = memoryEvidenceRefs(artifact.content);
        expect(refs).toEqual([...new Set(refs)].sort());
        expect(memoryEvidenceRefs(artifact.content)).toEqual(refs);
        return true;
      }),
    );
  });
});

describe('evolution rule properties (append-only memory)', () => {
  it('appending entries to any valid content is always a valid evolution', () => {
    fc.assert(
      fc.property(fcCreateInput, fcCreateInput, (current, next) => {
        const currentArtifact = createArchitectureMemory(current);
        const nextArtifact = createArchitectureMemory(next);
        const merged: MemoryEntry[] = [
          ...currentArtifact.content.entries,
          ...nextArtifact.content.entries.filter(
            (entry) => !currentArtifact.content.entries.some((existing) => existing.id === entry.id),
          ),
        ];
        // Re-map outcome prediction_refs to predictions present in the merged set:
        const ids = new Set(merged.map((entry) => entry.id));
        const remapped = merged.map((entry) =>
          entry.entry_kind === 'OUTCOME'
            ? { ...entry, prediction_refs: entry.prediction_refs.filter((ref) => ids.has(ref)) }
            : entry,
        ) as MemoryEntry[];
        const evolved = { entries: remapped, update: nextArtifact.content.update };
        expect(() => assertValidMemoryEvolution(currentArtifact.content, evolved)).not.toThrow();
        return true;
      }),
      { numRuns: 40 },
    );
  });

  it('dropping any single entry is always an INVALID evolution', () => {
    fc.assert(
      fc.property(
        fcCreateInput.filter((input) => input.content.entries.length > 0),
        fc.integer({ min: 0, max: 6 }),
        (input, dropIndex) => {
          const artifact = createArchitectureMemory(input);
          const index = dropIndex % artifact.content.entries.length;
          const reduced = artifact.content.entries.filter((_, i) => i !== index);
          expect(() =>
            assertValidMemoryEvolution(artifact.content, { ...artifact.content, entries: reduced }),
          ).toThrow(/deletion rejected/);
          return true;
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('entry validation properties (evidence discipline)', () => {
  it('dropping the evidence refs of any evidence-bearing entry is ALWAYS rejected', () => {
    fc.assert(
      fc.property(fc.constantFrom(...sampleEntryList()), (entry) => {
        if (
          entry.entry_kind === 'OBSERVATION' ||
          entry.entry_kind === 'OUTCOME' ||
          entry.entry_kind === 'FAILURE' ||
          entry.entry_kind === 'ROLLBACK' ||
          entry.entry_kind === 'LEARNED_RULE'
        ) {
          const stripped = { ...entry, evidence_refs: [] } as MemoryEntry;
          expect(() => assertValidMemoryEntry(stripped)).toThrow(/at least one (supporting )?evidence reference/);
        } else {
          // Predictions and liabilities carry no mandatory entry-level refs:
          expect(() => assertValidMemoryEntry(entry)).not.toThrow();
        }
        return true;
      }),
    );
  });
});

describe('store query determinism over randomized sets', () => {
  it('listings and entry queries are identical regardless of insertion order', () => {
    fc.assert(
      fc.property(
        fc.array(fcCreateInput, { minLength: 0, maxLength: 10 }),
        fc.option(fc.integer({ min: 0, max: 50 }), { nil: 7 }),
        (inputs, rotationSeed) => {
          const seen = new Set<string>();
          const artifacts: ReturnType<typeof createArchitectureMemory>[] = [];
          for (const input of inputs) {
            const artifact = createArchitectureMemory({ ...input, status: 'ACTIVE' as const });
            if (seen.has(artifact.envelope.id)) continue; // duplicate ids are rejected on put
            seen.add(artifact.envelope.id);
            artifacts.push(artifact);
          }
          const forward = new ArchitectureMemoryStore();
          for (const artifact of artifacts) forward.put(artifact);
          const rotated = new ArchitectureMemoryStore();
          const shift = rotationSeed % (artifacts.length + 1);
          for (const artifact of [...artifacts.slice(shift), ...artifacts.slice(0, shift)]) {
            rotated.put(artifact);
          }
          const forwardIds = forward.list().map((m) => m.envelope.id);
          const rotatedIds = rotated.list().map((m) => m.envelope.id);
          expect(rotatedIds).toEqual(forwardIds);
          expect(forwardIds).toEqual([...forwardIds].sort());
          for (const id of forwardIds) {
            expect(rotated.entriesOf(id)).toEqual(forward.entriesOf(id));
            expect(rotated.failuresOf(id)).toEqual(forward.failuresOf(id));
            expect(rotated.learnedRulesOf(id)).toEqual(forward.learnedRulesOf(id));
            const forwardLinks = forward.evidenceSupporting(id).map((l) => `${l.source}\u0000${l.target}`).sort();
            const rotatedLinks = rotated.evidenceSupporting(id).map((l) => `${l.source}\u0000${l.target}`).sort();
            expect(rotatedLinks).toEqual(forwardLinks);
          }
          return true;
        },
      ),
      { numRuns: 25 },
    );
  });

  it('the sample memory content is a fixed valid input (sanity inside randomization)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TIMESTAMPS), (created_at) => {
        const artifact = createArchitectureMemory({
          content: sampleMemoryContent(),
          provenance: PROVENANCE,
          created_at,
        });
        expect(artifact.content.entries.length).toBe(7);
        expect(memoryEvidenceRefs(artifact.content).length).toBeGreaterThanOrEqual(1);
        expect(evidenceRecord('sanity').id).toMatch(/^sos:\/\/Evidence\//);
        return true;
      }),
    );
  });
});
