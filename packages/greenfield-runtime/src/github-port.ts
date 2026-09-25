/**
 * THE JOURNEY'S GITHUB CONNECTION PORT (Work Order P13).
 *
 * The P4 @sos-2/github package is deliberately ENTRY-POINT-LESS (zero
 * dependencies, source-consumed by its own suites through relative
 * bindings — the P3/P4 lockfile-byte-identity precedent), so a compiled
 * package cannot import it. This module mirrors the P4 vocabulary the
 * journey consumes — the SAME shape discipline @sos-2/web-contracts'
 * onboarding layer applies ("mirrors field-for-field; the spine and the
 * provider package own the vocabulary") — and the composition root
 * binds the REAL P4 reference provider (InMemoryGitHubProvider) to it
 * structurally: the provider satisfies every member of this port
 * without adaptation code, so the journey drives the genuine P4
 * surface (connection handshake, discovery, empty-repository
 * detection, snapshot import) through the genuine implementation.
 */

/** Provider-neutral repository coordinates (the P4 RepositoryId shape). */
export interface JourneyRepositoryId {
  readonly owner: string;
  readonly name: string;
}

/** The imported revision link (the P4 ImportedRevision shape). */
export interface JourneyImportedRevision {
  readonly repository: JourneyRepositoryId;
  readonly branch: string;
  readonly revision: { readonly kind: 'git-sha'; readonly value: string };
}

/** A discovered repository summary (the P4 RepositorySummary shape — the fields the journey reads). */
export interface JourneyRepositorySummary {
  readonly id: JourneyRepositoryId;
  readonly default_branch: string | null;
  /** True when the repository has no commits (empty-repository detection). */
  readonly is_empty: boolean;
}

/** A captured repository snapshot (the P4 RepositorySnapshot shape — the fields the journey reads). */
export interface JourneyRepositorySnapshot {
  readonly repository: JourneyRepositoryId;
  readonly is_empty: boolean;
}

/** The ref selection of a snapshot capture (the P4 SnapshotRefSelection shape). */
export interface JourneySnapshotRefSelection {
  readonly branch?: string;
  readonly sha?: string;
}

/** The connection state (the P4 GitHubConnectionState shape — the fields the journey reads). */
export interface JourneyGitHubConnectionState {
  readonly status: string;
  /** True when this state comes from a simulated/reference provider (never a real connection). */
  readonly simulated: boolean;
}

/** The typed operation outcome (the P4 GitHubOperationOutcome shape). */
export type JourneyGitHubOutcome<T> =
  | { readonly status: 'OK'; readonly result: T }
  | { readonly status: 'UNSUPPORTED'; readonly reason: string };

/**
 * THE JOURNEY'S GITHUB CONNECTION PORT — the P4 GitHubPort members the
 * §11 journey's "connect GitHub repo" stage consumes. The P4 reference
 * provider binds to it structurally at the composition root.
 */
export interface JourneyGitHubPort {
  /** The current connection state (honestly NOT_YET_CONNECTED until a handshake completes). */
  connection(): JourneyGitHubConnectionState;

  /** Begin the least-privilege connection handshake. */
  beginConnection(input: { readonly scopes: readonly string[]; readonly state_token: string }): { readonly authorization_ref: string };

  /** Complete the handshake (CONNECTED or a typed REFUSED). */
  completeConnection(input: {
    readonly authorization_ref: string;
    readonly authorization_code: string;
    readonly completed_at: string;
  }): { readonly status: 'CONNECTED' } | { readonly status: 'REFUSED'; readonly reason: string };

  /** Discover repositories visible to the connection (empty detection included). */
  discoverRepositories(): Promise<JourneyGitHubOutcome<readonly JourneyRepositorySummary[]>>;

  /** Capture the snapshot/metadata of one repository at an exact ref. */
  getRepositorySnapshot(
    repository: JourneyRepositoryId,
    ref: JourneySnapshotRefSelection,
    capturedAt: string,
  ): Promise<JourneyGitHubOutcome<JourneyRepositorySnapshot>>;

  /** Import a snapshot: the exact repository identity/revision link. */
  importSnapshot(snapshot: JourneyRepositorySnapshot): JourneyImportedRevision;
}

/**
 * Parse a repository slug 'owner/name' (the P4 parse rule, mirrored —
 * the same character class and shape the provider package enforces).
 */
export function parseJourneyRepositorySlug(slug: string): JourneyRepositoryId {
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
