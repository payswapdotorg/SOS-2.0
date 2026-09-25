/**
 * THE REAL VERCEL REST SEAM (Work Order P17-A): the Vercel API client —
 * GET /v2/user (the token probe), GET /v2/teams, project
 * discovery/creation (GET /v9/projects, POST /v10/projects with the git
 * repository link + the apps/web rootDirectory per the P3 vercel
 * contract), deployments from an EXACT git ref (POST /v13/deployments
 * with gitSource {type:'github', repoId, ref:<40-hex sha>} — verified
 * against the real API: the response's gitSource.sha echoes the exact
 * commit), deployment state reads (GET /v13/deployments/{id}) and the
 * deployments list (GET /v6/deployments).
 *
 * REAL, and honest about it:
 *   - every request goes to the REAL Vercel API (api.vercel.com by
 *     default, overridable for tests);
 *   - the Authorization Bearer token is INJECTED by the caller and
 *     lives ONLY in the request header — never echoed (the transcript
 *     recorder replaces it with the VERCEL_TOKEN env NAME);
 *   - a transport failure (including DNS resolution failure) is a typed
 *     TransportError the provider maps to honest UNAVAILABLE;
 *   - 4xx/5xx bodies carry Vercel's error envelope {error:{code,message}}
 *     — surfaced verbatim in typed VercelApiError (redacted downstream).
 *
 * Determinism discipline: the fetch seam is INJECTABLE; the
 * deterministic suites script it. This file is the package's documented
 * network boundary.
 */

import { TransportError, jsonBody, parseJsonBody } from './http.js';
import type { FetchPort, HttpRequest, HttpResponse } from './http.js';

/** The real Vercel API base URL. */
export const VERCEL_API_BASE_URL = 'https://api.vercel.com';

/** A recorded Vercel REST round-trip (method + path + status — never the token, never the body). */
export interface RecordedVercelRequest {
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

/** A typed Vercel API failure (mapped to honest UNAVAILABLE by the provider). */
export class VercelApiError extends Error {
  readonly status: number | null;
  /** Vercel's error code when the body carried the {error:{code}} envelope. */
  readonly vercelErrorCode: string | null;

  constructor(message: string, status: number | null, vercelErrorCode: string | null) {
    super(message);
    this.name = 'VercelApiError';
    this.status = status;
    this.vercelErrorCode = vercelErrorCode;
  }
}

/** The authenticated user identity (probe evidence — public fields only). */
export interface VercelUserIdentity {
  readonly id: string;
  readonly username: string;
  readonly defaultTeamId: string | null;
  readonly billingPlan: string | null;
}

/** One team identity. */
export interface VercelTeamIdentity {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

/** A Vercel project identity (public fields). */
export interface VercelProjectIdentity {
  readonly id: string;
  readonly name: string;
  readonly framework: string | null;
  readonly rootDirectory: string | null;
  readonly nodeVersion: string | null;
  readonly createdAt: number | null;
  readonly gitRepository: { type: string; org: string; repo: string; repoId: number | null } | null;
}

/** A Vercel deployment identity (public fields). */
export interface VercelDeploymentIdentity {
  /** The provider-assigned deployment revision id (e.g. 'dpl_…'). */
  readonly id: string;
  readonly url: string | null;
  readonly readyState: string;
  readonly createdAt: number | null;
  readonly target: string | null;
  /** The EXACT git commit sha the deployment was built from (the binding proof). */
  readonly commitSha: string | null;
  readonly commitMessage: string | null;
  readonly commitRef: string | null;
  readonly teamId: string | null;
  readonly projectId: string | null;
  readonly region: string | null;
}

export interface VercelRestClientOptions {
  /** The token VALUE (injected by the caller from the environment at the composition boundary). */
  readonly token: string;
  /** The team id scope for every request, or null for personal-account scope. */
  readonly teamId: string | null;
  /** The injectable network seam. The ONLY place this client touches the network. */
  readonly fetch: FetchPort;
  /** The API base URL (default: the real Vercel API). */
  readonly baseUrl?: string;
  /** Per-request timeout hint for the bound seam (informational; enforced by the seam). */
  readonly timeoutMs?: number;
}

/**
 * The fetch-backed Vercel REST client. Deterministic when a scripted
 * FetchPort is injected; real only when the global-fetch port is
 * attached in the integration suite.
 */
export class VercelRestClient {
  private readonly token: string;
  private readonly teamId: string | null;
  private readonly fetch: FetchPort;
  private readonly baseUrl: string;
  private readonly recorded: RecordedVercelRequest[] = [];

  constructor(options: VercelRestClientOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new Error('VercelRestClient requires an options object');
    }
    if (typeof options.token !== 'string' || options.token.length === 0) {
      throw new Error('VercelRestClient requires a non-empty token (fail closed — never an empty credential)');
    }
    this.token = options.token;
    this.teamId = options.teamId;
    this.fetch = options.fetch;
    this.baseUrl = (options.baseUrl ?? VERCEL_API_BASE_URL).replace(/\/+$/, '');
  }

