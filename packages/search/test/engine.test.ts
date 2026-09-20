/**
 * Unit tests: the ladder search engine (altitude discipline, constraint
 * filtering before evaluation, explicit policy, diversity, uncertainty).
 */

import { describe, expect, it } from 'vitest';
import { createFixedAltitudeEngine, createLadderSearchEngine } from '../src/index.js';
import type { SearchCandidate } from '../src/index.js';
import {
  buildSearchFixture,
  constraintSet,
  constraintView,
  fixedGenerator,
  generatedCandidate,
} from './helpers.js';

const NO_CONSTRAINTS = constraintSet('test-mission', []);
const GREEDY = { kind: 'GREEDY' } as const;

describe('createLadderSearchEngine — the §10 ladder', () => {
  it('starts and stays at VALIDATED_COMPOSITION when the highest rung satisfies (no unjustified descent)', () => {
    const fixture = buildSearchFixture();
    const engine = createLadderSearchEngine({ facade: fixture.facade });
    const result = engine.search({ capability: 'image-resize', constraints: NO_CONSTRAINTS, policy: GREEDY });
    expect(result.final_altitude).toBe('VALIDATED_COMPOSITION');
    expect(result.ladder).toHaveLength(1);
    expect(result.ladder[0]!.altitude).toBe('VALIDATED_COMPOSITION');
    expect(result.ladder[0]!.outcome).toBe('SATISFIED');
    // The VC rung holds the composition — the highest safe abstraction wins.
    expect(result.ladder[0]!.candidates_considered).toBe(1);
    expect(result.ladder[0]!.candidates_surviving).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.families_present).toEqual(['edge-cache']);
  });

  it('descends with recorded justification when the higher rung cannot satisfy the constraints', () => {
    const fixture = buildSearchFixture();
    const engine = createLadderSearchEngine({ facade: fixture.facade });
    // Only the composition sits at VALIDATED_COMPOSITION; reject it via a
    // constraint on an axis only IT carries an estimate for.
    const result = engine.search({
      capability: 'image-resize',
      constraints: constraintSet('cost-mission', [constraintView('cost-cap', 'monthly-cost', 'MAX', 100)]),
      policy: GREEDY,
      estimates_by_id: {
        [fixture.composition.envelope.id]: { 'monthly-cost': 500 },
      },
    });
    expect(result.final_altitude).toBe('VALIDATED_PACKAGE');
    expect(result.ladder).toHaveLength(2);
    const first = result.ladder[0]!;
    expect(first.altitude).toBe('VALIDATED_COMPOSITION');
    expect(first.outcome).toBe('ALL_REJECTED_BY_CONSTRAINTS');
    expect(first.descent).toBeDefined();
    expect(first.descent!.to).toBe('VALIDATED_PACKAGE');
    expect(first.descent!.justification).toMatch(/rejected by hard constraints/);
    expect(first.descent!.justification).toMatch(/spec\/architecture\.md §10/);
    // The remaining validated packages (edge-cache, durable-queue) survive;
    // the ladder stops there (privacy-local sits lower, at PACKAGE_ADAPTATION).
    expect(result.candidates).toHaveLength(2);
    expect(result.families_present).toEqual(['durable-queue', 'edge-cache']);
    expect(result.total_rejected).toBe(1);
  });

  it('descends through empty rungs to the generator rungs when the registry cannot satisfy', () => {
    const fixture = buildSearchFixture();
    const pattern = generatedCandidate({
      seed: 'queue-pattern',
      altitude: 'ARCHITECTURE_PATTERN',
      family: 'sharded-queue',
    });
    const engine = createLadderSearchEngine({
      facade: fixture.facade,
      patternSource: fixedGenerator([pattern]),
    });
    // A capability the registry has nothing for: rungs 0-2 are empty.
    const result = engine.search({ capability: 'video-transcode', constraints: NO_CONSTRAINTS, policy: GREEDY });
    expect(result.final_altitude).toBe('ARCHITECTURE_PATTERN');
    expect(result.ladder.map((step) => step.altitude)).toEqual([
      'VALIDATED_COMPOSITION',
      'VALIDATED_PACKAGE',
      'PACKAGE_ADAPTATION',
      'ARCHITECTURE_PATTERN',
    ]);
    // Every descent is justified; empty rungs say so honestly.
    expect(result.ladder[0]!.outcome).toBe('NO_CANDIDATES');
    expect(result.ladder[0]!.descent!.justification).toMatch(/yielded 0 candidates/);
    expect(result.ladder[1]!.descent!.justification).toMatch(/yielded 0 candidates/);
    expect(result.ladder[2]!.descent!.justification).toMatch(/yielded 0 candidates/);
    expect(result.ladder[3]!.outcome).toBe('SATISFIED');
    expect(result.candidates.map((entry) => entry.candidate.id)).toEqual([pattern.id]);
  });

  it('returns an honest empty result when no rung can satisfy (full trace, final altitude null)', () => {
    const fixture = buildSearchFixture();
    const engine = createLadderSearchEngine({
      facade: fixture.facade,
      synthesisSource: fixedGenerator([
        generatedCandidate({
          seed: 'synth',
          altitude: 'LOW_LEVEL_SYNTHESIS',
          family: 'hand-rolled',
          estimates: { 'monthly-cost': 9999 },
        }),
      ]),
    });
    const result = engine.search({
      capability: 'video-transcode',
      constraints: constraintSet('cost-mission', [constraintView('cost-cap', 'monthly-cost', 'MAX', 100)]),
      policy: GREEDY,
    });
    expect(result.final_altitude).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result.ladder).toHaveLength(6);
    expect(result.ladder.map((step) => step.altitude)).toEqual([
      'VALIDATED_COMPOSITION',
      'VALIDATED_PACKAGE',
      'PACKAGE_ADAPTATION',
      'ARCHITECTURE_PATTERN',
      'NOVEL_ARCHITECTURE',
      'LOW_LEVEL_SYNTHESIS',
    ]);
    // All six rungs recorded; the last one is exhausted without descent.
    expect(result.ladder[4]!.descent!.justification).toMatch(/yielded 0 candidates/);
    expect(result.ladder[5]!.descent).toBeUndefined();
    expect(result.total_rejected).toBe(1);
  });

  it('filters candidates by hard constraints BEFORE evaluation (unchecked axes surface, never conflate)', () => {
    const fixture = buildSearchFixture();
    const engine = createLadderSearchEngine({ facade: fixture.facade });
    const result = engine.search({
      capability: 'image-resize',
      constraints: constraintSet('cost-mission', [constraintView('cost-cap', 'monthly-cost', 'MAX', 600)]),
      policy: GREEDY,
      estimates_by_id: {
        [fixture.composition.envelope.id]: { 'monthly-cost': 500 },
      },
    });
    // The composition (500 <= 600) survives at the top rung — search stops
    // there; the lower rungs (including a candidate that WOULD violate)
    // are never reached (the §10 stop-at-satisfaction discipline).
    expect(result.final_altitude).toBe('VALIDATED_COMPOSITION');
    expect(result.candidates).toHaveLength(1);
    const report = result.candidates[0]!.constraint_report;
    expect(report.checks[0]!.verdict).toBe('SATISFIED');
    expect(report.checks[0]!.estimate).toBe(500);
    expect(result.ladder[0]!.candidates_considered).toBe(1);
    expect(result.ladder[0]!.candidates_surviving).toBe(1);
  });

  it('preserves uncertainty end-to-end (calibrated probability + sample size carried into the result)', () => {
    const fixture = buildSearchFixture();
    const engine = createLadderSearchEngine({ facade: fixture.facade });
    // Reject the composition so the diverse VALIDATED_PACKAGE rung decides:
    // edge (calibrated 0.88/40) and durable (qualitative, unmatched context).
    const result = engine.search({
      capability: 'image-resize',
      constraints: constraintSet('cost-mission', [constraintView('cost-cap', 'monthly-cost', 'MAX', 100)]),
      policy: GREEDY,
      context: { deployment: 'edge' },
      estimates_by_id: { [fixture.composition.envelope.id]: { 'monthly-cost': 999 } },
    });
    expect(result.final_altitude).toBe('VALIDATED_PACKAGE');
    expect(result.candidates).toHaveLength(2);
    const edge = result.candidates.find((entry) => entry.candidate.family === 'edge-cache')!;
    expect(edge.candidate.uncertainty.uncertainty_class).toBe('MODERATE');
    expect(edge.candidate.uncertainty.calibrated).toBeDefined();
    expect(edge.candidate.uncertainty.calibrated!.probability).toBeCloseTo(0.88, 10);
    expect(edge.candidate.uncertainty.calibrated!.sample_size).toBe(40);
    expect(edge.candidate.uncertainty.calibrated!.calibration_ref).toMatch(/^sos:\/\/Evaluation\//);
    expect(edge.candidate.uncertainty.context_match).toBe('MATCHED');
    // The unmatched candidate is honest: UNQUANTIFIED for this context, with
    // its first estimate's sample size — never an invented number.
    const durable = result.candidates.find((entry) => entry.candidate.family === 'durable-queue')!;
    expect(durable.candidate.uncertainty.uncertainty_class).toBe('UNQUANTIFIED');
    expect(durable.candidate.uncertainty.calibrated).toBeUndefined();
    expect(durable.candidate.uncertainty.sample_size).toBe(3);
    expect(durable.candidate.uncertainty.context_match).toBe('UNMATCHED');
  });
});

