# @sos-2/api-contracts — the typed API boundary (Work Order P2)

Pure types + guards for the live API surface:

- **Transport-agnostic request/response envelopes** (`routes.ts`) — the same
  handler contract hosts as a plain Node process today and as a Vercel
  function / external worker boundary later, without contract change.
- **Typed error envelopes** (`errors.ts`) — `UNKNOWN`, `UNAVAILABLE`,
  `CONFLICT` (stale revision / optimistic concurrency), `DUPLICATE` (replayed
  event), `NOT_FOUND`, `INVALID`, each with a fixed HTTP status mapping.
  UNKNOWN and UNAVAILABLE are never conflated and never fabricated into
  success.
- **Opaque pagination cursors** (`pagination.ts`) — deterministic
  base64url-over-canonical-JSON seek cursors; malformed cursors are typed
  INVALID, never silently reset.
- **Revision headers** (`revisions.ts`) — artifact-id and revision response
  headers plus the expected-revision request header (optimistic
  concurrency).
- **Event ingestion payloads** (`events.ts`) — every event carries an id
  (replay-protection key); payloads are opaque canonical JSON preserved
  verbatim.
- **Provider-health payloads** (`health.ts`) — per-provider typed
  `AVAILABLE` / `UNAVAILABLE` / `UNKNOWN` availability records.

Domain record shapes are **never re-declared here**: bodies crossing the
boundary are the verbatim shapes of the owning `@sos-2/*` packages. The only
dependency is the workspace spine (`@sos-2/semantic-spine`), whose canonical
serialization and frozen vocabularies are consumed verbatim.
