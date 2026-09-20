/**
 * Brownfield trace chain — the W15 TRACEABILITY INVARIANT.
 *
 * Every stage handoff of the brownfield loop is a typed spine trace link
 * (minted through @sos-2/semantic-spine createTraceLink — never invented
 * locally), and the full loop result is ONE connected semantic subgraph
 * rooted at the normalized ImplementationModel reaching every learned
 * ecology update. A missing link FAILS the pipeline loudly (the loop calls
 * assertBrownfieldTraceChain before returning; the exported verifier is
 * re-runnable and negative-testable).
 *
 * Connectivity is evaluated over the UNDIRECTED projection of the trace
 * links: SOS trace types are directed (DERIVED_FROM source -> target,
 * OBSERVES evidence -> subject, VERIFIES ...), so direction alone cannot
 * express "one connected loop". Queryability is provided in BOTH
 * directions (upstream/downstream) through the directed links.
 */

import { createTraceLink, isArtifactId } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import { BrownfieldError } from './errors.js';

/** The result of a trace-chain verification (pure data, JSON-safe). */
export interface TraceChainVerification {
  /** True iff every required endpoint is reachable from the root. */
  complete: boolean;
  /** The chain root (the normalized ImplementationModel id). */
  root: string;
  /** All artifact ids reachable from the root (sorted; includes the root). */
  reachable: string[];
  /** Required endpoints NOT reachable from the root (empty iff complete). */
  missing: string[];
  /** Total typed trace links in the chain. */
  link_count: number;
}

/** Validate that a value is a typed trace link collection (spine-guarded). */
export function assertValidTraceLinks(value: unknown): asserts value is TraceLink[] {
  if (!Array.isArray(value)) {
    throw new BrownfieldError('BROKEN_TRACE_CHAIN', 'trace chain must be an array of typed trace links');
  }
  for (const link of value) {
    if (
      typeof link !== 'object' ||
      link === null ||
      !isArtifactId((link as TraceLink).source) ||
      !isArtifactId((link as TraceLink).target)
    ) {
      throw new BrownfieldError('BROKEN_TRACE_CHAIN', 'every trace chain entry must be a typed spine trace link');
    }
  }
}

/**
 * Verify the trace chain: undirected reachability from `root` over `trace`
 * must cover every id in `required`. Pure and deterministic.
 */
export function verifyBrownfieldTraceChain(trace: readonly TraceLink[], root: string, required: readonly string[]): TraceChainVerification {
  assertValidTraceLinks(trace);
  if (!isArtifactId(root)) {
    throw new BrownfieldError('BROKEN_TRACE_CHAIN', `trace chain root must be a well-formed spine artifact id, received: ${JSON.stringify(root)}`);
  }
  for (const endpoint of required) {
    if (!isArtifactId(endpoint)) {
      throw new BrownfieldError('BROKEN_TRACE_CHAIN', `required trace endpoint is not a well-formed spine artifact id: ${JSON.stringify(endpoint)}`);
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
export function assertBrownfieldTraceChain(trace: readonly TraceLink[], root: string, required: readonly string[]): TraceChainVerification {
  const verification = verifyBrownfieldTraceChain(trace, root, required);
  if (!verification.complete) {
    throw new BrownfieldError(
      'BROKEN_TRACE_CHAIN',
      `the brownfield loop trace chain is broken: ${verification.missing.length} required artifact(s) are not reachable from ${root}: ${verification.missing.join(', ')}`,
    );
  }
  return verification;
}

/** A directed trace query result for one artifact id. */
export interface TraceQueryResult {
  artifact: string;
  /** Artifacts with a directed path INTO this artifact (upstream). */
  upstream: string[];
  /** Artifacts with a directed path OUT of this artifact (downstream). */
  downstream: string[];
  /** All links touching this artifact. */
  links: TraceLink[];
}

/**
 * Query the trace chain around one artifact id (directed, transitive,
 * deterministic) — the loop trace graph is queryable, not just asserted.
 */
export function queryBrownfieldTrace(trace: readonly TraceLink[], artifact: string): TraceQueryResult {
  assertValidTraceLinks(trace);
  if (!isArtifactId(artifact)) {
    throw new BrownfieldError('BROKEN_TRACE_CHAIN', `trace query artifact must be a well-formed spine id, received: ${JSON.stringify(artifact)}`);
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

/**
 * Mint one typed trace link (spine-delegated; provenance is non-empty).
 * The single sanctioned link factory used by every brownfield stage.
 */
export function brownfieldTraceLink(input: { source: string; target: string; type: TraceLink['type']; provenance: string[] }): TraceLink {
  return createTraceLink({ source: input.source, target: input.target, type: input.type, provenance: input.provenance });
}
