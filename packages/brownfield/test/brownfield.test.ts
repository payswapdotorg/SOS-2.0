/**
 * @sos-2/brownfield — the W15 brownfield optimization loop tests (unit + e2e
 * over the golden scenario, both variants). Property and negative suites
 * live in property.test.ts / brownfield.negative.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  GOLDEN_BROWNFIELD_SCENARIO,
  goldenResult,
  goldenInput,
} from './helpers.js';
import {
  ASSURANCE_VERDICT_PROJECTION,
  buildBrownfieldLoopInput,
  canonicalBrownfieldText,
  formatBrownfieldSummary,
  queryBrownfieldTrace,
  runBrownfieldLoop,
  verifyBrownfieldTraceChain,
  BROWNFIELD_STAGES,
} from '../src/index.js';
import { assertValidArchitectureDelta } from '@sos-2/semantic-spine';

const here = dirname(fileURLToPath(import.meta.url));

describe('golden brownfield loop — nominal variant (e2e)', () => {
  const result = goldenResult('nominal');

  it('runs all nine stages in canonical order', () => {
    expect(Object.keys(result.stages)).toEqual(BROWNFIELD_STAGES.map((stage) => stage.toLowerCase()));
    for (const stage of Object.values(result.stages)) {
      expect(stage.links.length).toBeGreaterThan(0);
    }
  });

  it('ingests the snapshot (modules, dependencies, telemetry, gaps)', () => {
    const ingestion = result.stages.ingestion;
    expect(ingestion.module_count).toBe(6);
    expect(ingestion.dependency_count).toBe(5);
    expect(ingestion.interface_count).toBe(1);
    expect(ingestion.runtime_observation_count).toBe(6);
    expect(ingestion.telemetry.ingested).toBe(4); // 2 spans + 1 metric + 1 log
    expect(ingestion.telemetry.gaps).toBe(1); // declared-but-unobserved legacy-reporting
    expect(ingestion.telemetry.digest.startsWith('obs:')).toBe(true);
    // Runtime conformance verdicts are truthfully recorded (PASS and UNKNOWN
    // both allowed — never conflated).
    const total = ingestion.runtime_conformance.verdicts.PASS + ingestion.runtime_conformance.verdicts.FAIL + ingestion.runtime_conformance.verdicts.UNKNOWN;
    expect(total).toBe(GOLDEN_BROWNFIELD_SCENARIO.invariants.length);
    // The ImplementationModel is a spine artifact with a deterministic id.
    expect(ingestion.implementation_model_id.startsWith('sos://ImplementationModel/')).toBe(true);
  });

  it('recovers COMPETING hypotheses under ambiguous evidence', () => {
    const recovery = result.stages.recovery;
    expect(recovery.ambiguity_detected).toBe(true);
    expect(recovery.hypothesis_count).toBeGreaterThanOrEqual(2);
    expect(recovery.competing).toBe(true);
    expect(recovery.strategies).toContain('DIRECT');
    expect(recovery.strategies).toContain('MERGED_REALIZATIONS');
    expect(recovery.markers.length).toBeGreaterThan(0);
    expect(recovery.selected_hypothesis_id).toBe(recovery.hypothesis_ids[0]);
    // every hypothesis has provenance links to the observed model
    for (const link of recovery.links) {
      expect(link.target).toBe(result.stages.ingestion.implementation_model_id);
    }
  });

  it('retrieves a diverse candidate set with surfaced uncertainty', () => {
    const retrieval = result.stages.retrieval;
    expect(retrieval.candidate_count).toBe(3);
    expect(retrieval.families.sort()).toEqual(['durable-queue', 'edge-cache', 'legacy-monolith']);
    for (const candidate of retrieval.candidates) {
      expect(candidate.uncertainty.uncertainty_class).toBeTruthy();
    }
    expect(retrieval.altitudes_present).toContain('VALIDATED_PACKAGE');
    expect(retrieval.altitudes_present).toContain('PACKAGE_ADAPTATION');
  });

  it('evolves a bounded, invariant-preserving candidate', () => {
    const evolution = result.stages.evolution;
    expect(evolution.bounded.nodes).toEqual(['legacy-search']);
    expect(evolution.bounded.edges.length).toBeGreaterThan(0);
    expect(evolution.selected_candidate_id.startsWith('sos://Package/')).toBe(true);
    expect(evolution.selected_family === 'durable-queue' || evolution.selected_family === 'edge-cache').toBe(true);
    expect(evolution.applied.node_count).toBeGreaterThan(0);
    expect(evolution.applied.diff_size).toBeGreaterThan(0);
    for (const invariantResult of evolution.invariant_results) {
      expect(invariantResult.status === 'PASS' || invariantResult.status === 'NOT_APPLICABLE').toBe(true);
    }
    // the incumbent (dominated) is never selected
    expect(evolution.selected_family).not.toBe('legacy-monolith');
    // uncertainty is carried into the multi-objective evaluation
    expect(evolution.carried_uncertainty.uncertainty_class).toBeTruthy();
    // the Pareto evaluation kept a FRONT (more than one non-dominated candidate)
    expect(evolution.pareto.front_zero.length).toBeGreaterThanOrEqual(2);
    // the quality-diversity repertoire kept multiple families
    expect(evolution.repertoire.families.length).toBeGreaterThanOrEqual(2);
  });

  it('evaluates the assurance case truthfully (objections retained)', () => {
    const assurance = result.stages.assurance;
    expect(assurance.verdict).toBe('VALID');
    expect(assurance.blocks).toBe(false);
    expect(assurance.objections).toEqual([{ id: 'objection-human-review-pending', status: 'RESOLVED' }]);
    expect(assurance.monitor.verdict).toBe('SATISFIED');
    expect(assurance.promotion_fixture.verdict).toBe(ASSURANCE_VERDICT_PROJECTION.VALID);
    expect(assurance.promotion_fixture.validity.status).toBe('CURRENT');
  });

  it('runs the SIMULATED experiment with the fixed seed and healthy guardrails', () => {
    const experiment = result.stages.experiment;
    expect(experiment.simulated).toBe(true);
    expect(experiment.seed).toBe(GOLDEN_BROWNFIELD_SCENARIO.experiment.seed);
    expect(experiment.lifecycle.map((stage) => stage.phase)).toEqual(['SHADOW', 'CANARY', 'CONTROLLED_EXPERIMENT']);
    expect(experiment.guardrails.every((guardrail) => guardrail.status === 'SATISFIED')).toBe(true);
    expect(experiment.rollback_triggers.every((trigger) => !trigger.triggered)).toBe(true);
    expect(experiment.overall_availability).toBe('SUCCESS');
  });

  it('reaches the honest EXPERIMENT decision (evidence-gated promotion)', () => {
    const promotion = result.stages.promotion;
    expect(promotion.decision).toBe('EXPERIMENT');
    expect(promotion.guardrails_tripped).toBe(false);
    expect(promotion.recovery).not.toBeNull();
    expect(promotion.recovery?.max_recovery_seconds).toBeGreaterThan(0);
    expect(promotion.recovery?.rollback_triggers.length).toBeGreaterThan(0);
    expect(promotion.decision_artifact_id.startsWith('sos://Decision/')).toBe(true);
  });

  it('classifies implementation-vs-declared drift across frozen classes', () => {
    const reconciliation = result.stages.reconciliation;
    const classes = Object.keys(reconciliation.classifications);
    expect(classes.length).toBe(7);
    const total = Object.values(reconciliation.classifications).reduce((sum, count) => sum + count, 0);
    expect(total).toBeGreaterThan(0);
    // the declared-but-removed reporting component is drift (never silently resolved)
    expect(reconciliation.classifications.DRIFT + reconciliation.classifications.CONTRADICTION).toBeGreaterThan(0);
    const driftSubjects = reconciliation.findings.filter((finding) => finding.classification === 'DRIFT' || finding.classification === 'CONTRADICTION');
    expect(driftSubjects.some((finding) => finding.subject.includes('legacy-reporting'))).toBe(true);
  });

  it('feeds the package ecology (transfer, decay signals, memory)', () => {
    const learning = result.stages.learning;
    expect(learning.decision).toBe('EXPERIMENT');
    expect(learning.transfer_outcome).toBe('TRANSFER_SUCCESS');
    expect(learning.transfer_source_ref.startsWith('sos://Package/')).toBe(true);
    expect(learning.decay_signal_ids.length).toBe(1);
    expect(learning.decay_kinds).toEqual(['USAGE_DECAY']);
    expect(learning.memory_artifact_id.startsWith('sos://ArchitectureMemory/')).toBe(true);
    const kinds = learning.memory_entries.map((entry) => entry.entry_kind).sort();
    expect(kinds).toEqual(['LEARNED_RULE', 'OBSERVATION', 'OUTCOME', 'PREDICTION']);
    expect(learning.outcome_availability).toBe('SUCCESS');
  });

  it('forms ONE connected trace chain from ImplementationModel to the learned ecology', () => {
    expect(result.chain.complete).toBe(true);
    expect(result.chain.missing).toEqual([]);
    expect(result.chain.root).toBe(result.stages.ingestion.implementation_model_id);
    // every learned endpoint is reachable
    for (const packageId of result.stages.learning.ecology_package_ids) {
      expect(result.chain.reachable).toContain(packageId);
    }
    expect(result.chain.reachable).toContain(result.stages.learning.memory_artifact_id);
    // the chain is queryable: with the spine's DERIVED_FROM/OBSERVES
    // convention (derived/observer -> source), every downstream loop
    // artifact (hypotheses -> candidate -> experiment -> decision ->
    // learning) is transitively UPSTREAM of the ImplementationModel it
    // derives from, and the memory's DOWNSTREAM walk reaches the model.
    const query = queryBrownfieldTrace(result.trace, result.stages.ingestion.implementation_model_id);
    expect(query.upstream).toContain(result.stages.learning.memory_artifact_id);
    expect(query.upstream).toContain(result.stages.promotion.decision_artifact_id);
    expect(query.upstream).toContain(result.stages.experiment.experiment_id);
    expect(query.upstream).toContain(result.stages.learning.transfer_source_ref);
    expect(query.downstream).toContain(result.stages.ingestion.system_state_id);
    const memoryQuery = queryBrownfieldTrace(result.trace, result.stages.learning.memory_artifact_id);
    expect(memoryQuery.downstream).toContain(result.stages.promotion.decision_artifact_id);
    expect(memoryQuery.downstream).toContain(result.stages.ingestion.implementation_model_id);
  });

  it('is deterministic (byte-identical canonical serialization on re-run)', () => {
    const second = goldenResult('nominal');
    expect(canonicalBrownfieldText(second)).toBe(canonicalBrownfieldText(result));
  });

  it('formats a deterministic human-readable summary', () => {
    const text = formatBrownfieldSummary(result);
    expect(text).toContain('merch-catalog-legacy');
    expect(text).toContain('hypotheses:');
    expect(text).toContain('decision: EXPERIMENT');
    expect(text).toContain('trace chain: COMPLETE');
    expect(formatBrownfieldSummary(goldenResult('nominal'))).toBe(text);
  });
});

describe('golden brownfield loop — degraded variant (ROLLBACK path)', () => {
  const result = goldenResult('degraded');

  it('breaches the guardrail and fires the rollback trigger', () => {
    expect(result.stages.experiment.guardrails.some((guardrail) => guardrail.status === 'BREACHED')).toBe(true);
    expect(result.stages.experiment.rollback_triggers.some((trigger) => trigger.triggered)).toBe(true);
    expect(result.stages.experiment.overall_availability).toBe('FAILURE');
  });

  it('decides ROLLBACK with a bounded recovery declaration', () => {
    const promotion = result.stages.promotion;
    expect(promotion.decision).toBe('ROLLBACK');
    expect(promotion.guardrails_tripped).toBe(true);
    expect(promotion.recovery).not.toBeNull();
    expect(promotion.recovery?.mechanism).toContain('blue-green');
    expect(promotion.recovery?.rollback_triggers.length).toBeGreaterThan(0);
  });

  it('retains failure memory and the rollback event', () => {
    const learning = result.stages.learning;
    const kinds = learning.memory_entries.map((entry) => entry.entry_kind).sort();
    expect(kinds).toEqual(['FAILURE', 'LEARNED_RULE', 'OBSERVATION', 'OUTCOME', 'PREDICTION', 'ROLLBACK']);
    expect(learning.transfer_outcome).toBe('TRANSFER_FAILURE');
    expect(learning.outcome_availability).toBe('FAILURE');
  });

  it('still forms a complete trace chain', () => {
    expect(result.chain.complete).toBe(true);
  });

  it('is deterministic on re-run', () => {
    expect(canonicalBrownfieldText(goldenResult('degraded'))).toBe(canonicalBrownfieldText(result));
  });
});

describe('fixture builder', () => {
  it('builds fresh, independent registries and stores per call', () => {
    const first = goldenInput('nominal');
    const second = goldenInput('nominal');
    expect(first.registry).not.toBe(second.registry);
    expect(first.input.stores.memory).not.toBe(second.input.stores.memory);
    expect(first.packageIds).toEqual(second.packageIds);
    // promoting the population is visible through retrieval
    expect(first.input.registry.listCurrent().length).toBe(3);
  });

  it('binds package ids deterministically (content-addressed)', () => {
    const first = goldenInput('nominal');
    const second = goldenInput('degraded');
    expect(first.packageIds).toEqual(second.packageIds);
  });

  it('produces byte-identical loop results across independent builds', () => {
    const first = runBrownfieldLoop(goldenInput('nominal').input);
    const second = runBrownfieldLoop(goldenInput('nominal').input);
    expect(canonicalBrownfieldText(first)).toBe(canonicalBrownfieldText(second));
  });
});

describe('Architecture Delta record', () => {
  it('validates against the spine delta contract and declares only owned paths', () => {
    const delta = JSON.parse(readFileSync(join(here, '../W15.architecture-delta.json'), 'utf8')) as unknown;
    expect(() => assertValidArchitectureDelta(delta)).not.toThrow();
    const record = delta as { affected_artifacts: string[]; work_order: string };
    expect(record.work_order).toBe('W15');
    for (const path of record.affected_artifacts) {
      expect(path.startsWith('packages/brownfield') || path.startsWith('apps/brownfield-harness')).toBe(true);
    }
  });
});

describe('trace chain verification (re-runnable)', () => {
  it('re-verifies a completed loop result', () => {
    const result = goldenResult('nominal');
    const required = [
      ...result.stages.ingestion.output_refs,
      ...result.stages.learning.output_refs,
      ...result.stages.learning.ecology_package_ids,
    ];
    const verification = verifyBrownfieldTraceChain(result.trace, result.stages.ingestion.implementation_model_id, required);
    expect(verification.complete).toBe(true);
  });
});

describe('stage guards', () => {
  it('assertSimulatedOutcome accepts the golden simulated result', () => {
    const result = goldenResult('nominal');
    expect(result.artifacts.experiment_result.simulated).toBe(true);
  });

  it('the W8->W9 assurance verdict projection is the frozen mapping', () => {
    expect(ASSURANCE_VERDICT_PROJECTION).toEqual({ VALID: 'SATISFIED', OBJECTIONED: 'INCOMPLETE', INVALID: 'REFUTED' });
  });
});

describe('variant independence', () => {
  it('nominal and degraded differ only where the world differs', () => {
    const nominal = goldenResult('nominal');
    const degraded = goldenResult('degraded');
    expect(nominal.input_digest).not.toBe(degraded.input_digest); // different effect sets
    // same ingestion (same model/system/declared ids; the ingestion EVIDENCE
    // id differs because the input digest binds the variant's effect set)
    expect(nominal.stages.ingestion.implementation_model_id).toBe(degraded.stages.ingestion.implementation_model_id);
    expect(nominal.stages.ingestion.system_state_id).toBe(degraded.stages.ingestion.system_state_id);
    expect(nominal.stages.ingestion.declared_architecture_id).toBe(degraded.stages.ingestion.declared_architecture_id);
    expect(nominal.stages.recovery.hypothesis_ids).toEqual(degraded.stages.recovery.hypothesis_ids); // same hypotheses
    expect(nominal.stages.promotion.decision).not.toBe(degraded.stages.promotion.decision);
  });
});

describe('buildBrownfieldLoopInput validation', () => {
  it('rejects unknown package keys in the goal estimates', () => {
    const scenario = {
      ...GOLDEN_BROWNFIELD_SCENARIO,
      goal: { ...GOLDEN_BROWNFIELD_SCENARIO.goal, predicted_estimates_by_key: { 'unknown-family': { COST: 1 } } },
    };
    expect(() => buildBrownfieldLoopInput(scenario, 'nominal')).toThrow(/unknown package key/);
  });
});
