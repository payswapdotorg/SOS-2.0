/**
 * The MetaChange artifact — a typed, versioned proposal to change the SOS
 * PROCESS itself (W16 stage 2 output). NEVER an object-system change: the
 * OBJECT/META separation (routing.ts) pins the kind lanes, and the change
 * content targets a MetaProcess revision and patches ONLY the evolvable
 * parameter surface (guard-checked in guard.ts).
 *
 * The change carries `proposed_against` — the EXACT parameter snapshot of
 * the revision the proposal was generated against (the guard's base and the
 * proposal's provenance). The ROLLBACK's exact-restore anchor is the TRIAL's
 * base revision (the head at trial time), captured in the revision chain —
 * see revision.ts.
 */

import {
  assertValidEnvelope,
  createEnvelope,
  deriveDeterministicArtifactId,
  isArtifactId,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { META_CHANGE_KIND, META_PROCESS_KIND } from './kinds.js';
import { MetaEvolutionError } from './errors.js';
import { assertValidMetaProcessParameters, cloneParameters, patchKeys } from './parameters.js';
import type { MetaProcessParameters, MetaProcessPatch } from './parameters.js';

export interface MetaChangeContent {
  /** The MetaProcess revision this change applies to (id + version). */
  target_process_id: string;
  target_process_version: number;
  /**
   * The typed parameter patch. Structurally open: foreign keys are legal
   * PROPOSAL content (they must survive to be guard-REJECTED with typed
   * records) but can never be applied (applyParametersPatch refuses them).
   */
  patch: MetaProcessPatch;
  /** Why the change is proposed (non-empty). */
  intent: string;
  /** The meta-strategy Package this proposal derives from (R24 reuse). */
  source_package_id: string;
  /** Predicted effects (>= 1 — the proposal is causal and testable). */
  predicted_effects: string[];
  /**
   * The EXACT parameter snapshot of the targeted revision (captured at
   * proposal time; the governance guard's evaluation base).
   */
  proposed_against: MetaProcessParameters;
}

export interface MetaChangeArtifact {
  envelope: ArtifactEnvelope;
  content: MetaChangeContent;
}

export interface CreateMetaChangeInput {
  content: MetaChangeContent;
  provenance: string[];
  created_at: string;
  authority_ref?: string | null;
  version?: number;
  status?: ArtifactStatus;
  supersedes?: string | null;
}

export interface MetaChangeCreationAddress {
  kind: 'MetaChange';
  version: number;
  status: ArtifactStatus;
  authority_ref: string | null;
  provenance: string[];
  created_at: string;
  supersedes: string | null;
  content: MetaChangeContent;
}

const ARTIFACT_KEYS = ['envelope', 'content'] as const;

export function metaChangeCreationAddress(input: CreateMetaChangeInput): MetaChangeCreationAddress {
  const version = input.version ?? 1;
  const status: ArtifactStatus = input.status ?? 'DRAFT';
  const authorityRef = input.authority_ref ?? null;
  const supersedes = input.supersedes ?? null;
  return {
    kind: META_CHANGE_KIND,
    version,
    status,
    authority_ref: authorityRef,
    provenance: [...input.provenance],
    created_at: input.created_at,
    supersedes,
    content: input.content,
  };
}

export function metaChangeArtifactId(input: CreateMetaChangeInput): string {
  return deriveDeterministicArtifactId(META_CHANGE_KIND, metaChangeCreationAddress(input));
}

/**
 * Normalize a patch to its JSON form: keys carrying `undefined` are absent
 * (JSON patches cannot carry undefined; a key with an undefined value is
 * treated as not assigned). Deterministic.
 */
export function normalizePatch(patch: MetaProcessPatch): MetaProcessPatch {
  const normalized: Record<string, unknown> = {};
  for (const [topKey, rawValue] of Object.entries(patch)) {
    if (rawValue === undefined) {
      continue;
    }
    if (rawValue !== null && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      const nested: Record<string, unknown> = {};
      for (const [subKey, subValue] of Object.entries(rawValue as Record<string, unknown>)) {
        if (subValue !== undefined) {
          nested[subKey] = subValue;
        }
      }
      normalized[topKey] = nested;
    } else {
      normalized[topKey] = rawValue;
    }
  }
  return normalized as MetaProcessPatch;
}

export function createMetaChange(input: CreateMetaChangeInput): MetaChangeArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new MetaEvolutionError('INVALID_CHANGE_CONTENT', 'meta change creation input must be an object');
  }
  const content = input.content;
  if (typeof content !== 'object' || content === null) {
    throw new MetaEvolutionError('INVALID_CHANGE_CONTENT', 'meta change content must be an object');
  }
  if (!isArtifactId(content.target_process_id) || content.target_process_id.startsWith(`sos://${META_PROCESS_KIND}/`) !== true) {
    throw new MetaEvolutionError(
      'INVALID_CHANGE_CONTENT',
      `content.target_process_id must be a well-formed sos://${META_PROCESS_KIND}/ id, received: ${JSON.stringify(content.target_process_id)}`,
    );
  }
  if (typeof content.target_process_version !== 'number' || !Number.isInteger(content.target_process_version) || content.target_process_version < 1) {
    throw new MetaEvolutionError('INVALID_CHANGE_CONTENT', 'content.target_process_version must be an integer >= 1');
  }
  if (typeof content.patch !== 'object' || content.patch === null || Array.isArray(content.patch)) {
    throw new MetaEvolutionError('INVALID_CHANGE_CONTENT', 'content.patch must be an object');
  }
  const normalizedPatch = normalizePatch(content.patch);
  if (patchKeys(normalizedPatch).length === 0) {
    throw new MetaEvolutionError('INVALID_CHANGE_CONTENT', 'content.patch must assign at least one key (an empty patch is not a change)');
  }
  if (typeof content.intent !== 'string' || content.intent.length === 0) {
    throw new MetaEvolutionError('INVALID_CHANGE_CONTENT', 'content.intent must be a non-empty string');
  }
  if (!isArtifactId(content.source_package_id) || !content.source_package_id.startsWith('sos://Package/')) {
    throw new MetaEvolutionError(
      'INVALID_CHANGE_CONTENT',
      `content.source_package_id must be a well-formed sos://Package/ id (R24: meta-proposals derive from the package registry), received: ${JSON.stringify(content.source_package_id)}`,
    );
  }
  if (!Array.isArray(content.predicted_effects) || content.predicted_effects.length === 0 || !content.predicted_effects.every((effect) => typeof effect === 'string' && effect.length > 0)) {
    throw new MetaEvolutionError('INVALID_CHANGE_CONTENT', 'content.predicted_effects must be a non-empty array of non-empty strings');
  }
  assertValidMetaProcessParameters(content.proposed_against);
  // The creation address (and therefore the content-addressed id) is derived
  // over the NORMALIZED patch — identical JSON content yields the identical
  // id, and undefined-valued keys are absent by definition.
  const address = metaChangeCreationAddress({ ...input, content: { ...content, patch: normalizedPatch } });
  const id = deriveDeterministicArtifactId(META_CHANGE_KIND, address);
  const envelope = createEnvelope({
    kind: META_CHANGE_KIND,
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
      target_process_id: content.target_process_id,
      target_process_version: content.target_process_version,
      patch: structuredClone(normalizedPatch),
      intent: content.intent,
      source_package_id: content.source_package_id,
      predicted_effects: [...content.predicted_effects],
      proposed_against: cloneParameters(content.proposed_against),
    },
  };
}

