/**
 * The verified-failure observation contract (Work Order P12).
 *
 * DEATH IS NEVER FABRICATED: a missed heartbeat is honest UNKNOWN (the
 * body may be alive), and ONLY a VERIFIED failure observation — an
 * observation event the operator/provider has attested as a real
 * failure of that exact body — transitions a lease to LOST.
 *
 * The port is injectable: the composition root wires it to whatever
 * durable observation surface holds failure attestations (P7's
 * observation plane events, provider incident records). The reference
 * implementation is a deterministic manual registry the tests drive.
 */

/** A verified failure of one body, backed by an observation event id. */
export interface BodyFailureVerification {
  /** The body that verifiably failed. */
  readonly bodyId: string;
  /** The observation event id attesting the failure (never fabricated). */
  readonly observationId: string;
  /** When the failure was observed (RFC3339). */
  readonly observedAt: string;
  /** Human/provider detail of the failure. */
  readonly detail: string;
}

/** The verified-failure source port. */
export interface FailureVerificationSource {
  /** The verified failure of one body, or null when none exists (UNKNOWN). */
  verifiedFailureOf(bodyId: string): BodyFailureVerification | null;
}

/**
 * The deterministic manual verification registry: the tests record
 * verified failures explicitly — every LOST transition in the pinned
 * suites flows through a recorded verification, proving death is never
 * inferred from silence.
 */
export class ManualFailureVerification implements FailureVerificationSource {
  private readonly failures = new Map<string, BodyFailureVerification>();

  record(verification: BodyFailureVerification): void {
    if (typeof verification.bodyId !== 'string' || verification.bodyId.length === 0) {
      throw new TypeError(`verification bodyId must be a non-empty string`);
    }
    if (typeof verification.observationId !== 'string' || verification.observationId.length === 0) {
      throw new TypeError(`verification observationId must be a non-empty string`);
    }
    if (typeof verification.observedAt !== 'string' || verification.observedAt.length === 0) {
      throw new TypeError(`verification observedAt must be a non-empty string`);
    }
    this.failures.set(verification.bodyId, { ...verification });
  }

  verifiedFailureOf(bodyId: string): BodyFailureVerification | null {
    return this.failures.get(bodyId) ?? null;
  }
}
