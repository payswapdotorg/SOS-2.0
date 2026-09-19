/**
 * SystemState store — versioned revisions with complete, queryable history.
 *
 * A SystemState revision chain is LINEAR and CONTIGUOUS by construction:
 *   - every artifact with `supersedes != null` references a SystemState that
 *     is already in the store;
 *   - the superseding version is exactly previous.version + 1 (no gaps —
 *     "full history queryable" means the chain is walkable root -> newest
 *     without holes);
 *   - an artifact can be superseded at most ONCE (no branching chains —
 *     history queries stay unambiguous).
 *
 * `history(id)` returns the full chain containing `id`, ordered from the root
 * (supersedes = null) to the newest revision. `latest(id)` walks the chain
 * forward to the current head. `supersede()` performs the atomic
 * ACTIVE -> SUPERSEDED transition and registers the new ACTIVE revision
 * (spine lifecycle discipline).
 */

import { withStatus } from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { SystemStateError } from './errors.js';
import { SYSTEM_STATE_KIND, assertValidSystemStateArtifact, createSystemState } from './artifact.js';
import type { SystemStateArtifact, CreateSystemStateInput } from './artifact.js';
import type { SystemStateContent } from './model.js';

export interface SupersedeSystemStateInput {
  /** The replacement content for the new revision. */
  content: SystemStateContent;
  /** REQUIRED non-empty provenance entries for the new revision. */
  provenance: string[];
  /** RFC3339 creation timestamp, caller-supplied. */
  created_at: string;
  /** Authorizing artifact id, or null to inherit from the superseded revision. */
  authority_ref?: string | null;
}

export interface SupersedeResult {
  /** The previous revision, now SUPERSEDED. */
  previous: SystemStateArtifact;
  /** The new ACTIVE revision (version = previous.version + 1, supersedes = previous id). */
  supersededBy: SystemStateArtifact;
}

export class SystemStateStore {
  private readonly artifacts = new Map<string, SystemStateArtifact>();
  /** superseded id -> superseding id (linear chains: at most one superseder). */
  private readonly supersededBy = new Map<string, string>();

  /** Register an artifact. Rejects invalid artifacts, duplicates, unknown/dangling/branching/non-contiguous supersedes. */
  put(artifact: SystemStateArtifact): SystemStateArtifact {
    assertValidSystemStateArtifact(artifact);
    if (this.artifacts.has(artifact.envelope.id)) {
      throw new SystemStateError(`system state already registered: ${artifact.envelope.id}`);
    }
    const supersedes = artifact.envelope.supersedes;
    if (supersedes !== null) {
      if (supersedes === artifact.envelope.id) {
        throw new SystemStateError('a system state cannot supersede itself');
      }
      const target = this.artifacts.get(supersedes);
      if (target === undefined) {
        throw new SystemStateError(
          `supersedes target is not registered: ${supersedes} (chains must be built root-first)`,
        );
      }
      if (target.envelope.kind !== SYSTEM_STATE_KIND) {
        throw new SystemStateError(`supersedes target is not a SystemState: ${supersedes}`);
      }
      if (artifact.envelope.version !== target.envelope.version + 1) {
        throw new SystemStateError(
          `non-contiguous revision: version ${artifact.envelope.version} must be exactly ` +
            `${target.envelope.version + 1} (full history must stay walkable without gaps)`,
        );
      }
      if (this.supersededBy.has(supersedes)) {
        throw new SystemStateError(
          `branching revision chain rejected: ${supersedes} is already superseded by ` +
            `${this.supersededBy.get(supersedes)} (history must stay linear and unambiguous)`,
        );
      }
      this.supersededBy.set(supersedes, artifact.envelope.id);
    }
    this.artifacts.set(artifact.envelope.id, { envelope: { ...artifact.envelope }, content: artifact.content });
    return artifact;
  }

  get(id: string): SystemStateArtifact | undefined {
    const artifact = this.artifacts.get(id);
    if (artifact === undefined) {
      return undefined;
    }
    return { envelope: { ...artifact.envelope }, content: artifact.content };
  }

  has(id: string): boolean {
    return this.artifacts.has(id);
  }

