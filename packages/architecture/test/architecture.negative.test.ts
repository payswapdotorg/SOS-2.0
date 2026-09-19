import { describe, expect, it } from 'vitest';
import {
  buildEdge,
  buildGraphContent,
  buildNode,
  applyGraphDiff,
  applyLocalCandidate,
  CandidateError,
  GraphDiffError,
  GraphError,
  diffGraphs,
  validateGraphShape,
  validateLocalCandidate,
} from '../src/index.js';
import type { GraphDiff, GraphShape, LocalCandidate } from '../src/index.js';
import { PROJECTS, createCandidateBaseArtifact, edgeOf, nodeOf } from './helpers.js';

describe('negative: graph structure', () => {
  it('rejects unknown node kinds', () => {
    expect(() => buildNode({ id: 'x', kind: 'Widget' })).toThrow(/unknown node kind "Widget"/);
  });

  it('rejects unknown edge kinds', () => {
    expect(() => buildEdge({ source: 'a', target: 'b', kind: 'FlowsInto' })).toThrow(/unknown edge kind/);
  });

  it('rejects malformed node ids', () => {
    expect(() => buildNode({ id: 'has space', kind: 'Component' })).toThrow(/node id must match/);
    expect(() => buildNode({ id: '', kind: 'Component' })).toThrow(/node id must match/);
  });

  it('rejects invalid criticality and non-JSON attributes', () => {
    expect(() => buildNode({ id: 'x', kind: 'Component', criticality: 'high' as never })).toThrow(
      /criticality must be "critical" or "normal"/,
    );
    expect(() =>
      buildNode({ id: 'x', kind: 'Component', attributes: { bad: NaN } as unknown as Record<string, never> }),
    ).toThrow(/not a plain JSON value/);
  });

  it('rejects duplicate node ids and duplicate edge keys in built content', () => {
    expect(() =>
      buildGraphContent({
        projects_system_state: PROJECTS,
        nodes: [
          { id: 'component:x', kind: 'Component' },
          { id: 'component:x', kind: 'Component' },
        ],
        edges: [],
      }),
    ).toThrow(/duplicate node id/);
    expect(() =>
      buildGraphContent({
        projects_system_state: PROJECTS,
        nodes: [
          { id: 'component:x', kind: 'Component' },
          { id: 'component:y', kind: 'Component' },
        ],
        edges: [
          { source: 'component:x', target: 'component:y', kind: 'Dependency' },
          { source: 'component:x', target: 'component:y', kind: 'Dependency' },
        ],
      }),
    ).toThrow(/duplicate edge/);
  });

  it('rejects dangling edge endpoints', () => {
    expect(() =>
      buildGraphContent({
        projects_system_state: PROJECTS,
        nodes: [{ id: 'component:x', kind: 'Component' }],
        edges: [{ source: 'component:x', target: 'component:ghost', kind: 'Dependency' }],
      }),
    ).toThrow(/target node "component:ghost" does not exist/);
  });

  it('rejects a projects_system_state reference of the wrong kind', () => {
    expect(() =>
      buildGraphContent({
        projects_system_state: { system_state_id: 'sos://Mission/abcdef0123456789abcdef0123456789', version: 1 },
        nodes: [],
        edges: [],
      }),
    ).toThrow(/must be a sos:\/\/SystemState\/ artifact id/);
    expect(() =>
      buildGraphContent({
        projects_system_state: { system_state_id: PROJECTS.system_state_id, version: 0 },
        nodes: [],
        edges: [],
      }),
    ).toThrow(/version must be an integer >= 1/);
  });

  it('graph shape validation rejects malformed shapes', () => {
    expect(validateGraphShape({ nodes: [], edges: [] })).toBe(true);
    expect(validateGraphShape(null)).toBe(false);
    expect(validateGraphShape({ nodes: {} as never, edges: [] })).toBe(false);
    expect(
      validateGraphShape({
        nodes: [{ id: 'x', kind: 'Component', criticality: 'normal', attributes: {} }],
        edges: [
          { source: 'x', target: 'ghost', kind: 'Dependency', criticality: 'normal', attributes: {} },
        ],
      }),
    ).toBe(false);
    expect(() =>
      diffGraphs({ nodes: [], edges: [] }, { nodes: [{ id: 'x' } as never], edges: [] }),
    ).toThrow(GraphError);
  });
});

