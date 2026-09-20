import { describe, expect, it } from 'vitest';
import {
  CausalKnowledgeStore,
  assertValidCausalHypothesis,
  createCausalHypothesis,
  createCorrelationRecord,
} from '../src/index.js';
import {
  PROVENANCE,
  T0,
  T1,
  T2,
  sampleCorrelationContent,
  sampleHypothesisContent,
} from './helpers.js';

describe('CausalKnowledgeStore put/get/list', () => {
  it('stores and retrieves hypotheses and correlations', () => {
    const store = new CausalKnowledgeStore();
    const hypothesis = createCausalHypothesis({
      content: sampleHypothesisContent(),
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
    });
    const correlation = createCorrelationRecord({
      content: sampleCorrelationContent(),
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
    });
    store.putHypothesis(hypothesis);
    store.putCorrelation(correlation);
    expect(store.has(hypothesis.envelope.id)).toBe(true);
    expect(store.has(correlation.envelope.id)).toBe(true);
    expect(store.getHypothesis(hypothesis.envelope.id)).toEqual(hypothesis);
    expect(store.getCorrelation(correlation.envelope.id)).toEqual(correlation);
    expect(store.getHypothesis(correlation.envelope.id)).toBeUndefined();
    expect(store.getCorrelation(hypothesis.envelope.id)).toBeUndefined();
    expect(store.hypothesisCount).toBe(1);
    expect(store.correlationCount).toBe(1);
  });

  it('minted SUPPORTS links trace every distinct evidence reference to the artifact', () => {
    const store = new CausalKnowledgeStore();
    const content = sampleHypothesisContent({ observational: 2, interventionalSuccess: 2 });
    const hypothesis = createCausalHypothesis({
      content,
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
    });
    store.putHypothesis(hypothesis);
    const supporting = store.evidenceSupporting(hypothesis.envelope.id);
    expect(supporting.length).toBe(4);
    expect(supporting.every((link) => link.type === 'SUPPORTS')).toBe(true);
    const evidenceIds = new Set([
      ...content.observational_evidence.map((ref) => ref.evidence_id),
      ...content.interventional_evidence.map((ref) => ref.evidence_id),
    ]);
    expect(new Set(supporting.map((link) => link.source))).toEqual(evidenceIds);
  });

  it('listings are sorted by id (deterministic regardless of insertion order)', () => {
    const store = new CausalKnowledgeStore();
    const artifacts = [1, 2, 3].map((i) =>
      createCausalHypothesis({
        content: sampleHypothesisContent({ observational: i }),
        provenance: PROVENANCE,
        created_at: T0,
        status: 'ACTIVE',
      }),
    );
    for (const artifact of [...artifacts].reverse()) {
      store.putHypothesis(artifact);
    }
    const listed = store.listHypotheses().map((h) => h.envelope.id);
    expect(listed).toEqual([...listed].sort());
    expect(listed).toEqual(artifacts.map((a) => a.envelope.id).sort());
  });
});

describe('CausalKnowledgeStore revision discipline', () => {
  it('revises an ACTIVE hypothesis: version + 1, supersedes, DERIVED_FROM link, preserved correlation origin', () => {
    const store = new CausalKnowledgeStore();
    const root = createCausalHypothesis({
      content: sampleHypothesisContent(),
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
    });
    store.putHypothesis(root);

    const { previous, revised, revision_link } = store.reviseHypothesis(root.envelope.id, {
      content: sampleHypothesisContent({ observational: 2 }),
      provenance: PROVENANCE,
      created_at: T1,
    });

    expect(previous.envelope.status).toBe('SUPERSEDED');
    expect(revised.envelope.version).toBe(2);
    expect(revised.envelope.supersedes).toBe(root.envelope.id);
    expect(revised.envelope.status).toBe('ACTIVE');
    expect(revised.envelope.id).not.toBe(root.envelope.id);
    expect(revision_link.type).toBe('DERIVED_FROM');
    expect(revision_link.source).toBe(revised.envelope.id);
    expect(revision_link.target).toBe(root.envelope.id);
    expect(() => assertValidCausalHypothesis(revised)).not.toThrow();

    // Chain integrity:
    const history = store.history(revised.envelope.id);
    expect(history.map((h) => h.envelope.version)).toEqual([1, 2]);
    expect(store.activeHypotheses().map((h) => h.envelope.id)).toEqual([revised.envelope.id]);
  });

  it('a revision that drops the interventional evidence cannot stay CAUSAL', () => {
    const store = new CausalKnowledgeStore();
    const root = createCausalHypothesis({
      content: sampleHypothesisContent({ claimStrength: 'CAUSAL' }),
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
    });
    store.putHypothesis(root);
    expect(() =>
      store.reviseHypothesis(root.envelope.id, {
        content: sampleHypothesisContent({ claimStrength: 'CAUSAL', interventionalSuccess: 0, observational: 4 }),
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/causal claim rejected/);
    // The store is unchanged by the failed revision:
    expect(store.hypothesisCount).toBe(1);
    expect(store.activeHypotheses()[0]!.envelope.id).toBe(root.envelope.id);
  });

  it('revising a DRAFT hypothesis is rejected (ACTIVE-only revision)', () => {
    const store = new CausalKnowledgeStore();
    const draft = createCausalHypothesis({
      content: sampleHypothesisContent(),
      provenance: PROVENANCE,
      created_at: T0,
    });
    store.putHypothesis(draft);
    expect(() =>
      store.reviseHypothesis(draft.envelope.id, {
        content: sampleHypothesisContent(),
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/only ACTIVE/);
  });

  it('the promotion path stores the hypothesis and traces the derivation', () => {
    const store = new CausalKnowledgeStore();
    const correlation = createCorrelationRecord({
      content: sampleCorrelationContent(),
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
    });
    store.putCorrelation(correlation);

    const { hypothesis, derivation_link } = store.hypothesize(correlation.envelope.id, {
      content: sampleHypothesisContent({ claimStrength: 'CAUSAL' }),
      provenance: PROVENANCE,
      created_at: T1,
    });
    expect(store.getHypothesis(hypothesis.envelope.id)).toEqual(hypothesis);
    expect(hypothesis.content.correlation_origin).toBe(correlation.envelope.id);
    expect(store.evidenceSupporting(hypothesis.envelope.id).length).toBe(2);
    expect(store.allLinks().some((link) => link.type === 'DERIVED_FROM' && link.source === hypothesis.envelope.id)).toBe(true);
    expect(derivation_link.target).toBe(correlation.envelope.id);
  });

  it('history is complete, contiguous and version-ordered across multiple revisions', () => {
    const store = new CausalKnowledgeStore();
    const root = createCausalHypothesis({
      content: sampleHypothesisContent(),
      provenance: PROVENANCE,
      created_at: T0,
      status: 'ACTIVE',
    });
    store.putHypothesis(root);
    let head = root.envelope.id;
    for (const created_at of [T1, T2]) {
      head = store.reviseHypothesis(head, {
        content: sampleHypothesisContent({ observational: 3 }),
        provenance: PROVENANCE,
        created_at,
      }).revised.envelope.id;
    }
    const history = store.history(head);
    expect(history.map((h) => h.envelope.version)).toEqual([1, 2, 3]);
    expect(history.map((h) => h.envelope.status)).toEqual(['SUPERSEDED', 'SUPERSEDED', 'ACTIVE']);
  });
});
