/**
 * Stage-level unit tests: each of the six greenfield stages against the
 * golden world fixture (deterministic; the W14 acceptance criteria per
 * stage).
 */

import { describe, expect, it } from 'vitest';
import { assertValidMission } from '@sos-2/mission';
import { assertValidCompositionArtifact } from '@sos-2/composition';
import { assertValidDecisionRecord } from '@sos-2/decision';
import { assertValidAskRequest } from '@sos-2/authority';
import { assertValidSystemStateArtifact } from '@sos-2/system-state';
import { assertValidArchitectureGraphArtifact } from '@sos-2/architecture';
import { isImplementationModel } from '@sos-2/semantic-spine';
import {
  runCandidateStage,
  runDecisionStage,
  runEvidenceStage,
  runMissionStage,
  runRealizationStage,
  runReconciliationStage,
} from '../src/index.js';
import type { MissionStageRecord } from '../src/index.js';
import {
  buildEcology,
  buildMissionInput,
  buildObservations,
  buildPipelineInput,
  buildRealizationPlan,
  buildRiskProfile,
  buildRunContext,
  buildWorld,
  GOLDEN_CAPABILITY,
  validGrant,
} from './helpers.js';

describe('stage 1: mission formalization', () => {
  it('formalizes goals with measures as MEASURABLE and without as PROPOSED', () => {
    const record = runMissionStage({
      mission_input: buildMissionInput(),
      run: buildRunContext(),
    });
    expect(record.formalization).toEqual([
      { goal_id: 'goal-latency', status: 'MEASURABLE', measures: ['measure-p99'] },
      { goal_id: 'goal-cost', status: 'MEASURABLE', measures: ['measure-cost'] },
      { goal_id: 'goal-trust', status: 'PROPOSED', measures: [] },
    ]);
    expect(record.mission.content.goals.map((goal) => goal.status)).toEqual([
      'MEASURABLE',
      'MEASURABLE',
      'PROPOSED',
    ]);
  });

  it('produces a spine-valid ACTIVE Mission artifact with a deterministic id', () => {
    const input = { mission_input: buildMissionInput(), run: buildRunContext() };
    const first = runMissionStage(input);
    const second = runMissionStage(input);
    expect(() => assertValidMission(first.mission)).not.toThrow();
    expect(first.mission.envelope.status).toBe('ACTIVE');
    expect(first.mission.envelope.kind).toBe('Mission');
    expect(second.mission.envelope.id).toBe(first.mission.envelope.id);
    expect(recordLinks(first)).toEqual([]);
  });

  it('rejects a goal referencing an unknown measure (the W1 contract)', () => {
    const missionInput = buildMissionInput();
    missionInput.goals = [
      { id: 'goal-broken', statement: 'references nothing', measures: ['measure-missing'] },
    ];
    expect(() =>
      runMissionStage({ mission_input: missionInput, run: buildRunContext() }),
    ).toThrowError(/unknown measure/i);
  });
});

