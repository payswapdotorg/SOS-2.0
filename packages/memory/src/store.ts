/**
 * The Architecture Memory Store (Work Order W5) — versioned memory under
 * spine envelope lifecycle discipline, with the machine-enforced
 * append-only evolution rule and typed trace links:
 *
 *   - SUPPORTS links, evidence record -> memory artifact version (minted
 *     from every distinct evidence reference of the version, so every
 *     memory version is traceable to its evidence through the spine);
 *   - DERIVED_FROM links for revision lineage (revised -> previous).
 *
 * THE EVOLUTION RULE (append-only memory, never forgetting):
 *   - no entry of ANY kind may ever be DROPPED across a revision;
 *   - FAILURE entries are immutable (contexts of failure are retained
 *     verbatim, never dropped and never rewritten);
 *   - LIABILITY entries may change ONLY in their resolution (with valid
 *     resolution state transitions) — statement, severity, owner-kind,
 *     context and recorded_at are immutable, and deletion is impossible;
 *   - all other entries are immutable; revisions may only APPEND new
 *     entries (a correction is a new entry; the old one stays in history).
 *
 * Revision discipline: only ACTIVE memories can be revised; the revision is
 * version + 1, supersedes the current version, status ACTIVE, and carries
 * its OWN update provenance (producer + evidence refs) plus non-empty
 * envelope provenance. history() returns the complete root -> head chain,
 * ordered by strictly increasing version (contiguous, cycle-checked).
 *
 * Determinism: listings are sorted by id; entry queries are sorted by entry
 * id.
 */

import { EnvelopeStore, TraceLinkStore, createTraceLink } from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, TraceLink } from '@sos-2/semantic-spine';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { MemoryError } from './errors.js';
import {
  assertResolutionTransition,
  canResolve,
} from './liability.js';
import type { LiabilityResolution } from './liability.js';
import {
  assertValidArchitectureMemory,
  createArchitectureMemory,
  memoryEvidenceRefs,
} from './artifact.js';
import type {
  ArchitectureMemoryArtifact,
  ArchitectureMemoryContent,
} from './artifact.js';
import type {
  FailureEntry,
  LearnedRuleEntry,
  LiabilityEntry,
  MemoryEntry,
  MemoryEntryKind,
  OutcomeEntry,
  ObservationEntry,
  PredictionEntry,
  RollbackEntry,
} from './entries.js';

/** The revision input for a stored architecture memory. */
export interface ReviseMemoryInput {
  /** The FULL next entries set (old entries verbatim-or-liability-resolution + new entries). */
  entries: MemoryEntry[];
  /** The update provenance of THIS revision (producer + evidence refs). */
  update: ArchitectureMemoryContent['update'];
  /** REQUIRED non-empty provenance entries. */
  provenance: string[];
  /** RFC3339 revision timestamp, caller-supplied. */
  created_at: string;
  /** Authorizing artifact id; defaults to the current version's authority_ref. */
  authority_ref?: string | null;
}

export interface MemoryRevisionResult {
  /** The memory version being revised (as it was). */
  previous: ArchitectureMemoryArtifact;
  /** The new revision (ACTIVE, version + 1, supersedes previous). */
  revised: ArchitectureMemoryArtifact;
  /** DERIVED_FROM trace link: revised -> previous. */
  revision_link: TraceLink;
}

function entryById(entries: readonly MemoryEntry[], id: string): MemoryEntry | undefined {
  return entries.find((entry) => entry.id === id);
}

/**
 * THE EVOLUTION RULE (pure, exported for direct testing): validate that a
 * new content is a legal evolution of the old content.
 *
 *   - every old entry id must be present in the new content (NO DROPS);
 *   - FAILURE entries must be byte-identical (canonical comparison);
 *   - LIABILITY entries may differ ONLY in `resolution`, and the state
 *     change must be a valid transition;
 *   - every other entry must be byte-identical;
 *   - new entries (ids not present in the old content) are unconstrained
 *     beyond their own validity (validated by content validation).
 */
