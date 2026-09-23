import { contentAddress } from '@sos-2/action-gateway';
import type { Timestamp } from '@sos-2/action-gateway';
import type { StructuredFailure, VerdictStatus } from '@sos-2/evaluator';
import type { EvaluationSummary } from './aggregate.js';

/**
 * The P6 reasoning-broker discipline, mirrored as a port: reasoning output is
 * ADVISORY ONLY. It is labelled, flagged non-authoritative, recorded in a
 * separate ledger, and never enters verdicts, failure evidence, or summaries.
 */
export interface AdvisoryNote {
  readonly label: 'ADVISORY_REASONING';
  readonly nonAuthoritative: true;
  readonly advice: string;
  readonly suggestedVerdict: VerdictStatus | null;
}

export interface ReasoningPort {
  triage(input: { readonly failures: readonly StructuredFailure[]; readonly summary: EvaluationSummary }): AdvisoryNote;
}

export interface AdvisoryEntry {
  readonly entryId: string;
  readonly note: AdvisoryNote;
  readonly recordedAt: Timestamp;
}

export function recordAdvisory(note: AdvisoryNote, at: Timestamp): AdvisoryEntry {
  if (note.label !== 'ADVISORY_REASONING' || note.nonAuthoritative !== true) {
    throw new TypeError('reasoning output without the ADVISORY_REASONING / non-authoritative label is rejected');
  }
  return { entryId: contentAddress(note, 'advisory'), note, recordedAt: at };
}
