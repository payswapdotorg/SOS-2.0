/**
 * The promotion EVIDENCE gate — CURRENT, intervention-grade (for causal
 * claims), truthful, never simulated (Work Order W9;
 * spec/architecture.md §13, §14, §18; docs/assurance-model.md:
 * "Promotion requires current authority + assurance + evidence + compatible
 * current System State").
 *
 * THE RULES (each pinned by tests):
 *
 *   1. INTERVENTION-GRADE for causal claims (spec §18: "Intervention
 *      evidence outranks observational correlation for strong causal
 *      claims"): a candidate whose content asserts causal_claim requires at
 *      least one admissible record that is INTERVENTIONAL class, SUCCESS
 *      availability, about the candidate (subject_ref binding) and FRESH.
 *      Candidates that assert no causal claim still require CURRENT
 *      (fresh, SUCCESS) evidence about the candidate — observational class
 *      suffices for them (claiming less than intervention grade).
 *
 *   2. FRESHNESS is consumed from @sos-2/evidence's evaluateFreshness (the
 *      merged W3 authority — never re-implemented): stale windows and
 *      unknown provenance are NOT current evidence.
 *
 *   3. SIMULATED RECORDS NEVER SATISFY INTERVENTION REQUIREMENTS: any
 *      record carrying the simulation mark (simulated === true — the mark
 *      @sos-2/experiments' simulator stamps on every outcome) is rejected
 *      loudly with an explicit reason. Simulation is evaluation
 *      infrastructure, never intervention evidence
 *      (docs/implementation/TESTING-AND-EVIDENCE.md layer-6 semantics).
 *
 *   4. LLM-PRODUCED EVIDENCE IS NEVER AUTHORITATIVE (spec §18): records
 *      marked llm_output by the W3 producer discipline do not satisfy the
 *      evidence requirements of promotion.
 */

import {
  evaluateFreshness,
  validateEvidenceRecord,
} from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { isSimulatedRecord } from '@sos-2/experiments';
import type { CandidateStateFixture, ExperimentResultRecord } from '@sos-2/experiments';
import { RFC3339_PATTERN } from '@sos-2/semantic-spine';
import { PromotionError } from './errors.js';

/** What the evidence gate accepts: W3 evidence records or experiment result records (the latter are never evidence — simulated or not). */
export type PromotionEvidenceRecord = EvidenceRecordW3 | ExperimentResultRecord;

/** The evidence gate evaluation (total, deterministic, all reasons explicit). */
export interface EvidenceGateEvaluation {
  /** True iff the required evidence class for THIS candidate is satisfied by >= 1 current record. */
  satisfied: boolean;
  /** The evidence classes this candidate requires. */
  requires: 'INTERVENTIONAL' | 'OBSERVATIONAL_OR_INTERVENTIONAL';
  /** Ids of the records satisfying the requirement (fresh, success, subject-bound, admissible class). */
  satisfying: string[];
  /** Ids of simulated records that were rejected (never evidence). */
  rejected_simulated: string[];
  /** How many real (non-simulated) INTERVENTIONAL-class records about the candidate were considered (any availability/freshness). */
  real_interventional_considered: number;
  reasons: string[];
}

function isRfc3339(value: string): boolean {
  return RFC3339_PATTERN.test(value);
}

/**
 * Evaluate the promotion evidence gate for a candidate at instant `now`.
 *
 * Deterministic and total: every input record is classified and every
 * rejection carries an explicit reason. Throws PromotionError only on
 * malformed gate input (candidate/now).
 */
