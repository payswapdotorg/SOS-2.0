import { describe, expect, it } from 'vitest';
import {
  assertValidInvariant,
  buildDriftEvidenceRecord,
  checkInvariant,
  InvariantError,
  isDriftEvidenceRecord,
  normalizeImplementationModel,
  reconcile,
  ReconciliationError,
  validateInvariant,
} from '../src/index.js';
import type { GraphShape, Invariant } from '../src/index.js';
import {
  MODEL_ID,
  MODEL_REVISION,
  edgeOf,
  nodeOf,
  observedModel,
  createDeclaredGraphArtifact,
  invariantGraph,
} from './helpers.js';

describe('negative: invariant contract', () => {
  it('rejects unknown invariant kinds', () => {
    expect(() => assertValidInvariant({ kind: 'MUST_BE_FAST' })).toThrow(
      /unknown invariant kind: "MUST_BE_FAST"/,
    );
    expect(validateInvariant({ kind: 'MUST_BE_FAST' })).toBe(false);
    expect(validateInvariant(null)).toBe(false);
    expect(validateInvariant('DATA_OWNERSHIP')).toBe(false);
  });

  it('rejects LAYERING with fewer than two layers, duplicates or empty entries', () => {
    expect(() => assertValidInvariant({ kind: 'LAYERING', layers: ['Component'] })).toThrow(/at least two/);
    expect(() => assertValidInvariant({ kind: 'LAYERING', layers: ['A', 'A'] })).toThrow(/duplicate/);
    expect(() => assertValidInvariant({ kind: 'LAYERING', layers: ['A', ''] })).toThrow(/non-empty strings/);
    expect(() => assertValidInvariant({ kind: 'LAYERING' })).toThrow(/exact field set/);
  });

  it('rejects exact-field-set violations on every invariant kind', () => {
    expect(() =>
      assertValidInvariant({ kind: 'REQUIRED_INTERFACE', componentKind: 'Component' }),
    ).toThrow(/exact field set/);
    expect(() =>
      assertValidInvariant({ kind: 'REQUIRED_INTERFACE', componentKind: 'Component', interfaceId: 'x', extra: 1 }),
    ).toThrow(/exact field set/);
    expect(() => assertValidInvariant({ kind: 'FORBIDDEN_DEPENDENCY', fromKind: 'A' })).toThrow(/exact field set/);
    expect(() => assertValidInvariant({ kind: 'DATA_OWNERSHIP', extra: true })).toThrow(/exact field set/);
    expect(validateInvariant({ kind: 'REQUIRED_INTERFACE', componentKind: '', interfaceId: 'x' })).toBe(false);
  });

  it('rejects malformed graphs at check time', () => {
    const invariant: Invariant = { kind: 'DATA_OWNERSHIP' };
    const duplicateNodes: GraphShape = {
      nodes: [nodeOf('component:a', 'Component'), nodeOf('component:a', 'Component')],
      edges: [],
    };
    expect(() => checkInvariant(invariant, duplicateNodes)).toThrow(/duplicate node id/);
    const danglingEdge: GraphShape = {
      nodes: [nodeOf('component:a', 'Component')],
      edges: [edgeOf('component:a', 'component:ghost', 'Dependency')],
    };
    expect(() => checkInvariant(invariant, danglingEdge)).toThrow(/does not exist/);
    expect(() => checkInvariant(invariant, null as never)).toThrow();
    expect(() => checkInvariant(invariant, { nodes: [] } as never)).toThrow();
  });
});

