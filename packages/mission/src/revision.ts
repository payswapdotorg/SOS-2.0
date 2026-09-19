/**
 * Explicit, versioned, authority-controlled mission revision workflow.
 *
 * Realizes spec/architecture.md §3: "Mission revision is explicit, versioned
 * and authority-controlled", and spec/requirements.md R3 (explicit mission
 * evolution).
 *
 * Workflow contract:
 *   - Only an ACTIVE mission can be revised (revising a DRAFT means writing a
 *     new draft; revising a SUPERSEDED/RETIRED mission is an invalid
 *     transition and fails loudly).
 *   - A revision REQUIRES an AuthorityGrant reference: a well-formed Semantic
 *     Spine artifact id of kind AuthorityGrant. Deep grant evaluation
 *     (expiry, revocation, scope, permission) is the job of
 *     @sos-2/authority — the two packages compose; @sos-2/mission does not
 *     duplicate grant semantics (composed workflow proven in tests).
 *   - The revision is a NEW versioned artifact: version + 1, supersedes the
 *     previous id, status ACTIVE, authority_ref = the authorizing grant.
 *   - Revision lineage is recorded as a DERIVED_FROM trace link (one of the
 *     17 frozen types): revised -> previous, with provenance.
 *   - MissionStore keeps the revision history COMPLETE (every supersedes
 *     target exists) and QUERYABLE (history(), active(), links()).
 */

import {
  EnvelopeStore,
  TraceLinkStore,
  createTraceLink,
  isArtifactId,
  parseArtifactId,
} from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import { assertValidMission, createMission } from './artifact.js';
import type { MissionArtifact } from './artifact.js';
import { MissionError } from './errors.js';
import { validateMissionContent } from './model.js';
import type { MissionContent } from './model.js';

export const AUTHORITY_GRANT_KIND = 'AuthorityGrant';

/**
 * Whether a value is a well-formed artifact id of kind AuthorityGrant
 * (the reference form required by mission revision).
 */
export function isAuthorityGrantRef(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    isArtifactId(value) &&
    parseArtifactId(value).kind === AUTHORITY_GRANT_KIND
  );
}

export interface ReviseMissionInput {
  /** Next mission content (fully validated). */
  content: MissionContent;
  /** REQUIRED: AuthorityGrant artifact id authorizing this revision. */
  authority_grant: string;
  /** REQUIRED non-empty provenance entries. */
  provenance: string[];
  /** RFC3339 revision timestamp, caller-supplied. */
  created_at: string;
}

export interface MissionRevisionResult {
  /** The mission being revised (as it was). */
  previous: MissionArtifact;
  /** The new revision (ACTIVE, version + 1, supersedes previous). */
  revised: MissionArtifact;
  /** DERIVED_FROM trace link: revised -> previous. */
  revision_link: TraceLink;
}

/**
 * The pure revision step. Enforces ACTIVE-only revision and the
 * AuthorityGrant reference requirement; builds the next version with the
 * grant as the immediate authorizer.
 */
export function reviseMission(current: MissionArtifact, input: ReviseMissionInput): MissionRevisionResult {
  assertValidMission(current);
  if (typeof input !== 'object' || input === null) {
    throw new MissionError('revision input must be an object');
  }
  if (current.envelope.status !== 'ACTIVE') {
    throw new MissionError(
      `only ACTIVE missions can be revised (spec/architecture.md §3: mission revision is explicit, versioned and authority-controlled); current status: ${current.envelope.status}`,
    );
  }
  if (!isAuthorityGrantRef(input.authority_grant)) {
    throw new MissionError(
      `mission revision requires an AuthorityGrant artifact id (sos://AuthorityGrant/<32 hex>), received: ${JSON.stringify(input.authority_grant)}`,
    );
  }
  validateMissionContent(input.content);

  const revised = createMission({
    content: input.content,
    provenance: input.provenance,
    created_at: input.created_at,
    authority_ref: input.authority_grant,
    version: current.envelope.version + 1,
    status: 'ACTIVE',
    supersedes: current.envelope.id,
  });

  const revision_link = createTraceLink({
    source: revised.envelope.id,
    target: current.envelope.id,
    type: 'DERIVED_FROM',
    provenance: [...input.provenance],
  });

  return { previous: current, revised, revision_link };
}

/**
 * In-memory mission store: envelope lifecycle via the spine's EnvelopeStore,
 * contents kept alongside, revision lineage via the spine's TraceLinkStore.
 *
 * Guarantees:
 *   - put(): no duplicate ids; supersedes targets must exist; a non-root
 *     mission must supersede the CURRENT version with version exactly +1
 *     (contiguous, unbranched revision history).
 *   - revise(): the explicit workflow above, executed transactionally.
 *   - history(): complete root -> head chain, ordered by version.
 */
