import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KIND_AMBIGUITIES,
  DEFAULT_MAX_HYPOTHESES,
  isRecoveryHypothesis,
  isRecoveryResult,
  recoverArchitectureHypotheses,
  RECOVERY_STRATEGIES,
} from '../src/index.js';
import { assertValidArchitectureGraphArtifact } from '@sos-2/architecture';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import {
  CREATED_AT,
  MODEL_ID,
  MODEL_REVISION,
  PROJECTS,
  PROVENANCE,
  ambiguousModel,
  unambiguousModel,
} from './helpers.js';

const BASE_INPUT = { projects_system_state: PROJECTS, provenance: PROVENANCE, created_at: CREATED_AT };

describe('recovery: unambiguous evidence yields exactly one hypothesis', () => {
  it('produces a single DIRECT hypothesis with UNAMBIGUOUS uncertainty', () => {
    const result = recoverArchitectureHypotheses({ model: unambiguousModel(), ...BASE_INPUT });
    expect(result.hypotheses).toHaveLength(1);
    expect(result.ambiguity_detected).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.ambiguities).toEqual([]);
    const hypothesis = result.hypotheses[0]!;
    expect(hypothesis.strategy).toBe('DIRECT');
    expect(hypothesis.uncertainty).toBe('UNAMBIGUOUS');
    expect(hypothesis.ambiguities).toEqual([]);
    expect(isRecoveryHypothesis(hypothesis)).toBe(true);
    expect(isRecoveryResult(result)).toBe(true);
  });

  it('mints a DRAFT ArchitectureGraphArtifact projecting the exact SystemState revision', () => {
    const result = recoverArchitectureHypotheses({ model: unambiguousModel(), ...BASE_INPUT });
    const artifact = result.hypotheses[0]!.artifact;
    expect(() => assertValidArchitectureGraphArtifact(artifact)).not.toThrow();
    expect(artifact.envelope.kind).toBe('ArchitectureGraph');
    expect(artifact.envelope.status).toBe('DRAFT'); // recovery proposes; it never activates
    expect(artifact.envelope.version).toBe(1);
    expect(artifact.content.projects_system_state).toEqual(PROJECTS);
    // nodes sorted by id, kinds assigned through the default vocabulary
    expect(artifact.content.nodes.map((node) => [node.id, node.kind])).toEqual([
      ['component:billing', 'Component'],
      ['component:mailer', 'Component'],
    ]);
    expect(artifact.content.edges.map((edge) => [edge.source, edge.target, edge.kind])).toEqual([
      ['component:billing', 'component:mailer', 'Dependency'],
    ]);
  });

  it('carries derivation provenance binding the hypothesis to the exact model revision', () => {
    const result = recoverArchitectureHypotheses({ model: unambiguousModel(), ...BASE_INPUT });
    const derivation = result.hypotheses[0]!.derivation;
    expect(derivation.model_id).toBe(MODEL_ID);
    expect(derivation.model_revision).toBe(MODEL_REVISION);
    expect(derivation.strategy).toBe('DIRECT');
    expect(derivation.kind_assignments).toEqual({ library: 'Component' });
    expect(derivation.input_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(derivation.component_count).toBe(2);
    expect(derivation.dependency_count).toBe(1);
    expect(derivation.interface_count).toBe(0);
    expect(derivation.unresolved_dependency_endpoints).toEqual([]);
    // envelope provenance records the model, revision and strategy
    const artifactProvenance = result.hypotheses[0]!.artifact.envelope.provenance;
    expect(artifactProvenance).toContain(`recovery:model:${MODEL_ID}`);
    expect(artifactProvenance).toContain(`source-revision:${MODEL_REVISION}`);
    expect(artifactProvenance).toContain('recovery:strategy:DIRECT');
  });

  it('links the hypothesis to the source model id via DERIVED_FROM and OBSERVES', () => {
    const result = recoverArchitectureHypotheses({ model: unambiguousModel(), ...BASE_INPUT });
    const hypothesis = result.hypotheses[0]!;
    expect(hypothesis.links).toHaveLength(2);
    for (const link of hypothesis.links) {
      expect(link.source).toBe(hypothesis.artifact.envelope.id);
      expect(link.target).toBe(MODEL_ID);
      expect(link.provenance).toContain(`source-revision:${MODEL_REVISION}`);
    }
    expect(new Set(hypothesis.links.map((link) => link.type))).toEqual(new Set(['DERIVED_FROM', 'OBSERVES']));
  });

  it('never mutates the input model', () => {
    const model = unambiguousModel();
    const before = canonicalSerialize(model);
    recoverArchitectureHypotheses({ model, ...BASE_INPUT });
    expect(canonicalSerialize(model)).toBe(before);
  });
});

