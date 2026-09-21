/**
 * Typed errors for @sos-2/observation.
 *
 * Contract violations (malformed wiring, invalid queries) throw; honest
 * operational conditions (stale data, malformed event payloads, missing
 * observations) are TYPED RECORDS (FreshnessMark, malformed counters,
 * UNVERIFIED findings) — never exceptions. The observation plane keeps
 * observing.
 */

export class ObservationError extends Error {
  readonly code: 'OBSERVATION';

  constructor(message: string) {
    super(message);
    this.name = 'ObservationError';
    this.code = 'OBSERVATION';
  }
}