describe('createLadderSearchEngine — explicit policies', () => {
  // A shared setup: the composition is constraint-rejected so the diverse
  // VALIDATED_PACKAGE rung decides (edge: calibrated 0.88/40; durable:
  // qualitative, unmatched).
  const diverseResult = (policy: { kind: 'GREEDY' } | { kind: 'UCB'; exploration_constant: number } = GREEDY) => {
    const fixture = buildSearchFixture();
    const engine = createLadderSearchEngine({ facade: fixture.facade });
    return {
      fixture,
      result: engine.search({
        capability: 'image-resize',
        constraints: constraintSet('cost-mission', [constraintView('cost-cap', 'monthly-cost', 'MAX', 100)]),
        policy,
        context: { deployment: 'edge' },
        estimates_by_id: { [fixture.composition.envelope.id]: { 'monthly-cost': 999 } },
      }),
    };
  };

  it('GREEDY orders by calibrated probability first (all EXPLOIT)', () => {
    const { result } = diverseResult();
    const modes = result.candidates.map((entry) => entry.annotation.mode);
    expect(modes.every((mode) => mode === 'EXPLOIT')).toBe(true);
    // The calibrated edge candidate (0.88) precedes the unquantified durable one.
    const ids = result.candidates.map((entry) => entry.candidate.id);
    expect(result.candidates[0]!.candidate.family).toBe('edge-cache');
    expect(result.candidates[result.candidates.length - 1]!.candidate.family).toBe('durable-queue');
    expect(new Set(ids).size).toBe(2);
  });

  it('EPSILON_GREEDY is deterministic for a fixed seed and never drops candidates', () => {
    const fixture = buildSearchFixture();
    const engine = createLadderSearchEngine({ facade: fixture.facade });
    const request = {
      capability: 'image-resize',
      constraints: constraintSet('cost-mission', [constraintView('cost-cap', 'monthly-cost', 'MAX', 100)]),
      policy: { kind: 'EPSILON_GREEDY' as const, epsilon: 0.5, seed: 424242 },
      estimates_by_id: { [fixture.composition.envelope.id]: { 'monthly-cost': 999 } },
    };
    const first = engine.search(request);
    for (let i = 0; i < 3; i += 1) {
      const again = engine.search(request);
      expect(again.candidates.map((entry) => entry.candidate.id)).toEqual(
        first.candidates.map((entry) => entry.candidate.id),
      );
      expect(again.candidates.map((entry) => entry.annotation.mode)).toEqual(
        first.candidates.map((entry) => entry.annotation.mode),
      );
    }
    // The set is preserved — only the order/annotations change.
    expect(first.candidates).toHaveLength(2);
    for (const entry of first.candidates.filter((candidate) => candidate.annotation.mode === 'EXPLORE')) {
      expect(entry.annotation.note).toMatch(/epsilon draw/);
    }
  });

  it('UCB puts unquantified arms first (EXPLORE) and scores calibrated arms (EXPLOIT)', () => {
    const { result } = diverseResult({ kind: 'UCB', exploration_constant: 0.5 });
    // edge (0.88/40) is calibrated; durable (qualitative, unmatched) is not.
    const modes = result.candidates.map((entry) => [entry.candidate.family, entry.annotation.mode]);
    const unquantified = modes.filter(([, mode]) => mode === 'EXPLORE').map(([family]) => family);
    expect(unquantified).toEqual(['durable-queue']);
    // All EXPLORE entries precede all EXPLOIT entries.
    const firstExploit = modes.findIndex(([, mode]) => mode === 'EXPLOIT');
    const lastExplore = modes.map(([, mode]) => mode).lastIndexOf('EXPLORE');
    expect(lastExplore).toBeLessThan(firstExploit);
    // The UCB note documents the score.
    const edge = result.candidates.find((entry) => entry.annotation.mode === 'EXPLOIT')!;
    expect(edge.annotation.note).toMatch(/UCB score/);
  });

  it('maxCandidates caps with a family-representative floor (diversity never removed)', () => {
    const fixture = buildSearchFixture();
    // Reject every registry candidate so the generator rung decides, with
    // three materially different families at ARCHITECTURE_PATTERN.
    const patternCandidates = [
      generatedCandidate({ seed: 'pa-a', altitude: 'ARCHITECTURE_PATTERN', family: 'sharded-queue' }),
      generatedCandidate({ seed: 'pa-b', altitude: 'ARCHITECTURE_PATTERN', family: 'sharded-queue' }),
      generatedCandidate({ seed: 'pb-a', altitude: 'ARCHITECTURE_PATTERN', family: 'worker-pool' }),
      generatedCandidate({ seed: 'pb-b', altitude: 'ARCHITECTURE_PATTERN', family: 'worker-pool' }),
      generatedCandidate({ seed: 'pc-a', altitude: 'ARCHITECTURE_PATTERN', family: 'lambda-edge' }),
      generatedCandidate({ seed: 'pc-b', altitude: 'ARCHITECTURE_PATTERN', family: 'lambda-edge' }),
    ];
    const engine = createLadderSearchEngine({
      facade: fixture.facade,
      patternSource: fixedGenerator(patternCandidates),
    });
    const result = engine.search({
      capability: 'image-resize',
      constraints: constraintSet('cost-mission', [constraintView('cost-cap', 'monthly-cost', 'MAX', 100)]),
      policy: GREEDY,
      estimates_by_id: {
        [fixture.composition.envelope.id]: { 'monthly-cost': 999 },
        [fixture.edgeCache.envelope.id]: { 'monthly-cost': 999 },
        [fixture.durableQueue.envelope.id]: { 'monthly-cost': 999 },
        [fixture.privacyLocal.envelope.id]: { 'monthly-cost': 999 },
      },
      maxCandidates: 2,
    });
    expect(result.final_altitude).toBe('ARCHITECTURE_PATTERN');
    // The cap is 2, but all three family representatives survive the floor.
    expect(result.families_present).toEqual(['lambda-edge', 'sharded-queue', 'worker-pool']);
    expect(result.candidates).toHaveLength(3);
  });
});

