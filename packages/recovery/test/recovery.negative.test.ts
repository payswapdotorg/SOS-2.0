import { describe, expect, it } from 'vitest';
import {
  buildAmbiguityMarker,
  generateReconciliationReport,
  isAmbiguityMarker,
  isRecoveryHypothesis,
  isRecoveryResult,
  recoverArchitectureHypotheses,
  RecoveryError,
  sectionsFromComparisons,
  compareWithDeclared,
} from '../src/index.js';
import {
  CREATED_AT,
  MODEL_ID,
  MODEL_REVISION,
  PROJECTS,
  PROVENANCE,
  ambiguousModel,
  createDeclaredGraphArtifact,
  unambiguousModel,
} from './helpers.js';

const BASE_INPUT = { projects_system_state: PROJECTS, provenance: PROVENANCE, created_at: CREATED_AT };

describe('negative: recovery input discipline', () => {
  it('rejects missing or empty provenance (no provenance-less recovery)', () => {
    expect(() =>
      recoverArchitectureHypotheses({ model: unambiguousModel(), ...BASE_INPUT, provenance: [] }),
    ).toThrow(RecoveryError);
    expect(() =>
      recoverArchitectureHypotheses({ model: unambiguousModel(), ...BASE_INPUT, provenance: [''] }),
    ).toThrow(/provenance must be a non-empty array/);
    expect(() =>
      recoverArchitectureHypotheses({ model: unambiguousModel(), ...BASE_INPUT, provenance: undefined as never }),
    ).toThrow(RecoveryError);
  });

  it('rejects non-RFC3339 creation timestamps', () => {
    expect(() =>
      recoverArchitectureHypotheses({ model: unambiguousModel(), ...BASE_INPUT, created_at: '2025-06-01' }),
    ).toThrow(/RFC3339/);
    expect(() =>
      recoverArchitectureHypotheses({ model: unambiguousModel(), ...BASE_INPUT, created_at: '' }),
    ).toThrow(/RFC3339/);
  });

  it('rejects models that do not match the ImplementationModel contract', () => {
    expect(() => recoverArchitectureHypotheses({ model: { nope: true } as never, ...BASE_INPUT })).toThrow(
      /ImplementationModel contract/,
    );
    expect(() => recoverArchitectureHypotheses({ model: null as never, ...BASE_INPUT })).toThrow(RecoveryError);
  });

  it('rejects model ids that are not sos://ImplementationModel/ ids', () => {
    const model = { ...unambiguousModel(), id: 'not-an-id' };
    expect(() => recoverArchitectureHypotheses({ model, ...BASE_INPUT })).toThrow(/model.id/);
    const wrongKind = { ...unambiguousModel(), id: 'sos://ArchitectureGraph/00000000000000000000000000000000' };
    expect(() => recoverArchitectureHypotheses({ model: wrongKind, ...BASE_INPUT })).toThrow(
      /sos:\/\/ImplementationModel\//,
    );
  });

  it('rejects empty revisions (exact revisions only — the spine contract fires first)', () => {
    const model = { ...unambiguousModel(), revision: '' };
    expect(() => recoverArchitectureHypotheses({ model, ...BASE_INPUT })).toThrow(
      /ImplementationModel contract/,
    );
  });

  it('rejects duplicate component and interface ids', () => {
    const model = {
      ...unambiguousModel(),
      components: [
        { id: 'component:billing', kind: 'library', realized_by: [], realizes: [] },
        { id: 'component:billing', kind: 'library', realized_by: [], realizes: [] },
      ],
    };
    expect(() => recoverArchitectureHypotheses({ model, ...BASE_INPUT })).toThrow(/duplicate observed component id/);
    const model2 = {
      ...unambiguousModel(),
      interfaces: [
        { id: 'iface:a', provider: 'component:billing', contract_ref: null, consumers: [] },
        { id: 'iface:a', provider: 'component:billing', contract_ref: null, consumers: [] },
      ],
    };
    expect(() => recoverArchitectureHypotheses({ model: model2, ...BASE_INPUT })).toThrow(
      /duplicate observed interface id/,
    );
  });

  it('rejects component/interface/dependency ids that cannot become graph node ids', () => {
    const model = {
      ...unambiguousModel(),
      components: [{ id: 'has space', kind: 'library', realized_by: [], realizes: [] }],
    };
    expect(() => recoverArchitectureHypotheses({ model, ...BASE_INPUT })).toThrow(/graph node id/);
    const model2 = {
      ...unambiguousModel(),
      dependencies: [{ source: 'component:billing', target: 'component:mailer', kind: 'uses' }, { source: 'component:billing', target: 'ünïcode', kind: 'uses' }],
    };
    expect(() => recoverArchitectureHypotheses({ model: model2, ...BASE_INPUT })).toThrow(/graph-node-id shaped/);
  });

  it('rejects invalid projects_system_state references', () => {
    expect(() =>
      recoverArchitectureHypotheses({
        model: unambiguousModel(),
        provenance: PROVENANCE,
        created_at: CREATED_AT,
        projects_system_state: { system_state_id: 'sos://NotSystemState/00000000000000000000000000000000', version: 1 },
      }),
    ).toThrow(/projects_system_state/);
    expect(() =>
      recoverArchitectureHypotheses({
        model: unambiguousModel(),
        provenance: PROVENANCE,
        created_at: CREATED_AT,
        projects_system_state: { system_state_id: 'sos://SystemState/0000', version: 0 },
      }),
    ).toThrow(/projects_system_state/);
  });
});

