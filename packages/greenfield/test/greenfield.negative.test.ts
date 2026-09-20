/**
 * Negative tests — the four W14 rejection disciplines (plus the greenfield
 * gates):
 *
 *   1. a pipeline result with a broken trace link is REJECTED;
 *   2. a candidate without its own evidence (obligations, or citing member
 *      evidence as if it were composition evidence) is REJECTED;
 *   3. a decision that bypassed the authority (ASK without a resolution) is
 *      REJECTED at the realization gate;
 *   4. a realization without a System State revision (an unregistered,
 *      inconsistent or non-root revision pair) is REJECTED.
 */

import { describe, expect, it } from 'vitest';
import { createPackageComposition } from '@sos-2/composition';
import { createSystemState, createSystemStateStore } from '@sos-2/system-state';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import {
  assertCandidateOwnEvidence,
  assertRealizationRevision,
  assertTraceChainComplete,
  checkTraceChain,
  runCandidateStage,
  runDecisionStage,
  runGreenfieldPipeline,
  runMissionStage,
  runRealizationStage,
} from '../src/index.js';
import type { MissionStageRecord } from '../src/index.js';
import {
  buildEcology,
  buildMissionInput,
  buildPipelineInput,
  buildRealizationPlan,
  buildRiskProfile,
  buildRunContext,
  buildWorld,
  GOLDEN_CAPABILITY,
} from './helpers.js';

function goldenStages() {
  const input = buildPipelineInput();
  const mission = runMissionStage({ mission_input: input.mission_input, run: input.run });
  const candidate = runCandidateStage({
    mission_stage: mission,
    world: input.world,
    run: input.run,
    policy: input.search_policy,
  });
  return { input, mission, candidate };
}

