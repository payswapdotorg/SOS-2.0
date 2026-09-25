/**
 * The deterministic world of the real-bodies suites (Work Order P17-B):
 * the full composition — durable P2 stores, the authority grant, the P5
 * body broker + execution fabric — with BOTH the reference cloud body
 * (@sos-2/body-runtimes) and the REAL hosted coding-harness body
 * (@sos-2/real-bodies, scripted model port), assembled exactly the way
 * the product composes them: offline, injected ManualClock, fixed seed.
 */

import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { BodyBroker } from '@sos-2/body-broker';
import { CloudCodingShellBody } from '@sos-2/body-runtimes';
import { ExecutionFabric } from '@sos-2/execution-fabric';
import { ManualClock, createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import type { TaskRecord } from '@sos-2/live-store';
import { HostedCodingBody, ScriptedHostedModelPort } from '@sos-2/real-bodies';
import type { HostedModelPort, ScriptedModelEntry } from '@sos-2/real-bodies';
import type { SandboxPolicy } from '@sos-2/sandbox';
import type { HarnessCapability, HarnessContract } from '@sos-2/harness';
import type { BodySelectionRequirements } from '@sos-2/body-broker';
import type { JsonValue } from '@sos-2/semantic-spine';

export const T0 = Date.parse('2026-09-25T12:00:00Z');
export const MISSION_REF = `sos://Mission/${'b7c8d9e0'.repeat(4)}`;

/** The sandbox policy of the hosted coding bodies (the REAL egress allowlist: the model provider only). */
export const HOSTED_BODY_POLICY: SandboxPolicy = {
  filesystem: { mode: 'workspace', root: '/workspace/hosted-coding' },
  network: { egress: 'allowlist', allowedHosts: ['openrouter.ai'] },
  secrets: ['openrouter-api-key'],
  budgets: { fileWrites: 50, fileBytes: 200_000, shellCommands: 50, networkCalls: 20, secretReveals: 10 },
  resourceEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 1024 },
};

/** The reference body's sandbox policy (the P8 acceptance policy shape). */
export const REFERENCE_BODY_POLICY: SandboxPolicy = {
  filesystem: { mode: 'workspace', root: '/workspace/reference-cloud' },
  network: { egress: 'allowlist', allowedHosts: ['api.github.com'] },
  secrets: ['github-token'],
  budgets: { fileWrites: 50, fileBytes: 100_000, shellCommands: 50, networkCalls: 50, secretReveals: 50 },
  resourceEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 1024 },
};

/** The deterministic work program used by the suites. */
export const WORK_PROGRAM = {
  goal: 'Write the module src/greeting.ts exporting function greet(name: string): string returning "Hello, " + name.',
  deliverable_path: 'src/greeting.ts',
};

/**
 * The default bounded-task plan — the fabric hands the PLAN to the
 * body's createTask as its input, so the work program rides inside it
 * (the §6 plan shape is opaque canonical JSON; the work program is its
 * goal-carrying head).
 */
export const DEFAULT_PLAN = {
  ...WORK_PROGRAM,
  steps: ['summon-body', 'run-work-program', 'collect-evidence', 'evaluate'],
};

/** One scripted successful model response (the work-program protocol). */
export function scriptedModelFilesResponse(files: { path: string; contents: string }[], summary: string): ScriptedModelEntry {
  return {
    respond: {
      id: 'scripted-model-response-0001',
      model: 'openai/gpt-5.1-codex-mini',
      content: JSON.stringify({ files, summary }),
      finish_reason: 'stop',
      usage: { prompt_tokens: 111, completion_tokens: 222, total_tokens: 333 },
    },
  };
}

export interface RealBodiesWorld {
  readonly clock: ManualClock;
  readonly store: ReturnType<typeof createInMemoryLiveStore>;
  readonly broker: BodyBroker;
  readonly fabric: ExecutionFabric;
  readonly grant: AuthorityGrantArtifact;
  registerHostedBody(input?: {
    bodyId?: string;
    modelEntries?: readonly ScriptedModelEntry[];
    modelPort?: HostedModelPort;
    placement?: 'cloud' | 'remote' | 'user-device';
  }): { body: HostedCodingBody; modelPort: ScriptedHostedModelPort | HostedModelPort };
  registerReferenceBody(input?: { bodyId?: string }): CloudCodingShellBody;
  createTask(input?: {
    task_id?: string;
    bodyId?: string;
    plan?: JsonValue;
    input?: unknown;
    requirements?: BodySelectionRequirements;
  }): Promise<TaskRecord>;
}

export function realBodiesWorld(): RealBodiesWorld {
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
    provenance: ['p17b-real-bodies-suite'],
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
    registerHostedBody(input = {}) {
      const bodyId = input.bodyId ?? 'p17b-openrouter-hosted-coding';
      const modelPort = input.modelPort ?? new ScriptedHostedModelPort(
        input.modelEntries ?? [
          scriptedModelFilesResponse(
            [{ path: 'src/greeting.ts', contents: 'export function greet(name: string): string {\n  return "Hello, " + name;\n}\n' }],
            'wrote the requested module',
          ),
        ],
      );
      const body = new HostedCodingBody({
        bodyId,
        modelPort,
        sandboxPolicy: HOSTED_BODY_POLICY,
        placement: input.placement ?? 'cloud',
        provider: { name: 'openrouter-hosted-coding', version: '1.0.0' },
        secrets: { 'openrouter-api-key': 'sk-or-scripted-never-echoed' },
      });
      register(body, bodyId, 'openrouter-hosted-coding', input.placement ?? 'cloud');
      return { body, modelPort };
    },
    registerReferenceBody(input = {}) {
      const bodyId = input.bodyId ?? 'reference-cloud-shell';
      const body = new CloudCodingShellBody({
        bodyId,
        sandboxPolicy: REFERENCE_BODY_POLICY,
        placement: 'cloud',
        secrets: { 'github-token': 'ref-secret-never-echoed' },
      });
      register(body, bodyId, 'reference-cloud-shell', 'cloud');
      return body;
    },
    async createTask(input = {}) {
      await store.authorityGrants.put(grant);
      const created = await fabric.createBoundedTask({
        task_id: input.task_id ?? 'task-p17b-0001',
        mission_ref: MISSION_REF,
        plan: input.plan ?? DEFAULT_PLAN,
        grant_refs: [grant.envelope.id],
        requirements:
          input.requirements ?? { requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'] as HarnessCapability[], placement: 'cloud' },
        holder: 'spirit:persistent',
        expires_at: null,
      });
      if (created.status !== 'CREATED') {
        throw new Error(`task creation failed: ${JSON.stringify(created)}`);
      }
      return created.task;
    },
  };
}
