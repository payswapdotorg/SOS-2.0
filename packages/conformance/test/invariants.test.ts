import { describe, expect, it } from 'vitest';
import {
  checkInvariant,
  checkInvariants,
  isInvariantCheckResult,
  INVARIANT_KINDS,
  validateInvariant,
} from '../src/index.js';
import type { GraphShape, Invariant } from '../src/index.js';
import { edgeOf, invariantGraph, nodeOf } from './helpers.js';

describe('REQUIRED_INTERFACE', () => {
  const invariant: Invariant = { kind: 'REQUIRED_INTERFACE', componentKind: 'Component', interfaceId: 'iface:checkout-api' };

  it('FAILs when a component of the kind does not expose the interface', () => {
    const result = checkInvariant(invariant, invariantGraph());
    expect(result.status).toBe('FAIL');
    expect(result.evidence).toEqual(['component:payment']);
    expect(result.reason).toContain('do not expose interface "iface:checkout-api"');
    expect(isInvariantCheckResult(result)).toBe(true);
  });

  it('PASSes when every component of the kind exposes the interface', () => {
    const graph: GraphShape = {
      nodes: [nodeOf('component:a', 'Component'), nodeOf('component:b', 'Component'), nodeOf('iface:api', 'Interface')],
      edges: [
        edgeOf('component:a', 'iface:api', 'Provides'),
        edgeOf('component:b', 'iface:api', 'Provides'),
      ],
    };
    const result = checkInvariant({ kind: 'REQUIRED_INTERFACE', componentKind: 'Component', interfaceId: 'iface:api' }, graph);
    expect(result.status).toBe('PASS');
    expect(result.evidence).toEqual(['component:a', 'component:b']);
  });

  it('is NOT_APPLICABLE when no component of the kind exists', () => {
    const result = checkInvariant(
      { kind: 'REQUIRED_INTERFACE', componentKind: 'Adapter', interfaceId: 'iface:checkout-api' },
      { nodes: [nodeOf('component:a', 'Component')], edges: [] },
    );
    expect(result.status).toBe('NOT_APPLICABLE');
    expect(result.evidence).toEqual([]);
  });

  it('FAILs with all subjects when the interface node does not exist', () => {
    const result = checkInvariant(
      { kind: 'REQUIRED_INTERFACE', componentKind: 'Component', interfaceId: 'iface:ghost' },
      invariantGraph(),
    );
    expect(result.status).toBe('FAIL');
    expect(result.evidence).toEqual(['component:checkout', 'component:payment']);
    expect(result.reason).toContain('is not present in the graph');
  });
});

describe('FORBIDDEN_DEPENDENCY', () => {
  it('PASSes when nodes of both kinds exist and no forbidden edge exists', () => {
    const result = checkInvariant(
      { kind: 'FORBIDDEN_DEPENDENCY', fromKind: 'Component', toKind: 'Adapter' },
      invariantGraph(),
    );
    expect(result.status).toBe('PASS');
    expect(result.evidence).toEqual([]);
  });

  it('FAILs when a forbidden dependency edge exists', () => {
    const result = checkInvariant(
      { kind: 'FORBIDDEN_DEPENDENCY', fromKind: 'Adapter', toKind: 'Component' },
      invariantGraph(),
    );
    expect(result.status).toBe('FAIL');
    expect(result.evidence).toEqual(['component:stripe-adapter->component:payment']);
    expect(result.reason).toContain('forbidden Dependency edge(s)');
  });

  it('is NOT_APPLICABLE when nodes of either kind are absent', () => {
    const result = checkInvariant(
      { kind: 'FORBIDDEN_DEPENDENCY', fromKind: 'Trust', toKind: 'Model' },
      invariantGraph(),
    );
    expect(result.status).toBe('NOT_APPLICABLE');
  });

  it('honors a custom edge kind', () => {
    const result = checkInvariant(
      { kind: 'FORBIDDEN_DEPENDENCY', fromKind: 'Component', toKind: 'Interface', edgeKind: 'Consumes' },
      invariantGraph(),
    );
    expect(result.status).toBe('FAIL');
    expect(result.evidence).toEqual(['component:checkout->iface:payment-api']);
  });
});

