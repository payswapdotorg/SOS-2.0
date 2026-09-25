/**
 * The STRUCTURAL github vocabulary of the real adapter (Work Order
 * P17-B) — the P4 provider-neutral github contract surface carried
 * structurally, following the frozen P8 body-runtimes precedent
 * (github-vocabulary.ts): the P4 @sos-2/github package is a frozen
 * ZERO-dependency, no-build package with no module entry point, so a
 * consuming package CANNOT import it as a module. The surface is
 * therefore mirrored field-for-field here, and the alignment with the
 * REAL P4 package sources is PINNED BY TEST (tests/real-github imports
 * the real sources through non-literal dynamic imports — vitest
 * transforms them; the tsc build never sees the specifier).
 *
 * Nothing here redefines frozen semantics: the shapes, vocabularies and
 * function behaviors are the P4 contract's own, mirrored verbatim; the
 * pinning tests fail loudly on any drift in EITHER direction.
 */

// ---------------------------------------------------------------------------
// Capabilities (P4 capabilities.ts, structural mirror)
// ---------------------------------------------------------------------------

/** Every operation the GitHubPort contract can express (P4 vocabulary). */
export const GITHUB_CAPABILITIES = [
  'connection',
  'repository-discovery',
  'branch-selection',
  'revision-selection',
  'empty-repository-detection',
  'snapshot-import',
  'webhook-registration',
  'branch-creation',
  'commit-operations',
  'pull-request-operations',
] as const;