describe('negative: recovery configuration discipline', () => {
  it('rejects kind ambiguity sets with empty, duplicate or unregistered candidates', () => {
    expect(() =>
      recoverArchitectureHypotheses({
        model: unambiguousModel(),
        ...BASE_INPUT,
        config: { kindAmbiguities: { service: [] } },
      }),
    ).toThrow(/non-empty array of candidate node kinds/);
    expect(() =>
      recoverArchitectureHypotheses({
        model: unambiguousModel(),
        ...BASE_INPUT,
        config: { kindAmbiguities: { service: ['Component', 'Component'] } },
      }),
    ).toThrow(/duplicate candidates/);
    expect(() =>
      recoverArchitectureHypotheses({
        model: unambiguousModel(),
        ...BASE_INPUT,
        config: { kindAmbiguities: { service: ['Component', 'Banana'] } },
      }),
    ).toThrow(/not a registered architecture node kind/);
  });

  it('rejects kind maps with unregistered targets', () => {
    expect(() =>
      recoverArchitectureHypotheses({
        model: unambiguousModel(),
        ...BASE_INPUT,
        config: { componentKindMap: { library: 'Banana' } },
      }),
    ).toThrow(/not a registered architecture node kind/);
    expect(() =>
      recoverArchitectureHypotheses({
        model: unambiguousModel(),
        ...BASE_INPUT,
        config: { dependencyKindMap: { uses: 'Banana' } },
      }),
    ).toThrow(/not a registered architecture edge kind/);
  });

  it('rejects invalid hypothesis caps and envelope controls', () => {
    for (const maxHypotheses of [0, 1, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(() =>
        recoverArchitectureHypotheses({
          model: unambiguousModel(),
          ...BASE_INPUT,
          config: { maxHypotheses },
        }),
      ).toThrow(/maxHypotheses/);
    }
    expect(() =>
      recoverArchitectureHypotheses({
        model: unambiguousModel(),
        ...BASE_INPUT,
        config: { authority_ref: 'not-an-id' },
      }),
    ).toThrow(/authority_ref/);
    expect(() =>
      recoverArchitectureHypotheses({ model: unambiguousModel(), ...BASE_INPUT, config: { version: 0 } }),
    ).toThrow(/version/);
  });
});

describe('negative: ambiguity is never collapsed into one architecture', () => {
  it('kind-ambiguous input MUST produce multiple hypotheses (not one)', () => {
    const model = {
      ...unambiguousModel(),
      components: [{ id: 'component:billing', kind: 'service', realized_by: [], realizes: [] }],
    };
    const result = recoverArchitectureHypotheses({ model, ...BASE_INPUT });
    expect(result.hypotheses.length).toBeGreaterThan(1);
    expect(result.ambiguity_detected).toBe(true);
  });

  it('grouped-realization input MUST produce multiple hypotheses (not one)', () => {
    const model = {
      ...unambiguousModel(),
      components: [
        { id: 'component:billing', kind: 'library', realized_by: [], realizes: [] },
        { id: 'component:shard-a', kind: 'library', realized_by: [], realizes: ['store:billing-records'] },
      ],
    };
    const result = recoverArchitectureHypotheses({ model, ...BASE_INPUT });
    expect(result.hypotheses.length).toBeGreaterThan(1);
    const strategies = new Set(result.hypotheses.map((hypothesis) => hypothesis.strategy));
    expect(strategies).toEqual(new Set(['DIRECT', 'MERGED_REALIZATIONS']));
  });

  it('a result claiming ambiguity with fewer than two hypotheses is rejected by the guard', () => {
    const result = recoverArchitectureHypotheses({ model: unambiguousModel(), ...BASE_INPUT });
    expect(result.ambiguity_detected).toBe(false);
    const conflated = { ...result, ambiguity_detected: true };
    expect(isRecoveryResult(conflated)).toBe(false);
    // and honest results pass
    expect(isRecoveryResult(result)).toBe(true);
    expect(isRecoveryResult(recoverArchitectureHypotheses({ model: ambiguousModel(), ...BASE_INPUT }))).toBe(true);
  });
});

describe('negative: malformed hypothesis and marker records are rejected', () => {
  it('rejects hypothesis records that are not DRAFT ArchitectureGraph envelopes', () => {
    const result = recoverArchitectureHypotheses({ model: unambiguousModel(), ...BASE_INPUT });
    const activated = {
      ...result.hypotheses[0]!,
      artifact: {
        ...result.hypotheses[0]!.artifact,
        envelope: { ...result.hypotheses[0]!.artifact.envelope, status: 'ACTIVE' },
      },
    };
    expect(isRecoveryHypothesis(activated)).toBe(false);
  });

  it('rejects hypothesis records with broken derivations, links or model views', () => {
    const result = recoverArchitectureHypotheses({ model: unambiguousModel(), ...BASE_INPUT });
    const hypothesis = result.hypotheses[0]!;
    expect(isRecoveryHypothesis({ ...hypothesis, links: hypothesis.links.slice(0, 1) })).toBe(false);
    expect(
      isRecoveryHypothesis({
        ...hypothesis,
        derivation: { ...hypothesis.derivation, input_digest: 'not-a-hash' },
      }),
    ).toBe(false);
    expect(isRecoveryHypothesis({ ...hypothesis, model_view: null })).toBe(false);
    expect(isRecoveryHypothesis({ ...hypothesis, strategy: 'SOMETHING_ELSE' })).toBe(false);
    expect(isRecoveryHypothesis(null)).toBe(false);
    expect(isRecoveryHypothesis('DIRECT')).toBe(false);
  });

  it('rejects malformed ambiguity markers', () => {
    expect(isAmbiguityMarker(null)).toBe(false);
    expect(isAmbiguityMarker({ kind: 'NOT_A_KIND', subject: 'x', detail: 'd' })).toBe(false);
    expect(isAmbiguityMarker({ kind: 'KIND_AMBIGUITY', subject: '', detail: 'd' })).toBe(false);
    expect(isAmbiguityMarker({ kind: 'KIND_AMBIGUITY', subject: 'x', detail: '' })).toBe(false);
    expect(isAmbiguityMarker({ kind: 'KIND_AMBIGUITY', subject: 'x', detail: 'd', alternatives: [''] })).toBe(false);
    expect(isAmbiguityMarker({ kind: 'KIND_AMBIGUITY', subject: 'x', detail: 'd', extra: 1 })).toBe(false);
    expect(() => buildAmbiguityMarker({ kind: 'NOPE' as never, subject: 'x', detail: 'd' })).toThrow(RecoveryError);
  });
});

describe('negative: comparison and report input discipline', () => {
  it('rejects comparisons with malformed hypotheses or declared graphs', () => {
    const recovery = recoverArchitectureHypotheses({ model: unambiguousModel(), ...BASE_INPUT });
    expect(() => compareWithDeclared(recovery, null as never)).toThrow(RecoveryError);
    expect(() => compareWithDeclared(recovery, { envelope: null } as never)).toThrow(RecoveryError);
    expect(() => compareWithDeclared(null as never, createDeclaredGraphArtifact())).toThrow(RecoveryError);
    expect(() =>
      compareWithDeclared({ hypotheses: [{ model_view: 'nope' }] } as never, createDeclaredGraphArtifact()),
    ).toThrow(RecoveryError);
  });

  it('rejects report inputs with malformed ids, revisions or sections', () => {
    const good = {
      observed_model_id: MODEL_ID,
      observed_model_revision: MODEL_REVISION,
      declared_architecture_id: createDeclaredGraphArtifact().envelope.id,
      sections: [],
    };
    expect(() => generateReconciliationReport({ ...good, observed_model_id: 'nope' })).toThrow(/observed_model_id/);
    expect(() => generateReconciliationReport({ ...good, observed_model_revision: '' })).toThrow(/revision/);
    expect(() => generateReconciliationReport({ ...good, declared_architecture_id: '' })).toThrow(
      /declared_architecture_id/,
    );
    expect(() => generateReconciliationReport({ ...good, sections: 'nope' as never })).toThrow(/sections/);
    expect(() => generateReconciliationReport({ ...good, sections: [{ label: '', result: null as never }] })).toThrow(
      /label/,
    );
    expect(() => generateReconciliationReport({ ...good, sections: [{ label: 'x', result: {} as never }] })).toThrow(
      /reconcile output/,
    );
    expect(() => generateReconciliationReport({ ...good, ambiguities: [{}] as never })).toThrow(/ambiguity markers/);
    expect(() => generateReconciliationReport(null as never)).toThrow();
  });

  it('rejects sections built from malformed comparison records', () => {
    const recovery = recoverArchitectureHypotheses({ model: ambiguousModel(), ...BASE_INPUT });
    const comparisons = compareWithDeclared(recovery, createDeclaredGraphArtifact());
    const sections = sectionsFromComparisons(comparisons);
    expect(() =>
      generateReconciliationReport({
        observed_model_id: MODEL_ID,
        observed_model_revision: MODEL_REVISION,
        declared_architecture_id: createDeclaredGraphArtifact().envelope.id,
        sections: [
          {
            ...sections[0]!,
            result: {
              ...sections[0]!.result,
              records: [
                { classification: 'BANANA' as never, subject: 'x', reason: 'y', link: null as never },
              ],
            },
          },
        ],
      }),
    ).toThrow(/7 frozen classes/);
  });
});
