/**
 * HistoryVM — the architecture-history view model (Work Order W11;
 * spec/architecture.md §6: "Architecture is a versioned projection/
 * hypothesis over System State"; the envelope supersede chains).
 *
 * A pure projection of envelope-bearing artifacts onto their SUPERSEDES
 * CHAINS over time. Chains are built from the envelopes' own `supersedes`
 * pointers (the spine's identity-preserving versioning), grouped by
 * artifact kind, ordered oldest -> newest. Every entry keeps its exact
 * version, status, creation timestamp and provenance — history is complete
 * and queryable, never summarized away.
 */

import { isArtifactId, isArtifactStatus } from '@sos-2/semantic-spine';
import type { ArtifactEnvelope } from '@sos-2/semantic-spine';
import { UIContractError } from './errors.js';
import { assertValidRationaleChain } from './rationale.js';
import type { RationaleChain } from './rationale.js';

/** One versioned entry in a supersede chain. */
export interface HistoryEntryVM {
  id: string;
  version: number;
  status: string;
  created_at: string;
  supersedes: string | null;
  provenance: string[];
}

/** One chain (a linear supersede lineage of one artifact kind). */
export interface HistoryChainVM {
  /** The artifact kind segment (e.g. "ArchitectureGraph", "Mission"). */
  kind: string;
  /** Entries ordered oldest -> newest (roots first). */
  chain: HistoryEntryVM[];
  /** The current head id (the newest entry; empty chains have none). */
  current_head: string | null;
}

/** The history view model: all supersede chains, sorted by kind. */
export interface HistoryVM {
  chains: HistoryChainVM[];
  /** Upstream/downstream rationale + evidence (W11 acceptance). */
  rationale: RationaleChain;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Any envelope-bearing artifact (the projection only reads the envelope). */
export interface EnvelopeBearer {
  envelope: ArtifactEnvelope;
}

/**
 * Project envelope-bearing artifacts onto their supersede chains.
 * Deterministic: chains are sorted by kind; entries within a chain follow
 * the supersedes pointers from roots (version ordering is the tiebreak).
 */
export function projectHistory(
  artifacts: readonly EnvelopeBearer[],
  rationale: RationaleChain,
): HistoryVM {
  assertValidRationaleChain(rationale);
  const envelopes: ArtifactEnvelope[] = [];
  for (const artifact of artifacts) {
    if (!isPlainObject(artifact) || !isPlainObject(artifact.envelope)) {
      throw new UIContractError('history artifacts must carry a spine envelope');
    }
    const envelope = artifact.envelope;
    if (!isArtifactId(envelope.id)) {
      throw new UIContractError(`history entry id must be a well-formed spine artifact id, received: ${JSON.stringify(envelope.id)}`);
    }
    envelopes.push(envelope);
  }

  // Group by kind (the id's kind segment and the envelope kind agree).
  const byKind = new Map<string, ArtifactEnvelope[]>();
  for (const envelope of envelopes) {
    const list = byKind.get(envelope.kind) ?? [];
    list.push(envelope);
    byKind.set(envelope.kind, list);
  }

  const chains: HistoryChainVM[] = [];
  for (const kind of [...byKind.keys()].sort()) {
    const entries = byKind.get(kind)!;
    const byId = new Map(entries.map((envelope) => [envelope.id, envelope]));
    const supersededIds = new Set(
      entries.map((envelope) => envelope.supersedes).filter((id): id is string => id !== null),
    );
    const roots = entries
      .filter((envelope) => envelope.supersedes === null)
      .sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : a.id < b.id ? -1 : 1));
    const chain: HistoryEntryVM[] = [];
    const seen = new Set<string>();
    for (const root of roots) {
      let current: ArtifactEnvelope | undefined = root;
      while (current !== undefined && !seen.has(current.id)) {
        seen.add(current.id);
        chain.push({
          id: current.id,
          version: current.version,
          status: current.status,
          created_at: current.created_at,
          supersedes: current.supersedes,
          provenance: [...current.provenance],
        });
        // Follow the forward pointer: the entry superseding the current one.
        const nextId = entries.find((candidate) => candidate.supersedes === current!.id)?.id;
        current = nextId === undefined ? undefined : byId.get(nextId);
      }
    }
    // Entries not reachable from a root (dangling supersedes pointers are a
    // store-level invariant violation) are still shown, appended by version.
    for (const envelope of entries.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : a.id < b.id ? -1 : 1))) {
      if (!seen.has(envelope.id)) {
        seen.add(envelope.id);
        chain.push({
          id: envelope.id,
          version: envelope.version,
          status: envelope.status,
          created_at: envelope.created_at,
          supersedes: envelope.supersedes,
          provenance: [...envelope.provenance],
        });
      }
    }
    const head = chain.length === 0 ? null : (chain[chain.length - 1] as HistoryEntryVM).id;
    chains.push({ kind, chain, current_head: head });
  }

  const vm: HistoryVM = { chains, rationale };
  assertValidHistoryVM(vm);
  return vm;
}

