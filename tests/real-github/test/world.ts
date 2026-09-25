/**
 * The deterministic world of the real-github connectivity suite (Work
 * Order P17-B): a scripted GitHubRequestPort and a scripted fetch —
 * NO network, fixed order, run-to-run identical. The REAL provider
 * logic (request mapping, response mapping, error mapping, provider
 * states) is exercised through these seams exactly the way the
 * integration suite exercises them through the real fetch.
 */

import type {
  GitHubProviderRequest,
  GitHubProviderResponse,
  GitHubRequestPort,
} from '@sos-2/real-github';
import { createRealGitHubProvider } from '@sos-2/real-github';
import type { RealGitHubProvider } from '@sos-2/real-github';

/** One scripted response (consumed in fixed order). */
export interface ScriptedEntry {
  readonly status: number;
  readonly body: unknown;
  /** Optional rate-limit header data the scripted port reports. */
  readonly rateLimit?: { readonly limit: number; readonly remaining: number; readonly used: number; readonly reset: number };
  /** Optional OAuth-scopes header data the scripted port reports. */
  readonly oauthScopes?: readonly string[];
  /** Optional API-revision header data the scripted port reports. */
  readonly apiRevision?: string;
}

/** The scripted request port — deterministic, offline, ordered. */
export class ScriptedGitHubRequestPort implements GitHubRequestPort {
  readonly requests: GitHubProviderRequest<unknown>[] = [];
  private readonly queue: ScriptedEntry[];

  constructor(entries: readonly ScriptedEntry[]) {
    this.queue = [...entries];
  }

  /** The recorded requests (audit — never carries credentials). */
  recorded(): readonly GitHubProviderRequest<unknown>[] {
    return this.requests.map((request) => ({
      method: request.method,
      path: request.path,
      query: request.query,
      body: request.body,
      headers: { ...request.headers },
    }));
  }

  async request<TBody, TResult>(request: GitHubProviderRequest<TBody>): Promise<GitHubProviderResponse<TResult>> {
    this.requests.push(request as GitHubProviderRequest<unknown>);
    const entry = this.queue.shift();
    if (entry === undefined) {
      return { status: 500, body: ({ message: 'the scripted port is exhausted — a deterministic defect in the test fixture' } as unknown) as TResult };
    }
    this.consumed.push(entry);
    return { status: entry.status, body: (entry.body as TResult | null) ?? null };
  }

  /** The honest telemetry of the scripted port (mirrors FetchGitHubRequestPort's shape). */
  telemetry(): {
    rateLimit: { resource: string; limit: number; remaining: number; used: number; reset_epoch_s: number } | null;
    oauthScopes: string[] | null;
    apiRevision: string | null;
  } {
    let rateLimit: { resource: string; limit: number; remaining: number; used: number; reset_epoch_s: number } | null = null;
    let oauthScopes: string[] | null = null;
    let apiRevision: string | null = null;
    for (const entry of this.consumed) {
      if (entry.rateLimit !== undefined) {
        rateLimit = { resource: 'core', ...entry.rateLimit, reset_epoch_s: entry.rateLimit.reset };
      }
      if (entry.oauthScopes !== undefined) {
        oauthScopes = [...entry.oauthScopes];
      }
      if (entry.apiRevision !== undefined) {
        apiRevision = entry.apiRevision;
      }
    }
    return { rateLimit, oauthScopes, apiRevision };
  }

  private readonly consumed: ScriptedEntry[] = [];
}

/** Construct the real provider over a scripted port (the deterministic composition). */
export function scriptedProvider(
  entries: readonly ScriptedEntry[],
  options: { oauth?: { clientId: string; redirectUri?: string } | null; credentialEnv?: string | null } = {},
): { provider: RealGitHubProvider; port: ScriptedGitHubRequestPort } {
  const port = new ScriptedGitHubRequestPort(entries);
  const provider = createRealGitHubProvider({
    requestPort: port as unknown as GitHubRequestPort,
    credentialEnv: options.credentialEnv ?? 'PAYSWAP_GITHUB_TOKEN',
    oauth: options.oauth ?? null,
  });
  return { provider, port };
}

// ---------------------------------------------------------------------------
// The scripted FETCH (deterministic transport-level tests — the real
// FetchGitHubRequestPort driven offline through an injected fetchImpl)
// ---------------------------------------------------------------------------

/** One scripted fetch response. */
export interface ScriptedFetchEntry {
  readonly status: number;
  readonly body: string;
  readonly headers?: Record<string, string>;
}

/** The recorded outgoing fetch request (the URL, method and headers — for mapping assertions). */
export interface RecordedFetchRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

/** The deterministic scripted fetch implementation. */
export class ScriptedFetch {
  readonly requests: RecordedFetchRequest[] = [];
  private readonly queue: ScriptedFetchEntry[];

  constructor(entries: readonly ScriptedFetchEntry[]) {
    this.queue = [...entries];
  }

  asFetchImpl(): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      this.requests.push({
        url,
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      const entry = this.queue.shift();
      if (entry === undefined) {
        return responseOf(500, 'the scripted fetch is exhausted — a deterministic defect in the test fixture', {});
      }
      return responseOf(entry.status, entry.body, entry.headers ?? {});
    }) as unknown as typeof fetch;
  }
}

function responseOf(status: number, body: string, headers: Record<string, string>): Response {
  return new Response(body.length > 0 ? body : null, { status, headers });
}

/** The P4 github module surface this suite pins against (runtime-typed). */
export interface P4GithubModule {
  readonly GITHUB_CAPABILITIES: readonly string[];
  readonly GITHUB_CONNECTION_SCOPES: readonly string[];
  readonly GITHUB_CONNECTION_STATUSES: readonly string[];
  readonly GITHUB_ONBOARDING_READ_SCOPES: readonly string[];
  readonly GITHUB_ONBOARDING_WRITE_SCOPES: readonly string[];
  readonly GITHUB_REFERENCE_PROVIDER_ID: string;
  readonly GITHUB_TRANSPORT_PROVIDER_ID: string;
  createInMemoryGitHubProvider(): unknown;
  repositorySlug(id: { owner: string; name: string }): string;
  parseRepositorySlug(slug: string): { owner: string; name: string };
  buildCapabilitySurface(input: { provider_id: string; supported: readonly string[]; note: string }): unknown;
}
