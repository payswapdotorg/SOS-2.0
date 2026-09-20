import { describe, expect, it } from 'vitest';
import {
  ArchitectureMemoryStore,
  assertValidMemoryEvolution,
  createArchitectureMemory,
} from '../src/index.js';
import type { LiabilityEntry } from '../src/index.js';
import {
  PROVENANCE,
  T0,
  T1,
  T2,
  T3,
  evidenceRecord,
  sampleEntries,
  sampleEntryList,
  sampleMemoryContent,
  toolProducer,
} from './helpers.js';

function openMemory(): { store: ArchitectureMemoryStore; id: string } {
  const store = new ArchitectureMemoryStore();
  const artifact = createArchitectureMemory({
    content: sampleMemoryContent(),
    provenance: PROVENANCE,
    created_at: T0,
    status: 'ACTIVE',
  });
  store.put(artifact);
  return { store, id: artifact.envelope.id };
}

function nextUpdate() {
  return { producer: toolProducer(), evidence_refs: [evidenceRecord('update-next').id] };
}

describe('ArchitectureMemoryStore put/get/list', () => {
  it('stores and retrieves the seven-kind sample memory', () => {
    const { store, id } = openMemory();
    const memory = store.get(id)!;
    expect(memory.content.entries.length).toBe(7);
    expect(store.has(id)).toBe(true);
    expect(store.size).toBe(1);
    expect(store.get('sos://ArchitectureMemory/00000000000000000000000000000000')).toBeUndefined();
  });

  it('minted SUPPORTS links trace every distinct evidence reference to the memory version', () => {
    const { store, id } = openMemory();
    const supporting = store.evidenceSupporting(id);
    // 5 evidence-bearing entries (prediction carries none; the OPEN liability
    // carries no resolution evidence) + the update ref = 6 distinct records:
    expect(supporting.length).toBe(6);
    expect(supporting.every((link) => link.type === 'SUPPORTS')).toBe(true);
  });

  it('listings are sorted by id regardless of insertion order', () => {
    const store = new ArchitectureMemoryStore();
    const a = createArchitectureMemory({ content: sampleMemoryContent(), provenance: PROVENANCE, created_at: T0 });
    const b = createArchitectureMemory({
      content: { entries: sampleEntryList().slice(0, 3), update: nextUpdate() },
      provenance: PROVENANCE,
      created_at: T1,
    });
    store.put(b);
    store.put(a);
    const listed = store.list().map((m) => m.envelope.id);
    expect(listed).toEqual([...listed].sort());
  });

  it('entry queries are deterministic and sorted by entry id', () => {
    const { store, id } = openMemory();
    expect(store.entriesOf(id).map((e) => e.id)).toEqual([...sampleEntryList()].map((e) => e.id).sort());
    expect(store.failuresOf(id).map((e) => e.id)).toEqual(['fail-cache-stampede']);
    expect(store.liabilitiesOf(id).map((e) => e.id)).toEqual(['liab-cache-invalidation']);
    expect(store.learnedRulesOf(id).map((e) => e.id)).toEqual(['rule-warm-cache-rollout']);
    expect(store.liabilitiesOf(id, { state: 'OPEN' }).length).toBe(1);
    expect(store.liabilitiesOf(id, { state: 'RESOLVED' }).length).toBe(0);
    expect(store.entriesOf(id, 'PREDICTION').map((e) => e.id)).toEqual(['pred-p99-drop']);
  });
});

