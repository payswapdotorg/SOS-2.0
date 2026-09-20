import { describe, expect, it } from 'vitest';
import { isArtifactId, parseArtifactId } from '@sos-2/semantic-spine';
import {
  architectureMemoryArtifactId,
  architectureMemoryCreationAddress,
  assertValidArchitectureMemory,
  createArchitectureMemory,
  isLlmMemoryUpdate,
  isNonAuthoritativeMemory,
  memoryEvidenceRefs,
  validateArchitectureMemory,
} from '../src/index.js';
import {
  CONSTITUTION_ANCHOR_ID,
  PROVENANCE,
  T0,
  T1,
  evidenceRecord,
  llmProducer,
  sampleEntryList,
  sampleMemoryContent,
  toolProducer,
} from './helpers.js';

describe('architecture memory creation', () => {
  it('mints a spine-valid ArchitectureMemory artifact with a deterministic id', () => {
    const artifact = createArchitectureMemory({
      content: sampleMemoryContent(),
      provenance: PROVENANCE,
      created_at: T0,
      authority_ref: CONSTITUTION_ANCHOR_ID,
    });
    expect(validateArchitectureMemory(artifact)).toBe(true);
    expect(artifact.envelope.kind).toBe('ArchitectureMemory');
    expect(isArtifactId(artifact.envelope.id)).toBe(true);
    expect(parseArtifactId(artifact.envelope.id).kind).toBe('ArchitectureMemory');
    expect(artifact.envelope.status).toBe('DRAFT');
    expect(artifact.envelope.version).toBe(1);
    expect(artifact.content.entries.length).toBe(7);
  });

  it('identical creation input reproduces the identical id (determinism)', () => {
    const input = { content: sampleMemoryContent(), provenance: PROVENANCE, created_at: T0 };
    const a = createArchitectureMemory(input);
    const b = createArchitectureMemory(JSON.parse(JSON.stringify(input)) as typeof input);
    expect(a).toEqual(b);
    expect(architectureMemoryArtifactId(input)).toBe(a.envelope.id);
    expect(architectureMemoryCreationAddress(input).content).toEqual(a.content);
  });

  it('different content produces different ids', () => {
    const a = createArchitectureMemory({ content: sampleMemoryContent(), provenance: PROVENANCE, created_at: T0 });
    const b = createArchitectureMemory({
      content: { entries: sampleEntryList().slice(0, 6), update: sampleMemoryContent().update },
      provenance: PROVENANCE,
      created_at: T0,
    });
    expect(a.envelope.id).not.toBe(b.envelope.id);
  });

  it('creation address round-trips through canonical serialization', () => {
    const input = { content: sampleMemoryContent(), provenance: PROVENANCE, created_at: T0 };
    const address = architectureMemoryCreationAddress(input);
    expect(JSON.parse(JSON.stringify(address))).toEqual(address);
  });

  it('a memory artifact survives a JSON round trip bit-exactly', () => {
    const artifact = createArchitectureMemory({ content: sampleMemoryContent(), provenance: PROVENANCE, created_at: T0 });
    const roundTripped = JSON.parse(JSON.stringify(artifact));
    expect(validateArchitectureMemory(roundTripped)).toBe(true);
    expect(roundTripped).toEqual(artifact);
  });
});

describe('update provenance', () => {
  it('the update carries producer and evidence refs', () => {
    const artifact = createArchitectureMemory({ content: sampleMemoryContent(), provenance: PROVENANCE, created_at: T0 });
    expect(artifact.content.update.producer).toEqual(toolProducer());
    expect(artifact.content.update.producer.model).toBeNull();
  });

  it('LLM-produced updates are marked and non-authoritative', () => {
    const artifact = createArchitectureMemory({
      content: {
        entries: sampleEntryList(),
        update: { producer: llmProducer(), evidence_refs: [evidenceRecord('llm-update-basis').id] },
      },
      provenance: PROVENANCE,
      created_at: T0,
    });
    expect(isLlmMemoryUpdate(artifact)).toBe(true);
    expect(isNonAuthoritativeMemory(artifact)).toBe(true);
  });

  it('tool-produced updates are not LLM-marked', () => {
    const artifact = createArchitectureMemory({ content: sampleMemoryContent(), provenance: PROVENANCE, created_at: T0 });
    expect(isLlmMemoryUpdate(artifact)).toBe(false);
    expect(isNonAuthoritativeMemory(artifact)).toBe(false);
  });

  it('memoryEvidenceRefs returns the sorted union of entry and update evidence refs', () => {
    const content = sampleMemoryContent();
    const refs = memoryEvidenceRefs(content);
    const expected = new Set<string>(content.update.evidence_refs);
    for (const entry of content.entries) {
      if (entry.entry_kind === 'PREDICTION') continue;
      if (entry.entry_kind === 'LIABILITY') {
        for (const ref of entry.resolution.resolution_evidence_refs) expected.add(ref);
        continue;
      }
      for (const ref of entry.evidence_refs) expected.add(ref);
    }
    expect(refs).toEqual([...expected].sort());
  });

  it('empty memory is valid (a fresh memory starts empty)', () => {
    const artifact = createArchitectureMemory({
      content: { entries: [], update: { producer: toolProducer(), evidence_refs: [] } },
      provenance: PROVENANCE,
      created_at: T1,
    });
    expect(() => assertValidArchitectureMemory(artifact)).not.toThrow();
    expect(artifact.content.entries).toEqual([]);
  });
});