  /** All artifacts sorted by id (deterministic). */
  list(): SystemStateArtifact[] {
    return [...this.artifacts.values()]
      .map((artifact) => ({ envelope: { ...artifact.envelope }, content: artifact.content }))
      .sort((a, b) => (a.envelope.id < b.envelope.id ? -1 : a.envelope.id > b.envelope.id ? 1 : 0));
  }

  get size(): number {
    return this.artifacts.size;
  }

  private require(id: string): SystemStateArtifact {
    const artifact = this.artifacts.get(id);
    if (artifact === undefined) {
      throw new SystemStateError(`unknown system state id: ${id}`);
    }
    return artifact;
  }

  /**
   * The FULL revision chain containing `id`, ordered root -> newest.
   * Walks backward to the root (supersedes links) and forward to the current
   * head (reverse index). Completeness is guaranteed by put()'s chain
   * discipline: the chain always terminates at a root (supersedes = null).
   */
  history(id: string): SystemStateArtifact[] {
    const start = this.require(id);
    const chain: SystemStateArtifact[] = [start];
    // backward to the root
    let current = start;
    while (current.envelope.supersedes !== null) {
      const previous = this.require(current.envelope.supersedes);
      chain.push(previous);
      current = previous;
    }
    chain.reverse();
    // forward to the newest revision via the reverse index
    let head = chain[chain.length - 1]!;
    while (this.supersededBy.has(head.envelope.id)) {
      const nextId = this.supersededBy.get(head.envelope.id)!;
      chain.push(this.require(nextId));
      head = chain[chain.length - 1]!;
    }
    // defensive completeness check (cannot trigger given put() discipline)
    if (chain[0]!.envelope.supersedes !== null) {
      throw new SystemStateError(`broken revision chain: root of ${id} is not a root revision`);
    }
    return chain.map((artifact) => ({ envelope: { ...artifact.envelope }, content: artifact.content }));
  }

  /** The newest revision in the chain containing `id`. */
  latest(id: string): SystemStateArtifact {
    const chain = this.history(id);
    return chain[chain.length - 1]!;
  }

  /** Whether `id` is the newest revision of its chain. */
  isLatest(id: string): boolean {
    const latest = this.latest(id);
    return latest.envelope.id === id;
  }

  /** Validated status transition (identity preserved; spine discipline). */
  setStatus(id: string, next: ArtifactStatus): SystemStateArtifact {
    const artifact = this.require(id);
    const envelope: ArtifactEnvelope = withStatus(artifact.envelope, next);
    this.artifacts.set(id, { envelope, content: artifact.content });
    return { envelope: { ...envelope }, content: artifact.content };
  }

  /**
   * Atomically supersede an ACTIVE revision: the previous revision becomes
   * SUPERSEDED and a new ACTIVE revision (version + 1, supersedes = previous
   * id) is registered.
   */
  supersede(id: string, input: SupersedeSystemStateInput): SupersedeResult {
    const previous = this.require(id);
    if (previous.envelope.status !== 'ACTIVE') {
      throw new SystemStateError(
        `cannot supersede system state in status ${previous.envelope.status} (only ACTIVE revisions can be superseded)`,
      );
    }
    const supersededBy = createSystemState({
      content: input.content,
      provenance: input.provenance,
      created_at: input.created_at,
      authority_ref: input.authority_ref ?? previous.envelope.authority_ref,
      version: previous.envelope.version + 1,
      status: 'ACTIVE',
      supersedes: previous.envelope.id,
    });
    if (supersededBy.envelope.id === previous.envelope.id) {
      throw new SystemStateError('superseding system state must have a distinct id');
    }
    const previousEnvelope: ArtifactEnvelope = { ...previous.envelope, status: 'SUPERSEDED' };
    this.artifacts.set(previous.envelope.id, { envelope: previousEnvelope, content: previous.content });
    // put() registers the reverse index (superseded -> superseder) and
    // re-validates chain contiguity/linearity.
    this.put(supersededBy);
    return {
      previous: { envelope: { ...previousEnvelope }, content: previous.content },
      supersededBy: { envelope: { ...supersededBy.envelope }, content: supersededBy.content },
    };
  }
}

/** Convenience: create + register a root revision in one step. */
export function createSystemStateStore(roots: readonly SystemStateArtifact[]): SystemStateStore {
  const store = new SystemStateStore();
  for (const root of roots) {
    store.put(root);
  }
  return store;
}
