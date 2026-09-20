/**
 * ArchitectureMemory artifacts — the W5 realization of durable
 * architecture/learning memory (spec/architecture.md §5: "Architecture
 * Memory: predictions, observations, outcomes, failures, liabilities,
 * rollback and learned rules"; requirement R19).
 *
 * An ArchitectureMemory is a Semantic Spine envelope artifact (frozen core
 * kind "ArchitectureMemory") plus versioned content:
 *
 *   - entries: the seven memory entry kinds (see entries.ts);
 *   - update: the provenance of THIS version — WHO/WHAT produced it
 *     (Producer, from @sos-2/provenance) and FROM WHICH EVIDENCE (validated
 *     Evidence artifact ids; may be empty only for updates that genuinely
 *     cite no evidence, e.g. pure predictions — the envelope's mandatory
 *     non-empty provenance entries record the human/analysis basis).
 *
 * Update discipline (realized in store.ts): revisions are version+1
 * supersedes chains; every revision preserves provenance; the append-only
 * evolution rule is machine-enforced (no entry is ever dropped; failures are
 * immutable; liabilities change only in resolution); history is complete,
 * contiguous and queryable.
 *
 * Identity discipline: ids are ALWAYS deterministic (content-addressed over
 * the creation address — envelope fields minus id, plus content), exactly
 * like @sos-2/mission. No identifiers are invented here; no envelope logic
 * is duplicated (AGENTS.md §4).
 */

import {
  assertValidEnvelope,
  createEnvelope,
  deriveDeterministicArtifactId,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { assertValidProducer, isLlmProducer } from '@sos-2/provenance';
import type { Producer } from '@sos-2/provenance';
import { MemoryError } from './errors.js';
import { assertValidEvidenceRefs } from './liability.js';
import { assertValidMemoryEntries } from './entries.js';
import type { MemoryEntry } from './entries.js';

/** The (core, frozen) artifact kind segment used for architecture memory ids. */
export const ARCHITECTURE_MEMORY_KIND = 'ArchitectureMemory';

/** The provenance of one memory update: who/what produced it, from which evidence. */
export interface MemoryUpdateProvenance {
  /** WHO/WHAT produced this update. */
  producer: Producer;
  /** Evidence artifact ids this update was derived from (validated; may be empty). */
  evidence_refs: string[];
}

/** The full memory content (the exact creation content). */
export interface ArchitectureMemoryContent {
  entries: MemoryEntry[];
  update: MemoryUpdateProvenance;
}

export interface ArchitectureMemoryArtifact {
  /** Semantic Spine envelope; kind is always "ArchitectureMemory". */
  envelope: ArtifactEnvelope;
  /** Memory content (exact field set). */
  content: ArchitectureMemoryContent;
}

export interface CreateArchitectureMemoryInput {
  content: ArchitectureMemoryContent;
  /** REQUIRED non-empty provenance entries (spine discipline). */
  provenance: string[];
  /** RFC3339 creation timestamp, caller-supplied (no hidden clocks). */
  created_at: string;
  /** Authorizing artifact id, or null. */
  authority_ref?: string | null;
  /** Version (integer >= 1). Defaults to 1. */
  version?: number;
  /** DRAFT (default) or ACTIVE. */
  status?: ArtifactStatus;
  /** Memory artifact id superseded by this one, or null (roots). */
  supersedes?: string | null;
}

/**
 * The exact value an architecture memory id is derived from (exported so
 * tests and diagnostics reproduce ids bit-exactly — the W0.5 fixture
 * discipline this package follows).
 */
export interface ArchitectureMemoryCreationAddress {
  kind: 'ArchitectureMemory';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: ArchitectureMemoryContent;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

function isPlainJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate the full memory content (throws MemoryError): valid entries
 * (unique ids, cross-references) plus a valid update provenance. LLM
 * discipline: an LLM-produced update can never attach calibrated numeric
 * confidence to a learned rule (an LLM self-reported confidence value is
 * never calibrated truth — spec/meta-model.md).
 */
export function assertValidArchitectureMemoryContent(
  value: unknown,
): asserts value is ArchitectureMemoryContent {
  if (!isPlainJsonRecord(value)) {
    throw new MemoryError('architecture memory content must be an object');
  }
  if (!('entries' in value) || !('update' in value)) {
    throw new MemoryError('architecture memory content must have exact fields { entries, update }');
  }
  assertValidMemoryEntries(value['entries']);
  const update = value['update'];
  if (!isPlainJsonRecord(update)) {
    throw new MemoryError('memory update provenance must be an object with exact fields { producer, evidence_refs }');
  }
  const updateKeys = Object.keys(update);
  if (updateKeys.length !== 2 || !updateKeys.includes('producer') || !updateKeys.includes('evidence_refs')) {
    throw new MemoryError('memory update provenance must be an object with exact fields { producer, evidence_refs }');
  }
  // Producer validation (throws ProvenanceError with a specific message):
  try {
    assertValidProducer(update['producer']);
  } catch (cause) {
    throw new MemoryError(`update producer is invalid: ${(cause as Error).message}`);
  }
  assertValidEvidenceRefs(update['evidence_refs'], 'update evidence_refs');

  const producer = update['producer'] as Producer;
  if (isLlmProducer(producer)) {
    for (const entry of value['entries'] as MemoryEntry[]) {
      if (entry.entry_kind === 'LEARNED_RULE' && entry.uncertainty.kind === 'CALIBRATED') {
        throw new MemoryError(
          'LLM-produced memory updates cannot attach calibrated numeric confidence to learned rules: ' +
            'an LLM self-reported confidence value is never calibrated truth (spec/meta-model.md)',
        );
      }
    }
  }
}

/** Predicate form of assertValidArchitectureMemoryContent. */
export function validateArchitectureMemoryContent(value: unknown): value is ArchitectureMemoryContent {
  try {
    assertValidArchitectureMemoryContent(value);
    return true;
  } catch {
    return false;
  }
}

/** The creation address of a memory creation input (envelope fields + content). */
export function architectureMemoryCreationAddress(
  input: CreateArchitectureMemoryInput,
): ArchitectureMemoryCreationAddress {
  assertValidArchitectureMemoryContent(input.content);
  if (!isNonEmptyStringArray(input.provenance)) {
    throw new MemoryError(
      'provenance must be a non-empty array of non-empty strings (no provenance-less memory updates)',
    );
  }
  return {
    kind: ARCHITECTURE_MEMORY_KIND,
    version: input.version ?? 1,
    status: input.status ?? 'DRAFT',
    authority_ref: input.authority_ref ?? null,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes: input.supersedes ?? null,
    content: input.content,
  };
}

/** Derive the deterministic architecture memory id for a creation input. */
export function architectureMemoryArtifactId(input: CreateArchitectureMemoryInput): string {
  return deriveDeterministicArtifactId(ARCHITECTURE_MEMORY_KIND, architectureMemoryCreationAddress(input));
}

/** Create an architecture memory artifact (deterministic id, spine-minted envelope). */
export function createArchitectureMemory(input: CreateArchitectureMemoryInput): ArchitectureMemoryArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new MemoryError('architecture memory creation input must be an object');
  }
  assertValidArchitectureMemoryContent(input.content);

  const version = input.version ?? 1;
  const status: ArtifactStatus = input.status ?? 'DRAFT';
  const authorityRef = input.authority_ref ?? null;
  const supersedes = input.supersedes ?? null;

  const id = deriveDeterministicArtifactId(ARCHITECTURE_MEMORY_KIND, {
    kind: ARCHITECTURE_MEMORY_KIND,
    version,
    status,
    authority_ref: authorityRef,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes,
    content: input.content,
  });

  const envelope = createEnvelope({
    kind: ARCHITECTURE_MEMORY_KIND,
    version,
    status,
    authority_ref: authorityRef,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes,
    id,
  });

  return { envelope, content: structuredClone(input.content) };
}

