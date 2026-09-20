/**
 * Negative discipline tests for @sos-2/retrieval.
 *
 * The forbidden shortcuts exercised here (spec/architecture-lock.md,
 * spec/architecture.md §12, §18; docs/probabilistic-learning.md; W7 brief):
 *   - composition probability from member probabilities WITHOUT
 *     independence justification — REJECTED;
 *   - member evidence substituting composition own evidence — INVALID
 *     (foreign refs surfaced by the W6 authority through the facade);
 *   - numeric posterior outputs marked uncalibrated unless calibration
 *     evidence is attached; uncalibrated numerics NEVER minted as
 *     CALIBRATED estimates;
 *   - malformed queries/batches/priors — REJECTED loudly.
 */

import { describe, expect, it } from 'vitest';
import { PackageRegistry } from '@sos-2/registry';
import {
  RetrievalFacade,
  betaUpdate,
  combinedCompositionProbability,
  dirichletUpdate,
  evaluateCompositionOwnEvidence,
  updateApplicabilityEstimate,
} from '../src/index.js';
import type { ContextCandidate } from '../src/index.js';
import { buildFixture, calibratedEdgeEstimate, successEvidence, W0 } from './helpers.js';

describe('retrieval negative discipline', () => {
  it('REJECTS combining member probabilities without an independence justification (never P(A+B)=P(A)P(B) by default)', () => {
    const members = [
      { package_id: 'sos://Package/' + 'a'.repeat(32), probability: 0.9 },
      { package_id: 'sos://Package/' + 'b'.repeat(32), probability: 0.8 },
    ];
    expect(() => combinedCompositionProbability(members)).toThrow(/unjustified probability multiplication rejected/);
    expect(() => combinedCompositionProbability(members, undefined)).toThrow(
      /unjustified probability multiplication rejected/,
    );
  });

  it('REJECTS member evidence as composition own evidence (foreign refs make the verdict invalid)', () => {
    const fixture = buildFixture();
    const facade = new RetrievalFacade(fixture.registry);
    const context = facade.query({ capability: 'image-resize' });
    const composition = context.candidates.find((candidate) => candidate.kind === 'COMPOSITION')!;

    // The substitution attempt: the composition's cited refs resolve to
    // records that are ABOUT A MEMBER (subject = the member's id). The W6
    // authority marks them FOREIGN and the verdict is invalid.
    const member = fixture.members[0]!;
    const substitutingResolver = (ref: string) => ({ ...successEvidence(member.envelope.id), id: ref });
    const verdict = evaluateCompositionOwnEvidence(composition, substitutingResolver);
    expect(verdict.valid).toBe(false);
    expect(verdict.foreign_refs).toHaveLength(composition.own_evidence!.own_evidence_refs.length);
    expect(verdict.reasons.join(' ')).toMatch(/member success never implies composition success/);
  });

  it('REJECTS own-evidence evaluation for non-composition candidates', () => {
    const fixture = buildFixture();
    const facade = new RetrievalFacade(fixture.registry);
    const context = facade.query({ capability: 'image-resize' });
    const packageCandidate = context.candidates.find((candidate) => candidate.kind === 'PACKAGE')!;
    expect(() => evaluateCompositionOwnEvidence(packageCandidate, () => undefined)).toThrow(
      /requires a composition candidate/,
    );
  });

  it('REJECTS queries with an empty capability (facade validates before the registry)', () => {
    const facade = new RetrievalFacade(new PackageRegistry());
    expect(() => facade.query({ capability: '   ' })).toThrow(/invalid context query/);
    expect(() => facade.query({ capability: '' })).toThrow(/invalid context query/);
  });

  it('REJECTS a facade constructed without a registry (the data authority is mandatory)', () => {
    expect(() => new RetrievalFacade({} as PackageRegistry)).toThrow(/requires a PackageRegistry instance/);
  });

  it('REJECTS outcome batches with negative/non-integer counts, empty batches, or missing windows', () => {
    expect(() => betaUpdate({ alpha: 1, beta: 1 }, { successes: -1, failures: 2, window: W0 })).toThrow(
      /non-negative integer/,
    );
    expect(() => betaUpdate({ alpha: 1, beta: 1 }, { successes: 1.5, failures: 2, window: W0 })).toThrow(
      /non-negative integer/,
    );
    expect(() => betaUpdate({ alpha: 1, beta: 1 }, { successes: 0, failures: 0, window: W0 })).toThrow(
      /at least one observed outcome/,
    );
    expect(() => betaUpdate({ alpha: 1, beta: 1 }, { successes: 1, failures: 0, window: { start: 'nope', end: 'nope' } })).toThrow(
      /window is invalid/,
    );
  });

  it('REJECTS malformed priors and calibration refs', () => {
    expect(() => betaUpdate({ alpha: 0, beta: 1 }, { successes: 1, failures: 0, window: W0 })).toThrow(
      /alpha > 0 and beta > 0/,
    );
    expect(() =>
      betaUpdate({ alpha: 1, beta: 1 }, { successes: 1, failures: 0, window: W0 }, { calibration_ref: 'not-an-id' }),
    ).toThrow(/well-formed spine artifact id/);
  });

  it('REJECTS uncalibrated numeric outputs being minted as CALIBRATED estimates (§12 discipline)', () => {
    const qualitative = {
      kind: 'QUALITATIVE' as const,
      uncertainty_class: 'UNQUANTIFIED' as const,
      context: { deployment: 'edge' },
      sample_size: 0,
      window: null,
    };
    const result = updateApplicabilityEstimate(qualitative, { successes: 4, failures: 6, window: W0 });
    // Without calibration evidence: the estimate stays QUALITATIVE and the
    // numeric posterior is marked uncalibrated — never a CALIBRATED estimate.
    expect(result.estimate.kind).toBe('QUALITATIVE');
    expect(result.update.calibrated).toBe(false);
    expect(result.update.calibration_ref).toBeNull();
    // And the packages validator would reject it if we tried to force the numeric kind.
    const asRecord = result.estimate as unknown as Record<string, unknown>;
    expect(asRecord['kind']).not.toBe('CALIBRATED');
    expect('probability' in asRecord).toBe(false);
  });

  it('REJECTS invalid applicability estimates on the update path', () => {
    expect(() =>
      updateApplicabilityEstimate({ kind: 'QUALITATIVE', uncertainty_class: 'MADE_UP' as never, context: {}, sample_size: 1, window: null }, {
        successes: 1,
        failures: 0,
        window: W0,
      }),
    ).toThrow(/applicability estimate is invalid/);
  });

  it('REJECTS dirichlet updates with < 2 categories, mismatched priors, or bad counts', () => {
    expect(() => dirichletUpdate([1])).toThrow(/at least 2 categories/);
    expect(() => dirichletUpdate([1, 2], [1])).toThrow(/prior vector length must match/);
    expect(() => dirichletUpdate([1, -2])).toThrow(/non-negative integers/);
    expect(() => dirichletUpdate([1, 2], -1)).toThrow(/concentration must be > 0/);
  });

  it('NEVER lets a facade candidate drop uncertainty (the view is total, not optional)', () => {
    const fixture = buildFixture();
    const facade = new RetrievalFacade(fixture.registry);
    const context = facade.query({ capability: 'image-resize' });
    for (const candidate of context.candidates as ContextCandidate[]) {
      expect(candidate.uncertainty).toBeDefined();
      expect(candidate.uncertainty.uncertainty_class).toBeDefined();
      expect(candidate.uncertainty.basis).toBeDefined();
    }
  });
});
