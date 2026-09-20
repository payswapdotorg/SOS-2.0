/**
 * The MetaProcess artifact — the versioned, spine-traceable realization of
 * the SOS PROCESS itself (W16): envelope of the registered extension kind
 * "MetaProcess" + typed content (the evolvable parameters + the constraining
 * mission reference). Revisions are minted through the exported operations
 * (applyMetaChange / activateRevision / rollbackMetaChange) and tracked by
 * the MetaProcessStore with the MissionStore discipline (linear, contiguous,
 * cycle-checked chains).
 *
 * Identity: deterministic content-addressed ids minted by the spine, exactly
 * like @sos-2/mission. Ids are minted at creation and PRESERVED across
 * lifecycle transitions (withStatus — the spine convention).
 */

import {
  assertValidEnvelope,
  createEnvelope,
  deriveDeterministicArtifactId,
  isArtifactId,
  withStatus,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus, TraceLink } from '@sos-2/semantic-spine';
import { createTraceLink } from '@sos-2/semantic-spine';
import { META_PROCESS_KIND } from './kinds.js';
import { MetaEvolutionError } from './errors.js';
import {
  applyParametersPatch,
  assertValidMetaProcessParameters,
  cloneParameters,
  parametersEqual,
} from './parameters.js';
import type { MetaProcessParameters, MetaProcessPatch } from './parameters.js';
import type { MetaChangeArtifact } from './change.js';

export interface MetaProcessContent {
  /** The evolvable process parameters (exact key set; guard-validated). */
  parameters: MetaProcessParameters;
  /** The constraining Mission artifact id (mission outranks architecture — §18), or null. */
  mission_ref: string | null;
  /** Non-empty version note. */
  notes: string;
}

export interface MetaProcessArtifact {
  envelope: ArtifactEnvelope;
  content: MetaProcessContent;
}

export interface CreateMetaProcessInput {
  content: MetaProcessContent;
  provenance: string[];
  created_at: string;
  authority_ref?: string | null;
  version?: number;
  status?: ArtifactStatus;
  supersedes?: string | null;
}

export interface MetaProcessCreationAddress {
  kind: 'MetaProcess';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: MetaProcessContent;
}

const ARTIFACT_KEYS = ['envelope', 'content'] as const;

export function metaProcessCreationAddress(input: CreateMetaProcessInput): MetaProcessCreationAddress {
  const version = input.version ?? 1;
  const status: ArtifactStatus = input.status ?? 'DRAFT';
  const authorityRef = input.authority_ref ?? null;
  const supersedes = input.supersedes ?? null;
  return {
    kind: META_PROCESS_KIND,
    version,
    status,
    authority_ref: authorityRef,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes,
    content: input.content,
  };
}

export function metaProcessArtifactId(input: CreateMetaProcessInput): string {
  return deriveDeterministicArtifactId(META_PROCESS_KIND, metaProcessCreationAddress(input));
}

export function createMetaProcess(input: CreateMetaProcessInput): MetaProcessArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new MetaEvolutionError('INVALID_META_INPUT', 'meta process creation input must be an object');
  }
  assertValidMetaProcessParameters(input.content?.parameters);
  if (input.content.mission_ref !== null && !isArtifactId(input.content.mission_ref)) {
    throw new MetaEvolutionError(
      'INVALID_META_INPUT',
      `content.mission_ref must be null or a well-formed spine artifact id, received: ${JSON.stringify(input.content.mission_ref)}`,
    );
  }
  if (typeof input.content.notes !== 'string' || input.content.notes.length === 0) {
    throw new MetaEvolutionError('INVALID_META_INPUT', 'content.notes must be a non-empty string');
  }
  const address = metaProcessCreationAddress(input);
  const id = deriveDeterministicArtifactId(META_PROCESS_KIND, address);
  const envelope = createEnvelope({
    kind: META_PROCESS_KIND,
    version: address.version,
    status: address.status,
    authority_ref: address.authority_ref,
    provenance: address.provenance,
    created_at: address.created_at,
    supersedes: address.supersedes,
    id,
  });
  return {
    envelope,
    content: {
      parameters: cloneParameters(input.content.parameters),
      mission_ref: input.content.mission_ref,
      notes: input.content.notes,
    },
  };
}

export function assertValidMetaProcess(value: unknown): asserts value is MetaProcessArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MetaEvolutionError('INVALID_META_INPUT', 'meta process artifact must be an object with exact fields { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  if (actualKeys.length !== ARTIFACT_KEYS.length || !actualKeys.every((key) => (ARTIFACT_KEYS as readonly string[]).includes(key))) {
    throw new MetaEvolutionError('INVALID_META_INPUT', 'meta process artifact must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new MetaEvolutionError('INVALID_META_INPUT', `meta process envelope is not spine-valid: ${(cause as Error).message}`);
  }
  if ((record['envelope'] as ArtifactEnvelope).kind !== META_PROCESS_KIND) {
    throw new MetaEvolutionError('INVALID_META_INPUT', `meta process envelope kind must be ${META_PROCESS_KIND}`);
  }
  assertValidMetaProcessParameters((record['content'] as MetaProcessContent | undefined)?.parameters);
}

