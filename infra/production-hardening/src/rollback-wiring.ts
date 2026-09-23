/**
 * Deployment rollback wiring (Work Order P14).
 *
 * The rollback path wires through the P9 ROLLBACK ACTION FAMILY: every
 * production rollback is a `rollback` action through the authority-
 * gated gateway (stale/expired authority fails closed; the rollback
 * produces evidence; the gateway re-evaluates CURRENT authority at
 * action time — never planning-time grants).
 *
 * This module declares the typed WIRING between a rollback decision and
 * the P9 rollback action payload. The payload vocabulary is ALIGNED
 * with the merged P9 module (packages/action-gateway/src/actions.ts —
 * RollbackPayload: deploymentId, fromSourceSha, toSourceSha, reason
 * {code: FAILED_VERIFICATION | INCIDENT | MANUAL_DIRECTIVE, detail}) as
 * an INDEPENDENT typed vocabulary — document alignment only, no import
 * (pinned by the acceptance suite, which imports the merged P9 module
 * directly and validates a wiring-built payload through the REAL P9
 * validateRequest).
 *
 * PINNED RULES:
 *   - rollback reason codes are exactly the P9 vocabulary;
 *   - source shas are exact 40-hex (the exact-head rule);
 *   - the wiring record carries the authority context it will be
 *     submitted under (the gateway re-evaluates at action time — the
 *     wiring never grants anything).
 *
 * Determinism: pure functions over injected wiring records.
 */

import { HardeningContractError, isNonEmptyString, isPlainObject } from './tiers.ts';

/** The P9-aligned rollback reason codes. */
export const ROLLBACK_REASON_CODES = ['FAILED_VERIFICATION', 'INCIDENT', 'MANUAL_DIRECTIVE'] as const;
export type RollbackReasonCode = (typeof ROLLBACK_REASON_CODES)[number];

/** Exact 40-hex source revision (the exact-head rule). */
export const SHA_PATTERN = /^[0-9a-f]{40}$/;

/** One rollback wiring declaration (what will be submitted, and under what authority context). */
export interface RollbackWiringRecord {
  readonly environment: 'preview' | 'production';
  /** The deployment being rolled back (provider-assigned id). */
  readonly deploymentId: string;
  /** The source sha currently deployed. */
  readonly fromSourceSha: string;
  /** The source sha to roll back to. */
  readonly toSourceSha: string;
  readonly reason: { readonly code: RollbackReasonCode; readonly detail: string };
  /** The actor that will submit the action (authority is re-evaluated by the gateway at action time). */
  readonly actor: { readonly kind: 'body' | 'human' | 'system'; readonly id: string };
}

/** The P9-shaped rollback action payload (document-aligned vocabulary). */
export interface RollbackActionPayload {
  readonly family: 'rollback';
  readonly rollback: {
    readonly deploymentId: string;
    readonly fromSourceSha: string;
    readonly toSourceSha: string;
    readonly reason: { readonly code: RollbackReasonCode; readonly detail: string };
  };
}

/** Validate one rollback wiring record (fail-closed). */
export function assertValidRollbackWiring(wiring: RollbackWiringRecord): void {
  if (!isPlainObject(wiring)) {
    throw new HardeningContractError('rollback wiring record must be an object');
  }
  if (wiring.environment !== 'preview' && wiring.environment !== 'production') {
    throw new HardeningContractError(`rollback wiring environment must be preview | production, received: ${JSON.stringify(wiring.environment)}`);
  }
  if (!isNonEmptyString(wiring.deploymentId)) {
    throw new HardeningContractError('rollback wiring deploymentId must be a non-empty string');
  }
  if (typeof wiring.fromSourceSha !== 'string' || !SHA_PATTERN.test(wiring.fromSourceSha)) {
    throw new HardeningContractError(`rollback wiring fromSourceSha must be exact 40-hex, received: ${JSON.stringify(wiring.fromSourceSha)}`);
  }
  if (typeof wiring.toSourceSha !== 'string' || !SHA_PATTERN.test(wiring.toSourceSha)) {
    throw new HardeningContractError(`rollback wiring toSourceSha must be exact 40-hex, received: ${JSON.stringify(wiring.toSourceSha)}`);
  }
  if (wiring.fromSourceSha === wiring.toSourceSha) {
    throw new HardeningContractError('rollback wiring fromSourceSha and toSourceSha must differ (a no-op rollback is malformed)');
  }
  const reason = wiring.reason;
  if (!isPlainObject(reason) || !(ROLLBACK_REASON_CODES as readonly string[]).includes(reason.code)) {
    throw new HardeningContractError(`rollback reason code must be one of ${ROLLBACK_REASON_CODES.join(' | ')}, received: ${JSON.stringify(reason)}`);
  }
  if (!isNonEmptyString(reason.detail)) {
    throw new HardeningContractError('rollback reason detail must be a non-empty string');
  }
  const actor = wiring.actor;
  if (!isPlainObject(actor) || (actor.kind !== 'body' && actor.kind !== 'human' && actor.kind !== 'system') || !isNonEmptyString(actor.id)) {
    throw new HardeningContractError('rollback wiring actor must be { kind: body | human | system, id }');
  }
}

/**
 * Build the P9-shaped rollback action payload from a validated wiring
 * record. The payload carries NO authority fields (the P9 envelope
 * rule); the gateway re-evaluates authority at action time.
 */
export function wiringToRollbackPayload(wiring: RollbackWiringRecord): RollbackActionPayload {
  assertValidRollbackWiring(wiring);
  return {
    family: 'rollback',
    rollback: {
      deploymentId: wiring.deploymentId,
      fromSourceSha: wiring.fromSourceSha,
      toSourceSha: wiring.toSourceSha,
      reason: { code: wiring.reason.code, detail: wiring.reason.detail },
    },
  };
}