  /** The recorded request log (method + path + status; never bodies, never credentials). */
  recordedRequests(): readonly RecordedVercelRequest[] {
    return this.recorded.map((entry) => ({ ...entry }));
  }

  /** Dispatch one typed REST call. */
  async call(call: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; body?: unknown; query?: Record<string, string> }): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${call.path}`);
    if (this.teamId !== null) {
      url.searchParams.set('teamId', this.teamId);
    }
    for (const [key, value] of Object.entries(call.query ?? {})) {
      url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = {
      accept: 'application/json',
      // The credential is injected here and ONLY here — never logged,
      // never echoed into outcomes, notes, telemetry or evidence.
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
        throw new VercelApiError(`vercel api answered HTTP ${String(response.status)} with an empty body`, response.status, null);
      }
      return null;
    }
    let parsed: unknown;
    try {
      parsed = parseJsonBody(response);
    } catch (error) {
      throw new VercelApiError(
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
      throw new VercelApiError(`vercel api call failed with HTTP ${String(response.status)}: ${message}`, response.status, code);
    }
    return parsed;
  }

  /** GET /v2/user — the authenticated token probe. */
  async user(): Promise<VercelUserIdentity> {
    const body = (await this.call({ method: 'GET', path: '/v2/user' })) as Record<string, unknown>;
    const user = body['user'] as Record<string, unknown> | undefined;
    if (user === undefined) {
      throw new VercelApiError('vercel /v2/user response lacks the user object', 200, null);
    }
    return {
      id: String(user['id'] ?? ''),
      username: String(user['username'] ?? ''),
      defaultTeamId: typeof user['defaultTeamId'] === 'string' ? user['defaultTeamId'] : null,
      billingPlan:
        typeof user['billing'] === 'object' && user['billing'] !== null
          ? String((user['billing'] as Record<string, unknown>)['plan'] ?? '')
          : null,
    };
  }

  /** GET /v2/teams — team discovery. */
  async teams(): Promise<VercelTeamIdentity[]> {
    const body = (await this.call({ method: 'GET', path: '/v2/teams' })) as Record<string, unknown>;
    const teams = body['teams'];
    if (!Array.isArray(teams)) {
      throw new VercelApiError('vercel /v2/teams response lacks the teams array', 200, null);
    }
    return teams.map((entry) => {
      const team = entry as Record<string, unknown>;
      return {
        id: String(team['id'] ?? ''),
        name: String(team['name'] ?? ''),
        slug: String(team['slug'] ?? ''),
      };
    });
  }

  /** GET /v9/projects — project discovery (public fields). */
  async listProjects(): Promise<VercelProjectIdentity[]> {
    const body = (await this.call({ method: 'GET', path: '/v9/projects', query: { limit: '100' } })) as Record<string, unknown>;
    const projects = body['projects'];
    if (!Array.isArray(projects)) {
      throw new VercelApiError('vercel /v9/projects response lacks the projects array', 200, null);
    }
    return projects.map((entry) => parseProject(entry));
  }

  /** GET /v9/projects/{name} — one project, or null when absent. */
  async getProject(nameOrId: string): Promise<VercelProjectIdentity | null> {
    try {
      const body = await this.call({ method: 'GET', path: `/v9/projects/${encodeURIComponent(nameOrId)}` });
      return parseProject(body);
    } catch (error) {
      if (error instanceof VercelApiError && (error.status === 404 || error.vercelErrorCode === 'not_found')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * POST /v10/projects — create a project linked to the GitHub repository
   * with the apps/web rootDirectory and the nextjs framework preset (the
   * P3 vercel project-scope contract).
   */
  async createProject(input: { name: string; gitRepository: { org: string; repo: string }; rootDirectory: string; framework: string }): Promise<VercelProjectIdentity> {
    const body = await this.call({
      method: 'POST',
      path: '/v10/projects',
      body: {
        name: input.name,
        gitRepository: { type: 'github', repo: `${input.gitRepository.org}/${input.gitRepository.repo}` },
        rootDirectory: input.rootDirectory,
        framework: input.framework,
      },
    });
    return parseProject(body);
  }

  /**
   * POST /v13/deployments — create a REAL deployment from an EXACT git
   * ref. gitSource {type:'github', repoId, ref:<sha>} is the verified
   * real protocol (the response echoes gitSource.sha = the exact
   * commit). skipAutoDetectionConfirmation pins the framework detection
   * to the project's preset. Target semantics (verified against the
   * real API): OMIT target for a PREVIEW deployment (target 'preview'
   * is rejected by v13 — the honest protocol is absence-of-target =
   * preview); 'production' for a production deployment.
   */
  async createDeployment(input: {
    projectName: string;
    repoId: number;
    ref: string;
    /** 'production' for production deployments; omit/null for preview deployments. */
    target?: 'production' | null;
  }): Promise<VercelDeploymentIdentity> {
    const body: Record<string, unknown> = {
      name: input.projectName,
      gitSource: { type: 'github', repoId: input.repoId, ref: input.ref },
    };
    if (input.target === 'production') {
      body['target'] = 'production';
    }
    const response = await this.call({
      method: 'POST',
      path: '/v13/deployments',
      query: { skipAutoDetectionConfirmation: '1' },
      body,
    });
    return parseDeployment(response);
  }

  /**
   * PATCH /v9/projects/{name} — apply the P17-A connectivity profile to
   * the project: the monorepo dependency-closure build command (the
   * apps/web build needs the workspace packages built first — verified
   * against the real API on this lane's provisioned project) and the
   * public preview URLs (ssoProtection disabled — verified: null is
   * accepted and makes preview deployments serve without Vercel
   * Authentication).
   */
  async patchProject(nameOrId: string, patch: { buildCommand?: string; ssoProtectionDisabled?: boolean }): Promise<VercelProjectIdentity> {
    const body: Record<string, unknown> = {};
    if (patch.buildCommand !== undefined) {
      body['buildCommand'] = patch.buildCommand;
    }
    if (patch.ssoProtectionDisabled === true) {
      body['ssoProtection'] = null;
    }
    const response = await this.call({
      method: 'PATCH',
      path: `/v9/projects/${encodeURIComponent(nameOrId)}`,
      body,
    });
    return parseProject(response);
  }

  /** GET /v13/deployments/{id} — the deployment state read. */
  async getDeployment(id: string): Promise<VercelDeploymentIdentity> {
    const body = await this.call({ method: 'GET', path: `/v13/deployments/${encodeURIComponent(id)}` });
    return parseDeployment(body);
  }

  /** GET /v6/deployments — the deployments list (verification). */
  async listDeployments(query: { projectId?: string; limit?: number } = {}): Promise<VercelDeploymentIdentity[]> {
    const parameters: Record<string, string> = { limit: String(query.limit ?? 20) };
    if (query.projectId !== undefined) {
      parameters['projectId'] = query.projectId;
    }
    const body = (await this.call({ method: 'GET', path: '/v6/deployments', query: parameters })) as Record<string, unknown>;
    const deployments = body['deployments'];
    if (!Array.isArray(deployments)) {
      throw new VercelApiError('vercel /v6/deployments response lacks the deployments array', 200, null);
    }
    return deployments.map((entry) => parseDeployment(entry));
  }
}

// ---------------------------------------------------------------- parsing

function parseProject(entry: unknown): VercelProjectIdentity {
  const record = entry as Record<string, unknown>;
  const link = typeof record['link'] === 'object' && record['link'] !== null ? (record['link'] as Record<string, unknown>) : null;
  return {
    id: String(record['id'] ?? ''),
    name: String(record['name'] ?? ''),
    framework: typeof record['framework'] === 'string' ? record['framework'] : null,
    rootDirectory: typeof record['rootDirectory'] === 'string' ? record['rootDirectory'] : null,
    nodeVersion: typeof record['nodeVersion'] === 'string' ? record['nodeVersion'] : null,
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
  };
}

function parseDeployment(entry: unknown): VercelDeploymentIdentity {
  const record = entry as Record<string, unknown>;
  const meta = typeof record['meta'] === 'object' && record['meta'] !== null ? (record['meta'] as Record<string, unknown>) : null;
  const gitSource =
    typeof record['gitSource'] === 'object' && record['gitSource'] !== null ? (record['gitSource'] as Record<string, unknown>) : null;
  const commitSha =
    meta !== null && typeof meta['githubCommitSha'] === 'string'
      ? meta['githubCommitSha']
      : gitSource !== null && typeof gitSource['sha'] === 'string'
        ? gitSource['sha']
        : null;
  const teamId =
    typeof record['accountId'] === 'string'
      ? record['accountId']
      : typeof record['teamId'] === 'string'
        ? record['teamId']
        : null;
  return {
    id: String(record['uid'] ?? record['id'] ?? ''),
    url: typeof record['url'] === 'string' ? record['url'] : null,
    readyState: String(record['readyState'] ?? record['state'] ?? ''),
    createdAt: typeof record['createdAt'] === 'number' ? record['createdAt'] : null,
    target: typeof record['target'] === 'string' ? record['target'] : null,
    commitSha,
    commitMessage: meta !== null && typeof meta['githubCommitMessage'] === 'string' ? meta['githubCommitMessage'] : null,
    commitRef: meta !== null && typeof meta['githubCommitRef'] === 'string' ? meta['githubCommitRef'] : null,
    teamId,
    projectId: typeof record['projectId'] === 'string' ? record['projectId'] : null,
    region: typeof record['regions'] === 'object' && Array.isArray(record['regions']) && record['regions'].length > 0 ? String((record['regions'] as unknown[])[0]) : null,
  };
}

/** Construct the Vercel REST client (the real deployment seam). */
export function createVercelRestClient(options: VercelRestClientOptions): VercelRestClient {
  return new VercelRestClient(options);
}
