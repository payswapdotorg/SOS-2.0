# The Browser/IDE Bridge Tiers (Work Order P11)

Browser and IDE extensions are **§4 tier-4 adapters** (`extension` in the
frozen integration-tier vocabulary — rank 4, BELOW the local companion /
service bridge at rank 3). They are OPTIONAL bridging surfaces onto the
companion/harness surface: an extension is an ADAPTER, never an SOS
authority.

SOS must never require an extension when an equivalent safe API is
available (§4) — the bridges exist for capabilities that genuinely live
in the user's browser or IDE, not as a substitute for higher control
surfaces.

## The adapter discipline (both bridges)

`packages/browser-bridge` and `packages/ide-bridge` follow the SAME
discipline, mirroring the P8 `LocalBridgeTransport` command-dispatch
precedent:

- **Typed ports over injectable transports.** Every operation is a BRIDGE
  COMMAND dispatched with a JSON body over an injectable transport
  (`BrowserBridgeTransport` / `IdeBridgeTransport`). Real extensions
  implement the transport; tests inject fakes; the deterministic
  reference runtimes serve the same shapes offline.
- **The seam carries NO AUTHORITY.** Every marshaled request and reply is
  validated against an EXACT field set (the anti-smuggling table). A
  smuggled grant/permission/authority key — in a request OR a reply — is
  a typed violation NAMING the field, never silently accepted (pinned by
  tests in both directions).
- **Reply validation.** A transport reply whose value does not satisfy
  the operation's typed shape is a MALFORMED payload — the adapter
  answers a truthful FAILED result naming the violation, never a silent
  success, never a crash.
- **Honest connection statuses** (the merged P8 vocabulary, consumed):
  `NOT_YET_CONNECTED` while no real extension exists (null transport —
  connection evidence is never fabricated), or an explicit `simulated`
  marker when the deterministic reference transport backs the bridge. A
  SIMULATED transport can never render as a real connection.

## The browser bridge (`@sos-2/browser-bridge`)

Commands:

- `bridge.browser.open` — body `{ task_ref, url }`, reply
  `{ page_id, url, title }` (the §9 `browser.open` shapes).
- `bridge.browser.interact` — body `{ task_ref, page_id, action, target,
  value }`, reply `{ result }` (the §9 `browser.interact` shapes; action
  `click | type | read`).

The adapter (`BrowserBridgeAdapter`) serves the §9-shaped operations, so
a browser-capable execution path can ride the user's real browser once a
real extension implements the transport. The reference runtime
(`SimulatedBrowserExtensionTransport`) serves a deterministic fixture
page model with page ids as sequences.

## The IDE bridge (`@sos-2/ide-bridge`)

Commands (the §1 "IDE or desktop interaction" body surface — §9 has no
IDE operations, so the bridge defines its own typed ports):

- `bridge.ide.openFile` — body `{ task_ref, path }`, reply
  `{ opened: true, document_id }`.
- `bridge.ide.diagnostics` — body `{ task_ref, path }`, reply
  `{ diagnostics: [{ severity, code, message, line }] }` (typed
  `IdeDiagnostic` records).

The reference runtime (`SimulatedIdeIntegrationTransport`) serves a
deterministic document model (document ids as sequences; fixture
diagnostics derived from the path).

## Honest deployment story

- **Now**: NO real browser extension or IDE plugin ships. The bridges are
  provider-neutral contracts plus LOCAL REFERENCE RUNTIMES (deterministic,
  offline-testable) — statuses `NOT_YET_CONNECTED` for real endpoints,
  `simulated: true` markers on the reference transports.
- **Later, without contract change**: a real extension implements
  `BrowserBridgeTransport` with `simulated: false`; a real IDE plugin
  implements `IdeBridgeTransport`. The same adapters, shapes and honest
  statuses carry them.
- **Never**: an extension mints or widens authority, and no authority
  field ever marshals across a bridge seam.
