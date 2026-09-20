/**
 * The greenfield trace chain — the W14 traceability invariant.
 *
 * "every stage-to-stage handoff is a typed trace link; the full pipeline
 * result is one connected semantic subgraph from Mission -> SystemState
 * (the chain is complete + queryable through the spine; a missing link
 * fails the pipeline)."
 *
 * The chain (all links minted through the spine's createTraceLink —
 * well-formed ids, frozen 17-type vocabulary, required provenance):
 *
 *   candidate composition --SATISFIES-->  mission
 *   candidate composition --COMPOSES--->  each member package
 *   decision record        --SUPPORTS-->  candidate composition
 *   ask request (ASK path) --DERIVED_FROM-> originating decision record
 *   resolution (ASK path)  --SUPPORTS-->  candidate composition
 *   system state revision  --REALIZES-->  candidate composition
 *   system state revision  --REALIZES-->  declared architecture graph
 *   implementation model   --IMPLEMENTS-> declared architecture graph
 *   reconciliation links (implModel -> archGraph; typed by @sos-2/conformance)
 *   evidence records       --OBSERVES-->  system state revision
 *
 * CONNECTIVITY: every pipeline artifact lives in ONE undirected connected
 * component containing both the Mission and the SystemState revision, and
 * the directed traceability path SystemState -> Mission (following link
 * directions: the realized state traces back through the candidate it
 * realizes to the mission it satisfies) is walkable — the chain is
 * queryable through the spine, not merely asserted.
 */

import type { TraceLink, TraceLinkType } from '@sos-2/semantic-spine';
import { GreenfieldError } from './errors.js';

/** The documented handoff link of each pipeline stage boundary. */
export const GREENFIELD_HANDOFF_LINKS: ReadonlyArray<{
  from_stage: string;
  to_stage: string;
  source_role: string;
  target_role: string;
  type: TraceLinkType;
}> = [
  { from_stage: 'candidate', to_stage: 'mission', source_role: 'candidate', target_role: 'mission', type: 'SATISFIES' },
  { from_stage: 'decision', to_stage: 'candidate', source_role: 'decision', target_role: 'candidate', type: 'SUPPORTS' },
  { from_stage: 'realization', to_stage: 'candidate', source_role: 'system-state', target_role: 'candidate', type: 'REALIZES' },
  { from_stage: 'realization', to_stage: 'realization', source_role: 'system-state', target_role: 'architecture-graph', type: 'REALIZES' },
  { from_stage: 'realization', to_stage: 'realization', source_role: 'implementation-model', target_role: 'architecture-graph', type: 'IMPLEMENTS' },
  { from_stage: 'evidence', to_stage: 'realization', source_role: 'evidence', target_role: 'system-state', type: 'OBSERVES' },
];

function linkKey(link: TraceLink): string {
  return `${link.source}\u0000${link.target}\u0000${link.type}`;
}

/** Deterministic link order: (source, type, target) — byte-stable snapshots. */
export function canonicalLinkOrder(links: readonly TraceLink[]): TraceLink[] {
  return [...links].sort((a, b) => {
    if (a.source !== b.source) {
      return a.source < b.source ? -1 : 1;
    }
    if (a.type !== b.type) {
      return a.type < b.type ? -1 : 1;
    }
    return a.target < b.target ? -1 : a.target > b.target ? 1 : 0;
  });
}

/** Deduplicate links by (source, target, type) — the spine store semantics. */
export function deduplicateLinks(links: readonly TraceLink[]): TraceLink[] {
  const seen = new Set<string>();
  const result: TraceLink[] = [];
  for (const link of canonicalLinkOrder(links)) {
    const key = linkKey(link);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(link);
    }
  }
  return result;
}

/** The undirected connected component of `from` over the link set. */
export function connectedComponent(links: readonly TraceLink[], from: string): Set<string> {
  const adjacency = new Map<string, Set<string>>();
  for (const link of links) {
    let forward = adjacency.get(link.source);
    if (forward === undefined) {
      forward = new Set<string>();
      adjacency.set(link.source, forward);
    }
    forward.add(link.target);
    let backward = adjacency.get(link.target);
    if (backward === undefined) {
      backward = new Set<string>();
      adjacency.set(link.target, backward);
    }
    backward.add(link.source);
  }
  const component = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!component.has(neighbor)) {
        component.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return component;
}

