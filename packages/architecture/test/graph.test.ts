import { describe, expect, it } from 'vitest';
import {
  buildEdge,
  buildGraphContent,
  buildNode,
  createArchitectureGraph,
  architectureGraphArtifactId,
  architectureGraphCreationAddress,
  canonicalArchitectureGraphText,
  architectureGraphHash,
  validateArchitectureGraphArtifact,
  listNodeKinds,
  listEdgeKinds,
  registerNodeKind,
  registerEdgeKind,
  isRegisteredNodeKind,
  isRegisteredEdgeKind,
  edgeKeyString,
} from '../src/index.js';
import { isCanonicalText } from '@sos-2/semantic-spine';
import {
  CREATED_AT,
  PROVENANCE,
  PROJECTS,
  fullGraphEdges,
  fullGraphNodes,
  createFullGraphArtifact,
} from './helpers.js';

describe('kind registries', () => {
  it('seeds the nine §5 node kinds (sorted, deterministic)', () => {
    expect(listNodeKinds()).toEqual([
      'Adapter',
      'Capability',
      'Component',
      'DataStore',
      'Deployment',
      'Interface',
      'Model',
      'Policy',
      'Trust',
    ]);
  });

  it('seeds the eight canonical edge kinds (sorted, deterministic)', () => {
    expect(listEdgeKinds()).toEqual([
      'Constrains',
      'Consumes',
      'Dependency',
      'DeploysTo',
      'Owns',
      'Provides',
      'Realizes',
      'Trusts',
    ]);
  });

  it('supports explicit extension and rejects duplicates/bad formats', () => {
    registerNodeKind('Queue');
    expect(isRegisteredNodeKind('Queue')).toBe(true);
    expect(() => registerNodeKind('Queue')).toThrow(/already registered/);
    expect(() => registerNodeKind('bad_kind')).toThrow(/PascalCase/);

    registerEdgeKind('SubscribesTo');
    expect(isRegisteredEdgeKind('SubscribesTo')).toBe(true);
    expect(() => registerEdgeKind('SubscribesTo')).toThrow(/already registered/);
    expect(() => registerEdgeKind('nope')).toThrow(/PascalCase/);
  });
});

describe('graph build', () => {
  it('builds validated nodes and edges with defaults', () => {
    const node = buildNode({ id: 'component:x', kind: 'Component' });
    expect(node.criticality).toBe('normal');
    expect(node.attributes).toEqual({});

    const edge = buildEdge({ source: 'component:x', target: 'deploy:prod', kind: 'DeploysTo' });
    expect(edge.criticality).toBe('normal');
    expect(edgeKeyString(edge)).toBe('component:x->deploy:prod->DeploysTo');
  });

  it('builds canonical graph content (sorted nodes and edges)', () => {
    const content = buildGraphContent({
      projects_system_state: PROJECTS,
      nodes: [...fullGraphNodes()].reverse(),
      edges: [...fullGraphEdges()].reverse(),
    });
    const nodeIds = content.nodes.map((node) => node.id);
    expect(nodeIds).toEqual([...nodeIds].sort());
    const edgeKeys = content.edges.map((edge) => edgeKeyString(edge));
    expect(edgeKeys).toEqual([...edgeKeys].sort());
  });
});

describe('architecture graph artifact', () => {
  it('creates a valid artifact with an ArchitectureGraph envelope', () => {
    const artifact = createFullGraphArtifact();
    expect(artifact.envelope.kind).toBe('ArchitectureGraph');
    expect(artifact.envelope.status).toBe('ACTIVE');
    expect(artifact.envelope.version).toBe(1);
    expect(artifact.content.projects_system_state).toEqual(PROJECTS);
    expect(artifact.content.nodes).toHaveLength(11);
    expect(artifact.content.edges).toHaveLength(12);
    expect(validateArchitectureGraphArtifact(artifact)).toBe(true);
  });

  it('identity is deterministic and content-addressed over the creation address', () => {
    const input = {
      projects_system_state: PROJECTS,
      nodes: fullGraphNodes(),
      edges: fullGraphEdges(),
      provenance: PROVENANCE,
      created_at: CREATED_AT,
    };
    const a = createArchitectureGraph(input);
    const b = createArchitectureGraph({ ...input, nodes: [...fullGraphNodes()], edges: [...fullGraphEdges()] });
    expect(a.envelope.id).toBe(b.envelope.id);
    expect(a.envelope.id).toBe(architectureGraphArtifactId(input));
    expect(a.envelope.id).toMatch(/^sos:\/\/ArchitectureGraph\/[0-9a-f]{32}$/);
    expect(architectureGraphCreationAddress(input).content.nodes).toHaveLength(11);
  });

  it('canonical serialization round trips and is canonical', () => {
    const artifact = createFullGraphArtifact();
    const text = canonicalArchitectureGraphText(artifact);
    expect(isCanonicalText(text)).toBe(true);
    const parsed = JSON.parse(text);
    expect(parsed.envelope.id).toBe(artifact.envelope.id);
    expect(architectureGraphHash(artifact)).toMatch(/^[0-9a-f]{64}$/);
    expect(validateArchitectureGraphArtifact(parsed)).toBe(true);
  });

  it('different graphs project different hypotheses (different ids)', () => {
    const a = createArchitectureGraph({
      projects_system_state: PROJECTS,
      nodes: fullGraphNodes(),
      edges: fullGraphEdges(),
      provenance: PROVENANCE,
      created_at: CREATED_AT,
    });
    const b = createArchitectureGraph({
      projects_system_state: { system_state_id: PROJECTS.system_state_id, version: 2 },
      nodes: fullGraphNodes(),
      edges: fullGraphEdges(),
      provenance: PROVENANCE,
      created_at: CREATED_AT,
    });
    expect(a.envelope.id).not.toBe(b.envelope.id);
  });
});
