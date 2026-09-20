/**
 * Unit tests: composition interaction evidence (Work Order W13).
 */

import { describe, expect, it } from 'vitest';
import { InteractionStore } from '../src/index.js';
import type { RecordInteractionInput } from '../src/index.js';
import { compositionId, failureEvidence, makeEvidence, packageId } from './helpers.js';

const COMP = compositionId('interaction-comp');
const OTHER = compositionId('interaction-other');
const MEMBER = packageId('interaction-member');

function synergyInput(overrides: Partial<RecordInteractionInput> = {}): RecordInteractionInput {
  return {
    composition_id: COMP,
    outcome: 'SYNERGY',
    evidence: [makeEvidence(COMP, 0)],
    provenance: ['agent:architect'],
    note: 'latency improved beyond the sum of parts',
    recorded_at: '2025-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('InteractionStore — composition interaction evidence', () => {
  it('records a synergy interaction with the composition\'s own evidence', () => {
    const store = new InteractionStore();
    const record = store.record(synergyInput());
    expect(record.composition_id).toBe(COMP);
    expect(record.outcome).toBe('SYNERGY');
    expect(record.evidence_refs).toHaveLength(1);
    expect(record.evidence_refs[0]).toMatch(/^sos:\/\/Evidence\//);
    expect(store.size).toBe(1);
    expect(store.interactionsFor(COMP)).toHaveLength(1);
  });

  it('is idempotent for identical content (evidence citation order irrelevant)', () => {
    const store = new InteractionStore();
    const e0 = makeEvidence(COMP, 0);
    const e1 = makeEvidence(COMP, 1);
    const first = store.record(synergyInput({ evidence: [e0, e1] }));
    const second = store.record(synergyInput({ evidence: [e1, e0] }));
    expect(second).toEqual(first);
    expect(store.size).toBe(1);
  });

  it('records interference outcomes backed by observed failures', () => {
    const store = new InteractionStore();
    const record = store.record(
      synergyInput({
        outcome: 'INTERFERENCE',
        evidence: [failureEvidence(COMP, 2)],
        recorded_at: '2025-01-03T00:00:00.000Z',
      }),
    );
    expect(record.outcome).toBe('INTERFERENCE');
    expect(store.interactionsWithOutcome('INTERFERENCE')).toHaveLength(1);
    expect(store.interactionsWithOutcome('SYNERGY')).toHaveLength(0);
  });

  it('records neutral outcomes with own evidence (any truth state)', () => {
    const store = new InteractionStore();
    const record = store.record(
      synergyInput({ outcome: 'NEUTRAL', evidence: [makeEvidence(COMP, 3)] }),
    );
    expect(record.outcome).toBe('NEUTRAL');
  });

  it('keeps interference (negative interaction) records alongside synergies — retention', () => {
    const store = new InteractionStore();
    store.record(synergyInput());
    store.record(
      synergyInput({
        outcome: 'INTERFERENCE',
        evidence: [failureEvidence(COMP, 2)],
        recorded_at: '2025-01-01T00:00:00.000Z',
      }),
    );
    const all = store.all();
    expect(all).toHaveLength(2);
    expect(all.some((record) => record.outcome === 'INTERFERENCE')).toBe(true);
    // per-composition view is sorted by (recorded_at, id): the earlier interference first
    const forComp = store.interactionsFor(COMP);
    expect(forComp).toHaveLength(2);
    expect(forComp[0]!.recorded_at).toBe('2025-01-01T00:00:00.000Z');
  });

  it('separates interactions by composition', () => {
    const store = new InteractionStore();
    store.record(synergyInput());
    store.record(synergyInput({ composition_id: OTHER, evidence: [makeEvidence(OTHER, 5)] }));
    expect(store.size).toBe(2);
    expect(store.interactionsFor(COMP)).toHaveLength(1);
    expect(store.interactionsFor(OTHER)).toHaveLength(1);
  });

  it('snapshots and restores canonically (round trip)', () => {
    const store = new InteractionStore();
    store.record(synergyInput());
    store.record(
      synergyInput({ outcome: 'INTERFERENCE', evidence: [failureEvidence(COMP, 2)], recorded_at: '2025-01-05T00:00:00.000Z' }),
    );
    const snapshot = store.snapshot();
    const restored = InteractionStore.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.all()).toEqual(store.all());
  });
});