describe('negative: reconciliation inputs', () => {
  it('rejects a non-ImplementationModel observed value', () => {
    expect(() => reconcile({ nope: true } as never, createDeclaredGraphArtifact())).toThrow(
      ReconciliationError,
    );
    expect(() => reconcile(null as never, createDeclaredGraphArtifact())).toThrow(ReconciliationError);
  });

  it('rejects an observed model whose id is not a well-formed ImplementationModel id', () => {
    const graph = createDeclaredGraphArtifact();
    expect(() =>
      reconcile({ ...observedModel(), id: 'billing-model' }, graph),
    ).toThrow(/well-formed artifact id/);
    expect(() =>
      reconcile(
        { ...observedModel(), id: `sos://Evidence/${'0'.repeat(32)}` },
        graph,
      ),
    ).toThrow(/must be a sos:\/\/ImplementationModel\/ artifact id/);
  });

  it('rejects an invalid declared graph artifact', () => {
    const model = observedModel();
    expect(() => reconcile(model, null as never)).toThrow(ReconciliationError);
    expect(() =>
      reconcile(model, { envelope: { kind: 'Mission' } } as never),
    ).toThrow(ReconciliationError);
  });

  it('rejects malformed kind maps', () => {
    const model = observedModel();
    expect(() =>
      normalizeImplementationModel(model, { componentKindMap: { service: '' } }),
    ).toThrow(/non-empty strings/);
    expect(() =>
      normalizeImplementationModel(model, { dependencyKindMap: null as never }),
    ).toThrow(/plain object/);
    expect(() => reconcile(model, createDeclaredGraphArtifact(), { componentKindMap: [] as never })).toThrow(
      ReconciliationError,
    );
  });

  it('propagates spine classifier errors for malformed normalized models', () => {
    const model = observedModel();
    const duplicateDeps = {
      ...model,
      dependencies: [
        { source: 'component:billing', target: 'component:invoice-mailer', kind: 'uses' },
        { source: 'component:billing', target: 'component:invoice-mailer', kind: 'imports' },
      ],
    };
    // duplicate observed dependency pairs are rejected by the spine classifier
    expect(() => reconcile(duplicateDeps, createDeclaredGraphArtifact())).toThrow(/duplicate observed dependency pair/);
  });
});

describe('negative: drift evidence builder', () => {
  it('rejects classifications outside DRIFT/CONTRADICTION', () => {
    expect(() =>
      buildDriftEvidenceRecord({
        classification: 'IMPLEMENTATION_DETAIL' as never,
        subject: 'component:x',
        subject_ref: `sos://ArchitectureGraph/${'1'.repeat(32)}`,
        reason: 'r',
        model_id: MODEL_ID,
        source_revision: MODEL_REVISION,
      }),
    ).toThrow(/must be DRIFT or CONTRADICTION/);
  });

  it('rejects malformed subjects, refs and revisions', () => {
    const base = {
      classification: 'DRIFT' as const,
      subject: 'component:x',
      subject_ref: `sos://ArchitectureGraph/${'1'.repeat(32)}`,
      reason: 'r',
      model_id: MODEL_ID,
      source_revision: MODEL_REVISION,
    };
    expect(() => buildDriftEvidenceRecord({ ...base, subject: '' })).toThrow(/subject must be a non-empty string/);
    expect(() => buildDriftEvidenceRecord({ ...base, subject_ref: 'graph-1' })).toThrow(/well-formed artifact id/);
    expect(() => buildDriftEvidenceRecord({ ...base, model_id: 'model-1' })).toThrow(/well-formed artifact id/);
    expect(() => buildDriftEvidenceRecord({ ...base, source_revision: '' })).toThrow(/exact revisions only/);
    expect(() => buildDriftEvidenceRecord({ ...base, reason: '' })).toThrow(/reason must be a non-empty string/);
  });
});

describe('negative: guard rejects malformed drift records', () => {
  it('rejects records violating the Evidence contract or the W2 extension', () => {
    const record = buildDriftEvidenceRecord({
      classification: 'DRIFT',
      subject: 'component:x',
      subject_ref: `sos://ArchitectureGraph/${'1'.repeat(32)}`,
      reason: 'r',
      model_id: MODEL_ID,
      source_revision: MODEL_REVISION,
    });
    // sanity: the well-formed record passes
    expect(isDriftEvidenceRecord(record)).toBe(true);
    expect(isDriftEvidenceRecord({ ...record, availability: 'FAILURE' })).toBe(false);
    expect(isDriftEvidenceRecord({ ...record, classification: 'PASS' })).toBe(false);
    expect(isDriftEvidenceRecord({ ...record, kind: 'telemetry' })).toBe(false);
    expect(isDriftEvidenceRecord({ ...record, id: 'evidence-1' })).toBe(false);
    expect(isDriftEvidenceRecord({ ...record, subject: '' })).toBe(false);
    expect(isDriftEvidenceRecord(null)).toBe(false);
  });
});