describe('the evolution rule (append-only memory)', () => {
  it('appending new entries is allowed', () => {
    const { store, id } = openMemory();
    const s = sampleEntries();
    const { revised } = store.revise(id, {
      entries: [
        ...sampleEntryList(),
        {
          ...s.observation,
          id: 'obs-second-window',
          evidence_refs: [evidenceRecord('obs-second-window').id],
        },
      ],
      update: nextUpdate(),
      provenance: PROVENANCE,
      created_at: T1,
    });
    expect(revised.envelope.version).toBe(2);
    expect(revised.content.entries.length).toBe(8);
    expect(store.failuresOf(revised.envelope.id).length).toBe(1);
  });

  it('dropping an entry is rejected (memory never forgets)', () => {
    const { store, id } = openMemory();
    expect(() =>
      store.revise(id, {
        entries: sampleEntryList().slice(0, 6),
        update: nextUpdate(),
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/deletion rejected/);
  });

  it('dropping a LIABILITY is rejected', () => {
    const { store, id } = openMemory();
    const withoutLiability = sampleEntryList().filter((entry) => entry.entry_kind !== 'LIABILITY');
    expect(() =>
      store.revise(id, {
        entries: withoutLiability,
        update: nextUpdate(),
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/deletion rejected/);
    // The store is unchanged by the failed revision:
    expect(store.size).toBe(1);
    expect(store.liabilitiesOf(id).length).toBe(1);
  });

  it('mutating a liability statement/severity/owner-kind is rejected (only resolution may change)', () => {
    const { store, id } = openMemory();
    const entries = sampleEntryList();
    const mutated: LiabilityEntry = { ...(entries[4] as LiabilityEntry), severity: 'LOW' };
    expect(() =>
      store.revise(id, {
        entries: [...entries.slice(0, 4), mutated, ...entries.slice(5)],
        update: nextUpdate(),
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/liability mutation rejected/);

    const mutatedStatement: LiabilityEntry = {
      ...(entries[4] as LiabilityEntry),
      statement: 'Actually this is fine.',
    };
    expect(() =>
      store.revise(id, {
        entries: [...entries.slice(0, 4), mutatedStatement, ...entries.slice(5)],
        update: nextUpdate(),
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/liability mutation rejected/);

    const mutatedOwner: LiabilityEntry = { ...(entries[4] as LiabilityEntry), owner_kind: 'SERVICE' };
    expect(() =>
      store.revise(id, {
        entries: [...entries.slice(0, 4), mutatedOwner, ...entries.slice(5)],
        update: nextUpdate(),
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/liability mutation rejected/);
  });

  it('resolving a liability through valid transitions is allowed (the ONLY liability change)', () => {
    const { store, id } = openMemory();
    const entries = sampleEntryList();
    const evidence = [evidenceRecord('liab-resolution').id];

    // OPEN -> ACKNOWLEDGED (no evidence needed):
    const acknowledged: LiabilityEntry = {
      ...(entries[4] as LiabilityEntry),
      resolution: { state: 'ACKNOWLEDGED', note: 'tracked in LIAB-7', resolved_at: null, resolution_evidence_refs: [] },
    };
    const { revised: v2 } = store.revise(id, {
      entries: [...entries.slice(0, 4), acknowledged, ...entries.slice(5)],
      update: nextUpdate(),
      provenance: PROVENANCE,
      created_at: T1,
    });

    // ACKNOWLEDGED -> MITIGATED (evidence required and present):
    const mitigated: LiabilityEntry = {
      ...acknowledged,
      resolution: { state: 'MITIGATED', note: 'automated invalidation shipped', resolved_at: T2, resolution_evidence_refs: evidence },
    };
    const { revised: v3 } = store.revise(v2.envelope.id, {
      entries: [...v2.content.entries.slice(0, 4), mitigated, ...v2.content.entries.slice(5)],
      update: nextUpdate(),
      provenance: PROVENANCE,
      created_at: T2,
    });

    // MITIGATED -> RESOLVED (evidence + timestamp required and present):
    const resolved: LiabilityEntry = {
      ...mitigated,
      resolution: { state: 'RESOLVED', note: 'verified over two weeks', resolved_at: T3, resolution_evidence_refs: evidence },
    };
    const { revised: v4 } = store.revise(v3.envelope.id, {
      entries: [...v3.content.entries.slice(0, 4), resolved, ...v3.content.entries.slice(5)],
      update: nextUpdate(),
      provenance: PROVENANCE,
      created_at: T3,
    });

    expect(store.liabilitiesOf(v4.envelope.id, { state: 'RESOLVED' }).length).toBe(1);
    // History retains every version — the OPEN original is still queryable:
    const history = store.history(v4.envelope.id);
    expect(history.map((m) => m.envelope.version)).toEqual([1, 2, 3, 4]);
    expect(store.liabilitiesOf(history[0]!.envelope.id, { state: 'OPEN' }).length).toBe(1);
  });

  it('invalid liability resolution transitions are rejected (backwards / terminal reversal)', () => {
    const { store, id } = openMemory();
    const entries = sampleEntryList();
    // Step 1: OPEN -> ACKNOWLEDGED is valid:
    const acknowledged: LiabilityEntry = {
      ...(entries[4] as LiabilityEntry),
      resolution: { state: 'ACKNOWLEDGED', note: 'tracked in LIAB-7', resolved_at: null, resolution_evidence_refs: [] },
    };
    const { revised: v2 } = store.revise(id, {
      entries: [...entries.slice(0, 4), acknowledged, ...entries.slice(5)],
      update: nextUpdate(),
      provenance: PROVENANCE,
      created_at: T1,
    });
    // Step 2: ACKNOWLEDGED -> OPEN (backwards) is invalid:
    const backwards: LiabilityEntry = {
      ...(entries[4] as LiabilityEntry),
      resolution: { state: 'OPEN', note: null, resolved_at: null, resolution_evidence_refs: [] },
    };
    expect(() =>
      store.revise(v2.envelope.id, {
        entries: [...v2.content.entries.slice(0, 4), backwards, ...v2.content.entries.slice(5)],
        update: nextUpdate(),
        provenance: PROVENANCE,
        created_at: T2,
      }),
    ).toThrow(/invalid liability resolution transition/);
  });

  it('mutating a FAILURE (or its context) is rejected — failure contexts are retained verbatim', () => {
    const { store, id } = openMemory();
    const entries = sampleEntryList();
    const rewritten = {
      ...(entries[3] as (typeof entries)[number]),
      statement: 'Never happened.',
    };
    expect(() =>
      store.revise(id, {
        entries: [...entries.slice(0, 3), rewritten, ...entries.slice(4)],
        update: nextUpdate(),
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/mutation rejected/);
  });

  it('mutating a non-liability, non-failure entry is rejected too (append new entries instead)', () => {
    const { store, id } = openMemory();
    const entries = sampleEntryList();
    const editedObservation = { ...(entries[1] as (typeof entries)[number]), statement: 'Edited after the fact.' };
    expect(() =>
      store.revise(id, {
        entries: [entries[0]!, editedObservation, ...entries.slice(2)],
        update: nextUpdate(),
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/mutation rejected/);
  });

  it('assertValidMemoryEvolution is exported and pure', () => {
    const oldContent = sampleMemoryContent();
    expect(() => assertValidMemoryEvolution(oldContent, oldContent)).not.toThrow();
    expect(() =>
      assertValidMemoryEvolution(oldContent, { ...oldContent, entries: oldContent.entries.slice(1) }),
    ).toThrow(/deletion rejected/);
  });
});

describe('revision and history discipline', () => {
  it('revising a DRAFT memory is rejected (ACTIVE-only revision)', () => {
    const store = new ArchitectureMemoryStore();
    const draft = createArchitectureMemory({ content: sampleMemoryContent(), provenance: PROVENANCE, created_at: T0 });
    store.put(draft);
    expect(() =>
      store.revise(draft.envelope.id, {
        entries: sampleEntryList(),
        update: nextUpdate(),
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/only ACTIVE/);
  });

  it('history is complete, contiguous and version-ordered', () => {
    const { store, id } = openMemory();
    let head = id;
    for (const created_at of [T1, T2, T3]) {
      head = store.revise(head, {
        entries: sampleEntryList(),
        update: nextUpdate(),
        provenance: PROVENANCE,
        created_at,
      }).revised.envelope.id;
    }
    const history = store.history(head);
    expect(history.map((m) => m.envelope.version)).toEqual([1, 2, 3, 4]);
    expect(history.map((m) => m.envelope.status)).toEqual(['SUPERSEDED', 'SUPERSEDED', 'SUPERSEDED', 'ACTIVE']);
    expect(store.active().map((m) => m.envelope.id)).toEqual([head]);
    expect(store.allLinks().filter((l) => l.type === 'DERIVED_FROM').length).toBe(3);
  });

  it('version skips in direct continuation puts are rejected', () => {
    const { store, id } = openMemory();
    const current = store.get(id)!;
    const skip = createArchitectureMemory({
      content: sampleMemoryContent(),
      provenance: PROVENANCE,
      created_at: T1,
      status: 'ACTIVE',
      version: 3,
      supersedes: current.envelope.id,
    });
    expect(() => store.put(skip)).toThrow(/exactly previous.version \+ 1/);
  });
});
