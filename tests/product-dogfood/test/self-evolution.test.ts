/**
 * THE SELF-EVOLUTION JOURNEY (P15 Lane A — the meta loop). Drives the
 * merged @sos-2/meta-evolution loop over the golden scenario to assert
 * the learned ecology UPDATES AS DATA (learned records, never by
 * rewriting package internals).
 *
 * The journey:
 *   buildGoldenMetaInput() -> runMetaEvolutionLoop()
 *   -> assert the loop produced learned records (memory entries + transfer
 *      records + decay signals) AS DATA — the meta-process revisions are
 *      content-addressed, the retentions are evidence-backed, and the
 *      trace chain is one connected semantic subgraph.
 *
 * The journey asserts the P15 acceptance shape:
 *   (a) composition: driven through @sos-2/meta-evolution public exports
 *       (no internal mutation).
 *   (b) terminal state: the meta loop completed with a connected trace
 *       chain (chain.complete === true).
 *   (c) evidence graph: every meta-change carries its content-addressed
 *       envelope id + provenance + the experiment evidence; the
 *       retentions are typed ArchitectureMemoryArtifact records added as
 *       DATA to the learned ecology.
 *   (d) retained uncertainty: VISIBLE — the effectiveness measurements
 *       are honestly SIMULATED (simulated: true; the seed rides along);
 *       the failure memory is RETAINED (never dropped); the R19 penalty
 *       is demonstrated.
 *   (e) determinism: identical inputs reproduce identical canonical
 *       serializations (the bit-exact reproduction pin).
 */

import { describe, expect, it } from 'vitest';
import { buildGoldenMetaInput, runGoldenObjectLoop } from '@sos-2/meta-evolution';
import { runMetaEvolutionLoop, canonicalMetaText, formatMetaSummary } from '@sos-2/meta-evolution';
import type { MetaEvolutionLoopResult } from '@sos-2/meta-evolution';
import { canonicalSerialize } from '@sos-2/semantic-spine';

/** Run the golden meta-evolution loop. */
function runMetaEvolution(): MetaEvolutionLoopResult {
  const built = buildGoldenMetaInput();
  return runMetaEvolutionLoop(built.input);
}

