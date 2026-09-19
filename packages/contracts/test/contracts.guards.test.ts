import { describe, expect, it } from 'vitest';
import {
  isArchitectureDelta,
  isArtifactEnvelope,
  isEvidenceRecord,
  isImplementationModel,
  isPackageRecord,
  isTraceLink,
} from '../src/index.js';

const validEnvelope = {
  id: 'sos://Mission/0123456789abcdef0123456789abcdef',
  kind: 'Mission',
  version: 1,
  status: 'DRAFT',
  authority_ref: 'sos://Constitution/0123456789abcdef0123456789abcdef',
  provenance: ['w0.5:test'],
  created_at: '2025-01-01T00:00:00.000Z',
  supersedes: null,
};

const validTraceLink = {
  source: 'sos://Mission/0123456789abcdef0123456789abcdef',
  target: 'sos://Constitution/0123456789abcdef0123456789abcdef',
  type: 'SATISFIES',
  provenance: ['w0.5:test'],
};

const validDelta = {
  affected_artifacts: ['sos://ImplementationModel/0123456789abcdef0123456789abcdef'],
  preserved_invariants: ['trace-types-frozen'],
  work_order: 'W0.5',
};

const validEvidence = {
  id: 'sos://Evidence/0123456789abcdef0123456789abcdef',
  kind: 'test-run',
  subject_ref: 'sos://ImplementationModel/0123456789abcdef0123456789abcdef',
  availability: 'SUCCESS',
  provenance: ['w0.5:test'],
};

const validPackageRecord = {
  id: 'sos://Package/0123456789abcdef0123456789abcdef',
  semantic_capability: 'test-capability',
  contracts: ['sos://schema/trace-link'],
  maturity: 'DISCOVERED',
  evidence_refs: ['sos://Evidence/0123456789abcdef0123456789abcdef'],
};

const validImplementationModel = {
  id: 'sos://ImplementationModel/0123456789abcdef0123456789abcdef',
  revision: '0123456789abcdef0123456789abcdef0123456789abcdef',
  components: [
    { id: 'auth', kind: 'service', realized_by: ['src/auth.ts'], realizes: ['node:auth'] },
  ],
  source_artifacts: [{ path: 'src/auth.ts', revision: 'rev1' }],
  interfaces: [{ id: 'iface:auth', provider: 'auth', contract_ref: null, consumers: [] }],
  dependencies: [{ source: 'auth', target: 'db', kind: 'uses' }],
  tests: [{ id: 'test:auth', subject: 'auth', framework: 'vitest' }],
  builds: [{ id: 'build:1', source_revision: 'rev1', outputs: ['dist/'], reproducible: true }],
  deployments: [{ id: 'dep:1', build_id: 'build:1', environment: 'production', revision: 'rev1' }],
  runtime_mappings: [{ id: 'rt:1', component: 'auth', runtime_ref: 'proc:1', environment: 'production' }],
};

describe('guard: ArtifactEnvelope (exact 8-field set)', () => {
  it('accepts a valid envelope', () => {
    expect(isArtifactEnvelope(validEnvelope)).toBe(true);
  });

  it('survives a JSON serialization round trip', () => {
    expect(isArtifactEnvelope(JSON.parse(JSON.stringify(validEnvelope)))).toBe(true);
  });

  it('rejects structural violations', () => {
    const mutations: Array<[string, unknown]> = [
      ['missing id', { ...validEnvelope, id: undefined }],
      ['extra field', { ...validEnvelope, extra: 1 }],
      ['empty id', { ...validEnvelope, id: '' }],
      ['numeric kind', { ...validEnvelope, kind: 7 }],
      ['version 0', { ...validEnvelope, version: 0 }],
      ['version 1.5', { ...validEnvelope, version: 1.5 }],
      ['version string', { ...validEnvelope, version: '1' }],
      ['unknown status', { ...validEnvelope, status: 'PUBLISHED' }],
      ['authority_ref number', { ...validEnvelope, authority_ref: 5 }],
      ['provenance string', { ...validEnvelope, provenance: 'w0.5' }],
      ['provenance entry number', { ...validEnvelope, provenance: [1] }],
      ['created_at number', { ...validEnvelope, created_at: 0 }],
      ['supersedes number', { ...validEnvelope, supersedes: 9 }],
      ['not an object', [validEnvelope]],
      ['null', null],
    ];
    for (const [name, mutation] of mutations) {
      expect(isArtifactEnvelope(mutation), name).toBe(false);
    }
  });
});

