/**
 * The REAL Neon management API client (Work Order P17-A) — provisioning
 * over `https://api.neon.tech/api/v2` with the management API key:
 * whoami, project list/create, branch list/create, database
 * list/create, endpoint list and the pooled connection-string reader.
 *
 * REAL, and honest about it:
 *   - every request goes to the REAL Neon management API (base URL
 *     injectable for probes/tests);
 *   - the Authorization header is INJECTED from the credential the
 *     CALLER supplies (this client never reads the ambient environment);
 *   - the pooled connection string is a SECRET: it flows to the caller
 *     (who injects it into the SQL client) and NEVER into transcripts,
 *     outcomes or evidence — the DATABASE_URL env NAME is the only
 *     reference (the P3 connection plan: "variable NAMES only");
 *   - request/response bodies NEVER log the credential (the transcript
 *     recorder redacts through the lane corpus).
 *
 * Protocol source: the Neon API v2 documentation (api.neon.tech/api/v2;
 * Authorization: Bearer <api key>). Deterministic tests script the seam;
 * the real integration suite records the REAL probe outcome — including
 * honest failures (a DNS/network failure is UNAVAILABLE evidence, never
 * a fabricated success).
 */

import { TransportError, jsonBody, parseJsonBody } from './http.js';
import type { FetchPort, HttpRequest, HttpResponse } from './http.js';
import { NEON_DEFAULT_REGION } from './infra-vocabulary.js';
import type { NeonRegion } from './infra-vocabulary.js';

/** The real Neon management API base URL. */
export const NEON_API_BASE_URL = 'https://api.neon.tech/api/v2';

/** A typed call into the Neon management API. */
export interface NeonApiCall {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  /** JSON body, or null for GET/empty calls. */
  readonly body: unknown;
}

/** A recorded Neon management round-trip (method + path + status — never the credential, never the body). */
export interface RecordedNeonApiRequest {
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

/** The identity the API key resolves to (probe evidence). */
export interface NeonWhoAmI {
  readonly login: string;
  readonly email: string | null;
  readonly branches_limit: number | null;
  readonly projects_limit: number | null;
}

/** A Neon project (public identity — ids, region, postgres version; never credentials). */
export interface NeonProjectIdentity {
  readonly id: string;
  readonly name: string;
  readonly region_id: string;
  readonly pg_version: number;
  readonly created_at: string;
  readonly default_endpoint_id: string | null;
  readonly default_branch_id: string | null;
}

/** A Neon branch (public identity). */
export interface NeonBranchIdentity {
  readonly id: string;
  readonly name: string;
  readonly parent_id: string | null;
  readonly created_at: string;
  readonly default: boolean;
}

/** A Neon database (public identity). */
export interface NeonDatabaseIdentity {
  readonly id: string;
  readonly name: string;
  readonly owner_name: string;
  readonly created_at: string;
}

/** A Neon compute endpoint (public identity — the host feeds connection strings). */
export interface NeonEndpointIdentity {
  readonly id: string;
  readonly host: string;
  readonly type: string;
  readonly region_id: string;
  readonly branch_id: string | null;
  readonly pooler_enabled: boolean;
}

/** The honest resolution of a pooled connection string (SECRET — the value flows onward, never into evidence). */
export interface NeonConnectionResolution {
  /** The pooled connection string VALUE (secret; injected into the SQL client, never echoed). */
  readonly connectionString: string;
  /** The database name extracted from the URL (public identity). */
  readonly databaseName: string | undefined;
  /** The host of the URL (public identity). */
  readonly host: string | undefined;
}

export interface NeonAdminClientOptions {
  /** The management API key VALUE (injected by the caller from the environment at the composition boundary). */
  readonly apiKey: string;
  /** The injectable network seam. The ONLY place this client touches the network. */
  readonly fetch: FetchPort;
  /** The API base URL (default: the real Neon management API). */
  readonly baseUrl?: string;
  /** Per-request timeout hint for the bound seam (informational; enforced by the seam). */
  readonly timeoutMs?: number;
}

/**
 * The fetch-backed Neon management API client. Deterministic when a
 * scripted FetchPort is injected; real only when the global-fetch port
 * is attached in the integration suite.
 */
export class NeonAdminClient {
  private readonly apiKey: string;
  private readonly fetch: FetchPort;
  private readonly baseUrl: string;
  private readonly recorded: RecordedNeonApiRequest[] = [];

