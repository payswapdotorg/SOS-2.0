import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareCandidates, shapeDiverseCandidateSet } from '../src/index.js';
import type { RetrievalCandidate, RetrievalResult } from '../src/index.js';
import { ALTITUDE_RANK } from '../src/index.js';
import { PackageRegistry } from '../src/index.js';
import { createPackageArtifact } from '@sos-2/packages';
import type { PackageContent } from '@sos-2/packages';
import { buildResizeFixture, T0, makeEvidence } from './helpers.js';

// ---------------------------------------------------------------------------
// Generators over random package sets (VALID input space).
// ---------------------------------------------------------------------------

const fcCapability = fc.stringMatching(/^[a-z][a-z0-9-]{3,20}$/);
const fcFamily = fc.stringMatching(/^[a-z][a-z0-9-]{3,20}$/);

const fcPackages = fc
  .record({
    capability: fcCapability,
    families: fc.uniqueArray(fcFamily, { minLength: 1, maxLength: 4 }),
    perFamily: fc.integer({ min: 1, max: 3 }),
  })
  .map((spec) => {
    const packages: { capability: string; family: string; id: string }[] = [];
    for (const family of spec.families) {
      for (let i = 0; i < spec.perFamily; i += 1) {
        const evidence = [makeEvidence('sos://SystemState/' + String(i).padStart(32, '0'))];
        const content: PackageContent = {
          semantic_capability: spec.capability,
          contracts: ['contract:samples/v1'],
          preconditions: [],
          postconditions: [],
          realizations: [],
          applicability: [
            {
              kind: 'QUALITATIVE',
              uncertainty_class: 'UNQUANTIFIED',
              context: { deployment: 'central' },
              sample_size: 1,
              window: null,
            },
          ],
          evidence_refs: evidence.map((record) => record.id),
          failure_refs: [],
          compatibility_refs: [],
          composition_refs: [],
          assurance_obligations: [{ kind: 'TEST', obligation: 'x' }],
          context: { deployment: 'central' },
          learned_limitations: [],
          diversity_profile: { family, dimensions: [{ dimension: 'COST', stance: 's' }] },
          maturity: 'DISCOVERED',
          changes: `generated ${spec.capability}/${family}/${i}`,
          superseded_by: null,
        };
        const artifact = createPackageArtifact({
          content,
          provenance: ['w6:property'],
          created_at: T0,
          status: 'ACTIVE',
        });
        packages.push({ capability: spec.capability, family, id: artifact.envelope.id });
        packages.push(artifact as never);
      }
    }
    return { capability: spec.capability, families: spec.families, packages };
  });