describe('stage 2: capability derivation + candidate composition', () => {
  const mission = runMissionStage({ mission_input: buildMissionInput(), run: buildRunContext() });

  it('searches at the highest validated altitude (VALIDATED_COMPOSITION)', () => {
    const record = runCandidateStage({
      mission_stage: mission,
      world: buildWorld(),
      run: buildRunContext(),
      policy: { kind: 'GREEDY' },
    });
    expect(record.search.final_altitude).toBe('VALIDATED_COMPOSITION');
    expect(record.search.ladder[0]!.altitude).toBe('VALIDATED_COMPOSITION');
    expect(record.search.ladder[0]!.outcome).toBe('SATISFIED');
    expect(record.search.ladder).toHaveLength(1);
    expect(record.selection.source).toBe('VALIDATED_COMPOSITION');
  });

  it('composes the candidate from the found composition members with own evidence obligations', () => {
    const record = runCandidateStage({
      mission_stage: mission,
      world: buildWorld(),
      run: buildRunContext(),
      policy: { kind: 'GREEDY' },
    });
    const ecology = buildEcology(GOLDEN_CAPABILITY);
    expect(record.members.map((member) => member.package_id).sort()).toEqual(
      ecology.members.map((member) => member.envelope.id).sort(),
    );
    expect(record.members.map((member) => member.role).sort()).toEqual(['image-resize-storage', 'image-resize-transform']);
    expect(record.candidate.content.maturity).toBe('DISCOVERED');
    expect(record.candidate.content.semantic_capability).toBe(GOLDEN_CAPABILITY);
    expect(record.candidate.content.contracts).toEqual([`contract:${GOLDEN_CAPABILITY}/v1`]);
    expect(record.own_evidence_obligations.length).toBeGreaterThanOrEqual(2);
    expect(() => assertValidCompositionArtifact(record.candidate)).not.toThrow();
    // The reused wiring is remapped onto the derived roles.
    expect(record.bindings).toEqual([
      {
        kind: 'DATA_FLOW',
        source_role: 'image-resize-transform',
        target_role: 'image-resize-storage',
        contract: `contract:${GOLDEN_CAPABILITY}/v1`,
        wiring: { path: `${GOLDEN_CAPABILITY}-output` },
      },
    ]);
  });

  it('mints SATISFIES (mission) + COMPOSES (members) trace links', () => {
    const record = runCandidateStage({
      mission_stage: mission,
      world: buildWorld(),
      run: buildRunContext(),
      policy: { kind: 'GREEDY' },
    });
    const satisfies = recordLinks(record).find((link) => link.type === 'SATISFIES')!;
    expect(satisfies.source).toBe(record.candidate.envelope.id);
    expect(satisfies.target).toBe(mission.mission.envelope.id);
    for (const member of record.members) {
      const composes = recordLinks(record).find(
        (link) => link.type === 'COMPOSES' && link.target === member.package_id,
      )!;
      expect(composes.source).toBe(record.candidate.envelope.id);
    }
  });

  it('rejects a search that descends below the validated altitudes', () => {
    const emptyWorld = {
      registry: buildEcology('unrelated-capability').registry,
      evidenceResolver: () => undefined,
      grants: [],
    };
    expect(() =>
      runCandidateStage({
        mission_stage: mission,
        world: emptyWorld,
        run: buildRunContext(),
        policy: { kind: 'GREEDY' },
      }),
    ).toThrowError(/no survivor|VALIDATED/i);
  });
});

