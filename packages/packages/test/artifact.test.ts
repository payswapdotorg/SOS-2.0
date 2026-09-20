import { describe, expect, it } from 'vitest';
import {
  canonicalPackageText,
  createPackageArtifact,
  packageArtifactId,
  packageHash,
  toPackageRecord,
  validatePackageArtifact,
} from '../src/index.js';
import type { CreatePackageInput, PackageArtifact } from '../src/index.js';
import { canonicalSerialize, isPackageRecord } from '@sos-2/semantic-spine';
import {
  DURABLE_STORE_PACKAGE,
  GOLDEN_PACKAGE,
  REALIZATION_REF,
  T0,
  W05_GOLDEN_PACKAGE_RECORD,
  goldenPackageInput,
  makeEvidence,
  samplePackageArtifact,
  samplePackageContent,
} from './helpers.js';

describe('package artifact creation (positive)', () => {
  it('mints deterministic content-addressed sos://Package ids', () => {
    const artifact = samplePackageArtifact();
    expect(artifact.envelope.id).toMatch(/^sos:\/\/Package\/[0-9a-f]{32}$/);
    expect(artifact.envelope.id).toBe(packageArtifactId({ content: samplePackageContent(), provenance: ['w6:test'], created_at: T0 }));
    expect(samplePackageArtifact().envelope.id).toBe(artifact.envelope.id);
    const other = samplePackageArtifact({
      content: samplePackageContent({ semantic_capability: 'another-capability' }),
    });
    expect(other.envelope.id).not.toBe(artifact.envelope.id);
  });

  it('the envelope kind is always Package and content is preserved verbatim', () => {
    const artifact = samplePackageArtifact();
    expect(artifact.envelope.kind).toBe('Package');
    expect(artifact.content.semantic_capability).toBe('sample-capability');
    expect(artifact.envelope.provenance).toEqual(['w6:test']);
    expect(artifact.envelope.created_at).toBe(T0);
    expect(artifact.envelope.status).toBe('DRAFT');
    expect(artifact.envelope.version).toBe(1);
    expect(artifact.envelope.supersedes).toBeNull();
  });

  it('validates through the full artifact validator', () => {
    expect(validatePackageArtifact(samplePackageArtifact())).toBe(true);
    expect(validatePackageArtifact(GOLDEN_PACKAGE)).toBe(true);
    expect(validatePackageArtifact(DURABLE_STORE_PACKAGE)).toBe(true);
    expect(validatePackageArtifact(null)).toBe(false);
    expect(validatePackageArtifact({ envelope: GOLDEN_PACKAGE.envelope })).toBe(false);
  });

  it('canonical text round trips byte-identically (spine canonical serializer)', () => {
    const artifact = samplePackageArtifact();
    const text = canonicalPackageText(artifact);
    const parsed = JSON.parse(text) as PackageArtifact;
    expect(canonicalPackageText(parsed)).toBe(text);
    expect(parsed).toEqual(artifact);
    expect(packageHash(artifact)).toBe(packageHash(parsed));
    expect(canonicalSerialize(artifact)).toBe(canonicalSerialize(parsed));
  });

  it('explicit ids are accepted only as well-formed Package ids (golden/random minting)', () => {
    const golden = createPackageArtifact({ ...goldenPackageInput(), id: GOLDEN_PACKAGE.envelope.id });
    expect(golden.envelope.id).toBe(GOLDEN_PACKAGE.envelope.id);
    expect(() =>
      createPackageArtifact({ ...goldenPackageInput(), id: 'sos://PackageComposition/2030ae1a8921c2f8dc3d73dc562a17b7' }),
    ).toThrow(/Package id/);
    expect(() => createPackageArtifact({ ...goldenPackageInput(), id: 'not-an-id' })).toThrow(/well-formed/);
  });
});

describe('golden fixture reproduction (bit-exact)', () => {
  it('reproduces the golden package artifact bit-exactly (content addressing)', () => {
    const artifact = createPackageArtifact({
      ...goldenPackageInput(),
      id: GOLDEN_PACKAGE.envelope.id,
    });
    expect(artifact).toEqual(GOLDEN_PACKAGE);
    expect(canonicalPackageText(artifact)).toBe(canonicalPackageText(GOLDEN_PACKAGE));
    // Without the explicit id the deterministic id differs (different
    // derivation content is NOT the case here — the explicit id IS the
    // golden id, so the derived id equals it only if contents align).
    const derived = createPackageArtifact(goldenPackageInput());
    expect(derived.envelope.id).toBe(packageArtifactId(goldenPackageInput()));
  });

  it('reproduces the companion durable-store fixture bit-exactly', () => {
    const derived = createPackageArtifact({
      content: DURABLE_STORE_PACKAGE.content,
      provenance: DURABLE_STORE_PACKAGE.envelope.provenance,
      created_at: DURABLE_STORE_PACKAGE.envelope.created_at,
    });
    expect(derived.envelope.id).toBe(DURABLE_STORE_PACKAGE.envelope.id);
    expect(derived).toEqual(DURABLE_STORE_PACKAGE);
  });
});

