/**
 * Transport-agnostic request/response envelopes and the route table
 * (Work Order P2).
 *
 * The API service is hostable as a plain Node process today and in a Vercel
 * function or external worker boundary later WITHOUT contract change: the
 * handler consumes `ApiRequest` and produces `ApiResponse` — both plain
 * data, no node:http types — and each host adapts its own transport onto
 * these envelopes.
 *
 * Record bodies are the DOMAIN RECORDS THEMSELVES (verbatim shapes from the
 * owning @sos-2/* packages). This package types only the envelope around
 * them: write results, list pages and the route table. It deliberately does
 * not re-declare any domain record shape (the spine packages are the single
 * authority).
 */

import type { JsonValue } from '@sos-2/semantic-spine';

/**
 * A transport-agnostic API request. Headers use lowercase names; the body is
 * raw bytes (JSON at the boundary) or null for bodiless requests.
 */
export interface ApiRequest {
  /** HTTP method, uppercase (e.g. "GET"). */
  method: string;
  /** Path without query string, starting with "/" (e.g. "/mission"). */
  path: string;
  /** Query parameters (single or repeated). */
  query: Readonly<Record<string, string | string[] | undefined>>;
  /** Request headers, lowercased names. */
  headers: Readonly<Record<string, string>>;
  /** Raw request body, or null when absent. */
  body: Uint8Array | null;
}

/** A transport-agnostic API response (the JSON body is a JsonValue). */
export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: JsonValue | null;
}

/** The result of a record write that was accepted (first store or replay). */
export interface RecordWriteResponse<R> {
  /**
   * STORED — the record was written for the first time (or at a newer
   * revision); IDENTICAL — the replay of an already-stored byte-identical
   * write (idempotent no-op; the stored record is returned, never a
   * duplicate, never an error).
   */
  kind: 'STORED' | 'IDENTICAL';
  record: R;
}

/** A list page of records (seek pagination; see pagination.ts). */
export interface RecordListResponse<R> {
  items: R[];
  next_cursor: string | null;
}

/** The full route surface of the live API (Work Order P2 route contract). */
export const API_ROUTES = [
  'GET /health',
  'GET /mission',
  'GET /mission/:id',
  'PUT /mission',
  'GET /system-state',
  'GET /system-state/:id',
  'PUT /system-state',
  'GET /evidence',
  'GET /evidence/:id',
  'PUT /evidence',
  'GET /task',
  'GET /task/:id',
  'PUT /task',
  'GET /body-lease',
  'GET /body-lease/:id',
  'PUT /body-lease',
  'GET /observation',
  'GET /observation/:id',
  'PUT /observation',
  'POST /events',
] as const;

export type ApiRoute = (typeof API_ROUTES)[number];
