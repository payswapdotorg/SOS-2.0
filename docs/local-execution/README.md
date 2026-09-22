# SOS 2.0 Local Execution (Work Order P11)

STATUS: P11 reference layer — contracts + LOCAL REFERENCE RUNTIMES only.
NO real desktop companion app, browser extension or IDE plugin ships in
this Work Order. Honest statuses everywhere: the companion reports
`NOT_YET_INSTALLED`, the bridges report `NOT_YET_CONNECTED` for real
endpoints — connection/installation evidence is NEVER fabricated. Real
companions, extensions and plugins attach later through the SAME
contracts and seams without contract change.

This doc set:

- [companion-architecture.md](./companion-architecture.md) — the
  authenticated local companion: contract, scope model, offline
  queueing, reconnect + state reconciliation.
- [bridge-tiers.md](./bridge-tiers.md) — the optional tier-4 browser/IDE
  bridges: adapter discipline, honest statuses.

## The local execution story in one page

The user's machine is OPTIONAL (spec/productization-execution-architecture.md §7):

- **Cloud/remote bodies continue while the user's computer is off.** The
  cloud path runs with ZERO companion presence — pinned by an acceptance
  suite whose import set contains no P11 package at all.
- **Local-only work orders QUEUE while the device reports offline and run
  when it reconnects** — nothing is lost, nothing is duplicated (pinned
  by tests).
- A **local companion** may expose private files and local tools to SOS
  behind an authenticated, scope-granted session; it is a replaceable
  MECHANISM (a local body path over the merged P5 Harness Contract), never
  an authority.
- **Browser/IDE extensions are optional adapters** (§4 tier 4), never SOS
  authorities.

## Where the code lives

| Path | What it is |
| --- | --- |
| `packages/local-companion` | The authenticated local companion contract: pairing/session, granted-scope file access, local process seam, durable local event log, offline queue, reconciliation, and `LocalCompanionBody` (the §9 Harness Contract implementation at placement `user-device`). |
| `packages/browser-bridge` | The optional browser bridge: tier-4 adapter contract with injectable transports and exact-shape validation. |
| `packages/ide-bridge` | The optional IDE bridge: the same adapter discipline for IDE integrations. |
| `apps/companion` | The plain Node + TypeScript host (composition root): stores + broker + fabric + companion + queue + host on an injected tick source. |
| `tests/local-bridges` | The acceptance suites (cloud independence, offline queueing, scope enforcement, reconciliation, provenance, bridges-as-adapters, structural scans). |

## Honest deployment story

- **Now (this Work Order)**: provider-neutral contracts plus
  deterministic, offline-testable LOCAL REFERENCE RUNTIMES. The reference
  pairing authority is an in-process fake with an injected code allowlist;
  the file port is in-memory; the process seam is a simulator with an
  injectable command registry; the bridges serve deterministic fixture
  models behind explicit `simulated` markers. Nothing here is presented as
  live local-device evidence.
- **Later, without contract change**: a real desktop companion implements
  `PairingAuthority`/`CredentialStore`/`LocalFilePort`/`LocalProcess`/
  `LocalEventLog`/`CommandSource` against the host machine; a real browser
  extension implements `BrowserBridgeTransport` with `simulated: false`;
  a real IDE plugin implements `IdeBridgeTransport`. The same bodies,
  bridges, queueing and reconciliation contracts carry them.
- **Never**: the companion or a bridge mints or widens authority. All
  bounded tasks — cloud and local alike — run through the merged P5
  Execution Fabric's uniform gate pipeline (TASK -> LEASE -> AUTHORITY ->
  ADVERTISEMENT -> DISPATCH); scope violations are typed denials, never
  silent.