describe('stage 3: human decision flow', () => {
  const mission = runMissionStage({ mission_input: buildMissionInput(), run: buildRunContext() });
  const candidate = runCandidateStage({
    mission_stage: mission,
    world: buildWorld(),
    run: buildRunContext(),
    policy: { kind: 'GREEDY' },
  });

  it('ACTs under a valid covering grant (the golden path)', () => {
    const record = runDecisionStage({
      mission_stage: mission,
      candidate_stage: candidate,
      world: buildWorld(),
      run: buildRunContext(),
      risk: buildRiskProfile(),
      decider: null,
    });
    expect(record.action).toBe('ACT');
    expect(record.approved).toBe(true);
    expect(record.ask).toBeNull();
    expect(record.resolution).toBeNull();
    expect(() => assertValidDecisionRecord(record.record)).not.toThrow();
    expect(record.record.content.action).toBe('ACT');
    expect(record.record.content.authority.verdict_code).toBe('PERMITTED');
  });

  it('escalates to a structured ASK without grants and resolves it through the queue', () => {
    const world = buildWorld({ grants: [] });
    const record = runDecisionStage({
      mission_stage: mission,
      candidate_stage: candidate,
      world,
      run: buildRunContext(),
      risk: buildRiskProfile(),
      decider: { resolved_by: 'w14-test-architect', chosen_alternative_id: null, note: 'approved for the golden realization' },
    });
    expect(record.action).toBe('ASK');
    expect(record.ask).not.toBeNull();
    expect(record.queue_entry_id).toBe(record.ask!.envelope.id);
    expect(() => assertValidAskRequest(record.ask!)).not.toThrow();
    expect(record.ask!.content.alternatives.length).toBeGreaterThan(0);
    // The decider resolved it: the resolution decision approves the candidate.
    expect(record.resolution).not.toBeNull();
    expect(record.resolution!.content.action).toBe('ACT');
    expect(record.approved).toBe(true);
    // The ask is derived from the escalated decision; both support the candidate.
    const types = recordLinks(record).map((link) => link.type);
    expect(types).toContain('DERIVED_FROM');
    expect(types.filter((type) => type === 'SUPPORTS')).toHaveLength(2);
  });

  it('an unresolved ASK leaves the candidate unapproved (no silent autonomy)', () => {
    const record = runDecisionStage({
      mission_stage: mission,
      candidate_stage: candidate,
      world: buildWorld({ grants: [] }),
      run: buildRunContext(),
      risk: buildRiskProfile(),
      decider: null,
    });
    expect(record.action).toBe('ASK');
    expect(record.approved).toBe(false);
    expect(record.resolution).toBeNull();
  });

  it('rejects a decider choosing a foreign alternative id', () => {
    expect(() =>
      runDecisionStage({
        mission_stage: mission,
        candidate_stage: candidate,
        world: buildWorld({ grants: [] }),
        run: buildRunContext(),
        risk: buildRiskProfile(),
        decider: { resolved_by: 'whoever', chosen_alternative_id: 'not-an-alternative', note: 'note' },
      }),
    ).toThrowError(/not one of the ask's alternatives/i);
  });
});

describe('stage 4: realization', () => {
  function goldenDecision() {
    const mission = runMissionStage({ mission_input: buildMissionInput(), run: buildRunContext() });
    const candidate = runCandidateStage({
      mission_stage: mission,
      world: buildWorld(),
      run: buildRunContext(),
      policy: { kind: 'GREEDY' },
    });
    const decision = runDecisionStage({
      mission_stage: mission,
      candidate_stage: candidate,
      world: buildWorld(),
      run: buildRunContext(),
      risk: buildRiskProfile(),
      decider: null,
    });
    return { mission, candidate, decision };
  }

  it('realizes the approved candidate as a System State revision + declared architecture + implementation model', () => {
    const { mission, candidate, decision } = goldenDecision();
    const record = runRealizationStage({
      mission_stage: mission,
      candidate_stage: candidate,
      decision_stage: decision,
      plan: buildRealizationPlan(),
      run: buildRunContext(),
    });
    expect(() => assertValidSystemStateArtifact(record.system_state)).not.toThrow();
    expect(() => assertValidArchitectureGraphArtifact(record.architecture_graph)).not.toThrow();
    expect(isImplementationModel(record.implementation_model)).toBe(true);
    expect(record.system_state.envelope.status).toBe('ACTIVE');
    expect(record.system_state.envelope.authority_ref).toBe(decision.record.envelope.id);
    expect(record.revision_chain).toEqual([
      { id: record.system_state.envelope.id, version: 1, status: 'ACTIVE' },
    ]);
    // The mutual state <-> graph consistency.
    expect(record.system_state.content.architecture_ref.artifact_id).toBe(record.architecture_graph.envelope.id);
    expect(record.architecture_graph.content.projects_system_state.system_state_id).toBe(record.system_state.envelope.id);
    // The declared graph carries the capability + member components.
    const nodeKinds = record.architecture_graph.content.nodes.map((node) => `${node.id}:${node.kind}`);
    expect(nodeKinds).toContain(`capability:${GOLDEN_CAPABILITY}:Capability`);
    expect(nodeKinds).toContain('component:image-resize-storage:Component');
    expect(nodeKinds).toContain('component:image-resize-transform:Component');
    // The exact-revision discipline.
    expect(record.system_state.content.implementation[0]!.revision).toEqual({
      kind: 'git-sha',
      value: buildRealizationPlan().revision,
    });
    // The trace links: REALIZES x2 + IMPLEMENTS.
    const links = recordLinks(record);
    expect(links.filter((link) => link.type === 'REALIZES')).toHaveLength(2);
    expect(links.filter((link) => link.type === 'IMPLEMENTS')).toHaveLength(1);
  });

  it('REFUSES to realize an unapproved candidate (bypassing authority is rejected)', () => {
    const { mission, candidate } = goldenDecision();
    const unapproved = runDecisionStage({
      mission_stage: mission,
      candidate_stage: candidate,
      world: buildWorld({ grants: [] }),
      run: buildRunContext(),
      risk: buildRiskProfile(),
      decider: null,
    });
    expect(unapproved.approved).toBe(false);
    expect(() =>
      runRealizationStage({
        mission_stage: mission,
        candidate_stage: candidate,
        decision_stage: unapproved,
        plan: buildRealizationPlan(),
        run: buildRunContext(),
      }),
    ).toThrowError(/realization REFUSED/i);
  });
});

describe('stage 5: reconciliation', () => {
  function goldenRealization() {
    const mission = runMissionStage({ mission_input: buildMissionInput(), run: buildRunContext() });
    const candidate = runCandidateStage({
      mission_stage: mission,
      world: buildWorld(),
      run: buildRunContext(),
      policy: { kind: 'GREEDY' },
    });
    const decision = runDecisionStage({
      mission_stage: mission,
      candidate_stage: candidate,
      world: buildWorld(),
      run: buildRunContext(),
      risk: buildRiskProfile(),
      decider: null,
    });
    const realization = runRealizationStage({
      mission_stage: mission,
      candidate_stage: candidate,
      decision_stage: decision,
      plan: buildRealizationPlan(),
      run: buildRunContext(),
    });
    return { mission, candidate, decision, realization };
  }

  it('classifies the correspondence honestly and reports a clean reconciliation', () => {
    const { realization } = goldenRealization();
    const record = runReconciliationStage({ realization_stage: realization, run: buildRunContext() });
    expect(record.clean).toBe(true);
    expect(record.drift).toEqual([]);
    // The declared non-Component nodes are realized by refinement components
    // (PRESERVING_REFINEMENT); the undeclared glue is an IMPLEMENTATION_DETAIL.
    expect(record.records.map((entry) => `${entry.subject}:${entry.classification}`)).toEqual([
      'capability:image-resize:PRESERVING_REFINEMENT',
      'component:observability-glue:IMPLEMENTATION_DETAIL',
      'deploy:production:PRESERVING_REFINEMENT',
      'iface:contract:image-resize-storage-v1:PRESERVING_REFINEMENT',
      'iface:contract:image-resize-transform-v1:PRESERVING_REFINEMENT',
    ]);
    // Every finding carries its typed link (deduplicated per (source, target, type)).
    expect(record.links).toHaveLength(2);
    const linkTypes = record.links.map((link) => link.type).sort();
    expect(linkTypes).toEqual(['OBSERVES', 'REFINES']);
    for (const link of record.links) {
      expect(link.source).toBe(realization.implementation_model.id);
      expect(link.target).toBe(realization.architecture_graph.envelope.id);
    }
  });

  it('reports DRIFT honestly when a declared component is missing from the implementation', () => {
    const { realization } = goldenRealization();
    const brokenModel = {
      ...realization.implementation_model,
      components: realization.implementation_model.components.filter(
        (component) => component.id !== 'component:image-resize-transform',
      ),
      dependencies: realization.implementation_model.dependencies.filter(
        (dependency) =>
          dependency.source !== 'component:image-resize-transform' &&
          dependency.target !== 'component:image-resize-transform',
      ),
    };
    const record = runReconciliationStage({
      realization_stage: { ...realization, implementation_model: brokenModel },
      run: buildRunContext(),
    });
    expect(record.clean).toBe(false);
    // The missing component node, its orphaned interface node, and its four
    // incident declared edges are DRIFT (honestly reported).
    expect(record.classification_counts['DRIFT']).toBe(6);
    expect(record.drift).toHaveLength(6);
    expect(record.drift.map((entry) => entry.classification).every((classification) => classification === 'DRIFT')).toBe(true);
    expect(record.records.map((entry) => entry.subject)).toContain('component:image-resize-transform');
    expect(record.records.map((entry) => entry.subject)).toContain('iface:contract:image-resize-transform-v1');
  });
});

describe('stage 6: evidence ingestion', () => {
  it('ingests truthful states (SUCCESS and UNAVAILABLE stay distinct) and OBSERVES-links the realization', () => {
    const input = buildPipelineInput();
    const mission = runMissionStage({ mission_input: input.mission_input, run: input.run });
    const candidate = runCandidateStage({
      mission_stage: mission,
      world: input.world,
      run: input.run,
      policy: input.search_policy,
    });
    const decision = runDecisionStage({
      mission_stage: mission,
      candidate_stage: candidate,
      world: input.world,
      run: input.run,
      risk: input.risk,
      decider: input.decider,
    });
    const realization = runRealizationStage({
      mission_stage: mission,
      candidate_stage: candidate,
      decision_stage: decision,
      plan: input.realization,
      run: input.run,
    });
    const record = runEvidenceStage({
      realization_stage: realization,
      run: input.run,
      observations: input.observations,
    });
    expect(record.records).toHaveLength(3);
    expect(record.availability.SUCCESS).toBe(2);
    expect(record.availability.UNAVAILABLE).toBe(1);
    expect(record.observes).toHaveLength(3);
    for (const link of record.observes) {
      expect(link.type).toBe('OBSERVES');
      expect(link.target).toBe(realization.system_state.envelope.id);
    }
    for (const entry of record.freshness) {
      expect(entry.status).toBe('FRESH');
    }
  });

  it('rejects an empty observation set (a realization without evidence)', () => {
    const input = buildPipelineInput();
    const mission = runMissionStage({ mission_input: input.mission_input, run: input.run });
    const candidate = runCandidateStage({
      mission_stage: mission,
      world: input.world,
      run: input.run,
      policy: input.search_policy,
    });
    const decision = runDecisionStage({
      mission_stage: mission,
      candidate_stage: candidate,
      world: input.world,
      run: input.run,
      risk: input.risk,
      decider: null,
    });
    const realization = runRealizationStage({
      mission_stage: mission,
      candidate_stage: candidate,
      decision_stage: decision,
      plan: input.realization,
      run: input.run,
    });
    expect(() =>
      runEvidenceStage({ realization_stage: realization, run: input.run, observations: [] }),
    ).toThrowError(/at least one raw observation/i);
  });
});

function recordLinks(record: { links: MissionStageRecord['links'] }): MissionStageRecord['links'] {
  return record.links;
}
