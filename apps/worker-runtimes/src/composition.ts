/**
 * The reference worker runtime composition (Work Order P8) — the local
 * reference of the external worker topology, assembled exactly the way
 * the product composes it:
 *
 *   in-memory durable P2 stores -> Body Broker (with the P8 reference
 *   bodies registered) -> Execution Fabric -> Worker Runtime Host on an
 *   injected command source.
 *
 * Everything is INJECTED (clock, device presence, command source) —
 * this module is pure and deterministic; the only impure boundary is
 * the composition root (index.ts / system-clock.ts).
 */

import { WorkerRuntimeHost } from './host.js';
import type { WorkerRuntimeHostDeps } from './host.js';
import { CloudCodingShellBody } from '@sos-2/body-runtimes';
import { BrowserEvaluatorBody } from '@sos-2/body-runtimes';
import { ScriptedBrowserPort } from '@sos-2/body-runtimes';
import { InMemoryGitHubRepositoryOperations } from '@sos-2/body-runtimes';
import { GitHubProjectBody } from '@sos-2/body-runtimes';
import { BodyBroker } from '@sos-2/body-broker';
import { ExecutionFabric } from '@sos-2/execution-fabric';
import { ManualClock, createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import type { Clock } from '@sos-2/live-store';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import type { SandboxPolicy } from '@sos-2/sandbox';
import type { CommandSource, UserDevicePresence } from './commands.js';

/** The default bounded-environment policy of the reference cloud body. */
export const REFERENCE_CLOUD_SANDBOX_POLICY: SandboxPolicy = {
  filesystem: { mode: 'workspace', root: '/workspace/reference-cloud' },
  network: { egress: 'allowlist', allowedHosts: ['api.github.com', 'registry.npmjs.org'] },
  secrets: ['github-token'],
  budgets: { fileWrites: 200, fileBytes: 1_000_000, shellCommands: 500, networkCalls: 200, secretReveals: 100 },
  resourceEnvelope: { maxDurationMs: 7_200_000, maxMemoryMb: 2048 },
};

/** The reference worker runtime composition. */
export interface ReferenceWorkerRuntime {
  readonly clock: Clock;
  readonly store: ReturnType<typeof createInMemoryLiveStore>;
  readonly broker: BodyBroker;
  readonly fabric: ExecutionFabric;
  readonly host: WorkerRuntimeHost;
  readonly grant: AuthorityGrantArtifact;
  registerCloudBody(input?: {
    bodyId?: string;
    sandboxPolicy?: SandboxPolicy;
    secrets?: Readonly<Record<string, string>>;
    /** Execution placement (default "cloud" — §7: user-device bodies queue while the device is offline). */
    placement?: 'cloud' | 'remote' | 'user-device';
  }): CloudCodingShellBody;
  registerBrowserBody(input?: { bodyId?: string; allowedHosts?: readonly string[] }): BrowserEvaluatorBody;
  registerGitHubBody(input?: {
    bodyId?: string;
    repository?: { owner: string; name: string };
    baseBranch?: string;
    baseSha?: string;
    connected?: boolean;
    credentialName?: string | null;
    secrets?: Readonly<Record<string, string>>;
  }): GitHubProjectBody;
}

/** Dependencies of the reference composition (everything injected). */
export interface ReferenceWorkerRuntimeDeps {
  readonly clock: Clock;
  readonly devicePresence: UserDevicePresence;
  readonly commandSource: CommandSource;
  /** Grant expiry offset in ms (default: 24h from the injected clock). */
  readonly grantDurationMs?: number;
}

/**
 * Assemble the reference worker runtime. Deterministic for an injected
 * ManualClock; the grant is minted through @sos-2/authority's createGrant
 * and stored durably (bounded tasks run under explicit authority).
 */
export function createReferenceWorkerRuntime(deps: ReferenceWorkerRuntimeDeps): ReferenceWorkerRuntime {
  if (typeof deps !== 'object' || deps === null || typeof deps.clock !== 'object' || typeof deps.devicePresence !== 'object' || typeof deps.commandSource !== 'object') {
    throw new Error('createReferenceWorkerRuntime requires injected clock, devicePresence and commandSource');
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
  const hostDeps: WorkerRuntimeHostDeps = {
    fabric,
    clock,
    devicePresence: deps.devicePresence,
    commandSource: deps.commandSource,
  };
  const host = new WorkerRuntimeHost(hostDeps);

  const now = clock.nowEpochMs();
  const grant: AuthorityGrantArtifact = createGrant({
    grantee: 'spirit:persistent',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['READ', 'REVISE'],
    expiry: { kind: 'TIME', at: formatRfc3339(now + (deps.grantDurationMs ?? 86_400_000)) },
    provenance: ['p8-worker-runtime-reference'],
    created_at: formatRfc3339(now),
    status: 'ACTIVE',
  });

  const runtime: ReferenceWorkerRuntime = {
    clock,
    store,
    broker,
    fabric,
    host,
    grant,
    registerCloudBody(input = {}) {
      const bodyId = input.bodyId ?? 'reference-cloud-shell';
      const placement = input.placement ?? 'cloud';
      const body = new CloudCodingShellBody({
        bodyId,
        provider: { name: 'reference-cloud-shell', version: '1.0.0' },
        placement,
        sandboxPolicy: input.sandboxPolicy ?? REFERENCE_CLOUD_SANDBOX_POLICY,
        secrets: input.secrets ?? {},
      });
      broker.registerBody({
        body_id: bodyId,
        provider: { name: 'reference-cloud-shell', version: '1.0.0' },
        capabilities: body.capabilitiesValue,
        placement,
        harness: body,
      });
      return body;
    },
    registerBrowserBody(input = {}) {
      const bodyId = input.bodyId ?? 'reference-browser-evaluator';
      const body = new BrowserEvaluatorBody({
        bodyId,
        provider: { name: 'reference-browser-evaluator', version: '1.0.0' },
        placement: 'cloud',
        browserPort: new ScriptedBrowserPort(),
        allowedHosts: input.allowedHosts ?? ['example.com'],
      });
      broker.registerBody({
        body_id: bodyId,
        provider: { name: 'reference-browser-evaluator', version: '1.0.0' },
        capabilities: body.capabilitiesValue,
        placement: 'cloud',
        harness: body,
      });
      return body;
    },
    registerGitHubBody(input = {}) {
      const bodyId = input.bodyId ?? 'reference-github-project';
      const repository = input.repository ?? { owner: 'acme', name: 'legacy-checkout' };
      const baseBranch = input.baseBranch ?? 'main';
      const baseSha = input.baseSha ?? 'c0ffee10d5c0a11b2c3d4e5f60718293a4b5c6d7';
      const operations = new InMemoryGitHubRepositoryOperations({
        repository,
        branches: [{ name: baseBranch, head_sha: baseSha, is_protected: true }],
      });
      if (input.connected === true) {
        operations.completeConnection({ authorization_code: 'simulated-reference-code', completed_at: '2025-06-15T12:00:00Z' });
      }
      const credentialName = input.credentialName ?? null;
      const body = new GitHubProjectBody({
        bodyId,
        provider: { name: 'reference-github-project', version: '1.0.0' },
        placement: 'cloud',
        repositoryOperations: operations,
        repository,
        baseBranch,
        baseSha,
        sandboxPolicy: {
          filesystem: { mode: 'workspace', root: `/workspace/${bodyId}` },
          network: { egress: 'allowlist', allowedHosts: ['api.github.com'] },
          secrets: credentialName === null ? [] : [credentialName],
          budgets: { fileWrites: 100, fileBytes: 500_000, shellCommands: 100, networkCalls: 100, secretReveals: 50 },
          resourceEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 1024 },
        },
        credentialName,
        secrets: input.secrets ?? {},
      });
      broker.registerBody({
        body_id: bodyId,
        provider: { name: 'reference-github-project', version: '1.0.0' },
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