describe('createFixedAltitudeEngine — the swappable contract', () => {
  it('searches a single declared rung behind the same CandidateSearchEngine interface', () => {
    const patternCandidates = [
      generatedCandidate({ seed: 'p1', altitude: 'ARCHITECTURE_PATTERN', family: 'sharded-queue', calibratedProbability: 0.7, sampleSize: 5 }),
      generatedCandidate({ seed: 'p2', altitude: 'ARCHITECTURE_PATTERN', family: 'worker-pool' }),
    ];
    const engine = createFixedAltitudeEngine({ altitude: 'ARCHITECTURE_PATTERN', source: fixedGenerator(patternCandidates) });
    const result = engine.search({ capability: 'image-resize', constraints: NO_CONSTRAINTS, policy: GREEDY });
    expect(result.engine).toBe('fixed-architecture_pattern');
    expect(result.final_altitude).toBe('ARCHITECTURE_PATTERN');
    expect(result.ladder).toHaveLength(1);
    expect(result.ladder[0]!.outcome).toBe('SATISFIED');
    // Two families, both present — the diverse set again.
    expect(result.families_present).toEqual(['sharded-queue', 'worker-pool']);
  });

  it('applies the same constraint discipline at its rung', () => {
    const engine = createFixedAltitudeEngine({
      altitude: 'NOVEL_ARCHITECTURE',
      source: fixedGenerator([
        generatedCandidate({ seed: 'n1', altitude: 'NOVEL_ARCHITECTURE', family: 'novel-a', estimates: { 'monthly-cost': 50 } }),
        generatedCandidate({ seed: 'n2', altitude: 'NOVEL_ARCHITECTURE', family: 'novel-b', estimates: { 'monthly-cost': 500 } }),
      ]),
    });
    const result = engine.search({
      capability: 'image-resize',
      constraints: constraintSet('cost-mission', [constraintView('cost-cap', 'monthly-cost', 'MAX', 100)]),
      policy: GREEDY,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.candidate.family).toBe('novel-a');
    expect(result.ladder[0]!.outcome).toBe('SATISFIED');
    expect(result.ladder[0]!.rejected_ids).toHaveLength(1);
  });

  it('reports an honest empty result when its rung is empty (single NO_CANDIDATES step)', () => {
    const engine = createFixedAltitudeEngine({
      altitude: 'LOW_LEVEL_SYNTHESIS',
      source: fixedGenerator([]),
    });
    const result = engine.search({ capability: 'image-resize', constraints: NO_CONSTRAINTS, policy: GREEDY });
    expect(result.final_altitude).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result.ladder[0]!.outcome).toBe('NO_CANDIDATES');
  });

  it('both engines satisfy the same contract type (swappable implementations)', () => {
    const fixture = buildSearchFixture();
    const ladder = createLadderSearchEngine({ facade: fixture.facade });
    const fixed = createFixedAltitudeEngine({
      altitude: 'ARCHITECTURE_PATTERN',
      source: fixedGenerator([generatedCandidate({ seed: 'p', altitude: 'ARCHITECTURE_PATTERN', family: 'f' })]),
    });
    expect(typeof ladder.name).toBe('string');
    expect(typeof ladder.search).toBe('function');
    expect(typeof fixed.name).toBe('string');
    expect(typeof fixed.search).toBe('function');
    const request = { capability: 'image-resize', constraints: NO_CONSTRAINTS, policy: GREEDY };
    const fromLadder: SearchCandidate[] = ladder.search(request).candidates.map((entry) => entry.candidate);
    const fromFixed: SearchCandidate[] = fixed.search(request).candidates.map((entry) => entry.candidate);
    expect(fromLadder.length).toBeGreaterThan(0);
    expect(fromFixed.length).toBeGreaterThan(0);
    // Both carry uncertainty (the contract's shared discipline).
    for (const candidate of [...fromLadder, ...fromFixed]) {
      expect(candidate.uncertainty.uncertainty_class).toBeDefined();
    }
  });
});