describe('recovery: ambiguous evidence yields multiple competing hypotheses', () => {
  it('kind ambiguity (service) retains one hypothesis per candidate kind', () => {
    const result = recoverArchitectureHypotheses({ model: ambiguousModel(), ...BASE_INPUT });
    // 'service' -> Component | Adapter, grouped realizations -> DIRECT + MERGED
    expect(result.hypotheses).toHaveLength(4);
    expect(result.ambiguity_detected).toBe(true);
    const strategies = result.hypotheses.map((hypothesis) => hypothesis.strategy);
    expect(strategies).toEqual(['DIRECT', 'MERGED_REALIZATIONS', 'DIRECT', 'MERGED_REALIZATIONS']);
    // assignment-vector-major order: Component vector first, then Adapter
    expect(result.hypotheses[0]!.derivation.kind_assignments.service).toBe('Component');
    expect(result.hypotheses[2]!.derivation.kind_assignments.service).toBe('Adapter');
    // distinct artifact ids (competing architectures, never collapsed)
    const ids = result.hypotheses.map((hypothesis) => hypothesis.artifact.envelope.id);
    expect(new Set(ids).size).toBe(4);
    for (const hypothesis of result.hypotheses) {
      expect(hypothesis.uncertainty).toBe('AMBIGUOUS');
    }
  });

  it('retains KIND_AMBIGUITY and GROUPED_REALIZATION markers with alternatives', () => {
    const result = recoverArchitectureHypotheses({ model: ambiguousModel(), ...BASE_INPUT });
    const byKind = new Map(result.ambiguities.map((marker) => [marker.kind, marker]));
    const kindMarker = byKind.get('KIND_AMBIGUITY')!;
    expect(kindMarker.subject).toBe('service');
    expect(kindMarker.alternatives).toEqual(['Component', 'Adapter']);
    const groupedMarker = byKind.get('GROUPED_REALIZATION')!;
    expect(groupedMarker.subject).toBe('store:billing-records');
  });

  it('the MERGED_REALIZATIONS hypothesis collapses grouped shards into the realized node', () => {
    const result = recoverArchitectureHypotheses({ model: ambiguousModel(), ...BASE_INPUT });
    const merged = result.hypotheses.find((hypothesis) => hypothesis.strategy === 'MERGED_REALIZATIONS')!;
    const mergedNode = merged.artifact.content.nodes.find((node) => node.id === 'store:billing-records')!;
    expect(mergedNode.attributes['recovery.sources']).toEqual([
      'component:billing-store-shard-a',
      'component:billing-store-shard-b',
    ]);
    expect(mergedNode.attributes['recovery.realizes']).toEqual(['store:billing-records']);
    expect(merged.model_view.components.map((component) => component.id).sort()).toEqual([
      'component:billing',
      'component:mailer',
      'iface:billing-api',
      'store:billing-records',
    ]);
    // the DIRECT hypothesis keeps the shards separate
    const direct = result.hypotheses.find((hypothesis) => hypothesis.strategy === 'DIRECT')!;
    expect(direct.model_view.components.map((component) => component.id)).toContain('component:billing-store-shard-a');
    expect(direct.model_view.components.map((component) => component.id)).not.toContain('store:billing-records');
  });

  it('projects interfaces as Interface nodes with Provides/Consumes edges (the W4 extension)', () => {
    const result = recoverArchitectureHypotheses({ model: ambiguousModel(), ...BASE_INPUT });
    const direct = result.hypotheses.find((hypothesis) => hypothesis.strategy === 'DIRECT')!;
    const interfaceNode = direct.artifact.content.nodes.find((node) => node.id === 'iface:billing-api')!;
    expect(interfaceNode.kind).toBe('Interface');
    expect(interfaceNode.attributes['recovery.provider']).toBe('component:billing');
    expect(interfaceNode.attributes['recovery.consumers']).toEqual(['component:mailer']);
    const edgeKinds = direct.artifact.content.edges
      .filter((edge) => edge.target === 'iface:billing-api')
      .map((edge) => edge.kind)
      .sort();
    expect(edgeKinds).toEqual(['Consumes', 'Provides']);
    // the model view carries the interface as a pseudo-component so the
    // spine classifier can classify it (W0.5 scope note: components + edges)
    expect(direct.model_view.components.find((component) => component.id === 'iface:billing-api')!.kind).toBe(
      'Interface',
    );
  });

  it('retains unresolved dependency endpoints instead of dropping them silently', () => {
    const result = recoverArchitectureHypotheses({ model: ambiguousModel(), ...BASE_INPUT });
    const direct = result.hypotheses.find((hypothesis) => hypothesis.strategy === 'DIRECT')!;
    // the model's dependency component:billing -> store:billing-records
    // references an id that is not a component under DIRECT
    expect(direct.derivation.unresolved_dependency_endpoints).toEqual(['store:billing-records']);
    const marker = direct.ambiguities.find((entry) => entry.kind === 'UNRESOLVED_DEPENDENCY_ENDPOINT')!;
    expect(marker.subject).toBe('store:billing-records');
  });

  it('the default ambiguity vocabulary treats datastore and adapter as ambiguous', () => {
    expect(DEFAULT_KIND_AMBIGUITIES['datastore']).toEqual(['DataStore', 'Component']);
    expect(DEFAULT_KIND_AMBIGUITIES['adapter']).toEqual(['Adapter', 'Component']);
    expect(DEFAULT_KIND_AMBIGUITIES['library']).toEqual(['Component']);
  });
});