describe('the normative PackageRecord projection (sos://schema/package)', () => {
  it('projects onto the CLOSED 8-key record and satisfies the contracts guard', () => {
    const record = toPackageRecord(GOLDEN_PACKAGE);
    expect(Object.keys(record).sort()).toEqual(
      ['compatibility_refs', 'composition_refs', 'contracts', 'evidence_refs', 'failure_refs', 'id', 'maturity', 'semantic_capability'].sort(),
    );
    expect(isPackageRecord(record)).toBe(true);
  });

  it('reproduces the W0.5 golden package record BIT-EXACTLY (fixture cross-reference)', () => {
    const record = toPackageRecord(GOLDEN_PACKAGE);
    expect(record).toEqual(W05_GOLDEN_PACKAGE_RECORD);
    expect(canonicalSerialize(record)).toBe(canonicalSerialize(W05_GOLDEN_PACKAGE_RECORD));
  });

  it('projects every artifact deterministically (id = envelope id, refs from content)', () => {
    const artifact = samplePackageArtifact();
    const record = toPackageRecord(artifact);
    expect(record.id).toBe(artifact.envelope.id);
    expect(record.maturity).toBe(artifact.content.maturity);
    expect(record.evidence_refs).toEqual(artifact.content.evidence_refs);
    expect(record.contracts).toEqual(artifact.content.contracts);
    expect(toPackageRecord(artifact)).toEqual(record);
  });

  it('rejects projection of invalid artifacts (loud invariant guard)', () => {
    const broken = structuredClone(GOLDEN_PACKAGE) as PackageArtifact;
    broken.content.evidence_refs = [];
    expect(() => toPackageRecord(broken)).toThrow(/evidence_refs/);
  });
});

describe('realizations', () => {
  it('a DISCOVERED package may declare zero realizations; VALIDATED requires at least one', () => {
    expect(samplePackageContent().realizations).toEqual([]);
    const validated = samplePackageContent({ maturity: 'VALIDATED' });
    expect(() => {
      // Creation-time validation rejects a VALIDATED package without realizations.
      createPackageArtifact({ content: validated, provenance: ['w6:test'], created_at: T0 });
    }).toThrow(/at least one realization/);
    const realized = samplePackageContent({
      maturity: 'VALIDATED',
      realizations: [{ ref: REALIZATION_REF, revision: 'git:abc123', note: 'the realization' }],
    });
    const artifact = createPackageArtifact({ content: realized, provenance: ['w6:test'], created_at: T0 });
    expect(artifact.content.realizations).toHaveLength(1);
  });

  it('realization refs must be well-formed spine ids with null-or-non-empty revisions', () => {
    expect(() =>
      createPackageArtifact({
        content: samplePackageContent({
          realizations: [{ ref: 'not-an-id', revision: null, note: 'x' } as never],
        }),
        provenance: ['w6:test'],
        created_at: T0,
      }),
    ).toThrow(/realization ref/);
    expect(() =>
      createPackageArtifact({
        content: samplePackageContent({
          realizations: [{ ref: REALIZATION_REF, revision: '', note: 'x' }],
        }),
        provenance: ['w6:test'],
        created_at: T0,
      }),
    ).toThrow(/revision/);
  });
});

describe('creation input discipline', () => {
  it('rejects non-object inputs and requires provenance + RFC3339 created_at (spine discipline)', () => {
    expect(() => createPackageArtifact(null as never)).toThrow(/must be an object/);
    expect(() =>
      createPackageArtifact({ content: samplePackageContent(), provenance: [], created_at: T0 }),
    ).toThrow(/provenance/);
    expect(() =>
      createPackageArtifact({ content: samplePackageContent(), provenance: ['w6:test'], created_at: 'yesterday' }),
    ).toThrow(/RFC3339/);
  });

  it('packages require evidence: the evidence ref must be a well-formed Evidence id', () => {
    const evidence = makeEvidence();
    expect(evidence.id).toMatch(/^sos:\/\/Evidence\//);
    const artifact = samplePackageArtifact({
      content: samplePackageContent({ evidence_refs: [evidence.id] }),
    });
    expect(artifact.content.evidence_refs).toEqual([evidence.id]);
  });
});

describe('CreatePackageInput surface', () => {
  it('version/status/supersedes defaults and overrides behave', () => {
    const base: CreatePackageInput = { content: samplePackageContent(), provenance: ['w6:test'], created_at: T0 };
    expect(createPackageArtifact(base).envelope.version).toBe(1);
    expect(createPackageArtifact({ ...base, version: 7 }).envelope.version).toBe(7);
    expect(createPackageArtifact({ ...base, status: 'ACTIVE' }).envelope.status).toBe('ACTIVE');
  });
});
