/**
 * Property tests — randomized mission inputs -> pipeline determinism (the
 * W14 brief: "Property tests: randomized mission inputs -> pipeline
 * determinism"), plus the trace-chain fragility property (removing any
 * single link breaks the completeness assertion) and the formalization
 * property (goals with measures become MEASURABLE).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import {
  assertTraceChainComplete,
  checkTraceChain,
  runGreenfieldPipeline,
  runMissionStage,
} from '../src/index.js';
import type { GreenfieldMissionInput } from '../src/index.js';
import { buildEcology, buildObservations, buildRealizationPlan, buildRiskProfile, buildRunContext, validGrant } from './helpers.js';

/** Slug-like capability keys (the mission input contract). */
const capabilityArbitrary = fc
  .stringMatching(/^[a-z][a-z0-9-]{2,17}$/)
  .noShrink();

/** Non-empty local ids. */
const localIdArbitrary = fc
  .stringMatching(/^[a-z][a-z0-9-]{1,17}$/)
  .noShrink();

/** A mission input whose goals randomly reference (or omit) measures. */
const missionInputArbitrary = fc
  .record({
    capability: capabilityArbitrary,
    purpose: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ,.-]{9,60}$/).noShrink(),
  })
  .chain((base) => {
    const capability = base.capability;
    return fc
      .uniqueArray(localIdArbitrary, { minLength: 1, maxLength: 3 })
      .chain((measureIds) =>
        fc
          .uniqueArray(localIdArbitrary, { minLength: 1, maxLength: 4 })
          .map((goalIds) => {
            const measures = measureIds.map((id) => ({
              id,
              description: `measure ${id}`,
              target: '<=100',
              unit: 'ms',
            }));
            const goals = goalIds.map((id, index) => ({
              id,
              statement: `goal ${id}`,
              // Deterministic per-index choice: even goals reference the
              // first measure (MEASURABLE), odd goals reference none (PROPOSED).
              measures: index % 2 === 0 && measures.length > 0 ? [measures[0]!.id] : [],
            }));
            const missionInput: GreenfieldMissionInput = {
              purpose: base.purpose,
              capability,
              contracts: [`contract:${capability}/v1`],
              goals,
              measures,
              constraints: [
                {
                  id: 'constraint-cost',
                  statement: 'Monthly cost stays within budget',
                  hard: true,
                  bound: { axis: 'monthly-cost', direction: 'MAX', limit: 600 },
                },
              ],
            };
            return missionInput;
          }),
      );
  });

/** Build a full pipeline input for a randomized mission (deterministic world per input). */
function pipelineInputFor(missionInput: GreenfieldMissionInput) {
  const ecology = buildEcology(missionInput.capability);
  return {
    mission_input: missionInput,
    world: {
      registry: ecology.registry,
      evidenceResolver: ecology.evidenceResolver,
      grants: [validGrant()],
    },
    risk: buildRiskProfile(),
    realization: buildRealizationPlan(),
    observations: buildObservations(),
    decider: null,
    search_policy: { kind: 'GREEDY' } as const,
    run: buildRunContext(),
  };
}

describe('property: randomized mission inputs -> pipeline determinism', () => {
  it('every valid randomized mission input completes the pipeline with a complete trace chain', () => {
    fc.assert(
      fc.property(missionInputArbitrary, (missionInput) => {
        const result = runGreenfieldPipeline(pipelineInputFor(missionInput));
        expect(result.ok).toBe(true);
        expect(result.trace_chain.ok).toBe(true);
        expect(result.summary.decision.approved).toBe(true);
        expect(result.summary.capability).toBe(missionInput.capability);
        expect(result.trace.path_state_to_mission).toEqual([
          result.summary.realization.system_state_id,
          result.summary.candidate_id,
          result.summary.mission_id,
        ]);
      }),
      { numRuns: 20 },
    );
  });

  it('the same randomized input produces a byte-identical result (canonical serialization)', () => {
    fc.assert(
      fc.property(missionInputArbitrary, (missionInput) => {
        const input = pipelineInputFor(missionInput);
        const first = runGreenfieldPipeline(input);
        const second = runGreenfieldPipeline(pipelineInputFor(missionInput));
        expect(canonicalSerialize(second)).toBe(canonicalSerialize(first));
      }),
      { numRuns: 10 },
    );
  });

  it('formalization: goals with >= 1 measure become MEASURABLE; without stay PROPOSED', () => {
    fc.assert(
      fc.property(missionInputArbitrary, (missionInput) => {
        const record = runMissionStage({ mission_input: missionInput, run: buildRunContext() });
        for (const goal of record.mission.content.goals) {
          if (goal.measures.length > 0) {
            expect(goal.status).toBe('MEASURABLE');
          } else {
            expect(goal.status).toBe('PROPOSED');
          }
        }
      }),
      { numRuns: 25 },
    );
  });
});

describe('property: trace chain fragility', () => {
  it('removing any chain-critical handoff link from any randomized run breaks the completeness assertion', () => {
    fc.assert(
      fc.property(missionInputArbitrary, fc.nat(), (missionInput, linkIndex) => {
        const result = runGreenfieldPipeline(pipelineInputFor(missionInput));
        // Chain-critical handoff links: everything except the reconciliation
        // stage's finding links and the IMPLEMENTS handoff when its pair is
        // redundantly covered by reconciliation links (multiple typed links
        // between one pair are meaningful; the reconciliation links are
        // supplementary traceability over the same pair).
        const reconciliationPairs = new Set(
          result.stages.reconciliation.links.map((link) => `${link.source}\u0000${link.target}`),
        );
        const handoffs = result.trace.links.filter(
          (link) =>
            !(
              result.stages.reconciliation.links.some(
                (entry) =>
                  entry.source === link.source && entry.target === link.target && entry.type === link.type,
              ) ||
              (reconciliationPairs.has(`${link.source}\u0000${link.target}`) && link.type === 'IMPLEMENTS')
            ),
        );
        expect(handoffs.length).toBeGreaterThan(0);
        const victim = handoffs[linkIndex % handoffs.length]!;
        const broken = result.trace.links.filter(
          (link) =>
            !(link.source === victim.source && link.target === victim.target && link.type === victim.type),
        );
        const check = checkTraceChain({
          artifacts: result.trace.artifacts,
          links: broken,
          mission_id: result.summary.mission_id,
          system_state_id: result.summary.realization.system_state_id,
        });
        expect(check.ok).toBe(false);
        expect(() =>
          assertTraceChainComplete({
            artifacts: result.trace.artifacts,
            links: broken,
            mission_id: result.summary.mission_id,
            system_state_id: result.summary.realization.system_state_id,
          }),
        ).toThrowError(/INCOMPLETE/i);
      }),
      { numRuns: 15 },
    );
  });
});
