/**
 * Brownfield stage 2 — COMPETING RECOVERY (W15).
 *
 * @sos-2/recovery produces the ArchitectureGraph hypotheses from the
 * observed ImplementationModel. When the evidence is AMBIGUOUS the loop
 * REQUIRES a competing set (>= 2 hypotheses, each with provenance) —
 * collapsing ambiguous evidence to a single architecture is a REJECTED
 * failure (assertCompetingHypotheses, pinned by negative tests). The
 * competing set is retained in full; the loop deterministically SELECTS one
 * working hypothesis to evolve (recovery-order first) without discarding
 * the alternatives.
 *
 * Links: every hypothesis carries its own DERIVED_FROM + OBSERVES links to
 * the ImplementationModel (minted by @sos-2/recovery — collected here).
 */

import { recoverArchitectureHypotheses } from '@sos-2/recovery';
import type { RecoveryHypothesis, RecoveryResult } from '@sos-2/recovery';
import type { ImplementationModel } from '@sos-2/semantic-spine';
import { BrownfieldError } from './errors.js';
import type { BrownfieldLoopInput } from './input.js';
import type { RecoveryStageRecord } from './stages.js';

/**
 * The competing-hypotheses guard: ambiguous evidence must yield >= 2
 * retained hypotheses. Exported for negative tests and console surfacing.
 */
export function assertCompetingHypotheses(ambiguityDetected: boolean, hypothesisCount: number): void {
  if (ambiguityDetected && hypothesisCount < 2) {
    throw new BrownfieldError(
      'AMBIGUITY_COLLAPSED',
      `ambiguous evidence was collapsed to ${hypothesisCount} hypothesis(es) — brownfield recovery must retain COMPETING hypotheses (spec/architecture.md section 6; docs/code-to-architecture.md)`,
    );
  }
}

/** Everything stage 2 produces. */
export interface RecoveryStageOutput {
  record: RecoveryStageRecord;
  recovery: RecoveryResult;
  selectedHypothesis: RecoveryHypothesis;
}

/** The deterministic selection rule (documented in the stage record). */
export const RECOVERY_SELECTION_RULE =
  'first hypothesis in @sos-2/recovery canonical order (assignment-vector-major, strategy within vector); the full competing set is retained';

/** Run the competing recovery stage (deterministic, pure). */
export function runRecoveryStage(
  input: BrownfieldLoopInput,
  implementationModel: ImplementationModel,
  systemStateAnchor: string,
): RecoveryStageOutput {
  let recovery: RecoveryResult;
  try {
    recovery = recoverArchitectureHypotheses({
      model: implementationModel,
      projects_system_state: { system_state_id: systemStateAnchor, version: 1 },
      provenance: [...input.provenance, 'brownfield:competing-recovery'],
      created_at: input.now,
      config: {
        authority_ref: input.authority_ref,
      },
    });
  } catch (cause) {
    throw new BrownfieldError('RECOVERY_FAILED', `architecture recovery failed: ${(cause as Error).message}`);
  }

  // THE COMPETING-HYPOTHESES INVARIANT (W15): ambiguity never collapses.
  assertCompetingHypotheses(recovery.ambiguity_detected, recovery.hypotheses.length);

  const selected = recovery.hypotheses[0];
  if (selected === undefined) {
    throw new BrownfieldError('RECOVERY_FAILED', 'recovery produced no hypotheses (the snapshot was rejected by the recovery contract)');
  }

  const strategies = [...new Set(recovery.hypotheses.map((hypothesis) => hypothesis.strategy))].sort();
  const links = recovery.hypotheses.flatMap((hypothesis) => hypothesis.links);

  const record: RecoveryStageRecord = {
    stage: 'RECOVERY',
    input_refs: [implementationModel.id],
    output_refs: recovery.hypotheses.map((hypothesis) => hypothesis.artifact.envelope.id),
    links,
    hypothesis_ids: recovery.hypotheses.map((hypothesis) => hypothesis.artifact.envelope.id),
    hypothesis_count: recovery.hypotheses.length,
    ambiguity_detected: recovery.ambiguity_detected,
    strategies,
    markers: recovery.ambiguities,
    selected_hypothesis_id: selected.artifact.envelope.id,
    selection_rule: RECOVERY_SELECTION_RULE,
    competing: recovery.ambiguity_detected ? recovery.hypotheses.length >= 2 : recovery.hypotheses.length >= 1,
  };

  return { record, recovery, selectedHypothesis: selected };
}