/**
 * Apply a MetaChange to a process revision — mint the TRIAL revision (DRAFT
 * by default: evaluation-grade application, the revision whose before/after
 * objective values the effectiveness stage measures; activation — the live
 * application — happens ONLY through activateRevision after an ACT decision).
 *
 * Rebase semantics: the change binds to its TARGET revision (proposed
 * against it); it may be applied to a LATER revision of the same chain
 * (patches are absolute assignments, so the semantics are exact), which the
 * caller proves through `targetInChain`.
 *
 * THE NON-DISABLEABLE GUARD RUNS HERE TOO: the apply path re-evaluates the
 * governance guard regardless of any caller-supplied verdict — a
 * governance-weakening change cannot be applied even by direct API use
 * (guard bypass is rejected loudly).
 */
export function applyMetaChange(
  process: MetaProcessArtifact,
  change: MetaChangeArtifact,
  guard: { evaluate: (changeArtifact: MetaChangeArtifact, parameters: MetaProcessParameters) => { passed: boolean; rejection: unknown } },
  input: {
    provenance: string[];
    created_at: string;
    authority_ref?: string | null;
    notes?: string;
    /** Proves the change's target revision is an ancestor of `process` (chain rebase). */
    targetInChain?: (targetId: string) => boolean;
  },
): { trial: MetaProcessArtifact; revision_link: TraceLink } {
  const verdict = guard.evaluate(change, process.content.parameters);
  if (!verdict.passed) {
    throw new MetaEvolutionError(
      'GUARD_BYPASS_ATTEMPT',
      `meta change ${change.envelope.id} was rejected by the governance guard and cannot be applied: ${JSON.stringify(verdict.rejection)}`,
    );
  }
  const targetsSelf = change.content.target_process_id === process.envelope.id;
  const targetsAncestor = input.targetInChain?.(change.content.target_process_id) === true;
  if (!targetsSelf && !targetsAncestor) {
    throw new MetaEvolutionError(
      'INVALID_REVISION_OPERATION',
      `meta change ${change.envelope.id} targets process ${change.content.target_process_id}, which is neither the current revision ${process.envelope.id} nor an ancestor of it in the revision chain`,
    );
  }
  const parameters = applyParametersPatch(process.content.parameters, change.content.patch);
  const trial = createMetaProcess({
    content: {
      parameters,
      mission_ref: process.content.mission_ref,
      notes: input.notes ?? `trial application of meta change ${change.envelope.id}`,
    },
    provenance: [...input.provenance, `meta-evolution:trial:${change.envelope.id}`],
    created_at: input.created_at,
    authority_ref: input.authority_ref ?? process.envelope.authority_ref,
    version: process.envelope.version + 1,
    status: 'DRAFT',
    supersedes: process.envelope.id,
  });
  const revision_link = createTraceLink({
    source: trial.envelope.id,
    target: process.envelope.id,
    type: 'DERIVED_FROM',
    provenance: [...input.provenance, 'meta-evolution:revision', `meta-evolution:change:${change.envelope.id}`],
  });
  return { trial, revision_link };
}

/**
 * ACTIVATE a trial revision — the live application. The trial's id is
 * PRESERVED (the spine lifecycle convention); the superseded head moves to
 * SUPERSEDED. This is the "applied MetaChange produces a new MetaProcess
 * revision" endpoint of the decision stage.
 */
export function activateRevision(
  trial: MetaProcessArtifact,
  head: MetaProcessArtifact,
): { activated: MetaProcessArtifact; superseded: MetaProcessArtifact } {
  if (trial.envelope.status !== 'DRAFT') {
    throw new MetaEvolutionError('INVALID_REVISION_OPERATION', `revision ${trial.envelope.id} is ${trial.envelope.status} — only DRAFT trials can be activated`);
  }
  if (trial.envelope.supersedes !== head.envelope.id) {
    throw new MetaEvolutionError(
      'INVALID_REVISION_OPERATION',
      `trial ${trial.envelope.id} supersedes ${String(trial.envelope.supersedes)}, not the current head ${head.envelope.id}`,
    );
  }
  const activated: MetaProcessArtifact = { envelope: withStatus(trial.envelope, 'ACTIVE'), content: trial.content };
  const superseded: MetaProcessArtifact = { envelope: withStatus(head.envelope, 'SUPERSEDED'), content: head.content };
  return { activated, superseded };
}