export function assertValidMemoryEvolution(
  oldContent: ArchitectureMemoryContent,
  newContent: ArchitectureMemoryContent,
): void {
  const oldById = new Map<string, MemoryEntry>();
  for (const entry of oldContent.entries) {
    oldById.set(entry.id, entry);
  }
  const newById = new Map<string, MemoryEntry>();
  for (const entry of newContent.entries) {
    if (newById.has(entry.id)) {
      throw new MemoryError(`duplicate memory entry id rejected: ${JSON.stringify(entry.id)}`);
    }
    newById.set(entry.id, entry);
  }
  for (const [id, oldEntry] of oldById) {
    const newEntry = newById.get(id);
    if (newEntry === undefined) {
      throw new MemoryError(
        `memory entry deletion rejected: ${JSON.stringify(id)} (kind ${oldEntry.entry_kind}) — ` +
          'memory never forgets; entries are retained, never dropped',
      );
    }
    if (oldEntry.entry_kind !== newEntry.entry_kind) {
      throw new MemoryError(
        `memory entry kind change rejected: ${JSON.stringify(id)} was a ${oldEntry.entry_kind}, revision says ${newEntry.entry_kind}`,
      );
    }
    if (oldEntry.entry_kind === 'LIABILITY' && newEntry.entry_kind === 'LIABILITY') {
      assertLiabilityEvolution(oldEntry, newEntry);
      continue;
    }
    if (canonicalSerialize(oldEntry) !== canonicalSerialize(newEntry)) {
      throw new MemoryError(
        `memory entry mutation rejected: ${JSON.stringify(id)} (kind ${oldEntry.entry_kind}) — ` +
          (oldEntry.entry_kind === 'FAILURE'
            ? 'failure contexts are retained verbatim and never rewritten'
            : 'entries are immutable across revisions; append a new entry instead') +
          ' (liabilities may change ONLY in resolution)',
      );
    }
  }
}

function assertLiabilityEvolution(oldEntry: LiabilityEntry, newEntry: LiabilityEntry): void {
  const immutable: Array<keyof LiabilityEntry> = ['statement', 'severity', 'owner_kind', 'context', 'recorded_at'];
  for (const field of immutable) {
    if (canonicalSerialize(oldEntry[field]) !== canonicalSerialize(newEntry[field])) {
      throw new MemoryError(
        `liability mutation rejected: ${JSON.stringify(oldEntry.id)}.${String(field)} may not change ` +
          '(a technical liability is a first-class record; only its resolution state may change — ' +
          're-assessments require a NEW liability entry)',
      );
    }
  }
  const oldResolution = oldEntry.resolution;
  const newResolution = newEntry.resolution;
  if (!canResolve(oldResolution.state, newResolution.state)) {
    throw new MemoryError(
      `invalid liability resolution transition for ${JSON.stringify(oldEntry.id)}: ${oldResolution.state} -> ${newResolution.state}`,
    );
  }
  if (oldResolution.state === newResolution.state) {
    return; // note/evidence/timestamp refinements on the same state are permitted
  }
  assertResolutionTransition(oldResolution.state, newResolution.state);
}

/**
 * In-memory Architecture Memory Store.
 */
export class ArchitectureMemoryStore {
  private readonly envelopes = new EnvelopeStore();
  private readonly contents = new Map<string, ArchitectureMemoryContent>();
  private readonly links = new TraceLinkStore();

  private requireContent(id: string): ArchitectureMemoryContent {
    const content = this.contents.get(id);
    if (content === undefined) {
      throw new MemoryError(`unknown architecture memory id: ${id}`);
    }
    return content;
  }

  private assemble(envelope: ArtifactEnvelope): ArchitectureMemoryArtifact {
    return { envelope, content: structuredClone(this.requireContent(envelope.id)) };
  }