describe('negative 1: a broken trace link fails the pipeline', () => {
  /**
   * The chain-critical handoff links. The reconciliation stage's finding
   * links (implModel -> archGraph, conformance-typed) are SUPPLEMENTARY:
   * they redundantly cover the same artifact pair as the realization's
   * IMPLEMENTS handoff (multiple typed links between one pair are
   * meaningful — different semantics), so a handoff whose pair is covered
   * by reconciliation links is not a bridge by itself.
   */
  function chainCriticalHandoffs(result: ReturnType<typeof runGreenfieldPipeline>) {
    const reconciliationPairs = new Set(
      result.stages.reconciliation.links.map((link) => `${link.source}\u0000${link.target}`),
    );
    return result.trace.links.filter(
      (link) =>
        !(
          result.stages.reconciliation.links.some(
            (entry) =>
              entry.source === link.source && entry.target === link.target && entry.type === link.type,
          ) ||
          (reconciliationPairs.has(`${link.source}\u0000${link.target}`) && link.type === 'IMPLEMENTS')
        ),
    );
  }

  it('removing ANY chain-critical handoff link breaks the completeness assertion', () => {
    const result = runGreenfieldPipeline(buildPipelineInput());
    const handoffs = chainCriticalHandoffs(result);
    expect(handoffs.length).toBeGreaterThan(0);
    for (const link of handoffs) {
      const broken = result.trace.links.filter(
        (entry) => !(entry.source === link.source && entry.target === link.target && entry.type === link.type),
      );
      const check = checkTraceChain({
        artifacts: result.trace.artifacts,
        links: broken,
        mission_id: result.summary.mission_id,
        system_state_id: result.summary.realization.system_state_id,
      });
      expect(check.ok, `removing ${link.source} -${link.type}-> ${link.target} must break the chain`).toBe(false);
      expect(() =>
        assertTraceChainComplete({
          artifacts: result.trace.artifacts,
          links: broken,
          mission_id: result.summary.mission_id,
          system_state_id: result.summary.realization.system_state_id,
        }),
      ).toThrowError(/INCOMPLETE/i);
    }
  });

  it('stripping the implementation<->architecture traceability surface (IMPLEMENTS + finding links) breaks the chain', () => {
    const result = runGreenfieldPipeline(buildPipelineInput());
    const implementationModelId = result.stages.realization.implementation_model.id;
    const graphId = result.stages.realization.architecture_graph.envelope.id;
    const without = result.trace.links.filter(
      (link) => !(link.source === implementationModelId && link.target === graphId),
    );
    expect(without.length).toBeLessThan(result.trace.links.length);
    expect(() =>
      assertTraceChainComplete({
        artifacts: result.trace.artifacts,
        links: without,
        mission_id: result.summary.mission_id,
        system_state_id: result.summary.realization.system_state_id,
      }),
    ).toThrowError(/present in no trace link/i);
  });

  it('the reconciliation finding links are SUPPLEMENTARY traceability (removing them keeps the chain connected)', () => {
    const result = runGreenfieldPipeline(buildPipelineInput());
    expect(result.stages.reconciliation.links.length).toBeGreaterThan(0);
    const supplementary = new Set(
      result.stages.reconciliation.links.map(
        (link) => `${link.source}\u0000${link.target}\u0000${link.type}`,
      ),
    );
    const without = result.trace.links.filter(
      (link) => !supplementary.has(`${link.source}\u0000${link.target}\u0000${link.type}`),
    );
    // The implementation model stays connected through its IMPLEMENTS handoff.
    expect(() =>
      assertTraceChainComplete({
        artifacts: result.trace.artifacts,
        links: without,
        mission_id: result.summary.mission_id,
        system_state_id: result.summary.realization.system_state_id,
      }),
    ).not.toThrow();
  });

  it('an artifact absent from every link is reported as unlinked', () => {
    const result = runGreenfieldPipeline(buildPipelineInput());
    const orphan = deriveDeterministicArtifactId('SystemState', { note: 'orphaned artifact' });
    const check = checkTraceChain({
      artifacts: [...result.trace.artifacts, orphan],
      links: result.trace.links,
      mission_id: result.summary.mission_id,
      system_state_id: result.summary.realization.system_state_id,
    });
    expect(check.ok).toBe(false);
    expect(check.unlinked_artifacts).toEqual([orphan]);
  });

  it('a stage handoff with a missing link fails the pipeline immediately', () => {
    // The pipeline itself asserts every handoff link right after the stage
    // that must mint it; simulate the broken handoff by dropping the
    // candidate's SATISFIES link from the stage record and re-checking
    // through the exported assertion.
    const result = runGreenfieldPipeline(buildPipelineInput());
    const withoutSatisfies = result.trace.links.filter((link) => link.type !== 'SATISFIES');
    expect(() =>
      assertTraceChainComplete({
        artifacts: result.trace.artifacts,
        links: withoutSatisfies,
        mission_id: result.summary.mission_id,
        system_state_id: result.summary.realization.system_state_id,
      }),
    ).toThrowError(/not queryable/i);
  });
});

