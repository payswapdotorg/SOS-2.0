/**
 * The P11 acceptance world: the full local-companion composition — the
 * durable P2 stores, the authority grant, the P5 body broker + execution
 * fabric, the authenticated LocalCompanion (pairing authority + credential
 * store + granted-scope file port + simulated process seam + durable local
 * event log), the §9 companion body registered at placement user-device,
 * the offline work queue, the companion host on an injected tick/command
 * source, and the tier-4 bridges behind their honest simulated transports —
 * assembled exactly the way the product composes it, deterministically
 * (injected ManualClock, no network, offline).
 *
 * The COMPANION-ABSENT world for the cloud-independence proof lives in
 * acceptance.cloud-independence.test.ts — deliberately in a file that
 * imports ZERO P11 packages.
 */

import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { BodyBroker } from '@sos-2/body-broker';
import { ExecutionFabric } from '@sos-2/execution-fabric';
import { ManualClock, createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import type { TaskRecord } from '@sos-2/live-store';
import { LocalCompanion } from '@sos-2/local-companion';
import { LocalCompanionBody } from '@sos-2/local-companion';
import { OfflineWorkQueue } from '@sos-2/local-companion';
import { InMemoryCredentialStore } from '@sos-2/local-companion';
import { InMemoryLocalFilePort } from '@sos-2/local-companion';
import { ReferencePairingAuthority } from '@sos-2/local-companion';
import { SimulatedLocalProcess } from '@sos-2/local-companion';
import type { CompanionScopeGrant } from '@sos-2/local-companion';
import { CompanionRuntimeHost } from '@sos-2/companion';
import type { CompanionRuntimeHostDeps } from '@sos-2/companion';
import type { CompanionCommand, CompanionWorkOrder, CommandSource, UserDevicePresence } from '@sos-2/companion';
import { ArrayCommandSource, RecordingUserDevicePresence } from '@sos-2/companion';

export const T0 = Date.parse('2026-01-15T09:00:00Z');
export const MISSION_REF = `sos://Mission/${'a2b3c4d5'.repeat(4)}`;
/**
 * The secret VALUES of the acceptance journeys (session token prefix and
 * out-of-scope private content) — never echoed; pinned by output scans
 * across every harness result, observation, event, record and reply.
 */
export const SECRET_SESSION_TOKEN_PREFIX = 'reference-session-token-';
export const SECRET_OUT_OF_SCOPE_CONTENT = 'local-secret-content-pinned-never-echoed';

/** The reference scope grant of the acceptance pairing code. */
export const ACCEPTANCE_COMPANION_GRANT: CompanionScopeGrant = {
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

/** The acceptance world. */
export interface AcceptanceWorld {
  readonly clock: ManualClock;
  readonly store: ReturnType<typeof createInMemoryLiveStore>;
  readonly broker: BodyBroker;
  readonly fabric: ExecutionFabric;
  readonly grant: AuthorityGrantArtifact;
  readonly companion: LocalCompanion;
  readonly companionBody: LocalCompanionBody;
  readonly queue: OfflineWorkQueue;
  readonly host: CompanionRuntimeHost;
  readonly commandSource: ArrayCommandSource;
  readonly devicePresence: RecordingUserDevicePresence;
  readonly credentials: InMemoryCredentialStore;
  readonly filePort: InMemoryLocalFilePort;
  pair(): void;
  createTask(input?: { task_id?: string; grant?: AuthorityGrantArtifact }): Promise<TaskRecord>;
}

/**
 * Assemble the P11 acceptance world. Deterministic for the injected
 * ManualClock (T0); the grant is minted through @sos-2/authority's
 * createGrant and stored durably.
 */
export function acceptanceWorld(): AcceptanceWorld {
  const clock = new ManualClock(T0);
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
  const grant: AuthorityGrantArtifact = createGrant({
    grantee: 'spirit:persistent',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['READ', 'REVISE'],
    expiry: { kind: 'TIME', at: formatRfc3339(T0 + 86_400_000) },
    provenance: ['p11-acceptance-suite'],
    created_at: formatRfc3339(T0),
    status: 'ACTIVE',
  });

  const credentials = new InMemoryCredentialStore();
  const authority = new ReferencePairingAuthority([{ code: 'pair-local-0001', scopes: [ACCEPTANCE_COMPANION_GRANT], sessionDurationMs: null }]);
  const filePort = new InMemoryLocalFilePort();
  filePort.seed({
    'acme/README.md': '# acme local workspace\n',
    'notes/private.txt': 'private local notes\n',
    // Out-of-scope private content: invisible to the companion (pinned by
    // the scope-enforcement journey + the secret-echo scans).
    'outside/secret.txt': SECRET_OUT_OF_SCOPE_CONTENT,
  });
  const processSeam = new SimulatedLocalProcess();
  const companion = new LocalCompanion({
    deviceId: 'device-acceptance-0001',
    deviceLabel: 'acceptance laptop',
    pairingAuthority: authority,
    credentials,
    files: filePort,
    process: processSeam,
    clock,
  });
  const companionBody = new LocalCompanionBody({ bodyId: 'acceptance-local-companion', companion });
  broker.registerBody({
    body_id: 'acceptance-local-companion',
    provider: { name: 'reference-local-companion', version: '1.0.0' },
    capabilities: companionBody.capabilitiesValue,
    placement: 'user-device',
    harness: companionBody,
  });

  const queue = new OfflineWorkQueue();
  const commandSource = new ArrayCommandSource();
  const devicePresence = new RecordingUserDevicePresence(true);
  const hostDeps: CompanionRuntimeHostDeps = {
    fabric,
    clock,
    devicePresence,
    commandSource,
    companion,
    queue,
    observationEvents: store.observationEvents,
  };
  const host = new CompanionRuntimeHost(hostDeps);

  return {
    clock,
    store,
    broker,
    fabric,
    grant,
    companion,
    companionBody,
    queue,
    host,
    commandSource,
    devicePresence,
    credentials,
    filePort,
    pair() {
      const outcome = companion.pair({ pairing_code: 'pair-local-0001', device_id: 'device-acceptance-0001', device_label: 'acceptance laptop' });
      if (outcome.status !== 'PAIRED') {
        throw new Error(`acceptance pairing failed: ${JSON.stringify(outcome)}`);
      }
    },
    async createTask(input = {}) {
      const effectiveGrant = input.grant ?? grant;
      await store.authorityGrants.put(effectiveGrant);
      const created = await fabric.createBoundedTask({
        task_id: input.task_id ?? 'task-acceptance-0001',
        mission_ref: MISSION_REF,
        plan: { steps: ['local-work'] },
        grant_refs: [effectiveGrant.envelope.id],
        requirements: { requiredCapabilities: ['terminal', 'filesystem'], placement: 'user-device' },
        holder: 'spirit:persistent',
        expires_at: null,
      });
      if (created.status !== 'CREATED') {
        throw new Error(`acceptance task creation failed: ${JSON.stringify(created)}`);
      }
      return created.task;
    },
  };
}

/** A local-only work order for the acceptance journeys. */
export function localWorkOrder(taskId: string, grant: AuthorityGrantArtifact, steps: CompanionWorkOrder['steps']): CompanionWorkOrder {
  return {
    task_id: taskId,
    mission_ref: MISSION_REF,
    plan: { steps: ['local-work'] },
    grant_refs: [grant.envelope.id],
    requirements: { requiredCapabilities: ['terminal', 'filesystem'], placement: 'user-device' },
    holder: 'spirit:persistent',
    expires_at: null,
    steps,
  };
}

/** A pairing command for the acceptance journeys. */
export function pairCommand(): CompanionCommand {
  return { kind: 'pair-companion', pairing_code: 'pair-local-0001', device_id: 'device-acceptance-0001', device_label: 'acceptance laptop' };
}

/** The full serialized surface of one world — the secret-echo scan input. */
export function serializedWorldSurfaces(world: AcceptanceWorld): string {
  return JSON.stringify({
    sessions: world.companion.session(),
    events: world.companion.eventLog.events(),
    credentials: world.credentials.names(),
    queue: { size: world.queue.size, total: world.queue.total },
  });
}
