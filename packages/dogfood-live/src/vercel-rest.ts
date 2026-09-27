/**
 * THE DOGFOOD-SCOPED VERCEL REST CLIENT (Work Order P19) — a minimal,
 * dogfood-scoped Vercel REST surface over the REAL API, following the
 * reusable @sos-2/deployment-providers patterns (the injectable FetchPort
 * network seam, the redacted transcript recorder, env-NAME credential
 * references, typed provider failures) with the EXACT §0b-verified
 * request shapes:
 *
 *   - GET  /v2/user                     the authenticated token probe;
 *   - GET  /v9/projects/{name}          project discovery (null on 404);
 *   - POST /v9/projects?teamId=<org>    {"name":"<proj>","gitRepository":
 *     {"type":"github","repo":"owner/name"}} — the verified project-creation
 *     body (the gitSource/link body fields are REJECTED by the current API;
 *     gitRepository is the accepted one);
 *   - PATCH /v9/projects/{name}         {"ssoProtection":null} — the verified
 *     fix that makes NEW projects serve deployments publicly (the default
 *     ssoProtection deploymentType redirects to vercel.com/login);
 *   - POST /v13/deployments?teamId=<org>&skipAutoDetectionConfirmation=1
 *     {"name":"<proj>","gitSource":{"type":"github","repoId":<id>,"ref":<ref>},
 *     "target":"production"} — a production deployment from an exact git ref;
 *   - GET  /v13/deployments/{id}        the deployment state read
 *     (poll until readyState READY — a static-content repo, framework null,
 *     deploys in seconds).
 *
 * The token lives ONLY in the Authorization header; the transcript
 * recorder replaces it with the VERCEL_TOKEN env NAME reference. The
 * fetch seam is INJECTABLE — the deterministic suites script it.
 */

import { TransportError, jsonBody, parseJsonBody } from '@sos-2/deployment-providers';
import type { FetchPort, HttpRequest, HttpResponse } from '@sos-2/deployment-providers';

/** The real Vercel API base URL. */
export const DOGFOOD_VERCEL_API_BASE_URL = 'https://api.vercel.com';

/** A recorded dogfood Vercel REST round-trip (method + path + status — never the token, never the body). */
export interface RecordedDogfoodVercelRequest {
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

/** A typed Vercel API failure (honest — surfaced verbatim, never fabricated into success). */
export class DogfoodVercelApiError extends Error {
  readonly status: number | null;
  readonly vercelErrorCode: string | null;

  constructor(message: string, status: number | null, vercelErrorCode: string | null) {
    super(message);
    this.name = 'DogfoodVercelApiError';
    this.status = status;
    this.vercelErrorCode = vercelErrorCode;
  }
}

/** The dogfood Vercel user identity (public fields only — probe evidence). */
export interface DogfoodVercelUser {
  readonly id: string;
  readonly username: string;
  readonly defaultTeamId: string | null;
}

/** The dogfood Vercel project identity (public fields). */
export interface DogfoodVercelProject {
  readonly id: string;
  readonly name: string;
  readonly framework: string | null;
  readonly rootDirectory: string | null;
  readonly createdAt: number | null;
  /** The git repository link (type 'github'; carries the repoId). */
  readonly gitRepository: { readonly type: string; readonly org: string; readonly repo: string; readonly repoId: number | null } | null;
  /** The honest ssoProtection marker the API reports (null when disabled). */
  readonly ssoProtection: unknown;
}

/** The dogfood Vercel deployment identity (public fields; the exact-binding proof). */
export interface DogfoodVercelDeployment {
  readonly id: string;
  readonly url: string | null;
  readonly readyState: string;
  readonly createdAt: number | null;
  readonly target: string | null;
  /** The EXACT git commit sha the deployment was built from (gitSource.sha echo). */
  readonly commitSha: string | null;
  readonly teamId: string | null;
  readonly projectId: string | null;
}

export interface DogfoodVercelClientOptions {
  /** The token VALUE (injected at the composition boundary; never echoed). */
  readonly token: string;
  /** The team id scope (VERCEL_ORG_ID), or null for the personal default. */
  readonly teamId: string | null;
  /** The injectable network seam — the ONLY place network happens. */
  readonly fetch: FetchPort;
  /** The API base URL override (deterministic tests). */
  readonly baseUrl?: string;
}

/**
 * The dogfood-scoped Vercel REST client. Deterministic when a scripted
 * FetchPort is injected; real only when the global-fetch port is bound
 * in the env-gated RUN_REAL suite.
 */
export class DogfoodVercelClient {
  private readonly token: string;
  private readonly teamId: string | null;
  private readonly fetch: FetchPort;
  private readonly baseUrl: string;
  private readonly recorded: RecordedDogfoodVercelRequest[] = [];

