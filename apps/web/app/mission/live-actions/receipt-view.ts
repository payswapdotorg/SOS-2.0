/**
 * THE ACTION RECEIPT VIEW MODELS (Work Order P18-B — pure projections of
 * the typed endpoint outcomes into renderable view state).
 *
 * Pure, total, deterministic: every projection answers the six product
 * review questions (what / why / evidence / uncertainty / authority /
 * next — the P17-C LiveReviewCore the whole console shares), maps the
 * receipt statuses to the restrained semantic tones, and carries the
 * evidence ids verbatim. The DENIED and FAILED projections drive the
 * safe-failure UX: a denied action states that NOTHING was changed and
 * shows the exact authority reason; a failed action shows the typed
 * failure and whether it is retryable.
 */

import type { LiveActionEndpointResponse, RealExecutionRecord } from './submission';
import type { LiveReviewCore } from '../../../live-mission/src/view-state/live-mission-view';

/** The restrained semantic tone for a receipt status (mirrors the shell's WebStatusTone vocabulary). */
export type ReceiptTone = 'POSITIVE' | 'CAUTION' | 'NEGATIVE' | 'NEUTRAL' | 'EPISTEMIC';

export function receiptStatusTone(status: string): ReceiptTone {
  switch (status) {
    case 'SUCCEEDED':
      return 'POSITIVE';
    case 'DENIED':
      return 'NEGATIVE';
    case 'FAILED':
      return 'CAUTION';
    default:
      return 'EPISTEMIC';
  }
}

export function receiptStatusLabel(status: string): string {
  switch (status) {
    case 'SUCCEEDED':
      return 'SUCCEEDED — executed through the action gateway';
    case 'DENIED':
      return 'DENIED — authority failed closed, nothing was changed';
    case 'FAILED':
      return 'FAILED — a typed failure, honestly recorded';
    default:
      return status;
  }
}

export function outcomeHeadline(outcome: LiveActionEndpointResponse): string {
  switch (outcome.kind) {
    case 'executed':
      return outcome.receipt.status === 'SUCCEEDED'
        ? `The ${outcome.receipt.family} action was executed`
        : `The ${outcome.receipt.family} action was answered — ${outcome.receipt.status}`;
    case 'replayed':
      return `This exact action was already recorded — the original ${outcome.receipt.status} receipt is shown (idempotent replay)`;
    case 'rejected':
      return 'The action envelope was rejected before execution (never executed)';
    case 'ask-resolved':
      return 'The pending ask was resolved — a Decision record was minted';
    case 'ask-failed':
      return 'The ask resolution was rejected (typed failure)';
    case 'endpoint-error':
      return 'The submission was rejected (typed failure)';
  }
}

