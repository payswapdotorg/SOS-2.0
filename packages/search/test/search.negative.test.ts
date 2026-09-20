/**
 * Negative discipline tests for @sos-2/search.
 *
 * The forbidden shortcuts exercised here (spec/architecture-lock.md,
 * spec/architecture.md §9/§10, W7 brief):
 *   - descent without justification — REJECTED;
 *   - skipped rungs / ascending / continuing past satisfaction — REJECTED;
 *   - implicit exploration/exploitation (missing or malformed policy) —
 *     REJECTED;
 *   - uncertainty stripped from candidates — REJECTED;
 *   - constraint-violating candidates in survivors — IMPOSSIBLE (asserted);
 *   - caps removing family representatives — IMPOSSIBLE (asserted);
 *   - generators misreporting their rung / duplicate ids — REJECTED.
 */

import { describe, expect, it } from 'vitest';
import {
  applyExplorationPolicy,
  buildLadderTrace,
  createFixedAltitudeEngine,
  createLadderSearchEngine,
  filterByHardConstraints,
  hardConstraintsFromMission,
} from '../src/index.js';
import type { LadderStep, SearchCandidate } from '../src/index.js';
import {
  buildSearchFixture,
  constraintSet,
  constraintView,
  fixedGenerator,
  generatedCandidate,
} from './helpers.js';

const NO_CONSTRAINTS = constraintSet('test-mission', []);
const GREEDY = { kind: 'GREEDY' } as const;

function bareCandidate(overrides: Partial<SearchCandidate> = {}): SearchCandidate {
  return {
    id: 'sos://CandidateState/' + '1'.repeat(32),
    capability: 'image-resize',
    altitude: 'ARCHITECTURE_PATTERN',
    origin: 'ARCHITECTURE_PATTERN',
    family: 'family-a',
    dimensions: [],
    estimates: {},
    uncertainty: { uncertainty_class: 'UNQUANTIFIED', sample_size: 0, context_match: 'NO_QUERY_CONTEXT' },
    ...overrides,
  };
}

describe('ladder trace negative discipline', () => {
  const satisfied = (altitude: LadderStep['altitude']): LadderStep => ({
    altitude,
    outcome: 'SATISFIED',
    candidates_considered: 1,
    candidates_surviving: 1,
    rejected_ids: [],
  });
  const empty = (altitude: LadderStep['altitude'], descent?: LadderStep['descent']): LadderStep => ({
    altitude,
    outcome: 'NO_CANDIDATES',
    candidates_considered: 0,
    candidates_surviving: 0,
    rejected_ids: [],
    descent,
  });

  it('REJECTS a descent without justification', () => {
    expect(() =>
      buildLadderTrace([
        empty('VALIDATED_COMPOSITION', { to: 'VALIDATED_PACKAGE', justification: '' }),
        satisfied('VALIDATED_PACKAGE'),
      ]),
    ).toThrow(/UNJUSTIFIED DESCENT REJECTED.*empty justification/s);
    expect(() =>
      buildLadderTrace([
        empty('VALIDATED_COMPOSITION', { to: 'VALIDATED_PACKAGE', justification: '   ' }),
        satisfied('VALIDATED_PACKAGE'),
      ]),
    ).toThrow(/UNJUSTIFIED DESCENT/);
  });

  it('REJECTS a missing descent record on an exhausted non-final rung', () => {
    expect(() => buildLadderTrace([empty('VALIDATED_COMPOSITION'), satisfied('VALIDATED_PACKAGE')])).toThrow(
      /UNJUSTIFIED DESCENT REJECTED.*carries no descent record/s,
    );
  });

  it('REJECTS skipped rungs (a trace must descend one rung at a time)', () => {
    expect(() =>
      buildLadderTrace([
        empty('VALIDATED_COMPOSITION', { to: 'PACKAGE_ADAPTATION', justification: 'skipping' }),
        satisfied('PACKAGE_ADAPTATION'),
      ]),
    ).toThrow(/immediately next rung|consecutive rungs/);
    expect(() =>
      buildLadderTrace([
        empty('VALIDATED_COMPOSITION', { to: 'VALIDATED_PACKAGE', justification: 'down' }),
        empty('PACKAGE_ADAPTATION', { to: 'ARCHITECTURE_PATTERN', justification: 'skipped VP' }),
        satisfied('ARCHITECTURE_PATTERN'),
      ]),
    ).toThrow(/consecutive rungs/);
  });

  it('REJECTS a trace that does not start at the highest safe abstraction', () => {
    expect(() => buildLadderTrace([satisfied('VALIDATED_PACKAGE')])).toThrow(
      /must start at VALIDATED_COMPOSITION/,
    );
  });

  it('REJECTS a trace that continues past a SATISFIED rung', () => {
    expect(() =>
      buildLadderTrace([
        satisfied('VALIDATED_COMPOSITION'),
        empty('VALIDATED_PACKAGE', { to: 'PACKAGE_ADAPTATION', justification: 'kept going' }),
        satisfied('PACKAGE_ADAPTATION'),
      ]),
    ).toThrow(/continues past a SATISFIED rung/);
  });

  it('REJECTS inconsistent steps (SATISFIED without survivors; NO_CANDIDATES with candidates)', () => {
    expect(() =>
      buildLadderTrace([
        { altitude: 'VALIDATED_COMPOSITION', outcome: 'SATISFIED', candidates_considered: 3, candidates_surviving: 0, rejected_ids: ['x'] },
      ]),
    ).toThrow(/a satisfied rung has survivors/);
    expect(() =>
      buildLadderTrace([
        { altitude: 'VALIDATED_COMPOSITION', outcome: 'NO_CANDIDATES', candidates_considered: 2, candidates_surviving: 0, rejected_ids: [] },
      ]),
    ).toThrow(/claims NO_CANDIDATES but considered/);
  });
});

