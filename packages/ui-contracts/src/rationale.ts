/**
 * Rationale chains — the W11 core promise (spec/work-orders/W11-console.md
 * acceptance: "Every consequential decision exposes upstream/downstream
 * rationale and evidence"; spec/requirements.md R22 evidence-based
 * explainability).
 *
 * A RationaleChain is the typed, spine-bound explanation of ONE subject
 * artifact (a decision, a mission revision, an experiment, ...):
 *
 *   - upstream    the subject's ORIGINS AND INPUTS: the artifacts it derives
 *                 from, refines, satisfies or implements, AND the evidence,
 *                 experiments, observations and constraints pointing at it;
 *   - downstream  the subject's CONSEQUENCES AND OUTPUTS: the artifacts it
 *                 verifies, supports, observes, composes, realizes,
 *                 constrains or causes, AND the artifacts that derive from
 *                 it;
 *   - evidence_refs  the exact spine Evidence ids supporting the subject.
 *
 * LINK DIRECTION TYPOLOGY (documented, deterministic): a trace link
 * (source, target, type) is classified from the subject's perspective by
 * the link's ROLE —
 *   - DEPENDENT types (the source depends on / originates from the target):
 *     DERIVED_FROM, REFINES, SPECIALIZES, SATISFIES, IMPLEMENTS,
 *     GENERALIZES, CAUSED_BY — such a link is UPSTREAM for its SOURCE and
 *     DOWNSTREAM for its target;
 *   - ACTING types (the source acts on / produces support for the target):
 *     VERIFIES, SUPPORTS, OBSERVES, COMPOSES, REALIZES, CONSTRAINS, CAUSED,
 *     COMPATIBLE_WITH, CONFLICTS_WITH, CONTRADICTS — such a link is UPSTREAM
 *     for its TARGET and DOWNSTREAM for its source.
 * Example: "candidate DERIVED_FROM graph" puts the graph in the candidate's
 * upstream; "evidence VERIFIES candidate" puts the evidence in the
 * candidate's upstream too — both are the candidate's origins/supports.
 *
 * Every link is a spine TraceLink over the 17 frozen types (CONSUMED from
 * @sos-2/semantic-spine — never redefined here). A rationale chain WITHOUT
 * typed trace links is REJECTED (assertValidRationaleChain): a decision
 * that explains nothing is not explainable, and the W11 acceptance makes
 * the rationale chain a structural property of every consequential
 * view-model, not an optional decoration.
 *
 * Evidence refs may legitimately be empty (a freshly created mission has
 * no evidence yet — that is the truthful state); consequential-decision
 * view-models whose domain contracts REQUIRE evidence (assurance cases,
 * experiments, packages, ASK, rollback) enforce non-empty evidence refs in
 * their own validators.
 *
 * This module is pure types + pure functions: deterministic, canonical,
 * zero DOM dependencies.
 */

import { isArtifactId, isTraceLink } from '@sos-2/semantic-spine';
import type { TraceLink, TraceLinkType } from '@sos-2/semantic-spine';
import { UIContractError } from './errors.js';

/**
 * DEPENDENT link types: the source originates from / depends on the target
 * (upstream for the source, downstream for the target). All other frozen
 * types are ACTING types: the source acts on / supports the target
 * (upstream for the target, downstream for the source).
 */
export const DEPENDENT_TRACE_LINK_TYPES: ReadonlySet<TraceLinkType> = new Set<TraceLinkType>([
  'DERIVED_FROM',
  'REFINES',
  'SPECIALIZES',
  'SATISFIES',
  'IMPLEMENTS',
  'GENERALIZES',
  'CAUSED_BY',
]);

/**
 * From the subject's perspective: is this link part of the subject's
 * UPSTREAM (origins, inputs, supports)? Deterministic per the module doc.
 */
export function isUpstreamForSubject(link: TraceLink, subjectId: string): boolean {
  if (DEPENDENT_TRACE_LINK_TYPES.has(link.type)) {
    return link.source === subjectId;
  }
  return link.target === subjectId;
}

/**
 * The rationale chain of one subject artifact. Links are stored sorted by
 * (source, target, type) so equal chains serialize identically
 * (determinism discipline).
 */
export interface RationaleChain {
  /** The subject artifact id this chain explains (well-formed spine id). */
  subject_id: string;
  /** Upstream links (target === subject_id), sorted by (source, target, type). */
  upstream: TraceLink[];
  /** Downstream links (source === subject_id), sorted by (source, target, type). */
  downstream: TraceLink[];
  /** Exact spine Evidence ids supporting the subject (sorted, unique; may be empty). */
  evidence_refs: string[];
}

