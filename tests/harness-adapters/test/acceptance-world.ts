/**
 * The P8 acceptance world: the full composition — durable P2 stores, the
 * authority grant, the P5 body broker + execution fabric, the P8
 * reference bodies (directly registered AND adapter-served through every
 * §4 shape) — assembled exactly the way the product composes them,
 * deterministically (injected ManualClock, no network, offline).
 */

import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { BodyBroker } from '@sos-2/body-broker';
import { CloudCodingShellBody, BrowserEvaluatorBody, GitHubProjectBody, InMemoryGitHubRepositoryOperations, ScriptedBrowserPort } from '@sos-2/body-runtimes';
import { ExecutionFabric } from '@sos-2/execution-fabric';
import { ManualClock, createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import type { TaskRecord } from '@sos-2/live-store';
import type { HarnessCapability } from '@sos-2/harness';
import type { HarnessContract } from '@sos-2/harness';
import { McpHarnessAdapter, NativeApiHarnessAdapter, LocalBridgeHarnessAdapter } from '@sos-2/harness-adapters';
import { inProcessLocalBridgeTransport, inProcessMcpTransport, inProcessNativeApiTransport, simulatedAdapterConnection } from '@sos-2/harness-adapters';
import type { HarnessAdapterSpec } from '@sos-2/harness-adapters';
import type { SandboxPolicy } from '@sos-2/sandbox';

export const T0 = Date.parse('2026-01-15T09:00:00Z');
export const MISSION_REF = `sos://Mission/${'a2b3c4d5'.repeat(4)}`;
/** The credential value injected into sandbox closures (NEVER echoed — pinned by output scans). */
export const SECRET_TOKEN_VALUE = 'gh-secret-token-value-pinned-never-echoed-anywhere';

export interface AcceptanceWorld {
  readonly clock: ManualClock;
  readonly store: ReturnType<typeof createInMemoryLiveStore>;
  readonly broker: BodyBroker;
  readonly fabric: ExecutionFabric;
  readonly grant: AuthorityGrantArtifact;
  registerCloudBody(input?: {
    bodyId?: string;
    placement?: 'cloud' | 'remote' | 'user-device';
    sandboxPolicy?: SandboxPolicy;
    secrets?: Readonly<Record<string, string>>;
  }): CloudCodingShellBody;
  registerBrowserBody(input?: { bodyId?: string }): BrowserEvaluatorBody;
  registerGitHubBody(input?: { bodyId?: string; connected?: boolean; credentialName?: string | null }): { body: GitHubProjectBody; operations: InMemoryGitHubRepositoryOperations };
  registerAdapterServedCloudBody(input: {
    bodyId: string;
    adapterKind: 'native-api' | 'mcp-protocol' | 'local-bridge';
    providerName?: string;
    sandboxPolicy?: SandboxPolicy;
  }): { body: CloudCodingShellBody; adapterTier: 'native-api' | 'mcp-protocol' | 'local-bridge' };
  createTask(input?: {
    task_id?: string;
    grant?: AuthorityGrantArtifact;
    requirements?: { requiredCapabilities: HarnessCapability[]; placement: 'cloud' | 'remote' | 'user-device' | null };
    leaseExpiresAt?: number | null;
  }): Promise<TaskRecord>;
}

/** The reference sandbox policy of the acceptance cloud bodies. */
export const ACCEPTANCE_CLOUD_POLICY: SandboxPolicy = {
  filesystem: { mode: 'workspace', root: '/workspace/acceptance-cloud' },
  network: { egress: 'allowlist', allowedHosts: ['api.github.com', 'registry.npmjs.org'] },
  secrets: ['github-token'],
  budgets: { fileWrites: 50, fileBytes: 100_000, shellCommands: 50, networkCalls: 50, secretReveals: 50 },
  resourceEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 1024 },
};

