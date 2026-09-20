/**
 * Negative tests: everything the transfer layer REJECTS loudly (Work Order
 * W13 acceptance pinned here: transfer updating source applicability
 * REJECTED; missing provenance REJECTED; numeric transfer probability
 * without calibration REJECTED).
 */

import { describe, expect, it } from 'vitest';
import { TransferError } from '../src/index.js';
import { TransferStore, generalizePackage, specializePackage } from '../src/index.js';
import type { LineageOperationInput, RecordTransferInput } from '../src/index.js';
import { assertValidPackageArtifact } from '@sos-2/packages';
import {
  CALIBRATION,
  basePackageArtifact,
  failureEvidence,
  observationalEvidence,
  packageId,
  T1,
} from './helpers.js';

const SOURCE = packageId('neg-source');
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
    ...overrides,
  };
}

function lineageInput(overrides: Partial<LineageOperationInput> = {}): LineageOperationInput {
  const base = basePackageArtifact();
  return {
    base,
    context: { region: 'eu', tier: 'prod', scale: 'large' },
    evidence_refs: [observationalEvidence(base.envelope.id, 7).id],
    provenance: ['agent:architect'],
    created_at: T1,
    changes: 'specialized for large-scale eu prod deployments',
    ...overrides,
  };
}

describe('transfer negative discipline', () => {
  it('REJECTS a transfer estimate conditioned on the SOURCE context (source applicability is never updated)', () => {
    const store = new TransferStore();
    const input = transferInput({
      estimate: {
        kind: 'QUALITATIVE',
        uncertainty_class: 'MODERATE',
        context: SOURCE_CTX, // the source context — the forbidden update
        sample_size: 3,
        window: null,
      },
    });
    expect(() => store.recordTransfer(input)).toThrow(TransferError);
    expect(() => store.recordTransfer(input)).toThrow(/NEVER update the source package's applicability/);
    expect(store.size).toBe(0);
  });

  it('REJECTS estimates conditioned outside the target context entirely', () => {
    expect(() =>
      TransferStore.prototype.recordTransfer.call(new TransferStore(), {
        ...transferInput(),
        estimate: {
          kind: 'QUALITATIVE',
          uncertainty_class: 'MODERATE',
          context: { region: 'us' }, // neither source nor within target
          sample_size: 3,
          window: null,
        },
      } as RecordTransferInput),
    ).toThrow(/conditioned within the target context/);
  });

  it('REJECTS a numeric transfer probability without calibration (§12)', () => {
    const store = new TransferStore();
    const uncalibrated = transferInput({
      estimate: {
        // CALIBRATED numeric probability with a MISSING calibration ref
        kind: 'CALIBRATED',
        probability: 0.9,
        calibration_ref: 'not-an-id',
        uncertainty_class: 'MODERATE',
        context: TARGET_CTX,
        sample_size: 5,
        window: { start: '2025-01-01T00:00:00.000Z', end: '2025-01-02T00:00:00.000Z' },
      },
    });
    expect(() => store.recordTransfer(uncalibrated)).toThrow(TransferError);
    expect(() => store.recordTransfer(uncalibrated)).toThrow(/calibration/);
    expect(store.size).toBe(0);
  });

  it('REJECTS transfers to the same context (not a transfer)', () => {
    const store = new TransferStore();
    expect(() => store.recordTransfer(transferInput({ target_context: SOURCE_CTX }))).toThrow(/not a transfer/);
  });

  it('REJECTS transfers with empty or universal contexts', () => {
    const store = new TransferStore();
    expect(() =>
      store.recordTransfer(transferInput({ source_context: {} as never })),
    ).toThrow(/source_context is invalid/);
    expect(() =>
      store.recordTransfer(transferInput({ target_context: {} as never })),
    ).toThrow(/target_context is invalid/);
  });

  it('REJECTS evidence-free transfer records and missing provenance', () => {
    const store = new TransferStore();
    expect(() => store.recordTransfer(transferInput({ evidence: [] }))).toThrow(/NON-EMPTY/);
    expect(() => store.recordTransfer(transferInput({ provenance: [] }))).toThrow(/provenance/);
  });

  it('REJECTS a CAUSAL transfer claim backed only by observational evidence (§18)', () => {
    const store = new TransferStore();
    const input = transferInput({ claim_strength: 'CAUSAL' }); // observational evidence only
    expect(() => store.recordTransfer(input)).toThrow(TransferError);
    expect(() => store.recordTransfer(input)).toThrow(/requires intervention evidence/);
  });

  it('REJECTS transfer records about non-population sources', () => {
    const store = new TransferStore();
    const evidenceId = 'sos://Evidence/' + 'c'.repeat(32);
    expect(() =>
      store.recordTransfer(
        transferInput({ source_ref: evidenceId, evidence: [{ ...observationalEvidence(SOURCE, 9), subject_ref: evidenceId }] }),
      ),
    ).toThrow(/Package or PackageComposition/);
  });

  it('REJECTS specialization that does not strictly narrow the context', () => {
    expect(() => specializePackage(lineageInput({ context: SOURCE_CTX }))).toThrow(/STRICTLY narrower/); // same context
    expect(() => specializePackage(lineageInput({ context: { region: 'eu' } }))).toThrow(/STRICTLY narrower/); // broader
  });

  it('REJECTS generalization that does not strictly broaden the context', () => {
    expect(() =>
      generalizePackage(lineageInput({ context: { region: 'eu', tier: 'prod', scale: 'large' } })),
    ).toThrow(/STRICTLY broader/); // same
    expect(() =>
      generalizePackage(lineageInput({ context: { region: 'eu', tier: 'prod' } })),
    ).toThrow(/STRICTLY broader/); // same as base
    expect(() =>
      generalizePackage(
        lineageInput({ context: { region: 'eu', tier: 'prod', scale: 'large', tenant: 'acme' } }),
      ),
    ).toThrow(/STRICTLY broader/); // narrower
  });

  it('REJECTS generalization to the EMPTY context (a universal score)', () => {
    expect(() => generalizePackage(lineageInput({ context: {} as never }))).toThrow(/context is invalid/);
  });

  it('REJECTS lineage operations without provenance (who/what) or evidence (which evidence)', () => {
    expect(() => specializePackage(lineageInput({ provenance: [] }))).toThrow(/WHO\/WHAT/);
    expect(() => specializePackage(lineageInput({ evidence_refs: [] }))).toThrow(/WHICH evidence/);
    expect(() => generalizePackage(lineageInput({ provenance: [] }))).toThrow(/WHO\/WHAT/);
  });

  it('REJECTS derived packages whose estimates conflict with the declared context', () => {
    expect(() =>
      specializePackage(
        lineageInput({
          applicability: [
            {
              kind: 'QUALITATIVE',
              uncertainty_class: 'MODERATE',
              context: { region: 'us' }, // conflicts with the narrowed declaring context
              sample_size: 1,
              window: null,
            },
          ],
        }),
      ),
    ).toThrow(/consistent with its declaring context/);
  });

  it('REJECTS derived packages with an empty applicability override', () => {
    expect(() => specializePackage(lineageInput({ applicability: [] }))).toThrow(/NON-EMPTY/);
  });

  it('REJECTS lineage with a non-package base', () => {
    const notAPackage = { ...basePackageArtifact(), envelope: { ...basePackageArtifact().envelope, kind: 'Mission' } };
    expect(() => specializePackage(lineageInput({ base: notAPackage as never }))).toThrow(/base package is invalid/);
  });

  it('REJECTS snapshots with tampered transfer content (content-address discipline)', () => {
    const store = new TransferStore();
    store.recordTransfer(transferInput());
    const snapshot = store.snapshot();
    const tampered = structuredClone(snapshot);
    tampered.transfers[0]!.note = 'tampered';
    expect(() => TransferStore.restore(tampered)).toThrow(/does not match its content/);
  });

  it('REJECTS invalidated assumptions without evidence or with bad contexts', () => {
    const store = new TransferStore();
    expect(() =>
      store.recordInvalidatedAssumption({
        package_ref: SOURCE,
        assumption: 'some assumption',
        context: TARGET_CTX,
        evidence_refs: [],
        provenance: ['agent:sre'],
        recorded_at: '2025-01-03T00:00:00.000Z',
      }),
    ).toThrow(/NON-EMPTY/);
    expect(() =>
      store.recordInvalidatedAssumption({
        package_ref: SOURCE,
        assumption: 'some assumption',
        context: {} as never,
        evidence_refs: [failureEvidence(SOURCE, 5).id],
        provenance: ['agent:sre'],
        recorded_at: '2025-01-03T00:00:00.000Z',
      }),
    ).toThrow(/context is invalid/);
  });

  it('produces derived artifacts that satisfy the W6 package validator', () => {
    const { artifact } = specializePackage(lineageInput());
    expect(() => assertValidPackageArtifact(artifact)).not.toThrow();
  });

  it('accepts a calibrated estimate WITH its calibration ref (the sanctioned numeric path)', () => {
    const store = new TransferStore();
    expect(() =>
      store.recordTransfer(
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
      ),
    ).not.toThrow();
  });
});