export class MissionStore {
  private readonly envelopes = new EnvelopeStore();
  private readonly contents = new Map<string, MissionContent>();
  private readonly links = new TraceLinkStore();

  put(mission: MissionArtifact): MissionArtifact {
    assertValidMission(mission);
    if (mission.envelope.supersedes !== null) {
      const previous = this.envelopes.get(mission.envelope.supersedes);
      if (previous === undefined) {
        throw new MissionError(
          `mission ${mission.envelope.id} supersedes unknown artifact ${mission.envelope.supersedes} (revision history must be complete)`,
        );
      }
      if (previous.kind !== 'Mission') {
        throw new MissionError(`mission cannot supersede a non-Mission artifact: ${previous.id}`);
      }
      if (mission.envelope.version !== previous.version + 1) {
        throw new MissionError(
          `mission revision version must be exactly previous.version + 1 (expected ${previous.version + 1}, received ${mission.envelope.version})`,
        );
      }
    }
    this.envelopes.put(mission.envelope);
    this.contents.set(mission.envelope.id, structuredClone(mission.content));
    return mission;
  }

  get(id: string): MissionArtifact | undefined {
    const envelope = this.envelopes.get(id);
    if (envelope === undefined) {
      return undefined;
    }
    const content = this.contents.get(id);
    if (content === undefined) {
      throw new MissionError(`stored mission ${id} has no content (corrupt store)`);
    }
    return { envelope, content };
  }

  has(id: string): boolean {
    return this.envelopes.has(id);
  }

  /** All missions, sorted by id (deterministic). */
  list(): MissionArtifact[] {
    return this.envelopes
      .list()
      .map((envelope) => this.get(envelope.id)!)
      .sort((a, b) => (a.envelope.id < b.envelope.id ? -1 : a.envelope.id > b.envelope.id ? 1 : 0));
  }

  get size(): number {
    return this.envelopes.size;
  }

  /** The explicit revision workflow against the stored mission. */
  revise(id: string, input: ReviseMissionInput): MissionRevisionResult {
    const current = this.get(id);
    if (current === undefined) {
      throw new MissionError(`unknown mission id: ${id}`);
    }
    const result = reviseMission(current, input);
    this.envelopes.setStatus(id, 'SUPERSEDED');
    this.envelopes.put(result.revised.envelope);
    this.contents.set(result.revised.envelope.id, structuredClone(result.revised.content));
    this.links.add(result.revision_link);
    return {
      previous: this.get(id)!,
      revised: this.get(result.revised.envelope.id)!,
      revision_link: result.revision_link,
    };
  }

  /**
   * Complete revision history for a mission: [root, ..., this revision],
   * ordered by strictly increasing version. Throws if the chain is
   * incomplete or non-contiguous (cannot happen through put/revise).
   */
  history(id: string): MissionArtifact[] {
    const start = this.get(id);
    if (start === undefined) {
      throw new MissionError(`unknown mission id: ${id}`);
    }
    const chain: MissionArtifact[] = [];
    const visited = new Set<string>();
    let cursor: MissionArtifact | undefined = start;
    while (cursor !== undefined) {
      if (visited.has(cursor.envelope.id)) {
        throw new MissionError(`revision cycle detected at ${cursor.envelope.id}`);
      }
      visited.add(cursor.envelope.id);
      chain.push(cursor);
      const previousId = cursor.envelope.supersedes;
      if (previousId === null) {
        cursor = undefined;
        continue;
      }
      const previous = this.get(previousId);
      if (previous === undefined) {
        throw new MissionError(`incomplete revision history: missing supersedes target ${previousId}`);
      }
      if (cursor.envelope.version !== previous.envelope.version + 1) {
        throw new MissionError(
          `non-contiguous revision history at ${cursor.envelope.id} (version ${cursor.envelope.version} follows ${previous.envelope.version})`,
        );
      }
      cursor = previous;
    }
    chain.reverse();
    return chain;
  }

  /** The current ACTIVE missions (each revision chain has at most one). */
  active(): MissionArtifact[] {
    return this.list().filter((mission) => mission.envelope.status === 'ACTIVE');
  }

  /** Recorded DERIVED_FROM revision links (defensive copies, insertion order). */
  revisionLinks(): TraceLink[] {
    return this.links.all();
  }
}
