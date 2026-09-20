import { describe, expect, it } from 'vitest';
import {
  CausalKnowledgeStore,
  assertValidCausalHypothesis,
  assertValidInterventionalEvidenceRef,
  assertValidObservationalEvidenceRef,
  assertNoDuplicateEvidenceReferences,
  createCausalHypothesis,
  createCorrelationRecord,
  interventionalEvidenceRef,
  observationalEvidenceRef,
  validateCausalHypothesis,
} from '../src/index.js';
import type { CausalHypothesisContent } from '../src/index.js';
import {
  CALIBRATION,
  PROVENANCE,
  SYSTEM_STATE_R1,
  T0,
  T1,
  llmProducer,
  observationalRecord,
  interventionalRecord,
  sampleCorrelationContent,
  sampleHypothesisContent,
} from './helpers.js';

describe('THE CLAIM GATE: causal upgrades backed only by observational evidence are REJECTED', () => {
  it('rejects a CAUSAL claim with zero interventional evidence at construction', () => {
    expect(() =>
      createCausalHypothesis({
        content: sampleHypothesisContent({ claimStrength: 'CAUSAL', interventionalSuccess: 0 }),
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/causal claim rejected.*intervention/s);
  });

  it('rejects a CAUSAL claim backed by MANY observational records (correlation is never sufficient)', () => {
    expect(() =>
      createCausalHypothesis({
        content: sampleHypothesisContent({ claimStrength: 'CAUSAL', interventionalSuccess: 0, observational: 25 }),
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/causal claim rejected/);
  });

  it('rejects a CAUSAL claim when the only interventional evidence is non-SUCCESS', () => {
    expect(() =>
      createCausalHypothesis({
        content: sampleHypothesisContent({ claimStrength: 'CAUSAL', interventionalSuccess: 0, interventionalOther: 4 }),
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/causal claim rejected/);
  });

  it('rejects the causal upgrade at REVISION time (a correlational hypothesis cannot go causal without interventions)', () => {
    const store = new CausalKnowledgeStore();
    const root = createCausalHypothesis({
      content: sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 }),
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
    });
    store.putHypothesis(root);
    expect(() =>
      store.reviseHypothesis(root.envelope.id, {
        content: sampleHypothesisContent({ claimStrength: 'CAUSAL', interventionalSuccess: 0, observational: 10 }),
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/causal claim rejected/);
  });

  it('rejects the causal upgrade at PROMOTION time (correlation records are never silently promoted)', () => {
    const record = createCorrelationRecord({
      content: sampleCorrelationContent(),
      provenance: PROVENANCE,
      created_at: T0,
    });
    const store = new CausalKnowledgeStore();
    store.putCorrelation(record);
    expect(() =>
      store.hypothesize(record.envelope.id, {
        content: sampleHypothesisContent({ claimStrength: 'CAUSAL', interventionalSuccess: 0, observational: 10 }),
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/causal claim rejected/);
  });

  it('rejects a forged artifact whose CAUSAL claim is not backed by its evidence (assertValid re-checks the gate)', () => {
    const legit = createCausalHypothesis({
      content: sampleHypothesisContent(),
      provenance: PROVENANCE,
      created_at: T0,
    });
    // Strip the interventional array and launder the interventional ref as observational:
    const laundered = legit.content.interventional_evidence.map((ref) => ({
      ...ref,
      evidence_class: 'OBSERVATIONAL' as const,
    }));
    const forged: CausalHypothesisContent = {
      ...legit.content,
      interventional_evidence: [],
      observational_evidence: [...legit.content.observational_evidence, ...laundered],
    };
    expect(() => assertValidCausalHypothesis({ envelope: legit.envelope, content: forged })).toThrow(
      /causal claim rejected/,
    );
    expect(validateCausalHypothesis({ envelope: legit.envelope, content: forged })).toBe(false);
  });
});

describe('evidence-class separation (locked invariant)', () => {
  it('observationalEvidenceRef THROWS on an interventional record (no laundering)', () => {
    expect(() => observationalEvidenceRef(interventionalRecord('laundry-1'))).toThrow(/not OBSERVATIONAL/);
  });

  it('interventionalEvidenceRef THROWS on an observational record', () => {
    expect(() => interventionalEvidenceRef(observationalRecord('laundry-2'))).toThrow(/not INTERVENTIONAL/);
  });

  it('assertValidObservationalEvidenceRef rejects a mismatched class literal', () => {
    const ref = observationalEvidenceRef(observationalRecord('mismatch-1'));
    expect(() => assertValidObservationalEvidenceRef({ ...ref, evidence_class: 'INTERVENTIONAL' })).toThrow(
      /class mismatch/,
    );
    expect(() => assertValidInterventionalEvidenceRef(ref)).toThrow(/class mismatch/);
  });

  it('rejects references to non-Evidence artifact ids', () => {
    const ref = observationalEvidenceRef(observationalRecord('wrong-kind-1'));
    expect(() => assertValidObservationalEvidenceRef({ ...ref, evidence_id: SYSTEM_STATE_R1 })).toThrow(
      /must reference an Evidence artifact/,
    );
    expect(() => assertValidObservationalEvidenceRef({ ...ref, evidence_id: 'not-a-sos-id' })).toThrow(
      /well-formed spine artifact id/,
    );
  });

  it('rejects duplicate evidence citations (within one array or across both)', () => {
    const a = observationalEvidenceRef(observationalRecord('dup-1'));
    const b = observationalEvidenceRef(observationalRecord('dup-1'));
    expect(() => assertNoDuplicateEvidenceReferences([a, b], [])).toThrow(/duplicate evidence reference/);
    // The same evidence record cited in both class arrays (one laundered) is a duplicate:
    const laundered = { ...a, evidence_class: 'INTERVENTIONAL' as const };
    expect(() => assertNoDuplicateEvidenceReferences([a], [laundered])).toThrow(/duplicate evidence reference/);
  });

  it('rejects a hypothesis citing the same evidence record in both class arrays', () => {
    const record = observationalRecord('both-arrays-1');
    const ref = observationalEvidenceRef(record);
    const laundered = { ...ref, evidence_class: 'INTERVENTIONAL' as const };
    const content = sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 });
    expect(() =>
      createCausalHypothesis({
        content: {
          ...content,
          observational_evidence: [ref],
          interventional_evidence: [laundered],
        },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/duplicate evidence reference/);
  });
});

describe('confidence and calibration discipline (spec/meta-model.md)', () => {
  it('rejects numeric confidence without a calibration ref', () => {
    const content = sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 });
    expect(() =>
      createCausalHypothesis({
        content: { ...content, uncertainty: { kind: 'CALIBRATED', value: 0.9 } as never },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/uncertainty is invalid/);
  });

  it('rejects numeric confidence with a malformed calibration ref', () => {
    const content = sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 });
    expect(() =>
      createCausalHypothesis({
        content: { ...content, uncertainty: { kind: 'CALIBRATED', value: 0.9, calibration_ref: 'calibration:v1' } },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/calibration artifact id/);
  });

  it('rejects unknown qualitative uncertainty classes', () => {
    const content = sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 });
    expect(() =>
      createCausalHypothesis({
        content: { ...content, uncertainty: { kind: 'QUALITATIVE', uncertainty_class: 'PRETTY_SURE' } as never },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/uncertainty is invalid/);
  });

  it('rejects calibrated confidence from an LLM producer (self-reported confidence is never calibrated truth)', () => {
    const content = sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 });
    expect(() =>
      createCausalHypothesis({
        content: {
          ...content,
          producer: llmProducer(),
          uncertainty: { kind: 'CALIBRATED', value: 0.9, calibration_ref: CALIBRATION },
        },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/LLM/);
  });

  it('rejects calibrated confidence outside [0, 1]', () => {
    const content = sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 });
    expect(() =>
      createCausalHypothesis({
        content: { ...content, uncertainty: { kind: 'CALIBRATED', value: 1.5, calibration_ref: CALIBRATION } },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/\[0, 1\]/);
  });
});

describe('hypothesis content validation (negative)', () => {
  it('rejects empty statements and mechanisms', () => {
    const content = sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 });
    expect(() => createCausalHypothesis({ content: { ...content, statement: '' }, provenance: PROVENANCE, created_at: T0 })).toThrow(/statement/);
    expect(() => createCausalHypothesis({ content: { ...content, mechanism: '' }, provenance: PROVENANCE, created_at: T0 })).toThrow(/mechanism/);
  });

  it('rejects unknown claim strengths', () => {
    const content = sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 });
    expect(() =>
      createCausalHypothesis({ content: { ...content, claim_strength: 'DEFINITE' as never }, provenance: PROVENANCE, created_at: T0 }),
    ).toThrow(/claim_strength/);
  });

  it('rejects hypotheses without assumptions (a hypothesis always rests on assumptions)', () => {
    const content = sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 });
    expect(() =>
      createCausalHypothesis({ content: { ...content, assumptions: [] }, provenance: PROVENANCE, created_at: T0 }),
    ).toThrow(/assumptions/);
  });

  it('rejects hypotheses without context facts', () => {
    const content = sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 });
    expect(() =>
      createCausalHypothesis({ content: { ...content, context: {} }, provenance: PROVENANCE, created_at: T0 }),
    ).toThrow(/context/);
  });

  it('rejects unfalsifiable hypotheses (no refutation conditions)', () => {
    const content = sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 });
    expect(() =>
      createCausalHypothesis({ content: { ...content, refutations: [] }, provenance: PROVENANCE, created_at: T0 }),
    ).toThrow(/refutations/);
  });

  it('rejects hypotheses without predicted outcomes', () => {
    const content = sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 });
    expect(() =>
      createCausalHypothesis({ content: { ...content, predicted_outcomes: [] }, provenance: PROVENANCE, created_at: T0 }),
    ).toThrow(/predicted_outcomes/);
  });

  it('rejects graphs without a CONTRIBUTES_TO edge (no claimed cause -> effect relation)', () => {
    const content = sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 });
    expect(() =>
      createCausalHypothesis({
        content: { ...content, graph: { factors: content.graph.factors, edges: [] } },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/CONTRIBUTES_TO/);
  });

  it('rejects evidence-less hypotheses (assertion is not evidence)', () => {
    const content = sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 });
    expect(() =>
      createCausalHypothesis({
        content: { ...content, observational_evidence: [], interventional_evidence: [] },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/at least one evidence reference/);
  });

  it('rejects invalid producers', () => {
    const content = sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 });
    expect(() =>
      createCausalHypothesis({
        content: { ...content, producer: { ...llmProducer(), tool: '' } },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/producer is invalid/);
  });

  it('rejects intervention target_refs that are not well-formed spine artifact ids', () => {
    const content = sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 });
    expect(() =>
      createCausalHypothesis({
        content: { ...content, intervention: { description: 'Enable the cache.', target_ref: 'component:cache-layer' } },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/intervention.target_ref/);
    expect(() =>
      createCausalHypothesis({
        content: { ...content, intervention: { description: 'Enable the cache.', target_ref: '' } },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/intervention.target_ref/);
  });

  it('rejects non-object and missing-field content', () => {
    expect(() => createCausalHypothesis({ content: null as never, provenance: PROVENANCE, created_at: T0 })).toThrow(/object/);
    expect(() => createCausalHypothesis({ content: 'x' as never, provenance: PROVENANCE, created_at: T0 })).toThrow(/object/);
    const content = sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 });
    const { mechanism: _mechanism, ...withoutMechanism } = content;
    expect(() =>
      createCausalHypothesis({ content: withoutMechanism as unknown as CausalHypothesisContent, provenance: PROVENANCE, created_at: T0 }),
    ).toThrow(/missing required field/);
  });
});

