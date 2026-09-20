import { describe, expect, it } from 'vitest';
import {
  createPackageArtifact,
  toPackageRecord,
  validatePackageArtifact,
  assertValidPackageContent,
} from '../src/index.js';
import {
  CALIBRATION,
  REALIZATION_REF,
  T0,
  W0,
  makeEvidence,
  samplePackageContent,
} from './helpers.js';

const base = () => ({ content: samplePackageContent(), provenance: ['w6:test'], created_at: T0 });

describe('package content validation (negative — the mandated rejections)', () => {
  it('REJECTS a package without evidence (packages require evidence, §18)', () => {
    expect(() => createPackageArtifact({ ...base(), content: samplePackageContent({ evidence_refs: [] }) })).toThrow(
      /NON-EMPTY array — packages require evidence/,
    );
  });

  it('REJECTS a package without applicability (ARCHITECT_START_HERE)', () => {
    expect(() => createPackageArtifact({ ...base(), content: samplePackageContent({ applicability: [] }) })).toThrow(
      /at least one applicability estimate/,
    );
  });

  it('REJECTS universal (empty-context) applicability estimates', () => {
    expect(() =>
      createPackageArtifact({
        ...base(),
        content: samplePackageContent({
          applicability: [
            { kind: 'QUALITATIVE', uncertainty_class: 'WEAK', context: {}, sample_size: 0, window: null },
          ],
        }),
      }),
    ).toThrow(/universal score/);
  });

  it('REJECTS uncalibrated numeric applicability (probability without its four companions)', () => {
    expect(() =>
      createPackageArtifact({
        ...base(),
        content: samplePackageContent({
          applicability: [
            { kind: 'CALIBRATED', probability: 0.9, calibration_ref: CALIBRATION, uncertainty_class: 'WEAK', context: { environment: 'test' }, sample_size: 0, window: W0 },
          ],
        }),
      }),
    ).toThrow(/sample_size/);
    expect(() =>
      createPackageArtifact({
        ...base(),
        content: samplePackageContent({
          applicability: [
            { kind: 'CALIBRATED', probability: 0.9, calibration_ref: 'nope', uncertainty_class: 'WEAK', context: { environment: 'test' }, sample_size: 3, window: W0 },
          ],
        }),
      }),
    ).toThrow(/calibration/);
  });

  it('REJECTS evidence/failure/compatibility refs that are not Evidence ids', () => {
    const evidence = makeEvidence();
    expect(() =>
      createPackageArtifact({ ...base(), content: samplePackageContent({ evidence_refs: ['sos://Package/' + '9'.repeat(32)] }) }),
    ).toThrow(/Evidence/);
    expect(() =>
      createPackageArtifact({
        ...base(),
        content: samplePackageContent({ evidence_refs: [evidence.id], failure_refs: ['sos://SystemState/' + '9'.repeat(32)] }),
      }),
    ).toThrow(/failure_refs.*Evidence/);
    expect(() =>
      createPackageArtifact({
        ...base(),
        content: samplePackageContent({ evidence_refs: [evidence.id], compatibility_refs: ['not-an-id'] }),
      }),
    ).toThrow(/compatibility_refs/);
  });

  it('REJECTS composition refs that are not PackageComposition ids', () => {
    const evidence = makeEvidence();
    expect(() =>
      createPackageArtifact({
        ...base(),
        content: samplePackageContent({ evidence_refs: [evidence.id], composition_refs: ['sos://Package/' + '7'.repeat(32)] }),
      }),
    ).toThrow(/composition_refs.*PackageComposition/);
  });

  it('REJECTS a package without assurance obligations (reuse never bypasses assurance)', () => {
    expect(() =>
      createPackageArtifact({ ...base(), content: samplePackageContent({ assurance_obligations: [] }) }),
    ).toThrow(/at least one assurance obligation/);
    expect(() =>
      createPackageArtifact({
        ...base(),
        content: samplePackageContent({ assurance_obligations: [{ kind: 'VIBES' as never, obligation: 'x' }] }),
      }),
    ).toThrow(/ASSURANCE_OBLIGATION_KINDS|STATIC_ANALYSIS/);
  });

  it('REJECTS packages without contracts, context or diversity profile', () => {
    expect(() => createPackageArtifact({ ...base(), content: samplePackageContent({ contracts: [] }) })).toThrow(
      /contracts must be a non-empty/,
    );
    expect(() =>
      createPackageArtifact({ ...base(), content: samplePackageContent({ context: {} }) }),
    ).toThrow(/context/);
    expect(() =>
      createPackageArtifact({
        ...base(),
        content: samplePackageContent({ diversity_profile: { family: 'x', dimensions: [] } as never }),
      }),
    ).toThrow(/at least one dimension stance/);
    expect(() =>
      createPackageArtifact({
        ...base(),
        content: samplePackageContent({ diversity_profile: { family: '', dimensions: [{ dimension: 'COST', stance: 'x' }] } as never }),
      }),
    ).toThrow(/family/);
  });

  it('REJECTS SUPERSEDED maturity without a replacement, and superseded_by elsewhere', () => {
    expect(() =>
      createPackageArtifact({ ...base(), content: samplePackageContent({ maturity: 'SUPERSEDED' }) }),
    ).toThrow(/SUPERSEDED package must declare its replacement/);
    const replacement = 'sos://Package/' + '4'.repeat(32);
    expect(() =>
      createPackageArtifact({
        ...base(),
        content: samplePackageContent({ maturity: 'DISCOVERED', superseded_by: replacement }),
      }),
    ).toThrow(/superseded_by must be null unless maturity is SUPERSEDED/);
  });

  it('REJECTS unknown maturities, empty changes and unknown top-level keys', () => {
    expect(() =>
      createPackageArtifact({ ...base(), content: samplePackageContent({ maturity: 'FRESH' as never }) }),
    ).toThrow(/frozen 7/);
    expect(() => createPackageArtifact({ ...base(), content: samplePackageContent({ changes: '' }) })).toThrow(/changes/);
    const extra = { ...samplePackageContent(), extra_field: 'x' } as never;
    expect(() => assertValidPackageContent(extra)).toThrow(/exact 17-field/);
  });

  it('REJECTS malformed realizations (ref/revision/note shape)', () => {
    expect(() =>
      createPackageArtifact({
        ...base(),
        content: samplePackageContent({ realizations: [{ ref: REALIZATION_REF, revision: null } as never] }),
      }),
    ).toThrow(/realization/);
    expect(() => createPackageArtifact({ ...base(), content: samplePackageContent({ realizations: null as never }) })).toThrow(
      /realizations/,
    );
  });

  it('validatePackageArtifact is the honest predicate (shape errors, kind mismatches)', () => {
    expect(validatePackageArtifact('nope')).toBe(false);
    expect(validatePackageArtifact({ envelope: { kind: 'Package' }, content: samplePackageContent() })).toBe(false);
    const wrongKind = { ...structuredClone(base().content) };
    expect(validatePackageArtifact({ envelope: null, content: wrongKind })).toBe(false);
  });

  it('the projection guard stays loud on malformed artifacts', () => {
    expect(() => toPackageRecord(null as never)).toThrow(/package artifact/);
  });
});