  constructor(options: NeonAdminClientOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new Error('NeonAdminClient requires an options object');
    }
    if (typeof options.apiKey !== 'string' || options.apiKey.length === 0) {
      throw new Error('NeonAdminClient requires a non-empty api key (fail closed — never an empty credential)');
    }
    this.apiKey = options.apiKey;
    this.fetch = options.fetch;
    this.baseUrl = (options.baseUrl ?? NEON_API_BASE_URL).replace(/\/+$/, '');
  }

  /** The recorded request log (method + path + status; never bodies, never credentials). */
  recordedRequests(): readonly RecordedNeonApiRequest[] {
    return this.recorded.map((entry) => ({ ...entry }));
  }

  /** Dispatch one typed management-API call. Throws TransportError on transport failure; returns {status, body}. */
  async call(call: NeonApiCall): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      // The credential is injected here and ONLY here — never logged,
      // never echoed into outcomes, notes, telemetry or evidence.
      authorization: `Bearer ${this.apiKey}`,
    };
    const hasBody = call.body !== null && call.body !== undefined;
    if (hasBody) {
      headers['content-type'] = 'application/json';
    }
    const request: HttpRequest = {
      method: call.method,
      url: `${this.baseUrl}${call.path}`,
      headers,
      body: hasBody ? jsonBody(call.body) : null,
    };
    let response: HttpResponse;
    try {
      response = await this.fetch(request);
    } catch (error) {
      // A transport failure (DNS, network, timeout) is an HONEST fact —
      // surfaced as a typed TransportError the adapters map to
      // UNAVAILABLE; never a fabricated success.
      this.recorded.push({ method: call.method, path: call.path, status: 0 });
      if (error instanceof TransportError) {
        throw error;
      }
      throw new TransportError(`neon management api transport failure: ${(error as Error).message}`);
    }
    this.recorded.push({ method: call.method, path: call.path, status: response.status });
    if (response.bytes.byteLength === 0) {
      return { status: response.status, body: null };
    }
    return { status: response.status, body: parseJsonBody(response) };
  }

  private requireOk(result: { status: number; body: unknown }, what: string): unknown {
    if (result.status < 200 || result.status >= 300) {
      const message =
        result.body !== null && typeof result.body === 'object' && 'message' in (result.body as Record<string, unknown>)
          ? String((result.body as Record<string, unknown>)['message'])
          : 'unspecified provider error';
      throw new NeonManagementError(`${what} failed with HTTP ${String(result.status)}: ${message}`);
    }
    return result.body;
  }

  /** Who does the API key belong to (the startup probe). */
  async whoami(): Promise<NeonWhoAmI> {
    const body = this.requireOk(await this.call({ method: 'GET', path: '/users/me', body: null }), 'neon whoami');
    const user = (body as Record<string, unknown>)['user'] as Record<string, unknown> | undefined;
    if (user === undefined) {
      throw new NeonManagementError('neon whoami response lacks the user object');
    }
    return {
      login: String(user['login'] ?? ''),
      email: typeof user['email'] === 'string' ? user['email'] : null,
      branches_limit: typeof user['branches_limit'] === 'number' ? user['branches_limit'] : null,
      projects_limit: typeof user['projects_limit'] === 'number' ? user['projects_limit'] : null,
    };
  }

  /** List projects (public identities only). */
  async listProjects(): Promise<NeonProjectIdentity[]> {
    const body = this.requireOk(await this.call({ method: 'GET', path: '/projects', body: null }), 'neon list projects');
    const projects = (body as Record<string, unknown>)['projects'];
    if (!Array.isArray(projects)) {
      throw new NeonManagementError('neon list projects response lacks the projects array');
    }
    return projects.map((entry) => {
      const project = entry as Record<string, unknown>;
      return {
        id: String(project['id'] ?? ''),
        name: String(project['name'] ?? ''),
        region_id: String(project['region_id'] ?? ''),
        pg_version: typeof project['pg_version'] === 'number' ? project['pg_version'] : 0,
        created_at: String(project['created_at'] ?? ''),
        default_endpoint_id: typeof project['default_endpoint_id'] === 'string' ? project['default_endpoint_id'] : null,
        default_branch_id: typeof project['default_branch_id'] === 'string' ? project['default_branch_id'] : null,
      };
    });
  }

  /** Create a project (the provisioning path). Records name/region/pg_version — never credentials. */
  async createProject(input: { name: string; regionId?: NeonRegion; pgVersion?: number }): Promise<NeonProjectIdentity> {
    const body = this.requireOk(
      await this.call({
        method: 'POST',
        path: '/projects',
        body: {
          project: {
            name: input.name,
            region_id: input.regionId ?? NEON_DEFAULT_REGION,
            ...(input.pgVersion !== undefined ? { pg_version: input.pgVersion } : {}),
          },
        },
      }),
      'neon create project',
    );
    const project = (body as Record<string, unknown>)['project'] as Record<string, unknown> | undefined;
    if (project === undefined) {
      throw new NeonManagementError('neon create project response lacks the project object');
    }
    return {
      id: String(project['id'] ?? ''),
      name: String(project['name'] ?? ''),
      region_id: String(project['region_id'] ?? ''),
      pg_version: typeof project['pg_version'] === 'number' ? project['pg_version'] : 0,
      created_at: String(project['created_at'] ?? ''),
      default_endpoint_id: typeof project['default_endpoint_id'] === 'string' ? project['default_endpoint_id'] : null,
      default_branch_id: typeof project['default_branch_id'] === 'string' ? project['default_branch_id'] : null,
    };
  }

  /** List branches of a project. */
  async listBranches(projectId: string): Promise<NeonBranchIdentity[]> {
    const body = this.requireOk(
      await this.call({ method: 'GET', path: `/projects/${projectId}/branches`, body: null }),
      'neon list branches',
    );
    const branches = (body as Record<string, unknown>)['branches'];
    if (!Array.isArray(branches)) {
      throw new NeonManagementError('neon list branches response lacks the branches array');
    }
    return branches.map((entry) => {
      const branch = entry as Record<string, unknown>;
      return {
        id: String(branch['id'] ?? ''),
        name: String(branch['name'] ?? ''),
        parent_id: typeof branch['parent_id'] === 'string' ? branch['parent_id'] : null,
        created_at: String(branch['created_at'] ?? ''),
        default: branch['default'] === true,
      };
    });
  }

  /** Create a branch (tier-named per the P3 convention). */
  async createBranch(projectId: string, input: { name: string; parentId?: string }): Promise<NeonBranchIdentity> {
    const body = this.requireOk(
      await this.call({
        method: 'POST',
        path: `/projects/${projectId}/branches`,
        body: { branch: { name: input.name, ...(input.parentId !== undefined ? { parent_id: input.parentId } : {}) } },
      }),
      'neon create branch',
    );
    const branch = (body as Record<string, unknown>)['branch'] as Record<string, unknown> | undefined;
    if (branch === undefined) {
      throw new NeonManagementError('neon create branch response lacks the branch object');
    }
    return {
      id: String(branch['id'] ?? ''),
      name: String(branch['name'] ?? ''),
      parent_id: typeof branch['parent_id'] === 'string' ? branch['parent_id'] : null,
      created_at: String(branch['created_at'] ?? ''),
      default: branch['default'] === true,
    };
  }

  /** List databases of a branch. */
  async listDatabases(projectId: string, branchId: string): Promise<NeonDatabaseIdentity[]> {
    const body = this.requireOk(
      await this.call({
        method: 'GET',
        path: `/projects/${projectId}/branches/${branchId}/databases`,
        body: null,
      }),
      'neon list databases',
    );
    const databases = (body as Record<string, unknown>)['databases'];
    if (!Array.isArray(databases)) {
      throw new NeonManagementError('neon list databases response lacks the databases array');
    }
    return databases.map((entry) => {
      const database = entry as Record<string, unknown>;
      return {
        id: String(database['id'] ?? ''),
        name: String(database['name'] ?? ''),
        owner_name: String(database['owner_name'] ?? ''),
        created_at: String(database['created_at'] ?? ''),
      };
    });
  }

  /** Create a database on a branch (tier-named per the P3 convention). */
  async createDatabase(projectId: string, branchId: string, input: { name: string; ownerName: string }): Promise<NeonDatabaseIdentity> {
    const body = this.requireOk(
      await this.call({
        method: 'POST',
        path: `/projects/${projectId}/branches/${branchId}/databases`,
        body: { database: { name: input.name, owner_name: input.ownerName } },
      }),
      'neon create database',
    );
    const database = (body as Record<string, unknown>)['database'] as Record<string, unknown> | undefined;
    if (database === undefined) {
      throw new NeonManagementError('neon create database response lacks the database object');
    }
    return {
      id: String(database['id'] ?? ''),
      name: String(database['name'] ?? ''),
      owner_name: String(database['owner_name'] ?? ''),
      created_at: String(database['created_at'] ?? ''),
    };
  }

  /** List compute endpoints of a project (hosts feed connection strings). */
  async listEndpoints(projectId: string): Promise<NeonEndpointIdentity[]> {
    const body = this.requireOk(
      await this.call({ method: 'GET', path: `/projects/${projectId}/endpoints`, body: null }),
      'neon list endpoints',
    );
    const endpoints = (body as Record<string, unknown>)['endpoints'];
    if (!Array.isArray(endpoints)) {
      throw new NeonManagementError('neon list endpoints response lacks the endpoints array');
    }
    return endpoints.map((entry) => {
      const endpoint = entry as Record<string, unknown>;
      return {
        id: String(endpoint['id'] ?? ''),
        host: String(endpoint['host'] ?? ''),
        type: String(endpoint['type'] ?? ''),
        region_id: String(endpoint['region_id'] ?? ''),
        branch_id: typeof endpoint['branch_id'] === 'string' ? endpoint['branch_id'] : null,
        pooler_enabled: endpoint['pooler_enabled'] === true,
      };
    });
  }

  /**
   * Read the pooled connection string for a branch/database (the P3
   * connection plan's documented reader). The VALUE is a secret returned
   * to the caller only; public identity (database name, host) is
   * extracted for evidence.
   */
  async pooledConnectionString(input: {
    projectId: string;
    branchId?: string;
    databaseName?: string;
  }): Promise<NeonConnectionResolution> {
    const params = new URLSearchParams();
    params.set('pooled', 'true');
    if (input.branchId !== undefined) {
      params.set('branch_id', input.branchId);
    }
    if (input.databaseName !== undefined) {
      params.set('database_name', input.databaseName);
    }
    const body = this.requireOk(
      await this.call({
        method: 'GET',
        path: `/projects/${input.projectId}/connection_uri?${params.toString()}`,
        body: null,
      }),
      'neon pooled connection string',
    );
    const record = body as Record<string, unknown>;
    const uri = typeof record['connection_uri'] === 'string' ? record['connection_uri'] : null;
    if (uri === null) {
      throw new NeonManagementError('neon connection_uri response lacks the connection_uri field');
    }
    let host: string | undefined;
    try {
      host = new URL(uri).hostname;
    } catch {
      host = undefined;
    }
    const databaseName = /\/([^/?\s]+)$/.exec(uri)?.[1];
    return { connectionString: uri, databaseName, host };
  }
}

/** A typed Neon management-API failure (mapped to honest UNAVAILABLE by the adapters). */
export class NeonManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NeonManagementError';
  }
}

/** Construct the Neon management client (the real provisioning seam). */
export function createNeonAdminClient(options: NeonAdminClientOptions): NeonAdminClient {
  return new NeonAdminClient(options);
}