describe('recovery: hypothesis-space capping', () => {
  it('truncates deterministically and retains the truncation marker', () => {
    const result = recoverArchitectureHypotheses({
      model: ambiguousModel(),
      ...BASE_INPUT,
      config: { maxHypotheses: 2 },
    });
    expect(result.hypotheses).toHaveLength(2);
    expect(result.truncated).toBe(true);
    const marker = result.ambiguities.find((entry) => entry.kind === 'TRUNCATED_HYPOTHESIS_SPACE')!;
    expect(marker.subject).toBe('4');
    expect(marker.detail).toContain('4 competing readings');
    // strategy diversity survives truncation (vector-major enumeration)
    expect(result.hypotheses.map((hypothesis) => hypothesis.strategy)).toEqual(['DIRECT', 'MERGED_REALIZATIONS']);
  });

  it('defaults to the documented cap', () => {
    expect(DEFAULT_MAX_HYPOTHESES).toBe(16);
    expect(RECOVERY_STRATEGIES).toEqual(['DIRECT', 'MERGED_REALIZATIONS']);
  });
});

describe('recovery: determinism', () => {
  it('identical inputs produce byte-identical results', () => {
    const first = recoverArchitectureHypotheses({ model: ambiguousModel(), ...BASE_INPUT });
    const second = recoverArchitectureHypotheses({
      model: JSON.parse(JSON.stringify(ambiguousModel())),
      ...BASE_INPUT,
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('different provenance yields different hypothesis identities', () => {
    const first = recoverArchitectureHypotheses({ model: unambiguousModel(), ...BASE_INPUT });
    const second = recoverArchitectureHypotheses({
      model: unambiguousModel(),
      ...BASE_INPUT,
      provenance: ['W4:recovery-fixture:other-run'],
    });
    expect(first.hypotheses[0]!.artifact.envelope.id).not.toBe(second.hypotheses[0]!.artifact.envelope.id);
  });
});
