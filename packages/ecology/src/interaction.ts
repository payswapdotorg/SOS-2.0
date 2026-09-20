/**
 * Composition interaction evidence (Work Order W13; docs/package-ecology.md:
 * "Composition: A composition is first-class and needs its own evidence.
 * Member success does not imply composition success.").
 *
 * Interaction outcomes (SYNERGY / INTERFERENCE / NEUTRAL) describe how a
 * composition's members INTERACT as a composed whole — a property of the
 * COMPOSITION, distinct from any member's individual behavior. The
 * machine-checked disciplines:
 *
 *   - OWN EVIDENCE ONLY: an interaction record cites evidence records whose
 *     subject IS the composition (subject_ref === composition_id). Evidence
 *     about a MEMBER is REJECTED — member behavior never substitutes for
 *     composition-level interaction evidence (mirrors the W6 own-evidence
 *     discipline of @sos-2/composition, enforced here at the ecology layer).
 *   - TRUTH-STATE CONSISTENCY: a SYNERGY claim requires >= 1 cited record
 *     with availability SUCCESS; an INTERFERENCE claim requires >= 1 with
 *     availability FAILURE; a NEUTRAL claim requires >= 1 own-evidence
 *     record (any state). A synergy record backed only by failures (or an
 *     interference record backed only by successes) is REJECTED.
 *   - RETENTION: records accumulate; there is no removal API.
 *   - DETERMINISM: ids are content-addressed over the canonical content
 *     (evidence refs sorted unique — citation order never changes identity);
 *     every query output is canonically ordered; snapshots round-trip.
 */

import { fullContentHash, isArtifactId, parseArtifactId, RFC3339_PATTERN } from '@sos-2/semantic-spine';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { EcologyError } from './errors.js';

/** The typed composition interaction outcomes. */
export const INTERACTION_OUTCOMES = ['SYNERGY', 'INTERFERENCE', 'NEUTRAL'] as const;

export type InteractionOutcome = (typeof INTERACTION_OUTCOMES)[number];

const INTERACTION_OUTCOME_SET: ReadonlySet<string> = new Set(INTERACTION_OUTCOMES);

/** Structural check: one of the three interaction outcomes? */
export function isInteractionOutcome(value: unknown): value is InteractionOutcome {
  return typeof value === 'string' && INTERACTION_OUTCOME_SET.has(value);
}

/** One recorded composition interaction outcome (own-evidence backed). */
export interface InteractionRecord {
  /** Deterministic content-addressed id (64 lowercase hex; NOT a spine artifact id). */
  id: string;
  /** The composition this interaction is about (sos://PackageComposition/<32 hex>). */
  composition_id: string;
  /** SYNERGY, INTERFERENCE or NEUTRAL. */
  outcome: InteractionOutcome;
  /** The composition's OWN evidence backing the record (sorted unique evidence ids). */
  evidence_refs: string[];
  /** Who/what recorded this — non-empty entries. */
  provenance: string[];
  /** Optional statement, or null. */
  note: string | null;
  /** RFC3339 recording timestamp (caller-supplied; never a hidden clock). */
  recorded_at: string;
}

/** Input to an interaction record (id is derived; evidence records REQUIRED). */
export interface RecordInteractionInput {
  composition_id: string;
  outcome: InteractionOutcome;
  /**
   * The composition's OWN evidence (NON-EMPTY; every record's subject_ref
   * must equal composition_id — member evidence is REJECTED).
   */
  evidence: EvidenceRecordW3[];
  /** NON-EMPTY entries. */
  provenance: string[];
  note?: string | null;
  /** RFC3339 recording timestamp. */
  recorded_at: string;
}

