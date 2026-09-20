/**
 * Property tests: randomized candidate sets and requests —
 *   - search determinism (identical results for identical requests),
 *   - policy determinism (epsilon-greedy reproducibility for a fixed seed),
 *   - ladder correctness (the final altitude is the highest rung with
 *     survivors; every descent justified; steps consecutive),
 *   - constraint filter laws (no VIOLATED survivor; survivors+rejected
 *     partition the input),
 *   - canonical round trips.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize, contentHash } from '@sos-2/semantic-spine';
import {
  applyExplorationPolicy,
  createLadderSearchEngine,
  filterByHardConstraints,
} from '../src/index.js';
import type { ExplorationPolicy, LadderStep, SearchCandidate } from '../src/index.js';
import { RETRIEVAL_ALTITUDES } from '@sos-2/retrieval';
import { buildSearchFixture, constraintView } from './helpers.js';

// ---------------------------------------------------------------------------
// Generators (VALID input space)
// ---------------------------------------------------------------------------

const fcAltitude = fc.constantFrom<'ARCHITECTURE_PATTERN' | 'NOVEL_ARCHITECTURE' | 'LOW_LEVEL_SYNTHESIS'>(
  'ARCHITECTURE_PATTERN',
  'NOVEL_ARCHITECTURE',
  'LOW_LEVEL_SYNTHESIS',
);

const fcAxisName = fc.constantFrom('monthly-cost', 'p99-latency', 'uptime');

const fcCandidate = fc
  .record({
    seed: fc.stringMatching(/^[a-z][a-z0-9-]{3,16}$/),
    altitude: fcAltitude,
    family: fc.stringMatching(/^[a-z][a-z0-9-]{3,12}$/),
    cost: fc.option(fc.integer({ min: -50, max: 1000 }), { nil: undefined }),
    latency: fc.option(fc.integer({ min: -50, max: 1000 }), { nil: undefined }),
    probability: fc.option(fc.double({ min: 0.05, max: 0.95, noNaN: true }), { nil: undefined }),
    sampleSize: fc.integer({ min: 0, max: 50 }),
  })
  .map((seed) => {
    const estimates: Record<string, number> = {};
    if (seed.cost !== undefined) {
      estimates['monthly-cost'] = seed.cost;
    }
    if (seed.latency !== undefined) {
      estimates['p99-latency'] = seed.latency;
    }
    const candidate: SearchCandidate = {
      id: `cand-${seed.seed}-${seed.altitude}`,
      capability: 'prop-capability',
      altitude: seed.altitude,
      origin: seed.altitude,
      family: seed.family,
      dimensions: [],
      estimates,
      uncertainty: {
        uncertainty_class: 'UNQUANTIFIED',
        sample_size: seed.sampleSize,
        context_match: 'NO_QUERY_CONTEXT',
        ...(seed.probability !== undefined
          ? {
              calibrated: {
                probability: seed.probability,
                sample_size: Math.max(1, seed.sampleSize),
                window: null,
                calibration_ref: 'sos://Evaluation/' + 'a'.repeat(32),
              },
            }
          : {}),
      },
    };
    return candidate;
  });

const fcCandidates = fc
  .array(fcCandidate, { minLength: 0, maxLength: 15 })
  .map((candidates) => {
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      if (seen.has(candidate.id)) {
        return false;
      }
      seen.add(candidate.id);
      return true;
    });
  });

const fcConstraints = fc.array(
  fc.record({
    axis: fcAxisName,
    direction: fc.constantFrom<'MAX' | 'MIN'>('MAX', 'MIN'),
    limit: fc.integer({ min: -100, max: 900 }),
  }),
  { minLength: 0, maxLength: 3 },
);

const fcPolicy: fc.Arbitrary<ExplorationPolicy> = fc.oneof(
  fc.constant({ kind: 'GREEDY' } as const),
  fc.record({ epsilon: fc.double({ min: 0, max: 1, noNaN: true }), seed: fc.integer({ min: 0, max: 0xffffffff }) }).map(
    (record) => ({ kind: 'EPSILON_GREEDY' as const, ...record }),
  ),
  fc.record({ exploration_constant: fc.double({ min: 0, max: 3, noNaN: true }) }).map((record) => ({
    kind: 'UCB' as const,
    ...record,
  })),
);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('constraint filter property tests', () => {
  it('partition law: survivors + rejected partition the input; no VIOLATED candidate survives', () => {
    fc.assert(
      fc.property(fcCandidates, fcConstraints, (candidates, constraintSpecs) => {
        const set = {
          source: 'prop-mission',
          constraints: constraintSpecs.map((spec, index) => constraintView(`c${index}`, spec.axis, spec.direction, spec.limit)),
          machine_checkable: constraintSpecs.map((spec, index) => constraintView(`c${index}`, spec.axis, spec.direction, spec.limit)),
        };
        const { survivors, rejected } = filterByHardConstraints(candidates, set);
        expect(survivors.length + rejected.length).toBe(candidates.length);
        for (const entry of survivors) {
          expect(entry.report.passes).toBe(true);
          expect(entry.report.violated).toEqual([]);
        }
        for (const entry of rejected) {
          expect(entry.report.violated.length).toBeGreaterThan(0);
        }
        // Every check verdict is one of the three distinct states.
        for (const entry of [...survivors, ...rejected]) {
          for (const check of entry.report.checks) {
            expect(['SATISFIED', 'VIOLATED', 'UNCHECKED']).toContain(check.verdict);
          }
        }
      }),
    );
  });
});

describe('policy property tests', () => {
  it('policy determinism: the same policy and candidates always yield the same ordering', () => {
    fc.assert(
      fc.property(fcCandidates, fcPolicy, (candidates, policy) => {
        const first = applyExplorationPolicy(candidates, policy);
        for (let i = 0; i < 3; i += 1) {
          const again = applyExplorationPolicy(candidates, policy);
          expect(canonicalSerialize(again)).toBe(canonicalSerialize(first));
        }
      }),
    );
  });

  it('membership law: the policy NEVER drops or duplicates candidates (order and annotation only)', () => {
    fc.assert(
      fc.property(fcCandidates, fcPolicy, (candidates, policy) => {
        const ordering = applyExplorationPolicy(candidates, policy);
        expect(ordering.ordered).toHaveLength(candidates.length);
        const ids = ordering.ordered.map((entry) => entry.candidate.id).sort();
        expect(ids).toEqual(candidates.map((candidate) => candidate.id).sort());
        // Ranks are 1..n exactly once.
        expect(ordering.ordered.map((entry) => entry.annotation.rank).sort((a, b) => a - b)).toEqual(
          candidates.map((_, index) => index + 1),
        );
      }),
    );
  });
});

describe('engine property tests', () => {
  it('ladder correctness: the final altitude is the highest rung with survivors; every descent justified; steps consecutive', () => {
    const fixture = buildSearchFixture();
    fc.assert(
      fc.property(
        fcCandidates,
        fcConstraints,
        fcPolicy,
        fc.option(fc.integer({ min: 1, max: 6 }), { nil: undefined }),
        (candidates, constraintSpecs, policy, maxCandidates) => {
          const constraints = constraintSpecs.map((spec, index) =>
            constraintView(`c${index}`, spec.axis, spec.direction, spec.limit),
          );
          const set = {
            source: 'prop-mission',
            constraints,
            machine_checkable: constraints.filter((constraint) => constraint.bound !== null),
          };
          const engine = createLadderSearchEngine({
            facade: fixture.facade,
            patternSource: () => candidates.filter((candidate) => candidate.altitude === 'ARCHITECTURE_PATTERN'),
            novelSource: () => candidates.filter((candidate) => candidate.altitude === 'NOVEL_ARCHITECTURE'),
            synthesisSource: () => candidates.filter((candidate) => candidate.altitude === 'LOW_LEVEL_SYNTHESIS'),
          });
          const request = {
            capability: 'prop-capability',
            constraints: set,
            policy,
            ...(maxCandidates !== undefined ? { maxCandidates } : {}),
          };
          const result = engine.search(request);

          // Trace discipline (assertValidLadderTrace already guarantees it;
          // re-asserted as observable law): consecutive rungs from the top.
          expect(result.ladder.map((step) => step.altitude)).toEqual(RETRIEVAL_ALTITUDES.slice(0, result.ladder.length));
          for (let i = 0; i < result.ladder.length - 1; i += 1) {
            const step: LadderStep = result.ladder[i]!;
            expect(step.descent).toBeDefined();
            expect(step.descent!.justification.trim().length).toBeGreaterThan(0);
          }
          if (result.ladder.length > 0) {
            expect(result.ladder[result.ladder.length - 1]!.descent).toBeUndefined();
          }

          // The final altitude is the highest rung with a survivor.
          if (result.candidates.length > 0) {
            expect(result.final_altitude).toBe(result.candidates[0]!.candidate.altitude);
            expect(result.ladder[result.ladder.length - 1]!.outcome).toBe('SATISFIED');
            // All returned candidates come from the final altitude's rung.
            for (const entry of result.candidates) {
              expect(entry.candidate.altitude).toBe(result.final_altitude);
            }
          } else {
            expect(result.final_altitude).toBeNull();
          }

          // No candidate with a VIOLATED constraint is ever returned.
          for (const entry of result.candidates) {
            expect(entry.constraint_report.violated).toEqual([]);
          }

          // Family-representative floor: every family of the final rung's
          // survivors keeps a representative.
          const survivorsOfRung = result.ladder[result.ladder.length - 1]!.candidates_surviving;
          if (survivorsOfRung > 0 && maxCandidates !== undefined && result.candidates.length < survivorsOfRung) {
            const familiesOfResult = new Set(result.candidates.map((entry) => entry.candidate.family));
            expect(result.families_present).toEqual([...familiesOfResult].sort());
          }
        },
      ),
    );
  });

  it('search determinism: identical requests yield identical results (canonical form)', () => {
    const fixture = buildSearchFixture();
    fc.assert(
      fc.property(fcCandidates, fcConstraints, fcPolicy, (candidates, constraintSpecs, policy) => {
        const constraints = constraintSpecs.map((spec, index) =>
          constraintView(`c${index}`, spec.axis, spec.direction, spec.limit),
        );
        const set = {
          source: 'prop-mission',
          constraints,
          machine_checkable: constraints.filter((constraint) => constraint.bound !== null),
        };
        const engine = createLadderSearchEngine({
          facade: fixture.facade,
          patternSource: () => candidates.filter((candidate) => candidate.altitude === 'ARCHITECTURE_PATTERN'),
          novelSource: () => candidates.filter((candidate) => candidate.altitude === 'NOVEL_ARCHITECTURE'),
          synthesisSource: () => candidates.filter((candidate) => candidate.altitude === 'LOW_LEVEL_SYNTHESIS'),
        });
        const request = { capability: 'prop-capability', constraints: set, policy };
        const first = engine.search(request);
        const again = engine.search(request);
        expect(canonicalSerialize(again)).toBe(canonicalSerialize(first));
        // Canonical round trip of the whole result.
        const text = canonicalSerialize(first);
        expect(canonicalSerialize(JSON.parse(text))).toBe(text);
        expect(contentHash(JSON.parse(text))).toBe(contentHash(first));
      }),
    );
  });
});
