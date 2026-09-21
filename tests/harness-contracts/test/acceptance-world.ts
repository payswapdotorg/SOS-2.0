/**
 * The acceptance world (Work Order P5): the full composition — durable
 * P2 stores, the authority grant, the body broker with reference bodies,
 * and the execution fabric — assembled exactly the way the product
 * composes them, deterministically (injected ManualClock, no network).
 */

import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { BodyBroker } from '@sos-2/body-broker';
import { ExecutionFabric } from '@sos-2/execution-fabric';
import { ManualClock, createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import type { TaskRecord } from '@sos-2/live-store';
import type { HarnessCapability } from '@sos-2/harness';
import type { ReferenceBodyOptions } from './reference-body.js';
import { ReferenceBody } from './reference-body.js';

export const T0 = Date.parse('2026-01-15T09:00:00Z');
export const MISSION_REF = `sos://Mission/${'a2b3c4d5'.repeat(4)}`;

export interface AcceptanceWorld {
  readonly clock: ManualClock;
  readonly store: ReturnType<typeof createInMemoryLiveStore>;
  readonly broker: BodyBroker;
  readonly fabric: ExecutionFabric;
  readonly grant: AuthorityGrantArtifact;
  readonly bodies: ReferenceBody[];
  registerBody(options: ReferenceBodyOptions): ReferenceBody;
  createTask(input?: {
    task_id?: string;
    grant?: AuthorityGrantArtifact;
    requirements?: { requiredCapabilities: HarnessCapability[]; placement: 'cloud' | 'remote' | 'user-device' | null };
    leaseExpiresAt?: number | null;
  }): Promise<TaskRecord>;
}

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
    provenance: ['p5-acceptance-suite'],
    created_at: formatRfc3339(T0),
    status: 'ACTIVE',
  });
  const bodies: ReferenceBody[] = [];

  return {
    clock,
    store,
    broker,
    fabric,
    grant,
    bodies,
    registerBody(bodyOptions: ReferenceBodyOptions): ReferenceBody {
      const body = new ReferenceBody(bodyOptions);
      broker.registerBody({
        body_id: bodyOptions.bodyId,
        provider: { name: bodyOptions.providerName, version: bodyOptions.providerVersion ?? '1.0.0' },
        capabilities: body.capabilitiesValue,
        placement: bodyOptions.placement ?? 'cloud',
        harness: body,
      });
      bodies.push(body);
      return body;
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