describe('guard: TraceLink (trace-link.schema.json)', () => {
  it('accepts a valid link, with and without provenance', () => {
    expect(isTraceLink(validTraceLink)).toBe(true);
    expect(isTraceLink({ source: validTraceLink.source, target: validTraceLink.target, type: 'VERIFIES' })).toBe(true);
  });

  it('survives a JSON serialization round trip', () => {
    expect(isTraceLink(JSON.parse(JSON.stringify(validTraceLink)))).toBe(true);
  });

  it('rejects unknown types, missing required fields and extra properties', () => {
    const mutations: Array<[string, unknown]> = [
      ['unknown type', { ...validTraceLink, type: 'LOVES' }],
      ['missing type', { source: 'a', target: 'b' }],
      ['missing target', { source: 'a', type: 'SATISFIES' }],
      ['empty source', { ...validTraceLink, source: '' }],
      ['extra property', { ...validTraceLink, weight: 0.5 }],
      ['provenance not array', { ...validTraceLink, provenance: 'x' }],
      ['provenance entry number', { ...validTraceLink, provenance: [1] }],
    ];
    for (const [name, mutation] of mutations) {
      expect(isTraceLink(mutation), name).toBe(false);
    }
  });
});

describe('guard: ArchitectureDelta (architecture-delta.schema.json)', () => {
  it('accepts a minimal delta with only required fields', () => {
    expect(
      isArchitectureDelta({ affected_artifacts: ['a'], preserved_invariants: ['b'] }),
    ).toBe(true);
  });

  it('accepts the full field set including null rationale_ref', () => {
    expect(
      isArchitectureDelta({
        affected_artifacts: ['a'],
        added: ['x'],
        removed: [],
        modified: ['y'],
        preserved_invariants: ['b'],
        boundary_changes: [],
        rationale_ref: null,
        work_order: 'W0.5',
      }),
    ).toBe(true);
  });

  it('rejects missing required fields, unknown keys and wrong types', () => {
    const mutations: Array<[string, unknown]> = [
      ['missing affected_artifacts', { preserved_invariants: ['b'] }],
      ['missing preserved_invariants', { affected_artifacts: ['a'] }],
      ['empty object', {}],
      ['unknown key', { affected_artifacts: ['a'], preserved_invariants: ['b'], surprise: 1 }],
      ['added as string', { affected_artifacts: ['a'], preserved_invariants: ['b'], added: 'x' }],
      ['work_order number', { affected_artifacts: ['a'], preserved_invariants: ['b'], work_order: 5 }],
      ['rationale_ref number', { affected_artifacts: ['a'], preserved_invariants: ['b'], rationale_ref: 5 }],
    ];
    for (const [name, mutation] of mutations) {
      expect(isArchitectureDelta(mutation), name).toBe(false);
    }
  });
});

describe('guard: EvidenceRecord (evidence.schema.json, open contract)', () => {
  it('accepts a valid record and preserves open extensions', () => {
    expect(isEvidenceRecord(validEvidence)).toBe(true);
    const extended = { ...validEvidence, telemetry_source: 'otel', extra_metric: 42 };
    expect(isEvidenceRecord(extended)).toBe(true);
  });

  it('rejects missing required fields and invalid truth states', () => {
    const mutations: Array<[string, unknown]> = [
      ['missing id', { ...validEvidence, id: undefined }],
      ['missing provenance', { ...validEvidence, provenance: undefined }],
      ['bad availability', { ...validEvidence, availability: 'MAYBE' }],
      ['conflated availability lowercase', { ...validEvidence, availability: 'unknown' }],
      ['provenance not array', { ...validEvidence, provenance: 'x' }],
      ['observational string', { ...validEvidence, observational: 'yes' }],
      ['source_revision number', { ...validEvidence, source_revision: 1 }],
      ['deployment_revision bool', { ...validEvidence, deployment_revision: false }],
    ];
    for (const [name, mutation] of mutations) {
      expect(isEvidenceRecord(mutation), name).toBe(false);
    }
  });
});

