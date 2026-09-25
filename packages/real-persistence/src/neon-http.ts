/**
 * THE REAL NEON HTTP SQL SEAM (Work Order P17-A): SQL over the Neon
 * HTTPS proxy — `POST https://<host>/sql` with a JSON body
 * `{query, params, array_mode}` and the connection string carried in
 * the `Neon-Connection-String` header (the protocol of Neon's
 * serverless driver HTTP mode, documented at
 * https://neon.tech/docs/serverless/serverless-driver — the driver's
 * fetch path without the WebSocket dependency, keeping this package at
 * ZERO external dependencies).
 *
 * REAL, and honest about it:
 *   - every request goes to the REAL Neon HTTPS SQL proxy on the
 *     branch's compute host (host parsed from the INJECTED pooled
 *     connection string; base URL overridable for tests);
 *   - the connection string (which carries the password) is INJECTED by
 *     the caller and lives ONLY in the request header — never echoed,
 *     never logged, never in outcomes or evidence (the transcript
 *     recorder replaces the header with the DATABASE_URL env NAME);
 *   - a transport failure is a typed TransportError the adapter maps to
 *     honest UNAVAILABLE (never fabricated success);
 *   - response shape: `{fields, rows, command, rowCount}` — rows carry
 *     JSON-typed values.
 *
 * Determinism discipline: the fetch seam is INJECTABLE; the deterministic
 * suites script it. Only the env-gated integration suite attaches the
 * global-fetch port. This file is the package's documented SQL network
 * boundary for Neon (together with neon-admin.ts for the management
 * API).
 */

import { TransportError, jsonBody, parseJsonBody } from './http.js';
import type { FetchPort, HttpRequest, HttpResponse } from './http.js';

/** One executed SQL statement's JSON-typed result. */
export interface NeonSqlResult {
  /** Column names in order. */
  readonly fields: string[];
  /** Rows as JSON objects keyed by column name (JSON-typed values). */
  readonly rows: Record<string, unknown>[];
  /** The SQL command tag (e.g. 'SELECT', 'INSERT', 'UPDATE', 'CREATE TABLE'). */
  readonly command: string;
  /** The affected/returned row count when the provider reports one, else null. */
  readonly rowCount: number | null;
}

/** A recorded SQL round-trip (method + path + status — never the connection string, never the body). */
export interface RecordedNeonSqlRequest {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly command: string | null;
}

export interface NeonHttpClientOptions {
  /**
   * The pooled connection string VALUE (secret; injected by the caller
   * from the environment at the composition boundary). The host and
   * database name are parsed from it; the string itself lives ONLY in
   * the Neon-Connection-String request header.
   */
  readonly connectionString: string;
  /** The injectable network seam. The ONLY place this client touches the network. */
  readonly fetch: FetchPort;
  /** The SQL proxy base URL override (tests); default derives from the connection string host. */
  readonly baseUrl?: string;
  /** The SQL proxy path (default '/sql'; overridable for tests). */
  readonly path?: string;
}

/** A typed Neon SQL-over-HTTP failure (mapped to honest UNAVAILABLE by the adapter). */
export class NeonSqlError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'NeonSqlError';
    this.status = status;
  }
}

/**
 * The fetch-backed Neon HTTP SQL client — the REAL SQL seam of the P17-A
 * durable adapter. Deterministic when a scripted FetchPort is injected;
 * real only when the global-fetch port is attached in the integration
 * suite.
 */
export class NeonHttpClient {
  private readonly connectionString: string;
  private readonly fetch: FetchPort;
  private readonly baseUrl: string;
  private readonly path: string;
  private readonly recorded: RecordedNeonSqlRequest[] = [];

  constructor(options: NeonHttpClientOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new Error('NeonHttpClient requires an options object');
    }
    if (typeof options.connectionString !== 'string' || options.connectionString.length === 0) {
      throw new Error('NeonHttpClient requires a non-empty connection string (fail closed)');
    }
    this.connectionString = options.connectionString;
    this.fetch = options.fetch;
    this.path = options.path ?? '/sql';
    if (options.baseUrl !== undefined) {
      this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    } else {
      let host = 'localhost';
      try {
        host = new URL(this.connectionString).hostname;
      } catch {
        throw new Error('NeonHttpClient connection string is not a parseable URL');
      }
      this.baseUrl = `https://${host}`;
    }
  }

  /** The recorded request log (method + path + status + command; never bodies, never credentials). */
  recordedRequests(): readonly RecordedNeonSqlRequest[] {
    return this.recorded.map((entry) => ({ ...entry }));
  }

  /** Execute one SQL statement with JSON-typed parameters. */
  async query(sql: string, params: readonly unknown[] = []): Promise<NeonSqlResult> {
    const request: HttpRequest = {
      method: 'POST',
      url: `${this.baseUrl}${this.path}`,
      headers: {
        'content-type': 'application/json',
        // The connection string (carrying the password) is injected here
        // and ONLY here — never logged, never echoed.
        'neon-connection-string': this.connectionString,
      },
      body: jsonBody({ query: sql, params: [...params], array_mode: false }),
    };
    let response: HttpResponse;
    try {
      response = await this.fetch(request);
    } catch (error) {
      // A transport failure (DNS, network, timeout) is an HONEST fact —
      // typed TransportError; the adapter maps it to UNAVAILABLE.
      this.recorded.push({ method: request.method, path: this.path, status: 0, command: null });
      if (error instanceof TransportError) {
        throw error;
      }
      throw new TransportError(`neon sql transport failure: ${(error as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = parseJsonBody(response);
    } catch (error) {
      this.recorded.push({ method: request.method, path: this.path, status: response.status, command: null });
      throw new NeonSqlError(
        `neon sql proxy answered HTTP ${String(response.status)} with a non-JSON body (${(error as Error).message})`,
        response.status,
      );
    }
    const record = parsed as Record<string, unknown>;
    if (response.status < 200 || response.status >= 300) {
      const message = typeof record['message'] === 'string' ? record['message'] : 'unspecified provider error';
      this.recorded.push({ method: request.method, path: this.path, status: response.status, command: null });
      throw new NeonSqlError(`neon sql query failed with HTTP ${String(response.status)}: ${message}`, response.status);
    }
    if (!Array.isArray(record['rows']) || !Array.isArray(record['fields'])) {
      this.recorded.push({ method: request.method, path: this.path, status: response.status, command: null });
      throw new NeonSqlError('neon sql proxy response lacks the fields/rows structure', response.status);
    }
    const fields = (record['fields'] as Record<string, unknown>[]).map((field) => String(field['name'] ?? ''));
    const command = typeof record['command'] === 'string' ? record['command'] : '';
    const rowCount =
      typeof record['rowCount'] === 'number'
        ? record['rowCount']
        : typeof record['row_count'] === 'number'
          ? record['row_count']
          : null;
    this.recorded.push({ method: request.method, path: this.path, status: response.status, command: command.length > 0 ? command : null });
    return {
      fields,
      rows: record['rows'] as Record<string, unknown>[],
      command,
      rowCount,
    };
  }
}

/** Construct the Neon HTTP SQL client (the real durable-SQL seam). */
export function createNeonHttpClient(options: NeonHttpClientOptions): NeonHttpClient {
  return new NeonHttpClient(options);
}
