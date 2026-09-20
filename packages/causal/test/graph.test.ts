import { describe, expect, it } from 'vitest';
import {
  assertValidCausalGraph,
  confoundersOf,
  factorsContributingTo,
  isCausalEdge,
  isCausalFactor,
  isCausalGraph,
  validateCausalGraph,
} from '../src/index.js';
import { sampleGraph } from './helpers.js';

describe('causal graph validation', () => {
  it('accepts the canonical sample graph', () => {
    const graph = sampleGraph();
    expect(() => assertValidCausalGraph(graph)).not.toThrow();
    expect(validateCausalGraph(graph)).toBe(true);
    expect(isCausalGraph(graph)).toBe(true);
  });

  it('structural checks recognize factors and edges', () => {
    expect(isCausalFactor({ id: 'a', description: 'A factor.' })).toBe(true);
    expect(isCausalFactor({ id: '', description: 'x' })).toBe(false);
    expect(isCausalFactor(null)).toBe(false);
    expect(isCausalEdge({ type: 'CONTRIBUTES_TO', cause: 'a', effect: 'b' })).toBe(true);
    expect(isCausalEdge({ type: 'CONFOUNDS', confounder: 'c', cause: 'a', effect: 'b' })).toBe(true);
    expect(isCausalEdge({ type: 'BLOCKS', cause: 'a', effect: 'b' })).toBe(false);
    expect(isCausalEdge({ type: 'CONTRIBUTES_TO', cause: 'a' })).toBe(false);
  });

  it('rejects duplicate factor ids', () => {
    const graph = sampleGraph();
    expect(() =>
      assertValidCausalGraph({
        ...graph,
        factors: [...graph.factors, { id: 'p99-latency', description: 'Duplicate factor.' }],
      }),
    ).toThrow(/duplicate causal factor id/);
  });

  it('rejects edges referencing unknown factors', () => {
    const graph = sampleGraph();
    expect(() =>
      assertValidCausalGraph({
        ...graph,
        edges: [...graph.edges, { type: 'CONTRIBUTES_TO', cause: 'ghost-factor', effect: 'p99-latency' }],
      }),
    ).toThrow(/unknown factor/);
    expect(() =>
      assertValidCausalGraph({
        ...graph,
        edges: [...graph.edges, { type: 'CONFOUNDS', confounder: 'ghost', cause: 'cache-enabled', effect: 'p99-latency' }],
      }),
    ).toThrow(/unknown factor/);
  });

  it('rejects self-edges', () => {
    const graph = sampleGraph();
    expect(() =>
      assertValidCausalGraph({
        ...graph,
        edges: [...graph.edges, { type: 'CONTRIBUTES_TO', cause: 'p99-latency', effect: 'p99-latency' }],
      }),
    ).toThrow(/self-edge/);
    expect(() =>
      assertValidCausalGraph({
        ...graph,
        edges: [...graph.edges, { type: 'CONFOUNDS', confounder: 'cache-enabled', cause: 'cache-enabled', effect: 'p99-latency' }],
      }),
    ).toThrow(/participates in the relation it supposedly confounds/);
  });

  it('rejects duplicate edges', () => {
    const graph = sampleGraph();
    expect(() =>
      assertValidCausalGraph({
        ...graph,
        edges: [...graph.edges, { type: 'CONTRIBUTES_TO', cause: 'cache-enabled', effect: 'p99-latency' }],
      }),
    ).toThrow(/duplicate causal edge/);
    expect(() =>
      assertValidCausalGraph({
        ...graph,
        edges: [...graph.edges, { type: 'CONFOUNDS', confounder: 'traffic-volume', cause: 'cache-enabled', effect: 'p99-latency' }],
      }),
    ).toThrow(/duplicate causal edge/);
  });

  it('permits cycles (documented: full causal inference is out of scope)', () => {
    expect(() =>
      assertValidCausalGraph({
        factors: [
          { id: 'a', description: 'A.' },
          { id: 'b', description: 'B.' },
        ],
        edges: [
          { type: 'CONTRIBUTES_TO', cause: 'a', effect: 'b' },
          { type: 'CONTRIBUTES_TO', cause: 'b', effect: 'a' },
        ],
      }),
    ).not.toThrow();
  });
});

describe('causal graph queries', () => {
  it('factorsContributingTo returns the contributing factors', () => {
    const graph = sampleGraph();
    const contributing = factorsContributingTo(graph, 'p99-latency');
    expect(contributing.map((factor) => factor.id).sort()).toEqual(['cache-enabled', 'traffic-volume']);
    expect(factorsContributingTo(graph, 'cache-enabled')).toEqual([]);
  });

  it('confoundersOf returns the confounders of a relation', () => {
    const graph = sampleGraph();
    const confounders = confoundersOf(graph, 'cache-enabled', 'p99-latency');
    expect(confounders.map((factor) => factor.id)).toEqual(['traffic-volume']);
    expect(confoundersOf(graph, 'traffic-volume', 'p99-latency')).toEqual([]);
  });

  it('query results are independent of caller mutations (defensive content)', () => {
    const graph = sampleGraph();
    const contributing = factorsContributingTo(graph, 'p99-latency');
    contributing.length = 0;
    expect(factorsContributingTo(graph, 'p99-latency').length).toBe(2);
  });
});
