/**
 * Evidence truth states — the 6 frozen, semantically DISTINCT states from
 * spec/meta-model.md and spec/architecture.md §18:
 * "Unknown, failed, unavailable and unsupported remain distinct."
 *
 * NEVER conflate UNKNOWN with UNAVAILABLE (or any other pair). The helper
 * `assertTruthStateIs` exists to pin exact-state expectations in tests and
 * downstream validators.
 */

export const EVIDENCE_TRUTH_STATES = [
  'SUCCESS',
  'FAILURE',
  'UNKNOWN',
  'UNAVAILABLE',
  'UNSUPPORTED',
  'PARTIAL',
] as const;

export type EvidenceTruthState = (typeof EVIDENCE_TRUTH_STATES)[number];

const EVIDENCE_TRUTH_STATE_SET: ReadonlySet<string> = new Set(EVIDENCE_TRUTH_STATES);

export function isEvidenceTruthState(value: unknown): value is EvidenceTruthState {
  return typeof value === 'string' && EVIDENCE_TRUTH_STATE_SET.has(value);
}

/**
 * Asserts that `actual` is EXACTLY `expected` — two distinct truth states are
 * never interchangeable. Throws on any conflation (e.g. expecting UNKNOWN but
 * receiving UNAVAILABLE).
 */
export function assertTruthStateIs(
  expected: EvidenceTruthState,
  actual: unknown,
): asserts actual is EvidenceTruthState {
  if (actual !== expected) {
    throw new TypeError(
      `evidence truth state conflation: expected exactly ${expected}, received ${JSON.stringify(actual)}`,
    );
  }
}
