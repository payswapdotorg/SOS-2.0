import { createHash } from 'node:crypto';
import { createArchitectureGraph } from '@sos-2/architecture';
import type { ArchitectureGraphArtifact, GraphEdge, GraphNode } from '@sos-2/architecture';
import { createSystemState } from '@sos-2/system-state';
import type { SystemStateArtifact } from '@sos-2/system-state';
import type { EvidenceTruthState, RawObservation } from '../src/index.js';
import type { JsonValue } from '@sos-2/semantic-spine';
import type { Producer, TimeWindow } from '@sos-2/provenance';

export function hex32(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

export const CREATED_AT = '2025-06-01T00:00:00.000Z';
export const EVALUATED_AT = '2025-06-02T00:00:00.000Z';
export const IMPLEMENTATION_ID = `sos://ImplementationModel/${hex32('w4-rc-implementation')}`;
export const IMPLEMENTATION_REVISION = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
export const DEPLOYMENT_REVISION = 'dpl_7f3e2a1b9c';
export const WINDOW: TimeWindow = { start: '2025-06-01T00:00:00.000Z', end: '2025-06-01T01:00:00.000Z' };
export const LATER_WINDOW: TimeWindow = { start: '2025-06-01T02:00:00.000Z', end: '2025-06-01T03:00:00.000Z' };

export const PRODUCER: Producer = {
  tool: 'runtime-conformance-monitor',
  tool_version: '1.0.0',
  model: null,
  model_version: null,
  command: 'pnpm -r test',
  environment: 'ci:test',
};

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

/**
 * The declared architecture under test: checkout/payment components, a
 * payment API interface, orders/payments stores and a forbidden
 * UI->payment dependency rule.
 */
export function declaredGraphNodes(): GraphNode[] {
  return [
    nodeOf('component:checkout', 'Component'),
    nodeOf('component:payment', 'Component'),
    nodeOf('component:ui', 'Component'),
    nodeOf('iface:payment-api', 'Interface'),
    nodeOf('store:orders', 'DataStore'),
    nodeOf('store:payments', 'DataStore'),
  ];
}

export function declaredGraphEdges(): GraphEdge[] {
  return [
    edgeOf('component:payment', 'iface:payment-api', 'Provides'),
    edgeOf('component:checkout', 'store:orders', 'Owns'),
    edgeOf('component:payment', 'store:payments', 'Owns'),
    edgeOf('component:checkout', 'component:payment', 'Dependency'),
  ];
}

export function createDeclaredArchitecture(): ArchitectureGraphArtifact {
  return createArchitectureGraph({
    projects_system_state: {
      system_state_id: `sos://SystemState/${hex32('w4-rc-anchor-system-state')}`,
      version: 1,
    },
    nodes: declaredGraphNodes().map((node) => ({ ...node })),
    edges: declaredGraphEdges().map((edge) => ({ ...edge })),
    provenance: ['W4:runtime-conformance-fixture:declared'],
    created_at: CREATED_AT,
    status: 'ACTIVE',
  });
}

/**
 * The exact SystemState revision under evaluation, bound to the declared
 * architecture through architecture_ref (the constructible direction — the
 * reverse reference is a content-addressed fixed point, see evaluate.ts).
 */
export function createSystemStateFor(declared: ArchitectureGraphArtifact): SystemStateArtifact {
  return createSystemState({
    content: {
      architecture_ref: { artifact_id: declared.envelope.id, version: declared.envelope.version },
      implementation: [
        { artifact_id: IMPLEMENTATION_ID, revision: { kind: 'git-sha', value: IMPLEMENTATION_REVISION } },
      ],
      configuration: [{ config_id: 'checkout-config', revision: { kind: 'config-version', value: 'v42' } }],
      deployment: [
        {
          deployment_id: 'deploy-prod-2025-06-01',
          environment: 'production',
          revision: { kind: 'deployment-id', value: DEPLOYMENT_REVISION },
        },
      ],
      policy: [],
      environment_relationships: [],
      active_experiments: [],
      package_realizations: [],
    },
    provenance: ['W4:runtime-conformance-fixture:system-state'],
    created_at: CREATED_AT,
    status: 'ACTIVE',
  });
}

/** Build a raw runtime observation (telemetry-shaped, W3 contract). */
export function observation(
  subject: string,
  availability: EvidenceTruthState,
  attributes: Record<string, JsonValue> = {},
  window: TimeWindow = WINDOW,
): RawObservation {
  return {
    subject_ref: subject,
    availability,
    window,
    observed: null,
    attributes,
    producer: PRODUCER,
  };
}