/** Retire an abandoned trial (DRAFT -> RETIRED; never activated). */
export function retireRevision(trial: MetaProcessArtifact): MetaProcessArtifact {
  if (trial.envelope.status !== 'DRAFT') {
    throw new MetaEvolutionError('INVALID_REVISION_OPERATION', `revision ${trial.envelope.id} is ${trial.envelope.status} — only DRAFT trials can be retired`);
  }
  return { envelope: withStatus(trial.envelope, 'RETIRED'), content: trial.content };
}

/**
 * The EXACT RESTORE check — a restored revision's parameters must equal the
 * pre-change parameters exactly (byte-stable deep equality; the W16 rollback
 * invariant "the process revision restores exactly").
 */
export function assertExactRestore(restored: MetaProcessParameters, expected: MetaProcessParameters): void {
  if (!parametersEqual(restored, expected)) {
    throw new MetaEvolutionError(
      'RESTORE_NOT_EXACT',
      `the restored process parameters are not the exact pre-change parameters: restored ${JSON.stringify(restored)} vs expected ${JSON.stringify(expected)}`,
    );
  }
}

/**
 * The in-memory MetaProcess revision store (the MissionStore discipline:
 * linear contiguous chains, no duplicates, cycle-checked history).
 */
export class MetaProcessStore {
  private readonly artifacts = new Map<string, MetaProcessArtifact>();

  put(process: MetaProcessArtifact): MetaProcessArtifact {
    assertValidMetaProcess(process);
    const existing = this.artifacts.get(process.envelope.id);
    if (existing !== undefined) {
      throw new MetaEvolutionError('INVALID_REVISION_OPERATION', `duplicate meta process id: ${process.envelope.id}`);
    }
    if (process.envelope.supersedes !== null) {
      const target = this.artifacts.get(process.envelope.supersedes);
      if (target === undefined) {
        throw new MetaEvolutionError(
          'INVALID_REVISION_OPERATION',
          `meta process ${process.envelope.id} supersedes unknown revision ${process.envelope.supersedes}`,
        );
      }
      if (target.envelope.kind !== META_PROCESS_KIND || process.envelope.version !== target.envelope.version + 1) {
        throw new MetaEvolutionError(
          'INVALID_REVISION_OPERATION',
          `meta process chain violation: ${process.envelope.id}@v${process.envelope.version} must supersede ${target.envelope.id}@v${target.envelope.version} with version exactly +1`,
        );
      }
    }
    this.artifacts.set(process.envelope.id, process);
    return process;
  }

  replace(previous: MetaProcessArtifact, next: MetaProcessArtifact): void {
    // Status-transitioned revisions keep their id: update in place.
    if (previous.envelope.id === next.envelope.id) {
      this.artifacts.set(next.envelope.id, next);
      return;
    }
    this.put(next);
    if (this.artifacts.has(previous.envelope.id)) {
      this.artifacts.set(previous.envelope.id, previous);
    }
  }

  get(id: string): MetaProcessArtifact | undefined {
    return this.artifacts.get(id);
  }

  has(id: string): boolean {
    return this.artifacts.has(id);
  }

  list(): MetaProcessArtifact[] {
    return [...this.artifacts.values()].sort((a, b) => (a.envelope.id < b.envelope.id ? -1 : 1));
  }

  /** The ACTIVE head of the chain containing `id` (or of the whole store when unique). */
  active(): MetaProcessArtifact[] {
    return this.list().filter((process) => process.envelope.status === 'ACTIVE');
  }

  history(id: string): MetaProcessArtifact[] {
    const chain: MetaProcessArtifact[] = [];
    let cursor: MetaProcessArtifact | undefined = this.artifacts.get(id);
    const seen = new Set<string>();
    while (cursor !== undefined) {
      if (seen.has(cursor.envelope.id)) {
        throw new MetaEvolutionError('INVALID_REVISION_OPERATION', `meta process chain cycle detected at ${cursor.envelope.id}`);
      }
      seen.add(cursor.envelope.id);
      chain.unshift(cursor);
      cursor = cursor.envelope.supersedes === null ? undefined : this.artifacts.get(cursor.envelope.supersedes);
    }
    for (let index = 1; index < chain.length; index += 1) {
      const previous = chain[index - 1];
      const current = chain[index];
      if (current === undefined || previous === undefined) {
        throw new MetaEvolutionError('INVALID_REVISION_OPERATION', 'unreachable: chain entries checked non-empty');
      }
      if (current.envelope.supersedes !== previous.envelope.id || current.envelope.version !== previous.envelope.version + 1) {
        throw new MetaEvolutionError('INVALID_REVISION_OPERATION', `meta process chain gap at ${current.envelope.id}`);
      }
    }
    return chain;
  }

  get size(): number {
    return this.artifacts.size;
  }
}
