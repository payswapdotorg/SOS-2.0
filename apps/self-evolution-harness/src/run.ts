/**
 * The self-evolution harness run (W16) — ZERO domain logic: everything is
 * imported from @sos-2/meta-evolution.
 *
 * The harness executes the golden self-evolution scenario deterministically:
 *   - the OBJECT loop over the W15 golden fixtures in BOTH worlds (the
 *     nominal world runs inside the meta loop's separation probe; the
 *     degraded world runs standalone — guardrail breach -> ROLLBACK);
 *   - the META loop executing BOTH paths: HEALTHY (governance-preserving
 *     MetaChange measured, decisioned, promoted, revision applied) and
 *     ADVERSARIAL (governance-weakening proposal rejected; effectiveness-
 *     negative change rolled back AND retained in liability memory), plus
 *     the first-class ASK path.
 *
 * The verdict gate (exit 0) requires EVERY stage to have succeeded and the
 * trace chains to be complete: the object chains, the meta chain, the guard
 * rejection, the promote/rollback/ask decisions, the exact restore, and the
 * retained failure.
 */

import {
  buildGoldenMetaInput,
  runGoldenObjectLoop,
  runMetaEvolutionLoop,
  formatMetaSummary,
} from '@sos-2/meta-evolution';
import type { MetaEvolutionLoopResult } from '@sos-2/meta-evolution';
import type { BrownfieldLoopResult } from '@sos-2/meta-evolution';

export interface HarnessRun {
  output: string;
  ok: boolean;
  results: {
    objectNominalProbe: MetaEvolutionLoopResult;
    objectDegraded: BrownfieldLoopResult;
    meta: MetaEvolutionLoopResult;
  };
}

/** Presentation-only projection of one object world (formatting imported data). */
function objectWorldLines(label: string, world: { summary: BrownfieldLoopResult['summary']; decision: string; chainComplete: boolean; traceLinks: number }): string[] {
  const summary = world.summary;
  return [
    `--- object world ${label}: ${summary.system_name} @ ${summary.source_revision.slice(0, 12)} ---`,
    `ingested: ${summary.ingested.modules} modules, ${summary.ingested.dependencies} dependencies, ${summary.ingested.interfaces} interfaces, ${summary.ingested.runtime_observations} runtime observations`,
    `hypotheses: ${summary.hypotheses.count} (ambiguity: ${summary.hypotheses.ambiguity_detected ? 'yes' : 'no'}) | retrieved: ${summary.retrieved.candidates} candidates across ${summary.retrieved.families.length} families`,
    `candidate: ${summary.candidate.target_component} -> ${summary.candidate.replacement_component} (package ${summary.candidate.package_id.slice(0, 30)}…, family ${summary.candidate.family})`,
    `assurance: ${summary.assurance.verdict} | experiment: ${summary.experiment.overall_availability} (SIMULATED, seed ${summary.experiment.seed}) | decision: ${world.decision}`,
    `learned: ${summary.learned.memory_entries} memory entries, transfer ${summary.learned.transfer_outcome}, ${summary.learned.ecology_packages} ecology packages updated`,
    `trace chain: ${world.chainComplete ? 'COMPLETE' : 'BROKEN'} (${world.traceLinks} links)`,
  ];
}

/** Run the complete harness (deterministic, pure). */
export function runHarness(): HarnessRun {
  // 1. The META loop (its separation stage runs the nominal object probe).
  const meta = runMetaEvolutionLoop(buildGoldenMetaInput().input);

  // 2. The degraded object world (the W15 golden adversarial object variant).
  const objectDegraded = runGoldenObjectLoop('degraded');

  // 3. The verdict gate: EVERY stage succeeded + EVERY trace chain complete.
  const separation = meta.stages.separation;
  const guard = meta.stages.guard;
  const decisions = meta.stages.decision;
  const rollback = meta.stages.rollback;
  const liability = meta.stages.liability;
  const ok =
    meta.chain.complete &&
    objectDegraded.chain.complete &&
    separation.object_probe.chain_complete &&
    separation.conflation_rejections === 2 &&
    guard.rejected_count === 1 &&
    guard.passed_count === 3 &&
    decisions.promote_count === 1 &&
    decisions.rollback_count === 1 &&
    decisions.ask_count === 1 &&
    rollback.rollbacks.length === 1 &&
    rollback.rollbacks.every((entry) => entry.restore_exact) &&
    liability.failures.length === 1 &&
    meta.summary.retained_failures.penalty_demonstrated;

  const lines = [
    'SOS 2.0 Self-Evolution + Meta-Adaptation Harness — golden self-evolution scenario (fixed seed, single instant)',
    '',
    ...objectWorldLines('1/2 (nominal, via the meta loop separation probe)', {
      summary: meta.artifacts.object_loop_summary,
      decision: separation.object_probe.decision,
      chainComplete: separation.object_probe.chain_complete,
      traceLinks: separation.object_probe.trace_links,
    }),
    '',
    ...objectWorldLines('2/2 (degraded, standalone object run)', {
      summary: objectDegraded.summary,
      decision: objectDegraded.stages.promotion.decision,
      chainComplete: objectDegraded.chain.complete,
      traceLinks: objectDegraded.trace.length,
    }),
    '',
    '--- META loop (self-evolution, both paths + first-class ASK) ---',
    formatMetaSummary(meta),
    '',
    `harness verdict: ${ok ? 'COMPLETE — every stage succeeded, the governance guard rejected the weakening proposal, the regressive change rolled back with an exact restore and retained failure memory, the healthy change was promoted, the org-wide change is pending authority (ASK), and every trace chain is complete (exit 0)' : 'BROKEN — one or more stages or trace chains failed (exit 1)'}`,
  ];

  return {
    output: lines.join('\n'),
    ok,
    results: {
      objectNominalProbe: meta,
      objectDegraded,
      meta,
    },
  };
}