/** The exact value an interaction id is derived from (exported for reproduction). */
export interface InteractionContent {
  composition_id: string;
  outcome: InteractionOutcome;
  evidence_refs: string[];
  provenance: string[];
  note: string | null;
  recorded_at: string;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a record-interaction input (throws EcologyError with a specific message). */
export function assertValidRecordInteractionInput(value: unknown): asserts value is RecordInteractionInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EcologyError(`interaction input must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const compositionId = record['composition_id'];
  if (!isArtifactId(compositionId)) {
    throw new EcologyError(
      `composition_id must be a well-formed spine artifact id, received: ${JSON.stringify(compositionId)}`,
    );
  }
  const parsed = parseArtifactId(compositionId);
  if (parsed.kind !== 'PackageComposition') {
    throw new EcologyError(
      `composition_id must be a PackageComposition id (sos://PackageComposition/...), received: ${JSON.stringify(compositionId)}`,
    );
  }
  if (!isInteractionOutcome(record['outcome'])) {
    throw new EcologyError(
      `interaction outcome must be one of ${INTERACTION_OUTCOMES.join(', ')}, received: ${JSON.stringify(record['outcome'])}`,
    );
  }
  const evidence = record['evidence'];
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new EcologyError(
      'interaction evidence must be a NON-EMPTY array of evidence records — an interaction record carries its own evidence',
    );
  }
  for (const entry of evidence) {
    if (typeof entry !== 'object' || entry === null) {
      throw new EcologyError(`interaction evidence entries must be evidence records, received: ${JSON.stringify(entry)}`);
    }
    const evidenceRecord = entry as Record<string, unknown>;
    const subject = evidenceRecord['subject_ref'];
    if (subject !== compositionId) {
      throw new EcologyError(
        `interaction evidence must be ABOUT the composition itself (subject_ref === composition_id) — member evidence ` +
          `never substitutes for composition evidence (docs/package-ecology.md); record subject ${JSON.stringify(subject)} ` +
          `is not the composition ${JSON.stringify(compositionId)}`,
      );
    }
  }
  // Truth-state consistency (see module doc).
  const outcome = record['outcome'] as InteractionOutcome;
  const availabilities = (evidence as Record<string, unknown>[]).map((entry) => entry['availability']);
  if (outcome === 'SYNERGY' && !availabilities.includes('SUCCESS')) {
    throw new EcologyError(
      'a SYNERGY interaction requires at least one cited evidence record with availability SUCCESS — ' +
        'a synergy claim backed only by non-success records is rejected',
    );
  }
  if (outcome === 'INTERFERENCE' && !availabilities.includes('FAILURE')) {
    throw new EcologyError(
      'an INTERFERENCE interaction requires at least one cited evidence record with availability FAILURE — ' +
        'an interference claim without an observed failure is rejected',
    );
  }
  if (!isNonEmptyStringArray(record['provenance'])) {
    throw new EcologyError('interaction provenance must be a non-empty array of non-empty strings');
  }
  if (record['note'] !== undefined && record['note'] !== null && typeof record['note'] !== 'string') {
    throw new EcologyError(`interaction note must be null or a string, received: ${JSON.stringify(record['note'])}`);
  }
  const recordedAt = record['recorded_at'];
  if (typeof recordedAt !== 'string' || !RFC3339_PATTERN.test(recordedAt)) {
    throw new EcologyError(
      `interaction recorded_at must be an RFC3339 timestamp, received: ${JSON.stringify(recordedAt)}`,
    );
  }
}

/** The exact derivation content of an interaction input. */
export function interactionContent(input: RecordInteractionInput): InteractionContent {
  assertValidRecordInteractionInput(input);
  return {
    composition_id: input.composition_id,
    outcome: input.outcome,
    evidence_refs: [...new Set(input.evidence.map((record) => record.id))].sort(compareStrings),
    provenance: [...input.provenance],
    note: input.note ?? null,
    recorded_at: input.recorded_at,
  };
}

/** Deterministic content-addressed interaction id. */
export function interactionId(input: RecordInteractionInput): string {
  return fullContentHash(interactionContent(input));
}

/** Create a validated interaction record (id derived; evidence refs sorted unique). */
export function createInteractionRecord(input: RecordInteractionInput): InteractionRecord {
  const content = interactionContent(input);
  return { id: fullContentHash(content), ...content };
}