describe('policy negative discipline (exploration/exploitation is EXPLICIT)', () => {
  it('REJECTS a search request without a policy (never implicit)', () => {
    const fixture = buildSearchFixture();
    const engine = createLadderSearchEngine({ facade: fixture.facade });
    expect(() =>
      engine.search({ capability: 'image-resize', constraints: NO_CONSTRAINTS, policy: undefined as never }),
    ).toThrow(/exploration policy must be an explicit typed object/);
  });

  it('REJECTS malformed policies (bad epsilon, bad seed, bad constant, unknown kind)', () => {
    expect(() => applyExplorationPolicy([], { kind: 'EPSILON_GREEDY', epsilon: 1.5, seed: 1 })).toThrow(
      /epsilon must be a finite number in \[0, 1\]/,
    );
    expect(() => applyExplorationPolicy([], { kind: 'EPSILON_GREEDY', epsilon: 0.2, seed: -1 })).toThrow(
      /seed must be an integer/,
    );
    expect(() => applyExplorationPolicy([], { kind: 'EPSILON_GREEDY', epsilon: 0.2, seed: 1.5 })).toThrow(
      /seed must be an integer/,
    );
    expect(() => applyExplorationPolicy([], { kind: 'UCB', exploration_constant: -1 })).toThrow(
      /exploration_constant must be a finite number >= 0/,
    );
    expect(() => applyExplorationPolicy([], { kind: 'MYSTERY' } as never)).toThrow(
      /kind must be GREEDY, EPSILON_GREEDY or UCB/,
    );
  });

  it('REJECTS a policy object with extra fields (exact field sets)', () => {
    expect(() => applyExplorationPolicy([], { kind: 'GREEDY', extra: 1 } as never)).toThrow(/exact field set/);
  });
});

describe('candidate negative discipline', () => {
  it('REJECTS a candidate whose uncertainty was stripped', () => {
    const stripped = bareCandidate();
    delete (stripped as { uncertainty?: unknown }).uncertainty;
    expect(() => applyExplorationPolicy([stripped], GREEDY)).toThrow(/uncertainty/);
    const nullUncertainty = { ...bareCandidate(), uncertainty: null } as never;
    expect(() => applyExplorationPolicy([nullUncertainty], GREEDY)).toThrow(/must carry uncertainty/);
  });

  it('REJECTS a calibrated probability without a spine calibration ref', () => {
    const uncalibratedNumeric = bareCandidate({
      uncertainty: {
        uncertainty_class: 'MODERATE',
        sample_size: 5,
        context_match: 'MATCHED',
        calibrated: { probability: 0.9, sample_size: 5, window: null, calibration_ref: 'not-an-id' },
      },
    });
    expect(() => applyExplorationPolicy([uncalibratedNumeric], GREEDY)).toThrow(
      /well-formed spine calibration ref/,
    );
  });

  it('REJECTS generators that misreport their rung (the rung assignment is the engine\'s authority)', () => {
    const fixture = buildSearchFixture();
    const engine = createLadderSearchEngine({
      facade: fixture.facade,
      patternSource: fixedGenerator([
        generatedCandidate({ seed: 'sneaky', altitude: 'NOVEL_ARCHITECTURE', family: 'wrong-rung' }),
      ]),
    });
    expect(() => engine.search({ capability: 'video-transcode', constraints: NO_CONSTRAINTS, policy: GREEDY })).toThrow(
      /the rung assignment is the engine's authority/,
    );
  });

  it('REJECTS duplicate candidate ids (registry vs generated, generated vs generated)', () => {
    const fixture = buildSearchFixture();
    const duplicated = generatedCandidate({ seed: 'dup', altitude: 'ARCHITECTURE_PATTERN', family: 'f' });
    const engine = createLadderSearchEngine({
      facade: fixture.facade,
      patternSource: fixedGenerator([duplicated, { ...duplicated, family: 'other' }]),
    });
    expect(() => engine.search({ capability: 'video-transcode', constraints: NO_CONSTRAINTS, policy: GREEDY })).toThrow(
      /duplicate candidate id/,
    );
  });

  it('REJECTS a search request with an empty capability or malformed constraints', () => {
    const fixture = buildSearchFixture();
    const engine = createLadderSearchEngine({ facade: fixture.facade });
    expect(() => engine.search({ capability: '  ', constraints: NO_CONSTRAINTS, policy: GREEDY })).toThrow(
      /capability must be a non-empty string/,
    );
    expect(() =>
      engine.search({ capability: 'x', constraints: { source: 's', constraints: [], machine_checkable: [] } as never, policy: GREEDY }),
    ).not.toThrow(); // an empty constraint set is valid (nothing to check)
    expect(() =>
      engine.search({
        capability: 'x',
        constraints: { source: 's', constraints: [], machine_checkable: [constraintView('c', 'axis')] },
        policy: GREEDY,
      }),
    ).toThrow(/machine_checkable must be exactly the bounded subset/);
  });
});