export function acceptanceWorld(options: { grantExpiresAt?: number } = {}): AcceptanceWorld {
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
    expiry: { kind: 'TIME', at: formatRfc3339(options.grantExpiresAt ?? T0 + 86_400_000) },
    provenance: ['p8-acceptance-suite'],
    created_at: formatRfc3339(T0),
    status: 'ACTIVE',
  });

  function register(harness: HarnessContract, bodyId: string, providerName: string, placement: 'cloud' | 'remote' | 'user-device'): void {
    broker.registerBody({
      body_id: bodyId,
      provider: { name: providerName, version: '1.0.0' },
      capabilities: harness.capabilities(),
      placement,
      harness,
    });
  }

  return {
    clock,
    store,
    broker,
    fabric,
    grant,
    registerCloudBody(input = {}) {
      const bodyId = input.bodyId ?? 'acceptance-cloud-shell';
      const body = new CloudCodingShellBody({
        bodyId,
        sandboxPolicy: input.sandboxPolicy ?? ACCEPTANCE_CLOUD_POLICY,
        placement: input.placement ?? 'cloud',
        secrets: input.secrets ?? { 'github-token': SECRET_TOKEN_VALUE },
      });
      register(body, bodyId, 'reference-cloud-shell', input.placement ?? 'cloud');
      return body;
    },
    registerBrowserBody(input = {}) {
      const bodyId = input.bodyId ?? 'acceptance-browser-evaluator';
      const body = new BrowserEvaluatorBody({
        bodyId,
        browserPort: new ScriptedBrowserPort(),
        allowedHosts: ['example.com'],
      });
      register(body, bodyId, 'reference-browser-evaluator', 'cloud');
      return body;
    },
    registerGitHubBody(input = {}) {
      const bodyId = input.bodyId ?? 'acceptance-github-project';
      const repository = { owner: 'acme', name: 'legacy-checkout' };
      const baseSha = 'c0ffee10d5c0a11b2c3d4e5f60718293a4b5c6d7';
      const operations = new InMemoryGitHubRepositoryOperations({
        repository,
        branches: [{ name: 'main', head_sha: baseSha, is_protected: true }],
      });
      if (input.connected === true) {
        operations.completeConnection({ authorization_code: 'simulated-acceptance-code', completed_at: '2025-06-15T12:00:00Z' });
      }
      const credentialName = input.credentialName ?? 'github-token';
      const body = new GitHubProjectBody({
        bodyId,
        repositoryOperations: operations,
        repository,
        baseBranch: 'main',
        baseSha,
        sandboxPolicy: {
          filesystem: { mode: 'workspace', root: `/workspace/${bodyId}` },
          network: { egress: 'allowlist', allowedHosts: ['api.github.com'] },
          secrets: credentialName === null ? [] : [credentialName],
          budgets: { fileWrites: 50, fileBytes: 100_000, shellCommands: 50, networkCalls: 50, secretReveals: 50 },
          resourceEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 1024 },
        },
        credentialName,
        secrets: credentialName === null ? {} : { 'github-token': SECRET_TOKEN_VALUE },
      });
      register(body, bodyId, 'reference-github-project', 'cloud');
      return { body, operations };
    },
    registerAdapterServedCloudBody(input) {
      const body = new CloudCodingShellBody({
        bodyId: input.bodyId,
        sandboxPolicy: input.sandboxPolicy ?? ACCEPTANCE_CLOUD_POLICY,
        placement: 'cloud',
        secrets: { 'github-token': SECRET_TOKEN_VALUE },
      });
      const spec: HarnessAdapterSpec = {
        adapterId: `adapter-${input.bodyId}`,
        provider: { name: input.providerName ?? 'reference-adapter-vendor', version: '1.0.0' },
        placement: 'cloud',
        capabilities: body.capabilities(),
        connection: simulatedAdapterConnection(),
      };
      let harness: HarnessContract;
      let adapterTier: 'native-api' | 'mcp-protocol' | 'local-bridge';
      if (input.adapterKind === 'native-api') {
        harness = new NativeApiHarnessAdapter(inProcessNativeApiTransport(body), spec).harness();
        adapterTier = 'native-api';
      } else if (input.adapterKind === 'mcp-protocol') {
        harness = new McpHarnessAdapter(inProcessMcpTransport(body), spec).harness();
        adapterTier = 'mcp-protocol';
      } else {
        harness = new LocalBridgeHarnessAdapter(inProcessLocalBridgeTransport(body), spec).harness();
        adapterTier = 'local-bridge';
      }
      register(harness, input.bodyId, `adapter-served-${input.adapterKind}`, 'cloud');
      return { body, adapterTier };
    },
    async createTask(input = {}): Promise<TaskRecord> {
      const effectiveGrant = input.grant ?? grant;
      await store.authorityGrants.put(effectiveGrant);
      const created = await fabric.createBoundedTask({
        task_id: input.task_id ?? 'task-acceptance-0001',
        mission_ref: MISSION_REF,
        plan: { steps: ['prepare-workspace', 'implement', 'commit', 'report'] },
        grant_refs: [effectiveGrant.envelope.id],
        requirements:
          input.requirements ?? { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'], placement: 'cloud' },
        holder: 'spirit:persistent',
        expires_at: input.leaseExpiresAt === null || input.leaseExpiresAt === undefined ? null : formatRfc3339(input.leaseExpiresAt),
      });
      if (created.status !== 'CREATED') {
        throw new Error(`acceptance task creation failed: ${JSON.stringify(created)}`);
      }
      return created.task;
    },
  };
}
