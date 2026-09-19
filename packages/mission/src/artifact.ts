/**
 * Mission artifacts — versioned, authority-controlled mission instances.
 *
 * A MissionArtifact is a Semantic Spine envelope (kind "Mission") plus the
 * mission content. The envelope is ALWAYS obtained from the spine
 * (`createEnvelope`); identities are ALWAYS minted by the spine
 * (`deriveDeterministicArtifactId`). This package never invents identifiers
 * and never duplicates envelope logic (AGENTS.md §4, W0.5 export discipline).
 *
 * Identity discipline: the artifact id is content-addressed over the exact
 * creation address — every envelope field except `id`, plus the mission
 * content:
 *
 *     sos://Mission/<first 32 hex of sha-256 over the canonical
 *                   serialization of { kind, version, status, authority_ref,
 *                   provenance, created_at, supersedes, content }>
 *
 * Identical creation input therefore reproduces the identical id (determinism
 * is pinned by tests, mirroring the W0.5 golden-fixture discipline), and
 * identity is preserved across later lifecycle transitions (the spine's
 * `withStatus`/`EnvelopeStore.setStatus` preserve `id`).
 */

import {
  assertValidEnvelope,
  createEnvelope,
  deriveDeterministicArtifactId,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { MissionError } from './errors.js';
import { validateMissionContent } from './model.js';
import type { MissionContent } from './model.js';

export const MISSION_KIND = 'Mission';

export interface MissionArtifact {
  /** Semantic Spine envelope; kind is always "Mission". */
  envelope: ArtifactEnvelope;
  /** Mission content (exact field set, see model.ts). */
  content: MissionContent;
}

export interface CreateMissionInput {
  content: MissionContent;
  /** REQUIRED non-empty provenance entries (spine discipline). */
  provenance: string[];
  /** RFC3339 creation timestamp, caller-supplied (no hidden clocks). */
  created_at: string;
  /** Authorizing artifact id (typically the Constitution anchor), or null. */
  authority_ref?: string | null;
  /** Version (integer >= 1). Defaults to 1. */
  version?: number;
  /** DRAFT (default) or ACTIVE. */
  status?: ArtifactStatus;
  /** Mission artifact id superseded by this one, or null (roots). */
  supersedes?: string | null;
}

/**
 * The exact value a mission artifact id is derived from. Exported so tests
 * and diagnostics can reproduce ids bit-exactly (deterministic identity is
 * part of the W0.5 fixture discipline this package follows).
 */
export interface MissionCreationAddress {
  kind: 'Mission';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: MissionContent;
}

export function missionCreationAddress(input: CreateMissionInput): MissionCreationAddress {
  const version = input.version ?? 1;
  const status: ArtifactStatus = input.status ?? 'DRAFT';
  const authorityRef = input.authority_ref ?? null;
  const supersedes = input.supersedes ?? null;
  return {
    kind: MISSION_KIND,
    version,
    status,
    authority_ref: authorityRef,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes,
    content: input.content,
  };
}

/** Derive the deterministic mission artifact id for a creation input. */
export function missionArtifactId(input: CreateMissionInput): string {
  return deriveDeterministicArtifactId(MISSION_KIND, missionCreationAddress(input));
}

/**
 * Create a mission artifact. Mission ids are ALWAYS deterministic
 * (content-addressed); there is no random-minting path — mission revisions
 * are reproducible from exact revisions and evidence (spec/architecture.md
 * §18). Envelope validation is delegated to the spine.
 */
export function createMission(input: CreateMissionInput): MissionArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new MissionError('mission creation input must be an object');
  }
  validateMissionContent(input.content);

  const version = input.version ?? 1;
  const status: ArtifactStatus = input.status ?? 'DRAFT';
  const authorityRef = input.authority_ref ?? null;
  const supersedes = input.supersedes ?? null;

  const id = deriveDeterministicArtifactId(MISSION_KIND, {
    kind: MISSION_KIND,
    version,
    status,
    authority_ref: authorityRef,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes,
    content: input.content,
  });

  const envelope = createEnvelope({
    kind: MISSION_KIND,
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
 * Full semantic validation of a mission artifact (throws MissionError):
 * exact artifact shape, spine-valid envelope of kind Mission, and valid
 * mission content.
 *
 * NOTE (identity discipline): mission ids are minted at CREATION over the
 * creation address and then preserved across lifecycle transitions (the
 * spine preserves identity through `withStatus`/`setStatus`). Re-derivation
 * from a transitioned envelope is therefore intentionally NOT part of this
 * check — exactly as the spine's own `assertValidEnvelope` does not re-derive.
 * Creation-time determinism (same input → same id) is pinned by tests.
 */
export function assertValidMission(value: unknown): asserts value is MissionArtifact {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new MissionError('mission artifact must be an object with exact fields { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  const expected = new Set<string>(ARTIFACT_KEYS);
  if (actualKeys.length !== ARTIFACT_KEYS.length || !actualKeys.every((key) => expected.has(key))) {
    throw new MissionError('mission artifact must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new MissionError(`mission envelope is not spine-valid: ${(cause as Error).message}`);
  }
  const envelope = record['envelope'] as ArtifactEnvelope;
  if (envelope.kind !== MISSION_KIND) {
    throw new MissionError(`mission artifact envelope kind must be "${MISSION_KIND}", received: ${JSON.stringify(envelope.kind)}`);
  }
  validateMissionContent(record['content']);
}

/** Predicate form of assertValidMission. */
export function validateMission(value: unknown): value is MissionArtifact {
  try {
    assertValidMission(value);
    return true;
  } catch {
    return false;
  }
}
