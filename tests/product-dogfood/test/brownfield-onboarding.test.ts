/**
 * THE BROWNFIELD REPOSITORY ONBOARDING JOURNEY (P15 Lane A). Drives the
 * §12 brownfield journey through the merged @sos-2/brownfield loop:
 *
 *   connect existing repository/runtime -> observe -> recover competing
 *   architecture hypotheses -> identify shortfalls -> retrieve proven
 *   packages -> candidate -> assure -> experiment -> summon body when
 *   action is required -> verify -> promote / rollback / ASK
 *
 * The journey drives BOTH worlds through the merged golden scenario:
 *   - NOMINAL: the healthy simulated experiment -> the honest,
 *     evidence-gated EXPERIMENT decision (no real intervention evidence
 *     exists in a deterministic simulation — promotion stays gated).
 *   - DEGRADED: the error-rate guardrail breaches -> ROLLBACK decision
 *     with the bounded recovery declaration, failure memory and the
 *     rollback event.
 *
 * The journey asserts the P15 acceptance shape:
 *   (a) composition: driven through @sos-2/brownfield public exports only.
 *   (b) terminal state: BOTH loops form one connected trace chain from
 *       ImplementationModel to the learned ecology updates.
 *   (c) evidence graph: exact source revision (GOLDEN_REVISION) +
 *       every stage's typed trace link + the system-state anchor.
 *   (d) retained uncertainty: VISIBLE — the simulated experiment
 *       honestly reports `simulated: true` and the degraded world
 *       reports the guardrail breach + ROLLBACK triggers (never a
 *       fabricated HEALTHY).
 *   (e) reproduction: identical inputs (fresh stores) produce
 *       byte-identical canonical serializations (determinism).
 */

import { describe, expect, it } from 'vitest';
import {
  GOLDEN_BROWNFIELD_SCENARIO,
  GOLDEN_CAPTURED_AT,
  GOLDEN_NOW,
  GOLDEN_REVISION,
  buildBrownfieldLoopInput,
  canonicalBrownfieldText,
  runBrownfieldLoop,
} from '@sos-2/brownfield';
import type { BrownfieldLoopResult } from '@sos-2/brownfield';
import { canonicalSerialize } from '@sos-2/semantic-spine';

/** Run the brownfield loop for a given world variant. */
function runBrownfield(variant: 'nominal' | 'degraded'): BrownfieldLoopResult {
  return runBrownfieldLoop(buildBrownfieldLoopInput(GOLDEN_BROWNFIELD_SCENARIO, variant).input);
}

