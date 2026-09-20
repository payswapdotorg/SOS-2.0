/**
 * Sanctioned case revisions — the objection lifecycle (Work Order W8:
 * "objections are first-class: recorded, never dropped").
 *
 * Three helpers, each producing the NEXT revision (version + 1, supersedes
 * the current head, same artifact kind and authority, caller-supplied
 * provenance):
 *
 *   addObjection(case, { objection, ... })          append a new OPEN
 *                                                   objection (duplicate ids
 *                                                   rejected)
 *   resolveObjection(case, { objection_id, ... })   OPEN -> RESOLVED with a
 *                                                   mandatory note, instant
 *                                                   and provenance (unknown
 *                                                   and already-RESOLVED
 *                                                   objections rejected —
 *                                                   resolutions are terminal)
 *   adoptConformanceEvidence(case, { ... })         see conformance.ts
 *
 * Every helper runs assertValidCaseRevision against the produced successor,
 * so objection retention and no-regression are enforced mechanically.
 */

import { createEnvelope, deriveDeterministicArtifactId, RFC3339_PATTERN } from '@sos-2/semantic-spine';
import type { ArtifactEnvelope } from '@sos-2/semantic-spine';
import { ObjectionError } from './errors.js';
import {
  assertValidAssuranceCase,
  assertValidCaseRevision,
  assertValidObjection,
} from './case.js';
import type { AssuranceCaseArtifact, Objection } from './case.js';

export interface ObjectionRevisionInput {
  /** The new objection (validated; must be OPEN with no resolution). */
  objection: Objection;
  /** Provenance of the revision (non-empty entries). */
  provenance: string[];
  /** RFC3339 revision creation timestamp. */
  created_at: string;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

/** Shared revision envelope builder (version + 1, supersedes the head). */
export function buildCaseRevision(
  head: AssuranceCaseArtifact,
  content: AssuranceCaseArtifact['content'],
  provenance: string[],
  created_at: string,
): { envelope: ArtifactEnvelope; content: AssuranceCaseArtifact['content'] } {
  if (!isNonEmptyStringArray(provenance)) {
    throw new ObjectionError('revision provenance must be a non-empty array of non-empty strings');
  }
  if (typeof created_at !== 'string' || !RFC3339_PATTERN.test(created_at)) {
    throw new ObjectionError(`revision created_at must be an RFC3339 timestamp, received: ${JSON.stringify(created_at)}`);
  }
  const version = head.envelope.version + 1;
  const address = {
    kind: 'AssuranceCase' as const,
    version,
    status: head.envelope.status,
    authority_ref: head.envelope.authority_ref,
    provenance: [...provenance],
    created_at,
    supersedes: head.envelope.id,
    content,
  };
  const id = deriveDeterministicArtifactId('AssuranceCase', address);
  const envelope = createEnvelope({
    kind: 'AssuranceCase',
    version,
    status: head.envelope.status,
    authority_ref: head.envelope.authority_ref,
    provenance: [...provenance],
    created_at,
    supersedes: head.envelope.id,
    id,
  });
  return { envelope, content: structuredClone(content) };
}

/**
 * Add a first-class objection to the case. The objection must be OPEN with
 * no resolution (objections are born open; they are resolved explicitly,
 * never pre-resolved at creation).
 */
export function addObjection(
  head: AssuranceCaseArtifact,
  input: ObjectionRevisionInput,
): AssuranceCaseArtifact {
  assertValidAssuranceCase(head);
  if (typeof input !== 'object' || input === null) {
    throw new ObjectionError('objection revision input must be an object');
  }
  assertValidObjection(input.objection);
  if (input.objection.status !== 'OPEN' || input.objection.resolution !== null) {
    throw new ObjectionError(
      `a new objection must be born OPEN without a resolution, received status ${JSON.stringify(input.objection.status)}`,
    );
  }
  if (head.content.objections.some((objection) => objection.id === input.objection.id)) {
    throw new ObjectionError(
      `objection ${JSON.stringify(input.objection.id)} already exists in case ${head.envelope.id} (objection ids are unique per case)`,
    );
  }
  const content = {
    ...structuredClone(head.content),
    objections: [...structuredClone(head.content.objections), structuredClone(input.objection)],
  };
  const revision = buildCaseRevision(head, content, input.provenance, input.created_at);
  const next: AssuranceCaseArtifact = { envelope: revision.envelope, content: revision.content };
  assertValidCaseRevision(head, next);
  return next;
}

export interface ResolveObjectionInput {
  /** The objection being resolved (must exist and be OPEN). */
  objection_id: string;
  /** The resolution note (non-empty). */
  note: string;
  /** RFC3339 resolution instant (>= raised_at — validated at content level). */
  resolved_at: string;
  /** Provenance of the resolution (non-empty entries — no anonymous resolutions). */
  provenance: string[];
  /** RFC3339 revision creation timestamp. */
  created_at: string;
}

/**
 * Resolve an OPEN objection (OPEN -> RESOLVED is terminal for the
 * objection). Unknown objection ids and already-RESOLVED objections are
 * rejected loudly; the resolution note, instant and provenance are
 * mandatory.
 */
export function resolveObjection(
  head: AssuranceCaseArtifact,
  input: ResolveObjectionInput,
): AssuranceCaseArtifact {
  assertValidAssuranceCase(head);
  if (typeof input !== 'object' || input === null) {
    throw new ObjectionError('resolve objection input must be an object');
  }
  if (typeof input.objection_id !== 'string' || input.objection_id.length === 0) {
    throw new ObjectionError(`objection_id must be a non-empty string, received: ${JSON.stringify(input.objection_id)}`);
  }
  if (typeof input.note !== 'string' || input.note.length === 0) {
    throw new ObjectionError(`resolution note must be a non-empty string, received: ${JSON.stringify(input.note)}`);
  }
  if (typeof input.resolved_at !== 'string' || !RFC3339_PATTERN.test(input.resolved_at)) {
    throw new ObjectionError(`resolved_at must be an RFC3339 timestamp, received: ${JSON.stringify(input.resolved_at)}`);
  }
  if (!isNonEmptyStringArray(input.provenance)) {
    throw new ObjectionError('resolution provenance must be a non-empty array of non-empty strings (no anonymous resolutions)');
  }

  const target = head.content.objections.find((objection) => objection.id === input.objection_id);
  if (target === undefined) {
    throw new ObjectionError(
      `objection ${JSON.stringify(input.objection_id)} does not exist in case ${head.envelope.id} (existing: ${head.content.objections.map((objection) => objection.id).sort().join(', ') || 'none'})`,
    );
  }
  if (target.status === 'RESOLVED') {
    throw new ObjectionError(
      `objection ${JSON.stringify(input.objection_id)} is already RESOLVED — resolutions are terminal and are never re-resolved or re-opened`,
    );
  }

  const objections = head.content.objections.map((objection) =>
    objection.id === input.objection_id
      ? {
          ...structuredClone(objection),
          status: 'RESOLVED' as const,
          resolution: {
            note: input.note,
            resolved_at: input.resolved_at,
            provenance: [...input.provenance],
          },
        }
      : structuredClone(objection),
  );
  const content = { ...structuredClone(head.content), objections };
  const revision = buildCaseRevision(head, content, input.provenance, input.created_at);
  const next: AssuranceCaseArtifact = { envelope: revision.envelope, content: revision.content };
  assertValidCaseRevision(head, next);
  return next;
}
