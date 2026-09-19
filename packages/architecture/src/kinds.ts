/**
 * Node and edge kind registries for the Architecture Graph.
 *
 * The ten §5 categories of spec/architecture.md ("capabilities, components,
 * interfaces, data stores, deployment, trust, policies, models, adapters and
 * dependencies") are realized as:
 *
 *   - NODE kinds (9): Capability, Component, Interface, DataStore,
 *     Deployment, Trust, Policy, Model, Adapter.
 *   - EDGE kinds (8): Dependency (the tenth §5 category), Provides,
 *     Consumes, Owns, DeploysTo, Trusts, Constrains, Realizes.
 *
 * Both registries follow the SAME pattern as the spine's artifact kinds
 * (@sos-2/contracts createKindRegistry): seeded canonical vocabulary,
 * explicit registration API, no unregister, PascalCase names, sorted
 * deterministic listing. Extension is explicit and loud — never silent.
 */

import { createKindRegistry } from '@sos-2/semantic-spine';
import type { KindRegistry } from '@sos-2/semantic-spine';

// ---------------------------------------------------------------------------
// Node kinds
// ---------------------------------------------------------------------------

export const CORE_NODE_KINDS = [
  'Capability',
  'Component',
  'Interface',
  'DataStore',
  'Deployment',
  'Trust',
  'Policy',
  'Model',
  'Adapter',
] as const;

export type CoreNodeKind = (typeof CORE_NODE_KINDS)[number];

export type NodeKind = CoreNodeKind | (string & {});

/** The default (process-wide) node kind registry, seeded with the 9 §5 categories. */
const defaultNodeRegistry: KindRegistry = createKindRegistry(CORE_NODE_KINDS);

/** Register a node kind extension (throws on invalid format or duplicates). */
export function registerNodeKind(kind: string): void {
  defaultNodeRegistry.register(kind);
}

export function isRegisteredNodeKind(kind: string): boolean {
  return defaultNodeRegistry.isRegistered(kind);
}

export function listNodeKinds(): string[] {
  return defaultNodeRegistry.list();
}

/** Build an isolated node kind registry (tests, sandboxes). */
export function createIsolatedNodeKindRegistry(seed: readonly string[] = CORE_NODE_KINDS): KindRegistry {
  return createKindRegistry(seed);
}

// ---------------------------------------------------------------------------
// Edge kinds
// ---------------------------------------------------------------------------

export const CORE_EDGE_KINDS = [
  'Dependency',
  'Provides',
  'Consumes',
  'Owns',
  'DeploysTo',
  'Trusts',
  'Constrains',
  'Realizes',
] as const;

export type CoreEdgeKind = (typeof CORE_EDGE_KINDS)[number];

export type EdgeKind = CoreEdgeKind | (string & {});

/**
 * Edge semantics (documented realization of the §5 categories):
 *   - Dependency:  component -> component dependency (the "dependencies" category)
 *   - Provides:    component -> interface exposure
 *   - Consumes:    component -> interface consumption
 *   - Owns:        component -> data store ownership (exactly one owner per store;
 *                  checked by the DATA_OWNERSHIP invariant in @sos-2/conformance)
 *   - DeploysTo:   component/adapter -> deployment topology
 *   - Trusts:      trust relationship between nodes (trust category)
 *   - Constrains:  policy -> node constraint (policies category)
 *   - Realizes:    component -> capability realization (capabilities category)
 */

/** The default (process-wide) edge kind registry, seeded with the 8 canonical kinds. */
const defaultEdgeRegistry: KindRegistry = createKindRegistry(CORE_EDGE_KINDS);

/** Register an edge kind extension (throws on invalid format or duplicates). */
export function registerEdgeKind(kind: string): void {
  defaultEdgeRegistry.register(kind);
}

export function isRegisteredEdgeKind(kind: string): boolean {
  return defaultEdgeRegistry.isRegistered(kind);
}

export function listEdgeKinds(): string[] {
  return defaultEdgeRegistry.list();
}

/** Build an isolated edge kind registry (tests, sandboxes). */
export function createIsolatedEdgeKindRegistry(seed: readonly string[] = CORE_EDGE_KINDS): KindRegistry {
  return createKindRegistry(seed);
}
