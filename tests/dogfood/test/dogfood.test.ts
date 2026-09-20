/**
 * THE W17 INTEGRATED DOGFOOD — one connected end-to-end scenario through
 * EVERY stage of the merged system, driven exclusively through the public
 * exports of the three harness apps' underlying packages:
 *
 *   mission formalization -> greenfield realization (W14 stages)
 *     -> brownfield optimization loop (W15 stages)
 *     -> self-evolution meta loop (W16 stages)
 *
 * One semantic subgraph from the Mission to the learned ecology updates;
 * every handoff a typed trace link; every artifact carrying its exact
 * revision. The scenario is PURE and DETERMINISTIC (fixed instants, fixed
 * seeds, content-addressed identities) — pinned byte-identical by the
 * determinism case.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import { connectedComponent, directedPath } from '@sos-2/greenfield';
import { assertRealizationRevision } from '@sos-2/greenfield';
import { RetrievalFacade } from '@sos-2/retrieval';
import { buildRationaleChain, assertValidRationaleChain, projectEvidenceSet, vmHash } from '@sos-2/ui-contracts';
import { MissionStore } from '@sos-2/mission';
import { isNonAuthoritativeEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import {
  BROWNFIELD_NOW,
  DOGFOOD_OBSERVATIONS,
  REALIZED_REVISION,
  RUN_CONTEXT,
  dogfoodProjection,
  runIntegratedDogfood,
} from '../src/scenario.js';
import type { DogfoodResult } from '../src/scenario.js';
import { DOGFOOD_CASES } from '../src/coverage.js';

let dogfood: DogfoodResult;

beforeAll(() => {
  dogfood = runIntegratedDogfood();
});

/** Resolve one ecology evidence ref (all refs resolve — the resolver is total over the ecology). */
function resolveEvidence(result: DogfoodResult, id: string): EvidenceRecordW3 | undefined {
  return result.ecology.evidenceResolver(id);
}