/**
 * A directed path from `from` to `to` following link directions
 * (BFS, deterministic neighbor order = canonical link order). Returns the
 * node sequence (inclusive), or null when no directed path exists.
 */
export function directedPath(links: readonly TraceLink[], from: string, to: string): string[] | null {
  const outgoing = new Map<string, string[]>();
  for (const link of canonicalLinkOrder(links)) {
    const list = outgoing.get(link.source) ?? [];
    list.push(link.target);
    outgoing.set(link.source, list);
  }
  const previous = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === to) {
      const path: string[] = [];
      let cursor: string | null = current;
      while (cursor !== null) {
        path.unshift(cursor);
        cursor = previous.get(cursor) ?? null;
      }
      return path;
    }
    for (const neighbor of outgoing.get(current) ?? []) {
      if (!previous.has(neighbor)) {
        previous.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }
  return null;
}

/** The result of checking the greenfield trace chain. */
export interface TraceChainCheck {
  ok: boolean;
  /** Artifacts that appear in NO link at all (not even a dangling one). */
  unlinked_artifacts: string[];
  /** Artifacts outside the mission's connected component. */
  disconnected_artifacts: string[];
  /** The directed SystemState -> Mission traceability path, or null. */
  path_state_to_mission: string[] | null;
  /** Human-readable problems (empty iff ok). */
  problems: string[];
}

/**
 * Check the traceability invariant over a set of artifacts + links:
 * (1) every artifact appears in at least one link;
 * (2) every artifact is in the Mission's undirected connected component
 *     (ONE connected semantic subgraph spanning Mission -> SystemState);
 * (3) the directed path SystemState -> Mission is walkable (the chain is
 *     queryable through the spine — traceability from the realized state
 *     back to the mission).
 */
export function checkTraceChain(input: {
  artifacts: readonly string[];
  links: readonly TraceLink[];
  mission_id: string;
  system_state_id: string;
}): TraceChainCheck {
  const linked = new Set<string>();
  for (const link of input.links) {
    linked.add(link.source);
    linked.add(link.target);
  }
  const unlinked = [...new Set(input.artifacts)].filter((id) => !linked.has(id)).sort();

  const component = connectedComponent(input.links, input.mission_id);
  const disconnected = [...new Set(input.artifacts)]
    .filter((id) => !component.has(id))
    .sort();

  const path = directedPath(input.links, input.system_state_id, input.mission_id);

  const problems: string[] = [];
  if (unlinked.length > 0) {
    problems.push(`artifacts present in no trace link: ${unlinked.join(', ')}`);
  }
  if (disconnected.length > 0) {
    problems.push(
      `artifacts outside the Mission's connected semantic subgraph: ${disconnected.join(', ')}`,
    );
  }
  if (path === null) {
    problems.push(
      `no directed traceability path from the SystemState revision ${input.system_state_id} back to the Mission ${input.mission_id} — the chain is not queryable`,
    );
  }
  return {
    ok: problems.length === 0,
    unlinked_artifacts: unlinked,
    disconnected_artifacts: disconnected,
    path_state_to_mission: path,
    problems,
  };
}

/**
 * Assert the traceability invariant (throws GreenfieldError listing every
 * problem — a missing link fails the pipeline, loudly).
 */
export function assertTraceChainComplete(input: {
  artifacts: readonly string[];
  links: readonly TraceLink[];
  mission_id: string;
  system_state_id: string;
}): TraceChainCheck {
  const check = checkTraceChain(input);
  if (!check.ok) {
    throw new GreenfieldError(
      `the greenfield trace chain is INCOMPLETE (Mission ${input.mission_id} -> SystemState ${input.system_state_id}): ${check.problems.join('; ')}`,
    );
  }
  return check;
}
