/**
 * ADVERSARIAL CLASS 10 — ARCHITECTURAL DRIFT (conformance classifies + drift
 * evidence).
 *
 * The fault: the observed implementation has drifted from the declared
 * architecture (a normal declared node lost its realizer, a critical node is
 * gone entirely, kinds mismatch, undeclared components appeared). The system
 * must CLASSIFY every difference into the frozen conformance classes with
 * typed drift evidence records (kind architecture-drift, availability
 * SUCCESS, classification DRIFT/CONTRADICTION) + CONTRADICTS trace links —
 * never average, hide or guess — and the trace chain stays queryable.
 */

import { describe, expect, test } from 'vitest';
import { createArchitectureGraph } from '@sos-2/architecture';
import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import { checkInvariant, reconcile } from '@sos-2/conformance';
import type { ImplementationModel } from '@sos-2/semantic-spine';
import { buildGraphContent } from '@sos-2/architecture';
import { createEnvelope, deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { ADVERSARIAL_ANCHOR, ADVERSARIAL_PROVENANCE, T0, assertTraceQueryable } from './helpers.js';

const PROJECTS = {
  system_state_id: deriveDeterministicArtifactId('SystemState', { note: 'adversarial-10-state' }),
  version: 1,
};

function declaredGraph(): ArchitectureGraphArtifact {
  const content = buildGraphContent({
    projects_system_state: PROJECTS,
    nodes: [
      { id: 'capability:checkout', kind: 'Capability', criticality: 'critical', attributes: {} },
      { id: 'component:checkout-api', kind: 'Component', criticality: 'normal', attributes: {} },
      { id: 'component:payment', kind: 'Component', criticality: 'critical', attributes: {} },
      { id: 'store:orders', kind: 'DataStore', criticality: 'critical', attributes: {} },
      { id: 'iface:checkout-api', kind: 'Interface', criticality: 'normal', attributes: {} },
      // 'component:reporting' — declared, will have NO realizer (DRIFT).
      { id: 'component:reporting', kind: 'Component', criticality: 'normal', attributes: {} },
    ],
    edges: [
      { source: 'component:checkout-api', target: 'capability:checkout', kind: 'Realizes' },
      { source: 'component:checkout-api', target: 'iface:checkout-api', kind: 'Provides' },
      { source: 'component:checkout-api', target: 'component:payment', kind: 'Dependency' },
      { source: 'component:payment', target: 'store:orders', kind: 'Owns' },
      { source: 'component:reporting', target: 'component:checkout-api', kind: 'Dependency' },
    ],
  });
  return {
    envelope: createEnvelope({
      kind: 'ArchitectureGraph',
      version: 1,
      status: 'ACTIVE',
      authority_ref: ADVERSARIAL_ANCHOR,
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:10:declared-architecture'],
      created_at: T0,
    }),
    content,
  };
}

function driftedModel(): ImplementationModel {
  return {
    id: deriveDeterministicArtifactId('ImplementationModel', { note: 'adversarial-10-drifted-model' }),
    revision: 'git:31f2a9c07d9e5b864a2c0f7d3e8b1a6c95d4f0e2',
    components: [
      // 'component:checkout-api' — realized by refinement (PRESERVING_REFINEMENT).
      { id: 'component:checkout-api-v2', kind: 'service', realized_by: ['src/checkout-v2/index.ts'], realizes: ['component:checkout-api'] },
      // 'component:payment' — KIND MISMATCH (an Adapter where a Component
      // was declared; both registered kinds, so the difference is real) => UNKNOWN.
      { id: 'component:payment', kind: 'Adapter', realized_by: ['src/payment/adapter.ts'], realizes: [] },
      // 'store:orders' — MISSING entirely (declared critical node, no realizer) => CONTRADICTION.
      // 'component:reporting' — MISSING (declared normal node, no realizer) => DRIFT.
      // 'component:shadow-scripts' — UNDECLARED => IMPLEMENTATION_DETAIL.
      { id: 'component:shadow-scripts', kind: 'library', realized_by: ['src/shadow/scripts.ts'], realizes: [] },
    ],
    source_artifacts: [
      { path: 'src/checkout-v2/index.ts', revision: 'git:31f2a9c07d9e5b864a2c0f7d3e8b1a6c95d4f0e2' },
      { path: 'src/payment/adapter.ts', revision: 'git:31f2a9c07d9e5b864a2c0f7d3e8b1a6c95d4f0e2' },
      { path: 'src/shadow/scripts.ts', revision: 'git:31f2a9c07d9e5b864a2c0f7d3e8b1a6c95d4f0e2' },
    ],
    interfaces: [],
    dependencies: [
      { source: 'component:checkout-api-v2', target: 'component:payment', kind: 'Dependency' },
    ],
    tests: [],
    builds: [],
    deployments: [],
    runtime_mappings: [],
  };
}

describe('adversarial class 10: architectural drift', () => {
  test('reconciliation CLASSIFIES every difference into the frozen classes (no hiding, no guessing)', () => {
    const declared = declaredGraph();
    const observed = driftedModel();
    const result = reconcile(observed, declared);
    const bySubject = new Map(result.records.map((record) => [record.subject, record.classification]));
    // The un-realized normal declared node is DRIFT.
    expect(bySubject.get('component:reporting')).toBe('DRIFT');
    // The missing CRITICAL declared node (store:orders) is CONTRADICTION.
    expect(bySubject.get('store:orders')).toBe('CONTRADICTION');
    // The declared node realized by a refinement component is
    // PRESERVING_REFINEMENT (the finding's subject is the DECLARED node).
    expect(bySubject.get('component:checkout-api')).toBe('PRESERVING_REFINEMENT');
    // The refinement component itself and the shadow scripts are undeclared
    // -> honest IMPLEMENTATION_DETAIL findings.
    expect(bySubject.get('component:checkout-api-v2')).toBe('IMPLEMENTATION_DETAIL');
    expect(bySubject.get('component:shadow-scripts')).toBe('IMPLEMENTATION_DETAIL');
    // The kind mismatch (an Adapter where a Component was declared) is UNKNOWN.
    expect(bySubject.get('component:payment')).toBe('UNKNOWN');
  });

  test('DRIFT and CONTRADICTION produce typed drift evidence records', () => {
    const declared = declaredGraph();
    const observed = driftedModel();
    const result = reconcile(observed, declared);
    // Every DRIFT/CONTRADICTION finding (node- AND edge-level) produces a
    // typed drift evidence record.
    expect(result.drift.length).toBeGreaterThanOrEqual(2);
    const bySubject = new Map(result.drift.map((entry) => [entry.subject, entry]));
    for (const drift of result.drift) {
      expect(drift.kind).toMatch(/^architecture-(drift|contradiction)$/);
      expect(drift.availability).toBe('SUCCESS');
      expect(drift.observational).toBe(true);
      expect(['DRIFT', 'CONTRADICTION']).toContain(drift.classification);
      expect(drift.subject.length).toBeGreaterThan(0);
      expect(drift.source_revision).toBe('git:31f2a9c07d9e5b864a2c0f7d3e8b1a6c95d4f0e2');
    }
    // The node-level findings carry their exact classifications.
    expect(bySubject.get('component:reporting')!.classification).toBe('DRIFT');
    expect(bySubject.get('store:orders')!.classification).toBe('CONTRADICTION');
    expect(result.drift.some((entry) => entry.classification === 'CONTRADICTION')).toBe(true);
    expect(result.drift.some((entry) => entry.classification === 'DRIFT')).toBe(true);
  });

  test('an invariant VIOLATION in the observed graph is a typed FAIL (not an error)', () => {
    const declared = declaredGraph();
    // FORBIDDEN_DEPENDENCY: Component -> DataStore Dependency edges are forbidden;
    // the observed model wires checkout-api-v2 -> component:payment
    // (observed kind 'datastore' -> normalized DataStore).
    const check = checkInvariant(
      { kind: 'FORBIDDEN_DEPENDENCY', fromKind: 'Component', toKind: 'DataStore' },
      {
        nodes: [
          { id: 'component:checkout-api-v2', kind: 'Component', criticality: 'normal', attributes: {} },
          { id: 'component:payment', kind: 'DataStore', criticality: 'critical', attributes: {} },
        ],
        edges: [
          { source: 'component:checkout-api-v2', target: 'component:payment', kind: 'Dependency', criticality: 'normal', attributes: {} },
        ],
      },
    );
    expect(check.status).toBe('FAIL');
    expect(check.evidence.length).toBeGreaterThan(0);
    expect(check.reason).toMatch(/forbidden/i);
    void declared;
  });

  test('the trace chain stays queryable after the drift classification (CONTRADICTS links)', () => {
    const declared = declaredGraph();
    const observed = driftedModel();
    const result = reconcile(observed, declared);
    // Drift/contradiction bind the observed model to the declared graph with
    // CONTRADICTS links; refinements with REFINES.
    const types = new Set(result.links.map((link) => link.type));
    expect(types.has('CONTRADICTS')).toBe(true);
    expect(types.has('REFINES')).toBe(true);
    for (const link of result.links) {
      expect(link.source).toBe(observed.id);
      expect(link.target).toBe(declared.envelope.id);
    }
    const { queryFrom, queryTo } = assertTraceQueryable(result.links);
    expect(queryFrom(observed.id).length).toBe(result.links.length);
    expect(queryTo(declared.envelope.id).length).toBe(result.links.length);
  });
});
