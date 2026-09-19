import { describe, expect, it } from 'vitest';
import {
  CONFORMANCE_LINK_TYPES,
  isDriftEvidenceRecord,
  normalizeImplementationModel,
  reconcile,
} from '../src/index.js';
import type { ReconciliationConfig } from '../src/index.js';
import { isArtifactId } from '@sos-2/semantic-spine';
import { createDeclaredGraphArtifact, observedModel } from './helpers.js';

describe('reconciliation over the spine classifier', () => {
  it('produces typed records for every finding, with subjects and reasons', () => {
    const result = reconcile(observedModel(), createDeclaredGraphArtifact(), {
      dependencyKindMap: { owns: 'Owns' },
    });
    const bySubject = new Map(result.records.map((record) => [record.subject, record]));

    // nodes-then-edges, subjects ascending (spine order preserved)
    const subjects = result.records.map((record) => record.subject);
    expect(subjects).toEqual([
      'component:billing-store-shard-a',
      'component:billing-store-shard-b',
      'component:billing-utils',
      'component:legacy-exports',
      'iface:billing-api',
      'store:audit-log',
      'store:billing-records',
      'component:billing->component:billing-store-shard-a',
      'component:billing->store:audit-log',
      'component:legacy-exports->component:billing',
    ]);

    expect(bySubject.get('component:legacy-exports')!.classification).toBe('DRIFT');
    expect(bySubject.get('iface:billing-api')!.classification).toBe('DRIFT');
    expect(bySubject.get('store:audit-log')!.classification).toBe('CONTRADICTION');
    expect(bySubject.get('store:billing-records')!.classification).toBe('PRESERVING_REFINEMENT');
    expect(bySubject.get('component:billing-store-shard-a')!.classification).toBe('IMPLEMENTATION_DETAIL');
    expect(bySubject.get('component:billing-utils')!.classification).toBe('IMPLEMENTATION_DETAIL');
    expect(bySubject.get('component:billing->store:audit-log')!.classification).toBe('CONTRADICTION');
    expect(bySubject.get('component:legacy-exports->component:billing')!.classification).toBe('DRIFT');
    expect(bySubject.get('component:billing->component:billing-store-shard-a')!.classification).toBe('IMPLEMENTATION_DETAIL');

    // matched subjects are never reported: component:billing and
    // component:invoice-mailer match after normalization; the
    // component:billing->component:invoice-mailer Dependency and the
    // component:billing->store:billing-records Owns edges match after
    // dependency-kind mapping.
    expect(bySubject.has('component:billing')).toBe(false);
    expect(bySubject.has('component:invoice-mailer')).toBe(false);
    expect(bySubject.has('component:billing->component:invoice-mailer')).toBe(false);
    expect(bySubject.has('component:billing->store:billing-records')).toBe(false);

    // preserving refinement carries the refiners in the reason
    expect(bySubject.get('store:billing-records')!.reason).toContain('component:billing-store-shard-a');
    expect(bySubject.get('store:billing-records')!.reason).toContain('component:billing-store-shard-b');
  });

  it('links every record to the two compared semantic ids with the frozen mapping', () => {
    const model = observedModel();
    const graph = createDeclaredGraphArtifact();
    const result = reconcile(model, graph, { dependencyKindMap: { owns: 'Owns' } });

    for (const record of result.records) {
      expect(record.link.source).toBe(model.id);
      expect(record.link.target).toBe(graph.envelope.id);
      expect(record.link.type).toBe(CONFORMANCE_LINK_TYPES[record.classification]);
      expect(record.link.provenance?.length).toBeGreaterThan(0);
    }
    // link types used in this scenario: OBSERVES (details), REFINES
    // (preserving refinement), CONTRADICTS (drift + contradiction)
    const types = new Set(result.links.map((link) => link.type));
    expect(types).toEqual(new Set(['OBSERVES', 'REFINES', 'CONTRADICTS']));
    // deduplicated links, one per distinct (source, target, type)
    expect(result.links).toHaveLength(3);
  });

  it('produces minimal Evidence-shaped drift records for DRIFT and CONTRADICTION only', () => {
    const model = observedModel();
    const graph = createDeclaredGraphArtifact();
    const result = reconcile(model, graph, { dependencyKindMap: { owns: 'Owns' } });

    expect(result.drift).toHaveLength(5);
    for (const record of result.drift) {
      expect(isDriftEvidenceRecord(record)).toBe(true);
      expect(isArtifactId(record.id)).toBe(true);
      expect(record.id.startsWith('sos://Evidence/')).toBe(true);
      expect(record.subject_ref).toBe(graph.envelope.id);
      expect(record.source_revision).toBe(model.revision);
      expect(record.observational).toBe(true);
      expect(record.availability).toBe('SUCCESS');
      expect(['DRIFT', 'CONTRADICTION']).toContain(record.classification);
      expect(result.records.some((r) => r.subject === record.subject)).toBe(true);
    }
    const driftSubjects = result.drift.map((record) => record.subject).sort();
    expect(driftSubjects).toEqual([
      'component:billing->store:audit-log',
      'component:legacy-exports',
      'component:legacy-exports->component:billing',
      'iface:billing-api',
      'store:audit-log',
    ]);
    // kind distinguishes drift from contradiction
    expect(result.drift.find((r) => r.subject === 'store:audit-log')!.kind).toBe('architecture-contradiction');
    expect(result.drift.find((r) => r.subject === 'iface:billing-api')!.kind).toBe('architecture-drift');
  });

  it('drift record ids are deterministic and reproducible', () => {
    const model = observedModel();
    const graph = createDeclaredGraphArtifact();
    const first = reconcile(model, graph, { dependencyKindMap: { owns: 'Owns' } });
    const second = reconcile(JSON.parse(JSON.stringify(model)) as typeof model, graph, {
      dependencyKindMap: { owns: 'Owns' },
    });
    expect(first.drift.map((r) => r.id)).toEqual(second.drift.map((r) => r.id));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('respects classifier configuration (expected variations, intentional evolutions)', () => {
    const config: ReconciliationConfig = {
      dependencyKindMap: { owns: 'Owns' },
      classifier: {
        intentionalEvolutions: ['component:legacy-exports', 'component:legacy-exports->component:billing'],
        expectedVariations: ['component:billing-utils'],
      },
    };
    const result = reconcile(observedModel(), createDeclaredGraphArtifact(), config);
    const bySubject = new Map(result.records.map((record) => [record.subject, record]));
    expect(bySubject.get('component:legacy-exports')!.classification).toBe('INTENTIONAL_EVOLUTION');
    expect(bySubject.get('component:legacy-exports->component:billing')!.classification).toBe('INTENTIONAL_EVOLUTION');
    expect(bySubject.get('component:billing-utils')!.classification).toBe('EXPECTED_VARIATION');
    // INTENTIONAL_EVOLUTION and EXPECTED_VARIATION produce no drift evidence
    expect(result.drift.some((r) => r.subject === 'component:legacy-exports')).toBe(false);
    expect(result.drift.some((r) => r.subject === 'component:billing-utils')).toBe(false);
    // and their link types follow the frozen mapping
    expect(bySubject.get('component:legacy-exports')!.link.type).toBe('DERIVED_FROM');
    expect(bySubject.get('component:billing-utils')!.link.type).toBe('OBSERVES');
  });

  it('exposes the normalized model it compared (auditability)', () => {
    const model = observedModel();
    const result = reconcile(model, createDeclaredGraphArtifact(), { dependencyKindMap: { owns: 'Owns' } });
    expect(result.normalizedModel.components.find((c) => c.id === 'component:billing')!.kind).toBe('Component');
    expect(result.normalizedModel.dependencies.find((d) => d.target === 'store:billing-records')!.kind).toBe('Owns');
    // the input model is never mutated
    expect(model.components.find((c) => c.id === 'component:billing')!.kind).toBe('service');
    expect(model.dependencies.find((d) => d.target === 'store:billing-records')!.kind).toBe('owns');
  });
});

describe('normalization', () => {
  it('projects component kinds onto node kinds with the documented default', () => {
    const model = observedModel();
    const normalized = normalizeImplementationModel(model);
    // 'service'/'library' are not registered node kinds -> 'Component'
    expect(normalized.components.find((c) => c.id === 'component:billing')!.kind).toBe('Component');
    expect(normalized.components.find((c) => c.id === 'component:billing-utils')!.kind).toBe('Component');
    // registered node kinds pass through untouched
    const withRegistered = normalizeImplementationModel({
      ...model,
      components: [...model.components, { id: 'x:adapter', kind: 'Adapter', realized_by: [], realizes: [] }],
    });
    expect(withRegistered.components.find((c) => c.id === 'x:adapter')!.kind).toBe('Adapter');
  });

  it('honors explicit kind maps', () => {
    const model = observedModel();
    const normalized = normalizeImplementationModel(model, {
      componentKindMap: { library: 'Adapter' },
      dependencyKindMap: { uses: 'Consumes' },
    });
    expect(normalized.components.find((c) => c.id === 'component:billing-utils')!.kind).toBe('Adapter');
    expect(normalized.dependencies.find((d) => d.target === 'component:invoice-mailer')!.kind).toBe('Consumes');
  });

  it('mapped kinds participate in matching (a datastore component matches a DataStore node)', () => {
    const model = observedModel();
    const graph = createDeclaredGraphArtifact();
    // map 'library' -> 'Interface' so the undeclared billing-utils becomes a
    // kind-mismatched counterpart of the declared iface:billing-api node
    const result = reconcile(
      {
        ...model,
        components: [
          { id: 'iface:billing-api', kind: 'http-iface', realized_by: [], realizes: [] },
        ],
        dependencies: [],
      },
      graph,
      { componentKindMap: { 'http-iface': 'Interface' } },
    );
    // iface:billing-api now matches the declared Interface node -> not reported
    expect(result.records.some((r) => r.subject === 'iface:billing-api')).toBe(false);
    // but everything else the model no longer contains is now drift/contradiction
    expect(result.records.some((r) => r.subject === 'component:billing' && r.classification === 'DRIFT')).toBe(true);
  });

  it('unmapped kind mismatches surface as UNKNOWN (correspondence ambiguous)', () => {
    const model = observedModel();
    const graph = createDeclaredGraphArtifact();
    const result = reconcile(
      {
        ...model,
        components: [{ id: 'component:billing', kind: 'Adapter', realized_by: [], realizes: [] }],
        dependencies: [],
      },
      graph,
    );
    const unknown = result.records.find((r) => r.subject === 'component:billing');
    expect(unknown!.classification).toBe('UNKNOWN');
    expect(unknown!.link.type).toBe('DERIVED_FROM');
    expect(unknown!.reason).toContain('ambiguous');
  });
});