export function evaluateEvidenceGate(
  candidate: CandidateStateFixture,
  evidence: readonly PromotionEvidenceRecord[],
  now: string,
): EvidenceGateEvaluation {
  if (typeof now !== 'string' || !isRfc3339(now)) {
    throw new PromotionError(`now must be an RFC3339 timestamp, received: ${JSON.stringify(now)}`);
  }
  if (evidence !== undefined && evidence !== null && !Array.isArray(evidence)) {
    throw new PromotionError('evidence must be an array of evidence or experiment result records');
  }
  const records: readonly PromotionEvidenceRecord[] = evidence ?? [];
  const candidateId = candidate.envelope.id;
  const requiresIntervention = candidate.content.causal_claim === true;

  const satisfying: string[] = [];
  const rejectedSimulated: string[] = [];
  const reasons: string[] = [];
  let realInterventionalConsidered = 0;

  for (const record of records) {
    if (typeof record !== 'object' || record === null) {
      reasons.push('a non-object entry in the evidence input was ignored');
      continue;
    }
    // Rule 3: the simulation mark is checked FIRST — regardless of shape.
    if (isSimulatedRecord(record)) {
      const id =
        typeof (record as unknown as Record<string, unknown>)['id'] === 'string'
          ? ((record as unknown as Record<string, unknown>)['id'] as string)
          : '(no id)';
      rejectedSimulated.push(id);
      reasons.push(
        `record ${id} is marked simulated — simulation is EVALUATION infrastructure and never satisfies intervention evidence requirements`,
      );
      continue;
    }
    if (!validateEvidenceRecord(record)) {
      reasons.push(
        `record ${
          typeof (record as unknown as Record<string, unknown>)['id'] === 'string'
            ? ((record as unknown as Record<string, unknown>)['id'] as string)
            : '(no id)'
        } is not a well-formed W3 evidence record and was not counted (real experiment results must be minted as Evidence records through @sos-2/evidence first)`,
      );
      continue;
    }
    const evidenceRecord = record as EvidenceRecordW3;
    if (evidenceRecord.subject_ref !== candidateId) {
      reasons.push(
        `evidence record ${evidenceRecord.id} is about ${evidenceRecord.subject_ref}, not the candidate ${candidateId} — evidence must be subject-bound to the candidate`,
      );
      continue;
    }
    // Rule 4: LLM output is never authoritative evidence.
    if (evidenceRecord.llm_output) {
      reasons.push(
        `evidence record ${evidenceRecord.id} is LLM-produced (llm_output) — LLM output is never authoritative evidence or authorization (spec/architecture.md §18)`,
      );
      continue;
    }
    const isInterventional = evidenceRecord.evidence_class === 'INTERVENTIONAL';
    if (isInterventional) {
      realInterventionalConsidered += 1;
    }
    if (requiresIntervention && !isInterventional) {
      reasons.push(
        `evidence record ${evidenceRecord.id} is OBSERVATIONAL — the candidate asserts a causal claim, which requires intervention-grade evidence (spec/architecture.md §18)`,
      );
      continue;
    }
    if (evidenceRecord.availability !== 'SUCCESS') {
      reasons.push(
        `evidence record ${evidenceRecord.id} has availability ${evidenceRecord.availability} — only SUCCESS records satisfy promotion evidence`,
      );
      continue;
    }
    // Rule 2: freshness consumed from the merged W3 authority.
    const freshness = evaluateFreshness(evidenceRecord, { now });
    if (freshness.status !== 'FRESH') {
      reasons.push(
        `evidence record ${evidenceRecord.id} is not current: freshness ${freshness.status} (${freshness.reason})`,
      );
      continue;
    }
    satisfying.push(evidenceRecord.id);
    reasons.push(
      `evidence record ${evidenceRecord.id} is admissible: ${evidenceRecord.evidence_class}, SUCCESS, subject-bound to the candidate, FRESH at ${now}`,
    );
  }

  const satisfied = satisfying.length > 0;
  if (satisfied) {
    reasons.unshift(
      requiresIntervention
        ? `${satisfying.length} current intervention-grade SUCCESS record(s) about the candidate satisfy the evidence requirement`
        : `${satisfying.length} current SUCCESS record(s) about the candidate satisfy the evidence requirement (the candidate asserts no causal claim)`,
    );
  }
  return {
    satisfied,
    requires: requiresIntervention ? 'INTERVENTIONAL' : 'OBSERVATIONAL_OR_INTERVENTIONAL',
    satisfying,
    rejected_simulated: rejectedSimulated,
    real_interventional_considered: realInterventionalConsidered,
    reasons,
  };
}
