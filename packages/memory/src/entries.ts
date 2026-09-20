/**
 * Memory entries — the seven memory entry kinds of Architecture Memory
 * (Work Order W5; spec/architecture.md §5: "Architecture Memory:
 * predictions, observations, outcomes, failures, liabilities, rollback and
 * learned rules").
 *
 *   PREDICTION     a forward-looking statement (optionally about a spine
 *                  subject, optionally derived from a CausalHypothesis
 *                  artifact) — recorded BEFORE evidence exists; no evidence
 *                  refs required (that is the point of a prediction)
 *   OBSERVATION    what was seen — REQUIRES >= 1 evidence reference
 *   OUTCOME        what actually happened, with a REALIZED / NOT_REALIZED /
 *                  UNKNOWN verdict and optional prediction entry refs —
 *                  REQUIRES >= 1 evidence reference
 *   FAILURE        what failed, WHERE (a non-null context is REQUIRED —
 *                  contexts of failure are retained, never dropped) —
 *                  REQUIRES >= 1 evidence reference
 *   LIABILITY      a technical liability (severity, owner-kind, resolution;
 *                  see liability.ts)
 *   ROLLBACK       what was rolled back, from/to which revisions and why —
 *                  REQUIRES >= 1 evidence reference
 *   LEARNED_RULE   a durable learned rule — REQUIRES a non-empty
 *                  applicability context (a silent universal rule is
 *                  rejected) and >= 1 supporting evidence references (rules
 *                  without evidence are rejected), plus uncertainty
 *
 * All entry kinds share the { id, recorded_at } base: ids are unique across
 * ALL kinds within one ArchitectureMemory content (one namespace);
 * recorded_at is a caller-supplied RFC3339 timestamp (no hidden clocks).
 *
 * Entry ids may reference each other (outcome.prediction_refs,
 * ...)? — predictions, outcomes and other entries are cross-referenced by
 * entry id, validated to exist within the same content where the reference
 * is semantically internal (prediction_refs).
 */

import { RFC3339_PATTERN, isArtifactId, parseArtifactId } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import { assertValidConfidence } from '@sos-2/evidence';
import type { Confidence } from '@sos-2/evidence';
import { assertValidProducer } from '@sos-2/provenance';
import type { Producer } from '@sos-2/provenance';
import { MemoryError } from './errors.js';
import {
  assertValidEvidenceRefs,
  assertValidLiabilityResolution,
  isLiabilityOwnerKind,
  isLiabilitySeverity,
} from './liability.js';
import type {
  LiabilityOwnerKind,
  LiabilityResolution,
  LiabilitySeverity,
} from './liability.js';

/**
 * The frozen core kind name for causal hypothesis artifact ids. Local
 * constant of a frozen core kind segment (the established W1 pattern —
 * e.g. mission's AUTHORITY_GRANT_KIND): no second kind registry is created.
 */
export const CAUSAL_HYPOTHESIS_KIND = 'CausalHypothesis';

/** The seven memory entry kinds (spec/architecture.md §5). */
export const MEMORY_ENTRY_KINDS = [
  'PREDICTION',
  'OBSERVATION',
  'OUTCOME',
  'FAILURE',
  'LIABILITY',
  'ROLLBACK',
  'LEARNED_RULE',
] as const;

export type MemoryEntryKind = (typeof MEMORY_ENTRY_KINDS)[number];

/** The realized verdict of an outcome (against the predictions it references). */
export const OUTCOME_REALIZATIONS = ['REALIZED', 'NOT_REALIZED', 'UNKNOWN'] as const;

export type OutcomeRealization = (typeof OUTCOME_REALIZATIONS)[number];

/** Structural check: one of the seven memory entry kinds? */
export function isMemoryEntryKind(value: unknown): value is MemoryEntryKind {
  return typeof value === 'string' && (MEMORY_ENTRY_KINDS as readonly string[]).includes(value);
}

/** Structural check: one of the outcome realizations? */
export function isOutcomeRealization(value: unknown): value is OutcomeRealization {
  return typeof value === 'string' && (OUTCOME_REALIZATIONS as readonly string[]).includes(value);
}

/** A prediction: what we expect to happen (recorded before evidence exists). */
export interface PredictionEntry {
  entry_kind: 'PREDICTION';
  id: string;
  recorded_at: string;
  statement: string;
  /** Spine artifact id of the predicted-about subject, or null. */
  subject_ref: string | null;
  /** sos://CausalHypothesis/<32 hex> this prediction derives from, or null. */
  hypothesis_ref: string | null;
  context: Record<string, JsonValue> | null;
}

/** An observation: what was seen (evidence-backed). */
export interface ObservationEntry {
  entry_kind: 'OBSERVATION';
  id: string;
  recorded_at: string;
  statement: string;
  evidence_refs: string[];
  context: Record<string, JsonValue> | null;
}

