/**
 * Meta-evolution trace chain — the W16 TRACEABILITY INVARIANT.
 *
 * Every stage handoff of the meta loop is a typed spine trace link (minted
 * through @sos-2/semantic-spine createTraceLink — never invented locally),
 * and the full loop result is ONE connected semantic subgraph rooted at the
 * initial MetaProcess revision reaching every consequential endpoint: each
 * MetaChange proposal, its decision record(s), and either the applied
 * revision or the rollback restore revision plus the retained failure
 * memory. A missing link FAILS the pipeline loudly (the loop calls
 * assertMetaTraceChain before returning; the exported verifier is
 * re-runnable and negative-testable).
 *
 * Connectivity is evaluated over the UNDIRECTED projection (SOS trace types
 * are directed); queryability is provided in BOTH directions.
 */

import { createTraceLink, isArtifactId } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import { MetaEvolutionError } from './errors.js';

export interface TraceChainVerification {
  /** True iff every required endpoint is reachable from the root. */
  complete: boolean;
  /** The chain root (the initial MetaProcess artifact id). */
  root: string;
  /** All artifact ids reachable from the root (sorted; includes the root). */
  reachable: string[];
  /** Required endpoints NOT reachable from the root (empty iff complete). */
  missing: string[];
  /** Total typed trace links in the chain. */
  link_count: number;
}

export function assertValidTraceLinks(value: unknown): asserts value is TraceLink[] {
  if (!Array.isArray(value)) {
    throw new MetaEvolutionError('BROKEN_TRACE_CHAIN', 'trace chain must be an array of typed trace links');
  }
  for (const link of value) {
    if (
      typeof link !== 'object' ||
      link === null ||
      !isArtifactId((link as TraceLink).source) ||
      !isArtifactId((link as TraceLink).target)
    ) {
      throw new MetaEvolutionError('BROKEN_TRACE_CHAIN', 'every trace chain entry must be a typed spine trace link');
    }
  }
}

/** Verify: undirected reachability from `root` over `trace` must cover every id in `required`. Pure, deterministic. */
export function verifyMetaTraceChain(trace: readonly TraceLink[], root: string, required: readonly string[]): TraceChainVerification {
  assertValidTraceLinks(trace);
  if (!isArtifactId(root)) {
    throw new MetaEvolutionError('BROKEN_TRACE_CHAIN', `trace chain root must be a well-formed spine artifact id, received: ${JSON.stringify(root)}`);
  }
  for (const endpoint of required) {
    if (!isArtifactId(endpoint)) {
      throw new MetaEvolutionError('BROKEN_TRACE_CHAIN', `required trace endpoint is not a well-formed spine artifact id: ${JSON.stringify(endpoint)}`);
    }
  }
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string): void => {
    if (!adjacency.has(a)) {
      adjacency.set(a, new Set());
    }
    if (!adjacency.has(b)) {
      adjacency.set(b, new Set());
    }
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
  };
  for (const link of trace) {
    addEdge(link.source, link.target);
  }
  const visited = new Set<string>([root]);
  const queue: string[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  const missing = [...required].filter((endpoint) => !visited.has(endpoint));
  return {
    complete: missing.length === 0,
    root,
    reachable: [...visited].sort(),
    missing,
    link_count: trace.length,
  };
}

/** Fail loudly when the chain is broken (the pipeline self-check). */
export function assertMetaTraceChain(trace: readonly TraceLink[], root: string, required: readonly string[]): TraceChainVerification {
  const verification = verifyMetaTraceChain(trace, root, required);
  if (!verification.complete) {
    throw new MetaEvolutionError(
      'BROKEN_TRACE_CHAIN',
      `the meta-evolution trace chain is broken: ${verification.missing.length} required artifact(s) are not reachable from ${root}: ${verification.missing.join(', ')}`,
    );
  }
  return verification;
}

export interface TraceQueryResult {
  artifact: string;
  upstream: string[];
  downstream: string[];
  links: TraceLink[];
}

/** Query the trace chain around one artifact id (directed, transitive, deterministic). */
export function queryMetaTrace(trace: readonly TraceLink[], artifact: string): TraceQueryResult {
  assertValidTraceLinks(trace);
  if (!isArtifactId(artifact)) {
    throw new MetaEvolutionError('BROKEN_TRACE_CHAIN', `trace query artifact must be a well-formed spine id, received: ${JSON.stringify(artifact)}`);
  }
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const link of trace) {
    outgoing.set(link.source, [...(outgoing.get(link.source) ?? []), link.target]);
    incoming.set(link.target, [...(incoming.get(link.target) ?? []), link.source]);
  }
  const collect = (start: string, edges: Map<string, string[]>): string[] => {
    const visited = new Set<string>();
    const queue = [...(edges.get(start) ?? [])];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || visited.has(current)) {
        continue;
      }
      visited.add(current);
      queue.push(...(edges.get(current) ?? []));
    }
    return [...visited].sort();
  };
  const links = trace.filter((link) => link.source === artifact || link.target === artifact);
  return {
    artifact,
    upstream: collect(artifact, incoming),
    downstream: collect(artifact, outgoing),
    links,
  };
}

/** Mint one typed trace link (spine-delegated; provenance is non-empty). */
export function metaTraceLink(input: { source: string; target: string; type: TraceLink['type']; provenance: string[] }): TraceLink {
  return createTraceLink({ source: input.source, target: input.target, type: input.type, provenance: input.provenance });
}
