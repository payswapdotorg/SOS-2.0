import { describe, expect, it } from 'vitest';
import { ALTITUDE_RANK } from '../src/index.js';
import { buildResizeFixture } from './helpers.js';

describe('retrieval: altitude ordering (spec/architecture.md §10, typed field)', () => {
  it('ranks validated compositions before validated packages before adaptation-level entries', () => {
    const { registry } = buildResizeFixture();
    const result = registry.retrieve({ capability: 'image-resize' });
    expect(result.matched_count).toBe(5); // composition + 3 packages + privacy-local
    expect(result.candidates.length).toBeGreaterThanOrEqual(4);
    const altitudes = result.candidates.map((candidate) => candidate.altitude);
    // The typed §10 ladder is honored in ranking (monotone non-decreasing rank).
    const ranks = altitudes.map((altitude) => ALTITUDE_RANK[altitude]);
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]!);
    }
    expect(altitudes[0]).toBe('VALIDATED_COMPOSITION');
    expect(result.candidates[0]!.kind).toBe('COMPOSITION');
    // The FORMING privacy-local package surfaces at the adaptation altitude.
    expect(altitudes).toContain('PACKAGE_ADAPTATION');
    expect(result.altitudes_present).toEqual(['VALIDATED_COMPOSITION', 'VALIDATED_PACKAGE', 'PACKAGE_ADAPTATION']);
  });

  it('SUPERSEDED packages are NEVER returned as current (the mandated rejection)', () => {
    const { registry, durableQueue } = buildResizeFixture();
    const before = registry.retrieve({ capability: 'image-resize' });
    expect(before.candidates.map((candidate) => candidate.id)).toContain(durableQueue.envelope.id);

    // Replace the durable-queue package with a successor of the same family.
    const replacementId = registry
      .retrieve({ capability: 'image-resize' })
      .candidates.find((candidate) => candidate.family === 'durable-queue')!.id;
    const replacement = {
      ...registry.get(replacementId)!.artifact,
    };
    // Promote the durable-queue head to SUPERSEDED, pointing at the replacement.
    registry.promote({
      id: durableQueue.envelope.id,
      target: 'SUPERSEDED',
      superseded_by: replacement.envelope.id,
      provenance: ['w6:registry-test:supersede-retrieval'],
      created_at: '2025-01-05T00:00:00.000Z',
      changes: 'replaced by the successor',
    });

    const after = registry.retrieve({ capability: 'image-resize' });
    // The superseded chain is gone from the candidate set...
    const ids = after.candidates.map((candidate) => candidate.id);
    expect(ids).not.toContain(durableQueue.envelope.id);
    // ...but current() is honest about its terminal state and its replacement.
    const head = registry.current(durableQueue.envelope.id)!;
    expect(head.artifact.content.maturity).toBe('SUPERSEDED');
    expect(head.artifact.content.superseded_by).toBe(replacement.envelope.id);
    expect(after.families).not.toContain('durable-queue');
    expect(after.matched_count).toBe(4);
  });

  it('RETIRED and DRAFT-envelope entries are never returned either', () => {
    const { registry, privacyLocal } = buildResizeFixture();
    registry.retire({
      id: privacyLocal.envelope.id,
      provenance: ['t'],
      created_at: '2025-01-05T00:00:00.000Z',
      changes: 'abandoned',
    });
    const after = registry.retrieve({ capability: 'image-resize' });
    expect(after.candidates.map((candidate) => candidate.id)).not.toContain(privacyLocal.envelope.id);
    expect(after.families).not.toContain('privacy-local');
  });
});