describe('guard: PackageRecord (package.schema.json)', () => {
  it('accepts a valid record with optional arrays', () => {
    expect(isPackageRecord(validPackageRecord)).toBe(true);
    expect(
      isPackageRecord({ ...validPackageRecord, failure_refs: [], compatibility_refs: ['x'], composition_refs: [] }),
    ).toBe(true);
  });

  it('rejects missing required fields, bad maturity and extra properties', () => {
    const mutations: Array<[string, unknown]> = [
      ['missing contracts', { ...validPackageRecord, contracts: undefined }],
      ['missing evidence_refs', { ...validPackageRecord, evidence_refs: undefined }],
      ['bad maturity', { ...validPackageRecord, maturity: 'EXPERIMENTAL' }],
      ['extra property', { ...validPackageRecord, author: 'me' }],
      ['evidence_refs string', { ...validPackageRecord, evidence_refs: 'x' }],
    ];
    for (const [name, mutation] of mutations) {
      expect(isPackageRecord(mutation), name).toBe(false);
    }
  });
});

describe('guard: ImplementationModel (implementation-model.schema.json)', () => {
  it('accepts a valid model and a minimal empty model', () => {
    expect(isImplementationModel(validImplementationModel)).toBe(true);
    expect(
      isImplementationModel({
        id: 'sos://ImplementationModel/0123456789abcdef0123456789abcdef',
        revision: 'rev1',
        components: [],
        source_artifacts: [],
        interfaces: [],
        dependencies: [],
        tests: [],
        builds: [],
        deployments: [],
        runtime_mappings: [],
      }),
    ).toBe(true);
  });

  it('survives a JSON serialization round trip', () => {
    expect(isImplementationModel(JSON.parse(JSON.stringify(validImplementationModel)))).toBe(true);
  });

  it('rejects missing sections and malformed nested entries', () => {
    const mutations: Array<[string, unknown]> = [
      ['missing id', { ...validImplementationModel, id: undefined }],
      ['missing revision', { ...validImplementationModel, revision: undefined }],
      ['missing components', { ...validImplementationModel, components: undefined }],
      ['missing source_artifacts', { ...validImplementationModel, source_artifacts: undefined }],
      ['missing interfaces', { ...validImplementationModel, interfaces: undefined }],
      ['missing dependencies', { ...validImplementationModel, dependencies: undefined }],
      ['missing tests', { ...validImplementationModel, tests: undefined }],
      ['missing builds', { ...validImplementationModel, builds: undefined }],
      ['missing deployments', { ...validImplementationModel, deployments: undefined }],
      ['missing runtime_mappings', { ...validImplementationModel, runtime_mappings: undefined }],
      ['extra top-level key', { ...validImplementationModel, owner: 'me' }],
      ['component missing realizes', { ...validImplementationModel, components: [{ id: 'a', kind: 'service', realized_by: [] }] }],
      ['component extra key', { ...validImplementationModel, components: [{ id: 'a', kind: 'service', realized_by: [], realizes: [], owner: 'x' }] }],
      ['dependency missing kind', { ...validImplementationModel, dependencies: [{ source: 'a', target: 'b' }] }],
      ['build reproducible number', { ...validImplementationModel, builds: [{ id: 'b', source_revision: 'r', outputs: [], reproducible: 1 }] }],
      ['source artifact missing revision', { ...validImplementationModel, source_artifacts: [{ path: 'x' }] }],
      ['test framework number', { ...validImplementationModel, tests: [{ id: 't', subject: 's', framework: 3 }] }],
      ['runtime mapping missing environment', { ...validImplementationModel, runtime_mappings: [{ id: 'r', component: 'c', runtime_ref: 'p' }] }],
      ['deployment missing build_id', { ...validImplementationModel, deployments: [{ id: 'd', environment: 'e', revision: 'r' }] }],
    ];
    for (const [name, mutation] of mutations) {
      expect(isImplementationModel(mutation), name).toBe(false);
    }
  });
});