/** An outcome: what actually happened (evidence-backed, with a verdict). */
export interface OutcomeEntry {
  entry_kind: 'OUTCOME';
  id: string;
  recorded_at: string;
  statement: string;
  /** Prediction entry ids (within the same memory) this outcome speaks to. */
  prediction_refs: string[];
  realized: OutcomeRealization;
  evidence_refs: string[];
  context: Record<string, JsonValue> | null;
}

/** A failure: what failed, where (the context is REQUIRED and retained verbatim). */
export interface FailureEntry {
  entry_kind: 'FAILURE';
  id: string;
  recorded_at: string;
  statement: string;
  evidence_refs: string[];
  /** The failure context — REQUIRED, non-null, at least one fact (retained, never dropped). */
  context: Record<string, JsonValue>;
}

/** A technical liability (severity, owner-kind, resolution). */
export interface LiabilityEntry {
  entry_kind: 'LIABILITY';
  id: string;
  recorded_at: string;
  statement: string;
  severity: LiabilitySeverity;
  owner_kind: LiabilityOwnerKind;
  resolution: LiabilityResolution;
  context: Record<string, JsonValue> | null;
}

/** A rollback event: what was rolled back, from/to which revisions, why. */
export interface RollbackEntry {
  entry_kind: 'ROLLBACK';
  id: string;
  recorded_at: string;
  statement: string;
  from_revision: string | null;
  to_revision: string | null;
  reason: string;
  evidence_refs: string[];
  context: Record<string, JsonValue> | null;
}

/** A learned rule: durable learning with applicability + supporting evidence. */
export interface LearnedRuleEntry {
  entry_kind: 'LEARNED_RULE';
  id: string;
  recorded_at: string;
  statement: string;
  /** The applicability context — REQUIRED, non-empty (a silent universal rule is rejected). */
  applicability: Record<string, JsonValue>;
  /** Supporting evidence references — REQUIRED, non-empty (rules without evidence are rejected). */
  evidence_refs: string[];
  /** Uncertainty: qualitative class unless a calibration artifact exists. */
  uncertainty: Confidence;
}

export type MemoryEntry =
  | PredictionEntry
  | ObservationEntry
  | OutcomeEntry
  | FailureEntry
  | LiabilityEntry
  | RollbackEntry
  | LearnedRuleEntry;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullOrNonEmptyString(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0);
}

function isPlainJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return true;
  }
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      return value.every((entry) => isPlainJsonValue(entry));
    }
    return Object.values(value).every((entry) => isPlainJsonValue(entry));
  }
  return false;
}

/** Validate a nullable plain-JSON context object. */
function assertValidNullableContext(
  context: unknown,
  field: string,
): asserts context is Record<string, JsonValue> | null {
  if (context === undefined || context === null) {
    return;
  }
  if (!isPlainJsonRecord(context)) {
    throw new MemoryError(`${field} must be null or a plain JSON object`);
  }
  for (const key of Object.keys(context)) {
    if (key.length === 0) {
      throw new MemoryError(`${field} keys must be non-empty strings`);
    }
    if (!isPlainJsonValue(context[key])) {
      throw new MemoryError(`${field}.${key} is not a JSON value`);
    }
  }
}

/** Validate a REQUIRED non-null, non-empty plain-JSON context object. */
function assertValidRequiredContext(
  context: unknown,
  field: string,
): asserts context is Record<string, JsonValue> {
  if (!isPlainJsonRecord(context) || Object.keys(context).length < 1) {
    throw new MemoryError(
      `${field} must be a plain JSON object with at least one fact — ` +
        (field.endsWith('context')
          ? 'this context is retained, never dropped (a contextless record carries no retention value)'
          : 'an empty applicability carries no scoping information (a silent universal rule is rejected)'),
    );
  }
  for (const key of Object.keys(context)) {
    if (key.length === 0) {
      throw new MemoryError(`${field} keys must be non-empty strings`);
    }
    if (!isPlainJsonValue(context[key])) {
      throw new MemoryError(`${field}.${key} is not a JSON value`);
    }
  }
}

/** Validate the shared { id, recorded_at } base. */
function assertValidEntryBase(value: Record<string, unknown>): void {
  if (!isNonEmptyString(value['id'])) {
    throw new MemoryError(`memory entry ids must be non-empty strings, received: ${JSON.stringify(value['id'])}`);
  }
  if (typeof value['recorded_at'] !== 'string' || !RFC3339_PATTERN.test(value['recorded_at'])) {
    throw new MemoryError(
      `memory entry recorded_at must be an RFC3339 timestamp, received: ${JSON.stringify(value['recorded_at'])}`,
    );
  }
}

