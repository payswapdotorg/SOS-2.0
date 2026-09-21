/**
 * @sos-2/github typed errors. A single error root for the package (the
 * zero-dependency P3 lineage: the error extends Error directly — this
 * package cannot import @sos-2/semantic-spine's SemanticSpineError
 * without breaking the lockfile byte-identity rule, and the frozen core
 * is never re-implemented here).
 *
 * Expected refusals (unsupported capabilities, absent repositories,
 * missing credentials) are TYPED DATA OUTCOMES, not thrown errors —
 * mirroring @sos-2/adapters' denial-outcome precedent and
 * @sos-2/live-store's PutResult conflicts. Thrown GitHubAdapterError is
 * reserved for contract violations (malformed inputs, misuse of the
 * port), never for honest provider answers.
 */

/** The single error class of the GitHub project adapter. */
export class GitHubAdapterError extends Error {
  /** The capability involved, when the error is capability-related. */
  readonly capability: string | null;

  constructor(message: string, capability: string | null = null) {
    super(message);
    this.name = 'GitHubAdapterError';
    this.capability = capability;
  }
}
