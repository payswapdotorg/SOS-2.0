import { describe, expect, it } from 'vitest';
import { ALTITUDE_RANK, compareCandidates } from '../src/index.js';
import { buildResizeFixture } from './helpers.js';

/**
 * THE diversity-preservation tests: queries return the DIVERSE candidate
 * set across materially different solution families — never collapsed to
 * one winner (spec/architecture.md §11; the lock's forbidden shortcut
 * "universal package winner replacing the diverse repertoire").
 */
describe('diversity preservation (never one winner)', () => {
  it('returns candidates from ALL materially different families (latency / resilience / privacy)', () => {
    const { registry } = buildResizeFixture();
    const result = registry.retrieve({ capability: 'image-resize' });
    // Three materially different families are present in the fixture set
    // (edge-cache, durable-queue, privacy-local) — ALL must be represented.
    expect(result.families).toContain('edge-cache');
    expect(result.families).toContain('durable-queue');
    expect(result.families).toContain('privacy-local');
    expect(result.families).toHaveLength(3);
    expect(result.candidates.length).toBeGreaterThanOrEqual(3);
    const families = result.candidates.map((candidate) => candidate.family);
    expect(new Set(families).size).toBe(3);
  });

  it('the best candidate per family (the representative) is the FIRST occurrence of its family in rank order', () => {
    const { registry } = buildResizeFixture();
    const result = registry.retrieve({ capability: 'image-resize' });
    const seen = new Set<string>();
    for (const candidate of result.candidates) {
      if (!seen.has(candidate.family)) {
        seen.add(candidate.family);
        // First occurrence in the ranked sequence = the family's
        // best-ranked candidate (its representative).
      }
    }
    expect(seen.size).toBe(3);
    // The globally best-ranked candidate is the validated composition
    // (the highest §10 altitude, first by the ranking).
    expect(result.candidates[0]!.altitude).toBe('VALIDATED_COMPOSITION');
    // Every family's first occurrence outranks its later occurrences
    // (the sequence is in total rank order by default — no caps applied).
    const firstIndexOf = new Map<string, number>();
    result.candidates.forEach((candidate, index) => {
      if (!firstIndexOf.has(candidate.family)) {
        firstIndexOf.set(candidate.family, index);
      }
    });
    const ranked = [...result.candidates].sort(compareCandidates);
    result.candidates.forEach((candidate) => {
      expect(ranked.indexOf(candidate)).toBeGreaterThanOrEqual(firstIndexOf.get(candidate.family)!);
    });
  });

  it('a dominant family with multiple high-altitude entries never crowds out the other families', () => {
    const { registry } = buildResizeFixture();
    // The edge-cache family already dominates: the validated composition +
    // two validated packages (3 entries) vs 1 entry per other family.
    const result = registry.retrieve({ capability: 'image-resize', maxResults: 3 });
    // Even with maxResults = 3, every family's representative survives — the
    // cap can never remove a family's sole entry.
    expect(result.families.sort()).toEqual(['durable-queue', 'edge-cache', 'privacy-local']);
    expect(result.candidates).toHaveLength(3);
    expect(new Set(result.candidates.map((candidate) => candidate.family)).size).toBe(3);
  });

  it('maxPerFamily caps non-representative members without removing representatives', () => {
    const { registry } = buildResizeFixture();
    const unbounded = registry.retrieve({ capability: 'image-resize', maxPerFamily: 99 });
    const edgeCount = unbounded.candidates.filter((candidate) => candidate.family === 'edge-cache').length;
    expect(edgeCount).toBe(3); // composition + 2 edge packages
    const capped = registry.retrieve({ capability: 'image-resize', maxPerFamily: 1 });
    expect(capped.families).toEqual(['durable-queue', 'edge-cache', 'privacy-local']);
    for (const family of capped.families) {
      expect(capped.candidates.filter((candidate) => candidate.family === family)).toHaveLength(1);
    }
  });

  it('there is NO single-winner API — retrieve always returns the diverse set', () => {
    const { registry } = buildResizeFixture();
    const result = registry.retrieve({ capability: 'image-resize', context: { deployment: 'edge' } });
    // Even when the edge context matches only the edge-cache family's
    // estimates, other families are still returned (unmatched, honest).
    expect(result.families).toContain('durable-queue');
    expect(result.families).toContain('privacy-local');
    const matched = result.candidates.filter((candidate) => candidate.context_match === 'MATCHED');
    const unmatched = result.candidates.filter((candidate) => candidate.context_match === 'UNMATCHED');
    expect(matched.length).toBeGreaterThan(0);
    expect(unmatched.length).toBeGreaterThan(0);
    // Within the TOTAL ranking order (exported comparator), matched
    // candidates outrank unmatched ones at equal altitude — the §10 ladder
    // outranks context matching, never the other way around.
    const ranked = [...result.candidates].sort(compareCandidates);
    for (let i = 0; i < ranked.length; i += 1) {
      for (let j = 0; j < ranked.length; j += 1) {
        const a = ranked[i]!;
        const b = ranked[j]!;
        if (i < j && ALTITUDE_RANK[a.altitude] === ALTITUDE_RANK[b.altitude]) {
          if (a.context_match === 'MATCHED' && b.context_match === 'UNMATCHED') {
            expect(compareCandidates(a, b)).toBeLessThan(0);
          }
        }
      }
    }
    // The globally best-ranked candidate is the matched, calibrated,
    // validated-composition edge-cache representative.
    expect(ranked[0]!.family).toBe('edge-cache');
    expect(ranked[0]!.context_match).toBe('MATCHED');
    expect(ranked[0]!.altitude).toBe('VALIDATED_COMPOSITION');
    expect(new Set(result.candidates.map((candidate) => candidate.family)).size).toBe(3);
  });

  it('family_counts and altitudes_present summarize the diverse result honestly', () => {
    const { registry } = buildResizeFixture();
    const result = registry.retrieve({ capability: 'image-resize' });
    expect(result.family_counts['edge-cache']).toBe(3);
    expect(result.family_counts['durable-queue']).toBe(1);
    expect(result.family_counts['privacy-local']).toBe(1);
    expect(result.altitudes_present[0]).toBe('VALIDATED_COMPOSITION');
  });
});
