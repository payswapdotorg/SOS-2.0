/**
 * The transport-backed GitHubPort: a thin provider implementation that
 * maps the port's READ operations onto typed requests through an
 * INJECTED GitHubRequestPort (the HTTP/request seam — Work Order P4:
 * "all behind provider-neutral interfaces with injectable HTTP/request
 * ports").
 *
 * The provider-neutral request mapping is this package's own contract
 * (paths like '/repositories' and '/repositories/{owner}/{name}/...'):
 * a real vendor-backed provider realizes the same seam against the
 * vendor API when validation credentials exist. NO network call is ever
 * made by this package — the request port is always injected, and the
 * deterministic tests inject a scripted port.
 *
 * Honest status: the transport provider reports NOT_YET_CONNECTED (the
 * real system has no validation account in this Work Order); connection
 * evidence is never fabricated. Write operations (webhook/branch/commit/
 * pull request) answer typed UNSUPPORTED on this provider until the
 * vendor-backed implementation lands.
 */

import type {
  GitHubCapabilitySurface,
  GitHubOperationOutcome,
} from './capabilities.ts';
import { buildCapabilitySurface, unsupportedOutcome } from './capabilities.ts';
import type {
  BeginGitHubConnectionInput,
  CompleteGitHubConnectionInput,
  CompleteGitHubConnectionResult,
  GitHubConnectionAuthorization,
  GitHubConnectionState,
} from './connection.ts';
import type {
  BranchRef,
  CommitFilesInput,
  CommitRef,
  CreateBranchInput,
  CreatePullRequestInput,
  GitHubAdapterDescriptor,
  GitHubPort,
  GitHubProviderRequest,
  GitHubProviderResponse,
  GitHubRequestPort,
  ImportedRevision,
  PullRequestRef,
  RegisterWebhookInput,
  RepositoryId,
  RepositorySnapshot,
  RepositorySummary,
  SnapshotRefSelection,
  WebhookRegistration,
} from './port.ts';
import { repositorySlug } from './port.ts';

/** The stable id of the transport-backed provider. */
export const GITHUB_TRANSPORT_PROVIDER_ID = 'github-transport';

/** The provider-neutral request paths (part of the seam contract). */
export const GITHUB_TRANSPORT_PATHS = {
  repositories: '/repositories',
  branches: (repository: RepositoryId) => `/repositories/${repository.owner}/${repository.name}/branches`,
  snapshot: (repository: RepositoryId) => `/repositories/${repository.owner}/${repository.name}/snapshot`,
} as const;

/** Options for the transport-backed provider. */
export interface RequestPortGitHubProviderOptions {
  /** The injected request port (the HTTP seam; always injected, never ambient). */
  requestPort: GitHubRequestPort;
  /** The honest connection state to report (defaults to NOT_YET_CONNECTED). */
  connection?: GitHubConnectionState;
}

interface TransportRepositoryBody {
  owner: string;
  name: string;
  visibility: 'public' | 'private';
  description: string | null;
  default_branch: string | null;
  is_empty: boolean;
  webhooks_supported: boolean;
  pushed_at: string | null;
}

interface TransportBranchBody {
  name: string;
  head_sha: string;
  is_protected: boolean;
}

interface TransportSnapshotBody {
  branch: string;
  sha: string;
  is_empty: boolean;
  description: string | null;
  default_branch: string | null;
  tree: { path: string; type: 'file' | 'dir'; size_bytes: number | null }[];
}

/**
 * The transport-backed GitHubPort (read path over the injected request
 * port; write path typed UNSUPPORTED until the vendor-backed
 * implementation lands).
 */
export class RequestPortGitHubProvider implements GitHubPort {
  readonly descriptor: GitHubAdapterDescriptor;
  private readonly requestPort: GitHubRequestPort;
  private readonly connectionState: GitHubConnectionState;
  private readonly capabilitySurface: GitHubCapabilitySurface;

  constructor(options: RequestPortGitHubProviderOptions) {
    this.requestPort = options.requestPort;
    this.connectionState = options.connection ?? {
      status: 'NOT_YET_CONNECTED',
      simulated: false,
      provider_id: GITHUB_TRANSPORT_PROVIDER_ID,
      granted_scopes: [],
      connected_at: null,
      note: 'The real GitHub connection is honestly NOT_YET_CONNECTED (validation account pending); this adapter never fabricates connection evidence.',
    };
    this.capabilitySurface = buildCapabilitySurface({
      provider_id: GITHUB_TRANSPORT_PROVIDER_ID,
      supported: [
        'repository-discovery',
        'branch-selection',
        'revision-selection',
        'empty-repository-detection',
        'snapshot-import',
      ],
      note: 'The transport provider realizes the read path over the injected request port; write operations answer typed UNSUPPORTED until the vendor-backed implementation lands (validation account pending).',
    });
    this.descriptor = {
      provider_id: GITHUB_TRANSPORT_PROVIDER_ID,
      adapter_contract: 'ProjectAdapter',
      note: 'Transport-backed provider-neutral adapter over an injected request port (no ambient network).',
    };
  }

  capabilities(): GitHubCapabilitySurface {
    return this.capabilitySurface;
  }

  connection(): GitHubConnectionState {
    return this.connectionState;
  }

  beginConnection(_input: BeginGitHubConnectionInput): GitHubConnectionAuthorization {
    return {
      authorization_ref: 'not-yet-issued',
      authorization_url: '',
      requested_scopes: [],
      simulated: false,
      note: 'The real authorization surface is wired when the validation GitHub account exists (the connection contract is defined; no vendor flow and no URL are fabricated here).',
    };
  }

