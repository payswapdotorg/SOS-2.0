import { describe, expect, it } from 'vitest';
import { createContractValidator } from '@sos-2/contracts/schema-loader';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARTIFACT_ID_PATTERN,
  buildArchitectureDelta,
  canonicalSerialize,
  createEnvelope,
  deriveDeterministicArtifactId,
  isArchitectureDelta,
  isArtifactEnvelope,
  isEvidenceRecord,
  isImplementationModel,
  isPackageRecord,
  isTraceLink,
  isCanonicalText,
  validateArchitectureDelta,
  validateEnvelope,
  validateTraceLink,
} from '../src/index.js';
import type { ArtifactEnvelope, EvidenceRecord, ImplementationModel, PackageRecord, TraceLink, ArchitectureDelta } from '../src/index.js';

const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url));

function loadFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8')) as T;
}

const validator = createContractValidator();

const envelope = loadFixture<ArtifactEnvelope>('artifact-envelope.json');
const traceLink = loadFixture<TraceLink>('trace-link.json');
const delta = loadFixture<ArchitectureDelta>('architecture-delta.json');
const evidence = loadFixture<EvidenceRecord>('evidence.json');
const packageRecord = loadFixture<PackageRecord>('package-record.json');
const implementationModel = loadFixture<ImplementationModel>('implementation-model.json');

describe('golden fixtures — TS guards and ajv schemas agree (consistency proof)', () => {
  it('artifact-envelope.json passes the spine envelope validation', () => {
    expect(isArtifactEnvelope(envelope)).toBe(true);
    expect(validateEnvelope(envelope)).toBe(true);
    // exact field set
    expect(Object.keys(envelope).sort()).toEqual(
      ['authority_ref', 'created_at', 'id', 'kind', 'provenance', 'status', 'supersedes', 'version'].sort(),
    );
  });

  it('trace-link.json passes BOTH the TS guard and sos://schema/trace-link', () => {
    expect(isTraceLink(traceLink)).toBe(true);
    expect(validateTraceLink(traceLink)).toBe(true);
    validator.assertValid('trace-link', traceLink);
  });

  it('architecture-delta.json passes BOTH the TS guard and sos://schema/architecture-delta', () => {
    expect(isArchitectureDelta(delta)).toBe(true);
    expect(validateArchitectureDelta(delta)).toBe(true);
    validator.assertValid('architecture-delta', delta);
    expect(buildArchitectureDelta(delta)).toEqual(delta);
  });

  it('evidence.json passes BOTH the TS guard and sos://schema/evidence', () => {
    expect(isEvidenceRecord(evidence)).toBe(true);
    validator.assertValid('evidence', evidence);
  });

  it('package-record.json passes BOTH the TS guard and sos://schema/package', () => {
    expect(isPackageRecord(packageRecord)).toBe(true);
    validator.assertValid('package', packageRecord);
  });

  it('implementation-model.json passes BOTH the TS guard and sos://schema/implementation-model', () => {
    expect(isImplementationModel(implementationModel)).toBe(true);
    validator.assertValid('implementation-model', implementationModel);
  });

  it('guards and ajv agree on NEGATIVE mutations of the closed contracts', () => {
    const mutations: Array<[string, unknown, string]> = [
      ['trace-link extra property', { ...traceLink, weight: 1 }, 'trace-link'],
      ['trace-link bad type', { ...traceLink, type: 'ADMIREs' }, 'trace-link'],
      ['delta extra property', { ...delta, secret: true }, 'architecture-delta'],
      ['package extra property', { ...packageRecord, author: 'x' }, 'package'],
      ['package bad maturity', { ...packageRecord, maturity: 'ALPHA' }, 'package'],
      ['implmodel extra section', { ...implementationModel, bonus: [] }, 'implementation-model'],
      ['implmodel bad nested', { ...implementationModel, dependencies: [{ source: 'a' }] }, 'implementation-model'],
    ];
    for (const [name, instance, schema] of mutations) {
      expect(validator.validate(schema, instance).valid, name).toBe(false);
    }
    expect(isTraceLink({ ...traceLink, weight: 1 })).toBe(false);
    expect(isArchitectureDelta({ ...delta, secret: true })).toBe(false);
    expect(isPackageRecord({ ...packageRecord, author: 'x' })).toBe(false);
    expect(isImplementationModel({ ...implementationModel, bonus: [] })).toBe(false);
  });

  it('evidence remains an OPEN contract (extensions allowed by schema and guard)', () => {
    const extended = { ...evidence, otel_span_id: 'abc123' };
    expect(validator.validate('evidence', extended).valid).toBe(true);
    expect(isEvidenceRecord(extended)).toBe(true);
  });
});

