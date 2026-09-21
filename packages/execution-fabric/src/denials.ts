/**
 * Typed fabric denials (Work Order P5).
 *
 * A denial means THE OPERATION NEVER RAN — refusing-to-run and
 * running-and-failing are distinct facts (the W12 discipline). Every
 * refusal path through the fabric answers one of these typed denials,
 * never a silent absence-of-failure:
 *
 *   TASK_NOT_FOUND           unknown task id
 *   TASK_NOT_ACTIVE          the task is not in an executable state
 *   LEASE_NOT_HELD           the task holds no body lease
 *   LEASE_DENIED             the fail-closed lease gate refused (carries
 *                            the broker's structured LeaseDenial)
 *   AUTHORITY_GRANT_ABSENT   the task carries no grant refs —
 *                            consequential operations require authority
 *   AUTHORITY_GRANT_MISSING  a referenced grant is not in the durable
 *                            authority store (a forged/minted grant
 *                            reference resolves to nothing)
 *   AUTHORITY_GRANT_INVALID  the stored grant failed authority evaluation
 *                            (malformed/indeterminate — loud)
 *   AUTHORITY_GRANT_EXPIRED  the current grant head is EXPIRED at the
 *                            evaluation point (W12: expired never authorizes)
 *   AUTHORITY_GRANT_REVOKED  the current grant head is REVOKED (W12)
 *   OPERATION_UNSUPPORTED    the binding capability advertisement does not
 *                            carry this operation (explicit, typed)
 *   OPERATION_INVALID        the operation request shape is invalid —
 *                            INCLUDING injected authority keys (a body or
 *                            an attacker cannot smuggle grants onto the
 *                            operation surface)
 *   INVALID_TASK_INPUT       a task-level input failed validation (e.g. a
 *                            body id where a semantic ref belongs)
 *   NO_BODY_AVAILABLE        no body matches the requirements
 */

import type { LeaseDenial } from '@sos-2/body-broker';

export const FABRIC_DENIAL_CODES = [
  'TASK_NOT_FOUND',
  'TASK_NOT_ACTIVE',
  'LEASE_NOT_HELD',
  'LEASE_DENIED',
  'AUTHORITY_GRANT_ABSENT',
  'AUTHORITY_GRANT_MISSING',
  'AUTHORITY_GRANT_INVALID',
  'AUTHORITY_GRANT_EXPIRED',
  'AUTHORITY_GRANT_REVOKED',
  'OPERATION_UNSUPPORTED',
  'OPERATION_INVALID',
  'INVALID_TASK_INPUT',
  'NO_BODY_AVAILABLE',
] as const;

export type FabricDenialCode = (typeof FABRIC_DENIAL_CODES)[number];

/** The typed denial record (structured, deterministic reasons). */
export interface FabricDenial {
  readonly code: FabricDenialCode;
  readonly reason: string;
  /** The task the refusal concerns, when known. */
  readonly task_id: string | null;
  /** The grant reference the refusal concerns, when known. */
  readonly grant_ref: string | null;
  /** The operation the refusal concerns, when known. */
  readonly operation: string | null;
  /** The structured lease denial for LEASE_DENIED (fail-closed evidence). */
  readonly lease_denial: LeaseDenial | null;
}

/** Construct a typed fabric denial. */
export function fabricDenial(
  code: FabricDenialCode,
  reason: string,
  details: { task_id?: string | null; grant_ref?: string | null; operation?: string | null; lease_denial?: LeaseDenial | null } = {},
): FabricDenial {
  return {
    code,
    reason,
    task_id: details.task_id ?? null,
    grant_ref: details.grant_ref ?? null,
    operation: details.operation ?? null,
    lease_denial: details.lease_denial ?? null,
  };
}
