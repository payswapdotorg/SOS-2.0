/**
 * Unit tests: the retrieval facade (search context composition).
 */

import { describe, expect, it } from 'vitest';
import { PackageRegistry } from '@sos-2/registry';
import { RetrievalFacade, evaluateCompositionOwnEvidence } from '../src/index.js';
import { buildFixture } from './helpers.js';

describe('RetrievalFacade.query', () => {
  it('composes the diverse candidate set with uncertainty, evidence context, limitations and failures surfaced', () => {
    const fixture = buildFixture();
    const resolver = (id: string) => fixture.allEvidence.find((record) => record.id === id);
    const facade = new RetrievalFacade(fixture.registry);
    const context = facade.query({ capability: 'image-resize', evidenceResolver: resolver });

    // The diverse set: three families, four candidates (composition + edge + durable + privacy).
    expect(context.families).toEqual(['durable-queue', 'edge-cache', 'privacy-local']);
    expect(context.candidates).toHaveLength(4);
    expect(context.matched_count).toBe(4);

    const byFamily = new Map(context.candidates.map((candidate) => [candidate.family, candidate]));
    const durable = byFamily.get('durable-queue')!;
    expect(durable.learned_limitations).toEqual(['higher end-to-end latency under load']);
    expect(durable.failure_contexts).toHaveLength(1);
    expect(durable.failure_contexts[0]!.availability).toBe('FAILURE');
    // Uncertainty is carried verbatim from the registry (never stripped).
    // No query context here: the registry reports NO_QUERY_CONTEXT honestly.
    expect(durable.uncertainty.uncertainty_class).toBe('STRONG');
    expect(durable.uncertainty.basis).toBe('NO_QUERY_CONTEXT');

    const edgeCandidates = context.candidates.filter((candidate) => candidate.family === 'edge-cache');
    expect(edgeCandidates).toHaveLength(2);
    expect(edgeCandidates[0]!.kind).toBe('COMPOSITION');
    expect(edgeCandidates[0]!.altitude).toBe('VALIDATED_COMPOSITION');
    expect(context.altitudes_present).toEqual(['VALIDATED_COMPOSITION', 'VALIDATED_PACKAGE', 'PACKAGE_ADAPTATION']);
  });

  it('preserves the registry rank order (altitude ladder first)', () => {
    const fixture = buildFixture();
    const facade = new RetrievalFacade(fixture.registry);
    const context = facade.query({ capability: 'image-resize' });
    const altitudes = context.candidates.map((candidate) => candidate.altitude);
    expect(altitudes).toEqual(['VALIDATED_COMPOSITION', 'VALIDATED_PACKAGE', 'VALIDATED_PACKAGE', 'PACKAGE_ADAPTATION']);
  });

  it('exposes the composition own-evidence view (own refs, members, independence; member evidence never substitutes)', () => {
    const fixture = buildFixture();
    const facade = new RetrievalFacade(fixture.registry);
    const context = facade.query({ capability: 'image-resize' });
    const composition = context.candidates.find((candidate) => candidate.kind === 'COMPOSITION')!;

    expect(composition.own_evidence).not.toBeNull();
    const own = composition.own_evidence!;
    expect(own.composition_id).toBe(composition.id);
    expect(own.own_evidence_refs).toHaveLength(2);
    expect(own.member_ids).toEqual(fixture.members.map((member) => member.envelope.id));
    expect(own.member_evidence_never_substitutes).toBe(true);
    // The own refs are the composition's own evidence ids, NOT member evidence ids.
    const memberEvidenceIds = new Set(fixture.members.flatMap((member) => member.content.evidence_refs));
    for (const ref of own.own_evidence_refs) {
      expect(memberEvidenceIds.has(ref)).toBe(false);
    }
  });

  it('surfaces honest unresolved evidence when no resolver is supplied (never zero)', () => {
    const fixture = buildFixture();
    const facade = new RetrievalFacade(fixture.registry);
    const context = facade.query({ capability: 'image-resize' });
    for (const candidate of context.candidates) {
      expect(candidate.evidence_context.resolved).toBe(0);
      expect(candidate.evidence_context.unresolved).toBe(candidate.evidence_context.total_refs);
      expect(candidate.evidence_context.total_refs).toBeGreaterThan(0);
    }
  });

  it('resolves evidence context through the caller-supplied resolver', () => {
    const fixture = buildFixture();
    const resolver = (id: string) => fixture.allEvidence.find((record) => record.id === id);
    const facade = new RetrievalFacade(fixture.registry);
    const context = facade.query({ capability: 'image-resize', evidenceResolver: resolver });
    const composition = context.candidates.find((candidate) => candidate.kind === 'COMPOSITION')!;
    expect(composition.evidence_context.resolved).toBe(2);
    expect(composition.evidence_context.unresolved).toBe(0);
  });

  it('queries with context: uncertainty reflects the matched calibrated estimate', () => {
    const fixture = buildFixture();
    const facade = new RetrievalFacade(fixture.registry);
    const context = facade.query({ capability: 'image-resize', context: { deployment: 'edge' } });
    const composition = context.candidates.find((candidate) => candidate.kind === 'COMPOSITION')!;
    expect(composition.uncertainty.probability).toBeDefined();
    expect(composition.uncertainty.probability!.value).toBeCloseTo(0.91, 10);
    expect(composition.uncertainty.probability!.sample_size).toBe(24);
    expect(composition.best_estimate).not.toBeNull();
  });

  it('an empty registry yields an honest empty context (no fake data, no error)', () => {
    const facade = new RetrievalFacade(new PackageRegistry());
    const context = facade.query({ capability: 'anything' });
    expect(context.candidates).toEqual([]);
    expect(context.families).toEqual([]);
    expect(context.matched_count).toBe(0);
    expect(context.total_current_entries).toBe(0);
  });

  it('exposes the injected registry (the data authority) and full registry candidates verbatim', () => {
    const fixture = buildFixture();
    const facade = new RetrievalFacade(fixture.registry);
    expect(facade.registry).toBe(fixture.registry);
    const context = facade.query({ capability: 'image-resize' });
    for (const candidate of context.candidates) {
      expect(candidate.retrieval.id).toBe(candidate.id);
      expect(candidate.retrieval.family).toBe(candidate.family);
      expect(candidate.retrieval.uncertainty).toEqual(candidate.uncertainty);
    }
  });
});

describe('composition own-evidence evaluation (through the facade)', () => {
  it('validates own evidence about the composition chain through the W6 authority', () => {
    const fixture = buildFixture();
    const facade = new RetrievalFacade(fixture.registry);
    const context = facade.query({ capability: 'image-resize' });
    const composition = context.candidates.find((candidate) => candidate.kind === 'COMPOSITION')!;
    const resolver = (id: string) => fixture.allEvidence.find((record) => record.id === id);
    // The own evidence was recorded about the composition's v1 root — pass
    // the chain id so it counts as evidence about the composition's chain.
    const verdict = evaluateCompositionOwnEvidence(composition, resolver, [fixture.compositionRoot.envelope.id]);
    expect(verdict.valid).toBe(true);
    expect(verdict.foreign_refs).toEqual([]);
    expect(verdict.summary.total).toBe(2);
  });
});
