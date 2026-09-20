import { createHash } from 'node:crypto';
import { createArchitectureGraph } from '@sos-2/architecture';
import type { GraphEdge, GraphNode } from '@sos-2/architecture';
import type { ImplementationModel } from '@sos-2/semantic-spine';
import type { SystemStateRevisionRef } from '@sos-2/system-state';

export function hex32(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

export const SYSTEM_STATE_ID = `sos://SystemState/${hex32('w4-recovery-system-state')}`;
export const PROJECTS: SystemStateRevisionRef = { system_state_id: SYSTEM_STATE_ID, version: 1 };
export const CREATED_AT = '2025-06-01T00:00:00.000Z';
export const PROVENANCE = ['W4:recovery-fixture'];
export const MODEL_ID = `sos://ImplementationModel/${hex32('w4-recovery-model')}`;
export const MODEL_REVISION = 'f' + 'e'.repeat(39);

export function nodeOf(id: string, kind: string, criticality: 'critical' | 'normal' = 'normal'): GraphNode {
  return { id, kind, criticality, attributes: {} };
}

export function edgeOf(
  source: string,
  target: string,
  kind: string,
  criticality: 'critical' | 'normal' = 'normal',
): GraphEdge {
  return { source, target, kind, criticality, attributes: {} };
}

export function emptyModel(id: string, revision: string): ImplementationModel {
  return {
    id,
    revision,
    components: [],
    source_artifacts: [],
    interfaces: [],
    dependencies: [],
    tests: [],
    builds: [],
    deployments: [],
    runtime_mappings: [],
  };
}

/**
 * An UNAMBIGUOUS observed model: single-candidate kinds ('library' ->
 * Component), no realizes, no grouped realizations -> exactly one DIRECT
 * hypothesis.
 */
export function unambiguousModel(): ImplementationModel {
  return {
    id: MODEL_ID,
    revision: MODEL_REVISION,
    components: [
      { id: 'component:billing', kind: 'library', realized_by: [], realizes: [] },
      { id: 'component:mailer', kind: 'library', realized_by: [], realizes: [] },
    ],
    source_artifacts: [{ path: 'packages/billing/src/index.ts', revision: MODEL_REVISION }],
    interfaces: [],
    dependencies: [{ source: 'component:billing', target: 'component:mailer', kind: 'uses' }],
    tests: [],
    builds: [],
    deployments: [],
    runtime_mappings: [],
  };
}

/**
 * An AMBIGUOUS observed model: kind 'service' (Component | Adapter) plus
 * grouped realizations (shards realizing store:billing-records) ->
 * 2 assignment vectors x 2 strategies = 4 hypotheses.
 */
export function ambiguousModel(): ImplementationModel {
  return {
    id: MODEL_ID,
    revision: MODEL_REVISION,
    components: [
      { id: 'component:billing', kind: 'service', realized_by: [], realizes: [] },
      { id: 'component:mailer', kind: 'library', realized_by: [], realizes: [] },
      { id: 'component:billing-store-shard-a', kind: 'library', realized_by: [], realizes: ['store:billing-records'] },
      { id: 'component:billing-store-shard-b', kind: 'library', realized_by: [], realizes: ['store:billing-records'] },
    ],
    source_artifacts: [],
    interfaces: [
      { id: 'iface:billing-api', provider: 'component:billing', contract_ref: null, consumers: ['component:mailer'] },
    ],
    dependencies: [
      { source: 'component:billing', target: 'component:billing-store-shard-a', kind: 'uses' },
      { source: 'component:billing', target: 'store:billing-records', kind: 'uses' },
    ],
    tests: [],
    builds: [],
    deployments: [],
    runtime_mappings: [],
  };
}

/**
 * The declared graph for comparisons: a conformant core (billing/mailer),
 * drift and contradiction subjects, a critical store realized by shards,
 * and a declared interface node the interface projection can match.
 */
export function declaredGraphNodes(): GraphNode[] {
  return [
    nodeOf('component:billing', 'Component'),
    nodeOf('component:mailer', 'Component'),
    nodeOf('store:billing-records', 'DataStore'),
    nodeOf('store:audit-log', 'DataStore', 'critical'),
    nodeOf('iface:billing-api', 'Interface'),
    nodeOf('component:legacy-exports', 'Component'),
  ];
}

export function declaredGraphEdges(): GraphEdge[] {
  return [
    edgeOf('component:billing', 'component:mailer', 'Dependency'),
    edgeOf('component:billing', 'store:billing-records', 'Owns'),
    edgeOf('component:billing', 'iface:billing-api', 'Provides'),
    edgeOf('component:legacy-exports', 'component:billing', 'Dependency'),
  ];
}

export function createDeclaredGraphArtifact() {
  return createArchitectureGraph({
    projects_system_state: PROJECTS,
    nodes: declaredGraphNodes().map((node) => ({ ...node })),
    edges: declaredGraphEdges().map((edge) => ({ ...edge })),
    provenance: ['W4:recovery-fixture:declared'],
    created_at: CREATED_AT,
    status: 'ACTIVE',
  });
}
