/**
 * The GitHub CONNECTION CONTRACT (Work Order P4): OAuth / GitHub-App
 * authorization with a LEAST-PRIVILEGE repository scope, expressed as a
 * provider-neutral handshake SHAPE — not a live vendor flow. No real
 * credentials, client ids or validation accounts exist in this Work
 * Order: the real-system connection state is honestly NOT_YET_CONNECTED
 * (validation GitHub account pending) and connection evidence is NEVER
 * fabricated. The in-memory reference provider SIMULATES the handshake
 * deterministically and is explicitly marked simulated.
 *
 * Scope tokens are this adapter's provider-neutral vocabulary, designed
 * to map onto least-privilege GitHub repository permissions
 * (metadata:read / contents:read / contents:write / pull_requests:write
 * / webhooks:manage) rather than the coarse classic `repo` scope.
 */

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

/**
 * The connection states. NOT_YET_CONNECTED is the honest real-system
 * state throughout this Work Order. UNAVAILABLE and UNKNOWN remain the
 * truthful provider-outage / undetermined states — they are provider
 * facts here, kept distinct from (and never conflated with) the frozen
 * evidence truth states.
 */
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

/**
 * The connection state of one backing provider. `simulated` is the
 * honesty marker (the P1 demo-marker discipline): a simulated connection
 * can never render as a real connection, and a real connection is only
 * ever claimed after a completed handshake on the backing provider.
 */
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
  /**
   * The provider's consent surface URL. For the reference provider this
   * is a clearly-simulated URL; for the real provider it is the GitHub
   * authorize/app-installation URL (wired when the validation account
   * exists — never fabricated here).
   */
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
  /**
   * A caller-supplied opaque state token the provider echoes back (the
   * CSRF-discipline field of the handshake contract; never minted here).
   */
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
