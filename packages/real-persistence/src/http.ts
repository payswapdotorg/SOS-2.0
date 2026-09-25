/**
 * THE REAL HTTP SEAM (Work Order P17-A) — the single place real network
 * enters the persistence lane. Library code NEVER touches global fetch,
 * ambient timers, the ambient environment or any provider SDK: every adapter
 * (Neon HTTP SQL, Neon management API, Upstash REST, R2 S3 SigV4)
 * receives a FetchPort and performs typed requests through it. The
 * process boundary (composition roots / integration runners) binds the
 * port to the platform's global fetch (bindGlobalFetch below — the
 * documented impure boundary, the exact P17-C observation-lane
 * discipline, which itself mirrors the P17-B fetch-transport seam).
 *
 * The request body is typed as Uint8Array (binary-safe): the R2 S3
 * client signs and uploads raw bytes; the JSON-based providers encode
 * their bodies before dispatch. Responses expose status + headers +
 * bytes, with a text() convenience for the JSON providers.
 */

export interface HttpRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  readonly url: string;
  readonly headers: Record<string, string>;
  /** Raw request body, or null for body-less requests. */
  readonly body: Uint8Array | null;
}

export interface HttpResponse {
  readonly status: number;
  /** Response headers, lowercased keys (deterministic access). */
  readonly headers: Record<string, string>;
  readonly bytes: Uint8Array;
}

/** The injected network seam. Never throws for HTTP statuses — only for transport-level failures. */
export type FetchPort = (request: HttpRequest) => Promise<HttpResponse>;

/** A transport-level failure (network unreachable, DNS, timeout) — typed, never an HTTP status. */
export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportError';
  }
}

/**
 * Bind the FetchPort to the platform's global fetch (PROCESS BOUNDARY
 * ONLY — never inside library code). Headers are lowercased for
 * deterministic access; a network failure becomes a typed TransportError
 * carrying the real reason; an optional per-request timeout is enforced
 * through AbortSignal.
 */
export function bindGlobalFetch(options?: { timeoutMs?: number }): FetchPort {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  return async (request: HttpRequest): Promise<HttpResponse> => {
    let response: Response;
    try {
      response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body === null ? undefined : new Uint8Array(request.body),
        signal: AbortSignal.timeout(timeoutMs),
        // HEAD responses must keep their headers without forcing a body read.
        redirect: 'manual',
      });
    } catch (error) {
      throw new TransportError(`transport failure for ${request.method} ${request.url}: ${(error as Error).message}`);
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, headers, bytes };
  };
}

/** Decode a response body as UTF-8 text (JSON providers' convenience — pure, no network). */
export function responseText(response: HttpResponse): string {
  return new TextDecoder('utf-8').decode(response.bytes);
}

/** Deterministic helper: read a JSON body, typed-failing on malformed JSON. */
export function parseJsonBody(response: HttpResponse): unknown {
  const text = responseText(response);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new TransportError(`response body is not valid JSON (${(error as Error).message})`);
  }
}

/** UTF-8 encode a JSON request body (the JSON providers' convenience — pure). */
export function jsonBody(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}