  constructor(options: DogfoodVercelClientOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new Error('DogfoodVercelClient requires an options object');
    }
    if (typeof options.token !== 'string' || options.token.length === 0) {
      throw new Error('DogfoodVercelClient requires a non-empty token (fail closed — never an empty credential)');
    }
    this.token = options.token;
    this.teamId = options.teamId;
    this.fetch = options.fetch;
    this.baseUrl = (options.baseUrl ?? DOGFOOD_VERCEL_API_BASE_URL).replace(/\/+$/, '');
  }

  /** The recorded request log (method + path + status; never bodies, never credentials). */
  recordedRequests(): readonly RecordedDogfoodVercelRequest[] {
    return this.recorded.map((entry) => ({ ...entry }));
  }

  /** Dispatch one typed REST call. */
  async call(call: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; path: string; body?: unknown; query?: Record<string, string> }): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${call.path}`);
    if (this.teamId !== null) {
      url.searchParams.set('teamId', this.teamId);
    }
    for (const [key, value] of Object.entries(call.query ?? {})) {
      url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = {
      accept: 'application/json',
      // The credential is injected here and ONLY here — never logged, never echoed.
      authorization: `Bearer ${this.token}`,
    };
    const hasBody = call.body !== undefined;
    if (hasBody) {
      headers['content-type'] = 'application/json';
    }
    const request: HttpRequest = {
      method: call.method,
      url: url.toString(),
      headers,
      body: hasBody ? jsonBody(call.body) : null,
    };
    let response: HttpResponse;
    try {
      response = await this.fetch(request);
    } catch (error) {
      this.recorded.push({ method: call.method, path: `${url.pathname}${url.search}`, status: 0 });
      if (error instanceof TransportError) {
        throw error;
      }
      throw new TransportError(`vercel api transport failure: ${(error as Error).message}`);
    }
    this.recorded.push({ method: call.method, path: `${url.pathname}${url.search}`, status: response.status });
    if (response.bytes.byteLength === 0) {
      if (response.status < 200 || response.status >= 300) {
        throw new DogfoodVercelApiError(`vercel api answered HTTP ${String(response.status)} with an empty body`, response.status, null);
      }
      return null;
    }
    let parsed: unknown;
    try {
      parsed = parseJsonBody(response);
    } catch (error) {
      throw new DogfoodVercelApiError(
        `vercel api answered HTTP ${String(response.status)} with a non-JSON body (${(error as Error).message})`,
        response.status,
        null,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      const record = parsed as Record<string, unknown>;
      const error = typeof record['error'] === 'object' && record['error'] !== null ? (record['error'] as Record<string, unknown>) : null;
      const code = error !== null && typeof error['code'] === 'string' ? error['code'] : null;
      const message = error !== null && typeof error['message'] === 'string' ? error['message'] : 'unspecified provider error';
      throw new DogfoodVercelApiError(`vercel api call failed with HTTP ${String(response.status)}: ${message}`, response.status, code);
    }
    return parsed;
  }

  /** GET /v2/user — the authenticated token probe (honest user identity). */
  async user(): Promise<DogfoodVercelUser> {
    const body = (await this.call({ method: 'GET', path: '/v2/user' })) as Record<string, unknown>;
    const user = body['user'] as Record<string, unknown> | undefined;
    if (user === undefined) {
      throw new DogfoodVercelApiError('vercel /v2/user response lacks the user object', 200, null);
    }
    return {
      id: String(user['id'] ?? ''),
      username: String(user['username'] ?? ''),
      defaultTeamId: typeof user['defaultTeamId'] === 'string' ? user['defaultTeamId'] : null,
    };
  }

  /** GET /v9/projects/{name} — project discovery, or null when absent. */
  async getProject(name: string): Promise<DogfoodVercelProject | null> {
    try {
      const body = await this.call({ method: 'GET', path: `/v9/projects/${encodeURIComponent(name)}` });
      return parseProject(body);
    } catch (error) {
      if (error instanceof DogfoodVercelApiError && (error.status === 404 || error.vercelErrorCode === 'not_found')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * POST /v9/projects — the §0b-verified project creation: the body is
   * {"name","gitRepository":{"type":"github","repo":"owner/name"}} (the
   * gitSource/link fields are rejected by the current API; gitRepository
   * is the accepted one). The response link carries repoId.
   */
  async createProject(input: { name: string; org: string; repo: string }): Promise<DogfoodVercelProject> {
    const body = await this.call({
      method: 'POST',
      path: '/v9/projects',
      body: { name: input.name, gitRepository: { type: 'github', repo: `${input.org}/${input.repo}` } },
    });
    return parseProject(body);
  }

  /**
   * PATCH /v9/projects/{name} with {"ssoProtection":null} — the verified
   * fix that makes NEW projects serve deployments publicly (the default
   * ssoProtection deploymentType redirects to vercel.com/login).
   */
  async patchProjectSsoProtectionNull(name: string): Promise<DogfoodVercelProject> {
    const body = await this.call({
      method: 'PATCH',
      path: `/v9/projects/${encodeURIComponent(name)}`,
      body: { ssoProtection: null },
    });
    return parseProject(body);
  }

  /**
   * POST /v13/deployments — a production deployment from an EXACT git ref
   * (gitSource {type:'github', repoId, ref}; target 'production';
   * skipAutoDetectionConfirmation pins detection to the project preset).
   */
  async createProductionDeployment(input: { projectName: string; repoId: number; ref: string }): Promise<DogfoodVercelDeployment> {
    const body = await this.call({
      method: 'POST',
      path: '/v13/deployments',
      query: { skipAutoDetectionConfirmation: '1' },
      body: {
        name: input.projectName,
        gitSource: { type: 'github', repoId: input.repoId, ref: input.ref },
        target: 'production',
      },
    });
    return parseDeployment(body);
  }

  /** GET /v13/deployments/{id} — the deployment state read (the poll). */
  async getDeployment(id: string): Promise<DogfoodVercelDeployment> {
    const body = await this.call({ method: 'GET', path: `/v13/deployments/${encodeURIComponent(id)}` });
    return parseDeployment(body);
  }
}

function parseProject(entry: unknown): DogfoodVercelProject {
  const record = entry as Record<string, unknown>;
  const link = typeof record['link'] === 'object' && record['link'] !== null ? (record['link'] as Record<string, unknown>) : null;
  return {
    id: String(record['id'] ?? ''),
    name: String(record['name'] ?? ''),
    framework: typeof record['framework'] === 'string' ? record['framework'] : null,
    rootDirectory: typeof record['rootDirectory'] === 'string' ? record['rootDirectory'] : null,
    createdAt: typeof record['createdAt'] === 'number' ? record['createdAt'] : null,
    gitRepository:
      link !== null && typeof link['type'] === 'string'
        ? {
            type: link['type'],
            org: typeof link['org'] === 'string' ? link['org'] : '',
            repo: typeof link['repo'] === 'string' ? link['repo'] : '',
            repoId: typeof link['repoId'] === 'number' ? link['repoId'] : null,
          }
        : null,
    ssoProtection: record['ssoProtection'] ?? null,
  };
}

function parseDeployment(entry: unknown): DogfoodVercelDeployment {
  const record = entry as Record<string, unknown>;
  const meta = typeof record['meta'] === 'object' && record['meta'] !== null ? (record['meta'] as Record<string, unknown>) : null;
  const gitSource = typeof record['gitSource'] === 'object' && record['gitSource'] !== null ? (record['gitSource'] as Record<string, unknown>) : null;
  const commitSha =
    meta !== null && typeof meta['githubCommitSha'] === 'string'
      ? meta['githubCommitSha']
      : gitSource !== null && typeof gitSource['sha'] === 'string'
        ? gitSource['sha']
        : null;
  const teamId = typeof record['accountId'] === 'string' ? record['accountId'] : typeof record['teamId'] === 'string' ? record['teamId'] : null;
  return {
    id: String(record['uid'] ?? record['id'] ?? ''),
    url: typeof record['url'] === 'string' ? record['url'] : null,
    readyState: String(record['readyState'] ?? record['state'] ?? ''),
    createdAt: typeof record['createdAt'] === 'number' ? record['createdAt'] : null,
    target: typeof record['target'] === 'string' ? record['target'] : null,
    commitSha,
    teamId,
    projectId: typeof record['projectId'] === 'string' ? record['projectId'] : null,
  };
}

/** Construct the dogfood Vercel REST client (the real deployment seam, dogfood-scoped). */
export function createDogfoodVercelClient(options: DogfoodVercelClientOptions): DogfoodVercelClient {
  return new DogfoodVercelClient(options);
}