  /** Mint SUPPORTS links from each distinct evidence reference to the memory version. */
  private mintEvidenceLinks(memory: ArchitectureMemoryArtifact): void {
    for (const evidenceId of memoryEvidenceRefs(memory.content)) {
      this.links.addLink({
        source: evidenceId,
        target: memory.envelope.id,
        type: 'SUPPORTS',
        provenance: [...memory.envelope.provenance],
      });
    }
  }

  /** Validate and store a memory artifact (root or continuation of a chain). */
  put(memory: ArchitectureMemoryArtifact): ArchitectureMemoryArtifact {
    if (memory.envelope.kind !== 'ArchitectureMemory') {
      throw new MemoryError(`not an ArchitectureMemory artifact: ${JSON.stringify(memory.envelope.kind)}`);
    }
    // Full artifact validation (envelope + content) first:
    assertValidArchitectureMemory(memory);
    if (memory.envelope.supersedes !== null) {
      const previous = this.envelopes.get(memory.envelope.supersedes);
      if (previous === undefined) {
        throw new MemoryError(
          `memory ${memory.envelope.id} supersedes unknown artifact ${memory.envelope.supersedes} (revision history must be complete)`,
        );
      }
      if (previous.kind !== 'ArchitectureMemory') {
        throw new MemoryError(`an architecture memory cannot supersede a ${previous.kind} artifact: ${previous.id}`);
      }
      if (memory.envelope.version !== previous.version + 1) {
        throw new MemoryError(
          `memory revision version must be exactly previous.version + 1 (expected ${previous.version + 1}, received ${memory.envelope.version})`,
        );
      }
      // The evolution rule applies to direct puts of continuations too:
      assertValidMemoryEvolution(this.requireContent(previous.id), memory.content);
    }
    this.envelopes.put(memory.envelope);
    this.contents.set(memory.envelope.id, structuredClone(memory.content));
    this.mintEvidenceLinks(memory);
    return memory;
  }

  get(id: string): ArchitectureMemoryArtifact | undefined {
    const envelope = this.envelopes.get(id);
    if (envelope === undefined || envelope.kind !== 'ArchitectureMemory') {
      return undefined;
    }
    return this.assemble(envelope);
  }

  has(id: string): boolean {
    return this.envelopes.has(id);
  }

  /** All memory artifacts, sorted by id (deterministic). */
  list(): ArchitectureMemoryArtifact[] {
    return this.envelopes
      .list()
      .filter((envelope) => envelope.kind === 'ArchitectureMemory')
      .map((envelope) => this.assemble(envelope));
  }

  get size(): number {
    return this.list().length;
  }

  /**
   * The explicit revision workflow against a stored memory: validates the
   * evolution rule, then creates the next version (ACTIVE, version + 1,
   * supersedes the current version) with its OWN update provenance.
   */
  revise(id: string, input: ReviseMemoryInput): MemoryRevisionResult {
    const currentEnvelope = this.envelopes.get(id);
    if (currentEnvelope === undefined || currentEnvelope.kind !== 'ArchitectureMemory') {
      throw new MemoryError(`unknown architecture memory id: ${id}`);
    }
    const current = this.assemble(currentEnvelope);
    if (current.envelope.status !== 'ACTIVE') {
      throw new MemoryError(
        `only ACTIVE architecture memories can be revised; current status: ${current.envelope.status}`,
      );
    }
    if (typeof input !== 'object' || input === null) {
      throw new MemoryError('memory revision input must be an object');
    }

    // Validate the next content fully, THEN the evolution rule:
    const revised = createArchitectureMemory({
      content: { entries: input.entries, update: input.update },
      provenance: input.provenance,
      created_at: input.created_at,
      authority_ref: input.authority_ref ?? current.envelope.authority_ref,
      version: current.envelope.version + 1,
      status: 'ACTIVE',
      supersedes: current.envelope.id,
    });

    assertValidMemoryEvolution(current.content, revised.content);

    const revision_link = createTraceLink({
      source: revised.envelope.id,
      target: current.envelope.id,
      type: 'DERIVED_FROM',
      provenance: [...input.provenance],
    });

    this.envelopes.setStatus(id, 'SUPERSEDED');
    this.envelopes.put(revised.envelope);
    this.contents.set(revised.envelope.id, structuredClone(revised.content));
    this.mintEvidenceLinks(revised);
    this.links.add(revision_link);

    return {
      previous: this.assemble(this.envelopes.get(id)!),
      revised: this.assemble(this.envelopes.get(revised.envelope.id)!),
      revision_link,
    };
  }