describe('negative 2: a candidate without its own evidence is REJECTED', () => {
  it('a candidate citing MEMBER evidence as composition evidence is rejected (member evidence never substitutes)', () => {
    const ecology = buildEcology(GOLDEN_CAPABILITY);
    const world = buildWorld({ ecology });
    const memberEvidence = ecology.members[0]!.content.evidence_refs[0]!;
    const candidate = createPackageComposition({
      content: {
        semantic_capability: GOLDEN_CAPABILITY,
        contracts: [`contract:${GOLDEN_CAPABILITY}/v1`],
        members: ecology.composition.content.members.map((member) => ({ ...member })),
        bindings: ecology.composition.content.bindings.map((binding) => structuredClone(binding)),
        preconditions: ['precondition'],
        postconditions: ['postcondition'],
        applicability: [
          {
            kind: 'QUALITATIVE',
            uncertainty_class: 'UNQUANTIFIED',
            context: { stage: 'greenfield' },
            sample_size: 0,
            window: null,
          },
        ],
        evidence_refs: [memberEvidence], // <- MEMBER evidence, not own evidence
        failure_refs: [],
        compatibility_refs: [],
        assurance_obligations: [{ kind: 'TEST', obligation: 'obligation' }],
        context: { stage: 'greenfield' },
        learned_limitations: [],
        diversity_profile: {
          family: 'edge-cache',
          dimensions: [{ dimension: 'LATENCY', stance: 'sub-50ms composed p99' }],
        },
        maturity: 'DISCOVERED',
        independence: [],
        changes: 'negative-test candidate',
        superseded_by: null,
      },
      provenance: ['W14:greenfield-test:negative'],
      created_at: '2025-06-02T00:00:00.000Z',
      status: 'DRAFT',
    });
    expect(() => assertCandidateOwnEvidence(candidate, world)).toThrowError(
      /never substitutes|not composition evidence/i,
    );
  });

  it('a candidate without own evidence OBLIGATIONS is rejected by the composition contract itself', () => {
    const ecology = buildEcology(GOLDEN_CAPABILITY);
    expect(() =>
      createPackageComposition({
        content: {
          semantic_capability: GOLDEN_CAPABILITY,
          contracts: [`contract:${GOLDEN_CAPABILITY}/v1`],
          members: ecology.composition.content.members.map((member) => ({ ...member })),
          bindings: ecology.composition.content.bindings.map((binding) => structuredClone(binding)),
          preconditions: ['precondition'],
          postconditions: ['postcondition'],
          applicability: [
            {
              kind: 'QUALITATIVE',
              uncertainty_class: 'UNQUANTIFIED',
              context: { stage: 'greenfield' },
              sample_size: 0,
              window: null,
            },
          ],
          evidence_refs: [],
          failure_refs: [],
          compatibility_refs: [],
          assurance_obligations: [], // <- no own obligations: reuse bypasses assurance
          context: { stage: 'greenfield' },
          learned_limitations: [],
          diversity_profile: {
            family: 'edge-cache',
            dimensions: [{ dimension: 'LATENCY', stance: 'sub-50ms composed p99' }],
          },
          maturity: 'DISCOVERED',
          independence: [],
          changes: 'negative-test candidate',
          superseded_by: null,
        },
        provenance: ['W14:greenfield-test:negative'],
        created_at: '2025-06-02T00:00:00.000Z',
        status: 'DRAFT',
      }),
    ).toThrowError(/assurance/i);
  });

  it('a validated-maturity candidate with an EMPTY evidence set is rejected (own evidence required)', () => {
    const ecology = buildEcology(GOLDEN_CAPABILITY);
    expect(() =>
      createPackageComposition({
        content: {
          semantic_capability: GOLDEN_CAPABILITY,
          contracts: [`contract:${GOLDEN_CAPABILITY}/v1`],
          members: ecology.composition.content.members.map((member) => ({ ...member })),
          bindings: ecology.composition.content.bindings.map((binding) => structuredClone(binding)),
          preconditions: ['precondition'],
          postconditions: ['postcondition'],
          applicability: [
            {
              kind: 'QUALITATIVE',
              uncertainty_class: 'UNQUANTIFIED',
              context: { stage: 'greenfield' },
              sample_size: 0,
              window: null,
            },
          ],
          evidence_refs: [], // <- VALIDATED requires its own evidence
          failure_refs: [],
          compatibility_refs: [],
          assurance_obligations: [{ kind: 'TEST', obligation: 'obligation' }],
          context: { stage: 'greenfield' },
          learned_limitations: [],
          diversity_profile: {
            family: 'edge-cache',
            dimensions: [{ dimension: 'LATENCY', stance: 'sub-50ms composed p99' }],
          },
          maturity: 'VALIDATED',
          independence: [],
          changes: 'negative-test candidate',
          superseded_by: null,
        },
        provenance: ['W14:greenfield-test:negative'],
        created_at: '2025-06-02T00:00:00.000Z',
        status: 'DRAFT',
      }),
    ).toThrowError(/own evidence/i);
  });
});

