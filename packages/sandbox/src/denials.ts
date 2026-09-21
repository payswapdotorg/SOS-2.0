/**
 * Typed sandbox denials (Work Order P8).
 *
 * EVERY boundary violation is a typed denial — never silent, never a
 * crash, never a throw for an expected refusal:
 *
 *   SANDBOX_FILESYSTEM_OUT_OF_SCOPE  a filesystem access outside the
 *                                     declared scope (absolute path, '..'
 *                                     escape, or filesystem mode "none")
 *   SANDBOX_NETWORK_EGRESS_DENIED    a network call to a host the egress
 *                                     policy does not admit (or egress none)
 *   SANDBOX_BUDGET_EXCEEDED          a resource-envelope budget ran out
 *   SANDBOX_SECRET_UNAVAILABLE       a credential name the closure does
 *                                     not hold (never a fabricated value)
 *   SANDBOX_ENDED                    the sandbox was disposed; every
 *                                     further operation refuses
 *
 * Denials NEVER carry secret values — subjects and reasons are names and
 * policy facts only.
 */

/** The typed sandbox denial codes (frozen vocabulary of this Work Order). */
export const SANDBOX_DENIAL_CODES = [
  'SANDBOX_FILESYSTEM_OUT_OF_SCOPE',
  'SANDBOX_NETWORK_EGRESS_DENIED',
  'SANDBOX_BUDGET_EXCEEDED',
  'SANDBOX_SECRET_UNAVAILABLE',
  'SANDBOX_ENDED',
] as const;

export type SandboxDenialCode = (typeof SANDBOX_DENIAL_CODES)[number];

const DENIAL_CODE_SET: ReadonlySet<string> = new Set(SANDBOX_DENIAL_CODES);

/** A structured sandbox denial — WHY the boundary refused. */
export interface SandboxDenial {
  readonly code: SandboxDenialCode;
  /** The denied subject (path, host, counter or credential NAME — never a secret value). */
  readonly subject: string;
  /** Deterministic human-readable reason (policy facts only). */
  readonly reason: string;
}

/** Construct a typed denial (internal helper; exported for tests/fakes). */
export function sandboxDenial(code: SandboxDenialCode, subject: string, reason: string): SandboxDenial {
  return { code, subject, reason };
}

/** Is this a well-formed sandbox denial code? */
export function isSandboxDenialCode(value: unknown): value is SandboxDenialCode {
  return typeof value === 'string' && DENIAL_CODE_SET.has(value);
}

/**
 * The typed result of one sandbox boundary operation: OK with the value,
 * or DENIED with the typed denial. Expected refusals are DENIED results —
 * never thrown, never silent.
 */
export type SandboxResult<T> =
  | { readonly status: 'OK'; readonly value: T }
  | { readonly status: 'DENIED'; readonly denial: SandboxDenial };

/** Construct the OK result. */
export function sandboxOk<T>(value: T): SandboxResult<T> {
  return { status: 'OK', value };
}

/** Construct the DENIED result. */
export function sandboxDenied<T>(denial: SandboxDenial): SandboxResult<T> {
  return { status: 'DENIED', denial };
}

/** Render a denial as a deterministic single-line string (for truthful harness FAILED reasons). */
export function renderSandboxDenial(denial: SandboxDenial): string {
  return `sandbox denial ${denial.code} [${denial.subject}]: ${denial.reason}`;
}
