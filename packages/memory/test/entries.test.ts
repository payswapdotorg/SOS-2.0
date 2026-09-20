import { describe, expect, it } from 'vitest';
import {
  assertValidMemoryEntries,
  assertValidMemoryEntry,
  isMemoryEntryKind,
  isOutcomeRealization,
  validateMemoryEntries,
  validateMemoryEntry,
} from '../src/index.js';
import { evidenceRecord, sampleEntryList, sampleEntries } from './helpers.js';

describe('memory entry validation', () => {
  it('accepts the seven sample entries (one per kind)', () => {
    for (const entry of sampleEntryList()) {
      expect(() => assertValidMemoryEntry(entry)).not.toThrow();
      expect(validateMemoryEntry(entry)).toBe(true);
    }
    expect(() => assertValidMemoryEntries(sampleEntryList())).not.toThrow();
    expect(validateMemoryEntries(sampleEntryList())).toBe(true);
  });

  it('structural checks recognize the frozen vocabularies', () => {
    expect(isMemoryEntryKind('PREDICTION')).toBe(true);
    expect(isMemoryEntryKind('NOTE')).toBe(false);
    expect(isOutcomeRealization('REALIZED')).toBe(true);
    expect(isOutcomeRealization('SORTA')).toBe(false);
  });

  it('outcome prediction_refs must reference PREDICTION entries in the same content', () => {
    const entries = sampleEntryList();
    const s = sampleEntries();
    // Unknown reference:
    expect(() =>
      assertValidMemoryEntries([
        ...entries,
        { ...s.outcome, id: 'outcome-orphan', prediction_refs: ['pred-does-not-exist'] },
      ]),
    ).toThrow(/unknown prediction entry id/);
    // Wrong kind:
    expect(() =>
      assertValidMemoryEntries([{ ...s.outcome, id: 'outcome-wrong-kind', prediction_refs: ['obs-p99-baseline'] }, s.observation]),
    ).toThrow(/must reference PREDICTION entries/);
  });

  it('entry ids share one namespace across kinds (duplicates rejected)', () => {
    const entries = sampleEntryList();
    expect(() => assertValidMemoryEntries([...entries, { ...sampleEntries().rollback, id: 'pred-p99-drop' }])).toThrow(
      /duplicate memory entry id/,
    );
  });

  it('recorded_at must be RFC3339', () => {
    const s = sampleEntries();
    expect(() => assertValidMemoryEntry({ ...s.observation, recorded_at: '2025-01-02' })).toThrow(/RFC3339/);
  });

  it('evidence refs must be Evidence-kind spine ids', () => {
    const s = sampleEntries();
    expect(() => assertValidMemoryEntry({ ...s.observation, evidence_refs: ['telemetry:otel:checkout'] })).toThrow(
      /well-formed spine artifact id/,
    );
    expect(() => assertValidMemoryEntry({ ...s.observation, evidence_refs: [SYSTEM_STATE_PLACEHOLDER()] })).toThrow(
      /must reference Evidence artifacts/,
    );
  });

  it('a valid new outcome may reference the sample prediction', () => {
    const s = sampleEntries();
    const extra = {
      ...s.outcome,
      id: 'outcome-second-window',
      recorded_at: s.outcome.recorded_at,
      evidence_refs: [evidenceRecord('obs-second-window').id],
      realized: 'UNKNOWN' as const,
      statement: 'p99 latency in the second window is still being analyzed.',
    };
    expect(() => assertValidMemoryEntries([...sampleEntryList(), extra])).not.toThrow();
  });
});

function SYSTEM_STATE_PLACEHOLDER(): string {
  // A well-formed spine id that is NOT an Evidence id (used for the
  // "must reference Evidence artifacts" negative case).
  return evidenceRecord('kind-check').subject_ref;
}