describe('retrieval: results carry uncertainty + evidence context + limitations + failures', () => {
  it('carries the calibrated uncertainty (value, sample size, window, calibration ref) when context matches', () => {
    const { registry } = buildResizeFixture();
    const result = registry.retrieve({ capability: 'image-resize', context: { deployment: 'edge' } });
    const composition = result.candidates[0]!;
    expect(composition.uncertainty.basis).toBe('MATCHED_ESTIMATE');
    expect(composition.uncertainty.probability).toBeDefined();
    expect(composition.uncertainty.probability!.value).toBeCloseTo(0.91);
    expect(composition.uncertainty.probability!.sample_size).toBe(24);
    expect(composition.uncertainty.probability!.window).toEqual({ start: '2025-01-02T00:00:00.000Z', end: '2025-01-03T12:30:00.000Z' });
    expect(composition.uncertainty.probability!.calibration_ref).toMatch(/^sos:\/\/Evaluation\//);
    expect(composition.context_match).toBe('MATCHED');
    expect(composition.best_estimate?.kind).toBe('CALIBRATED');
  });

  it('carries honest UNQUANTIFIED uncertainty when no estimate matches the query context', () => {
    const { registry } = buildResizeFixture();
    const result = registry.retrieve({ capability: 'image-resize', context: { deployment: 'moon' } });
    const composition = result.candidates[0]!;
    expect(composition.context_match).toBe('UNMATCHED');
    expect(composition.uncertainty.basis).toBe('NO_MATCHING_ESTIMATE');
    expect(composition.uncertainty.probability).toBeUndefined();
    expect(composition.uncertainty.uncertainty_class).toBe('UNQUANTIFIED');
    // The candidate is still RETURNED (honestly unmatched) — ranked below matches.
    expect(result.candidates.map((candidate) => candidate.context_match)).toContain('UNMATCHED');
  });

  it('resolves evidence context through the resolver (classes, successes, failures, unresolved)', () => {
    const { registry, composition, compositionEvidence } = buildResizeFixture();
    const resolverMap = new Map(compositionEvidence.map((record) => [record.id, record]));
    const resolved = registry.retrieve({
      capability: 'image-resize',
      evidenceResolver: (id) => resolverMap.get(id),
    });
    const compositionCandidate = resolved.candidates[0]!;
    expect(compositionCandidate.evidence_context.total_refs).toBe(composition.content.evidence_refs.length);
    expect(compositionCandidate.evidence_context.resolved).toBe(composition.content.evidence_refs.length);
    expect(compositionCandidate.evidence_context.unresolved).toBe(0);
    expect(compositionCandidate.evidence_context.successes).toBe(2);
    expect(compositionCandidate.evidence_context.classes.INTERVENTIONAL).toBe(1);

    // Without a resolver: unresolved — never zero, never absence-of-evidence.
    const unresolved = registry.retrieve({ capability: 'image-resize' });
    const compositionUnresolved = unresolved.candidates[0]!;
    expect(compositionUnresolved.evidence_context.resolved).toBe(0);
    expect(compositionUnresolved.evidence_context.unresolved).toBe(composition.content.evidence_refs.length);
  });

  it('carries learned limitations and failure contexts verbatim (failures retained, UNAVAILABLE when unresolved)', () => {
    const { registry, durableQueue } = buildResizeFixture();
    const result = registry.retrieve({ capability: 'image-resize' });
    const durable = result.candidates.find((candidate) => candidate.id === durableQueue.envelope.id)!;
    expect(durable.learned_limitations).toEqual(['higher end-to-end latency under load']);
    expect(durable.failure_contexts).toHaveLength(durableQueue.content.failure_refs.length);
    // Without a resolver the retained failure refs are UNAVAILABLE (a gap is
    // data about missing data — never absence-of-failure).
    expect(durable.failure_contexts.every((context) => context.availability === 'UNAVAILABLE')).toBe(true);

    const withResolver = registry.retrieve({
      capability: 'image-resize',
      evidenceResolver: (id) =>
        durableQueue.content.failure_refs.includes(id)
          ? ({
              id,
              availability: 'FAILURE',
              window: null,
              subject_revision: null,
            } as never)
          : undefined,
    });
    const durableResolved = withResolver.candidates.find((candidate) => candidate.id === durableQueue.envelope.id)!;
    for (const context of durableResolved.failure_contexts) {
      expect(context.availability).toBe('FAILURE');
    }
  });

  it('carries the full applicability set, contracts, dimensions and obligations', () => {
    const { registry, composition } = buildResizeFixture();
    const result = registry.retrieve({ capability: 'image-resize', context: { deployment: 'edge' } });
    const candidate = result.candidates[0]!;
    expect(candidate.applicability.length).toBeGreaterThanOrEqual(2);
    expect(candidate.contracts).toEqual(composition.content.contracts);
    expect(candidate.family).toBe('edge-cache');
    expect(candidate.dimensions[0]!.dimension).toBe('LATENCY');
    expect(candidate.assurance_obligations).toEqual(composition.content.assurance_obligations);
    expect(candidate.members).not.toBeNull();
    expect(candidate.bindings).not.toBeNull();
    expect(candidate.independence).toEqual([]);
    expect(result.total_current_entries).toBeGreaterThanOrEqual(5);
  });

  it('contract filters require candidates to realize ALL requested contracts', () => {
    const { registry } = buildResizeFixture();
    const all = registry.retrieve({ capability: 'image-resize' });
    expect(all.matched_count).toBe(5);
    const filtered = registry.retrieve({
      capability: 'image-resize',
      contracts: ['contract:image-resize/v1'],
    });
    // Only the composition realizes contract:image-resize/v1.
    expect(filtered.matched_count).toBe(1);
    expect(filtered.candidates[0]!.kind).toBe('COMPOSITION');
  });
});

describe('retrieval: query validation', () => {
  it('rejects malformed queries loudly', () => {
    const { registry } = buildResizeFixture();
    expect(() => registry.retrieve({ capability: '' })).toThrow(/capability/);
    expect(() => registry.retrieve({ capability: '  ' })).toThrow(/capability/);
    expect(() => registry.retrieve({ capability: 'x', maxPerFamily: 0 })).toThrow(/maxPerFamily/);
    expect(() => registry.retrieve({ capability: 'x', maxResults: -1 })).toThrow(/maxResults/);
    expect(() => registry.retrieve({ capability: 'x', contracts: [''] })).toThrow(/contracts/);
  });

  it('capability matching is case-insensitive substring', () => {
    const { registry } = buildResizeFixture();
    const result = registry.retrieve({ capability: 'IMAGE-RESIZE' });
    expect(result.matched_count).toBe(5);
    const none = registry.retrieve({ capability: 'quantum-entangle' });
    expect(none.candidates).toEqual([]);
    expect(none.families).toEqual([]);
  });
});