describe('golden fixtures — identifier discipline (no invented identifiers)', () => {
  it('every id is a well-formed sos:// artifact id', () => {
    for (const id of [
      envelope.id,
      envelope.authority_ref as string,
      traceLink.source,
      traceLink.target,
      evidence.id,
      evidence.subject_ref,
      packageRecord.id,
      ...packageRecord.evidence_refs,
      implementationModel.id,
    ]) {
      expect(ARTIFACT_ID_PATTERN.test(id), id).toBe(true);
    }
  });

  it('envelope id is reproduced exactly by createEnvelope (content-addressed)', () => {
    const reproduced = createEnvelope({
      kind: envelope.kind,
      version: envelope.version,
      status: envelope.status,
      authority_ref: envelope.authority_ref,
      provenance: envelope.provenance,
      created_at: envelope.created_at,
      supersedes: envelope.supersedes,
    });
    expect(reproduced.id).toBe(envelope.id);
    expect(reproduced).toEqual(envelope);
  });

  it('implementation-model id is reproduced exactly by deriveDeterministicArtifactId', () => {
    const { id, ...content } = implementationModel;
    expect(deriveDeterministicArtifactId('ImplementationModel', content)).toBe(id);
  });

  it('evidence and package ids are reproduced exactly by deriveDeterministicArtifactId', () => {
    const { id: evidenceId, ...evidenceContent } = evidence;
    expect(deriveDeterministicArtifactId('Evidence', evidenceContent)).toBe(evidenceId);
    const { id: packageId, ...packageContent } = packageRecord;
    expect(deriveDeterministicArtifactId('Package', packageContent)).toBe(packageId);
  });

  it('fixtures are internally cross-referenced', () => {
    expect(traceLink.source).toBe(implementationModel.id);
    expect(traceLink.target).toMatch(ARTIFACT_ID_PATTERN);
    expect(traceLink.type).toBe('REALIZES');
    expect(evidence.subject_ref).toBe(implementationModel.id);
    expect(packageRecord.evidence_refs).toContain(evidence.id);
    expect(packageRecord.contracts).toEqual([
      'sos://schema/trace-link',
      'sos://schema/architecture-delta',
      'sos://schema/evidence',
      'sos://schema/package',
      'sos://schema/implementation-model',
    ]);
    // the implementation model describes the W0.5 packages themselves
    expect(implementationModel.components.map((c) => c.id).sort()).toEqual(['contracts', 'semantic-spine']);
    expect(implementationModel.dependencies).toEqual([
      { source: 'semantic-spine', target: 'contracts', kind: 'uses' },
    ]);
  });
});

describe('golden fixtures — canonical round trips', () => {
  const all: Array<[string, unknown]> = [
    ['artifact-envelope.json', envelope],
    ['trace-link.json', traceLink],
    ['architecture-delta.json', delta],
    ['evidence.json', evidence],
    ['package-record.json', packageRecord],
    ['implementation-model.json', implementationModel],
  ];

  it('serialize -> parse -> serialize is byte-identical for every fixture', () => {
    for (const [name, value] of all) {
      const s1 = canonicalSerialize(value);
      const s2 = canonicalSerialize(JSON.parse(s1));
      expect(s2, name).toBe(s1);
      expect(isCanonicalText(s1), name).toBe(true);
    }
  });

  it('the checked-in JSON files are already canonically formatted', () => {
    for (const name of all.map(([n]) => n)) {
      const raw = fs.readFileSync(path.join(fixturesDir, name), 'utf8');
      const parsed = JSON.parse(raw);
      // canonical text must round-trip to identical bytes
      expect(canonicalSerialize(parsed), name).toBe(canonicalSerialize(JSON.parse(canonicalSerialize(parsed))));
      expect(isCanonicalText(canonicalSerialize(parsed)), name).toBe(true);
    }
  });
});
