/**
 * @sos-2/brownfield-harness — the runnable end-to-end W15 harness run
 * (imports only; ZERO domain logic).
 *
 * Executes the brownfield optimization loop over the golden scenario in
 * BOTH worlds:
 *   - nominal:  the healthy simulated experiment -> the honest,
 *     evidence-gated EXPERIMENT decision (no real intervention evidence
 *     exists in a deterministic simulation — promotion stays gated);
 *   - degraded: the error-rate guardrail breaches -> ROLLBACK decision
 *     with the bounded recovery declaration, failure memory and the
 *     rollback event (the ROLLBACK path variant).
 *
 * Deterministic: fixed seed, single caller-supplied instant, fresh
 * registry + learning stores per run — identical runs are byte-identical
 * (pinned by the committed golden-run fixture and the test suite).
 */

import {
  GOLDEN_BROWNFIELD_SCENARIO,
  buildBrownfieldLoopInput,
  runBrownfieldLoop,
  formatBrownfieldSummary,
} from '@sos-2/brownfield';
import type { BrownfieldLoopResult } from '@sos-2/brownfield';

/** One harness execution (both variants; pure data + the printed output). */
export interface HarnessRun {
  /** The exact stdout the harness prints (deterministic). */
  output: string;
  /** True iff BOTH loop trace chains are complete (exit code semantics). */
  ok: boolean;
  /** The full loop results (pure JSON). */
  results: {
    nominal: BrownfieldLoopResult;
    degraded: BrownfieldLoopResult;
  };
}

/** Run the golden brownfield harness (deterministic, no I/O). */
export function runHarness(): HarnessRun {
  const nominal = runBrownfieldLoop(buildBrownfieldLoopInput(GOLDEN_BROWNFIELD_SCENARIO, 'nominal').input);
  const degraded = runBrownfieldLoop(buildBrownfieldLoopInput(GOLDEN_BROWNFIELD_SCENARIO, 'degraded').input);
  const ok = nominal.chain.complete && degraded.chain.complete;
  const output = [
    'SOS 2.0 Brownfield Optimization Loop — end-to-end harness (golden scenario: merch-catalog-legacy)',
    '',
    '--- world 1/2: NOMINAL (healthy simulated experiment) ---',
    formatBrownfieldSummary(nominal),
    '',
    '--- world 2/2: DEGRADED (guardrail breach -> ROLLBACK path variant) ---',
    formatBrownfieldSummary(degraded),
    '',
    `harness verdict: ${ok ? 'COMPLETE — both loops form one connected trace chain from ImplementationModel to the learned ecology updates (exit 0)' : 'BROKEN — a trace chain is incomplete (exit non-zero)'}`,
  ].join('\n');
  return { output, ok, results: { nominal, degraded } };
}
