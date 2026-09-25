/**
 * The injectable HTTP seam — the single place real network enters the
 * observation lane. Library code NEVER touches global fetch, ambient
 * timers, process.env or any provider SDK: every adapter receives a
 * FetchPort and performs typed requests through it. The process
 * boundary (composition roots / integration runners) binds the port to
 * the platform's global fetch (bindGlobalFetch below — the documented
 * impure boundary, mirroring the apps/observation SystemClock
 * precedent).
 *
 * The merged @sos-2/github package set the seam discipline
 * (GitHubRequestPort); this is the same discipline for the observation
 * lane, carrying response headers because API revisions
 * (x-github-media-type, vercel API version) and rate-limit headers are
 * part of the honest connectivity evidence.
 */

export interface HttpRequest {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
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
  const timeoutMs = options?.timeoutMs ?? 15_000;
  return async (request: HttpRequest): Promise<HttpResponse> => {
    let response: Response;
    try {
      response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new TransportError(`transport failure for ${request.method} ${request.url}: ${(error as Error).message}`);
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return { status: response.status, headers, body: await response.text() };
  };
}

/** Deterministic helper: read a JSON body, typed-failing on malformed JSON. */
export function parseJsonBody(response: HttpResponse): unknown {
  try {
    return JSON.parse(response.body) as unknown;
  } catch (error) {
    throw new TransportError(`response body is not valid JSON (${(error as Error).message})`);
  }
}