const ARTIFACT_KEYS = ['envelope', 'content'] as const;

/**
 * Full semantic validation of an architecture memory artifact (throws
 * MemoryError): exact artifact shape, spine-valid envelope of kind
 * ArchitectureMemory, valid content.
 *
 * Identity discipline mirrors @sos-2/mission: ids are minted at CREATION
 * over the creation address and preserved across lifecycle transitions;
 * creation determinism is pinned by tests, not re-derived here.
 */
export function assertValidArchitectureMemory(value: unknown): asserts value is ArchitectureMemoryArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MemoryError('architecture memory artifact must be an object with exact fields { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  const expected = new Set<string>(ARTIFACT_KEYS);
  if (actualKeys.length !== ARTIFACT_KEYS.length || !actualKeys.every((key) => expected.has(key))) {
    throw new MemoryError('architecture memory artifact must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new MemoryError(`architecture memory envelope is not spine-valid: ${(cause as Error).message}`);
  }
  const envelope = record['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== ARCHITECTURE_MEMORY_KIND) {
    throw new MemoryError(
      `architecture memory envelope kind must be "${ARCHITECTURE_MEMORY_KIND}", received: ${JSON.stringify(envelope.kind)}`,
    );
  }
  assertValidArchitectureMemoryContent(record['content']);
}

/** Predicate form of assertValidArchitectureMemory. */
export function validateArchitectureMemory(value: unknown): value is ArchitectureMemoryArtifact {
  try {
    assertValidArchitectureMemory(value);
    return true;
  } catch {
    return false;
  }
}

/** True iff this memory version was produced by model output (LLM) — never authoritative (§18). */
export function isLlmMemoryUpdate(artifact: ArchitectureMemoryArtifact): boolean {
  assertValidArchitectureMemory(artifact);
  return isLlmProducer(artifact.content.update.producer);
}

/**
 * True iff this memory version is NON-AUTHORITATIVE: LLM output is never
 * authoritative evidence or authorization (spec/architecture.md §18).
 */
export function isNonAuthoritativeMemory(artifact: ArchitectureMemoryArtifact): boolean {
  return isLlmMemoryUpdate(artifact);
}

/** All evidence ids referenced by the entries and the update provenance of this content. */
export function memoryEvidenceRefs(content: ArchitectureMemoryContent): string[] {
  assertValidArchitectureMemoryContent(content);
  const refs = new Set<string>(content.update.evidence_refs);
  for (const entry of content.entries) {
    if (entry.entry_kind === 'PREDICTION') {
      continue; // predictions carry no evidence refs by design
    }
    if (entry.entry_kind === 'LIABILITY') {
      for (const ref of entry.resolution.resolution_evidence_refs) {
        refs.add(ref);
      }
      continue;
    }
    for (const ref of entry.evidence_refs) {
      refs.add(ref);
    }
  }
  return [...refs].sort();
}