export function assertValidMetaChange(value: unknown): asserts value is MetaChangeArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MetaEvolutionError('INVALID_CHANGE_CONTENT', 'meta change artifact must be an object with exact fields { envelope, content }');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  if (actualKeys.length !== ARTIFACT_KEYS.length || !actualKeys.every((key) => (ARTIFACT_KEYS as readonly string[]).includes(key))) {
    throw new MetaEvolutionError('INVALID_CHANGE_CONTENT', 'meta change artifact must be an object with exact fields { envelope, content }');
  }
  try {
    assertValidEnvelope(record['envelope']);
  } catch (cause) {
    throw new MetaEvolutionError('INVALID_CHANGE_CONTENT', `meta change envelope is not spine-valid: ${(cause as Error).message}`);
  }
  if ((record['envelope'] as ArtifactEnvelope).kind !== META_CHANGE_KIND) {
    throw new MetaEvolutionError('INVALID_CHANGE_CONTENT', `meta change envelope kind must be ${META_CHANGE_KIND}`);
  }
  // Re-run the full content validation (throws on invalid content).
  createMetaChange({
    content: (record['content'] as MetaChangeContent | undefined) ?? (undefined as unknown as MetaChangeContent),
    provenance: (record['envelope'] as ArtifactEnvelope).provenance,
    created_at: (record['envelope'] as ArtifactEnvelope).created_at,
  });
}