describe('constraint filter negative discipline', () => {
  it('NEVER returns a VIOLATED candidate as a survivor', () => {
    const set = constraintSet('cost-mission', [
      constraintView('cost-cap', 'monthly-cost', 'MAX', 100),
      constraintView('latency-floor', 'p99-latency', 'MIN', 10),
    ]);
    const candidates = [
      bareCandidate({ id: 'a', estimates: { 'monthly-cost': 50, 'p99-latency': 20 } }),
      bareCandidate({ id: 'b', estimates: { 'monthly-cost': 500, 'p99-latency': 20 } }),
      bareCandidate({ id: 'c', estimates: { 'monthly-cost': 50, 'p99-latency': 5 } }),
      bareCandidate({ id: 'd', estimates: {} }),
    ];
    const { survivors, rejected } = filterByHardConstraints(candidates, set);
    expect(survivors.map((entry) => entry.candidate.id)).toEqual(['a', 'd']);
    expect(rejected.map((entry) => entry.candidate.id).sort()).toEqual(['b', 'c']);
    // The unchecked candidate's report surfaces UNCHECKED — never conflated.
    const unchecked = survivors.find((entry) => entry.candidate.id === 'd')!;
    expect(unchecked.report.unchecked).toHaveLength(2);
    expect(unchecked.report.checks.every((check) => check.verdict === 'UNCHECKED')).toBe(true);
  });

  it('EXCLUDES soft constraints from machine filtering (preferences never veto)', () => {
    const set = hardConstraintsFromMission({
      artifact_id: 'mission-x',
      constraints: [
        constraintView('hard-1', 'monthly-cost', 'MAX', 100, true),
        constraintView('soft-1', 'monthly-cost', 'MAX', 1, false),
        constraintView('hard-unbounded', null),
      ],
    });
    expect(set.constraints.map((constraint) => constraint.id)).toEqual(['hard-1', 'hard-unbounded']);
    expect(set.machine_checkable.map((constraint) => constraint.id)).toEqual(['hard-1']);
    // The soft constraint (limit 1) would reject everything; it must not filter.
    const candidate = bareCandidate({ estimates: { 'monthly-cost': 50 } });
    const { survivors } = filterByHardConstraints([candidate], set);
    expect(survivors).toHaveLength(1);
  });

  it('NEVER lets maxCandidates remove a family\'s sole representative', () => {
    const fixture = buildSearchFixture();
    // Three materially different families at the generator rung; cap of 1.
    const patternCandidates = [
      generatedCandidate({ seed: 'fa', altitude: 'ARCHITECTURE_PATTERN', family: 'sharded-queue' }),
      generatedCandidate({ seed: 'fb', altitude: 'ARCHITECTURE_PATTERN', family: 'worker-pool' }),
      generatedCandidate({ seed: 'fc', altitude: 'ARCHITECTURE_PATTERN', family: 'lambda-edge' }),
    ];
    const engine = createLadderSearchEngine({
      facade: fixture.facade,
      patternSource: fixedGenerator(patternCandidates),
    });
    const result = engine.search({
      capability: 'video-transcode',
      constraints: NO_CONSTRAINTS,
      policy: GREEDY,
      maxCandidates: 1,
    });
    // Three families: even a cap of 1 keeps all family representatives.
    expect(result.families_present).toEqual(['lambda-edge', 'sharded-queue', 'worker-pool']);
    expect(result.candidates).toHaveLength(3);
  });
});

describe('engine construction negative discipline', () => {
  it('REJECTS a ladder engine without a retrieval facade', () => {
    expect(() => createLadderSearchEngine({} as never)).toThrow(/requires a RetrievalFacade/);
  });

  it('REJECTS a fixed engine without an altitude or generator', () => {
    expect(() => createFixedAltitudeEngine({ altitude: 'NOT_A_RUNG' as never, source: () => [] })).toThrow(
      /§10 retrieval altitude/,
    );
    expect(() => createFixedAltitudeEngine({ altitude: 'NOVEL_ARCHITECTURE', source: undefined as never })).toThrow(
      /requires a candidate generator/,
    );
  });
});
