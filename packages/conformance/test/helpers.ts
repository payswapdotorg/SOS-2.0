import { createHash } from 'node:crypto';
import type { GraphEdge, GraphNode, GraphShape } from '@sos-2/architecture';
import { createArchitectureGraph } from '@sos-2/architecture';
import type { ImplementationModel } from '@sos-2/semantic-spine';
import type { SystemStateRevisionRef } from '@sos-2/system-state';

export function hex32(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

export const SYSTEM_STATE_ID = `sos://SystemState/${hex32('w2-conformance-system-state')}`;
export const PROJECTS: SystemStateRevisionRef = { system_state_id: SYSTEM_STATE_ID, version: 1 };
export const CREATED_AT = '2025-06-01T00:00:00.000Z';
export const PROVENANCE = ['W2:conformance-fixture'];
export const MODEL_ID = `sos://ImplementationModel/${hex32('w2-conformance-model')}`;
export const MODEL_REVISION = 'f' + 'e'.repeat(39);

export function nodeOf(id: string, kind: string, criticality: 'critical' | 'normal' = 'normal'): GraphNode {
  return { id, kind, criticality, attributes: {} };
}

export function edgeOf(source: string, target: string, kind: string, criticality: 'critical' | 'normal' = 'normal'): GraphEdge {
  return { source, target, kind, criticality, attributes: {} };
}

/**
 * The reconciliation fixture graph: matches, drift, contradiction and
 * preserving-refinement subjects (see reconcile.test.ts for the expected
 * findings).
 */
export function declaredGraphNodes(): GraphNode[] {
  return [
    nodeOf('component:billing', 'Component'),
    nodeOf('component:invoice-mailer', 'Component'),
    nodeOf('component:legacy-exports', 'Component'),
    nodeOf('store:audit-log', 'DataStore', 'critical'),
    nodeOf('iface:billing-api', 'Interface'),
    nodeOf('store:billing-records', 'DataStore'),
  ];
}

export function declaredGraphEdges(): GraphEdge[] {
  return [
    edgeOf('component:billing', 'component:invoice-mailer', 'Dependency'),
    edgeOf('component:billing', 'store:billing-records', 'Owns'),
    edgeOf('component:legacy-exports', 'component:billing', 'Dependency'),
    edgeOf('component:billing', 'store:audit-log', 'Owns', 'critical'),
  ];
}

export function createDeclaredGraphArtifact() {
  return createArchitectureGraph({
    projects_system_state: PROJECTS,
    nodes: declaredGraphNodes().map((node) => ({ ...node })),
    edges: declaredGraphEdges().map((edge) => ({ ...edge })),
    provenance: PROVENANCE,
    created_at: CREATED_AT,
    status: 'ACTIVE',
  });
}

export function observedModel(): ImplementationModel {
  return {
    id: MODEL_ID,
    revision: MODEL_REVISION,
    components: [
      { id: 'component:billing', kind: 'service', realized_by: [], realizes: [] },
      { id: 'component:invoice-mailer', kind: 'service', realized_by: [], realizes: [] },
      { id: 'component:billing-store-shard-a', kind: 'library', realized_by: [], realizes: ['store:billing-records'] },
      { id: 'component:billing-store-shard-b', kind: 'library', realized_by: [], realizes: ['store:billing-records'] },
      { id: 'component:billing-utils', kind: 'library', realized_by: [], realizes: [] },
    ],
    source_artifacts: [
      { path: 'packages/billing/src/index.ts', revision: MODEL_REVISION },
    ],
    interfaces: [
      { id: 'iface:billing-api', provider: 'component:billing', contract_ref: null, consumers: ['component:invoice-mailer'] },
    ],
    dependencies: [
      { source: 'component:billing', target: 'component:invoice-mailer', kind: 'uses' },
      { source: 'component:billing', target: 'store:billing-records', kind: 'owns' },
      { source: 'component:billing', target: 'component:billing-store-shard-a', kind: 'uses' },
    ],
    tests: [{ id: 'test:billing', subject: 'component:billing', framework: 'vitest' }],
    builds: [{ id: 'build:1', source_revision: MODEL_REVISION, outputs: ['dist/'], reproducible: true }],
    deployments: [{ id: 'deploy:1', build_id: 'build:1', environment: 'production', revision: MODEL_REVISION }],
    runtime_mappings: [{ id: 'rt:billing', component: 'component:billing', runtime_ref: 'proc://billing', environment: 'production' }],
  };
}

export function invariantGraph(): GraphShape {
  return {
    nodes: [
      nodeOf('component:checkout', 'Component'),
      nodeOf('component:payment', 'Component'),
      nodeOf('component:stripe-adapter', 'Adapter'),
      nodeOf('iface:checkout-api', 'Interface'),
      nodeOf('iface:payment-api', 'Interface'),
      nodeOf('store:orders', 'DataStore'),
      nodeOf('store:payments', 'DataStore'),
    ],
    edges: [
      edgeOf('component:checkout', 'iface:checkout-api', 'Provides'),
      edgeOf('component:payment', 'iface:payment-api', 'Provides'),
      edgeOf('component:checkout', 'iface:payment-api', 'Consumes'),
      edgeOf('component:checkout', 'store:orders', 'Owns'),
      edgeOf('component:checkout', 'component:payment', 'Dependency'),
      edgeOf('component:payment', 'store:payments', 'Owns'),
      edgeOf('component:stripe-adapter', 'component:payment', 'Dependency'),
    ],
  };
}
