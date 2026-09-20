import { describe, expect, it } from 'vitest';
import {
  ArchitectureMemoryStore,
  assertValidArchitectureMemory,
  assertValidMemoryEntries,
  assertValidMemoryEntry,
  createArchitectureMemory,
  validateArchitectureMemory,
} from '../src/index.js';
import type { MemoryEntry } from '../src/index.js';
import {
  CALIBRATION,
  PROVENANCE,
  SYSTEM_STATE_R1,
  T0,
  T1,
  evidenceRecord,
  llmProducer,
  sampleEntries,
  sampleEntryList,
  sampleMemoryContent,
  toolProducer,
} from './helpers.js';

describe('LIABILITY DELETION AND MUTATION REJECTED (only resolution state changes)', () => {
  it('rejects deleting a liability entry', () => {
    const store = new ArchitectureMemoryStore();
    const artifact = createArchitectureMemory({
      content: sampleMemoryContent(),
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
    });
    store.put(artifact);
    expect(() =>
      store.revise(artifact.envelope.id, {
        entries: sampleEntryList().filter((entry) => entry.entry_kind !== 'LIABILITY'),
        update: { producer: toolProducer(), evidence_refs: [] },
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/deletion rejected/);
  });

  it('rejects severity, owner-kind, statement and context mutations on a liability', () => {
    const store = new ArchitectureMemoryStore();
    const artifact = createArchitectureMemory({
      content: sampleMemoryContent(),
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
    });
    store.put(artifact);
    const entries = sampleEntryList();
    const base = entries[4]!;
    for (const mutation of [
      { ...base, severity: 'CRITICAL' as const },
      { ...base, owner_kind: 'GOVERNANCE' as const },
      { ...base, statement: 'Rewritten liability.' },
      { ...base, context: { environment: 'staging' } },
    ]) {
      expect(() =>
        store.revise(artifact.envelope.id, {
          entries: [...entries.slice(0, 4), mutation, ...entries.slice(5)],
          update: { producer: toolProducer(), evidence_refs: [] },
          provenance: PROVENANCE,
          created_at: T1,
        }),
      ).toThrow(/liability mutation rejected/);
    }
  });

  it('rejects terminal-state reversals (RESOLVED -> OPEN)', () => {
    const s = sampleEntries();
    const resolved = {
      ...s.liability,
      resolution: {
        state: 'RESOLVED' as const,
        note: 'done',
        resolved_at: T1,
        resolution_evidence_refs: [evidenceRecord('liab-res').id],
      },
    };
    const reopened = { ...s.liability, resolution: { state: 'OPEN' as const, note: null, resolved_at: null, resolution_evidence_refs: [] } };
    const content = {
      entries: [...sampleEntryList().slice(0, 4), resolved, ...sampleEntryList().slice(5)],
      update: { producer: toolProducer(), evidence_refs: [] },
    };
    const store = new ArchitectureMemoryStore();
    const artifact = createArchitectureMemory({ content, provenance: PROVENANCE, created_at: T0, status: 'ACTIVE' });
    store.put(artifact);
    expect(() =>
      store.revise(artifact.envelope.id, {
        entries: [...content.entries.slice(0, 4), reopened, ...content.entries.slice(5)],
        update: { producer: toolProducer(), evidence_refs: [] },
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/invalid liability resolution transition/);
  });
});

describe('FAILURE MEMORY RETAINED (never dropped, never rewritten)', () => {
  it('rejects dropping a failure entry', () => {
    const store = new ArchitectureMemoryStore();
    const artifact = createArchitectureMemory({
      content: sampleMemoryContent(),
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
    });
    store.put(artifact);
    expect(() =>
      store.revise(artifact.envelope.id, {
        entries: sampleEntryList().filter((entry) => entry.entry_kind !== 'FAILURE'),
        update: { producer: toolProducer(), evidence_refs: [] },
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/deletion rejected/);
  });

  it('rejects rewriting or context-stripping a failure entry', () => {
    const store = new ArchitectureMemoryStore();
    const artifact = createArchitectureMemory({
      content: sampleMemoryContent(),
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
    });
    store.put(artifact);
    const entries = sampleEntryList();
    const failure = entries[3]!;
    const rewritten = { ...failure, statement: 'A different failure.' };
    const contextStripped = { ...failure, context: { environment: 'staging' } };
    for (const mutation of [rewritten, contextStripped]) {
      expect(() =>
        store.revise(artifact.envelope.id, {
          entries: [...entries.slice(0, 3), mutation, ...entries.slice(4)],
          update: { producer: toolProducer(), evidence_refs: [] },
          provenance: PROVENANCE,
          created_at: T1,
        }),
      ).toThrow(/mutation rejected/);
    }
  });

  it('rejects a failure entry without a context at creation', () => {
    const s = sampleEntries();
    expect(() => assertValidMemoryEntry({ ...s.failure, context: null })).toThrow(/failure context/);
    expect(() => assertValidMemoryEntry({ ...s.failure, context: {} })).toThrow(/failure context/);
  });
});

describe('MEMORY UPDATE WITHOUT PROVENANCE REJECTED', () => {
  it('rejects empty envelope provenance (spine discipline)', () => {
    expect(() =>
      createArchitectureMemory({
        content: sampleMemoryContent(),
        provenance: [],
        created_at: T0,
      }),
    ).toThrow(/provenance/);
  });

  it('rejects a missing or invalid update producer', () => {
    const content = sampleMemoryContent();
    expect(() =>
      createArchitectureMemory({
        content: { ...content, update: { ...content.update, producer: { ...toolProducer(), tool: '' } } },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/producer is invalid/);
    expect(() =>
      createArchitectureMemory({
        content: { ...content, update: { ...content.update, producer: 'vitest' as never } },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/producer/);
  });

  it('rejects update evidence_refs that are not Evidence artifact ids', () => {
    const content = sampleMemoryContent();
    expect(() =>
      createArchitectureMemory({
        content: { ...content, update: { ...content.update, evidence_refs: ['not-a-sos-id'] } },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/well-formed spine artifact id/);
    expect(() =>
      createArchitectureMemory({
        content: { ...content, update: { ...content.update, evidence_refs: [SYSTEM_STATE_R1] } },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/must reference Evidence artifacts/);
  });

  it('rejects revision inputs without provenance', () => {
    const store = new ArchitectureMemoryStore();
    const artifact = createArchitectureMemory({
      content: sampleMemoryContent(),
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
    });
    store.put(artifact);
    expect(() =>
      store.revise(artifact.envelope.id, {
        entries: sampleEntryList(),
        update: { producer: toolProducer(), evidence_refs: [] },
        provenance: [],
        created_at: T1,
      }),
    ).toThrow(/provenance/);
    expect(() =>
      store.revise(artifact.envelope.id, {
        entries: sampleEntryList(),
        update: { producer: toolProducer(), evidence_refs: [] },
        provenance: ['ok', ''],
        created_at: T1,
      }),
    ).toThrow(/provenance/);
  });
});

describe('LEARNED RULES REQUIRE EVIDENCE AND APPLICABILITY', () => {
  it('rejects learned rules without evidence refs', () => {
    const s = sampleEntries();
    expect(() => assertValidMemoryEntry({ ...s.learnedRule, evidence_refs: [] })).toThrow(
      /at least one supporting evidence reference/,
    );
  });

  it('rejects learned rules without applicability context (silent universal rules rejected)', () => {
    const s = sampleEntries();
    expect(() => assertValidMemoryEntry({ ...s.learnedRule, applicability: {} })).toThrow(/applicability/);
    expect(() => assertValidMemoryEntry({ ...s.learnedRule, applicability: null as never })).toThrow(/applicability/);
  });

  it('rejects learned rules with malformed evidence refs', () => {
    const s = sampleEntries();
    expect(() => assertValidMemoryEntry({ ...s.learnedRule, evidence_refs: ['rule:basis:v1'] })).toThrow(
      /well-formed spine artifact id/,
    );
  });

  it('rejects numeric confidence without calibration (uncertainty discipline)', () => {
    const s = sampleEntries();
    expect(() =>
      assertValidMemoryEntry({ ...s.learnedRule, uncertainty: { kind: 'CALIBRATED', value: 0.9 } as never }),
    ).toThrow(/uncertainty is invalid/);
    expect(() =>
      assertValidMemoryEntry({
        ...s.learnedRule,
        uncertainty: { kind: 'CALIBRATED', value: 0.9, calibration_ref: 'calibration:v1' },
      }),
    ).toThrow(/calibration artifact id/);
    expect(() =>
      assertValidMemoryEntry({
        ...s.learnedRule,
        uncertainty: { kind: 'CALIBRATED', value: 2, calibration_ref: CALIBRATION },
      }),
    ).toThrow(/\[0, 1\]/);
  });

  it('rejects LLM-produced updates attaching calibrated confidence to learned rules', () => {
    const s = sampleEntries();
    const content = {
      entries: [
        ...sampleEntryList().slice(0, 6),
        { ...s.learnedRule, uncertainty: { kind: 'CALIBRATED' as const, value: 0.9, calibration_ref: CALIBRATION } },
      ],
      update: { producer: llmProducer(), evidence_refs: [evidenceRecord('llm-rule-basis').id] },
    };
    expect(() => createArchitectureMemory({ content, provenance: PROVENANCE, created_at: T0 })).toThrow(/LLM/);
  });
});

describe('entry-level validation (negative)', () => {
  it('rejects unknown entry kinds', () => {
    expect(() => assertValidMemoryEntry({ entry_kind: 'NOTE', id: 'x', recorded_at: T0 })).toThrow(
      /memory entry kind/,
    );
  });

  it('rejects malformed ids and timestamps', () => {
    const s = sampleEntries();
    expect(() => assertValidMemoryEntry({ ...s.observation, id: '' })).toThrow(/non-empty/);
    expect(() => assertValidMemoryEntry({ ...s.observation, recorded_at: '2025-01-02' })).toThrow(/RFC3339/);
  });

  it('rejects evidence-less observations, outcomes, failures and rollbacks', () => {
    const s = sampleEntries();
    expect(() => assertValidMemoryEntry({ ...s.observation, evidence_refs: [] })).toThrow(/at least one evidence/);
    expect(() => assertValidMemoryEntry({ ...s.outcome, evidence_refs: [] })).toThrow(/at least one evidence/);
    expect(() => assertValidMemoryEntry({ ...s.failure, evidence_refs: [] })).toThrow(/at least one evidence/);
    expect(() => assertValidMemoryEntry({ ...s.rollback, evidence_refs: [] })).toThrow(/at least one evidence/);
  });

  it('rejects unknown realization verdicts', () => {
    const s = sampleEntries();
    expect(() => assertValidMemoryEntry({ ...s.outcome, realized: 'SORTA' as never })).toThrow(/realized/);
  });

  it('rejects malformed prediction hypothesis refs', () => {
    const s = sampleEntries();
    expect(() => assertValidMemoryEntry({ ...s.prediction, hypothesis_ref: 'hypothesis:h1' })).toThrow(
      /hypothesis_ref/,
    );
    expect(() => assertValidMemoryEntry({ ...s.prediction, hypothesis_ref: SYSTEM_STATE_R1 })).toThrow(
      /must reference a CausalHypothesis/,
    );
  });

  it('rejects malformed rollback revisions and reasons', () => {
    const s = sampleEntries();
    expect(() => assertValidMemoryEntry({ ...s.rollback, from_revision: '' })).toThrow(/from_revision/);
    expect(() => assertValidMemoryEntry({ ...s.rollback, reason: '' })).toThrow(/reason/);
  });

  it('rejects malformed liability fields', () => {
    const s = sampleEntries();
    expect(() => assertValidMemoryEntry({ ...s.liability, severity: 'CATASTROPHIC' as never })).toThrow(/severity/);
    expect(() => assertValidMemoryEntry({ ...s.liability, owner_kind: 'NOBODY' as never })).toThrow(/owner_kind/);
  });

  it('rejects duplicate entry ids in one content', () => {
    const s = sampleEntries();
    const entries: MemoryEntry[] = [s.observation, { ...s.prediction, id: s.observation.id }];
    expect(() => assertValidMemoryEntries(entries)).toThrow(/duplicate memory entry id/);
  });

  it('rejects non-object and missing-field content', () => {
    expect(() => assertValidMemoryEntry(null)).toThrow(/object/);
    expect(() => assertValidMemoryEntry('x' as never)).toThrow(/object/);
  });
});

describe('artifact-level validation (negative)', () => {
  it('rejects artifacts with wrong shape, envelope kind or missing fields', () => {
    const artifact = createArchitectureMemory({
      content: sampleMemoryContent(),
      provenance: PROVENANCE,
      created_at: T0,
    });
    expect(() => assertValidArchitectureMemory({ envelope: artifact.envelope })).toThrow(/exact fields/);
    expect(() => assertValidArchitectureMemory({ envelope: { ...artifact.envelope, kind: 'Mission' }, content: artifact.content })).toThrow(
      /ArchitectureMemory/,
    );
    expect(() =>
      assertValidArchitectureMemory({
        envelope: artifact.envelope,
        content: { entries: artifact.content.entries } as never,
      }),
    ).toThrow(/exact fields|update/);
    expect(validateArchitectureMemory({ envelope: artifact.envelope, content: artifact.content })).toBe(true);
  });
});