/** Validate a well-formed sos://CausalHypothesis/<32 hex> reference. */
function assertValidHypothesisRef(value: unknown): asserts value is string {
  if (!isArtifactId(value)) {
    throw new MemoryError(
      `hypothesis_ref must be a well-formed spine artifact id (sos://CausalHypothesis/<32 hex>), received: ${JSON.stringify(value)}`,
    );
  }
  const parsed = parseArtifactId(value);
  if (parsed.kind !== CAUSAL_HYPOTHESIS_KIND) {
    throw new MemoryError(
      `hypothesis_ref must reference a CausalHypothesis artifact, received: ${JSON.stringify(value)} (kind ${parsed.kind})`,
    );
  }
}

/** Full validation of one memory entry (throws MemoryError). */
export function assertValidMemoryEntry(value: unknown): asserts value is MemoryEntry {
  if (!isPlainJsonRecord(value)) {
    throw new MemoryError('memory entry must be an object');
  }
  const entry = value as Record<string, unknown>;
  assertValidEntryBase(entry);
  const kind = entry['entry_kind'];
  switch (kind) {
    case 'PREDICTION': {
      if (!isNonEmptyString(entry['statement'])) {
        throw new MemoryError(`prediction statement must be a non-empty string, received: ${JSON.stringify(entry['statement'])}`);
      }
      if (entry['subject_ref'] !== null && entry['subject_ref'] !== undefined) {
        if (!isArtifactId(entry['subject_ref'])) {
          throw new MemoryError(
            `prediction subject_ref must be null or a well-formed spine artifact id, received: ${JSON.stringify(entry['subject_ref'])}`,
          );
        }
      }
      if (entry['hypothesis_ref'] !== null && entry['hypothesis_ref'] !== undefined) {
        assertValidHypothesisRef(entry['hypothesis_ref']);
      }
      assertValidNullableContext(entry['context'], 'prediction context');
      return;
    }
    case 'OBSERVATION': {
      if (!isNonEmptyString(entry['statement'])) {
        throw new MemoryError(`observation statement must be a non-empty string, received: ${JSON.stringify(entry['statement'])}`);
      }
      assertValidEvidenceRefs(entry['evidence_refs'], 'observation evidence_refs');
      if ((entry['evidence_refs'] as string[]).length < 1) {
        throw new MemoryError(
          'an observation requires at least one evidence reference — evidence outranks assertion about system reality (spec/architecture.md §18)',
        );
      }
      assertValidNullableContext(entry['context'], 'observation context');
      return;
    }
    case 'OUTCOME': {
      if (!isNonEmptyString(entry['statement'])) {
        throw new MemoryError(`outcome statement must be a non-empty string, received: ${JSON.stringify(entry['statement'])}`);
      }
      if (!Array.isArray(entry['prediction_refs'])) {
        throw new MemoryError('outcome prediction_refs must be an array of prediction entry ids');
      }
      for (const ref of entry['prediction_refs']) {
        if (!isNonEmptyString(ref)) {
          throw new MemoryError(`outcome prediction_refs entries must be non-empty strings, received: ${JSON.stringify(ref)}`);
        }
      }
      if (!isOutcomeRealization(entry['realized'])) {
        throw new MemoryError(
          `outcome realized must be one of ${OUTCOME_REALIZATIONS.join(', ')}, received: ${JSON.stringify(entry['realized'])}`,
        );
      }
      assertValidEvidenceRefs(entry['evidence_refs'], 'outcome evidence_refs');
      if ((entry['evidence_refs'] as string[]).length < 1) {
        throw new MemoryError(
          'an outcome requires at least one evidence reference — evidence outranks assertion about system reality (spec/architecture.md §18)',
        );
      }
      assertValidNullableContext(entry['context'], 'outcome context');
      return;
    }
    case 'FAILURE': {
      if (!isNonEmptyString(entry['statement'])) {
        throw new MemoryError(`failure statement must be a non-empty string, received: ${JSON.stringify(entry['statement'])}`);
      }
      assertValidEvidenceRefs(entry['evidence_refs'], 'failure evidence_refs');
      if ((entry['evidence_refs'] as string[]).length < 1) {
        throw new MemoryError(
          'a failure requires at least one evidence reference — evidence outranks assertion about system reality (spec/architecture.md §18)',
        );
      }
      assertValidRequiredContext(entry['context'], 'failure context');
      return;
    }
    case 'LIABILITY': {
      if (!isNonEmptyString(entry['statement'])) {
        throw new MemoryError(`liability statement must be a non-empty string, received: ${JSON.stringify(entry['statement'])}`);
      }
      if (!isLiabilitySeverity(entry['severity'])) {
        throw new MemoryError(
          `liability severity must be one of ${['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].join(', ')}, received: ${JSON.stringify(entry['severity'])}`,
        );
      }
      if (!isLiabilityOwnerKind(entry['owner_kind'])) {
        throw new MemoryError(
          `liability owner_kind must be one of ${['HUMAN', 'TEAM', 'SERVICE', 'GOVERNANCE'].join(', ')}, received: ${JSON.stringify(entry['owner_kind'])}`,
        );
      }
      assertValidLiabilityResolution(entry['resolution']);
      assertValidNullableContext(entry['context'], 'liability context');
      return;
    }
    case 'ROLLBACK': {
      if (!isNonEmptyString(entry['statement'])) {
        throw new MemoryError(`rollback statement must be a non-empty string, received: ${JSON.stringify(entry['statement'])}`);
      }
      if (!isNullOrNonEmptyString(entry['from_revision'])) {
        throw new MemoryError(
          `rollback from_revision must be null or a non-empty string, received: ${JSON.stringify(entry['from_revision'])}`,
        );
      }
      if (!isNullOrNonEmptyString(entry['to_revision'])) {
        throw new MemoryError(
          `rollback to_revision must be null or a non-empty string, received: ${JSON.stringify(entry['to_revision'])}`,
        );
      }
      if (!isNonEmptyString(entry['reason'])) {
        throw new MemoryError(`rollback reason must be a non-empty string, received: ${JSON.stringify(entry['reason'])}`);
      }
      assertValidEvidenceRefs(entry['evidence_refs'], 'rollback evidence_refs');
      if ((entry['evidence_refs'] as string[]).length < 1) {
        throw new MemoryError(
          'a rollback event requires at least one evidence reference — evidence outranks assertion about system reality (spec/architecture.md §18)',
        );
      }
      assertValidNullableContext(entry['context'], 'rollback context');
      return;
    }
    case 'LEARNED_RULE': {
      if (!isNonEmptyString(entry['statement'])) {
        throw new MemoryError(`learned rule statement must be a non-empty string, received: ${JSON.stringify(entry['statement'])}`);
      }
      assertValidRequiredContext(entry['applicability'], 'learned rule applicability');
      assertValidEvidenceRefs(entry['evidence_refs'], 'learned rule evidence_refs');
      if ((entry['evidence_refs'] as string[]).length < 1) {
        throw new MemoryError(
          'a learned rule requires at least one supporting evidence reference — rules without evidence are rejected (Work Order W5)',
        );
      }
      try {
        assertValidConfidence(entry['uncertainty']);
      } catch (cause) {
        throw new MemoryError(`learned rule uncertainty is invalid: ${(cause as Error).message}`);
      }
      return;
    }
    default:
      throw new MemoryError(
        `memory entry kind must be one of ${MEMORY_ENTRY_KINDS.join(', ')}, received: ${JSON.stringify(kind)}`,
      );
  }
}