/** Deterministic link order: (source, target, type). */
export function compareTraceLinks(a: TraceLink, b: TraceLink): number {
  if (a.source !== b.source) {
    return a.source < b.source ? -1 : 1;
  }
  if (a.target !== b.target) {
    return a.target < b.target ? -1 : 1;
  }
  if (a.type !== b.type) {
    return a.type < b.type ? -1 : 1;
  }
  return 0;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Build the rationale chain for a subject from a pool of typed trace links,
 * classified by the direction typology (see module doc). Links mentioning
 * neither side are ignored. Deterministic: both lists are sorted by
 * (source, target, type); evidence refs are sorted and unique.
 */
export function buildRationaleChain(input: {
  subject_id: string;
  links: readonly TraceLink[];
  evidence_refs?: readonly string[];
}): RationaleChain {
  if (typeof input !== 'object' || input === null) {
    throw new UIContractError('rationale chain input must be an object');
  }
  if (!isArtifactId(input.subject_id)) {
    throw new UIContractError(
      `rationale chain subject_id must be a well-formed spine artifact id, received: ${JSON.stringify(input.subject_id)}`,
    );
  }
  if (!Array.isArray(input.links)) {
    throw new UIContractError('rationale chain links must be an array of spine trace links');
  }
  const upstream: TraceLink[] = [];
  const downstream: TraceLink[] = [];
  for (const link of input.links) {
    if (!isTraceLink(link)) {
      throw new UIContractError(
        `rationale chain links must be spine trace links, received: ${JSON.stringify(link)}`,
      );
    }
    if (link.source !== input.subject_id && link.target !== input.subject_id) {
      continue; // the pool may carry the whole world's links
    }
    if (isUpstreamForSubject(link, input.subject_id)) {
      upstream.push(link);
    } else {
      downstream.push(link);
    }
  }
  upstream.sort(compareTraceLinks);
  downstream.sort(compareTraceLinks);
  const evidence_refs = sortedUnique(input.evidence_refs ?? []);
  for (const ref of evidence_refs) {
    if (!isArtifactId(ref)) {
      throw new UIContractError(
        `rationale chain evidence refs must be well-formed spine artifact ids, received: ${JSON.stringify(ref)}`,
      );
    }
  }
  const chain: RationaleChain = {
    subject_id: input.subject_id,
    upstream,
    downstream,
    evidence_refs,
  };
  assertValidRationaleChain(chain);
  return chain;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate a rationale chain (throws UIContractError). A chain WITHOUT typed
 * trace links (both upstream and downstream empty) is REJECTED — the W11
 * negative-test discipline: "rationale chain without trace links REJECTED".
 */
export function assertValidRationaleChain(value: unknown): asserts value is RationaleChain {
  if (!isPlainObject(value)) {
    throw new UIContractError(`rationale chain must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set(['subject_id', 'upstream', 'downstream', 'evidence_refs']);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new UIContractError(
      'rationale chain must have the exact field set { subject_id, upstream, downstream, evidence_refs }',
    );
  }
  if (!isNonEmptyString(record['subject_id']) || !isArtifactId(record['subject_id'])) {
    throw new UIContractError(
      `rationale chain subject_id must be a well-formed spine artifact id, received: ${JSON.stringify(record['subject_id'])}`,
    );
  }
  for (const side of ['upstream', 'downstream'] as const) {
    if (!Array.isArray(record[side])) {
      throw new UIContractError(`rationale chain ${side} must be an array of typed trace links`);
    }
    for (const link of record[side]) {
      if (!isTraceLink(link)) {
        throw new UIContractError(
          `rationale chain ${side} entries must be spine trace links over the 17 frozen types, received: ${JSON.stringify(link)}`,
        );
      }
      // Direction typology: upstream links must genuinely be upstream for
      // the subject (dependent: subject is the source; acting: subject is
      // the target), downstream links genuinely downstream.
      const isUpstream = isUpstreamForSubject(link, record['subject_id']);
      if (side === 'upstream' && !isUpstream) {
        throw new UIContractError(
          `rationale chain upstream link ${link.source} -> ${link.target} (${link.type}) is not an upstream link for ${record['subject_id']} (direction typology violated)`,
        );
      }
      if (side === 'downstream' && (link.source !== record['subject_id'] && link.target !== record['subject_id'] || isUpstream)) {
        throw new UIContractError(
          `rationale chain downstream link ${link.source} -> ${link.target} (${link.type}) is not a downstream link for ${record['subject_id']} (direction typology violated)`,
        );
      }
    }
  }
  if ((record['upstream'] as TraceLink[]).length === 0 && (record['downstream'] as TraceLink[]).length === 0) {
    throw new UIContractError(
      `rationale chain for ${JSON.stringify(record['subject_id'])} carries no typed trace links — ` +
        'a rationale chain without trace links is rejected (W11 acceptance: every consequential decision exposes rationale)',
    );
  }
  if (!Array.isArray(record['evidence_refs'])) {
    throw new UIContractError('rationale chain evidence_refs must be an array of spine Evidence ids');
  }
  for (const ref of record['evidence_refs']) {
    if (!isNonEmptyString(ref) || !isArtifactId(ref)) {
      throw new UIContractError(
        `rationale chain evidence_refs entries must be well-formed spine artifact ids, received: ${JSON.stringify(ref)}`,
      );
    }
  }
}

/** Predicate form of assertValidRationaleChain. */
export function validateRationaleChain(value: unknown): value is RationaleChain {
  try {
    assertValidRationaleChain(value);
    return true;
  } catch {
    return false;
  }
}

/** The distinct link types present in a chain (sorted; display helper). */
export function rationaleLinkTypes(chain: RationaleChain): TraceLinkType[] {
  const types = new Set<TraceLinkType>();
  for (const link of chain.upstream) {
    types.add(link.type);
  }
  for (const link of chain.downstream) {
    types.add(link.type);
  }
  return [...types].sort();
}
