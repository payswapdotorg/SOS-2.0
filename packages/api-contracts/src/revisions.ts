/**
 * Revision headers (Work Order P2).
 *
 * Every record read/write response carries the artifact id and — when the
 * record has a numeric revision (envelope.version for spine artifacts, the
 * explicit revision for execution-fabric records) — the exact stored
 * revision. Write requests MAY carry an expected-revision header, which the
 * store turns into optimistic concurrency (mismatch -> typed CONFLICT).
 *
 * Immutable flat records (content-addressed, no revision) omit the revision
 * header; their identity IS their revision (the deterministic content
 * address).
 */

export const ARTIFACT_ID_HEADER = 'x-sos-artifact-id';
export const REVISION_HEADER = 'x-sos-revision';
export const EXPECTED_REVISION_HEADER = 'x-sos-expected-revision';

/**
 * The response headers describing a stored record. The revision header is
 * present only when the record carries a numeric revision.
 */
export function recordResponseHeaders(id: string, revision: number | null): Record<string, string> {
  const headers: Record<string, string> = { [ARTIFACT_ID_HEADER]: id };
  if (revision !== null) {
    headers[REVISION_HEADER] = String(revision);
  }
  return headers;
}

/**
 * Parse an expected-revision header value. Returns the parsed integer, or a
 * typed INVALID message. Absent header -> ok with revision null (no CAS).
 */
export function parseExpectedRevision(
  value: string | undefined,
): { ok: true; revision: number | null } | { ok: false; error: string } {
  if (value === undefined || value === '') {
    return { ok: true, revision: null };
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return { ok: false, error: `expected revision must be an integer >= 1, received: ${JSON.stringify(value)}` };
  }
  return { ok: true, revision: parsed };
}