describe('negative: graph diff application is strict', () => {
  const base: GraphShape = {
    nodes: [nodeOf('component:x', 'Component'), nodeOf('component:y', 'Component')],
    edges: [edgeOf('component:x', 'component:y', 'Dependency')],
  };

  it('rejects removing a node that is not in the base', () => {
    const diff: GraphDiff = {
      added_nodes: [],
      removed_nodes: [nodeOf('component:ghost', 'Component')],
      modified_nodes: [],
      added_edges: [],
      removed_edges: [],
      modified_edges: [],
    };
    expect(() => applyGraphDiff(base, diff)).toThrow(/cannot remove node "component:ghost"/);
  });

  it('rejects a modified node whose recorded before-value does not match', () => {
    const diff: GraphDiff = {
      added_nodes: [],
      removed_nodes: [],
      modified_nodes: [
        { id: 'component:x', before: nodeOf('component:x', 'Component', { tampered: true }), after: nodeOf('component:x', 'Component') },
      ],
      added_edges: [],
      removed_edges: [],
      modified_edges: [],
    };
    expect(() => applyGraphDiff(base, diff)).toThrow(/recorded before-value does not match/);
  });

  it('rejects adding a node that already exists', () => {
    const diff: GraphDiff = {
      added_nodes: [nodeOf('component:x', 'Component')],
      removed_nodes: [],
      modified_nodes: [],
      added_edges: [],
      removed_edges: [],
      modified_edges: [],
    };
    expect(() => applyGraphDiff(base, diff)).toThrow(/cannot add node "component:x"/);
  });

  it('rejects malformed diff shapes', () => {
    expect(() => applyGraphDiff(base, {} as never)).toThrow(/exact field set/);
    expect(() => applyGraphDiff(base, null as never)).toThrow(/must be an object/);
    expect(() =>
      applyGraphDiff(base, {
        added_nodes: [],
        removed_nodes: [],
        modified_nodes: [
          { id: 'component:x', before: nodeOf('component:x', 'Component'), after: nodeOf('component:y', 'Component') },
        ],
        added_edges: [],
        removed_edges: [],
        modified_edges: [],
      }),
    ).toThrow(/before\/after ids must match/);
    expect(() => applyGraphDiff(base, { nodes: [] } as never)).toThrow(GraphDiffError);
  });
});

