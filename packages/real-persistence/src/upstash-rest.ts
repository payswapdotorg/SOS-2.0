/**
 * THE REAL UPSTASH REST SEAM (Work Order P17-A): Redis commands over the
 * Upstash REST API — `POST https://<host>/<command>/<arg...>` (URL-encoded
 * path form) and `POST https://<host>/pipeline` with a JSON array of
 * command arrays for batched round-trips (the documented Upstash REST
 * protocol: https://docs.upstash.com/redis/features/restapi).
 *
 * REAL, and honest about it:
 *   - every request goes to the REAL Upstash REST endpoint (base URL
 *     injected from the environment at the composition boundary);
 *   - the Authorization Bearer token is INJECTED by the caller and lives
 *     ONLY in the request header — never echoed, never logged (the
 *     transcript recorder replaces it with the
 *     UPSTASH_REDIS_REST_TOKEN env NAME);
 *   - a transport failure (including DNS resolution failure) is a typed
 *     TransportError the adapter maps to honest UNAVAILABLE — never a
 *     fabricated success;
 *   - response shape: {"result": <json>} on success, {"error": "..."}
 *     with a 4xx on command/authorization failure.
 *
 * Determinism discipline: the fetch seam is INJECTABLE; the deterministic
 * suites script it. Only the env-gated integration suite attaches the
 * global-fetch port. This file is the package's documented network
 * boundary for Upstash.
 */

import { TransportError, jsonBody, parseJsonBody } from './http.js';
import type { FetchPort, HttpRequest } from './http.js';

/** A recorded REST round-trip (method + path + status — never the token, never the body). */
export interface RecordedUpstashRequest {
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

/** A typed Upstash REST failure (mapped to honest UNAVAILABLE by the adapter). */
export class UpstashRestError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'UpstashRestError';
    this.status = status;
  }
}

export interface UpstashRestClientOptions {
  /** The REST endpoint base URL (e.g. https://<db>.upstash.io). */
  readonly restUrl: string;
  /** The REST token VALUE (injected by the caller from the environment at the composition boundary). */
  readonly token: string;
  /** The injectable network seam. The ONLY place this client touches the network. */
  readonly fetch: FetchPort;
}

/**
 * The fetch-backed Upstash REST client — the REAL coordination seam of
 * the P17-A adapter. Deterministic when a scripted FetchPort is
 * injected; real only when the global-fetch port is attached in the
 * integration suite.
 */
export class UpstashRestClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetch: FetchPort;
  private readonly recorded: RecordedUpstashRequest[] = [];

  constructor(options: UpstashRestClientOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new Error('UpstashRestClient requires an options object');
    }
    if (typeof options.restUrl !== 'string' || options.restUrl.length === 0) {
      throw new Error('UpstashRestClient requires a non-empty restUrl (fail closed)');
    }
    if (typeof options.token !== 'string' || options.token.length === 0) {
      throw new Error('UpstashRestClient requires a non-empty token (fail closed — never an empty credential)');
    }
    this.baseUrl = options.restUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.fetch = options.fetch;
  }

  /** The recorded request log (method + path + status; never bodies, never credentials). */
  recordedRequests(): readonly RecordedUpstashRequest[] {
    return this.recorded.map((entry) => ({ ...entry }));
  }

  /**
   * Execute ONE Redis command (path form). Args are URL-encoded into the
   * path; the JSON-typed `result` is returned. Command/authorization
   * failures throw typed UpstashRestError.
   */
  async command<T = unknown>(command: string, ...args: readonly string[]): Promise<T> {
    const segments = [command, ...args].map((segment) => encodeURIComponent(segment)).join('/');
    const path = `/${segments}`;
    const request: HttpRequest = {
      method: 'POST',
      url: `${this.baseUrl}${path}`,
      headers: {
        // The credential is injected here and ONLY here — never logged,
        // never echoed into outcomes, notes, telemetry or evidence.
        authorization: `Bearer ${this.token}`,
      },
      body: null,
    };
    return this.dispatch<T>(request, path);
  }

  /**
   * Execute a batch of commands through the /pipeline endpoint (ONE
   * round-trip). Returns the JSON-typed results in order.
   */
  async pipeline(commands: readonly (readonly string[])[]): Promise<unknown[]> {
    const path = '/pipeline';
    const request: HttpRequest = {
      method: 'POST',
      url: `${this.baseUrl}${path}`,
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: jsonBody(commands.map((entry) => [...entry])),
    };
    const result = await this.dispatch<unknown[]>(request, path);
    if (!Array.isArray(result)) {
      throw new UpstashRestError('pipeline response is not an array', 200);
    }
    return result;
  }

  private async dispatch<T>(request: HttpRequest, path: string): Promise<T> {
    let response: Awaited<ReturnType<FetchPort>>;
    try {
      response = await this.fetch(request);
    } catch (error) {
      // A transport failure (DNS, network, timeout) is an HONEST fact —
      // recorded with status 0 and surfaced as a typed TransportError.
      this.recorded.push({ method: request.method, path, status: 0 });
      if (error instanceof TransportError) {
        throw error;
      }
      throw new TransportError(`upstash rest transport failure: ${(error as Error).message}`);
    }
    this.recorded.push({ method: request.method, path, status: response.status });
    let parsed: unknown;
    try {
      parsed = parseJsonBody(response);
    } catch (error) {
      throw new UpstashRestError(
        `upstash rest answered HTTP ${String(response.status)} with a non-JSON body (${(error as Error).message})`,
        response.status,
      );
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record['error'] === 'string') {
      throw new UpstashRestError(`upstash rest error (HTTP ${String(response.status)}): ${record['error']}`, response.status);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new UpstashRestError(`upstash rest command failed with HTTP ${String(response.status)}`, response.status);
    }
    return record['result'] as T;
  }
}

/** Construct the Upstash REST client (the real coordination seam). */
export function createUpstashRestClient(options: UpstashRestClientOptions): UpstashRestClient {
  return new UpstashRestClient(options);
}