/** Predicate form of assertValidMemoryEntry. */
export function validateMemoryEntry(value: unknown): value is MemoryEntry {
  try {
    assertValidMemoryEntry(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a full entries array: every entry valid, ids unique across ALL
 * kinds (one namespace), and prediction_refs of outcomes must reference
 * PREDICTION entries within the same content.
 */
export function assertValidMemoryEntries(values: unknown): asserts values is MemoryEntry[] {
  if (!Array.isArray(values)) {
    throw new MemoryError('memory entries must be an array');
  }
  const ids = new Set<string>();
  for (const entry of values) {
    assertValidMemoryEntry(entry);
    if (ids.has(entry.id)) {
      throw new MemoryError(`duplicate memory entry id rejected: ${JSON.stringify(entry.id)}`);
    }
    ids.add(entry.id);
  }
  for (const entry of values) {
    assertValidMemoryEntry(entry);
    if (entry.entry_kind === 'OUTCOME') {
      const outcome: OutcomeEntry = entry;
      for (const ref of outcome.prediction_refs) {
        const target = values.find((candidate) => {
          assertValidMemoryEntry(candidate);
          return candidate.id === ref;
        }) as MemoryEntry | undefined;
        if (target === undefined) {
          throw new MemoryError(
            `outcome ${JSON.stringify(outcome.id)} references unknown prediction entry id: ${JSON.stringify(ref)}`,
          );
        }
        if (target.entry_kind !== 'PREDICTION') {
          throw new MemoryError(
            `outcome ${JSON.stringify(outcome.id)} prediction_refs must reference PREDICTION entries, but ${JSON.stringify(ref)} is a ${target.entry_kind}`,
          );
        }
      }
    }
  }
}

/** Predicate form of assertValidMemoryEntries. */
export function validateMemoryEntries(value: unknown): value is MemoryEntry[] {
  try {
    assertValidMemoryEntries(value);
    return true;
  } catch {
    return false;
  }
}
