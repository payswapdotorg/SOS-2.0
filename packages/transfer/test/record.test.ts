/**
 * Unit tests: transfer evidence records + the target-context estimate
 * discipline (Work Order W13).
 */

import { describe, expect, it } from 'vitest';
import { createTransferRecord, deriveTargetEstimate, transferId } from '../src/index.js';
import type { RecordTransferInput } from '../src/index.js';
import {
  CALIBRATION,
  failureEvidence,
  interventionalEvidence,
  observationalEvidence,
  packageId,
} from './helpers.js';

const SOURCE = packageId('record-source');
const SOURCE_CTX = { region: 'eu', tier: 'prod' };
const TARGET_CTX = { region: 'apac', tier: 'prod' };

function transferInput(overrides: Partial<RecordTransferInput> = {}): RecordTransferInput {
  return {
    source_ref: SOURCE,
    source_context: SOURCE_CTX,
    target_context: TARGET_CTX,
    outcome: 'TRANSFER_SUCCESS',
    evidence: [observationalEvidence(SOURCE, 1)],
    provenance: ['agent:architect'],
    recorded_at: '2025-01-02T00:00:00.000Z',
    note: 'migrated to apac prod without incident',
    ...overrides,
  };
}

describe('transfer evidence records', () => {
  it('records a successful transfer between two distinct contexts', () => {
    const record = createTransferRecord(transferInput());
    expect(record.source_ref).toBe(SOURCE);
    expect(record.source_context).toEqual(SOURCE_CTX);
    expect(record.target_context).toEqual(TARGET_CTX);
    expect(record.outcome).toBe('TRANSFER_SUCCESS');
    expect(record.evidence_refs).toHaveLength(1);
    expect(record.claim_strength).toBe('CORRELATIONAL'); // the honest default
    expect(record.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is idempotent for identical content (evidence citation order irrelevant)', () => {
    const e1 = observationalEvidence(SOURCE, 1);
    const e2 = observationalEvidence(SOURCE, 2);
    const one = createTransferRecord(transferInput({ evidence: [e1, e2] }));
    const two = createTransferRecord(transferInput({ evidence: [e2, e1] }));
    expect(one).toEqual(two);
    expect(transferId(transferInput({ evidence: [e1, e2] }))).toBe(
      transferId(transferInput({ evidence: [e2, e1] })),
    );
  });

  it('records failed transfers as first-class negative evidence', () => {
    const record = createTransferRecord(
      transferInput({ outcome: 'TRANSFER_FAILURE', evidence: [failureEvidence(SOURCE, 5)] }),
    );
    expect(record.outcome).toBe('TRANSFER_FAILURE');
  });

  it('accepts a CAUSAL claim backed by interventional SUCCESS evidence (§18 gate delegated)', () => {
    const record = createTransferRecord(
      transferInput({ evidence: [interventionalEvidence(SOURCE)], claim_strength: 'CAUSAL' }),
    );
    expect(record.claim_strength).toBe('CAUSAL');
  });

  it('derives a target-context estimate for successes (qualitative, WEAK, target-conditioned)', () => {
    const record = createTransferRecord(transferInput());
    const estimate = deriveTargetEstimate(record);
    expect(estimate).not.toBeNull();
    expect(estimate!.kind).toBe('QUALITATIVE');
    expect(estimate!.uncertainty_class).toBe('WEAK');
    expect(estimate!.context).toEqual(TARGET_CTX);
    expect(estimate!.sample_size).toBe(record.evidence_refs.length);
  });

  it('returns the declared estimate verbatim when present (still target-conditioned)', () => {
    const record = createTransferRecord(
      transferInput({
        estimate: {
          kind: 'CALIBRATED',
          probability: 0.82,
          calibration_ref: CALIBRATION,
          uncertainty_class: 'MODERATE',
          context: TARGET_CTX,
          sample_size: 9,
          window: { start: '2025-01-01T00:00:00.000Z', end: '2025-01-02T00:00:00.000Z' },
        },
      }),
    );
    const estimate = deriveTargetEstimate(record);
    expect(estimate!.kind).toBe('CALIBRATED');
    expect(estimate!.probability).toBeCloseTo(0.82);
  });

  it('derives NO default estimate for failures (they are retained as negative evidence)', () => {
    const record = createTransferRecord(
      transferInput({ outcome: 'TRANSFER_FAILURE', evidence: [failureEvidence(SOURCE, 5)] }),
    );
    expect(deriveTargetEstimate(record)).toBeNull();
  });

  it('derives NO default estimate for inconclusive transfers', () => {
    const record = createTransferRecord(transferInput({ outcome: 'TRANSFER_INCONCLUSIVE' }));
    expect(deriveTargetEstimate(record)).toBeNull();
  });

  it('accepts transfer records about compositions as sources', () => {
    const record = createTransferRecord(
      transferInput({
        source_ref: 'sos://PackageComposition/' + 'b'.repeat(32),
        evidence: [observationalEvidence('sos://PackageComposition/' + 'b'.repeat(32), 3)],
      }),
    );
    expect(record.source_ref).toBe('sos://PackageComposition/' + 'b'.repeat(32));
  });
});