/** The six product review questions for a receipt (the P17-C review core). */
export function receiptReview(outcome: LiveActionEndpointResponse): LiveReviewCore {
  switch (outcome.kind) {
    case 'executed':
    case 'replayed': {
      const receipt = outcome.receipt;
      const denial = receipt.denial;
      const what =
        receipt.status === 'DENIED'
          ? `The ${receipt.family} action was DENIED at action time — authority failed closed and the executor was never invoked: nothing was changed.`
          : receipt.status === 'FAILED'
            ? `The ${receipt.family} action FAILED at ${receipt.failure?.operation ?? 'the executor'} — a typed failure; no success is claimed.`
            : `The ${receipt.family} action was executed at ${new Date(receipt.executedAt).toISOString()}.`;
      const why =
        denial !== null
          ? `${denial.reason}: ${denial.detail}`
          : receipt.failure !== null
            ? `${receipt.failure.errorType} at ${receipt.failure.operation} — ${receipt.failure.message}`
            : 'Authority was re-evaluated at action time through the merged action gateway (a current grant was held) and the executor seam answered.';
      const evidence = [...receipt.evidenceIds];
      const uncertainty =
        receipt.rollbackVerification !== null
          ? `Rollback verification: ${receipt.rollbackVerification.verdict}${
              receipt.rollbackVerification.limitation !== null ? ` — ${receipt.rollbackVerification.limitation}` : ''
            }${outcome.limitations.length > 0 ? ` Scope: ${outcome.limitations.join(' ')}` : ''}`
          : outcome.limitations.length > 0
            ? outcome.limitations.join(' ')
            : 'No residual uncertainty recorded on this receipt.';
      const authority =
        denial !== null && denial.authority !== null
          ? `${denial.authority.reason} (grant ${denial.authority.grantId ?? 'none'}) — ${denial.authority.detail}`
          : 'A current grant was held at action time (re-evaluated by the gateway; the envelope itself carries no authority).';
      const next =
        receipt.status === 'DENIED'
          ? 'The operator can extend the operator grant declaration (the LIVE_MISSION_GRANTS env — names only) or start/resume a mission; a denied action changes nothing.'
          : receipt.status === 'FAILED'
            ? receipt.failure?.retryable === true
              ? 'The failure is retryable — the same envelope can be resubmitted once the provider answers.'
              : 'The failure is not retryable — review the typed failure above.'
            : 'Review the evidence records and continue the mission from the live mission surface.';
      return { what, why, evidence, uncertainty, authority, next };
    }
    case 'rejected':
      return {
        what: `The envelope was rejected (${outcome.rejection.code} at ${outcome.rejection.field === '' ? 'the envelope' : outcome.rejection.field}) before any authority evaluation or execution.`,
        why: outcome.rejection.detail,
        evidence: [],
        uncertainty: 'Nothing was executed — there is no execution evidence for a rejected envelope.',
        authority: 'The gateway carries no authority fields of its own; a rejected envelope never reaches an authority evaluation.',
        next: 'Fix the envelope and resubmit (the frozen forms and the P17-C builders always produce valid envelopes).',
      };
    case 'ask-resolved':
      return {
        what: `The pending ask ${outcome.resolution.entryId} was resolved by ${outcome.resolution.resolvedBy}: alternative ${outcome.resolution.chosenAlternativeId} was chosen.`,
        why: `The merged AskQueue mints the Decision record ${outcome.resolution.decisionRef} (action ${outcome.resolution.action}) bound to the ask's exact input digest.`,
        evidence: [outcome.resolution.decisionRef],
        uncertainty: outcome.resolution.queue.scopeNote,
        authority: 'The resolution authority is the HUMAN resolver (the queue mints the record; it never widens authority on its own).',
        next: 'The decision is recorded; continue the mission from the live mission surface.',
      };
    case 'ask-failed':
      return {
        what: `The ask resolution was rejected: ${outcome.error.code}.`,
        why: outcome.error.message,
        evidence: [],
        uncertainty: 'No decision was minted.',
        authority: 'Ask resolution authority remains with the human resolver.',
        next: 'A resolved entry stays resolved (terminal) — a NEW ask for a changed input has a different digest.',
      };
    case 'endpoint-error':
      return {
        what: `The submission was rejected: ${outcome.error.code}.`,
        why: outcome.error.message,
        evidence: [],
        uncertainty: 'Nothing was executed.',
        authority: 'No authority was evaluated.',
        next: 'Submit a typed envelope (the form field "action" or the JSON body { "action": … }).',
      };
  }
}

/** The real-execution facts as renderable rows (provider states + transcript + facts). */
export function executionRows(execution: RealExecutionRecord | null): {
  readonly mode: string;
  readonly providers: readonly { readonly label: string; readonly state: string; readonly detail: string; readonly lastError: string | null }[];
  readonly requests: readonly { readonly label: string; readonly status: number }[];
  readonly facts: readonly { readonly label: string; readonly value: string }[];
} {
  if (execution === null) {
    return { mode: 'none', providers: [], requests: [], facts: [] };
  }
  return {
    mode: execution.mode,
    providers: execution.providers.map((provider) => ({ label: provider.provider, state: provider.state, detail: provider.detail, lastError: provider.lastError })),
    requests: execution.requests.map((request) => ({ label: `${request.method} ${request.path}`, status: request.status })),
    facts: Object.entries(execution.facts).map(([label, value]) => ({ label, value })),
  };
}