/** Validate a HistoryVM (throws UIContractError). */
export function assertValidHistoryVM(value: unknown): asserts value is HistoryVM {
  if (!isPlainObject(value)) {
    throw new UIContractError(`history view model must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set(['chains', 'rationale']);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new UIContractError('history view model must have the exact W11 field set { chains, rationale }');
  }
  if (!Array.isArray(record['chains'])) {
    throw new UIContractError('history view model chains must be an array');
  }
  const kinds = new Set<string>();
  for (const chain of record['chains']) {
    if (!isPlainObject(chain) || Object.keys(chain).length !== 3) {
      throw new UIContractError('history chains must have the exact field set { kind, chain, current_head }');
    }
    const chainRecord = chain as Record<string, unknown>;
    if (!isNonEmptyString(chainRecord['kind'])) {
      throw new UIContractError('history chain kind must be a non-empty string');
    }
    if (kinds.has(chainRecord['kind'])) {
      throw new UIContractError(`duplicate history chain kind: ${JSON.stringify(chainRecord['kind'])}`);
    }
    kinds.add(chainRecord['kind']);
    if (!Array.isArray(chainRecord['chain'])) {
      throw new UIContractError('history chain entries must be an array');
    }
    for (const entry of chainRecord['chain'] as HistoryEntryVM[]) {
      if (!isPlainObject(entry) || Object.keys(entry).length !== 6) {
        throw new UIContractError('history entries must have the exact field set { id, version, status, created_at, supersedes, provenance }');
      }
      if (!isNonEmptyString(entry.id) || !isArtifactId(entry.id)) {
        throw new UIContractError('history entry id must be a well-formed spine artifact id');
      }
      if (!isArtifactStatus(entry.status)) {
        throw new UIContractError('history entry status must be from the frozen envelope vocabulary');
      }
    }
    const chainEntries = chainRecord['chain'] as HistoryEntryVM[];
    if (chainEntries.length > 0) {
      if (chainRecord['current_head'] !== (chainEntries[chainEntries.length - 1] as HistoryEntryVM).id) {
        throw new UIContractError('history chain current_head must be the newest entry (chains are ordered oldest -> newest)');
      }
      const first = chainEntries[0] as HistoryEntryVM;
      if (first.supersedes !== null) {
        throw new UIContractError('history chains start at a root (supersedes === null)');
      }
      for (let index = 1; index < chainEntries.length; index += 1) {
        const previous = chainEntries[index - 1] as HistoryEntryVM;
        const current = chainEntries[index] as HistoryEntryVM;
        if (current.supersedes !== previous.id) {
          throw new UIContractError(
            `history chain ${JSON.stringify(chainRecord['kind'])} is not contiguous: entry ${current.id} supersedes ${JSON.stringify(current.supersedes)}, expected ${previous.id}`,
          );
        }
      }
    } else if (chainRecord['current_head'] !== null) {
      throw new UIContractError('an empty history chain must have current_head null');
    }
  }
  try {
    assertValidRationaleChain(record['rationale']);
  } catch (cause) {
    throw new UIContractError(`history view model rationale is invalid: ${(cause as Error).message}`);
  }
}

/** Predicate form of assertValidHistoryVM. */
export function validateHistoryVM(value: unknown): value is HistoryVM {
  try {
    assertValidHistoryVM(value);
    return true;
  } catch {
    return false;
  }
}