describe('negative: candidate bounds are machine-enforced', () => {
  it('rejects an out-of-bounds REMOVE (undeclared node)', () => {
    const base = createCandidateBaseArtifact();
    const candidate: LocalCandidate = {
      baseGraphRef: { graph_id: base.envelope.id, version: base.envelope.version },
      boundedSubgraph: { nodes: [], edges: [] },
      replacement: [{ op: 'REMOVE_COMPONENT', component: 'component:billing' }],
      invariants: ['something'],
      predictedEffects: [],
    };
    expect(() => applyLocalCandidate(candidate, base)).toThrow(CandidateError);
    expect(() => applyLocalCandidate(candidate, base)).toThrow(/out-of-bounds candidate operation/);
  });

  it('rejects an undeclared incident edge on REMOVE (silent edge removal)', () => {
    const base = createCandidateBaseArtifact();
    const candidate: LocalCandidate = {
      baseGraphRef: { graph_id: base.envelope.id, version: base.envelope.version },
      boundedSubgraph: {
        nodes: ['component:invoice-mailer'],
        // deliberately missing: the ->store:billing-records Owns edge
        edges: [
          { source: 'component:billing', target: 'component:invoice-mailer', kind: 'Dependency' },
          { source: 'component:invoice-mailer', target: 'deploy:production', kind: 'DeploysTo' },
        ],
      },
      replacement: [{ op: 'REMOVE_COMPONENT', component: 'component:invoice-mailer' }],
      invariants: ['something'],
      predictedEffects: [],
    };
    expect(() => applyLocalCandidate(candidate, base)).toThrow(
      /edge component:invoice-mailer->store:billing-records->Owns is not declared/,
    );
  });

  it('rejects an undeclared CHANGE_INTERFACE target', () => {
    const base = createCandidateBaseArtifact();
    const candidate: LocalCandidate = {
      baseGraphRef: { graph_id: base.envelope.id, version: base.envelope.version },
      boundedSubgraph: { nodes: [], edges: [] },
      replacement: [{ op: 'CHANGE_INTERFACE', target: 'iface:billing-api', attributes: {} }],
      invariants: ['something'],
      predictedEffects: [],
    };
    expect(() => applyLocalCandidate(candidate, base)).toThrow(/out-of-bounds candidate operation/);
  });

  it('rejects ADD_COMPONENT with an id that already exists', () => {
    const base = createCandidateBaseArtifact();
    const candidate: LocalCandidate = {
      baseGraphRef: { graph_id: base.envelope.id, version: base.envelope.version },
      boundedSubgraph: { nodes: [], edges: [] },
      replacement: [{ op: 'ADD_COMPONENT', node: { id: 'component:billing', kind: 'Component' } }],
      invariants: ['something'],
      predictedEffects: [],
    };
    expect(() => applyLocalCandidate(candidate, base)).toThrow(/already present \(additions must be new identities\)/);
  });

  it('rejects ADD_COMPONENT with a non-Component node kind', () => {
    const base = createCandidateBaseArtifact();
    const candidate: LocalCandidate = {
      baseGraphRef: { graph_id: base.envelope.id, version: base.envelope.version },
      boundedSubgraph: { nodes: [], edges: [] },
      replacement: [{ op: 'ADD_COMPONENT', node: { id: 'deploy:blue', kind: 'Deployment' } }],
      invariants: ['something'],
      predictedEffects: [],
    };
    expect(() => applyLocalCandidate(candidate, base)).toThrow(/requires a node of kind "Component"/);
  });

  it('rejects CHANGE_INTERFACE on a node that is not an Interface', () => {
    const base = createCandidateBaseArtifact();
    const candidate: LocalCandidate = {
      baseGraphRef: { graph_id: base.envelope.id, version: base.envelope.version },
      boundedSubgraph: { nodes: ['component:billing'], edges: [] },
      replacement: [{ op: 'CHANGE_INTERFACE', target: 'component:billing', attributes: {} }],
      invariants: ['something'],
      predictedEffects: [],
    };
    expect(() => applyLocalCandidate(candidate, base)).toThrow(
      /CHANGE_INTERFACE target "component:billing" must be of kind "Interface"/,
    );
  });

  it('rejects CHANGE_TOPOLOGY with non-DeploysTo edges', () => {
    const base = createCandidateBaseArtifact();
    const addWrongKind: LocalCandidate = {
      baseGraphRef: { graph_id: base.envelope.id, version: base.envelope.version },
      boundedSubgraph: { nodes: [], edges: [] },
      replacement: [
        {
          op: 'CHANGE_TOPOLOGY',
          add: [{ source: 'component:billing', target: 'policy:retention', kind: 'Dependency' }],
          remove: [],
        },
      ],
      invariants: ['something'],
      predictedEffects: [],
    };
    expect(() => applyLocalCandidate(addWrongKind, base)).toThrow(/expected "DeploysTo"/);

    const removeWrongKind: LocalCandidate = {
      baseGraphRef: { graph_id: base.envelope.id, version: base.envelope.version },
      boundedSubgraph: {
        nodes: [],
        edges: [{ source: 'component:billing', target: 'store:billing-records', kind: 'Owns' }],
      },
      replacement: [
        {
          op: 'CHANGE_TOPOLOGY',
          add: [],
          remove: [{ source: 'component:billing', target: 'store:billing-records', kind: 'Owns' }],
        },
      ],
      invariants: ['something'],
      predictedEffects: [],
    };
    expect(() => applyLocalCandidate(removeWrongKind, base)).toThrow(/deployment topology edges/);
  });

  it('rejects removing a node that does not exist in the base graph', () => {
    const base = createCandidateBaseArtifact();
    const candidate: LocalCandidate = {
      baseGraphRef: { graph_id: base.envelope.id, version: base.envelope.version },
      boundedSubgraph: { nodes: ['component:ghost'], edges: [] },
      replacement: [{ op: 'REMOVE_COMPONENT', component: 'component:ghost' }],
      invariants: ['something'],
      predictedEffects: [],
    };
    expect(() => applyLocalCandidate(candidate, base)).toThrow(/not a base graph element/);
  });

  it('rejects a base graph mismatch (id or version — exact-revision discipline)', () => {
    const base = createCandidateBaseArtifact();
    const candidate: LocalCandidate = {
      baseGraphRef: { graph_id: base.envelope.id, version: 99 },
      boundedSubgraph: { nodes: [], edges: [] },
      replacement: [{ op: 'ADD_COMPONENT', node: { id: 'component:new', kind: 'Component' } }],
      invariants: ['something'],
      predictedEffects: [],
    };
    // same id, wrong version -> version mismatch
    expect(() => applyLocalCandidate(candidate, base)).toThrow(/version mismatch/);
    // wrong id -> id mismatch
    expect(() =>
      applyLocalCandidate(
        {
          ...candidate,
          baseGraphRef: { graph_id: `sos://ArchitectureGraph/${'0'.repeat(31)}1`, version: base.envelope.version },
        },
        base,
      ),
    ).toThrow(/id mismatch/);
  });
});

