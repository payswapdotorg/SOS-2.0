/**
 * @sos-2/brownfield — NEGATIVE tests (W15). Each of the five forbidden
 * behaviors from the Work Order is pinned here:
 *
 *   1. ambiguous evidence collapsed to one hypothesis — REJECTED
 *   2. simulated outcome presented as intervention evidence — REJECTED
 *   3. assurance-invalid candidate promoted — REJECTED
 *   4. rollback without a recovery declaration — REJECTED
 *   5. broken trace chain — REJECTED (the pipeline fails)
 */

import { describe, expect, it } from 'vitest';
import { goldenResult, goldenInput } from './helpers.js';
import {
  assertCompetingHypotheses,
  assertRollbackRecovery,
  assertSimulatedOutcome,
  assertBrownfieldTraceChain,
  verifyBrownfieldTraceChain,
  buildBoundedRecovery,
  ASSURANCE_VERDICT_PROJECTION,
  isBrownfieldError,
  BrownfieldError,
  normalizeSnapshot,
  runBrownfieldLoop,
} from '../src/index.js';
import { evaluatePromotion } from '@sos-2/promotion';
import type { AssuranceCaseFixture } from '@sos-2/promotion';

describe('negative: ambiguous evidence collapsed to one hypothesis is REJECTED', () => {
  it('the pipeline guard throws when ambiguity yields fewer than two hypotheses', () => {
    expect(() => assertCompetingHypotheses(true, 1)).toThrow(BrownfieldError);
    try {
      assertCompetingHypotheses(true, 1);
    } catch (error) {
      expect(isBrownfieldError(error)).toBe(true);
      expect((error as BrownfieldError).code).toBe('AMBIGUITY_COLLAPSED');
      expect((error as Error).message).toContain('COMPETING');
    }
  });

  it('unambiguous evidence with a single hypothesis is legitimate (no throw)', () => {
    expect(() => assertCompetingHypotheses(false, 1)).not.toThrow();
    expect(() => assertCompetingHypotheses(true, 2)).not.toThrow();
    expect(() => assertCompetingHypotheses(true, 4)).not.toThrow();
  });

  it('the golden ambiguous snapshot actually yields the competing set (no collapse)', () => {
    const result = goldenResult('nominal');
    expect(result.stages.recovery.ambiguity_detected).toBe(true);
    expect(result.stages.recovery.hypothesis_count).toBeGreaterThanOrEqual(2);
  });
});

describe('negative: simulated outcome as intervention evidence is REJECTED', () => {
  it('the promotion gate REJECTS the simulated ExperimentResultRecord presented as evidence', () => {
    const result = goldenResult('nominal');
    const { input } = goldenInput('nominal');
    const evaluation = evaluatePromotion(result.artifacts.candidate_state, {
      authority: { grant: result.artifacts.promotion_grant, now: input.now },
      assurance: result.artifacts.assurance_promotion_fixture as AssuranceCaseFixture,
      evidence: [result.artifacts.experiment_result], // the SIMULATED record
      liveTriggers: result.artifacts.experiment_evaluation.rollback,
      systemState: { revision: `${result.artifacts.system_state.envelope.id}@v${result.artifacts.system_state.envelope.version}` },
      recovery: result.artifacts.promotion_recovery,
      provenance: ['W15:negative-test:simulated-evidence'],
      created_at: input.now,
    });
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.reasons.join(' ')).toMatch(/simulat/i);
    expect(evaluation.gates.evidence.rejected_simulated.length).toBe(1);
  });

  it('the loop itself never presents simulated evidence (empty evidence list, honest EXPERIMENT decision)', () => {
    const result = goldenResult('nominal');
    expect(result.stages.promotion.decision).toBe('EXPERIMENT');
  });

  it('the simulation marker guard rejects an unmarked result', () => {
    const result = goldenResult('nominal');
    const unmarked = { ...result.artifacts.experiment_result, simulated: false };
    expect(() => assertSimulatedOutcome(unmarked as never)).toThrow(/not marked simulated/);
    expect(() => assertSimulatedOutcome(result.artifacts.experiment_result)).not.toThrow();
  });
});

describe('negative: assurance-invalid candidate promoted is REJECTED', () => {
  it('the W8->W9 projection maps INVALID to REFUTED', () => {
    expect(ASSURANCE_VERDICT_PROJECTION.INVALID).toBe('REFUTED');
  });

  it('the promotion gate REJECTS an assurance-invalid candidate (REFUTED fixture)', () => {
    const result = goldenResult('nominal');
    const { input } = goldenInput('nominal');
    const refutedCase: AssuranceCaseFixture = {
      ...result.artifacts.assurance_promotion_fixture,
      verdict: 'REFUTED',
    };
    const evaluation = evaluatePromotion(result.artifacts.candidate_state, {
      authority: { grant: result.artifacts.promotion_grant, now: input.now },
      assurance: refutedCase,
      evidence: [],
      liveTriggers: [],
      systemState: { revision: `${result.artifacts.system_state.envelope.id}@v${result.artifacts.system_state.envelope.version}` },
      provenance: ['W15:negative-test:assurance-invalid'],
      created_at: input.now,
    });
    expect(evaluation.decision).toBe('REJECT');
    expect(evaluation.reasons.join(' ')).toMatch(/invalid or refuted/);
  });

  it('an INVALID W8 evaluation blocks the loop stage record', () => {
    // blocks is a derived, machine-checkable flag of the assurance stage
    const result = goldenResult('nominal');
    expect(result.stages.assurance.blocks).toBe(result.stages.assurance.verdict === 'INVALID');
    expect(result.stages.assurance.blocks).toBe(false); // the golden case is VALID
  });
});

