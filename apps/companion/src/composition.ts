/**
 * The reference local companion composition (Work Order P11) — the plain
 * Node + TypeScript host assembled exactly the way the product composes
 * it:
 *
 *   in-memory durable P2 stores -> Body Broker (the §9 local companion
 *   body registered at placement user-device) -> Execution Fabric ->
 *   LocalCompanion (pairing authority + credential store + file port +
 *   process seam + durable local event log injected) -> OfflineWorkQueue
 *   -> CompanionRuntimeHost on an injected tick/command source, with the
 *   optional tier-4 bridges (browser/IDE) attached behind their honest
 *   simulated reference transports.
 *
 * Everything is INJECTED (clock, device presence, command source) — this
 * module is pure and deterministic; the only impure boundary is the
 * composition root (index.ts / system-clock.ts, the apps/api and
 * apps/worker-runtimes precedent).
 *
 * HONEST STATUS: the composition reports the companion installation as
 * NOT_YET_INSTALLED (no real desktop app ships in this Work Order — the
 * deterministic reference runtime satisfies the same contracts; evidence
 * never fabricated) and the bridges as simulated connections.
 */

import { CompanionRuntimeHost } from './host.js';
import type { CompanionRuntimeHostDeps } from './host.js';
import { LocalCompanion } from '@sos-2/local-companion';
import { LocalCompanionBody } from '@sos-2/local-companion';
import { OfflineWorkQueue } from '@sos-2/local-companion';
import { InMemoryCredentialStore } from '@sos-2/local-companion';
import { InMemoryLocalFilePort } from '@sos-2/local-companion';
import { ReferencePairingAuthority } from '@sos-2/local-companion';
import { SimulatedLocalProcess } from '@sos-2/local-companion';
import { REFERENCE_COMPANION_INSTALLATION } from '@sos-2/local-companion';
import type { CompanionScopeGrant } from '@sos-2/local-companion';
import { BodyBroker } from '@sos-2/body-broker';
import { CloudCodingShellBody } from '@sos-2/body-runtimes';
import { ExecutionFabric } from '@sos-2/execution-fabric';
import { ManualClock, createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import type { Clock } from '@sos-2/live-store';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { BrowserBridgeAdapter } from '@sos-2/browser-bridge';
import { SimulatedBrowserExtensionTransport } from '@sos-2/browser-bridge';
import { IdeBridgeAdapter } from '@sos-2/ide-bridge';
import { SimulatedIdeIntegrationTransport } from '@sos-2/ide-bridge';
import type { CommandSource, UserDevicePresence } from './commands.js';

/** The reference scope grant of the reference pairing code. */
export const REFERENCE_COMPANION_GRANT: CompanionScopeGrant = {
  grant_id: 'grant-local-workspace',
  roots: [
    { name: 'acme', mode: 'read-write' },
    { name: 'notes', mode: 'read' },
  ],
  process_allowlist: ['echo', 'cat', 'ls', 'pwd'],
  granted_by: 'user:pairing',
  granted_at: '2026-01-15T09:00:00Z',
  expires_at: null,
};

/** The reference sandbox policy of the reference cloud body (cloud orders through the host). */
export const REFERENCE_CLOUD_SANDBOX_POLICY = {
  filesystem: { mode: 'workspace' as const, root: '/workspace/reference-cloud' },
  network: { egress: 'allowlist' as const, allowedHosts: ['api.github.com', 'registry.npmjs.org'] },
  secrets: ['github-token'],
  budgets: { fileWrites: 200, fileBytes: 1_000_000, shellCommands: 500, networkCalls: 200, secretReveals: 100 },
  resourceEnvelope: { maxDurationMs: 7_200_000, maxMemoryMb: 2048 },
};

/** The reference local companion runtime. */
export interface ReferenceCompanionRuntime {
  readonly clock: Clock;
  readonly store: ReturnType<typeof createInMemoryLiveStore>;
  readonly broker: BodyBroker;
  readonly fabric: ExecutionFabric;
  readonly companion: LocalCompanion;
  readonly companionBody: LocalCompanionBody;
  readonly queue: OfflineWorkQueue;
  readonly host: CompanionRuntimeHost;
  readonly grant: AuthorityGrantArtifact;
  readonly credentials: InMemoryCredentialStore;
  readonly authority: ReferencePairingAuthority;
  readonly filePort: InMemoryLocalFilePort;
  readonly browserBridge: BrowserBridgeAdapter;
  readonly ideBridge: IdeBridgeAdapter;
  /** The honest installation status (NOT_YET_INSTALLED — reference runtime only). */
  readonly installation: typeof REFERENCE_COMPANION_INSTALLATION;
  registerCloudBody(input?: { bodyId?: string }): CloudCodingShellBody;
}

/** Dependencies of the reference composition (everything injected). */
export interface ReferenceCompanionRuntimeDeps {
  readonly clock: Clock;
  readonly devicePresence: UserDevicePresence;
  readonly commandSource: CommandSource;
  /** Grant expiry offset in ms (default: 24h from the injected clock). */
  readonly grantDurationMs?: number;
}

/**
 * Assemble the reference local companion runtime. Deterministic for an
 * injected ManualClock; the authority grant is minted through
 * @sos-2/authority's createGrant and stored durably (bounded tasks run
 * under explicit authority — the companion cannot mint authority).
 */
export function createReferenceCompanionRuntime(deps: ReferenceCompanionRuntimeDeps): ReferenceCompanionRuntime {
  if (typeof deps !== 'object' || deps === null || typeof deps.clock !== 'object' || typeof deps.devicePresence !== 'object' || typeof deps.commandSource !== 'object') {
    throw new Error('createReferenceCompanionRuntime requires injected clock, devicePresence and commandSource');
  }
  const clock = deps.clock;
  const store = createInMemoryLiveStore({ clock });
  const broker = new BodyBroker({ leases: store.bodyLeases, clock });
  const fabric = new ExecutionFabric({
    tasks: store.tasks,
    authorityGrants: store.authorityGrants,
    observationEvents: store.observationEvents,
    objects: store.objects,
    broker,
    clock,
  });

  // The companion core: reference pairing authority (injected code
  // allowlist), credential store (values never echo), in-memory file
  // port, simulated process seam — everything deterministic.
  const credentials = new InMemoryCredentialStore();
  const authority = new ReferencePairingAuthority([
    { code: 'pair-local-0001', scopes: [REFERENCE_COMPANION_GRANT], sessionDurationMs: null },
  ]);
  const filePort = new InMemoryLocalFilePort();
  filePort.seed({
    'acme/README.md': '# acme local workspace\n',
    'notes/private.txt': 'private local notes\n',
  });
  const processSeam = new SimulatedLocalProcess();
  const companion = new LocalCompanion({
    deviceId: 'device-reference-0001',
    deviceLabel: 'reference laptop',
    pairingAuthority: authority,
    credentials,
    files: filePort,
    process: processSeam,
    clock,
  });

  // The §9 local body path: the companion body registered with the P5
  // broker at placement user-device (bounded tasks lease it through the
  // fabric's uniform gate pipeline like any body).
  const companionBody = new LocalCompanionBody({ bodyId: 'reference-local-companion', companion });
  broker.registerBody({
    body_id: 'reference-local-companion',
    provider: { name: 'reference-local-companion', version: '1.0.0' },
    capabilities: companionBody.capabilitiesValue,
    placement: 'user-device',
    harness: companionBody,
  });

  const queue = new OfflineWorkQueue();
  const host = new CompanionRuntimeHost({
    fabric,
    clock,
    devicePresence: deps.devicePresence,
    commandSource: deps.commandSource,
    companion,
    queue,
    observationEvents: store.observationEvents,
  });

  const now = clock.nowEpochMs();
  const grant: AuthorityGrantArtifact = createGrant({
    grantee: 'spirit:persistent',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['READ', 'REVISE'],
    expiry: { kind: 'TIME', at: formatRfc3339(now + (deps.grantDurationMs ?? 86_400_000)) },
    provenance: ['p11-companion-reference'],
    created_at: formatRfc3339(now),
    status: 'ACTIVE',
  });

  const runtime: ReferenceCompanionRuntime = {
    clock,
    store,
    broker,
    fabric,
    companion,
    companionBody,
    queue,
    host,
    grant,
    credentials,
    authority,
    filePort,
    browserBridge: new BrowserBridgeAdapter({
      bridgeId: 'browser-bridge-reference',
      provider: { name: 'reference-browser-extension', version: '1.0.0' },
      transport: new SimulatedBrowserExtensionTransport(),
    }),
    ideBridge: new IdeBridgeAdapter({
      bridgeId: 'ide-bridge-reference',
      provider: { name: 'reference-ide-integration', version: '1.0.0' },
      transport: new SimulatedIdeIntegrationTransport(),
    }),
    installation: REFERENCE_COMPANION_INSTALLATION,
    registerCloudBody(input = {}) {
      const bodyId = input.bodyId ?? 'reference-cloud-shell';
      const body = new CloudCodingShellBody({
        bodyId,
        provider: { name: 'reference-cloud-shell', version: '1.0.0' },
        placement: 'cloud',
        sandboxPolicy: REFERENCE_CLOUD_SANDBOX_POLICY,
        secrets: {},
      });
      broker.registerBody({
        body_id: bodyId,
        provider: { name: 'reference-cloud-shell', version: '1.0.0' },
        capabilities: body.capabilitiesValue,
        placement: 'cloud',
        harness: body,
      });
      return body;
    },
  };
  return runtime;
}

/** A deterministic manual clock starting at the reference instant (tests/local development). */
export function referenceManualClock(): ManualClock {
  return new ManualClock(Date.parse('2026-01-15T09:00:00Z'));
}
