/**
 * Grant store + the explicit revocation workflow.
 *
 * Revocation is an EXPLICIT, versioned act: revokeGrant(head, input) creates
 * a NEW grant revision (version + 1, supersedes the head) whose content
 * records revoked_at and the revocation provenance. The envelope chain
 * carries the history; deterministic evaluation of the head revision returns
 * REVOKED from then on.
 *
 * Lifecycle discipline (loud failures):
 *   - only a VALID grant can be revoked (revoking a REVOKED grant:
 *     invalid transition; revoking an EXPIRED grant: invalid transition —
 *     EXPIRED is terminal);
 *   - revision chains are contiguous (+1 versions) and unbranched;
 *   - the store enforces complete history (supersedes targets must exist).
 */

import { EnvelopeStore, createEnvelope, deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { AuthorityError } from './errors.js';
import {
  assertValidGrant,
  createGrant,
  evaluateGrant,
} from './grant.js';
import type {
  AuthorityGrantArtifact,
  GrantContent,
  GrantEvaluationInput,
} from './grant.js';

export interface RevokeGrantInput {
  /** The point proving the grant is (still) VALID at revocation time. */
  at: GrantEvaluationInput;
  provenance: string[];
  /** RFC3339 revocation instant (also the revision's created_at). */
  created_at: string;
}

/**
 * The pure revocation step: create the revoked successor revision of a
 * VALID head grant. Throws on any invalid transition.
 */
export function revokeGrant(head: AuthorityGrantArtifact, input: RevokeGrantInput): AuthorityGrantArtifact {
  assertValidGrant(head);
  if (typeof input !== 'object' || input === null) {
    throw new AuthorityError('revocation input must be an object');
  }
  const status = evaluateGrant(head, input.at);
  if (status === 'REVOKED') {
    throw new AuthorityError(
      `invalid authority transition: grant ${head.envelope.id} is already REVOKED (REVOKED is terminal)`,
    );
  }
  if (status === 'EXPIRED') {
    throw new AuthorityError(
      `invalid authority transition: grant ${head.envelope.id} is already EXPIRED at the given point (EXPIRED is terminal; an expired grant is never revoked — it simply never authorizes)`,
    );
  }

  const content: GrantContent = {
    ...structuredClone(head.content),
    revoked_at: input.created_at,
    revocation_provenance: [...input.provenance],
  };

  const version = head.envelope.version + 1;
  const envelope = createEnvelope({
    kind: 'AuthorityGrant',
    version,
    status: 'ACTIVE',
    authority_ref: head.envelope.authority_ref,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes: head.envelope.id,
    id: deriveDeterministicArtifactId('AuthorityGrant', {
      kind: 'AuthorityGrant',
      version,
      status: 'ACTIVE',
      authority_ref: head.envelope.authority_ref,
      provenance: [...input.provenance],
      created_at: input.created_at,
      supersedes: head.envelope.id,
      content,
    }),
  });
  return { envelope, content };
}

/**
 * In-memory grant store: envelope lifecycle via the spine's EnvelopeStore,
 * grant contents alongside, latest/head resolution, history queries.
 */
export class GrantStore {
  private readonly envelopes = new EnvelopeStore();
  private readonly contents = new Map<string, GrantContent>();

  put(grant: AuthorityGrantArtifact): AuthorityGrantArtifact {
    assertValidGrant(grant);
    if (grant.envelope.supersedes !== null) {
      const previous = this.envelopes.get(grant.envelope.supersedes);
      if (previous === undefined) {
        throw new AuthorityError(
          `grant ${grant.envelope.id} supersedes unknown artifact ${grant.envelope.supersedes} (grant revision history must be complete)`,
        );
      }
      if (previous.kind !== 'AuthorityGrant') {
        throw new AuthorityError(`grant cannot supersede a non-AuthorityGrant artifact: ${previous.id}`);
      }
      if (grant.envelope.version !== previous.version + 1) {
        throw new AuthorityError(
          `grant revision version must be exactly previous.version + 1 (expected ${previous.version + 1}, received ${grant.envelope.version})`,
        );
      }
    }
    this.envelopes.put(grant.envelope);
    this.contents.set(grant.envelope.id, structuredClone(grant.content));
    return grant;
  }

  get(id: string): AuthorityGrantArtifact | undefined {
    const envelope = this.envelopes.get(id);
    if (envelope === undefined) {
      return undefined;
    }
    const content = this.contents.get(id);
    if (content === undefined) {
      throw new AuthorityError(`stored grant ${id} has no content (corrupt store)`);
    }
    return { envelope, content };
  }

  has(id: string): boolean {
    return this.envelopes.has(id);
  }

  /** All grants, sorted by id (deterministic). */
  list(): AuthorityGrantArtifact[] {
    return this.envelopes
      .list()
      .map((envelope) => this.get(envelope.id)!)
      .sort((a, b) => (a.envelope.id < b.envelope.id ? -1 : a.envelope.id > b.envelope.id ? 1 : 0));
  }

  get size(): number {
    return this.envelopes.size;
  }

  /** Follow the supersedes chain to the head (latest revision). */
  latest(id: string): AuthorityGrantArtifact | undefined {
    const start = this.get(id);
    if (start === undefined) {
      return undefined;
    }
    let cursor = start;
    const visited = new Set<string>([cursor.envelope.id]);
    for (;;) {
      const next = this.envelopes.list().find(
        (envelope) => envelope.supersedes === cursor.envelope.id && !visited.has(envelope.id),
      );
      if (next === undefined) {
        return cursor;
      }
      if (visited.has(next.id)) {
        throw new AuthorityError(`grant revision cycle detected at ${next.id}`);
      }
      visited.add(next.id);
      cursor = this.get(next.id)!;
    }
  }

  /** Complete revision history [root, ..., head], ordered by contiguous versions. */
  history(id: string): AuthorityGrantArtifact[] {
    const head = this.latest(id);
    if (head === undefined) {
      throw new AuthorityError(`unknown grant id: ${id}`);
    }
    const chain: AuthorityGrantArtifact[] = [];
    const visited = new Set<string>();
    let cursor: AuthorityGrantArtifact | undefined = head;
    while (cursor !== undefined) {
      if (visited.has(cursor.envelope.id)) {
        throw new AuthorityError(`grant revision cycle detected at ${cursor.envelope.id}`);
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
        throw new AuthorityError(`incomplete grant revision history: missing supersedes target ${previousId}`);
      }
      if (cursor.envelope.version !== previous.envelope.version + 1) {
        throw new AuthorityError(
          `non-contiguous grant revision history at ${cursor.envelope.id} (version ${cursor.envelope.version} follows ${previous.envelope.version})`,
        );
      }
      cursor = previous;
    }
    chain.reverse();
    return chain;
  }

  /**
   * The explicit revocation workflow against the HEAD revision of a grant
   * chain: creates the revoked successor revision (the old head becomes
   * SUPERSEDED). Invalid transitions throw.
   */
  revoke(id: string, input: RevokeGrantInput): AuthorityGrantArtifact {
    const head = this.latest(id);
    if (head === undefined) {
      throw new AuthorityError(`unknown grant id: ${id}`);
    }
    const revoked = revokeGrant(head, input);
    this.envelopes.setStatus(head.envelope.id, 'SUPERSEDED');
    this.envelopes.put(revoked.envelope);
    this.contents.set(revoked.envelope.id, structuredClone(revoked.content));
    return this.get(revoked.envelope.id)!;
  }

  /** Create a grant and register it (ACTIVE by default — grants enter the store operative). */
  issue(input: Parameters<typeof createGrant>[0]): AuthorityGrantArtifact {
    return this.put(createGrant({ ...input, status: input.status ?? 'ACTIVE' }));
  }
}
