/**
 * THE LIVE ACTION SUBMISSION CONTRACT (Work Order P18-B — integration
 * seam): the typed shapes the /api/live-mission/actions endpoint accepts
 * and returns, plus the DETERMINISTIC IDENTITY COMPLETION that makes the
 * frozen P17-C UI forms idempotent typed submissions.
 *
 * THE FROZEN FORMS (action-panel.tsx) POST their typed envelopes WITHOUT
 * actionId / idempotencyKey / requestedAt — the P17-C design anticipated
 * exactly this integration ("the endpoint the architect wires completes
 * the submission"). The completion below derives the missing identity
 * DETERMINISTICALLY from the envelope's own content (the action
 * gateway's contentAddress discipline): the same envelope produces the
 * SAME idempotency key on every submission, so double-submitting a form
 * is a REPLAY of the recorded original receipt — never a second
 * execution. A DIFFERENT intent (a different actor, target revision or
 * payload) is a different action with a different key.
 *
 * Envelopes that already carry their identity (programmatic submissions —
 * the P17-C builders' full output) are used AS-IS: the endpoint never
 * overrides a caller-supplied identity.
 */

import { contentAddress } from '@sos-2/action-gateway';
import type { Timestamp } from '@sos-2/action-gateway';
import type { ActionReceipt } from '@sos-2/action-gateway';
import type { ActionValidationRejection } from '@sos-2/action-gateway';

// ---------------------------------------------------------------------------
// The action submission (the gateway envelope, possibly identity-incomplete)
// ---------------------------------------------------------------------------