export type GitHubCapability = (typeof GITHUB_CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set<string>(GITHUB_CAPABILITIES);

/** Is this a well-formed capability of the GitHubPort contract? */
export function isGitHubCapability(value: unknown): value is GitHubCapability {
  return typeof value === 'string' && CAPABILITY_SET.has(value);
}

/** The typed capability surface of one backing provider. */
export interface GitHubCapabilitySurface {
  /** The backing provider's stable id (e.g. 'github-reference', 'github-real'). */
  provider_id: string;
  /** The capabilities this provider supports, in canonical order. */
  supported: GitHubCapability[];
  /** The capabilities this provider does NOT support, in canonical order. */
  unsupported: GitHubCapability[];
  /** One honest sentence about the surface (rendered with it). */
  note: string;
}

/** Build a validated capability surface from an arbitrary supported subset. */
export function buildCapabilitySurface(input: {
  provider_id: string;
  supported: readonly GitHubCapability[];
  note: string;
}): GitHubCapabilitySurface {
  const supportedSet = new Set<string>();
  for (const capability of input.supported) {
    if (!isGitHubCapability(capability)) {
      throw new Error(`buildCapabilitySurface: unknown capability: ${JSON.stringify(capability)}`);
    }
    if (supportedSet.has(capability)) {
      throw new Error(`buildCapabilitySurface: duplicate capability: ${capability}`);
    }
    supportedSet.add(capability);
  }
  const supported = GITHUB_CAPABILITIES.filter((capability) => supportedSet.has(capability));
  const unsupported = GITHUB_CAPABILITIES.filter((capability) => !supportedSet.has(capability));
  return {
    provider_id: input.provider_id,
    supported,
    unsupported,
    note: input.note,
  };
}

/** Does the surface support this capability? */
export function surfaceSupports(surface: GitHubCapabilitySurface, capability: GitHubCapability): boolean {
  return surface.supported.includes(capability);
}

/**
 * The typed outcome of a GitHubPort operation: OK with the result, or an
 * EXPLICIT UNSUPPORTED answer naming the missing capability and why
 * (never a silent failure; never a thrown error for an honest refusal).
 */
export type GitHubOperationOutcome<T> =
  | { status: 'OK'; result: T }
  | { status: 'UNSUPPORTED'; capability: GitHubCapability; provider_id: string; reason: string };

/** Construct the OK outcome. */
export function okOutcome<T>(result: T): GitHubOperationOutcome<T> {
  return { status: 'OK', result };
}

/** Construct the explicit UNSUPPORTED outcome. */
export function unsupportedOutcome<T>(
  capability: GitHubCapability,
  providerId: string,
  reason: string,
): GitHubOperationOutcome<T> {
  return { status: 'UNSUPPORTED', capability, provider_id: providerId, reason };
}

/** The user-facing label of a capability (presentation text, not vocabulary). */
export function capabilityLabel(capability: GitHubCapability): string {
  switch (capability) {
    case 'connection':
      return 'Connection (least-privilege repository scope)';
    case 'repository-discovery':
      return 'Repository discovery';
    case 'branch-selection':
      return 'Branch selection';
    case 'revision-selection':
      return 'Revision selection';
    case 'empty-repository-detection':
      return 'Empty-repository detection';
    case 'snapshot-import':
      return 'Snapshot / metadata import';
    case 'webhook-registration':
      return 'Webhook registration (where supported)';
    case 'branch-creation':
      return 'Branch creation';
    case 'commit-operations':
      return 'Commit operations';
    case 'pull-request-operations':
      return 'Pull-request operations';
  }
}

// ---------------------------------------------------------------------------
// Connection contract (P4 connection.ts, structural mirror)
// ---------------------------------------------------------------------------

/** The least-privilege provider-neutral repository scope tokens. */
export const GITHUB_CONNECTION_SCOPES = [
  'repository:metadata:read',
  'repository:contents:read',
  'repository:contents:write',
  'repository:pull-requests:write',
  'repository:webhooks:manage',
] as const;

export type GitHubConnectionScope = (typeof GITHUB_CONNECTION_SCOPES)[number];

const SCOPE_SET: ReadonlySet<string> = new Set<string>(GITHUB_CONNECTION_SCOPES);

/** Is this a well-formed connection scope token? */
export function isGitHubConnectionScope(value: unknown): value is GitHubConnectionScope {
  return typeof value === 'string' && SCOPE_SET.has(value);
}

/** The read-only preset used for onboarding discovery + snapshot import. */
export const GITHUB_ONBOARDING_READ_SCOPES: readonly GitHubConnectionScope[] = [
  'repository:metadata:read',
  'repository:contents:read',
];

/** The write preset for the implementation journey (branch/commit/PR). */
export const GITHUB_ONBOARDING_WRITE_SCOPES: readonly GitHubConnectionScope[] = [
  ...GITHUB_ONBOARDING_READ_SCOPES,
  'repository:contents:write',
  'repository:pull-requests:write',
];

/** The connection states (P4 vocabulary — provider facts). */
export const GITHUB_CONNECTION_STATUSES = [
  'NOT_YET_CONNECTED',
  'CONNECTED',
  'EXPIRED',
  'REVOKED',
  'UNAVAILABLE',
  'UNKNOWN',
] as const;

export type GitHubConnectionStatus = (typeof GITHUB_CONNECTION_STATUSES)[number];

const STATUS_SET: ReadonlySet<string> = new Set<string>(GITHUB_CONNECTION_STATUSES);

/** Is this a well-formed connection status? */
export function isGitHubConnectionStatus(value: unknown): value is GitHubConnectionStatus {
  return typeof value === 'string' && STATUS_SET.has(value);
}

/** The connection state of one backing provider (the honesty marker is `simulated`). */
export interface GitHubConnectionState {
  status: GitHubConnectionStatus;
  /** True when this state comes from the in-memory reference provider (never a real connection). */
  simulated: boolean;
  /** The backing provider id this state describes. */
  provider_id: string;
  /** The scopes granted by the connection (empty until a handshake completes). */
  granted_scopes: GitHubConnectionScope[];
  /** The connection instant, RFC3339 caller-supplied literal, or null while not connected. */
  connected_at: string | null;
  /** One honest sentence explaining this state (rendered with it). */
  note: string;
}

/** The authorization surface returned when a connection begins. */
export interface GitHubConnectionAuthorization {
  /** Opaque authorization reference (the provider's handshake id). */
  authorization_ref: string;
  /** The provider's consent surface URL (the real authorize URL for the real provider). */
  authorization_url: string;
  /** The scopes being requested (least-privilege preset). */
  requested_scopes: GitHubConnectionScope[];
  /** True when this authorization is simulated (reference provider). */
  simulated: boolean;
  /** One honest sentence about what happens next. */
  note: string;
}

/** Input for beginning a connection handshake. */
export interface BeginGitHubConnectionInput {
  /** The least-privilege scopes to request (validated). */
  scopes: readonly GitHubConnectionScope[];
  /** A caller-supplied opaque state token the provider echoes back (CSRF discipline). */
  state_token: string;
}

/** Input for completing a connection handshake. */
export interface CompleteGitHubConnectionInput {
  authorization_ref: string;
  /** The authorization code/reference issued by the provider consent surface. */
  authorization_code: string;
  /** The connection instant, RFC3339 caller-supplied literal (no hidden clocks). */
  completed_at: string;
}

/** The result of a completed handshake (a CONNECTED state or a typed refusal). */
export type CompleteGitHubConnectionResult =
  | { status: 'CONNECTED'; connection: GitHubConnectionState }
  | { status: 'REFUSED'; reason: string };

/** Validate a connection-state shape (throws on malformed input). */
export function assertValidGitHubConnectionState(value: unknown): asserts value is GitHubConnectionState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`connection state must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = ['status', 'simulated', 'provider_id', 'granted_scopes', 'connected_at', 'note'];
  if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) {
    throw new Error(`connection state must have the exact field set ${JSON.stringify(expected)}`);
  }
  if (!isGitHubConnectionStatus(record['status'])) {
    throw new Error(`connection status must be one of ${GITHUB_CONNECTION_STATUSES.join(', ')}`);
  }
  if (typeof record['simulated'] !== 'boolean') {
    throw new Error('connection state simulated must be a boolean');
  }
  if (typeof record['provider_id'] !== 'string' || record['provider_id'].length === 0) {
    throw new Error('connection state provider_id must be a non-empty string');
  }
  if (!Array.isArray(record['granted_scopes']) || !record['granted_scopes'].every(isGitHubConnectionScope)) {
    throw new Error(`connection granted_scopes must be an array of scope tokens (${GITHUB_CONNECTION_SCOPES.join(', ')})`);
  }
  if (record['connected_at'] !== null && typeof record['connected_at'] !== 'string') {
    throw new Error('connection connected_at must be an RFC3339 string or null');
  }
  if (typeof record['note'] !== 'string' || record['note'].length === 0) {
    throw new Error('connection note must be a non-empty string');
  }
  if (record['status'] === 'CONNECTED' && record['simulated'] !== true && record['connected_at'] === null) {
    throw new Error('a real CONNECTED state must carry its connection instant (never fabricated)');
  }
}

// ---------------------------------------------------------------------------
// The port (P4 port.ts, structural mirror)
// ---------------------------------------------------------------------------

/**
 * The injectable HTTP/request transport seam. A real provider maps each
 * GitHubPort operation onto typed requests through this port; tests
 * inject a scripted port with deterministic responses.
 */
export interface GitHubRequestPort {
  request<TBody, TResult>(
    request: GitHubProviderRequest<TBody>,
  ): Promise<GitHubProviderResponse<TResult>>;
}

/** One typed provider request (method + path + query + body + headers). */
export interface GitHubProviderRequest<TBody> {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** The provider's request path (e.g. '/repos/{owner}/{repo}/branches'). */
  path: string;
  /** Query parameters, or null. */
  query: Record<string, string> | null;
  /** The request body, or null. */
  body: TBody | null;
  /** Request headers (secret values are injected by the transport adapter, never logged). */
  headers: Record<string, string>;
}

/** One typed provider response. */
export interface GitHubProviderResponse<TResult> {
  status: number;
  body: TResult | null;
}

/** The adapter descriptor — provider-neutral (the W12 precedent). */
export interface GitHubAdapterDescriptor {
  /** The backing provider's stable id (e.g. 'github-reference', 'github-real'). */
  provider_id: string;
  /** The adapter contract this implementation realizes. */
  adapter_contract: 'ProjectAdapter';
  /** One honest sentence about the backing provider. */
  note: string;
}

/** Provider-neutral repository coordinates. */
export interface RepositoryId {
  owner: string;
  name: string;
}

/** A discovered repository summary (discovery + empty detection live here). */
export interface RepositorySummary {
  id: RepositoryId;
  visibility: 'public' | 'private';
  description: string | null;
  /** The default branch name, or null when the repository is empty. */
  default_branch: string | null;
  /** True when the repository has no commits (empty-repository detection). */
  is_empty: boolean;
  /** Whether this repository supports webhook registration. */
  webhooks_supported: boolean;
  /** Last-push instant, RFC3339 literal, or null when empty/unknown. */
  pushed_at: string | null;
}

/** A branch reference (branch selection). */
export interface BranchRef {
  name: string;
  /** The exact head commit sha of the branch (revision selection). */
  head_sha: string;
  is_protected: boolean;
}

/** A single snapshot tree entry (metadata import). */
export interface SnapshotTreeEntry {
  path: string;
  type: 'file' | 'dir';
  size_bytes: number | null;
}

/** The snapshot/metadata import result — the exact repository identity + revision. */
export interface RepositorySnapshot {
  repository: RepositoryId;
  /** The exact ref the snapshot was captured from. */
  ref: { branch: string; sha: string };
  /** Empty-repository detection carried into the snapshot. */
  is_empty: boolean;
  /** The caller-supplied capture instant (RFC3339 literal; no hidden clocks). */
  captured_at: string;
  /** Imported metadata: the file tree summary (empty for an empty repository). */
  tree: SnapshotTreeEntry[];
  /** The number of files in the tree (derived, present for the view layer). */
  file_count: number;
  /** The repository description, or null. */
  description: string | null;
  /** The default branch name, or null when empty. */
  default_branch: string | null;
}

/** The imported revision link — the exact shape the onboarding journey links into System State. */
export interface ImportedRevision {
  repository: RepositoryId;
  branch: string;
  /** The revision kind is pinned by test to @sos-2/system-state's 'git-sha'. */
  revision: { kind: 'git-sha'; value: string };
}

/** Input for registering a webhook (where supported). */
export interface RegisterWebhookInput {
  repository: RepositoryId;
  /** The webhook receiver URL. */
  url: string;
  /** The events to subscribe to (e.g. push, pull_request). */
  events: string[];
}

/** A registered webhook. */
export interface WebhookRegistration {
  webhook_id: string;
  repository: RepositoryId;
  url: string;
  events: string[];
  active: boolean;
}

/** Input for creating a branch. */
export interface CreateBranchInput {
  repository: RepositoryId;
  /** The new branch name. */
  name: string;
  /** The sha to branch from (revision selection); must exist. */
  from_sha: string;
}

/** Input for committing files to a branch. */
export interface CommitFilesInput {
  repository: RepositoryId;
  branch: string;
  message: string;
  /** The files to write (path + exact contents). */
  files: { path: string; contents: string }[];
}

/** A created commit. */
export interface CommitRef {
  repository: RepositoryId;
  branch: string;
  sha: string;
  message: string;
  /** The commit instant, RFC3339 literal (the real provider carries the provider-reported committer date). */
  committed_at: string;
}

/** Input for opening a pull request. */
export interface CreatePullRequestInput {
  repository: RepositoryId;
  title: string;
  /** The branch to merge from. */
  head_branch: string;
  /** The branch to merge into. */
  base_branch: string;
  body: string | null;
}

/** An opened pull request. */
export interface PullRequestRef {
  repository: RepositoryId;
  number: number;
  title: string;
  head_branch: string;
  base_branch: string;
  head_sha: string;
  state: 'open' | 'closed';
  url: string;
}

/** The ref selection for a snapshot capture. */
export interface SnapshotRefSelection {
  branch?: string;
  sha?: string;
}

/**
 * The provider-neutral project adapter port (P4). Implementations MUST
 * answer capabilities() honestly, return typed UNSUPPORTED outcomes for
 * unsupported operations, carry empty-repository detection through
 * discovery AND snapshots, and keep every instant caller-supplied.
 */
export interface GitHubPort {
  readonly descriptor: GitHubAdapterDescriptor;
  capabilities(): GitHubCapabilitySurface;
  connection(): GitHubConnectionState;
  beginConnection(input: BeginGitHubConnectionInput): GitHubConnectionAuthorization;
  completeConnection(input: CompleteGitHubConnectionInput): CompleteGitHubConnectionResult;
  discoverRepositories(): Promise<GitHubOperationOutcome<RepositorySummary[]>>;
  listBranches(repository: RepositoryId): Promise<GitHubOperationOutcome<BranchRef[]>>;
  getRepositorySnapshot(
    repository: RepositoryId,
    ref: SnapshotRefSelection,
    capturedAt: string,
  ): Promise<GitHubOperationOutcome<RepositorySnapshot>>;
  importSnapshot(snapshot: RepositorySnapshot): ImportedRevision;
  registerWebhook(input: RegisterWebhookInput): Promise<GitHubOperationOutcome<WebhookRegistration>>;
  createBranch(input: CreateBranchInput): Promise<GitHubOperationOutcome<BranchRef>>;
  commitFiles(input: CommitFilesInput): Promise<GitHubOperationOutcome<CommitRef>>;
  createPullRequest(input: CreatePullRequestInput): Promise<GitHubOperationOutcome<PullRequestRef>>;
}

/** Parse a provider-neutral repository slug 'owner/name' (throws on malformed input). */
export function parseRepositorySlug(slug: string): RepositoryId {
  const parts = slug.split('/');
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    throw new Error(`repository slug must be 'owner/name', received: ${JSON.stringify(slug)}`);
  }
  const [owner, name] = parts;
  if (owner.length === 0 || name.length === 0 || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error(`repository slug must be 'owner/name' with owner/name of [A-Za-z0-9_.-], received: ${JSON.stringify(slug)}`);
  }
  return { owner, name };
}

/** Render the provider-neutral repository slug 'owner/name'. */
export function repositorySlug(id: RepositoryId): string {
  return `${id.owner}/${id.name}`;
}

/** The single error class of the GitHub project adapter (P4). */
export class GitHubAdapterError extends Error {
  /** The capability involved, when the error is capability-related. */
  readonly capability: string | null;

  constructor(message: string, capability: string | null = null) {
    super(message);
    this.name = 'GitHubAdapterError';
    this.capability = capability;
  }
}