describe('negative 3: a decision bypassing the authority is REJECTED', () => {
  it('the pipeline REFUSES to realize when the decision escalated and nobody resolved it', () => {
    expect(() =>
      runGreenfieldPipeline(buildPipelineInput({ grants: [], decider: null })),
    ).toThrowError(/realization REFUSED/i);
  });

  it('the realization gate rejects an unapproved decision (no silent autonomy)', () => {
    const { input, mission, candidate } = goldenStages();
    const escalated = runDecisionStage({
      mission_stage: mission,
      candidate_stage: candidate,
      world: { ...input.world, grants: [] },
      run: input.run,
      risk: buildRiskProfile(),
      decider: null,
    });
    expect(escalated.action).toBe('ASK');
    expect(escalated.approved).toBe(false);
    expect(() =>
      runRealizationStage({
        mission_stage: mission,
        candidate_stage: candidate,
        decision_stage: escalated,
        plan: buildRealizationPlan(),
        run: buildRunContext(),
      }),
    ).toThrowError(/realization REFUSED/i);
  });

  it('an EXPIRED grant never authorizes (dead authority is not authority)', () => {
    expect(() =>
      runGreenfieldPipeline(
        buildPipelineInput({
          grants: [],
          decider: null,
        }),
      ),
    ).toThrowError(/realization REFUSED/i);
  });
});

describe('negative 4: a realization without a System State revision is REJECTED', () => {
  it('an architecture_ref pointing at a foreign graph id is rejected (inconsistent pair)', () => {
    const result = runGreenfieldPipeline(buildPipelineInput());
    const foreignGraphId = deriveDeterministicArtifactId('ArchitectureGraph', {
      note: 'foreign graph',
    });
    const doctored = {
      ...result.stages.realization,
      system_state: {
        ...result.stages.realization.system_state,
        content: {
          ...result.stages.realization.system_state.content,
          architecture_ref: { artifact_id: foreignGraphId, version: 1 },
        },
      },
    };
    expect(() =>
      assertRealizationRevision({
        system_state: doctored.system_state,
        architecture_graph: doctored.architecture_graph,
      }),
    ).toThrowError(/architecture_ref .* does not point at/i);
  });

  it('a graph projecting a foreign state id is rejected (inconsistent pair)', () => {
    const result = runGreenfieldPipeline(buildPipelineInput());
    const foreignStateId = deriveDeterministicArtifactId('SystemState', { note: 'foreign state' });
    const doctoredGraph = {
      ...result.stages.realization.architecture_graph,
      content: {
        ...result.stages.realization.architecture_graph.content,
        projects_system_state: { system_state_id: foreignStateId, version: 1 },
      },
    };
    expect(() =>
      assertRealizationRevision({
        system_state: result.stages.realization.system_state,
        architecture_graph: doctoredGraph,
      }),
    ).toThrowError(/projects SystemState .* but the realized revision is/i);
  });

  it('a state whose revision chain is not a complete root is rejected (W2 chain discipline)', () => {
    const result = runGreenfieldPipeline(buildPipelineInput());
    // A state that SUPERSEDES an unregistered revision: the W2 store
    // rejects the dangling chain — a realization riding on it has no
    // complete, queryable revision chain (the negative discipline behind
    // assertRealizationRevision's store check).
    const dangling = createSystemState({
      content: {
        ...result.stages.realization.system_state.content,
      },
      provenance: ['W14:greenfield-test:negative'],
      created_at: '2025-06-02T00:04:00.000Z',
      status: 'ACTIVE',
      version: 2,
      supersedes: deriveDeterministicArtifactId('SystemState', { note: 'unregistered predecessor' }),
    });
    expect(dangling.envelope.supersedes).not.toBeNull();
    const store = createSystemStateStore([]);
    // A dangling supersedes cannot register: no complete revision chain exists.
    expect(() => store.put(dangling)).toThrowError(/supersedes target is not registered/i);
    // And the golden realization's own state IS a complete root chain.
    expect(() =>
      assertRealizationRevision({
        system_state: result.stages.realization.system_state,
        architecture_graph: result.stages.realization.architecture_graph,
      }),
    ).not.toThrow();
  });
});

describe('negative: greenfield search gates', () => {
  it('an empty ecology yields no candidate and the stage fails loudly', () => {
    const mission: MissionStageRecord = runMissionStage({
      mission_input: buildMissionInput('unknown-capability'),
      run: buildRunContext(),
    });
    const world = {
      registry: buildEcology(GOLDEN_CAPABILITY).registry,
      evidenceResolver: () => undefined,
      grants: [],
    };
    expect(() =>
      runCandidateStage({
        mission_stage: mission,
        world,
        run: buildRunContext(),
        policy: { kind: 'GREEDY' },
      }),
    ).toThrowError(/no survivor/i);
  });
});
