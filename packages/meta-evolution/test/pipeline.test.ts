/**
 * Pipeline tests — the golden self-evolution scenario end-to-end: BOTH
 * paths (HEALTHY: measured, decisioned, promoted, revision applied;
 * ADVERSARIAL: governance-weakening rejected + effectiveness-negative
 * change rolled back AND retained in liability memory), the ASK path, the
 * traceability invariant (complete + queryable), determinism
 * (byte-identical canonical serialization), and the object loop probe.
 */

import { describe, expect, it } from 'vitest';
import { buildGoldenMetaInput } from '../src/golden-scenario.js';
import { runMetaEvolutionLoop, canonicalMetaText, formatMetaSummary } from '../src/loop.js';
import { queryMetaTrace } from '../src/trace.js';
import { assertFailureRetained } from '../src/liability.js';
import { GOLDEN_BROWNFIELD_SCENARIO } from '@sos-2/brownfield';

function goldenRun() {
  const built = buildGoldenMetaInput();
  const result = runMetaEvolutionLoop(built.input);
  return { result, built };
}

describe('golden self-evolution scenario', () => {
  const { result, built } = goldenRun();

  it('runs the object loop probe over the W15 golden fixtures', () => {
    const probe = result.stages.separation.object_probe;
    expect(probe.system_name).toBe('merch-catalog-legacy');
    expect(probe.implementation_model_id).toMatch(/^sos:\/\/ImplementationModel\//);
    expect(probe.candidate_state_id).toMatch(/^sos:\/\/CandidateState\//);
    expect(probe.decision).toBe('EXPERIMENT'); // the honest nominal brownfield decision
    expect(probe.chain_complete).toBe(true);
    expect(probe.trace_links).toBeGreaterThan(0);
  });

  it('machine-checks the object/meta separation in BOTH directions every run', () => {
    const separation = result.stages.separation;
    expect(separation.conflation_rejections).toBe(2);
    const objectLaneMetaChange = separation.lane_probes.find(
      (probe) => probe.lane === 'OBJECT' && probe.artifact_id.startsWith('sos://MetaChange/'),
    );
    expect(objectLaneMetaChange?.accepted).toBe(false);
    expect(objectLaneMetaChange?.rejection?.code).toBe('OBJECT_META_CONFLATION');
    const metaLaneObjectChange = separation.lane_probes.find(
      (probe) => probe.lane === 'META' && probe.artifact_id.startsWith('sos://CandidateState/'),
    );
    expect(metaLaneObjectChange?.accepted).toBe(false);
    expect(metaLaneObjectChange?.rejection?.code).toBe('OBJECT_META_CONFLATION');
  });

  it('proposes through the package registry and ranks by Pareto + quality-diversity', () => {
    const proposal = result.stages.proposal;
    expect(proposal.retrieval.candidate_count).toBe(4);
    expect(proposal.retrieval.families).toEqual(['aggressive-pruning', 'fast-lane', 'org-rollout', 'validated-tuning']);
    expect(proposal.retrieval.altitudes_present).toContain('VALIDATED_PACKAGE');
    expect(proposal.retrieval.matched_count).toBe(4);
    expect(proposal.pareto.fronts).toBeGreaterThanOrEqual(2);
    expect(proposal.pareto.front_zero.length).toBeGreaterThanOrEqual(2); // the FRONT, never a single winner
    expect(proposal.repertoire.cells).toBeGreaterThanOrEqual(3);
    expect(proposal.proposals).toHaveLength(4);
    for (const proposalEntry of proposal.proposals) {
      expect(proposalEntry.package_id).toMatch(/^sos:\/\/Package\//);
      expect(proposalEntry.proposal_probability).toBeGreaterThan(0);
      expect(proposalEntry.proposal_probability).toBeLessThanOrEqual(1);
    }
    const totalProbability = proposal.proposals.reduce((sum, entry) => sum + entry.proposal_probability, 0);
    expect(totalProbability).toBeCloseTo(1, 12);
  });

  it('ADVERSARIAL: rejects the governance-weakening proposal with a typed record before any decision', () => {
    const guard = result.stages.guard;
    expect(guard.passed_count).toBe(3);
    expect(guard.rejected_count).toBe(1);
    const rejection = result.artifacts.guard_rejections[0]!;
    expect(rejection.code).toBe('NON_EVOLVABLE_KEY');
    expect(rejection.attempted_keys).toContain('governance.authority_gates');
    expect(rejection.attempted_keys).toContain('guard.enabled');
    expect(rejection.attempted_keys).toContain('ask_policy.escalation');
    expect(rejection.attempted_keys).toContain('traceability.trace_links');
    expect(rejection.attempted_keys).toContain('governance.decision_records');
    // the rejected change NEVER reaches measurement or decision:
    const measured = result.stages.effectiveness.measurements.some((m) => m.change_id === rejection.change_id);
    expect(measured).toBe(false);
    const decided = result.stages.decision.entries.some((entry) => entry.change_id === rejection.change_id);
    expect(decided).toBe(false);
    // the rejection evidence is retained (spine-traceable, never dropped):
    expect(guard.rejection_evidence_ids).toHaveLength(1);
  });

  it('measures every guard-passing change on the frozen §11 axes (marked simulated)', () => {
    const effectiveness = result.stages.effectiveness;
    expect(effectiveness.measurements).toHaveLength(3);
    for (const measurement of effectiveness.measurements) {
      expect(measurement.simulated).toBe(true);
      expect(measurement.seed).toBe(20250701);
      expect(Object.keys(measurement.before).sort()).toEqual(['COST', 'HUMAN_COMPREHENSIBILITY', 'LATENCY', 'RESILIENCE']);
      expect(Object.keys(measurement.after).sort()).toEqual(['COST', 'HUMAN_COMPREHENSIBILITY', 'LATENCY', 'RESILIENCE']);
      for (const axis of Object.keys(measurement.deltas)) {
        expect(measurement.deltas[axis]).toBeCloseTo(measurement.after[axis] - measurement.before[axis], 9);
      }
    }
  });

  it('ADVERSARIAL: the effectiveness-negative change rolls back with recovery + EXACT restore', () => {
    const regressive = result.stages.effectiveness.measurements.find((m) => !m.effective)!;
    expect(regressive.overall_availability).toBe('FAILURE');
    expect(regressive.rollback_triggers_fired).toBe(1);
    expect(regressive.guardrails.find((g) => g.metric_id === 'RESILIENCE')?.status).toBe('BREACHED');

    const entry = result.stages.decision.entries.find((e) => e.change_id === regressive.change_id)!;
    expect(entry.engine_decision).toBe('ROLLBACK');

    const rollback = result.stages.rollback.rollbacks[0]!;
    expect(rollback.change_id).toBe(regressive.change_id);
    expect(rollback.restore_exact).toBe(true);
    expect(rollback.recovery.mechanism.length).toBeGreaterThan(0);
    expect(rollback.recovery.max_recovery_seconds).not.toBeNull();
    expect(rollback.recovery.rollback_triggers.length).toBeGreaterThan(0);
    // the EXACT restore: the restore revision's parameters equal the
    // pre-change (trial base) parameters byte-for-byte.
    const restore = result.artifacts.rollbacks[0]!.restore;
    const trialBase = result.artifacts.process_revisions.find(
      (revision) => revision.envelope.id === restore.envelope.supersedes,
    )!;
    expect(JSON.stringify(restore.content.parameters)).toBe(JSON.stringify(trialBase.content.parameters));
    // the never-activated trial is retired:
    expect(result.artifacts.rollbacks[0]!.retired_trial.envelope.status).toBe('RETIRED');
  });

  it('ASK: the org-wide change escalates to the first-class ASK path (pending authority)', () => {
    const askEntry = result.stages.decision.entries.find((entry) => entry.engine_decision === 'ASK')!;
    expect(askEntry.escalation_code).toBe('SUPERVISED_REQUIRES_EXPLICIT_DECISION');
    expect(askEntry.ask_id).toMatch(/^sos:\/\/AskRequest\//);
    expect(askEntry.applied_revision_id).toBeNull();
    expect(askEntry.promotion_decision).toBeNull();
    // the trial stays DRAFT pending the authority's resolution:
    const askTrial = result.artifacts.process_revisions.find(
      (revision) => revision.envelope.status === 'DRAFT',
    )!;
    expect(askTrial).toBeDefined();
    const queue = result.artifacts.ask_queue;
    expect(queue).toHaveLength(1);
    expect(queue[0]!.status).toBe('PENDING');
    expect(queue[0]!.id).toBe(askEntry.ask_id);
  });

  it('HEALTHY: the governance-preserving change is measured, decisioned, promoted, applied', () => {
    const entry = result.stages.decision.entries.find((candidate) => candidate.applied_revision_id !== null)!;
    expect(entry).toBeDefined();
    const healthy = result.stages.effectiveness.measurements.find((m) => m.change_id === entry.change_id)!;
    expect(healthy.effective).toBe(true);
    expect(entry.engine_decision).toBe('ACT');
    expect(entry.promotion_decision).toBe('ACT');
    expect(entry.applied_revision_id).not.toBeNull();
    // the applied MetaChange produced the new MetaProcess revision:
    const finalProcess = result.artifacts.final_process;
    expect(finalProcess.envelope.id).toBe(entry.applied_revision_id);
    expect(finalProcess.envelope.status).toBe('ACTIVE');
    expect(finalProcess.content.parameters.strategy.search_policy).toBe('BALANCED');
    expect(finalProcess.content.parameters.strategy.exploration_rate).toBe(0.3);
    expect(finalProcess.content.parameters.strategy.max_candidates_per_family).toBe(4);
    expect(finalProcess.content.parameters.retrieval_weights['VALIDATED_COMPOSITION']).toBe(1.2);
    // the applied revision preserved the validated altitude floor:
    expect(finalProcess.content.parameters.retrieval_weights['VALIDATED_PACKAGE']).toBeGreaterThan(0);
  });

  it('never presents the simulated measurement as promotion/decision evidence', () => {
    for (const decision of result.artifacts.decisions) {
      for (const record of [decision.engine_record]) {
        // the engine record's evidence refs never include the simulated results:
        for (const evidenceRef of record.content.evidence_refs) {
          expect(result.stages.effectiveness.measurements.some((m) => m.result_id === evidenceRef)).toBe(false);
        }
      }
    }
    // every measurement result is machine-marked simulated:
    for (const measurement of result.artifacts.measurements) {
      expect(measurement.result.simulated).toBe(true);
      expect(measurement.result.simulator).toEqual({ version: expect.any(String), seed: 20250701 });
    }
  });

  it('LIABILITY: the failed change is retained (never deleted) with failure memory + transfer + decay', () => {
    expect(result.stages.liability.failures).toHaveLength(1);
    const failure = result.stages.liability.failures[0]!;
    expect(failure.transfer_outcome).toBe('TRANSFER_FAILURE');
    expect(failure.memory_entry_ids).toContain('failure-regressive-pruning');
    expect(failure.memory_entry_ids).toContain('rollback-regressive-pruning');
    expect(failure.memory_entry_ids).toContain('liability-regressive-pruning');
    expect(failure.memory_entry_ids).toContain('rule-regressive-pruning');

    // the memory store (the input's own injected store) RETAINS the failure:
    const memoryArtifact = result.artifacts.retentions[0]!.memory;
    assertFailureRetained(built.input.stores.memory, memoryArtifact.envelope.id);
    const failureEntries = built.input.stores.memory.entriesOf(memoryArtifact.envelope.id, 'FAILURE');
    expect(failureEntries).toHaveLength(1);

    // negative transfer evidence retained (no removal API exists):
    expect(built.input.stores.transfer.failedTransfersFor(failure.package_id)).toHaveLength(1);

    // the decay signal feeds the READ-ONLY maturity review queue:
    const review = built.input.stores.reviewQueue.reviewQueueFor(failure.package_id);
    expect(review).not.toBeNull();
    expect(review!.signal_counts['FAILURE_RATE_GROWTH']).toBe(1);

    // R19: the failed package's proposal probability dropped:
    expect(failure.weight_after).toBeLessThan(failure.weight_before);
    expect(failure.probability_after).toBeLessThan(failure.probability_before);
  });

  it('satisfies the traceability invariant: one connected, queryable semantic subgraph', () => {
    expect(result.chain.complete).toBe(true);
    expect(result.chain.root).toBe(result.artifacts.initial_process.envelope.id);
    expect(result.trace.length).toBeGreaterThanOrEqual(50);
    expect(result.chain.reachable.length).toBeGreaterThanOrEqual(30);
    // every MetaChange proposal reaches the chain:
    for (const change of result.artifacts.changes) {
      expect(result.chain.reachable).toContain(change.envelope.id);
    }
    // every decision record reaches the chain:
    for (const decision of result.artifacts.decisions) {
      expect(result.chain.reachable).toContain(decision.engine_record.envelope.id);
    }
    // the applied revision AND the rollback restore + retained failure reach the chain:
    expect(result.chain.reachable).toContain(result.artifacts.final_process.envelope.id);
    expect(result.chain.reachable).toContain(result.artifacts.rollbacks[0]!.restore.envelope.id);
    expect(result.chain.reachable).toContain(result.artifacts.retentions[0]!.memory.envelope.id);
    // the object anchor (the W15 ImplementationModel) is linked into the chain:
    expect(result.chain.reachable).toContain(result.stages.separation.object_probe.implementation_model_id);

    // queryable in both directions: the applied revision's DERIVATION chain
    // (downstream over the directed links: revision --DERIVED_FROM-->
    // decision --> measurement --> change --> initial process) is fully
    // reachable from the applied revision:
    const query = queryMetaTrace(result.trace, result.artifacts.final_process.envelope.id);
    expect(query.downstream).toContain(result.artifacts.initial_process.envelope.id);
    expect(query.downstream).toContain(
      result.stages.decision.entries.find((entry) => entry.applied_revision_id !== null)!.engine_record_id,
    );
    expect(query.links.length).toBeGreaterThan(0);
    const changeQuery = queryMetaTrace(result.trace, result.artifacts.changes[0]!.envelope.id);
    expect(changeQuery.downstream.length + changeQuery.upstream.length).toBeGreaterThan(0);
    // the weakening change's upstream includes its guard-rejection evidence:
    const weakeningChange = result.artifacts.guard_rejections[0]!.change_id;
    const weakeningQuery = queryMetaTrace(result.trace, weakeningChange);
    expect(weakeningQuery.upstream).toContain(result.stages.guard.rejection_evidence_ids[0]!);
  });

  it('the mission constrains the process (R3/R31: the meta loop operates under the mission)', () => {
    expect(result.artifacts.mission.envelope.kind).toBe('Mission');
    expect(result.chain.reachable).toContain(result.artifacts.mission.envelope.id);
    const missionLink = result.trace.find(
      (link) => link.source === result.artifacts.mission.envelope.id && link.type === 'CONSTRAINS',
    );
    expect(missionLink?.target).toBe(result.artifacts.initial_process.envelope.id);
  });

  it('is deterministic: identical input (fresh stores) -> byte-identical canonical result', () => {
    const second = runMetaEvolutionLoop(buildGoldenMetaInput().input);
    expect(canonicalMetaText(second)).toBe(canonicalMetaText(result));
    expect(formatMetaSummary(second)).toBe(formatMetaSummary(result));
    expect(second.input_digest).toBe(result.input_digest);
  });

  it('binds the golden scenario to the exact W15 golden object fixtures', () => {
    // the object probe fixture IS the W15 golden brownfield scenario:
    expect(built.input.object.fixture).toEqual(GOLDEN_BROWNFIELD_SCENARIO);
    expect(built.input.object.variant).toBe('nominal');
  });
});