describe('correlation record validation (negative)', () => {
  it('rejects single-variable "correlations"', () => {
    const content = sampleCorrelationContent();
    expect(() =>
      createCorrelationRecord({
        content: { ...content, variables: [content.variables[0]!] },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/at least two variables/);
  });

  it('rejects duplicate variable ids', () => {
    const content = sampleCorrelationContent();
    expect(() =>
      createCorrelationRecord({
        content: { ...content, variables: [...content.variables, { ...content.variables[0]! }] },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/duplicate correlation variable id/);
  });

  it('rejects unknown directions', () => {
    const content = sampleCorrelationContent();
    expect(() =>
      createCorrelationRecord({
        content: { ...content, direction: 'SIDEWAYS' as never },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/direction/);
  });

  it('rejects evidence-less correlation records', () => {
    const content = sampleCorrelationContent();
    expect(() =>
      createCorrelationRecord({
        content: { ...content, observational_evidence: [], interventional_evidence: [] },
        provenance: PROVENANCE,
        created_at: T0,
      }),
    ).toThrow(/at least one evidence reference/);
  });
});

describe('provenance and store discipline (negative)', () => {
  it('rejects hypotheses without provenance (spine discipline)', () => {
    expect(() =>
      createCausalHypothesis({
        content: sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 }),
        provenance: [],
        created_at: T0,
      }),
    ).toThrow(/provenance/);
  });

  it('rejects supersedes chains against unknown targets', () => {
    const store = new CausalKnowledgeStore();
    const orphan = createCausalHypothesis({
      content: sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 }),
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
      version: 2,
      supersedes: 'sos://CausalHypothesis/00000000000000000000000000000000',
    });
    expect(() => store.putHypothesis(orphan)).toThrow(/supersedes unknown artifact/);
  });

  it('rejects version skips in supersedes chains', () => {
    const store = new CausalKnowledgeStore();
    const root = createCausalHypothesis({
      content: sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 }),
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
    });
    store.putHypothesis(root);
    const skip = createCausalHypothesis({
      content: sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 }),
      provenance: PROVENANCE,
      created_at: T1,
      status: 'ACTIVE',
      version: 3,
      supersedes: root.envelope.id,
    });
    expect(() => store.putHypothesis(skip)).toThrow(/exactly previous.version \+ 1/);
  });

  it('rejects a hypothesis superseding a correlation record (kind integrity)', () => {
    const store = new CausalKnowledgeStore();
    const correlation = createCorrelationRecord({
      content: sampleCorrelationContent(),
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
    });
    store.putCorrelation(correlation);
    const impostor = createCausalHypothesis({
      content: sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 }),
      provenance: PROVENANCE,
      created_at: T1,
      status: 'ACTIVE',
      version: 2,
      supersedes: correlation.envelope.id,
    });
    expect(() => store.putHypothesis(impostor)).toThrow(/cannot supersede a CorrelationRecord/);
  });

  it('rejects revise/hypothesize against unknown ids', () => {
    const store = new CausalKnowledgeStore();
    expect(() =>
      store.reviseHypothesis('sos://CausalHypothesis/00000000000000000000000000000000', {
        content: sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 }),
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/unknown causal hypothesis id/);
    expect(() =>
      store.hypothesize('sos://CorrelationRecord/00000000000000000000000000000000', {
        content: sampleHypothesisContent({ claimStrength: 'CORRELATIONAL', interventionalSuccess: 0 }),
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/unknown correlation record id/);
  });
});
