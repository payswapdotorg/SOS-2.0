# The Local Companion Architecture (Work Order P11)

The local companion is the **authenticated local body path** over the
merged P5 Harness Contract: `LocalCompanionBody`
(`packages/local-companion/src/harness-body.ts`) implements the §9
contract at placement `user-device` and registers with the P5 Body Broker,
so bounded tasks lease it through the Execution Fabric's uniform gate
pipeline exactly like cloud bodies. The companion core beneath it is a
replaceable mechanism, never an authority (the spirit/brain/body rule).

## 1. Session / authentication contract

Pairing + session records are TYPED RECORDS over INJECTED seams:

- `PairingAuthority` (port) — validates pairing codes and mints sessions.
  The companion CANNOT mint sessions or authority itself; the reference
  implementation (`ReferencePairingAuthority`) is a deterministic
  in-process fake whose admitted codes are injected data. A refused code
  is a typed `DENIED` outcome — never a fabricated session.
- `CredentialStore` (port) — where session token VALUES live. The token
  value produced by pairing goes STRAIGHT into the store under a NAME;
  every typed record (session record, pairing result, observation, event,
  denial) carries the token NAME only. There is deliberately NO
  value-revealing operation on the store (the P8 sandbox secrets
  discipline — pinned by output scans across every journey).
- `CompanionSessionRecord` — `{ session_id, device_id, device_label,
  token_name, scopes, paired_at, expires_at }`. The honest status is
  re-evaluated per access (`CompanionSessionStatus`: ACTIVE / EXPIRED /
  REVOKED / UNPAIRED) — expiry and token validation are never cached as
  truth. An expired or revoked session authorizes NOTHING.

## 2. Granted-scope model (private workspace/file access)

The companion cannot exceed granted scope. Scope grants arrive IMMUTABLE
from pairing (`CompanionScopeGrant`: `grant_id`, `roots` (each
`{ name, mode: read | read-write }`), `process_allowlist`, `granted_by`,
`granted_at`, `expires_at`) — there is no operation that creates or
extends a grant from inside the companion.

Every file access runs the gate pipeline:

1. **SESSION** — an unpaired/expired/revoked session answers a typed
   `COMPANION_UNAUTHENTICATED` denial.
2. **SCOPE** — `resolveScopedPath` resolves the path
   `<rootName>/<relative-path>` against the LIVE grants (re-evaluated
   against the injected clock before every consequential operation — an
   expired grant authorizes nothing). Unknown root, absolute path, `..`
   escape, dot-segment, or a write to a read-only root answers a typed
   `COMPANION_SCOPE_DENIED` denial naming the subject and the policy
   fact — never silent, never a crash.
3. **PORT** — the resolved access dispatches onto the injectable
   `LocalFilePort` (in-memory reference; a real desktop companion
   implements the port against the host filesystem behind its own
   OS-level permissions).

Listing shows ONLY granted roots: port content outside granted scope is
invisible. Every access emits a provenance-labelled local observation
(`local.workspace.read` / `local.workspace.wrote` / `local.scope.denied`).

## 3. Local shell/process integration

Typed operation records through the injectable `LocalProcess` seam:

- A command outside the session's `process_allowlist` is a typed
  `COMPANION_PROCESS_DENIED` denial — an un-granted consequential
  operation never runs.
- The reference implementation (`SimulatedLocalProcess`) is a
  deterministic in-process simulator with an INJECTABLE command registry
  (built-ins: `echo`, `cat`, `ls`, `pwd`) — ZERO real process spawning in
  library code. A real companion's process bridge implements the same
  seam later without contract change.

## 4. Offline queueing (§7 user device model)

Local-only work orders (`LocalWorkOrder`: task contract + authority
grant refs + the ordered §9 step program the companion body advertises)
QUEUE while the device reports offline and run when it reconnects:

- The queue (`OfflineWorkQueue`) is the MECHANISM — FIFO release, nothing
  lost, nothing duplicated, with an enqueue-total audit counter.
- The HOST (`apps/companion`) owns the §7 device gate: a work order whose
  body requirements demand placement `user-device` queues while the
  device is offline; cloud/remote orders run regardless and NEVER consult
  device presence (pinned by tests with zero device probes).
- Released orders execute through the SAME P5 discipline as every bounded
  task: `createBoundedTask` (authority gate -> capability selection ->
  lease -> contract `createTask` -> durable §6 record), steps through the
  fabric's gate pipeline, `completeTask` with the honest §10 verification
  record (a denied/unsupported/failed step completes with
  `verified:false` — never fabricated).

## 5. Reconnect + state reconciliation

The companion keeps a DURABLE LOCAL EVENT LOG (`LocalEventLog` port;
in-memory reference) of every local observation — contiguous 1-based
sequence numbers, a monotonic ingestion-acknowledgement watermark, and
provenance labels on every record. While the device is offline, queue/
session/scope/presence observations accumulate as the pending suffix.

On reconnect, `reconcileLocalEventLog` reconciles the log against the P2
live-store observation events:

- **Idempotent, replay-protected ingestion** — the merged P2
  `ObservationEventRepository` ingests by deterministic event id
  (`local-companion:<device_id>:<event_id>`); duplicate delivery answers
  a typed `DUPLICATE` against the durable event index, never
  double-applied.
- **Exactly-once** — APPLIED and DUPLICATE both prove the store holds the
  event; the watermark advances exactly past provably-held events. A
  lost-acknowledgement restart (crash after ingestion, before the
  watermark persisted) replays the full suffix and deduplicates exactly.
- **Gap-free continuity** — reconciliation PRE-SCANS the pending suffix
  and a gap aborts the WHOLE pass with a typed
  `COMPANION_RECONCILIATION_GAP` violation before the store ingests
  anything — never silent, never partially applied.

The host reconciles FIRST on reconnect, then releases the queued local
orders (the reconnect discipline).

## 6. Provenance labelling

Every observation the companion emits carries provenance naming the LOCAL
SOURCE + DEVICE IDENTITY (the `@sos-2/telemetry` provenance discipline):

- `LocalEventRecord.provenance = [source, device:<device_id>,
  producer:local-companion@<version>]` — the producer is a
  `@sos-2/provenance` `Producer` record (tool `local-companion`,
  environment `device:<device_id>`).
- After ingestion the P2 observation event keeps the labels verbatim
  (`source = local-companion:<device_id>`, provenance array preserved).
- Observations are input, never semantic truth; secrets never appear in
  any of them (pinned by output scans).

## 7. The honest capability advertisement

`LocalCompanionBody.capabilities()` advertises exactly what the reference
companion does: `terminal` + `filesystem` (workspace read/write bounded by
granted scope; shell exec through the seam), `isolationLevel: 'none'`
(the user's own machine — scope grants bound it, no isolation boundary is
claimed), egress `none`, git/browser/runtime integrations EMPTY — those
operations answer typed `UNSUPPORTED` (explicit, never silent). Browser
interaction rides the optional tier-4 browser bridge or a
browser-capable body; repository operations run on repository-capable
bodies (the P8 cloud/GitHub bodies).
