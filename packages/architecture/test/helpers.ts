import { createHash } from 'node:crypto';
import type {
  ArchitectureGraphArtifact,
  BuildEdgeInput,
  BuildNodeInput,
  GraphNode,
  GraphEdge,
} from '../src/index.js';
import { createArchitectureGraph } from '../src/index.js';
import type { SystemStateRevisionRef } from '@sos-2/system-state';

export function hex32(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

export const SYSTEM_STATE_ID = `sos://SystemState/${hex32('w2-fixture-system-state')}`;
export const AUTHORITY_ID = `sos://Constitution/${hex32('w2-fixture-constitution')}`;
export const PROJECTS: SystemStateRevisionRef = { system_state_id: SYSTEM_STATE_ID, version: 1 };

export const CREATED_AT = '2025-06-01T00:00:00.000Z';
export const PROVENANCE = ['W2:architecture-fixture'];

/** A graph exercising all nine §5 node kinds and all eight canonical edge kinds. */
export function fullGraphNodes(): BuildNodeInput[] {
  return [
    { id: 'capability:checkout', kind: 'Capability', attributes: { name: 'checkout' } },
    { id: 'component:checkout-service', kind: 'Component', attributes: { runtime: 'node' } },
    { id: 'component:payment-service', kind: 'Component', criticality: 'critical', attributes: {} },
    { id: 'iface:checkout-api', kind: 'Interface', attributes: { protocol: 'https' } },
    { id: 'iface:payment-api', kind: 'Interface', attributes: { protocol: 'grpc' } },
    { id: 'store:orders', kind: 'DataStore', attributes: { engine: 'postgres' } },
    { id: 'deploy:production', kind: 'Deployment', attributes: { region: 'eu-west-1' } },
    { id: 'trust:payment-processor', kind: 'Trust', attributes: { level: 'high' } },
    { id: 'policy:gdpr', kind: 'Policy', attributes: { jurisdiction: 'EU' } },
    { id: 'model:fraud-model', kind: 'Model', attributes: { version: '2.1' } },
    { id: 'adapter:stripe', kind: 'Adapter', attributes: { vendor: 'stripe' } },
  ];
}

export function fullGraphEdges(): BuildEdgeInput[] {
  return [
    { source: 'component:checkout-service', target: 'capability:checkout', kind: 'Realizes' },
    { source: 'component:payment-service', target: 'capability:checkout', kind: 'Realizes' },
    { source: 'component:checkout-service', target: 'iface:checkout-api', kind: 'Provides' },
    { source: 'component:payment-service', target: 'iface:payment-api', kind: 'Provides' },
    { source: 'component:checkout-service', target: 'iface:payment-api', kind: 'Consumes' },
    { source: 'component:checkout-service', target: 'store:orders', kind: 'Owns' },
    { source: 'component:checkout-service', target: 'deploy:production', kind: 'DeploysTo' },
    { source: 'component:payment-service', target: 'deploy:production', kind: 'DeploysTo' },
    { source: 'component:payment-service', target: 'trust:payment-processor', kind: 'Trusts' },
    { source: 'policy:gdpr', target: 'store:orders', kind: 'Constrains' },
    { source: 'component:checkout-service', target: 'component:payment-service', kind: 'Dependency' },
    { source: 'component:payment-service', target: 'adapter:stripe', kind: 'Dependency' },
  ];
}

export function createFullGraphArtifact(): ArchitectureGraphArtifact {
  return createArchitectureGraph({
    projects_system_state: PROJECTS,
    nodes: fullGraphNodes(),
    edges: fullGraphEdges(),
    provenance: PROVENANCE,
    created_at: CREATED_AT,
    authority_ref: AUTHORITY_ID,
    status: 'ACTIVE',
  });
}

/**
 * A bounded-candidate-friendly base graph: `component:billing` and
 * `component:invoice-mailer` both own/depend around `store:billing-records`.
 */
export function candidateBaseNodes(): BuildNodeInput[] {
  return [
    { id: 'component:billing', kind: 'Component', attributes: { runtime: 'node' } },
    { id: 'component:invoice-mailer', kind: 'Component', attributes: { runtime: 'node' } },
    { id: 'iface:billing-api', kind: 'Interface', attributes: { protocol: 'https' } },
    { id: 'store:billing-records', kind: 'DataStore', attributes: { engine: 'postgres' } },
    { id: 'deploy:production', kind: 'Deployment', attributes: { region: 'eu-west-1' } },
    { id: 'policy:retention', kind: 'Policy', attributes: { years: 7 } },
    { id: 'model:churn-model', kind: 'Model', attributes: { version: '1.0' } },
  ];
}

export function candidateBaseEdges(): BuildEdgeInput[] {
  return [
    { source: 'component:billing', target: 'iface:billing-api', kind: 'Provides' },
    { source: 'component:billing', target: 'store:billing-records', kind: 'Owns' },
    { source: 'component:invoice-mailer', target: 'store:billing-records', kind: 'Owns' },
    { source: 'component:billing', target: 'component:invoice-mailer', kind: 'Dependency' },
    { source: 'component:billing', target: 'deploy:production', kind: 'DeploysTo' },
    { source: 'component:invoice-mailer', target: 'deploy:production', kind: 'DeploysTo' },
    { source: 'policy:retention', target: 'store:billing-records', kind: 'Constrains' },
    { source: 'component:billing', target: 'model:churn-model', kind: 'Dependency' },
  ];
}

export function createCandidateBaseArtifact(): ArchitectureGraphArtifact {
  return createArchitectureGraph({
    projects_system_state: PROJECTS,
    nodes: candidateBaseNodes(),
    edges: candidateBaseEdges(),
    provenance: PROVENANCE,
    created_at: CREATED_AT,
    status: 'ACTIVE',
  });
}

export function nodeOf(id: string, kind: string, attributes: Record<string, unknown> = {}): GraphNode {
  return { id, kind, criticality: 'normal', attributes: attributes as GraphNode['attributes'] };
}

export function edgeOf(source: string, target: string, kind: string): GraphEdge {
  return { source, target, kind, criticality: 'normal', attributes: {} };
}
