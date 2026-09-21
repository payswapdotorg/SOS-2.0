/**
 * Pagination cursors (Work Order P2).
 *
 * Cursor pagination over deterministically ordered listings. The cursor is
 * an OPAQUE string encoding the last item's sort key; listings are ordered
 * deterministically (record repositories by record id ascending; the
 * observation event log by (occurred_at, event_id) ascending) so that pages
 * are stable and reproducible. The cursor codec is pure and dependency-free
 * (base64url of a minimal JSON object) so both the service and its clients
 * can share it.
 */

import { isJsonObject, type JsonValue } from './json.js';

/** Cursor pagination request (limit is clamped server-side; see LIMIT bounds). */
export interface PageRequest {
  /** The opaque cursor from a previous page's next_cursor, or null/undefined for the first page. */
  cursor?: string | null;
  /** Requested page size; clamped into [MIN_PAGE_LIMIT, MAX_PAGE_LIMIT]. */
  limit?: number;
}

export const MIN_PAGE_LIMIT = 1;
export const MAX_PAGE_LIMIT = 200;
export const DEFAULT_PAGE_LIMIT = 50;

export function clampPageLimit(limit: number | undefined | null): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_PAGE_LIMIT;
  }
  const floor = Math.floor(limit);
  if (floor < MIN_PAGE_LIMIT) {
    return MIN_PAGE_LIMIT;
  }
  if (floor > MAX_PAGE_LIMIT) {
    return MAX_PAGE_LIMIT;
  }
  return floor;
}

/** One page of items plus the cursor for the next page (null on the last page). */
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

// ---------------------------------------------------------------------------
// Opaque cursor codec
// ---------------------------------------------------------------------------

const CURSOR_KEY = 'k';

/** Encode a sort key into an opaque cursor (pure; deterministic). */
export function encodeCursor(sortKey: string): string {
  const payload: JsonValue = { [CURSOR_KEY]: sortKey };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Decode an opaque cursor into its sort key. Returns null for null/absent cursors. Throws TypeError on malformed cursors. */
export function decodeCursor(cursor: string | null | undefined): string | null {
  if (cursor === null || cursor === undefined || cursor === '') {
    return null;
  }
  if (typeof cursor !== 'string') {
    throw new TypeError('cursor must be a string');
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new TypeError('cursor is not a valid opaque cursor (base64url JSON)');
  }
  if (!isJsonObject(decoded) || Object.keys(decoded).length !== 1) {
    throw new TypeError('cursor payload must be an object with exactly one key');
  }
  const key = (decoded as Record<string, unknown>)[CURSOR_KEY];
  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError('cursor payload must carry a non-empty string sort key');
  }
  return key;
}

/** Structural check for a plausible cursor string (non-empty, base64url charset). */
export function isCursorString(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  return /^[A-Za-z0-9_-]+$/.test(value);
}
