import { describe, expect, it } from 'vitest';
import {
  createContractValidator,
  findRepoRoot,
  loadSpecSchemas,
  resolveRepoRoot,
} from '../src/schema-loader.js';
import { isEvidenceRecord, isTraceLink } from '../src/index.js';

describe('schema loader (spec/contracts)', () => {
  it('finds the repository root by walking up from the working directory', () => {
    const root = findRepoRoot();
    expect(root).toMatch(/SOS-2\.0$/);
    expect(root).toBe(resolveRepoRoot());
  });

  it('loads exactly the five contract schemas with canonical sos:// ids', () => {
    const schemas = loadSpecSchemas();
    expect(schemas.map((s) => s.name)).toEqual([
      'architecture-delta',
      'evidence',
      'implementation-model',
      'package',
      'trace-link',
    ]);
    const ids = Object.fromEntries(schemas.map((s) => [s.name, s.id]));
    expect(ids).toEqual({
      'architecture-delta': 'sos://schema/architecture-delta',
      evidence: 'sos://schema/evidence',
      'implementation-model': 'sos://schema/implementation-model',
      package: 'sos://schema/package',
      'trace-link': 'sos://schema/trace-link',
    });
  });

  it('throws when given an explicit root without spec/contracts', () => {
    expect(() => loadSpecSchemas('/tmp')).toThrow(/root|contracts/i);
  });
});

describe('contract validator (ajv, draft 2020-12)', () => {
  const validator = createContractValidator();

  it('exposes schema names', () => {
    expect(validator.schemaNames()).toEqual([
      'architecture-delta',
      'evidence',
      'implementation-model',
      'package',
      'trace-link',
    ]);
  });

  it('validates trace links by name and by $id', () => {
    const link = {
      source: 'sos://Mission/' + 'a'.repeat(32),
      target: 'sos://Constitution/' + 'b'.repeat(32),
      type: 'SATISFIES',
      provenance: ['w0.5:test'],
    };
    expect(validator.validate('trace-link', link).valid).toBe(true);
    expect(validator.validate('sos://schema/trace-link', link).valid).toBe(true);
    // TS guard agrees
    expect(isTraceLink(link)).toBe(true);
  });

  it('rejects trace links with unknown types or extra properties (schema and guard agree)', () => {
    const bad = {
      source: 'sos://Mission/' + 'a'.repeat(32),
      target: 'sos://Constitution/' + 'b'.repeat(32),
      type: 'ADMires',
      provenance: ['w0.5:test'],
    };
    expect(validator.validate('trace-link', bad).valid).toBe(false);
    expect(isTraceLink(bad)).toBe(false);

    const extra = {
      source: 'sos://Mission/' + 'a'.repeat(32),
      target: 'sos://Constitution/' + 'b'.repeat(32),
      type: 'SATISFIES',
      provenance: ['w0.5:test'],
      weight: 0.5,
    };
    expect(validator.validate('trace-link', extra).valid).toBe(false);
    expect(isTraceLink(extra)).toBe(false);
  });

  it('permits absent provenance on trace links (schema and guard agree)', () => {
    const minimal = {
      source: 'sos://Mission/' + 'a'.repeat(32),
      target: 'sos://Constitution/' + 'b'.repeat(32),
      type: 'VERIFIES',
    };
    expect(validator.validate('trace-link', minimal).valid).toBe(true);
    expect(isTraceLink(minimal)).toBe(true);
  });

  it('rejects architecture deltas without required fields', () => {
    expect(validator.validate('architecture-delta', { affected_artifacts: ['a'] }).valid).toBe(false);
    expect(validator.validate('architecture-delta', { preserved_invariants: ['b'] }).valid).toBe(false);
    expect(
      validator.validate('architecture-delta', { affected_artifacts: ['a'], preserved_invariants: ['b'] }).valid,
    ).toBe(true);
    expect(
      validator.validate('architecture-delta', {
        affected_artifacts: ['a'],
        preserved_invariants: ['b'],
        unknown_field: true,
      }).valid,
    ).toBe(false);
  });

  it('keeps the evidence contract open (additionalProperties: true)', () => {
    const evidence = {
      id: 'sos://Evidence/' + 'c'.repeat(32),
      kind: 'test-run',
      subject_ref: 'sos://SystemState/' + 'd'.repeat(32),
      availability: 'UNAVAILABLE',
      provenance: ['w0.5:test'],
      custom_extension: { any: 'value' },
    };
    expect(validator.validate('evidence', evidence).valid).toBe(true);
    expect(isEvidenceRecord(evidence)).toBe(true);
    expect(validator.validate('evidence', { ...evidence, availability: 'LOST' }).valid).toBe(false);
  });

  it('validates implementation models against the new schema', () => {
    const model = {
      id: 'sos://ImplementationModel/' + 'e'.repeat(32),
      revision: 'rev1',
      components: [{ id: 'svc', kind: 'service', realized_by: ['src/svc.ts'], realizes: [] }],
      source_artifacts: [{ path: 'src/svc.ts', revision: 'rev1' }],
      interfaces: [],
      dependencies: [],
      tests: [],
      builds: [],
      deployments: [],
      runtime_mappings: [],
    };
    expect(validator.validate('implementation-model', model).valid).toBe(true);
    expect(validator.validate('implementation-model', { ...model, components: 'none' }).valid).toBe(false);
    expect(
      validator.validate('implementation-model', { ...model, surprise_section: [] }).valid,
    ).toBe(false);
  });

  it('throws on unknown schema names and on invalid instances via assertValid', () => {
    expect(() => validator.validate('no-such-schema', {})).toThrow(/unknown schema/i);
    expect(() => validator.assertValid('trace-link', { source: 'x' })).toThrow(/validation failed/);
    expect(() => validator.assertValid('package', {})).toThrow(/validation failed/);
  });
});
