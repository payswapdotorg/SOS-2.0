/**
 * Record read/write outcome payloads + typed conflict records (Work Order P2).
 *
 * DOMAIN RECORDS CROSS THE BOUNDARY VERBATIM: a Mission, SystemState,
 * Evidence, Task or BodyLease record is transmitted as the exact JSON the
 * owning package's guard validated — the semantic types and guards remain
 * owned by the domain packages / @sos-2/live-store; this contract types the
 * ENVELOPE around them (`record: JsonValue`). The store never rewrites
 * content, so `record` round-trips bit-exactly on canonical serialization.
 *
 * The REVISION-CONFLICT record is the typed optimistic-concurrency failure:
 * it carries the CURRENT stored revision (the revision the caller must move
 * forward from) plus the attempted revision and a machine-readable code.
 */

import { isJsonObject, isJsonValue, type JsonValue } from './json.js';

export const REVISION_CONFLICT_CODES = ['STALE_REVISION', 'REVISION_DIVERGENCE'] as const;

export type RevisionConflictCode = (typeof REVISION_CONFLICT_CODES)[number];

const REVISION_CONFLICT_CODE_SET: ReadonlySet<string> = new Set(REVISION_CONFLICT_CODES);

export function isRevisionConflictCode(value: unknown): value is RevisionConflictCode {
  return typeof value === 'string' && REVISION_CONFLICT_CODE_SET.has(value);
}

/**
 * The typed conflict record produced when a write fails optimistic
 * concurrency. STALE_REVISION: the written record's revision is older than
 * the stored revision. REVISION_DIVERGENCE: same revision, different
 * content — the store never rewrites content, so the write is rejected
 * loudly. In both cases `current_revision` is the stored record's exact
 * revision.
 */
export interface RevisionConflictRecord {
  error_kind: 'CONFLICT';
  code: RevisionConflictCode;
  repository: string;
  record_id: string;
  attempted_revision: number;
  current_revision: number;
  message: string;
}

const CONFLICT_KEYS = [
  'error_kind',
  'code',
  'repository',
  'record_id',
  'attempted_revision',
  'current_revision',
  'message',
] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

export function isRevisionConflictRecord(value: unknown): value is RevisionConflictRecord {
  if (!isJsonObject(value)) {
    return false;
  }
  const record = value as unknown as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== CONFLICT_KEYS.length || !CONFLICT_KEYS.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return false;
  }
  if (record['error_kind'] !== 'CONFLICT') {
    return false;
  }
  if (!isRevisionConflictCode(record['code'])) {
    return false;
  }
  if (!isNonEmptyString(record['repository']) || !isNonEmptyString(record['record_id']) || !isNonEmptyString(record['message'])) {
    return false;
  }
  return isPositiveInteger(record['attempted_revision']) && isPositiveInteger(record['current_revision']);
}

// ---------------------------------------------------------------------------
// Wire response shapes
// ---------------------------------------------------------------------------

/** Single-record read response (GET /api/<resource>/:id). */
export interface RecordResponse {
  record: JsonValue;
  revision: number;
}

/** Record write response (PUT /api/<resource>). outcome is STORED or IDEMPOTENT_REPLAY. */
export interface RecordWriteResponse {
  outcome: 'STORED' | 'IDEMPOTENT_REPLAY';
  record: JsonValue;
  revision: number;
}

/** One item of a record listing page: the verbatim record + its exact revision. */
export interface RecordPageItem {
  record: JsonValue;
  revision: number;
}

function isRecordEnvelope(value: unknown, keys: readonly string[]): boolean {
  if (!isJsonObject(value)) {
    return false;
  }
  const record = value as unknown as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return false;
  }
  return isJsonValue(record['record']) && isPositiveInteger(record['revision']);
}

export function isRecordResponse(value: unknown): value is RecordResponse {
  return isRecordEnvelope(value, ['record', 'revision']);
}

export function isRecordWriteResponse(value: unknown): value is RecordWriteResponse {
  if (!isRecordEnvelope(value, ['outcome', 'record', 'revision'])) {
    return false;
  }
  const outcome = (value as unknown as Record<string, unknown>)['outcome'];
  return outcome === 'STORED' || outcome === 'IDEMPOTENT_REPLAY';
}

export function isRecordPageItem(value: unknown): value is RecordPageItem {
  return isRecordEnvelope(value, ['record', 'revision']);
}