describe('retrieval determinism (randomized package sets)', () => {
  it('identical queries return IDENTICAL results (deep equality, twice)', () => {
    fc.assert(
      fc.property(fcPackages, (spec) => {
        const registry = new PackageRegistry();
        for (const item of spec.packages) {
          if ('envelope' in item) {
            registry.putPackage(item as never);
          }
        }
        const a = registry.retrieve({ capability: spec.capability });
        const b = registry.retrieve({ capability: spec.capability });
        expect(a).toEqual(b);
        const withContext = registry.retrieve({ capability: spec.capability, context: { deployment: 'central' } });
        const withContextAgain = registry.retrieve({ capability: spec.capability, context: { deployment: 'central' } });
        expect(withContext).toEqual(withContextAgain);
        return true;
      }),
      { numRuns: 30 },
    );
  });

  it('the diverse candidate set always includes EVERY matching family (never one winner)', () => {
    fc.assert(
      fc.property(fcPackages, (spec) => {
        const registry = new PackageRegistry();
        for (const item of spec.packages) {
          if ('envelope' in item) {
            registry.putPackage(item as never);
          }
        }
        const result = registry.retrieve({ capability: spec.capability });
        // Every family that has an ACTIVE entry must be represented.
        for (const family of spec.families) {
          expect(result.families).toContain(family);
        }
        expect(result.candidates.length).toBeGreaterThanOrEqual(spec.families.length);
        return true;
      }),
      { numRuns: 30 },
    );
  });

  it('the ranking comparator is a TOTAL order (deterministic, antisymmetric, transitive)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ id: fc.stringMatching(/^[a-z0-9]{4,12}$/), rank: fc.nat(5) }), { minLength: 2, maxLength: 8 }),
        (specs) => {
          const candidates: RetrievalCandidate[] = specs.map((spec) => {
            const altitude = (Object.keys(ALTITUDE_RANK) as (keyof typeof ALTITUDE_RANK)[])[spec.rank]!;
            return {
              kind: 'PACKAGE',
              id: spec.id,
              version: 1,
              semantic_capability: 'x',
              contracts: [],
              maturity: 'DISCOVERED',
              altitude,
              family: 'f',
              dimensions: [],
              applicability: [],
              best_estimate: null,
              uncertainty: { uncertainty_class: 'UNQUANTIFIED', basis: 'NO_QUERY_CONTEXT' },
              evidence_context: {
                total_refs: 0,
                resolved: 0,
                unresolved: 0,
                classes: {},
                availability: {},
                successes: 0,
                failures: 0,
              },
              learned_limitations: [],
              failure_contexts: [],
              assurance_obligations: [],
              realizations: [],
              members: null,
              bindings: null,
              independence: null,
              context_match: 'NO_QUERY_CONTEXT',
            };
          });
          for (const a of candidates) {
            for (const b of candidates) {
              const ab = compareCandidates(a, b);
              const ba = compareCandidates(b, a);
              if (ab === 0) {
                expect(ba).toBe(0);
                expect(a.id).toBe(b.id);
              } else {
                expect(Math.sign(ab)).toBe(-Math.sign(ba));
              }
            }
          }
          const sorted = [...candidates].sort(compareCandidates);
          for (let i = 1; i < sorted.length; i += 1) {
            expect(compareCandidates(sorted[i - 1]!, sorted[i]!)).toBeLessThanOrEqual(0);
          }
          return true;
        },
      ),
      { numRuns: 25 },
    );
  });

  it('shapeDiverseCandidateSet never drops a family representative under caps', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ family: fcFamily, id: fc.stringMatching(/^[a-z0-9]{4,12}$/) }), { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1, max: 4 }),
        (specs, maxPerFamily) => {
          const candidates: RetrievalCandidate[] = specs.map((spec) => {
            return {
              kind: 'PACKAGE',
              id: spec.id,
              version: 1,
              semantic_capability: 'x',
              contracts: [],
              maturity: 'DISCOVERED',
              altitude: 'PACKAGE_ADAPTATION',
              family: spec.family,
              dimensions: [],
              applicability: [],
              best_estimate: null,
              uncertainty: { uncertainty_class: 'UNQUANTIFIED', basis: 'NO_QUERY_CONTEXT' },
              evidence_context: { total_refs: 0, resolved: 0, unresolved: 0, classes: {}, availability: {}, successes: 0, failures: 0 },
              learned_limitations: [],
              failure_contexts: [],
              assurance_obligations: [],
              realizations: [],
              members: null,
              bindings: null,
              independence: null,
              context_match: 'NO_QUERY_CONTEXT',
            };
          });
          const families = new Set(specs.map((spec) => spec.family));
          for (const cap of [maxPerFamily, 1, Math.max(1, specs.length)]) {
            const shaped = shapeDiverseCandidateSet(candidates, cap, undefined);
            for (const family of families) {
              expect(shaped.families).toContain(family);
            }
          }
          return true;
        },
      ),
      { numRuns: 25 },
    );
  });

  it('registry state is a pure function of registration order (fixture determinism)', () => {
    const a = buildResizeFixture();
    const b = buildResizeFixture();
    const ra = a.registry.retrieve({ capability: 'image-resize', context: { deployment: 'edge' } });
    const rb = b.registry.retrieve({ capability: 'image-resize', context: { deployment: 'edge' } });
    expect(ra).toEqual(rb);
    expect(a.composition.envelope.id).toBe(b.composition.envelope.id);
    expect(a.edgeCacheA.envelope.id).toBe(b.edgeCacheA.envelope.id);
  });
});

describe('canonical round trips (registry view)', () => {
  it('retrieval results canonicalize and round trip through JSON', () => {
    const { registry } = buildResizeFixture();
    const result: RetrievalResult = registry.retrieve({ capability: 'image-resize' });
    const text = JSON.stringify(result);
    const parsed = JSON.parse(text) as RetrievalResult;
    expect(JSON.stringify(parsed)).toBe(text);
    expect(parsed.candidates).toEqual(result.candidates);
  });
});