describe('negative: rollback without a recovery declaration is REJECTED', () => {
  it('the pipeline guard throws for ROLLBACK without recovery', () => {
    expect(() => assertRollbackRecovery('ROLLBACK', null)).toThrow(BrownfieldError);
    try {
      assertRollbackRecovery('ROLLBACK', null);
    } catch (error) {
      expect((error as BrownfieldError).code).toBe('ROLLBACK_WITHOUT_RECOVERY');
    }
  });

  it('non-rollback decisions do not require a declaration', () => {
    expect(() => assertRollbackRecovery('EXPERIMENT', null)).not.toThrow();
    expect(() => assertRollbackRecovery('ACT', null)).not.toThrow();
  });

  it('a ROLLBACK with a valid declaration passes the guard', () => {
    const result = goldenResult('degraded');
    expect(result.stages.promotion.decision).toBe('ROLLBACK');
    expect(() => assertRollbackRecovery('ROLLBACK', result.stages.promotion.recovery)).not.toThrow();
  });

  it('buildBoundedRecovery wires triggers to the experiment guardrail records', () => {
    const result = goldenResult('degraded');
    const { input } = goldenInput('degraded');
    const recovery = buildBoundedRecovery(
      input,
      result.artifacts.experiment,
      result.artifacts.experiment_evaluation,
      result.artifacts.promotion_grant.envelope.id,
    );
    expect(recovery.rollback_triggers.length).toBeGreaterThan(0);
    expect(recovery.rollback_triggers.every((wiring) => wiring.experiment_id === result.artifacts.experiment.envelope.id)).toBe(true);
    expect(recovery.max_recovery_seconds).toBeGreaterThan(0);
    expect(recovery.containment_exception).toBeNull();
  });
});

describe('negative: broken trace chain is REJECTED', () => {
  it('the verifier reports the unreachable endpoint and the assert form throws', () => {
    const result = goldenResult('nominal');
    const memoryId = result.stages.learning.memory_artifact_id;
    const required = [memoryId, result.stages.ingestion.implementation_model_id];
    const broken = result.trace.filter((link) => link.source !== memoryId && link.target !== memoryId);
    const verification = verifyBrownfieldTraceChain(broken, result.stages.ingestion.implementation_model_id, required);
    expect(verification.complete).toBe(false);
    expect(verification.missing).toEqual([memoryId]);
    expect(() => assertBrownfieldTraceChain(broken, result.stages.ingestion.implementation_model_id, required)).toThrow(
      /trace chain is broken/,
    );
  });

  it('an isolated artifact (no links at all) is unreachable', () => {
    const result = goldenResult('nominal');
    const orphan = 'sos://Evaluation/' + 'a'.repeat(32);
    const verification = verifyBrownfieldTraceChain(result.trace, result.stages.ingestion.implementation_model_id, [orphan]);
    expect(verification.complete).toBe(false);
    expect(verification.missing).toEqual([orphan]);
  });

  it('the golden loop passes its own chain assertion (control)', () => {
    const result = goldenResult('nominal');
    expect(() =>
      assertBrownfieldTraceChain(result.trace, result.stages.ingestion.implementation_model_id, [
        ...result.stages.learning.output_refs,
        ...result.stages.learning.ecology_package_ids,
      ]),
    ).not.toThrow();
  });
});

describe('negative: invalid inputs fail loudly', () => {
  it('an invalid snapshot (duplicate module id) is rejected at ingestion', () => {
    const { input } = goldenInput('nominal');
    const snapshot = {
      ...input.snapshot,
      modules: [...input.snapshot.modules, { ...input.snapshot.modules[0]! }],
    };
    expect(() => normalizeSnapshot(snapshot)).toThrow(/duplicate module id/);
  });

  it('a target component missing from the selected hypothesis is rejected at evolution', () => {
    const { input } = goldenInput('nominal');
    const doomed = {
      ...input,
      goal: { ...input.goal, target_component: 'component-that-does-not-exist' },
    };
    expect(() => runBrownfieldLoop(doomed)).toThrow(/EVOLUTION_TARGET_NOT_IN_HYPOTHESIS/);
  });
});