  completeConnection(_input: CompleteGitHubConnectionInput): CompleteGitHubConnectionResult {
    return {
      status: 'REFUSED',
      reason: 'No real handshake can complete yet (validation GitHub account pending); CONNECTED is never fabricated.',
    };
  }

  async discoverRepositories(): Promise<GitHubOperationOutcome<RepositorySummary[]>> {
    const response = await this.send<null, TransportRepositoryBody[]>(
      'GET',
      GITHUB_TRANSPORT_PATHS.repositories,
      null,
    );
    if (response.status !== 200 || response.body === null) {
      return unsupportedOutcome('repository-discovery', GITHUB_TRANSPORT_PROVIDER_ID, `Discovery failed on the injected request port (status ${response.status}); the honest answer is UNSUPPORTED, never a fabricated list.`);
    }
    const result: RepositorySummary[] = response.body.map((entry) => ({
      id: { owner: entry.owner, name: entry.name },
      visibility: entry.visibility,
      description: entry.description,
      default_branch: entry.default_branch,
      is_empty: entry.is_empty,
      webhooks_supported: entry.webhooks_supported,
      pushed_at: entry.pushed_at,
    }));
    return { status: 'OK', result };
  }

  async listBranches(repository: RepositoryId): Promise<GitHubOperationOutcome<BranchRef[]>> {
    const response = await this.send<null, TransportBranchBody[]>(
      'GET',
      GITHUB_TRANSPORT_PATHS.branches(repository),
      null,
    );
    if (response.status !== 200 || response.body === null) {
      return unsupportedOutcome('branch-selection', GITHUB_TRANSPORT_PROVIDER_ID, `Branch listing failed for ${repositorySlug(repository)} (status ${response.status}); never a fabricated list.`);
    }
    const result: BranchRef[] = response.body.map((entry) => ({
      name: entry.name,
      head_sha: entry.head_sha,
      is_protected: entry.is_protected,
    }));
    return { status: 'OK', result };
  }

  async getRepositorySnapshot(
    repository: RepositoryId,
    ref: SnapshotRefSelection,
    capturedAt: string,
  ): Promise<GitHubOperationOutcome<RepositorySnapshot>> {
    const query: Record<string, string> = {};
    if (ref.branch !== undefined) {
      query['branch'] = ref.branch;
    }
    if (ref.sha !== undefined) {
      query['sha'] = ref.sha;
    }
    const response = await this.send<null, TransportSnapshotBody>(
      'GET',
      GITHUB_TRANSPORT_PATHS.snapshot(repository),
      query,
    );
    if (response.status !== 200 || response.body === null) {
      return unsupportedOutcome('snapshot-import', GITHUB_TRANSPORT_PROVIDER_ID, `Snapshot capture failed for ${repositorySlug(repository)} (status ${response.status}); never a fabricated snapshot.`);
    }
    const body = response.body;
    const snapshot: RepositorySnapshot = {
      repository,
      ref: { branch: body.branch, sha: body.sha },
      is_empty: body.is_empty,
      captured_at: capturedAt,
      tree: body.tree.map((entry) => ({ ...entry })),
      file_count: body.tree.filter((entry) => entry.type === 'file').length,
      description: body.description,
      default_branch: body.default_branch,
    };
    return { status: 'OK', result: snapshot };
  }

  importSnapshot(snapshot: RepositorySnapshot): ImportedRevision {
    if (snapshot.is_empty) {
      return { repository: snapshot.repository, branch: '', revision: { kind: 'git-sha', value: '' } };
    }
    return {
      repository: snapshot.repository,
      branch: snapshot.ref.branch,
      revision: { kind: 'git-sha', value: snapshot.ref.sha },
    };
  }

  async registerWebhook(_input: RegisterWebhookInput): Promise<GitHubOperationOutcome<WebhookRegistration>> {
    return unsupportedOutcome('webhook-registration', GITHUB_TRANSPORT_PROVIDER_ID, 'Webhook registration is not realized on the transport provider yet (validation account pending) — an explicit UNSUPPORTED, never a silent failure.');
  }

  async createBranch(_input: CreateBranchInput): Promise<GitHubOperationOutcome<BranchRef>> {
    return unsupportedOutcome('branch-creation', GITHUB_TRANSPORT_PROVIDER_ID, 'Branch creation is not realized on the transport provider yet (validation account pending) — an explicit UNSUPPORTED, never a silent failure.');
  }

  async commitFiles(_input: CommitFilesInput): Promise<GitHubOperationOutcome<CommitRef>> {
    return unsupportedOutcome('commit-operations', GITHUB_TRANSPORT_PROVIDER_ID, 'Commit operations are not realized on the transport provider yet (validation account pending) — an explicit UNSUPPORTED, never a silent failure.');
  }

  async createPullRequest(_input: CreatePullRequestInput): Promise<GitHubOperationOutcome<PullRequestRef>> {
    return unsupportedOutcome('pull-request-operations', GITHUB_TRANSPORT_PROVIDER_ID, 'Pull-request operations are not realized on the transport provider yet (validation account pending) — an explicit UNSUPPORTED, never a silent failure.');
  }

  private async send<TBody, TResult>(
    method: GitHubProviderRequest<TBody>['method'],
    path: string,
    query: Record<string, string> | null,
  ): Promise<GitHubProviderResponse<TResult>> {
    return this.requestPort.request<TBody, TResult>({
      method,
      path,
      query,
      body: null,
      headers: { accept: 'application/json' },
    });
  }
}

/** Construct the transport-backed provider over an injected request port. */
export function createRequestPortGitHubProvider(options: RequestPortGitHubProviderOptions): RequestPortGitHubProvider {
  return new RequestPortGitHubProvider(options);
}