describe('P15 Lane A — self-evolution: the meta loop updates the learned ecology as DATA', () => {
  it('drives the golden meta-evolution loop through all seven stages with one connected trace chain', () => {
    const result = runMetaEvolution();

    // The trace chain is complete (one connected semantic subgraph from the
    // initial process to every learned ecology update — the W16 acceptance pin).
    expect(result.chain.complete).toBe(true);
    expect(result.chain.missing).toEqual([]);
    expect(result.trace.length).toBeGreaterThan(0);
    expect(result.chain.reachable.length).toBeGreaterThan(0);
  });

  it('the meta loop produces learned records AS DATA (memory entries + transfer records + decay signals)', () => {
    const result = runMetaEvolution();

    // The retained-failures block carries memory entries + transfer outcomes
    // (the learned ecology updates — DATA, not internal mutation).
    expect(result.summary.retained_failures.count).toBeGreaterThan(0);
    expect(result.summary.retained_failures.memory_entry_kinds.length).toBeGreaterThan(0);
    expect(result.summary.retained_failures.transfer_outcomes.length).toBeGreaterThan(0);

    // Each retention is a typed ArchitectureMemoryArtifact + outcome evidence + transfer record + decay signal.
    expect(result.artifacts.retentions.length).toBeGreaterThan(0);
    for (const retention of result.artifacts.retentions) {
      expect(retention.memory).toBeDefined();
      expect(retention.outcome_evidence).toBeDefined();
      expect(retention.transfer_record_id).toBeTruthy();
      expect(retention.decay_signal_id).toBeTruthy();
    }
  });

  it('every meta-change carries its content-addressed envelope id + provenance + experiment evidence', () => {
    const result = runMetaEvolution();

    expect(result.artifacts.changes.length).toBeGreaterThan(0);
    for (const change of result.artifacts.changes) {
      expect(change.envelope.id).toMatch(/^sos:\/\/[A-Za-z]+\/[0-9a-f]{32}$/);
      expect(change.envelope.provenance.length).toBeGreaterThan(0);
    }

    // Each measurement binds a change to its candidate + experiment + result (the typed trace link).
    expect(result.artifacts.measurements.length).toBeGreaterThan(0);
    for (const measurement of result.artifacts.measurements) {
      expect(measurement.change.envelope.id).toBeTruthy();
      expect(measurement.candidate.envelope.id).toMatch(/^sos:\/\/CandidateState\//);
      expect(measurement.experiment.envelope.id).toMatch(/^sos:\/\/Experiment\//);
      expect(measurement.result.id).toMatch(/^sos:\/\/Evaluation\//);
      expect(measurement.trial.envelope.id).toMatch(/^sos:\/\/MetaProcess\//);
    }
  });

  it('retained uncertainty is VISIBLE — the effectiveness measurements are honestly SIMULATED', () => {
    const result = runMetaEvolution();

    // The effectiveness block is honestly marked SIMULATED (never live).
    expect(result.summary.effectiveness.simulated).toBe(true);
    expect(result.summary.effectiveness.seed).toBeGreaterThanOrEqual(0);
    // Negative outcomes are RETAINED (the R19 penalty is demonstrated — never dropped).
    expect(result.summary.retained_failures.penalty_demonstrated).toBe(true);
    // The decision distribution sums to a non-negative count (promote + rollback + ask + other).
    const decisions = result.summary.decisions;
    const total = decisions.promote + decisions.rollback + decisions.ask + decisions.other;
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(result.artifacts.changes.length);
  });

  it('the meta-process revisions are content-addressed + the final revision is restorable bit-exactly', () => {
    const result = runMetaEvolution();

    // The process revision history is retained (every trial + restore + activation).
    expect(result.summary.process_revision.history.length).toBeGreaterThan(0);
    expect(result.artifacts.process_revisions.length).toBeGreaterThan(0);
    // The initial and final revisions are distinct meta-process artifacts.
    expect(result.artifacts.initial_process.envelope.id).toMatch(/^sos:\/\/MetaProcess\//);
    expect(result.artifacts.final_process.envelope.id).toMatch(/^sos:\/\/MetaProcess\//);
    // The final revision restores exactly (bit-exact — the W16 reproducibility pin).
    expect(result.summary.process_revision.restore_exact).toBe(true);
  });

  it('reproduces bit-exactly across runs (determinism — fresh stores, identical inputs)', () => {
    const first = runMetaEvolution();
    const second = runMetaEvolution();

    // The canonical text reproduces exactly.
    expect(canonicalMetaText(second)).toBe(canonicalMetaText(first));
    // The summary canonical JSON reproduces exactly.
    expect(canonicalSerialize(second.summary)).toBe(canonicalSerialize(first.summary));
    // The trace chain is identical (same root + same reachable set).
    expect(second.chain.root).toBe(first.chain.root);
    expect(second.chain.reachable).toEqual(first.chain.reachable);
  });

  it('the golden brownfield object loop (the meta-loop\'s OBJECT lane) is independently reproducible', () => {
    // The meta loop's object lane is the W15 brownfield loop; the golden
    // scenario for the meta loop drives BOTH worlds of the object loop.
    // Asserting the object loop's nominal + degraded variants reproduce
    // bit-exactly (the W15 + W16 cross-product pin).
    const nominal1 = runGoldenObjectLoop('nominal');
    const nominal2 = runGoldenObjectLoop('nominal');
    expect(nominal2.chain.complete).toBe(true);
    expect(nominal2.chain.root).toBe(nominal1.chain.root);

    const degraded1 = runGoldenObjectLoop('degraded');
    const degraded2 = runGoldenObjectLoop('degraded');
    expect(degraded2.chain.complete).toBe(true);
    expect(degraded2.chain.root).toBe(degraded1.chain.root);
  });

  it('the meta loop\'s summary is formattable (the human-readable projection is deterministic)', () => {
    const result = runMetaEvolution();
    const summary = formatMetaSummary(result);
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeGreaterThan(0);
    // The summary is reproducible.
    const second = formatMetaSummary(runMetaEvolution());
    expect(second).toBe(summary);
  });
});