/** Full semantic validation of a stored interaction record (throws EcologyError). */
export function assertValidInteractionRecord(value: unknown): asserts value is InteractionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EcologyError(`interaction record must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const hasNote = 'note' in record;
  if (Object.keys(record).length !== (hasNote ? 7 : 6) || !('id' in record)) {
    throw new EcologyError(
      'interaction record must have the exact field set { id, composition_id, outcome, evidence_refs, provenance, note, recorded_at }',
    );
  }
  if (typeof record['id'] !== 'string' || !/^[0-9a-f]{64}$/.test(record['id'])) {
    throw new EcologyError(`interaction record id must be 64 lowercase hex chars, received: ${JSON.stringify(record['id'])}`);
  }
  if (
    typeof record['composition_id'] !== 'string' ||
    !isArtifactId(record['composition_id']) ||
    parseArtifactId(record['composition_id']).kind !== 'PackageComposition'
  ) {
    throw new EcologyError(
      `interaction record composition_id must be a PackageComposition id, received: ${JSON.stringify(record['composition_id'])}`,
    );
  }
  if (!isInteractionOutcome(record['outcome'])) {
    throw new EcologyError(`interaction record outcome must be one of ${INTERACTION_OUTCOMES.join(', ')}, received: ${JSON.stringify(record['outcome'])}`);
  }
  const evidenceRefs = record['evidence_refs'];
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    throw new EcologyError('interaction record evidence_refs must be a NON-EMPTY array (own evidence is mandatory)');
  }
  for (const ref of evidenceRefs) {
    if (!isArtifactId(ref) || parseArtifactId(ref).kind !== 'Evidence') {
      throw new EcologyError(
        `interaction record evidence_refs entries must be Evidence ids, received: ${JSON.stringify(ref)}`,
      );
    }
  }
  if (!isNonEmptyStringArray(record['provenance'])) {
    throw new EcologyError('interaction record provenance must be a non-empty array of non-empty strings');
  }
  if (typeof record['recorded_at'] !== 'string' || !RFC3339_PATTERN.test(record['recorded_at'])) {
    throw new EcologyError(`interaction record recorded_at must be RFC3339, received: ${JSON.stringify(record['recorded_at'])}`);
  }
  const content: InteractionContent = {
    composition_id: record['composition_id'] as string,
    outcome: record['outcome'] as InteractionOutcome,
    evidence_refs: evidenceRefs as string[],
    provenance: record['provenance'] as string[],
    note: (hasNote ? record['note'] : null) as string | null,
    recorded_at: record['recorded_at'] as string,
  };
  if (fullContentHash(content) !== record['id']) {
    throw new EcologyError(
      `interaction record id does not match its content (content-address discipline): ${JSON.stringify(record['id'])}`,
    );
  }
}

/** A serializable interaction store snapshot (round-trips through restore). */
export interface InteractionStoreSnapshot {
  /** All records, canonically sorted by id. */
  records: InteractionRecord[];
}

/**
 * The composition interaction store. In-memory, deterministic, accumulative
 * (negative evidence and interference records are retained — there is no
 * removal API).
 */
export class InteractionStore {
  private readonly records = new Map<string, InteractionRecord>();

  /**
   * Record an interaction outcome. Validates OWN evidence (every cited
   * record is about the composition) and truth-state consistency; idempotent
   * by content.
   */
  record(input: RecordInteractionInput): InteractionRecord {
    const record = createInteractionRecord(input);
    const existing = this.records.get(record.id);
    if (existing !== undefined) {
      return structuredClone(existing);
    }
    const stored = structuredClone(record);
    this.records.set(stored.id, stored);
    return structuredClone(stored);
  }

  /** All interactions about one composition, sorted by (recorded_at, id). */
  interactionsFor(compositionId: string): InteractionRecord[] {
    return [...this.records.values()]
      .filter((record) => record.composition_id === compositionId)
      .sort((a, b) => compareStrings(`${a.recorded_at}\u0000${a.id}`, `${b.recorded_at}\u0000${b.id}`))
      .map((record) => structuredClone(record));
  }

  /** All interactions with a given outcome, sorted by (recorded_at, id). */
  interactionsWithOutcome(outcome: InteractionOutcome): InteractionRecord[] {
    if (!isInteractionOutcome(outcome)) {
      throw new EcologyError(`interaction outcome must be one of ${INTERACTION_OUTCOMES.join(', ')}, received: ${JSON.stringify(outcome)}`);
    }
    return [...this.records.values()]
      .filter((record) => record.outcome === outcome)
      .sort((a, b) => compareStrings(`${a.recorded_at}\u0000${a.id}`, `${b.recorded_at}\u0000${b.id}`))
      .map((record) => structuredClone(record));
  }

  /** All records, canonically sorted by id. */
  all(): InteractionRecord[] {
    return [...this.records.values()]
      .sort((a, b) => compareStrings(a.id, b.id))
      .map((record) => structuredClone(record));
  }

  get size(): number {
    return this.records.size;
  }

  /** A serializable snapshot (records canonically sorted by id). */
  snapshot(): InteractionStoreSnapshot {
    return { records: this.all() };
  }

  /** Rebuild a store from a snapshot (validated; canonical round trip). */
  static restore(snapshot: InteractionStoreSnapshot): InteractionStore {
    if (!isPlainObject(snapshot)) {
      throw new EcologyError(`interaction snapshot must be an object { records }, received: ${JSON.stringify(snapshot)}`);
    }
    const record = snapshot;
    if (Object.keys(record).length !== 1 || !('records' in record)) {
      throw new EcologyError('interaction snapshot must have the exact field set { records }');
    }
    if (!Array.isArray(record['records'])) {
      throw new EcologyError('interaction snapshot records must be an array');
    }
    const store = new InteractionStore();
    for (const value of record['records']) {
      assertValidInteractionRecord(value);
      const stored = structuredClone(value as InteractionRecord);
      const existing = store.records.get(stored.id);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(stored)) {
          throw new EcologyError(`interaction snapshot contains conflicting records with id ${stored.id}`);
        }
        continue;
      }
      store.records.set(stored.id, stored);
    }
    return store;
  }
}