/** The identity-bearing content of an action envelope (everything but the identity fields). */
function identityRelevantContent(envelope: Record<string, unknown>): Record<string, unknown> {
  return {
    family: envelope['family'],
    actor: envelope['actor'],
    targetRevision: envelope['targetRevision'],
    payload: envelope['payload'],
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export interface CompletedSubmission {
  readonly envelope: Record<string, unknown>;
  readonly derived: { readonly actionId: boolean; readonly idempotencyKey: boolean; readonly requestedAt: boolean };
}

/**
 * Complete an action envelope's identity (deterministic, content-derived).
 * The raw value must already be a plain object (the caller checks).
 */
export function completeActionEnvelope(raw: Record<string, unknown>, now: Timestamp): CompletedSubmission {
  const digest = contentAddress(identityRelevantContent(raw), 'live-action');
  const actionIdSupplied = typeof raw['actionId'] === 'string' && (raw['actionId'] as string).length > 0;
  const idempotencyKeySupplied = typeof raw['idempotencyKey'] === 'string' && (raw['idempotencyKey'] as string).length > 0;
  const requestedAtSupplied = isFiniteNumber(raw['requestedAt']);
  return {
    envelope: {
      ...raw,
      actionId: actionIdSupplied ? (raw['actionId'] as string) : `live-action:${String(raw['family'])}:${digest.slice('live-action:'.length)}`,
      idempotencyKey: idempotencyKeySupplied ? (raw['idempotencyKey'] as string) : `live-action-idem:${digest.slice('live-action:'.length)}`,
      requestedAt: requestedAtSupplied ? (raw['requestedAt'] as number) : now,
    },
    derived: {
      actionId: !actionIdSupplied,
      idempotencyKey: !idempotencyKeySupplied,
      requestedAt: !requestedAtSupplied,
    },
  };
}

// ---------------------------------------------------------------------------
// The ASK resolution submission (the merged AskQueue resolve() input)
// ---------------------------------------------------------------------------

/** The AskQueue.resolve input shape (resolution authority = the HUMAN resolver). */
export interface AskResolutionSubmission {
  readonly entryId: string;
  readonly resolution: {
    readonly resolved_by: string;
    readonly chosen_alternative_id: string;
    readonly note: string;
    readonly provenance: readonly string[];
    readonly created_at: string;
  };
}

/** Complete an ask resolution submission: derive the receipt-time fields the form does not carry. */
export function completeAskResolution(input: {
  readonly entryId: string;
  readonly resolvedBy: string;
  readonly chosenAlternativeId: string;
  readonly note: string;
  readonly provenance?: readonly string[];
  readonly createdAt?: string;
  readonly nowRfc3339: string;
}): AskResolutionSubmission {
  const provenance = input.provenance !== undefined && input.provenance.length > 0 ? [...input.provenance] : [`human:${input.resolvedBy}`, 'surface:live-mission'];
  const createdAt =
    input.createdAt !== undefined && RFC3339_PATTERN.test(input.createdAt) ? input.createdAt : input.nowRfc3339;
  return {
    entryId: input.entryId,
    resolution: {
      resolved_by: input.resolvedBy,
      chosen_alternative_id: input.chosenAlternativeId,
      note: input.note,
      provenance,
      created_at: createdAt,
    },
  };
}

/** The RFC3339 pattern (mirrors the merged @sos-2/semantic-spine contract). */
export const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// ---------------------------------------------------------------------------
// The typed endpoint responses (what the endpoint returns)
// ---------------------------------------------------------------------------

/** One honest provider-state row (the P17-C four-state machine, machine-checkable). */
export interface ProviderStateRow {
  readonly provider: string;
  readonly state: 'CONNECTED' | 'UNKNOWN' | 'UNAVAILABLE' | 'DEGRADED';
  readonly detail: string;
  readonly lastError: string | null;
  readonly apiRevision: string | null;
  /** The env NAME the credential came from (names only — never values). */
  readonly credentialEnv: string | null;
}

/** One transcript row (method + path + status — never credentials, never bodies). */
export interface TranscriptRow {
  readonly provider: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

/** The real-execution record attached to a receipt: what REALLY happened at the providers. */
export interface RealExecutionRecord {
  readonly at: string;
  readonly family: string;
  readonly mode: 'real' | 'reference';
  readonly providers: readonly ProviderStateRow[];
  readonly requests: readonly TranscriptRow[];
  /** The real provider facts this execution is bound to (ids, shas, models — never credentials). */
  readonly facts: Readonly<Record<string, string>>;
}

/** The minted ASK resolution receipt (a real Decision record through the merged queue). */
export interface AskResolutionReceipt {
  readonly entryId: string;
  readonly decisionRef: string;
  readonly action: string;
  readonly resolvedBy: string;
  readonly chosenAlternativeId: string;
  readonly note: string;
  readonly createdAt: string;
  readonly provenance: readonly string[];
  readonly queue: { readonly pending: number; readonly total: number; readonly scopeNote: string };
  readonly at: string;
}

/** Every typed outcome the endpoint can answer with (never a silent 5xx for typed submissions). */
export type LiveActionEndpointResponse =
  | { readonly kind: 'executed'; readonly replayed: false; readonly receipt: ActionReceipt; readonly execution: RealExecutionRecord | null; readonly limitations: readonly string[]; readonly at: string }
  | { readonly kind: 'replayed'; readonly replayed: true; readonly receipt: ActionReceipt; readonly execution: RealExecutionRecord | null; readonly limitations: readonly string[]; readonly at: string }
  | { readonly kind: 'rejected'; readonly rejection: ActionValidationRejection }
  | { readonly kind: 'ask-resolved'; readonly resolution: AskResolutionReceipt }
  | { readonly kind: 'ask-failed'; readonly error: { readonly code: string; readonly message: string } }
  | { readonly kind: 'endpoint-error'; readonly error: { readonly code: string; readonly message: string } };

/** The HTTP status for each typed outcome (denials and failures are honest outcomes, not transport errors). */
export function statusFor(outcome: LiveActionEndpointResponse): number {
  switch (outcome.kind) {
    case 'executed':
    case 'replayed':
    case 'ask-resolved':
      return 200;
    case 'rejected':
    case 'ask-failed':
    case 'endpoint-error':
      return 400;
  }
}