/** Deduplicate (source, target, type) triples over the integrated trace. */
function uniqueLinks(links: readonly TraceLink[]): TraceLink[] {
  const seen = new Set<string>();
  const result: TraceLink[] = [];
  for (const link of links) {
    const key = `${link.source}\u0000${link.target}\u0000${link.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(link);
    }
  }
  return result;
}

describe('W17 integrated dogfood — mission to learned ecology updates', () => {
  test(DOGFOOD_CASES.missionFormalization, () => {
    const missionStage = dogfood.askRun.stages.mission;
    const mission = missionStage.mission;
    // R1: mission-first — the Mission artifact is the authority root of the chain.
    expect(mission.envelope.kind).toBe('Mission');
    expect(mission.envelope.status).toBe('ACTIVE');
    expect(mission.envelope.version).toBe(1);
    expect(mission.content.purpose).toContain('image-resize');
    // R2: progressive formalization — goals with measures become MEASURABLE,
    // the goal without measures stays PROPOSED (never forced).
    expect(missionStage.formalization.map((entry) => entry.status).sort()).toEqual(['MEASURABLE', 'MEASURABLE', 'PROPOSED']);
    expect(dogfood.askRun.summary.goals).toEqual({ total: 3, measurable: 2, proposed: 1 });
    // The mission's constraints survive into the formalized artifact (the
    // search consumes them through the W7 contract).
    expect(mission.content.constraints.length).toBe(3);
    expect(missionStage.capability).toBe('image-resize');
    // The candidate composition SATISFIES the mission (typed handoff).
    expect(
      dogfood.askRun.trace.links.some(
        (link) => link.type === 'SATISFIES' && link.target === mission.envelope.id && link.source === dogfood.askRun.stages.candidate.candidate.envelope.id,
      ),
    ).toBe(true);
  });

  test(DOGFOOD_CASES.missionEvolution, () => {
    // R3: mission revision is explicit, versioned and authority-controlled.
    const { previous, revised } = dogfood.missionRevision;
    expect(previous.envelope.version).toBe(1);
    expect(revised.envelope.version).toBe(2);
    expect(revised.envelope.supersedes).toBe(previous.envelope.id);
    expect(revised.envelope.status).toBe('ACTIVE');
    // The revising authority is a real AuthorityGrant referenced by id.
    expect(revised.envelope.authority_ref).toMatch(/^sos:\/\/AuthorityGrant\/[0-9a-f]{32}$/);
    expect(revised.content.constraints.length).toBe(previous.content.constraints.length + 1);
    // The revision chain is queryable through the store.
    const store = new MissionStore();
    store.put(previous);
    store.put(revised);
    expect(store.history(revised.envelope.id).map((entry) => entry.envelope.version)).toEqual([1, 2]);
    expect(store.has(previous.envelope.id)).toBe(true);
  });

  test(DOGFOOD_CASES.valueModelSubordination, () => {
    // R4: a SEPARATE Value Model, subordinated to the mission.
    const { valueModel, conflictingValueModel } = dogfood;
    expect(valueModel.artifact.envelope.kind).toBe('ValueModel');
    expect(valueModel.subordination.status).toBe('SUBORDINATE');
    expect(valueModel.subordination.conflicts).toEqual([]);
    // The conflicting budget EXCEEDS the mission's hard bound: the conflict
    // is SURFACED as a typed CONFLICTS_WITH link, never silently accepted.
    // (Both the oversized BUDGET and the oversized typed CONSTRAINT conflict
    // with the mission's hard monthly-cost bound.)
    expect(conflictingValueModel.subordination.status).toBe('CONFLICT');
    expect(conflictingValueModel.subordination.conflicts.length).toBe(2);
    for (const conflict of conflictingValueModel.subordination.conflicts) {
      expect(conflict.axis).toBe('monthly-cost');
      expect(conflict.mission_limit).toBe(600);
      expect(conflict.value_limit).toBe(700);
    }
    expect(conflictingValueModel.conflict_links.length).toBe(1);
    expect(conflictingValueModel.conflict_links[0]!.type).toBe('CONFLICTS_WITH');
  });

  test(DOGFOOD_CASES.contextArtifact, () => {
    // R5/R17: contextual realization — a validated Context artifact.
    const context = dogfood.context;
    expect(context.envelope.kind).toBe('Context');
    expect(context.content.dimensions).toEqual({
      environment: 'production',
      platform: 'edge-runtime',
      user_cohort: 'beta-testers',
      geography: 'eu-west-1',
      regulatory: ['GDPR'],
    });
  });

  test(DOGFOOD_CASES.greenfieldAskPath, () => {
    // The PRIMARY chain: W14 stages 1-6 with the ASK instance.
    const askRun = dogfood.askRun;
    expect(askRun.ok).toBe(true);
    expect(askRun.trace_chain.ok).toBe(true);
    expect(askRun.trace_chain.path_state_to_mission).not.toBeNull();
    // R16: no grants presented -> the engine escalates to ASK (a SUCCESS
    // state, never an error), the ask is resolved by the human decider and
    // the resolution approves the candidate.
    const decision = askRun.stages.decision;
    expect(decision.action).toBe('ASK');
    expect(decision.record.content.escalation?.code).toBe('AUTHORITY_INSUFFICIENT');
    expect(decision.ask).not.toBeNull();
    expect(decision.queue_entry_id).not.toBeNull();
    expect(decision.resolution).not.toBeNull();
    expect(decision.resolution!.content.action).toBe('ACT');
    expect(decision.approved).toBe(true);
    expect(askRun.summary.decision.approved).toBe(true);
    expect(askRun.summary.decision.ask_id).not.toBeNull();
    expect(askRun.summary.decision.resolution_id).not.toBeNull();
    // R29: the candidate was composed at the HIGHEST validated altitude.
    expect(askRun.stages.candidate.selection.source).toBe('VALIDATED_COMPOSITION');
    expect(askRun.summary.candidate_altitude).toBe('VALIDATED_COMPOSITION');
    // R1/R6: the chain reaches a realized System State.
    expect(askRun.stages.realization.system_state.envelope.status).toBe('ACTIVE');
    expect(askRun.summary.trace.path_state_to_mission!.length).toBeGreaterThanOrEqual(3);
  });

  test(DOGFOOD_CASES.greenfieldActPath, () => {
    // The decision-point variant: with the covering grant presented, the
    // engine ACTs directly (R15 authority-aware autonomy).
    const actRun = dogfood.actRun;
    expect(actRun.ok).toBe(true);
    expect(actRun.stages.decision.action).toBe('ACT');
    expect(actRun.stages.decision.approved).toBe(true);
    expect(actRun.stages.decision.ask).toBeNull();
    expect(actRun.stages.decision.resolution).toBeNull();
    expect(actRun.summary.decision.approved).toBe(true);
    expect(actRun.trace_chain.ok).toBe(true);
  });

  test(DOGFOOD_CASES.realizationRevisionDiscipline, () => {
    // R7/R8/R30: the realization pair is mutually consistent at the EXACT revision.
    const realization = dogfood.askRun.stages.realization;
    const { system_state, architecture_graph, implementation_model } = realization;
    expect(realization.revision).toBe(REALIZED_REVISION);
    expect(system_state.content.architecture_ref.artifact_id).toBe(architecture_graph.envelope.id);
    expect(architecture_graph.content.projects_system_state).toEqual({
      system_state_id: system_state.envelope.id,
      version: system_state.envelope.version,
    });
    // The machine-checked discipline (re-asserted through the public export).
    expect(() => assertRealizationRevision({ system_state, architecture_graph })).not.toThrow();
    // R7: a versioned, complete, queryable revision chain (root v1, ACTIVE).
    expect(realization.revision_chain).toEqual([
      { id: system_state.envelope.id, version: 1, status: 'ACTIVE' },
    ]);
    // R30: every source artifact carries the exact realized revision.
    for (const source of implementation_model.source_artifacts) {
      expect(source.revision).toBe(REALIZED_REVISION);
    }
    // The realized packages are recorded with their exact registry versions.
    expect(system_state.content.package_realizations.length).toBe(2);
    for (const realizationEntry of system_state.content.package_realizations) {
      const memberVersion = dogfood.askRun.stages.candidate.member_versions.find(
        (entry) => entry.package_id === realizationEntry.package_id,
      );
      expect(memberVersion).toBeDefined();
      expect(realizationEntry.version).toBe(memberVersion!.version);
    }
  });

  test(DOGFOOD_CASES.greenfieldReconciliation, () => {
    // R23: the realized implementation vs the declared architecture.
    const reconciliation = dogfood.askRun.stages.reconciliation;
    expect(reconciliation.records.length).toBeGreaterThan(0);
    const classifications = reconciliation.records.map((record) => record.classification);
    // Member components realize declared nodes by refinement...
    expect(classifications.filter((entry) => entry === 'PRESERVING_REFINEMENT').length).toBeGreaterThan(0);
    // ...and the undeclared observability glue is an honest IMPLEMENTATION_DETAIL.
    expect(classifications.filter((entry) => entry === 'IMPLEMENTATION_DETAIL').length).toBeGreaterThan(0);
    // No drift in the freshly realized system.
    expect(reconciliation.drift).toEqual([]);
    expect(reconciliation.clean).toBe(true);
    // Every finding is a typed, linked record.
    for (const record of reconciliation.records) {
      expect(record.link.source).toBe(dogfood.askRun.stages.realization.implementation_model.id);
      expect(record.link.target).toBe(dogfood.askRun.stages.realization.architecture_graph.envelope.id);
    }
  });

  test(DOGFOOD_CASES.truthfulEvidenceGap, () => {
    // R21: the unobserved cold-start probe stays UNAVAILABLE.
    const evidence = dogfood.askRun.stages.evidence;
    expect(evidence.records.length).toBe(3);
    expect(evidence.availability.SUCCESS).toBe(2);
    expect(evidence.availability.UNAVAILABLE).toBe(1);
    expect(evidence.availability.FAILURE).toBe(0);
    const gap = evidence.records.find((record) => record.availability === 'UNAVAILABLE')!;
    // The gap's RAW observation carries observed: null — no fabricated value.
    const gapObservation = DOGFOOD_OBSERVATIONS.find(
      (observation) => observation.availability === 'UNAVAILABLE',
    )!;
    expect(gapObservation.observed).toBeNull();
    expect(gap.method).toBe('telemetry:capture-availability');
    expect(isNonAuthoritativeEvidence(gap)).toBe(false);
    // R30: the evidence is bound to the exact source revision.
    expect(gap.source_revision).toBe(REALIZED_REVISION);
    for (const record of evidence.records) {
      expect(record.subject_ref).toBe(dogfood.askRun.stages.realization.system_state.envelope.id);
      expect(record.evidence_class).toBe('OBSERVATIONAL');
    }
    // R18: OTel-shaped telemetry is ingested platform-neutrally (adapter ->
    // RawObservation -> evidence) by the brownfield loop over the same system.
    expect(dogfood.brownfieldNominal.summary.ingested.telemetry_ingested).toBe(4);
  });

  test(DOGFOOD_CASES.packageEcology, () => {
    // R24/R25/R27/R28: the package ecology behind the greenfield candidate.
    const candidateStage = dogfood.askRun.stages.candidate;
    expect(candidateStage.members.length).toBe(2);
    for (const member of candidateStage.members) {
      expect(member.package_id).toMatch(/^sos:\/\/Package\/[0-9a-f]{32}$/);
      expect(member.bound_contracts.length).toBe(1);
    }
    // The candidate is a REAL first-class composition (R25) with members and
    // typed bindings, carrying its OWN evidence obligations (R27).
    expect(candidateStage.candidate.envelope.kind).toBe('PackageComposition');
    expect(candidateStage.candidate.content.members.length).toBe(2);
    expect(candidateStage.candidate.content.bindings.length).toBe(1);
    expect(candidateStage.own_evidence_obligations.length).toBeGreaterThan(0);
    // R24/R27: the VALIDATED composition in the ecology carries its OWN
    // evidence (observational + INTERVENTIONAL) — distinct from the members'
    // evidence, which never substitutes for it.
    const composition = dogfood.ecology.composition;
    expect(composition.content.maturity).toBe('VALIDATED');
    expect(composition.content.evidence_refs.length).toBe(2);
    // The own-evidence records are subject-bound to the composition's ROOT
    // revision (the id the evidence was minted against — the registry chain
    // root), and one of them is INTERVENTIONAL.
    const compositionRootId = dogfood.ecology.registry
      .history(composition.envelope.id)
      .map((entry) => entry.artifact.envelope.id)[0]!;
    for (const ref of composition.content.evidence_refs) {
      const record = resolveEvidence(dogfood, ref);
      expect(record).toBeDefined();
      expect(record!.subject_ref).toBe(compositionRootId);
    }
    const interventional = composition.content.evidence_refs
      .map((ref) => resolveEvidence(dogfood, ref)!)
      .filter((record) => record.evidence_class === 'INTERVENTIONAL');
    expect(interventional.length).toBe(1);
    // Member evidence is SEPARATE (bound to the member realization subject).
    for (const member of dogfood.ecology.members) {
      for (const ref of member.content.evidence_refs) {
        expect(composition.content.evidence_refs).not.toContain(ref);
      }
    }
    // R27 through the retrieval facade: the composition candidate exposes its
    // own-evidence view with member_evidence_never_substitutes: true.
    const facade = new RetrievalFacade(dogfood.ecology.registry);
    const searchContext = facade.query({ capability: 'image-resize' });
    const compositionCandidate = searchContext.candidates.find((entry) => entry.kind === 'COMPOSITION')!;
    expect(compositionCandidate).toBeDefined();
    expect(compositionCandidate.own_evidence).not.toBeNull();
    expect(compositionCandidate.own_evidence!.member_evidence_never_substitutes).toBe(true);
    expect(compositionCandidate.own_evidence!.own_evidence_refs.length).toBe(2);
    // R28: the wider ecology retains materially different families.
    const families = dogfood.brownfieldNominal.summary.retrieved.families;
    expect(families.length).toBeGreaterThanOrEqual(3);
    expect(new Set(families).has('durable-queue')).toBe(true);
    // R30: the composed members carry their exact registry versions.
    expect(candidateStage.member_versions.length).toBe(2);
    for (const entry of candidateStage.member_versions) {
      expect(entry.version).toMatch(/^\d+$/);
    }
  });

  test(DOGFOOD_CASES.brownfieldNominal, () => {
    // The W15 loop over the GREENFIELD-REALIZED system (nominal world).
    const result = dogfood.brownfieldNominal;
    const summary = result.summary;
    // The snapshot is the realized system at the exact same revision.
    expect(summary.source_revision).toBe(REALIZED_REVISION);
    expect(result.chain.complete).toBe(true);
    // Stage 1: ingestion — modules/interfaces/dependencies projected from the
    // realized ImplementationModel + OTel telemetry ingested.
    expect(summary.ingested.modules).toBe(5);
    expect(summary.ingested.interfaces).toBe(2);
    expect(summary.ingested.dependencies).toBe(8);
    // Stage 2: COMPETING recovery — ambiguous evidence yields competing
    // hypotheses (never collapsed to one analyzer's guess).
    expect(summary.hypotheses.ambiguity_detected).toBe(true);
    expect(summary.hypotheses.count).toBeGreaterThanOrEqual(2);
    expect(summary.hypotheses.strategies).toEqual(['DIRECT', 'MERGED_REALIZATIONS']);
    // Stage 3: context-conditioned retrieval (R26/R11/R28) — multiple
    // candidates across families, with at least one MATCHED context.
    expect(summary.retrieved.candidates).toBe(4);
    expect(summary.retrieved.families.length).toBe(4);
    const matched = result.artifacts.search_context.candidates.filter(
      (entry) => entry.retrieval.context_match === 'MATCHED',
    );
    expect(matched.length).toBeGreaterThanOrEqual(1);
    // R26: a matched candidate carries an estimate conditioned ON the query context.
    const matchedWithEstimate = matched.find(
      (entry) => entry.uncertainty.basis === 'MATCHED_ESTIMATE' || entry.best_estimate !== null,
    );
    expect(matchedWithEstimate).toBeDefined();
    // Stage 4: bounded, invariant-preserving evolution (R8/R13) + Pareto/QD
    // search (R12) at the highest validated altitude with a justified ladder
    // descent (R29).
    expect(summary.candidate.target_component).toBe('component:image-resize-storage');
    expect(summary.candidate.replacement_component).toBe('component:image-resize-storage-optimized');
    expect(summary.candidate.bounded_nodes).toBe(1);
    expect(summary.candidate.invariants_preserved).toBe(2);
    expect(result.stages.evolution.pareto.fronts).toBeGreaterThanOrEqual(2);
    expect(result.stages.evolution.repertoire.cells).toBeGreaterThanOrEqual(1);
    expect(result.stages.evolution.repertoire.families.length).toBeGreaterThanOrEqual(2);
    expect(result.artifacts.search.final_altitude).toBe('VALIDATED_PACKAGE');
    const descent = result.artifacts.search.ladder.find((step) => step.descent !== undefined);
    expect(descent?.descent?.justification.length ?? 0).toBeGreaterThan(0);
    // Stage 5: assurance evaluates (objections retained; INVALID blocks).
    expect(['VALID', 'OBJECTIONED']).toContain(summary.assurance.verdict);
    expect(summary.assurance.blocks).toBe(false);
    // Stage 6: the SIMULATED experiment (healthy world).
    expect(summary.experiment.simulated).toBe(true);
    expect(summary.experiment.overall_availability).toBe('SUCCESS');
    expect(summary.experiment.guardrails_breached).toBe(0);
    // Stage 7: the honest promotion gate — simulated evidence NEVER promotes;
    // the healthy outcome is EXPERIMENT (run the real controlled experiment).
    expect(summary.decision.action).toBe('EXPERIMENT');
    expect(summary.decision.recovery_declared).toBe(true);
    expect(result.artifacts.promotion_recovery.max_recovery_seconds).not.toBeNull();
    // Stage 8: drift reconciliation (R23) — the engineered drift is classified.
    expect(summary.drift.DRIFT ?? 0).toBeGreaterThanOrEqual(1);
    expect(summary.drift.IMPLEMENTATION_DETAIL ?? 0).toBeGreaterThanOrEqual(1);
    // Stage 9: package learning (R19) — memory, transfer evidence, decay
    // signals and updated ecology packages.
    expect(summary.learned.memory_entries).toBeGreaterThanOrEqual(1);
    expect(summary.learned.transfer_outcome).toBe('TRANSFER_SUCCESS');
    expect(summary.learned.decay_signals).toBe(1);
    expect(summary.learned.ecology_packages).toBeGreaterThanOrEqual(1);
    // The learned transfer record is retained (store-queried — it is a
    // TransferStore record, not a spine artifact, by W15 design).
    expect(result.artifacts.transfer_record.outcome).toBe('TRANSFER_SUCCESS');
    expect(result.artifacts.transfer_record.source_ref).toBe(result.stages.evolution.selected_package_id);
    // R21: no telemetry gaps were fabricated (all declared components observed).
    expect(summary.ingested.telemetry_gaps).toBe(0);
  });

  test(DOGFOOD_CASES.brownfieldDegraded, () => {
    // R13/R14: the degraded world breaches the error-rate guardrail; the loop
    // ROLLS BACK with a bounded recovery declaration wired to the triggers.
    const result = dogfood.brownfieldDegraded;
    const summary = result.summary;
    expect(summary.experiment.overall_availability).toBe('FAILURE');
    expect(summary.experiment.guardrails_breached).toBe(1);
    expect(summary.experiment.rollback_triggers_fired).toBe(1);
    expect(summary.decision.action).toBe('ROLLBACK');
    expect(summary.decision.guardrails_tripped).toBe(true);
    expect(summary.decision.recovery_declared).toBe(true);
    expect(result.artifacts.promotion_recovery.rollback_triggers.length).toBeGreaterThanOrEqual(1);
    expect(result.artifacts.promotion_recovery.max_recovery_seconds).not.toBeNull();
    expect(result.chain.complete).toBe(true);
  });

  test(DOGFOOD_CASES.metaEvolution, () => {
    // The W16 meta loop over the SAME greenfield-derived object system.
    const result = dogfood.metaLoop;
    const summary = result.summary;
    expect(result.chain.complete).toBe(true);
    // Stage 1: separation — the object probe ran the brownfield loop over the
    // same fixture; the lane rules rejected the conflation attempts.
    expect(summary.object_loop.system_name).toBe('greenfield-realized-image-resize');
    expect(summary.object_loop.variant).toBe('nominal');
    expect(summary.object_loop.decision).toBe('EXPERIMENT');
    expect(summary.object_loop.chain_complete).toBe(true);
    expect(summary.separation.conflation_rejections).toBe(2);
    // Stage 2: registry-driven proposals (R31: the same package mechanism).
    expect(summary.proposals.count).toBe(4);
    expect(summary.proposals.families.length).toBe(4);
    expect(summary.proposals.pareto_fronts).toBeGreaterThanOrEqual(1);
    // Stage 3: the NON-DISABLEABLE governance guard REJECTED the weakening
    // proposal with a typed rejection BEFORE any measurement.
    expect(summary.guard.rejected).toBe(1);
    expect(summary.guard.rejected_invariants.length).toBe(1);
    expect(result.artifacts.guard_rejections.length).toBe(1);
    const rejection = result.artifacts.guard_rejections[0]!;
    expect(rejection.code).toBe('NON_EVOLVABLE_KEY');
    expect(rejection.attempted_keys.length).toBeGreaterThan(0);
    // The rejection is retained as FAILURE evidence with provenance.
    expect(result.artifacts.guard_rejection_evidence.length).toBe(1);
    expect(result.artifacts.guard_rejection_evidence[0]!.availability).toBe('FAILURE');
    // Stages 4-6: every remaining outcome is exercised — the regressive
    // change measured NEGATIVE and rolled back with an EXACT restore; the
    // org-wide change escalated to a first-class ASK; the healthy change was
    // promoted and APPLIED (the process revision advanced).
    expect(summary.effectiveness.measured).toBe(3);
    expect(summary.effectiveness.effective).toBe(2);
    expect(summary.effectiveness.negative).toBe(1);
    expect(summary.decisions).toEqual({ promote: 1, rollback: 1, ask: 1, other: 0 });
    expect(summary.process_revision.restore_exact).toBe(true);
    expect(summary.process_revision.final_version).toBe(3);
    expect(summary.process_revision.history.length).toBe(3);
    expect(result.artifacts.ask_queue.length).toBe(1);
    expect(result.artifacts.ask_queue[0]!.status).toBe('PENDING');
    // Stage 7: liability memory (R19) — the failure is retained forever with
    // the R19 penalty demonstrated.
    expect(summary.retained_failures.count).toBe(1);
    expect(summary.retained_failures.transfer_outcomes).toEqual(['TRANSFER_FAILURE']);
    expect(summary.retained_failures.penalty_demonstrated).toBe(true);
    for (const kind of ['FAILURE', 'ROLLBACK', 'LIABILITY', 'LEARNED_RULE']) {
      expect(summary.retained_failures.memory_entry_kinds).toContain(kind);
    }
    // R15/R16: the decisions were gated by real grants; the ORGANIZATION
    // blast radius required SUPERVISED authority -> the first-class ASK.
    const orgWide = result.artifacts.decisions.find((entry) => entry.ask_id !== null);
    expect(orgWide).toBeDefined();
    expect(orgWide!.engine_record.content.action).toBe('ASK');
  });

  test(DOGFOOD_CASES.causalGrounding, () => {
    // R10: correlation -> CORRELATIONAL hypothesis through the ONLY
    // sanctioned path (a strong CAUSAL claim would require interventional
    // evidence — the claim gate enforces it).
    const { correlation, causalHypothesis } = dogfood;
    expect(correlation.envelope.kind).toBe('CorrelationRecord');
    expect(causalHypothesis.envelope.kind).toBe('CausalHypothesis');
    expect(causalHypothesis.content.claim_strength).toBe('CORRELATIONAL');
    expect(causalHypothesis.content.correlation_origin).toBe(correlation.envelope.id);
    expect(causalHypothesis.content.observational_evidence.length).toBe(2);
    expect(causalHypothesis.content.interventional_evidence).toEqual([]);
    // The hypothesis store keeps the derivation queryable.
    const storeLinks = dogfood.trace.filter(
      (link) => link.source === causalHypothesis.envelope.id || link.target === causalHypothesis.envelope.id,
    );
    expect(storeLinks.length).toBeGreaterThan(0);
  });

  test(DOGFOOD_CASES.integratedTraceChain, () => {
    // R9/R30: ONE connected semantic subgraph from the Mission to the learned
    // ecology updates.
    const links = uniqueLinks(dogfood.trace);
    const linked = new Set(links.flatMap((link) => [link.source, link.target]));
    const missionId = dogfood.askRun.stages.mission.mission.envelope.id;
    const systemStateId = dogfood.askRun.stages.realization.system_state.envelope.id;
    const brownfieldModelId = dogfood.brownfieldNominal.artifacts.implementation_model.id;
    const metaMissionId = dogfood.metaLoop.artifacts.mission.envelope.id;
    const finalProcessId = dogfood.metaLoop.artifacts.final_process.envelope.id;

    // Every consequential artifact appears in at least one link.
    const unlinked = dogfood.artifacts.filter((id) => !linked.has(id));
    expect(unlinked).toEqual([]);

    // ONE connected component contains every endpoint — the greenfield
    // mission, the realized state, the brownfield artifacts, the learned
    // ecology updates, the meta loop anchors and the governance artifacts.
    const component = connectedComponent(links, missionId);
    const requiredEndpoints = [
      ...dogfood.brownfieldNominal.stages.learning.ecology_package_ids,
      dogfood.brownfieldNominal.artifacts.memory.envelope.id,
      dogfood.brownfieldNominal.stages.learning.outcome_evidence_id,
      dogfood.metaLoop.artifacts.retentions[0]!.memory.envelope.id,
      dogfood.metaLoop.artifacts.final_process.envelope.id,
      dogfood.valueModel.artifact.envelope.id,
      dogfood.conflictingValueModel.artifact.envelope.id,
      dogfood.context.envelope.id,
      dogfood.correlation.envelope.id,
      dogfood.causalHypothesis.envelope.id,
      dogfood.missionRevision.revised.envelope.id,
    ];
    for (const endpoint of requiredEndpoints) {
      expect(component.has(endpoint), `endpoint not in the Mission's connected component: ${endpoint}`).toBe(true);
    }
    expect(component.has(systemStateId)).toBe(true);
    expect(component.has(brownfieldModelId)).toBe(true);
    expect(component.has(metaMissionId)).toBe(true);
    expect(component.has(finalProcessId)).toBe(true);

    // Directed query paths across the three loops:
    // (a) the realized state traces back to the mission;
    expect(directedPath(links, systemStateId, missionId)).not.toBeNull();
    // (b) the brownfield ImplementationModel traces back to the realized
    //     SystemState through the W17 handoff link;
    expect(directedPath(links, brownfieldModelId, systemStateId)).not.toBeNull();
    // (c) the SELF-EVOLUTION mission traces back to the PRODUCT mission
    //     (meta mission -> process -> object model -> realized state -> mission).
    expect(directedPath(links, metaMissionId, missionId)).not.toBeNull();

    // The brownfield + meta loops' own chain checks passed (machine-checked
    // inside the loops); re-assert the summary flags.
    expect(dogfood.brownfieldNominal.chain.complete).toBe(true);
    expect(dogfood.metaLoop.chain.complete).toBe(true);
    expect(dogfood.askRun.trace_chain.ok).toBe(true);
    expect(dogfood.actRun.trace_chain.ok).toBe(true);
  });

  test(DOGFOOD_CASES.explainability, () => {
    // R22: the realized SystemState exposes upstream/downstream rationale
    // with exact evidence refs, and the evidence pool projects onto a
    // deterministic view model.
    const systemStateId = dogfood.askRun.stages.realization.system_state.envelope.id;
    const evidence = dogfood.askRun.stages.evidence.records;
    const chain = buildRationaleChain({
      subject_id: systemStateId,
      links: dogfood.trace,
      evidence_refs: evidence.map((record) => record.id),
    });
    expect(() => assertValidRationaleChain(chain)).not.toThrow();
    expect(chain.upstream.length).toBeGreaterThan(0);
    expect(chain.downstream.length).toBeGreaterThan(0);
    expect(chain.evidence_refs.length).toBe(3);
    // By the direction typology: the evidence records (OBSERVES the state)
    // and the conditioning Context (CONSTRAINS the state) are UPSTREAM; the
    // approved candidate and the declared architecture (which the state
    // REALIZES) are DOWNSTREAM.
    const upstreamParties = new Set(chain.upstream.flatMap((link) => [link.source, link.target]));
    const downstreamParties = new Set(chain.downstream.flatMap((link) => [link.source, link.target]));
    expect(downstreamParties.has(dogfood.askRun.stages.candidate.candidate.envelope.id)).toBe(true);
    expect(downstreamParties.has(dogfood.askRun.stages.realization.architecture_graph.envelope.id)).toBe(true);
    for (const record of evidence) {
      expect(upstreamParties.has(record.id)).toBe(true);
    }
    expect(upstreamParties.has(dogfood.context.envelope.id)).toBe(true);
    // The evidence view model: deterministic, all six truth states present.
    const vm = projectEvidenceSet({
      records: evidence,
      now: RUN_CONTEXT.t_evidence,
      system_state_revision: '1',
      rationale: chain,
    });
    expect(vm.counts_by_truth_state.SUCCESS).toBe(2);
    expect(vm.counts_by_truth_state.UNAVAILABLE).toBe(1);
    expect(vm.rows.length).toBe(3);
    const vm2 = projectEvidenceSet({
      records: evidence,
      now: RUN_CONTEXT.t_evidence,
      system_state_revision: '1',
      rationale: chain,
    });
    expect(vmHash(vm)).toBe(vmHash(vm2));
  });

  test(DOGFOOD_CASES.determinism, () => {
    // R30: the ENTIRE integrated scenario is a pure function of its input.
    const first = dogfoodProjection(dogfood);
    const secondRun = runIntegratedDogfood();
    const second = dogfoodProjection(secondRun);
    expect(canonicalSerialize(second)).toBe(canonicalSerialize(first));
    // Exact-revision identity is stable across runs (content-addressed).
    expect(secondRun.askRun.stages.realization.system_state.envelope.id).toBe(
      dogfood.askRun.stages.realization.system_state.envelope.id,
    );
    expect(secondRun.brownfieldNominal.input_digest).toBe(dogfood.brownfieldNominal.input_digest);
    expect(secondRun.brownfieldDegraded.input_digest).toBe(dogfood.brownfieldDegraded.input_digest);
    expect(secondRun.metaLoop.input_digest).toBe(dogfood.metaLoop.input_digest);
    expect(secondRun.metaLoop.summary.process_revision.final).toBe(dogfood.metaLoop.summary.process_revision.final);
    // The loop instant discipline: the brownfield `now` is a fixed literal.
    expect(BROWNFIELD_NOW).toBe('2025-09-15T00:00:00.000Z');
  });
});
