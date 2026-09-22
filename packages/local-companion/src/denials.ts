/**
 * Typed local-companion denials (Work Order P11).
 *
 * EVERY boundary violation is a typed denial — never silent, never a
 * crash, never a throw for an expected refusal (the P8 sandbox denial
 * discipline applied to the user's local machine):
 *
 *   COMPANION_UNAUTHENTICATED      an operation without a valid, active,
 *                                  unexpired companion session — pair
 *                                  first (the session is the gate)
 *   COMPANION_SCOPE_DENIED         a file access outside the granted
 *                                  scope (unknown root, absolute path,
 *                                  '..' escape, a read-only root asked to
 *                                  write, or an expired scope grant —
 *                                  grants are re-evaluated before every
 *                                  consequential operation)
 *   COMPANION_PROCESS_DENIED       a local process operation whose command
 *                                  is not granted by the scope's process
 *                                  allowlist (an un-granted consequential
 *                                  operation)
 *   COMPANION_RECONCILIATION_GAP   a gap in the local event log sequence
 *                                  during reconciliation — sequence
 *                                  continuity is a hard invariant, a gap
 *                                  is reported loudly, never folded away
 *
 * Denials NEVER carry secret values — subjects and reasons are names and
 * policy facts only.
 */

/** The typed local-companion denial codes (frozen vocabulary of this Work Order). */
export const COMPANION_DENIAL_CODES = [
  'COMPANION_UNAUTHENTICATED',
  'COMPANION_SCOPE_DENIED',
  'COMPANION_PROCESS_DENIED',
  'COMPANION_RECONCILIATION_GAP',
] as const;

export type CompanionDenialCode = (typeof COMPANION_DENIAL_CODES)[number];

const DENIAL_CODE_SET: ReadonlySet<string> = new Set(COMPANION_DENIAL_CODES);

/** A structured local-companion denial — WHY the boundary refused. */
export interface CompanionDenial {
  readonly code: CompanionDenialCode;
  /** The denied subject (a path, root name, command or session id — never a secret value). */
  readonly subject: string;
  /** Deterministic human-readable reason (policy facts only). */
  readonly reason: string;
}

/** Construct a typed denial (internal helper; exported for tests/fakes). */
export function companionDenial(code: CompanionDenialCode, subject: string, reason: string): CompanionDenial {
  return { code, subject, reason };
}

/** Is this a well-formed local-companion denial code? */
export function isCompanionDenialCode(value: unknown): value is CompanionDenialCode {
  return typeof value === 'string' && DENIAL_CODE_SET.has(value);
}

/**
 * The typed result of one local-companion boundary operation: OK with the
 * value, or DENIED with the typed denial. Expected refusals are DENIED
 * results — never thrown, never silent. When the companion serves the §9
 * Harness Contract, a DENIAL renders as a truthful FAILED result carrying
 * the typed denial code (refusing-to-run and running-and-failing stay
 * distinct facts).
 */
export type CompanionResult<T> =
  | { readonly status: 'OK'; readonly value: T }
  | { readonly status: 'DENIED'; readonly denial: CompanionDenial };

/** Construct the OK result. */
export function companionOk<T>(value: T): CompanionResult<T> {
  return { status: 'OK', value };
}

/** Construct the DENIED result. */
export function companionDenied<T>(denial: CompanionDenial): CompanionResult<T> {
  return { status: 'DENIED', denial };
}

/** Render a denial as a deterministic single-line string (for truthful harness FAILED reasons). */
export function renderCompanionDenial(denial: CompanionDenial): string {
  return `companion denial ${denial.code} [${denial.subject}]: ${denial.reason}`;
}
