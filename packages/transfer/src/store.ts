/**
 * The transfer store — transfer evidence retention (Work Order W13;
 * docs/package-ecology.md "Failure memory: Retain contexts of failure,
 * invalidated assumptions, rollback incidents and technical liabilities").
 *
 * NEGATIVE EVIDENCE RETAINED (machine-checked structurally):
 *   - failed transfers (TRANSFER_FAILURE) are recorded exactly like
 *     successes and are returned by every query surface that covers them;
 *   - INVALIDATED ASSUMPTIONS are first-class records: an assumption a
 *     transfer attempt falsified, the CONTEXT OF FAILURE where it broke,
 *     and the evidence that invalidated it;
 *   - there is NO removal API anywhere on the store — records accumulate
 *     (retention is structural, pinned by tests that inspect the store's
 *     own surface).
 *
 * DETERMINISM: every query output is canonically ordered; snapshots are a
 * pure function of the record SET and round-trip through restore().
 */

import { fullContentHash, isArtifactId, parseArtifactId, RFC3339_PATTERN } from '@sos-2/semantic-spine';
import { assertValidContextCondition, matchesCondition } from '@sos-2/packages';
import type { ContextCondition } from '@sos-2/packages';
import { TransferError } from './errors.js';
import { assertValidTransferRecord, createTransferRecord } from './record.js';
import type { RecordTransferInput, TransferEvidenceRecord } from './record.js';

/** A first-class invalidated-assumption record (negative evidence, never dropped). */
export interface InvalidatedAssumptionRecord {
  /** Deterministic content-addressed id (64 lowercase hex; NOT a spine artifact id). */
  id: string;
  /** The package/composition whose assumption was invalidated. */
  package_ref: string;
  /** The invalidated assumption statement (non-empty). */
  assumption: string;
  /** The CONTEXT OF FAILURE where the assumption broke (non-empty; retained verbatim). */
  context: ContextCondition;
  /** Evidence invalidating the assumption — NON-EMPTY, well-formed sos://Evidence ids (sorted unique). */
  evidence_refs: string[];
  /** Who/what recorded this — non-empty entries. */
  provenance: string[];
  /** RFC3339 recording timestamp (caller-supplied; never a hidden clock). */
  recorded_at: string;
  /** Optional statement, or null. */
  note: string | null;
}

/** Input to an invalidated-assumption record (id is derived). */
export interface RecordInvalidatedAssumptionInput {
  package_ref: string;
  assumption: string;
  context: ContextCondition;
  /** NON-EMPTY; each entry a well-formed sos://Evidence id. */
  evidence_refs: string[];
  /** NON-EMPTY entries. */
  provenance: string[];
  recorded_at: string;
  note?: string | null;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Validate an invalidated-assumption input (throws TransferError). */
export function assertValidInvalidatedAssumptionInput(
  value: unknown,
): asserts value is RecordInvalidatedAssumptionInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TransferError(`invalidated-assumption input must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const packageRef = record['package_ref'];
  if (!isArtifactId(packageRef)) {
    throw new TransferError(
      `invalidated-assumption package_ref must be a well-formed spine artifact id, received: ${JSON.stringify(packageRef)}`,
    );
  }
  const parsed = parseArtifactId(packageRef);
  if (parsed.kind !== 'Package' && parsed.kind !== 'PackageComposition') {
    throw new TransferError(
      `invalidated-assumption package_ref must be a Package or PackageComposition id, received: ${JSON.stringify(packageRef)}`,
    );
  }
  if (typeof record['assumption'] !== 'string' || (record['assumption'] as string).length === 0) {
    throw new TransferError(
      `invalidated-assumption statement must be a non-empty string, received: ${JSON.stringify(record['assumption'])}`,
    );
  }
  try {
    assertValidContextCondition(record['context'], 'invalidated-assumption context');
  } catch (cause) {
    throw new TransferError(`invalidated-assumption context is invalid: ${(cause as Error).message}`);
  }
  const evidenceRefs = record['evidence_refs'];
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    throw new TransferError(
      'invalidated-assumption evidence_refs must be a NON-EMPTY array — an assumption is invalidated BY evidence, never by assertion',
    );
  }
  for (const ref of evidenceRefs) {
    if (!isArtifactId(ref) || parseArtifactId(ref).kind !== 'Evidence') {
      throw new TransferError(
        `invalidated-assumption evidence_refs entries must be Evidence ids (sos://Evidence/...), received: ${JSON.stringify(ref)}`,
      );
    }
  }
  if (!isNonEmptyStringArray(record['provenance'])) {
    throw new TransferError('invalidated-assumption provenance must be a non-empty array of non-empty strings');
  }
  if (typeof record['recorded_at'] !== 'string' || !RFC3339_PATTERN.test(record['recorded_at'])) {
    throw new TransferError(
      `invalidated-assumption recorded_at must be an RFC3339 timestamp, received: ${JSON.stringify(record['recorded_at'])}`,
    );
  }
  if (record['note'] !== undefined && record['note'] !== null && typeof record['note'] !== 'string') {
    throw new TransferError(`invalidated-assumption note must be null or a string, received: ${JSON.stringify(record['note'])}`);
  }
}

