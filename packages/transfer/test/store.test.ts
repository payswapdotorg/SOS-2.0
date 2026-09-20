/**
 * Unit tests: the transfer store — negative evidence retention (Work Order
 * W13).
 */

import { describe, expect, it } from 'vitest';
import { TransferStore } from '../src/index.js';
import type { RecordInvalidatedAssumptionInput, RecordTransferInput } from '../src/index.js';
import {
  failureEvidence,
  observationalEvidence,
  packageId,
} from './helpers.js';

const SOURCE = packageId('store-source');
const OTHER = packageId('store-other');
const SOURCE_CTX = { region: 'eu', tier: 'prod' };
const TARGET_CTX = { region: 'apac', tier: 'prod' };
const OTHER_TARGET = { region: 'us', tier: 'prod' };

function transferInput(overrides: Partial<RecordTransferInput> = {}): RecordTransferInput {
  return {
    source_ref: SOURCE,
    source_context: SOURCE_CTX,
    target_context: TARGET_CTX,
    outcome: 'TRANSFER_SUCCESS',
    evidence: [observationalEvidence(SOURCE, 1)],
    provenance: ['agent:architect'],
    recorded_at: '2025-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function assumptionInput(overrides: Partial<RecordInvalidatedAssumptionInput> = {}): RecordInvalidatedAssumptionInput {
  return {
    package_ref: SOURCE,
    assumption: 'single-region latency budget holds in every region',
    context: TARGET_CTX,
    evidence_refs: [failureEvidence(SOURCE, 5).id],
    provenance: ['agent:sre'],
    recorded_at: '2025-01-03T00:00:00.000Z',
    note: 'broke in apac: cross-region replication latency',
    ...overrides,
  };
}

describe('TransferStore — retention of negative evidence', () => {
  it('records successes AND failures; per-source queries return both', () => {
    const store = new TransferStore();
    store.recordTransfer(transferInput());
    store.recordTransfer(
      transferInput({
        outcome: 'TRANSFER_FAILURE',
        evidence: [failureEvidence(SOURCE, 5)],
        recorded_at: '2025-01-04T00:00:00.000Z',
      }),
    );
    const forSource = store.transfersFor(SOURCE);
    expect(forSource).toHaveLength(2);
    expect(forSource.some((record) => record.outcome === 'TRANSFER_FAILURE')).toBe(true);
    expect(store.failedTransfersFor(SOURCE)).toHaveLength(1);
  });

  it('exposes contexts-of-failure through failuresInContext', () => {
    const store = new TransferStore();
    store.recordTransfer(transferInput());
    store.recordTransfer(
      transferInput({
        outcome: 'TRANSFER_FAILURE',
        evidence: [failureEvidence(SOURCE, 5)],
        recorded_at: '2025-01-04T00:00:00.000Z',
      }),
    );
    store.recordTransfer(
      transferInput({
        target_context: OTHER_TARGET,
        outcome: 'TRANSFER_FAILURE',
        evidence: [failureEvidence(SOURCE, 6)],
        recorded_at: '2025-01-05T00:00:00.000Z',
      }),
    );
    const apacFailures = store.failuresInContext(TARGET_CTX);
    expect(apacFailures).toHaveLength(1);
    expect(apacFailures[0]!.target_context).toEqual(TARGET_CTX);
    const allFailures = [...store.failedTransfersFor(SOURCE)];
    expect(allFailures).toHaveLength(2);
  });

  it('answers transfersInto by target-context containment (failures included)', () => {
    const store = new TransferStore();
    store.recordTransfer(transferInput());
    store.recordTransfer(
      transferInput({
        source_ref: OTHER,
        evidence: [observationalEvidence(OTHER, 2)],
        target_context: { region: 'apac', tier: 'prod', cell: 'a' },
      }),
    );
    const intoApac = store.transfersInto({ region: 'apac' });
    expect(intoApac).toHaveLength(2); // both targets lie within region apac
    const intoUs = store.transfersInto({ region: 'us' });
    expect(intoUs).toHaveLength(0);
  });

  it('records invalidated assumptions as first-class negative evidence', () => {
    const store = new TransferStore();
    const record = store.recordInvalidatedAssumption(assumptionInput());
    expect(record.package_ref).toBe(SOURCE);
    expect(record.assumption).toContain('latency budget');
    expect(record.context).toEqual(TARGET_CTX); // the context of failure, retained verbatim
    expect(record.evidence_refs).toHaveLength(1);
    expect(store.invalidatedAssumptionsFor(SOURCE)).toHaveLength(1);
  });

  it('exposes NO removal API — negative evidence is retained structurally', () => {
    const store = new TransferStore();
    store.recordTransfer(transferInput());
    store.recordInvalidatedAssumption(assumptionInput());
    const ownMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(store)).filter((name) => name !== 'constructor');
    const removals = ownMethods.filter((name) => /remove|delete|drop|forget|purge|clear/i.test(name));
    expect(removals).toEqual([]);
    // snapshots include the negative evidence
    const snapshot = store.snapshot();
    expect(snapshot.transfers).toHaveLength(1);
    expect(snapshot.invalidated_assumptions).toHaveLength(1);
  });

  it('snapshots and restores canonically (negative evidence survives the round trip)', () => {
    const store = new TransferStore();
    store.recordTransfer(transferInput());
    store.recordTransfer(
      transferInput({
        outcome: 'TRANSFER_FAILURE',
        evidence: [failureEvidence(SOURCE, 5)],
        recorded_at: '2025-01-04T00:00:00.000Z',
      }),
    );
    store.recordInvalidatedAssumption(assumptionInput());
    const snapshot = store.snapshot();
    const restored = TransferStore.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.failedTransfersFor(SOURCE)).toHaveLength(1);
    expect(restored.invalidatedAssumptionsFor(SOURCE)).toHaveLength(1);
  });
});
