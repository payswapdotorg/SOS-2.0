/**
 * THE REAL HTTP SEAM (Work Order P17-B): a fetch-backed implementation
 * of the frozen @sos-2/github GitHubRequestPort — the exact seam P4
 * designed for this attachment ("a real backing provider is a
 * GitHubPort implementation over an injected GitHubRequestPort (the
 * HTTP seam)").
 *
 * REAL, and honest about it:
 *   - every request goes to the REAL GitHub REST API
 *     (https://api.github.com by default, overridable for probes/tests);
 *   - the Authorization header is INJECTED from the credential the
 *     CALLER supplies (the transport never reads the ambient environment —
 *     the env-only rule is enforced at the composition boundary);
 *   - rate-limit and API-revision response headers are captured as REAL
 *     probe data (the provider-state surface and evidence consume them);
 *   - request/response bodies NEVER log the credential (the value never
 *     appears in outcomes, notes or evidence — names only).
 *
 * Determinism discipline for the OFFLINE suites: the fetch
 * implementation is INJECTABLE (`fetchImpl`) — the deterministic tests
 * script it; only the real integration suite attaches the global fetch.
 * This file is the package's documented network boundary (the one place
 * network happens), mirroring how @sos-2/github documented its seam.
 */

import type { GitHubProviderRequest, GitHubProviderResponse, GitHubRequestPort } from './github-vocabulary.js';

/** The real API transport's honest connection/telemetry snapshot. */
export interface GitHubTransportTelemetry {
  /** The requests dispatched so far (count). */
  readonly requests: number;
  /** The exact GitHub API revision observed last (e.g. '2022-11-28'), or null. */
  readonly apiRevision: string | null;
  /** The REAL OAuth scopes the provider reported for the credential (x-oauth-scopes), or null. */
  readonly oauthScopes: string[] | null;
  /** The last observed rate-limit snapshot (REAL header data), or null. */
  readonly rateLimit: {
    readonly resource: string;
    readonly limit: number;
    readonly remaining: number;
    readonly used: number;
    readonly reset_epoch_s: number;
  } | null;
  /** The last HTTP status observed, or null before the first response. */
  readonly lastStatus: number | null;
}

/** Options for the fetch-backed request port. */
export interface FetchGitHubRequestPortOptions {
  /**
   * The credential VALUE (injected by the caller from the environment at
   * the composition boundary — the transport never reads the ambient environment).
   * Null leaves requests unauthenticated (honest anonymous probing).
   */
  readonly token: string | null;
  /**
   * The injectable fetch implementation. Defaults to the global fetch —
   * the ONLY place this package touches the network. Deterministic tests
   * inject a scripted implementation (offline, fixed-seed).
   */
  readonly fetchImpl?: typeof fetch;
  /** The API base URL (default: the real GitHub REST API). */
  readonly baseUrl?: string;
  /** The requested GitHub API revision (default: 2022-11-28). */
  readonly apiVersion?: string;
  /**
   * Per-request timeout in milliseconds (default: 30_000; the real
   * provider must not hang the runtime silently).
   */
  readonly timeoutMs?: number;
}

interface FetchHeadersLike {
  get(name: string): string | null;
}

interface FetchResponseLike {
  readonly status: number;
  readonly ok: boolean;
  text(): Promise<string>;
  headers: FetchHeadersLike;
}

/** One recorded request (method + path + status — NEVER the credential, NEVER the body). */
export interface RecordedGitHubRequest {
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

const DEFAULT_BASE_URL = 'https://api.github.com';
const DEFAULT_API_VERSION = '2022-11-28';
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The fetch-backed GitHubRequestPort — the REAL HTTP seam of the P17-B
 * adapter. Deterministic when a scripted fetchImpl is injected; real
 * only when the global fetch is attached in the integration suite.
 */
export class FetchGitHubRequestPort implements GitHubRequestPort {
  private readonly token: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly timeoutMs: number;
  private requestCount = 0;
  private apiRevision: string | null = null;
  private oauthScopes: string[] | null = null;
  private rateLimit: GitHubTransportTelemetry['rateLimit'] = null;
  private lastStatus: number | null = null;
  private readonly recorded: RecordedGitHubRequest[] = [];

  constructor(options: FetchGitHubRequestPortOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new Error('FetchGitHubRequestPort requires an options object');
    }
    if (options.token !== null && (typeof options.token !== 'string' || options.token.length === 0)) {
      throw new Error('FetchGitHubRequestPort token must be a non-empty string or null (never an empty credential — fail closed)');
    }
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** The honest telemetry of the REAL transport (probe data, names only — never the token). */
  telemetry(): GitHubTransportTelemetry {
    return {
      requests: this.requestCount,
      apiRevision: this.apiRevision,
      oauthScopes: this.oauthScopes,
      rateLimit: this.rateLimit,
      lastStatus: this.lastStatus,
    };
  }

  /** The recorded request log (method + path + status; never bodies, never credentials). */
  recordedRequests(): readonly RecordedGitHubRequest[] {
    return this.recorded.map((entry) => ({ ...entry }));
  }

  async request<TBody, TResult>(request: GitHubProviderRequest<TBody>): Promise<GitHubProviderResponse<TResult>> {
    if (typeof request !== 'object' || request === null) {
      throw new Error('FetchGitHubRequestPort.request requires a typed GitHubProviderRequest');
    }
    const url = new URL(`${this.baseUrl}${request.path}`);
    if (request.query !== null) {
      for (const [key, value] of Object.entries(request.query)) {
        url.searchParams.set(key, value);
      }
    }
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': this.apiVersion,
      ...request.headers,
    };
    if (this.token !== null) {
      // The credential is injected here and ONLY here — never logged,
      // never echoed into outcomes, notes, telemetry or evidence.
      headers['authorization'] = `Bearer ${this.token}`;
    }
    const hasBody = request.body !== null && request.body !== undefined;
    if (hasBody) {
      headers['content-type'] = 'application/json';
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: FetchResponseLike;
    try {
      const raw = await this.fetchImpl(url.toString(), {
        method: request.method,
        headers,
        body: hasBody ? JSON.stringify(request.body) : undefined,
        signal: controller.signal,
      });
      response = raw as unknown as FetchResponseLike;
    } catch (error) {
      // A network failure is an HONEST transport fact — surfaced as a
      // 0-status typed response the provider maps to UNAVAILABLE (never
      // a fabricated success, never a thrown crash).
      this.requestCount += 1;
      this.lastStatus = 0;
      this.recorded.push({ method: request.method, path: request.path, status: 0 });
      const reason = error instanceof Error ? error.message : 'network failure';
      return { status: 0, body: ({ message: `network failure: ${reason}` } as unknown) as TResult };
    } finally {
      clearTimeout(timer);
    }
    this.requestCount += 1;
    this.lastStatus = response.status;
    this.recorded.push({ method: request.method, path: request.path, status: response.status });
    const revision = response.headers.get('x-github-api-version-selected') ?? response.headers.get('x-github-media-type');
    if (revision !== null && revision.length > 0) {
      this.apiRevision = revision;
    }
    const oauthScopes = response.headers.get('x-oauth-scopes');
    if (oauthScopes !== null && oauthScopes.length > 0) {
      this.oauthScopes = oauthScopes.split(',').map((scope) => scope.trim()).filter((scope) => scope.length > 0);
    }
    const rateLimit = this.parseRateLimit(response.headers);
    if (rateLimit !== null) {
      this.rateLimit = rateLimit;
    }
    const text = await response.text();
    if (text.length === 0) {
      return { status: response.status, body: null };
    }
    try {
      return { status: response.status, body: JSON.parse(text) as TResult };
    } catch {
      return { status: response.status, body: ({ message: text } as unknown) as TResult };
    }
  }

  private parseRateLimit(headers: FetchHeadersLike): GitHubTransportTelemetry['rateLimit'] {
    const remaining = headers.get('x-ratelimit-remaining');
    const limit = headers.get('x-ratelimit-limit');
    const used = headers.get('x-ratelimit-used');
    const reset = headers.get('x-ratelimit-reset');
    if (remaining === null || limit === null || reset === null) {
      return null;
    }
    const asNumber = (value: string): number | null => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const remainingN = asNumber(remaining);
    const limitN = asNumber(limit);
    const resetN = asNumber(reset);
    const usedN = used === null ? null : asNumber(used);
    if (remainingN === null || limitN === null || resetN === null) {
      return null;
    }
    return {
      resource: 'core',
      limit: limitN,
      remaining: remainingN,
      used: usedN ?? limitN - remainingN,
      reset_epoch_s: resetN,
    };
  }
}

/** Construct the fetch-backed request port (the real HTTP seam). */
export function createFetchGitHubRequestPort(options: FetchGitHubRequestPortOptions): FetchGitHubRequestPort {
  return new FetchGitHubRequestPort(options);
}