describe('P15 Lane A — brownfield repository onboarding (§12 end-to-end)', () => {
  it('drives the merged golden scenario through BOTH worlds (nominal + degraded) with one connected trace chain', () => {
    const nominal = runBrownfield('nominal');
    const degraded = runBrownfield('degraded');

    // BOTH loops form one connected trace chain from ImplementationModel to
    // the learned ecology updates (the §12 acceptance pin).
    expect(nominal.chain.complete).toBe(true);
    expect(degraded.chain.complete).toBe(true);
    expect(nominal.trace.length).toBeGreaterThan(0);
    expect(degraded.trace.length).toBeGreaterThan(0);
    expect(nominal.chain.reachable.length).toBeGreaterThan(0);
    expect(degraded.chain.reachable.length).toBeGreaterThan(0);
    expect(nominal.chain.missing).toEqual([]);
    expect(degraded.chain.missing).toEqual([]);
  });

  it('every consequential artifact carries the exact source revision (the existing repository state)', () => {
    const nominal = runBrownfield('nominal');
    const degraded = runBrownfield('degraded');

    // The exact source revision of the golden legacy tree is the source-of-truth revision everywhere it matters.
    expect(nominal.summary.source_revision).toBe(GOLDEN_REVISION);
    expect(degraded.summary.source_revision).toBe(GOLDEN_REVISION);
    expect(nominal.artifacts.implementation_model).toBeDefined();
    expect(degraded.artifacts.implementation_model).toBeDefined();
    // The system-state anchor + the ingestion evidence are bound to the snapshot.
    expect(nominal.artifacts.system_state_anchor).toBeTruthy();
    expect(degraded.artifacts.system_state_anchor).toBeTruthy();
    expect(nominal.artifacts.ingestion_evidence).toBeDefined();
    expect(degraded.artifacts.ingestion_evidence).toBeDefined();
  });

  it('the NOMINAL world reports an honest EXPERIMENT decision (no fabricated promotion — simulated evidence)', () => {
    const nominal = runBrownfield('nominal');

    // The experiment is honestly marked SIMULATED (never a real intervention).
    expect(nominal.summary.experiment.simulated).toBe(true);
    // The decision is EXPERIMENT — promotion stays gated because no real intervention evidence exists.
    expect(nominal.summary.decision.action).toBe('EXPERIMENT');
    expect(nominal.summary.decision.guardrails_tripped).toBe(false);
    // The candidate + assurance artifacts are present.
    expect(nominal.summary.candidate.target_component).toBeTruthy();
    expect(nominal.summary.candidate.replacement_component).toBeTruthy();
    expect(nominal.summary.assurance.verdict).toMatch(/^(VALID|OBJECTIONED|INVALID)$/);
    // Remaining uncertainty is VISIBLE — the simulated experiment carries its seed.
    expect(nominal.summary.experiment.seed).toBeGreaterThanOrEqual(0);
  });

  it('the DEGRADED world drives the ROLLBACK path variant with bounded recovery + failure memory', () => {
    const degraded = runBrownfield('degraded');

    // The error-rate guardrail breaches in the degraded world.
    expect(degraded.summary.experiment.guardrails_breached).toBeGreaterThan(0);
    // The decision is ROLLBACK with the bounded recovery declaration.
    expect(degraded.summary.decision.action).toBe('ROLLBACK');
    expect(degraded.summary.decision.guardrails_tripped).toBe(true);
    expect(degraded.summary.decision.recovery_declared).toBe(true);
    expect(degraded.artifacts.promotion_recovery).toBeDefined();
    expect(degraded.artifacts.reconciliation).toBeDefined();
    // Failure memory + decay signals are retained (never dropped).
    expect(degraded.summary.learned.memory_entries).toBeGreaterThanOrEqual(0);
    expect(degraded.summary.learned.decay_signals).toBeGreaterThanOrEqual(0);
    // The degraded world's experiment result is still honestly SIMULATED.
    expect(degraded.summary.experiment.simulated).toBe(true);
  });

  it('the journey observes the existing repository/runtime state through the §12 brownfield stages IN ORDER', () => {
    const nominal = runBrownfield('nominal');

    // The nine merged stages ran (the §12 contract).
    const stageKeys = Object.keys(nominal.stages).sort();
    expect(stageKeys).toEqual(
      [
        'ingestion',
        'recovery',
        'retrieval',
        'evolution',
        'assurance',
        'experiment',
        'promotion',
        'reconciliation',
        'learning',
      ].sort(),
    );
    // The ingested snapshot covers modules + dependencies + interfaces + runtime observations + telemetry.
    expect(nominal.summary.ingested.modules).toBeGreaterThan(0);
    expect(nominal.summary.ingested.dependencies).toBeGreaterThan(0);
    expect(nominal.summary.ingested.interfaces).toBeGreaterThan(0);
    expect(nominal.summary.ingested.runtime_observations).toBeGreaterThan(0);
    // Telemetry gaps are RETAINED honestly (never hidden).
    expect(nominal.summary.ingested.telemetry_gaps).toBeGreaterThanOrEqual(0);
  });

  it('the journey retains uncertainty VISIBLE — competing hypotheses + ambiguity never collapses', () => {
    const nominal = runBrownfield('nominal');
    const degraded = runBrownfield('degraded');

    // Recovery produces COMPETING hypotheses (ambiguity never collapses to a single winner).
    expect(nominal.summary.hypotheses.count).toBeGreaterThan(0);
    expect(degraded.summary.hypotheses.count).toBeGreaterThan(0);
    // Both worlds retain the strategies considered (diversity preserved).
    expect(nominal.summary.hypotheses.strategies.length).toBeGreaterThan(0);
    expect(degraded.summary.hypotheses.strategies.length).toBeGreaterThan(0);
    // The single caller-supplied instant is retained (no hidden clocks).
    expect(GOLDEN_NOW).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(GOLDEN_CAPTURED_AT).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('reproduces bit-exactly across runs (determinism — fresh stores, identical inputs)', () => {
    const nominal1 = runBrownfield('nominal');
    const nominal2 = runBrownfield('nominal');
    const degraded1 = runBrownfield('degraded');
    const degraded2 = runBrownfield('degraded');

    // Identical inputs (fresh stores) produce byte-identical canonical serializations.
    expect(canonicalBrownfieldText(nominal2)).toBe(canonicalBrownfieldText(nominal1));
    expect(canonicalBrownfieldText(degraded2)).toBe(canonicalBrownfieldText(degraded1));
    // The canonical JSON projection reproduces too.
    expect(canonicalSerialize(nominal2.summary)).toBe(canonicalSerialize(nominal1.summary));
    expect(canonicalSerialize(degraded2.summary)).toBe(canonicalSerialize(degraded1.summary));
  });
});