describe('LAYERING', () => {
  const layers: Invariant = { kind: 'LAYERING', layers: ['Interface', 'Component', 'Adapter'] };

  it('PASSes when dependencies only point downward', () => {
    const result = checkInvariant(layers, invariantGraph());
    expect(result.status).toBe('PASS');
    expect(result.evidence).toEqual([]);
    expect(result.reason).toContain('Interface, Component, Adapter');
  });

  it('FAILs on an upward dependency edge', () => {
    const graph: GraphShape = {
      nodes: [...invariantGraph().nodes],
      edges: [...invariantGraph().edges, edgeOf('iface:checkout-api', 'component:payment', 'Dependency')],
    };
    const result = checkInvariant(layers, graph);
    expect(result.status).toBe('FAIL');
    expect(result.evidence).toEqual(['iface:checkout-api->component:payment']);
    expect(result.reason).toContain('upward Dependency edge(s)');
  });

  it('ignores non-dependency edges and unlayered endpoints', () => {
    const graph: GraphShape = {
      nodes: invariantGraph().nodes,
      edges: [
        ...invariantGraph().edges,
        edgeOf('iface:checkout-api', 'store:orders', 'Provides'), // points upward but is not a Dependency edge
        edgeOf('store:orders', 'component:payment', 'Owns'), // unlayered source
      ],
    };
    const result = checkInvariant(layers, graph);
    expect(result.status).toBe('PASS');
  });

  it('is NOT_APPLICABLE when no nodes belong to any layer', () => {
    const result = checkInvariant(
      { kind: 'LAYERING', layers: ['Trust', 'Model'] },
      invariantGraph(),
    );
    expect(result.status).toBe('NOT_APPLICABLE');
  });
});

describe('DATA_OWNERSHIP', () => {
  it('PASSes when every data store has exactly one owner', () => {
    const result = checkInvariant({ kind: 'DATA_OWNERSHIP' }, invariantGraph());
    expect(result.status).toBe('PASS');
    expect(result.evidence).toEqual(['store:orders', 'store:payments']);
    expect(result.reason).toContain('exactly one component');
  });

  it('FAILs when a data store has zero owners', () => {
    const graph: GraphShape = {
      nodes: invariantGraph().nodes,
      edges: invariantGraph().edges.filter((edge) => !(edge.source === 'component:payment' && edge.target === 'store:payments')),
    };
    const result = checkInvariant({ kind: 'DATA_OWNERSHIP' }, graph);
    expect(result.status).toBe('FAIL');
    expect(result.evidence).toEqual(['store:payments']);
    expect(result.reason).toContain('0 owning component(s)');
  });

  it('FAILs when a data store has multiple owners', () => {
    const graph: GraphShape = {
      nodes: [...invariantGraph().nodes, nodeOf('component:auditor', 'Component')],
      edges: [...invariantGraph().edges, edgeOf('component:auditor', 'store:orders', 'Owns')],
    };
    const result = checkInvariant({ kind: 'DATA_OWNERSHIP' }, graph);
    expect(result.status).toBe('FAIL');
    expect(result.evidence).toEqual(['store:orders']);
    expect(result.reason).toContain('2 owning component(s)');
    expect(result.reason).toContain('component:auditor');
    expect(result.reason).toContain('component:checkout');
  });

  it('is NOT_APPLICABLE when no data stores exist', () => {
    const result = checkInvariant(
      { kind: 'DATA_OWNERSHIP' },
      { nodes: [nodeOf('component:a', 'Component')], edges: [] },
    );
    expect(result.status).toBe('NOT_APPLICABLE');
  });
});

describe('invariant contract', () => {
  it('exposes the frozen invariant kind vocabulary', () => {
    expect(INVARIANT_KINDS).toEqual(['REQUIRED_INTERFACE', 'FORBIDDEN_DEPENDENCY', 'LAYERING', 'DATA_OWNERSHIP']);
  });

  it('validates well-formed invariants', () => {
    expect(validateInvariant({ kind: 'DATA_OWNERSHIP' })).toBe(true);
    expect(validateInvariant({ kind: 'REQUIRED_INTERFACE', componentKind: 'Component', interfaceId: 'i' })).toBe(true);
    expect(validateInvariant({ kind: 'FORBIDDEN_DEPENDENCY', fromKind: 'A', toKind: 'B' })).toBe(true);
    expect(validateInvariant({ kind: 'LAYERING', layers: ['A', 'B'] })).toBe(true);
  });

  it('checks a list of invariants in order', () => {
    const results = checkInvariants(
      [
        { kind: 'DATA_OWNERSHIP' },
        { kind: 'FORBIDDEN_DEPENDENCY', fromKind: 'Adapter', toKind: 'Component' },
        { kind: 'LAYERING', layers: ['Interface', 'Component', 'Adapter'] },
      ],
      invariantGraph(),
    );
    expect(results.map((result) => result.status)).toEqual(['PASS', 'FAIL', 'PASS']);
    expect(results.every(isInvariantCheckResult)).toBe(true);
  });
});
