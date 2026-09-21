/**
 * Opaque pagination cursors (Work Order P2).
 *
 * Deterministic seek-style pagination: the cursor encodes (after-id, limit)
 * as the base64url of the SPINE's canonical JSON serialization — the same
 * canonical form the whole system uses, so cursor encoding is byte-stable
 * across processes and runs. Cursor decoding NEVER throws: a malformed
 * cursor decodes to null and the caller answers INVALID.
 */

import { canonicalSerialize } from '@sos-2/semantic-spine';

/** Upper bound on requested page size (protects the request lifetime). */
export const MAX_PAGE_LIMIT = 200;

/** Page size when the caller does not request one. */
export const DEFAULT_PAGE_LIMIT = 50;

export interface PageRequest {
  /** Maximum number of items to return (1..MAX_PAGE_LIMIT). */
  limit: number;
  /** Opaque cursor from a previous page, or null for the first page. */
  cursor: string | null;
}

export interface Page<T> {
  items: T[];
  /** Cursor for the next page, or null when this is the last page. */
  next_cursor: string | null;
}

interface CursorPayload {
  after: string;
  limit: number;
}

function base64UrlEncode(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

function base64UrlDecode(encoded: string): string | null {
  try {
    return Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

/** Encode a cursor from its (after-id, limit) parts (deterministic). */
export function encodePageCursor(after: string, limit: number): string {
  const payload: CursorPayload = { after, limit };
  return base64UrlEncode(canonicalSerialize(payload));
}

/**
 * Decode a cursor. Returns null when the cursor is malformed (the caller
 * answers INVALID with a precise message — never a silent reset to page one,
 * which would hide a broken pagination state).
 */
export function decodePageCursor(cursor: string): CursorPayload | null {
  const text = base64UrlDecode(cursor);
  if (text === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== 2 || !actual.includes('after') || !actual.includes('limit')) {
    return null;
  }
  const after = record['after'];
  const limit = record['limit'];
  if (typeof after !== 'string' || after.length === 0) {
    return null;
  }
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    return null;
  }
  return { after, limit };
}

/**
 * Parse a list query (transport-agnostic: a header/query map as produced by
 * any host). Returns the page request, or a typed INVALID message.
 */
export function parseListQuery(
  params: Readonly<Record<string, string | string[] | undefined>>,
): { ok: true; request: PageRequest } | { ok: false; error: string } {
  const rawLimit = params['limit'];
  const rawCursor = params['cursor'];

  if (rawCursor !== undefined && typeof rawCursor !== 'string') {
    return { ok: false, error: 'cursor must be a single value' };
  }
  if (rawLimit !== undefined && typeof rawLimit !== 'string') {
    return { ok: false, error: 'limit must be a single value' };
  }

  let limit = DEFAULT_PAGE_LIMIT;
  if (rawLimit !== undefined) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return { ok: false, error: `limit must be an integer >= 1, received: ${JSON.stringify(rawLimit)}` };
    }
    if (parsed > MAX_PAGE_LIMIT) {
      return { ok: false, error: `limit must not exceed ${MAX_PAGE_LIMIT}, received: ${String(parsed)}` };
    }
    limit = parsed;
  }

  if (rawCursor === undefined || rawCursor === null || rawCursor === '') {
    return { ok: true, request: { limit, cursor: null } };
  }
  const decoded = decodePageCursor(rawCursor);
  if (decoded === null) {
    return { ok: false, error: `malformed pagination cursor: ${JSON.stringify(rawCursor)}` };
  }
  return { ok: true, request: { limit: decoded.limit, cursor: rawCursor } };
}