/** Create a validated invalidated-assumption record (id derived). */
export function createInvalidatedAssumptionRecord(
  input: RecordInvalidatedAssumptionInput,
): InvalidatedAssumptionRecord {
  assertValidInvalidatedAssumptionInput(input);
  const content = {
    package_ref: input.package_ref,
    assumption: input.assumption,
    context: { ...input.context },
    evidence_refs: [...new Set(input.evidence_refs)].sort(compareStrings),
    provenance: [...input.provenance],
    recorded_at: input.recorded_at,
    note: input.note ?? null,
  };
  return { id: fullContentHash(content), ...content };
}

/** Full semantic validation of a stored invalidated-assumption record (throws TransferError). */
export function assertValidInvalidatedAssumptionRecord(value: unknown): asserts value is InvalidatedAssumptionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TransferError(`invalidated-assumption record must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const hasNote = 'note' in record;
  if (Object.keys(record).length !== (hasNote ? 8 : 7) || !('id' in record)) {
    throw new TransferError(
      'invalidated-assumption record must have the exact field set { id, package_ref, assumption, context, evidence_refs, provenance, recorded_at, note }',
    );
  }
  if (typeof record['id'] !== 'string' || !/^[0-9a-f]{64}$/.test(record['id'])) {
    throw new TransferError(
      `invalidated-assumption record id must be 64 lowercase hex chars, received: ${JSON.stringify(record['id'])}`,
    );
  }
  assertValidInvalidatedAssumptionInput({
    package_ref: record['package_ref'],
    assumption: record['assumption'],
    context: record['context'],
    evidence_refs: record['evidence_refs'],
    provenance: record['provenance'],
    recorded_at: record['recorded_at'],
    note: hasNote ? (record['note'] as string | null) : null,
  });
  const content = {
    package_ref: record['package_ref'] as string,
    assumption: record['assumption'] as string,
    context: record['context'] as ContextCondition,
    evidence_refs: record['evidence_refs'] as string[],
    provenance: record['provenance'] as string[],
    recorded_at: record['recorded_at'] as string,
    note: (hasNote ? record['note'] : null) as string | null,
  };
  if (fullContentHash(content) !== record['id']) {
    throw new TransferError(
      `invalidated-assumption record id does not match its content (content-address discipline): ${JSON.stringify(record['id'])}`,
    );
  }
}

/** A serializable transfer store snapshot (round-trips through restore). */
export interface TransferStoreSnapshot {
  /** All transfer records, canonically sorted by id. */
  transfers: TransferEvidenceRecord[];
  /** All invalidated-assumption records, canonically sorted by id. */
  invalidated_assumptions: InvalidatedAssumptionRecord[];
}

/**
 * The transfer store. In-memory, deterministic, accumulative — negative
 * evidence (failed transfers, invalidated assumptions, contexts of failure)
 * is retained first-class and never dropped: there is NO removal API.
 */
export class TransferStore {
  private readonly transfers = new Map<string, TransferEvidenceRecord>();
  private readonly invalidated = new Map<string, InvalidatedAssumptionRecord>();

  /**
   * Record a transfer outcome (validated: context-conditioned, own
   * evidence, target-context estimate discipline, causal claim gate).
   * Failures are recorded exactly like successes — retention.
   */
  recordTransfer(input: RecordTransferInput): TransferEvidenceRecord {
    const record = createTransferRecord(input);
    const existing = this.transfers.get(record.id);
    if (existing !== undefined) {
      return structuredClone(existing);
    }
    const stored = structuredClone(record);
    this.transfers.set(stored.id, stored);
    return structuredClone(stored);
  }

  /** Record an invalidated assumption (first-class negative evidence). */
  recordInvalidatedAssumption(input: RecordInvalidatedAssumptionInput): InvalidatedAssumptionRecord {
    const record = createInvalidatedAssumptionRecord(input);
    const existing = this.invalidated.get(record.id);
    if (existing !== undefined) {
      return structuredClone(existing);
    }
    const stored = structuredClone(record);
    this.invalidated.set(stored.id, stored);
    return structuredClone(stored);
  }

  /**
   * All transfer records about one source — ALL outcomes, failures
   * included (sorted by (recorded_at, id)).
   */
  transfersFor(sourceRef: string): TransferEvidenceRecord[] {
    return [...this.transfers.values()]
      .filter((record) => record.source_ref === sourceRef)
      .sort((a, b) => compareStrings(`${a.recorded_at}\u0000${a.id}`, `${b.recorded_at}\u0000${b.id}`))
      .map((record) => structuredClone(record));
  }

  /** Failed transfers of one source (contexts of failure included; sorted). */
  failedTransfersFor(sourceRef: string): TransferEvidenceRecord[] {
    return this.transfersFor(sourceRef).filter((record) => record.outcome === 'TRANSFER_FAILURE');
  }

  /**
   * Transfer records whose TARGET context is at least as specific as the
   * query context (the query is a sub-map of the record's target_context —
   * a transfer into {region: apac, tier: prod} is a transfer into region
   * apac), sorted by (recorded_at, id). Failures included.
   */
  transfersInto(context: ContextCondition): TransferEvidenceRecord[] {
    try {
      assertValidContextCondition(context, 'transfersInto query context');
    } catch (cause) {
      throw new TransferError(`transfersInto query context is invalid: ${(cause as Error).message}`);
    }
    return [...this.transfers.values()]
      .filter((record) => matchesCondition(context, record.target_context))
      .sort((a, b) => compareStrings(`${a.recorded_at}\u0000${a.id}`, `${b.recorded_at}\u0000${b.id}`))
      .map((record) => structuredClone(record));
  }

  /**
   * FAILED transfers whose target context is at least as specific as the
   * query context — the contexts-of-failure view (sorted).
   */
  failuresInContext(context: ContextCondition): TransferEvidenceRecord[] {
    return this.transfersInto(context).filter((record) => record.outcome === 'TRANSFER_FAILURE');
  }

  /** Invalidated assumptions of one package/composition (sorted by (recorded_at, id)). */
  invalidatedAssumptionsFor(packageRef: string): InvalidatedAssumptionRecord[] {
    return [...this.invalidated.values()]
      .filter((record) => record.package_ref === packageRef)
      .sort((a, b) => compareStrings(`${a.recorded_at}\u0000${a.id}`, `${b.recorded_at}\u0000${b.id}`))
      .map((record) => structuredClone(record));
  }

  /** All transfer records (canonically sorted by id; failures included). */
  allTransfers(): TransferEvidenceRecord[] {
    return [...this.transfers.values()]
      .sort((a, b) => compareStrings(a.id, b.id))
      .map((record) => structuredClone(record));
  }

  /** All invalidated-assumption records (canonically sorted by id). */
  allInvalidatedAssumptions(): InvalidatedAssumptionRecord[] {
    return [...this.invalidated.values()]
      .sort((a, b) => compareStrings(a.id, b.id))
      .map((record) => structuredClone(record));
  }

  get size(): number {
    return this.transfers.size + this.invalidated.size;
  }

  /** A serializable snapshot (both record sets canonically sorted). */
  snapshot(): TransferStoreSnapshot {
    return {
      transfers: this.allTransfers(),
      invalidated_assumptions: this.allInvalidatedAssumptions(),
    };
  }

  /** Rebuild a store from a snapshot (validated; canonical round trip). */
  static restore(snapshot: TransferStoreSnapshot): TransferStore {
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
      throw new TransferError(`transfer snapshot must be an object, received: ${JSON.stringify(snapshot)}`);
    }
    const record = snapshot as unknown as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 ||
      !('transfers' in record) ||
      !('invalidated_assumptions' in record)
    ) {
      throw new TransferError('transfer snapshot must have the exact field set { transfers, invalidated_assumptions }');
    }
    if (!Array.isArray(record['transfers']) || !Array.isArray(record['invalidated_assumptions'])) {
      throw new TransferError('transfer snapshot entries must be arrays');
    }
    const store = new TransferStore();
    for (const value of record['transfers']) {
      assertValidTransferRecord(value);
      const stored = structuredClone(value as TransferEvidenceRecord);
      const existing = store.transfers.get(stored.id);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(stored)) {
          throw new TransferError(`transfer snapshot contains conflicting records with id ${stored.id}`);
        }
        continue;
      }
      store.transfers.set(stored.id, stored);
    }
    for (const value of record['invalidated_assumptions']) {
      assertValidInvalidatedAssumptionRecord(value);
      const stored = structuredClone(value as InvalidatedAssumptionRecord);
      const existing = store.invalidated.get(stored.id);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(stored)) {
          throw new TransferError(`transfer snapshot contains conflicting records with id ${stored.id}`);
        }
        continue;
      }
      store.invalidated.set(stored.id, stored);
    }
    return store;
  }
}
