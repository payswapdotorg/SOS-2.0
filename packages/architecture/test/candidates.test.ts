import { describe, expect, it } from 'vitest';
import { applyLocalCandidate, validateLocalCandidate } from '../src/index.js';
import type { LocalCandidate } from '../src/index.js';
import { createCandidateBaseArtifact } from './helpers.js';

describe('local candidate application', () => {
  it('applies a bounded split-component candidate with declared incident edges', () => {
    const base = createCandidateBaseArtifact();
    const candidate: LocalCandidate = {
      baseGraphRef: { graph_id: base.envelope.id, version: base.envelope.version },
      boundedSubgraph: {
        nodes: ['component:billing'],
        edges: [
          { source: 'component:billing', target: 'iface:billing-api', kind: 'Provides' },
          { source: 'component:billing', target: 'store:billing-records', kind: 'Owns' },
          { source: 'component:billing', target: 'component:invoice-mailer', kind: 'Dependency' },
          { source: 'component:billing', target: 'deploy:production', kind: 'DeploysTo' },
          { source: 'component:billing', target: 'model:churn-model', kind: 'Dependency' },
        ],
      },
      replacement: [
        {
          op: 'SPLIT_COMPONENT',
          component: 'component:billing',
          into: [
            { id: 'component:billing-core', kind: 'Component', attributes: { runtime: 'node' } },
            { id: 'component:billing-reporting', kind: 'Component', attributes: { runtime: 'node' } },
          ],
          edges: [
            { source: 'component:billing-core', target: 'iface:billing-api', kind: 'Provides' },
            { source: 'component:billing-core', target: 'store:billing-records', kind: 'Owns' },
            { source: 'component:billing-core', target: 'deploy:production', kind: 'DeploysTo' },
            { source: 'component:billing-reporting', target: 'deploy:production', kind: 'DeploysTo' },
            { source: 'component:billing-core', target: 'component:billing-reporting', kind: 'Dependency' },
          ],
        },
      ],
      invariants: ['DATA_OWNERSHIP: every data store has exactly one owning component'],
      predictedEffects: ['billing reporting queries isolated from the billing core path'],
    };
    expect(validateLocalCandidate(candidate)).toBe(true);
    const { content, diff } = applyLocalCandidate(candidate, base);

    // split happened
    expect(content.nodes.map((n) => n.id)).toContain('component:billing-core');
    expect(content.nodes.map((n) => n.id)).toContain('component:billing-reporting');
    expect(content.nodes.map((n) => n.id)).not.toContain('component:billing');
    // the SystemState projection is preserved (architecture is still a
    // hypothesis over the SAME System State revision)
    expect(content.projects_system_state).toEqual(base.content.projects_system_state);
    // diff describes exactly the change
    expect(diff.removed_nodes.map((n) => n.id)).toEqual(['component:billing']);
    expect(diff.added_nodes.map((n) => n.id)).toEqual(['component:billing-core', 'component:billing-reporting']);
    expect(diff.removed_edges).toHaveLength(5);
    expect(diff.added_edges).toHaveLength(5);
  });

  it('applies a pure-addition candidate (no declared bounds needed)', () => {
    const base = createCandidateBaseArtifact();
    const candidate: LocalCandidate = {
      baseGraphRef: { graph_id: base.envelope.id, version: base.envelope.version },
      boundedSubgraph: { nodes: [], edges: [] },
      replacement: [
        {
          op: 'ADD_COMPONENT',
          node: { id: 'component:audit-log', kind: 'Component', attributes: {} },
          edges: [{ source: 'component:audit-log', target: 'deploy:production', kind: 'DeploysTo' }],
        },
      ],
      invariants: ['LAYERING: audit components never depend on interfaces they do not declare'],
      predictedEffects: ['+1 deployment unit'],
    };
    const { content, diff } = applyLocalCandidate(candidate, base);
    expect(content.nodes.map((n) => n.id)).toContain('component:audit-log');
    expect(diff.added_nodes.map((n) => n.id)).toEqual(['component:audit-log']);
    expect(diff.added_edges).toHaveLength(1);
    expect(diff.removed_nodes).toHaveLength(0);
  });

  it('applies merge, replace, remove, change and topology operators together', () => {
    const base = createCandidateBaseArtifact();
    const candidate: LocalCandidate = {
      baseGraphRef: { graph_id: base.envelope.id, version: base.envelope.version },
      boundedSubgraph: {
        nodes: [
          'component:billing',
          'component:invoice-mailer',
          'policy:retention',
          'model:churn-model',
          'store:billing-records',
        ],
        edges: [
          { source: 'component:billing', target: 'iface:billing-api', kind: 'Provides' },
          { source: 'component:billing', target: 'store:billing-records', kind: 'Owns' },
          { source: 'component:invoice-mailer', target: 'store:billing-records', kind: 'Owns' },
          { source: 'component:billing', target: 'component:invoice-mailer', kind: 'Dependency' },
          { source: 'component:billing', target: 'deploy:production', kind: 'DeploysTo' },
          { source: 'component:invoice-mailer', target: 'deploy:production', kind: 'DeploysTo' },
          { source: 'policy:retention', target: 'store:billing-records', kind: 'Constrains' },
          { source: 'component:billing', target: 'model:churn-model', kind: 'Dependency' },
        ],
      },
      replacement: [
        {
          op: 'MERGE_COMPONENTS',
          components: ['component:billing', 'component:invoice-mailer'],
          into: { id: 'component:billing-unified', kind: 'Component', attributes: { runtime: 'node' } },
          edges: [
            { source: 'component:billing-unified', target: 'iface:billing-api', kind: 'Provides' },
            { source: 'component:billing-unified', target: 'store:billing-records', kind: 'Owns' },
          ],
        },
        {
          op: 'CHANGE_POLICY',
          target: 'policy:retention',
          attributes: { years: 10 },
        },
        {
          op: 'CHANGE_MODEL',
          target: 'model:churn-model',
          attributes: { version: '2.0' },
          criticality: 'critical',
        },
        {
          op: 'CHANGE_TOPOLOGY',
          add: [
            { source: 'component:billing-unified', target: 'deploy:production', kind: 'DeploysTo', attributes: { tier: 'blue' } },
          ],
          remove: [],
        },
      ],
      invariants: ['DATA_OWNERSHIP: exactly one owner per data store'],
      predictedEffects: ['fewer deploy units', 'retention extended to 10 years'],
    };
    const { content, diff } = applyLocalCandidate(candidate, base);
    expect(content.nodes.map((n) => n.id)).toContain('component:billing-unified');
    expect(content.nodes.map((n) => n.id)).not.toContain('component:billing');
    expect(content.nodes.map((n) => n.id)).not.toContain('component:invoice-mailer');
    const policy = content.nodes.find((n) => n.id === 'policy:retention')!;
    expect(policy.attributes).toEqual({ years: 10 });
    const model = content.nodes.find((n) => n.id === 'model:churn-model')!;
    expect(model.criticality).toBe('critical');
    expect(diff.modified_nodes.map((m) => m.id)).toContain('policy:retention');
    expect(diff.modified_nodes.map((m) => m.id)).toContain('model:churn-model');
    expect(diff.removed_nodes.map((n) => n.id).sort()).toEqual(['component:billing', 'component:invoice-mailer']);
    expect(diff.added_nodes.map((n) => n.id)).toEqual(['component:billing-unified']);
    // 7 base edges were incident to the two merged components and removed;
    // 3 replacement edges were added (two by MERGE, one by CHANGE_TOPOLOGY).
    expect(diff.removed_edges).toHaveLength(7);
    expect(diff.added_edges).toHaveLength(3);
    expect(
      diff.added_edges.some(
        (e) => e.source === 'component:billing-unified' && e.target === 'deploy:production' && e.attributes['tier'] === 'blue',
      ),
    ).toBe(true);
  });

  it('applies REMOVE_COMPONENT and CHANGE_INTERFACE / CHANGE_DATA_STORE operators', () => {
    const base = createCandidateBaseArtifact();
    const candidate: LocalCandidate = {
      baseGraphRef: { graph_id: base.envelope.id, version: base.envelope.version },
      boundedSubgraph: {
        nodes: ['component:invoice-mailer', 'iface:billing-api', 'store:billing-records'],
        edges: [
          { source: 'component:billing', target: 'component:invoice-mailer', kind: 'Dependency' },
          { source: 'component:invoice-mailer', target: 'store:billing-records', kind: 'Owns' },
          { source: 'component:invoice-mailer', target: 'deploy:production', kind: 'DeploysTo' },
        ],
      },
      replacement: [
        { op: 'REMOVE_COMPONENT', component: 'component:invoice-mailer' },
        { op: 'CHANGE_INTERFACE', target: 'iface:billing-api', attributes: { protocol: 'grpc' } },
        { op: 'CHANGE_DATA_STORE', target: 'store:billing-records', attributes: { engine: 'postgres', replicas: 3 } },
      ],
      invariants: ['DATA_OWNERSHIP: exactly one owner per data store'],
      predictedEffects: ['mailing handled by an external SaaS'],
    };
    const { content, diff } = applyLocalCandidate(candidate, base);
    expect(content.nodes.map((n) => n.id)).not.toContain('component:invoice-mailer');
    expect(diff.removed_nodes.map((n) => n.id)).toEqual(['component:invoice-mailer']);
    expect(diff.removed_edges.map((e) => `${e.source}->${e.target}`)).toEqual([
      'component:billing->component:invoice-mailer',
      'component:invoice-mailer->deploy:production',
      'component:invoice-mailer->store:billing-records',
    ]);
    expect(diff.modified_nodes.map((m) => m.id).sort()).toEqual(['iface:billing-api', 'store:billing-records']);
  });

  it('replace and re-add edges via REPLACE_COMPONENT with declared bounds', () => {
    const base = createCandidateBaseArtifact();
    const candidate: LocalCandidate = {
      baseGraphRef: { graph_id: base.envelope.id, version: base.envelope.version },
      boundedSubgraph: {
        nodes: ['component:invoice-mailer'],
        edges: [
          { source: 'component:invoice-mailer', target: 'store:billing-records', kind: 'Owns' },
          { source: 'component:billing', target: 'component:invoice-mailer', kind: 'Dependency' },
          { source: 'component:invoice-mailer', target: 'deploy:production', kind: 'DeploysTo' },
        ],
      },
      replacement: [
        {
          op: 'REPLACE_COMPONENT',
          component: 'component:invoice-mailer',
          with: { id: 'component:invoice-mailer-v2', kind: 'Component', attributes: { runtime: 'bun' } },
          edges: [
            { source: 'component:invoice-mailer-v2', target: 'store:billing-records', kind: 'Owns' },
            { source: 'component:billing', target: 'component:invoice-mailer-v2', kind: 'Dependency' },
            { source: 'component:invoice-mailer-v2', target: 'deploy:production', kind: 'DeploysTo' },
          ],
        },
      ],
      invariants: ['billing dependency direction unchanged'],
      predictedEffects: ['faster mail rendering'],
    };
    const { diff } = applyLocalCandidate(candidate, base);
    expect(diff.removed_nodes.map((n) => n.id)).toEqual(['component:invoice-mailer']);
    expect(diff.added_nodes.map((n) => n.id)).toEqual(['component:invoice-mailer-v2']);
    expect(diff.added_edges).toHaveLength(3);
    expect(diff.removed_edges).toHaveLength(3);
  });
});
