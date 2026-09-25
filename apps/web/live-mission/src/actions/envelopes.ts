/**
 * Consequential action envelopes (Work Order P17-C).
 *
 * THE UI NEVER MUTATES STATE DIRECTLY: every consequential action the
 * live-mission surface offers is a typed ACTION REQUEST ENVELOPE in the
 * merged @sos-2/action-gateway's public raw-JSON shape (validateRequest
 * accepts exactly this). The envelope builders below are PURE functions
 * producing plain JSON; the mounted form POSTs them to the gateway
 * endpoint the architect wires (MOUNTING.md); the deterministic suite
 * (tests/real-observation) feeds THESE builders' output through the REAL
 * ActionGateway and pins:
 *
 *   - authority gates: a revoked/expired/never-held grant fails CLOSED
 *     (DENIED, executors never invoked, evidence emitted);
 *   - idempotency: replaying the same idempotencyKey returns the recorded
 *     original receipt (action.replayed), never a second execution;
 *   - the envelope carries NO authority fields (a smuggled authority key
 *     is a typed AUTHORITY_FIELD_SMUGGLED rejection — the gateway owns
 *     that vocabulary).
 *
 * Family coverage (the merged gateway's nine families):
 *   execution (summon body) -> 'body-lifecycle' (operation 'start')
 *   promotion               -> 'promotion'
 *   rollback                -> 'rollback'
 *   ASK resolution          -> the merged AskQueue resolve() contract
 *                              (no action-gateway family exists for asks;
 *                              the envelope below is the queue's input,
 *                              resolution authority is the HUMAN resolver)
 *   package composition     -> NO merged action family exists — honestly
 *                              linked to the Packages workspace instead of
 *                              fabricated (see live-mission-page.tsx).
 */

// ---------------------------------------------------------------------------
// Action-gateway envelopes (raw JSON, the validateRequest input shape)
// ---------------------------------------------------------------------------

export type ActionFamilyLiteral = 'commit' | 'push' | 'pull-request' | 'deployment' | 'configuration' | 'remediation' | 'promotion' | 'rollback' | 'body-lifecycle';

/** The raw ActionRequest shape (the gateway's public input). No authority fields — ever. */
export interface ActionRequestEnvelope {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly family: ActionFamilyLiteral;
  readonly actor: { readonly kind: 'human' | 'body' | 'system'; readonly id: string };
  readonly requestedAt: number;
  readonly targetRevision: { readonly kind: 'source'; readonly sha: string };
  readonly payload:
    | { readonly family: 'body-lifecycle'; readonly bodyLifecycle: { readonly bodyId: string; readonly operation: 'start' | 'pause' | 'resume' | 'cancel' | 'replace' } }
    | { readonly family: 'promotion'; readonly promotion: { readonly fromEnvironment: string; readonly toEnvironment: string; readonly sourceSha: string } }
    | { readonly family: 'rollback'; readonly rollback: { readonly deploymentId: string; readonly fromSourceSha: string; readonly toSourceSha: string; readonly reason: { readonly code: 'FAILED_VERIFICATION' | 'INCIDENT' | 'MANUAL_DIRECTIVE'; readonly detail: string } } };
}

/** Summon an execution body for the current work (family body-lifecycle, operation start). */
export function summonBodyEnvelope(input: {
  readonly actorId: string;
  readonly bodyId: string;
  readonly baseSha: string;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: number;
}): ActionRequestEnvelope {
  return {
    actionId: input.actionId,
    idempotencyKey: input.idempotencyKey,
    family: 'body-lifecycle',
    actor: { kind: 'human', id: input.actorId },
    requestedAt: input.requestedAt,
    targetRevision: { kind: 'source', sha: input.baseSha },
    payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: input.bodyId, operation: 'start' } },
  };
}

/** Promote a verified source revision between environments (family promotion). */
export function promotionEnvelope(input: {
  readonly actorId: string;
  readonly fromEnvironment: string;
  readonly toEnvironment: string;
  readonly sourceSha: string;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: number;
}): ActionRequestEnvelope {
  return {
    actionId: input.actionId,
    idempotencyKey: input.idempotencyKey,
    family: 'promotion',
    actor: { kind: 'human', id: input.actorId },
    requestedAt: input.requestedAt,
    targetRevision: { kind: 'source', sha: input.sourceSha },
    payload: { family: 'promotion', promotion: { fromEnvironment: input.fromEnvironment, toEnvironment: input.toEnvironment, sourceSha: input.sourceSha } },
  };
}

/** Roll back a deployment to a known source revision (family rollback — verified by the gateway's rollback verifier). */
export function rollbackEnvelope(input: {
  readonly actorId: string;
  readonly deploymentId: string;
  readonly fromSourceSha: string;
  readonly toSourceSha: string;
  readonly reasonCode: 'FAILED_VERIFICATION' | 'INCIDENT' | 'MANUAL_DIRECTIVE';
  readonly reasonDetail: string;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: number;
}): ActionRequestEnvelope {
  return {
    actionId: input.actionId,
    idempotencyKey: input.idempotencyKey,
    family: 'rollback',
    actor: { kind: 'human', id: input.actorId },
    requestedAt: input.requestedAt,
    targetRevision: { kind: 'source', sha: input.toSourceSha },
    payload: { family: 'rollback', rollback: { deploymentId: input.deploymentId, fromSourceSha: input.fromSourceSha, toSourceSha: input.toSourceSha, reason: { code: input.reasonCode, detail: input.reasonDetail } } },
  };
}

// ---------------------------------------------------------------------------
// The ASK resolution envelope (the merged AskQueue resolve() input)
// ---------------------------------------------------------------------------

/** The AskQueue.resolve input shape (resolution authority = the HUMAN resolver; the queue mints the DecisionRecord). */
export interface AskResolutionEnvelope {
  readonly entryId: string;
  readonly resolution: {
    readonly resolved_by: string;
    readonly chosen_alternative_id: string;
    readonly note: string;
    readonly provenance: readonly string[];
    readonly created_at: string;
  };
}

/** Resolve a pending ASK (human authority; the resolution becomes a Decision record). */
export function askResolutionEnvelope(input: {
  readonly entryId: string;
  readonly resolvedBy: string;
  readonly chosenAlternativeId: string;
  readonly note: string;
  readonly provenance: readonly string[];
  readonly createdAt: string;
}): AskResolutionEnvelope {
  return {
    entryId: input.entryId,
    resolution: {
      resolved_by: input.resolvedBy,
      chosen_alternative_id: input.chosenAlternativeId,
      note: input.note,
      provenance: [...input.provenance],
      created_at: input.createdAt,
    },
  };
}

/** The endpoint the mounted forms POST to (wired by the architect's integration pass). */
export const LIVE_ACTION_ENDPOINT = '/api/live-mission/actions';