describe('negative: candidate contract', () => {
  const base = createCandidateBaseArtifact();

  it('rejects candidates with empty invariants', () => {
    const candidate = {
      baseGraphRef: { graph_id: base.envelope.id, version: 1 },
      boundedSubgraph: { nodes: [], edges: [] },
      replacement: [{ op: 'ADD_COMPONENT' as const, node: { id: 'component:new', kind: 'Component' } }],
      invariants: [],
      predictedEffects: [],
    };
    expect(() => validateLocalCandidate(candidate)).not.toThrow();
    expect(validateLocalCandidate(candidate)).toBe(false);
  });

  it('rejects unknown evolution operators and malformed candidates', () => {
    expect(
      validateLocalCandidate({
        baseGraphRef: { graph_id: base.envelope.id, version: 1 },
        boundedSubgraph: { nodes: [], edges: [] },
        replacement: [{ op: 'TELEPORT_COMPONENT' }],
        invariants: ['x'],
        predictedEffects: [],
      }),
    ).toBe(false);
    expect(validateLocalCandidate(null)).toBe(false);
    expect(
      validateLocalCandidate({
        baseGraphRef: { graph_id: 'not-an-id', version: 1 },
        boundedSubgraph: { nodes: [], edges: [] },
        replacement: [],
        invariants: ['x'],
        predictedEffects: [],
      }),
    ).toBe(false);
    expect(
      validateLocalCandidate({
        baseGraphRef: { graph_id: base.envelope.id, version: 1 },
        boundedSubgraph: { nodes: ['a', 'a'], edges: [] },
        replacement: [{ op: 'REMOVE_COMPONENT', component: 'a' }],
        invariants: ['x'],
        predictedEffects: [],
      }),
    ).toBe(false);
    expect(
      validateLocalCandidate({
        baseGraphRef: { graph_id: base.envelope.id, version: 1 },
        boundedSubgraph: { nodes: [], edges: [{ source: 'a', target: 'b', kind: 'Dependency' }, { source: 'a', target: 'b', kind: 'Dependency' }] },
        replacement: [{ op: 'REMOVE_COMPONENT', component: 'a' }],
        invariants: ['x'],
        predictedEffects: [],
      }),
    ).toBe(false);
  });

  it('rejects empty replacement operation sets', () => {
    expect(
      validateLocalCandidate({
        baseGraphRef: { graph_id: base.envelope.id, version: 1 },
        boundedSubgraph: { nodes: [], edges: [] },
        replacement: [],
        invariants: ['x'],
        predictedEffects: [],
      }),
    ).toBe(false);
  });

  it('rejects MERGE_COMPONENTS with fewer than two components', () => {
    const candidate: LocalCandidate = {
      baseGraphRef: { graph_id: base.envelope.id, version: base.envelope.version },
      boundedSubgraph: { nodes: ['component:billing'], edges: [] },
      replacement: [
        {
          op: 'MERGE_COMPONENTS',
          components: ['component:billing'],
          into: { id: 'component:merged', kind: 'Component' },
        },
      ],
      invariants: ['x'],
      predictedEffects: [],
    };
    expect(() => applyLocalCandidate(candidate, base)).toThrow(/at least two components/);
  });
});