  /**
   * Complete revision history for a memory: [root, ..., this revision],
   * ordered by strictly increasing version. Throws if the chain is
   * incomplete, non-contiguous or cyclic.
   */
  history(id: string): ArchitectureMemoryArtifact[] {
    const start = this.get(id);
    if (start === undefined) {
      throw new MemoryError(`unknown architecture memory id: ${id}`);
    }
    const chain: ArchitectureMemoryArtifact[] = [];
    const visited = new Set<string>();
    let cursor: ArchitectureMemoryArtifact | undefined = start;
    while (cursor !== undefined) {
      if (visited.has(cursor.envelope.id)) {
        throw new MemoryError(`revision cycle detected at ${cursor.envelope.id}`);
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
        throw new MemoryError(`incomplete revision history: missing supersedes target ${previousId}`);
      }
      if (cursor.envelope.version !== previous.envelope.version + 1) {
        throw new MemoryError(
          `non-contiguous revision history at ${cursor.envelope.id} (version ${cursor.envelope.version} follows ${previous.envelope.version})`,
        );
      }
      cursor = previous;
    }
    chain.reverse();
    return chain;
  }

  /** The current ACTIVE memories (each revision chain has at most one). */
  active(): ArchitectureMemoryArtifact[] {
    return this.list().filter((memory) => memory.envelope.status === 'ACTIVE');
  }

  /** Entries of the given kinds, sorted by entry id (deterministic). */
  entriesOf(id: string, kind?: MemoryEntryKind): MemoryEntry[] {
    const memory = this.get(id);
    if (memory === undefined) {
      throw new MemoryError(`unknown architecture memory id: ${id}`);
    }
    const entries = kind === undefined ? memory.content.entries : memory.content.entries.filter((entry) => entry.entry_kind === kind);
    return [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Failure entries (contexts retained), sorted by entry id. */
  failuresOf(id: string): FailureEntry[] {
    return this.entriesOf(id, 'FAILURE') as FailureEntry[];
  }

  /** Liability entries, optionally filtered by resolution state and/or severity, sorted by entry id. */
  liabilitiesOf(
    id: string,
    filter?: { state?: LiabilityResolution['state']; severity?: LiabilityEntry['severity'] },
  ): LiabilityEntry[] {
    return (this.entriesOf(id, 'LIABILITY') as LiabilityEntry[]).filter(
      (entry) =>
        (filter?.state === undefined || entry.resolution.state === filter.state) &&
        (filter?.severity === undefined || entry.severity === filter.severity),
    );
  }

  /** Learned rule entries (applicability + evidence refs), sorted by entry id. */
  learnedRulesOf(id: string): LearnedRuleEntry[] {
    return this.entriesOf(id, 'LEARNED_RULE') as LearnedRuleEntry[];
  }

  /** SUPPORTS links from evidence records to the given memory version id (insertion order). */
  evidenceSupporting(memoryId: string): TraceLink[] {
    return this.links.to(memoryId).filter((link) => link.type === 'SUPPORTS');
  }

  /** All recorded trace links (insertion order). */
  allLinks(): TraceLink[] {
    return this.links.all();
  }

  get linkCount(): number {
    return this.links.size;
  }
}
