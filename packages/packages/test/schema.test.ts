import { describe, expect, it } from 'vitest';
import { createContractValidator } from '@sos-2/contracts/schema-loader';
import { toPackageRecord } from '../src/index.js';
import {
  DURABLE_STORE_PACKAGE,
  GOLDEN_PACKAGE,
  T0,
  W05_GOLDEN_PACKAGE_RECORD,
  makeEvidence,
  samplePackageArtifact,
  samplePackageContent,
} from './helpers.js';
import { createPackageArtifact } from '../src/index.js';

const validator = createContractValidator();

describe('package schema conformance (ajv over spec/contracts/package.schema.json)', () => {
  it('validates the golden package projection against sos://schema/package', () => {
    const record = toPackageRecord(GOLDEN_PACKAGE);
    validator.assertValid('package', record);
    expect(validator.validate('package', record).valid).toBe(true);
  });

  it('validates the companion fixture and sample projections', () => {
    validator.assertValid('package', toPackageRecord(DURABLE_STORE_PACKAGE));
    validator.assertValid('package', toPackageRecord(samplePackageArtifact()));
  });

  it('validates the W0.5 golden record itself and the projections equal it', () => {
    validator.assertValid('package', W05_GOLDEN_PACKAGE_RECORD);
    expect(toPackageRecord(GOLDEN_PACKAGE)).toEqual(W05_GOLDEN_PACKAGE_RECORD);
  });

  it('rejects records with additional properties (additionalProperties: false)', () => {
    const record = { ...toPackageRecord(GOLDEN_PACKAGE), extra: 'forbidden' };
    const result = validator.validate('package', record);
    expect(result.valid).toBe(false);
  });

  it('rejects records missing required fields', () => {
    const record = toPackageRecord(GOLDEN_PACKAGE) as unknown as Record<string, unknown>;
    delete record['maturity'];
    expect(validator.validate('package', record).valid).toBe(false);
    const noEvidence = { ...record, evidence_refs: undefined };
    expect(validator.validate('package', noEvidence).valid).toBe(false);
  });

  it('rejects records with maturity outside the frozen enum', () => {
    const record = { ...toPackageRecord(GOLDEN_PACKAGE), maturity: 'FRESH' };
    expect(validator.validate('package', record).valid).toBe(false);
  });

  it('every projection of a random-ish sample set stays schema-valid', () => {
    const samples = [
      samplePackageContent({ semantic_capability: 'cap-a' }),
      samplePackageContent({ semantic_capability: 'cap-b', maturity: 'FORMING' }),
      samplePackageContent({ semantic_capability: 'cap-c', evidence_refs: [makeEvidence().id], failure_refs: [makeEvidence({ availability: 'FAILURE' }).id] }),
    ];
    for (const content of samples) {
      const artifact = createPackageArtifact({ content, provenance: ['w6:test'], created_at: T0 });
      validator.assertValid('package', toPackageRecord(artifact));
    }
  });
});
