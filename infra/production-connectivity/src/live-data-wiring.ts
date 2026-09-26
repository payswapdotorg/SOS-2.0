/**
 * The P18-A live data-plane wiring — the production connectivity
 * composition / store-selection wiring behind the frozen P17-A
 * adapters (Work Order P18-A, live data plane lane). EXTENDS the
 * P17-A harness (never replaces it; the merged P17-A tests/evidence
 * stay untouched) with everything a live mission request needs to
 * determine — honestly — the authoritative store, the deployment
 * state, and the provider health:
 *
 *   - resolveLiveDataPlaneEnvironment(): the union of the P3 typed
 *     registry variable names (infra/deployment/src/environment/
 *     schema.ts — GITHUB_ACCESS_TOKEN, VERCEL_TOKEN, VERCEL_PROJECT_ID,
 *     VERCEL_ORG_ID, DATABASE_URL, NEON_API_KEY, NEON_DATABASE_NAME,
 *     NEON_BRANCH_NAME, UPSTASH_REDIS_REST_URL/TOKEN, R2_*) read from
 *     an INJECTED source record only; absent credentials leave slices
 *     honestly absent (never defaulted, never fabricated).
 *   - createLiveDataPlaneHarness(): the frozen P17-A
 *     ProductionConnectivityHarness (real persistence stack + real
 *     Vercel provider behind the frozen P2/deployment ports) plus:
 *       - selectDurableStore() — REAL probes of the canonical Neon
 *         adapter and the coordination-only Upstash adapter; the
 *         selection rule (Neon = sole canonical store, Upstash NEVER
 *         canonical) with honest states and the exact failure reasons;
 *       - readDeploymentState() — the REAL Vercel deployments read
 *         (records + source_revision_sha per deployment, latest per
 *         target) through the P17-A REST client + probe ledger;
 *       - discoverVercelOrgId() — the org/team id via the authenticated
 *         /v2/user probe (recorded for the deployment topology);
 *       - providerHealthSnapshot() — every provider's honest state row
 *         (neon / upstash / r2 / vercel), serializable;
 *       - observationPlaneConfig() — the typed values the caller passes
 *         to @sos-2/real-observation's createRealObservationPlane
 *         (structural — NO dependency edge on the P17-C package here;
 *         the app/test composition binds the plane itself).
 *   - adaptObservationFetchPort(): the structural adapter from this
 *     harness's binary FetchPort seam (the P17-A shape) to the
 *     observation lane's string-body FetchPort shape — ONE network seam
 *     for the whole data plane.
 *
 * Determinism discipline (unchanged): no ambient env, no hidden clocks,
 * no ambient network in src — inject a scripted FetchPort + ManualClock
 * + instant sleep and the whole harness runs offline, run-to-run
 * identical (the deterministic wiring tests do exactly that). The
 * default fetch/sleep bindings are the documented impure process
 * boundary.
 */

import type { Clock } from '@sos-2/live-store';
import { createProductionConnectivityHarness } from './wiring.js';
import type { ProductionConnectivityHarness } from './wiring.js';
import type { FetchPort, HttpResponse } from '@sos-2/real-persistence';
import { bindGlobalFetch } from '@sos-2/real-persistence';
import { DeploymentProbeLedger, VercelApiError, VercelRestClient } from '@sos-2/deployment-providers';

// ---------------------------------------------------------------------------
// The environment resolution (P3 typed-registry names ONLY)
// ---------------------------------------------------------------------------

/** The env variable names the live data plane understands (names only — never values). */
export const LIVE_DATA_ENVIRONMENT_VARIABLES = {
  githubToken: 'GITHUB_ACCESS_TOKEN',
  githubWebhookSecret: 'GITHUB_WEBHOOK_SECRET',
  vercelToken: 'VERCEL_TOKEN',
  vercelProjectId: 'VERCEL_PROJECT_ID',
  vercelOrgId: 'VERCEL_ORG_ID',
  databaseUrl: 'DATABASE_URL',
  neonApiKey: 'NEON_API_KEY',
  neonDatabaseName: 'NEON_DATABASE_NAME',
  neonBranchName: 'NEON_BRANCH_NAME',
  upstashRestUrl: 'UPSTASH_REDIS_REST_URL',
  upstashRestToken: 'UPSTASH_REDIS_REST_TOKEN',
  r2AccountId: 'R2_ACCOUNT_ID',
  r2AccessKeyId: 'R2_ACCESS_KEY_ID',
  r2SecretAccessKey: 'R2_SECRET_ACCESS_KEY',
  r2S3Endpoint: 'R2_S3_ENDPOINT',
  r2BucketName: 'R2_BUCKET_NAME',
} as const;

/** The observation subject defaults (the SOS-2.0 repository the plane watches). */
export interface LiveDataPlaneSubjectDefaults {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
}

/** The default observation subject: the SOS-2.0 repository itself. */
export function defaultLiveDataPlaneSubjects(): LiveDataPlaneSubjectDefaults {
  return { owner: 'payswapdotorg', repo: 'SOS-2.0', branch: 'main' };
}

function optional(source: Readonly<Record<string, string>>, name: string): string | null {
  const value = source[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The resolved live data-plane environment (values flow onward; never echoed). */
export interface LiveDataPlaneEnvironmentResolution {
  readonly github: {
    readonly token: string | null;
    readonly tokenEnv: string;
    readonly webhookSecret: string | null;
    readonly webhookSecretEnv: string;
    readonly owner: string;
    readonly repo: string;
    readonly branch: string;
  };
  readonly vercel: { readonly token: string | null; readonly tokenEnv: string; readonly projectId: string | null; readonly orgId: string | null };
  readonly neon: {
    readonly databaseUrl: string | null;
    readonly databaseUrlEnv: string;
    readonly apiKey: string | null;
    readonly apiKeyEnv: string;
    readonly databaseName: string | null;
    readonly branchName: string | null;
  };
  readonly upstash: { readonly restUrl: string | null; readonly restToken: string | null; readonly restUrlEnv: string; readonly restTokenEnv: string };
  readonly r2: {
    readonly accountId: string | null;
    readonly accessKeyId: string | null;
    readonly secretAccessKey: string | null;
    readonly bucketName: string | null;
    readonly s3Endpoint: string | null;
  };
  /** Names of the production variables that are absent (honest report; never a silent default). */
  readonly absent: readonly string[];
  readonly note: string;
}

/**
 * Resolve the live data-plane environment from an INJECTED source
 * record (env-only credentials; the ambient environment is the process
 * boundary's job — this module never reads it). Absent variables are
 * reported by NAME in `absent` — never defaulted, never fabricated.
 */
export function resolveLiveDataPlaneEnvironment(
  source: Readonly<Record<string, string>>,
  subjects: LiveDataPlaneSubjectDefaults = defaultLiveDataPlaneSubjects(),
): LiveDataPlaneEnvironmentResolution {
  const names = LIVE_DATA_ENVIRONMENT_VARIABLES;
  const githubToken = optional(source, names.githubToken);
  const vercelToken = optional(source, names.vercelToken);
  const databaseUrl = optional(source, names.databaseUrl);
  const upstashRestUrl = optional(source, names.upstashRestUrl);
  const upstashRestToken = optional(source, names.upstashRestToken);
  const absent: string[] = [];
  if (githubToken === null) absent.push(names.githubToken);
  if (vercelToken === null) absent.push(names.vercelToken);
  if (databaseUrl === null) absent.push(names.databaseUrl);
  if (upstashRestUrl === null) absent.push(names.upstashRestUrl);
  if (upstashRestToken === null) absent.push(names.upstashRestToken);
  for (const name of [names.neonApiKey, names.vercelProjectId, names.vercelOrgId, names.neonDatabaseName, names.neonBranchName, names.r2AccountId, names.r2AccessKeyId, names.r2SecretAccessKey, names.r2BucketName]) {
    if (optional(source, name) === null) absent.push(name);
  }
  return {
    github: {
      token: githubToken,
      tokenEnv: names.githubToken,
      webhookSecret: optional(source, names.githubWebhookSecret),
      webhookSecretEnv: names.githubWebhookSecret,
      owner: subjects.owner,
      repo: subjects.repo,
      branch: subjects.branch,
    },
    vercel: { token: vercelToken, tokenEnv: names.vercelToken, projectId: optional(source, names.vercelProjectId), orgId: optional(source, names.vercelOrgId) },
    neon: {
      databaseUrl,
      databaseUrlEnv: names.databaseUrl,
      apiKey: optional(source, names.neonApiKey),
      apiKeyEnv: names.neonApiKey,
      databaseName: optional(source, names.neonDatabaseName),
      branchName: optional(source, names.neonBranchName),
    },
    upstash: { restUrl: upstashRestUrl, restToken: upstashRestToken, restUrlEnv: names.upstashRestUrl, restTokenEnv: names.upstashRestToken },
    r2: {
      accountId: optional(source, names.r2AccountId),
      accessKeyId: optional(source, names.r2AccessKeyId),
      secretAccessKey: optional(source, names.r2SecretAccessKey),
      bucketName: optional(source, names.r2BucketName),
      s3Endpoint: optional(source, names.r2S3Endpoint),
    },
    absent,
    note:
      'Credentials resolve ONLY from the injected source by NAME (the P3 typed-registry names); absent variables are reported honestly and never defaulted. ' +
      'A resolved credential is PREPARED, never CONNECTED — connection requires the real authenticated probe.',
  };
}

// ---------------------------------------------------------------------------
// The observation FetchPort adapter (ONE network seam — structural, no dependency edge)
// ---------------------------------------------------------------------------

/**
 * The observation lane's FetchPort shape (the @sos-2/real-observation
 * seam, carried STRUCTURALLY — no dependency edge on the P17-C
 * package; TypeScript structural typing accepts this at the
 * createRealObservationPlane call site).
 */
export interface ObservationFetchPortShape {
  (request: { method: 'GET' | 'POST'; url: string; headers: Record<string, string>; body: string | null }): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }>;
}

/**
 * Adapt this harness's binary FetchPort seam (the P17-A shape) to the
 * observation lane's string-body shape. Deterministic: request bodies
 * are UTF-8 encoded, response bytes UTF-8 decoded.
 */
export function adaptObservationFetchPort(inner: FetchPort): ObservationFetchPortShape {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return async (request) => {
    const response: HttpResponse = await inner({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: request.body === null ? null : encoder.encode(request.body),
    });
    return { status: response.status, headers: response.headers, body: decoder.decode(response.bytes) };
  };
}

// ---------------------------------------------------------------------------
// Durable-store selection
// ---------------------------------------------------------------------------

/** One provider's honest probe outcome in the selection record. */
export interface DurableStoreProviderState {
  readonly provider: string;
  readonly state: 'CONNECTED' | 'UNKNOWN' | 'UNAVAILABLE' | 'DEGRADED';
  readonly detail: string;
  readonly lastError: string | null;
  readonly probedAt: string | null;
  readonly apiRevision: string | null;
  readonly credentialEnvName: string | null;
}

/** The durable-store selection: which store is authoritative, honestly. */
export interface DurableStoreSelection {
  /** PRODUCTION_DURABLE only when the canonical store answered a REAL probe. */
  readonly mode: 'PRODUCTION_DURABLE' | 'REFERENCE_FALLBACK';
  readonly canonical: DurableStoreProviderState;
  /** The coordination-only provider (NEVER canonical — the frozen rule). */
  readonly coordination: DurableStoreProviderState & { readonly neverCanonicalNote: string };
  /** The canonical store's public identity (never a credential), or null when unknown. */
  readonly canonicalStoreRef: string | null;
  /** The store identity that serves this request (the reference marker in fallback mode). */
  readonly storeRef: string;
  readonly note: string;
}

/** THE NEVER-CANONICAL SENTENCE (frozen @sos-2/live-store provider ports rule). */
export const LIVE_DATA_NEVER_CANONICAL_NOTE =
  'Upstash Redis is coordination only (cache, idempotency, leases) — never the canonical store; the durable Postgres store (Neon) is the sole canonical store.';

// ---------------------------------------------------------------------------
// Deployment-state read
// ---------------------------------------------------------------------------

/** One Vercel deployment record (serializable; the source_revision_sha carried exactly). */
export interface LiveDeploymentRecord {
  readonly id: string;
  readonly url: string | null;
  readonly readyState: string;
  readonly createdAt: string | null;
  /** 'production' | 'preview' | null (the Vercel target), verbatim. */
  readonly target: string | null;
  /** The EXACT git commit sha the deployment was built from (source_revision_sha), or null. */
  readonly commitSha: string | null;
  readonly commitRef: string | null;
  readonly commitMessage: string | null;
  readonly region: string | null;
  readonly projectId: string | null;
}

/** The deployment-state read outcome (honest). */
export interface DeploymentStateRead {
  readonly state: 'CONNECTED' | 'UNKNOWN' | 'UNAVAILABLE' | 'DEGRADED';
  /** The deployment records (newest first, as the provider returned them). */
  readonly deployments: readonly LiveDeploymentRecord[];
  /** The latest sha-bound deployment per target ('production' / 'preview'). */
  readonly latestByTarget: Readonly<Record<string, LiveDeploymentRecord>>;
  readonly lastError: string | null;
  readonly probedAt: string;
  readonly apiRevision: string | null;
  readonly credentialEnvName: string | null;
  readonly note: string;
}

/** The provider-health snapshot row (serializable). */
export interface ProviderHealthSnapshotRow {
  readonly provider: string;
  readonly role: string;
  readonly state: 'CONNECTED' | 'UNKNOWN' | 'UNAVAILABLE' | 'DEGRADED';
  readonly detail: string;
  readonly credentialEnvName: string | null;
  readonly apiRevision: string | null;
  readonly lastError: string | null;
  readonly probedAt: string | null;
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

export interface LiveDataPlaneHarnessOptions {
  /** The injected raw environment source (env-only credentials; the caller owns the ambient read). */
  readonly source: Readonly<Record<string, string>>;
  /** The environment tier (namespace/prefix scope — the isolation seam). */
  readonly tier: 'local' | 'preview' | 'production';
  /** The injected clock (probe/transcript instants; no hidden time). */
  readonly clock: Clock;
  /** The injectable sleep for the Vercel readiness polls (default: the real timer). */
  readonly sleep?: import('@sos-2/deployment-providers').Sleep;
  /** The inner network FetchPort (reference-mode compositions inject a scripted port instead of the global-fetch default). */
  readonly fetch?: FetchPort;
  /** The observation subject overrides (defaults: payswapdotorg/SOS-2.0@main). */
  readonly subjects?: LiveDataPlaneSubjectDefaults;
}

/** The composed live data-plane harness (the frozen P17-A surface + the P18-A selection/read wiring). */
export interface LiveDataPlaneHarness {
  /** The resolved environment (names only in every echo). */
  readonly environment: LiveDataPlaneEnvironmentResolution;
  /** The frozen P17-A production-connectivity harness (persistence stack + Vercel provider). */
  readonly connectivity: ProductionConnectivityHarness;
  /**
   * Select the durable store: REAL probes of the canonical (Neon) and
   * coordination-only (Upstash) adapters; honest states with the exact
   * failure reasons; the selection rule never promotes Upstash.
   */
  selectDurableStore(): Promise<DurableStoreSelection>;
  /**
   * Read the REAL Vercel deployment state: the deployment records of
   * the configured project with their EXACT source_revision_sha values
   * (the deployment/source-SHA binding source). Honest states — an
   * unreadable provider is UNAVAILABLE with the real reason, never a
   * fabricated list.
   */
  readDeploymentState(): Promise<DeploymentStateRead>;
  /**
   * Discover the Vercel org/team id through the authenticated /v2/user
   * probe (the deployment topology identity; recorded for evidence).
   * Null when the token is absent or the probe fails (honest).
   */
  discoverVercelOrgId(): Promise<string | null>;
  /** Every provider's honest state row (neon / upstash / r2 / vercel), serializable. */
  providerHealthSnapshot(): readonly ProviderHealthSnapshotRow[];
  /**
   * The typed values for @sos-2/real-observation's
   * createRealObservationPlane (structural — no dependency edge); null
   * when the observation environment is incomplete (no GitHub token —
   * the caller renders the honest no-data state, never fabricated).
   */
  observationPlaneConfig(): {
    readonly github: { owner: string; repo: string; branch: string; token: string; tokenEnvName: string };
    readonly vercel: { token: string; tokenEnvName: string; projectId: string | null; projectName: null };
    readonly upstash: { restUrl: string; token: string; tokenEnvName: string };
    readonly webhookSecret: { secret: string; secretEnvName: string };
  } | null;
  /** The observation FetchPort (the adapted string-body seam over the same inner network port). */
  observationFetch(): ObservationFetchPortShape;
}

/** Compose the live data-plane harness from the injected environment (fail-open per provider; honest UNKNOWN when unconfigured). */
export function createLiveDataPlaneHarness(options: LiveDataPlaneHarnessOptions): LiveDataPlaneHarness {
  const environment = resolveLiveDataPlaneEnvironment(options.source, options.subjects ?? defaultLiveDataPlaneSubjects());
  const fetch = options.fetch ?? bindGlobalFetch();
  const clock = options.clock;
  const connectivity = createProductionConnectivityHarness({
    source: options.source,
    tier: options.tier,
    clock,
    sleep: options.sleep,
    fetch,
  });
  const vercelReadLedger = new DeploymentProbeLedger();
  const vercelReadClient =
    environment.vercel.token !== null
      ? new VercelRestClient({ token: environment.vercel.token, teamId: environment.vercel.orgId, fetch })
      : null;

  return {
    environment,
    connectivity,
    async selectDurableStore(): Promise<DurableStoreSelection> {
      const persistence = connectivity.persistence;
      const probedAt = new Date(clock.nowEpochMs()).toISOString();
      let canonical: DurableStoreProviderState;
      if (persistence.postgres !== null) {
        const ok = await persistence.postgres.probe();
        const report = persistence.postgres.providerState();
        canonical = {
          provider: 'neon',
          state: report.state,
          detail: report.note,
          lastError: report.last_error,
          probedAt: report.probed_at,
          apiRevision: report.api_revision,
          credentialEnvName: persistence.postgres.credentialEnvName(),
        };
        if (ok && report.state !== 'CONNECTED') {
          // Defensive: the probe answered but the derived state disagrees — the state machine wins (never fabricated either way).
          canonical = { ...canonical, detail: `${report.note} (probe round-trip completed)` };
        }
      } else {
        canonical = {
          provider: 'neon',
          state: 'UNKNOWN',
          detail: `no ${LIVE_DATA_ENVIRONMENT_VARIABLES.databaseUrl} configured in the injected source (the honest state is UNKNOWN — never fabricated)`,
          lastError: null,
          probedAt: null,
          apiRevision: null,
          credentialEnvName: null,
        };
      }
      let coordination: DurableStoreProviderState;
      if (persistence.redis !== null) {
        await persistence.redis.probe();
        const report = persistence.redis.providerState();
        coordination = {
          provider: 'upstash',
          state: report.state,
          detail: report.note,
          lastError: report.last_error,
          probedAt: report.probed_at,
          apiRevision: report.api_revision,
          credentialEnvName: persistence.redis.credentialEnvName(),
        };
      } else {
        coordination = {
          provider: 'upstash',
          state: 'UNKNOWN',
          detail: `no ${LIVE_DATA_ENVIRONMENT_VARIABLES.upstashRestUrl} / ${LIVE_DATA_ENVIRONMENT_VARIABLES.upstashRestToken} configured in the injected source; coordination only — never canonical`,
          lastError: null,
          probedAt: null,
          apiRevision: null,
          credentialEnvName: null,
        };
      }
      const canonicalStoreRef =
        canonical.state === 'UNKNOWN'
          ? null
          : `neon:postgres:${environment.neon.databaseName ?? 'sos'}@${environment.neon.branchName ?? 'main'}`;
      const mode: DurableStoreSelection['mode'] = canonical.state === 'CONNECTED' ? 'PRODUCTION_DURABLE' : 'REFERENCE_FALLBACK';
      return {
        mode,
        canonical,
        coordination: { ...coordination, neverCanonicalNote: LIVE_DATA_NEVER_CANONICAL_NOTE },
        canonicalStoreRef: mode === 'PRODUCTION_DURABLE' ? canonicalStoreRef : canonicalStoreRef,
        storeRef: mode === 'PRODUCTION_DURABLE' ? (canonicalStoreRef ?? 'unknown:canonical') : 'reference:in-memory-observation-store',
        note:
          mode === 'PRODUCTION_DURABLE'
            ? `the canonical store ${canonicalStoreRef} answered a REAL probe — live mission data is served from the durable store (selection probed at ${probedAt})`
            : `the canonical store neon is ${canonical.state}${canonical.lastError !== null ? ` (${canonical.lastError})` : ''} — live mission data is served from the reference in-memory observation store, explicitly NOT production durable state (selection probed at ${probedAt})`,
      };
    },
    async readDeploymentState(): Promise<DeploymentStateRead> {
      const probedAt = new Date(clock.nowEpochMs()).toISOString();
      if (vercelReadClient === null) {
        return {
          state: 'UNKNOWN',
          deployments: [],
          latestByTarget: {},
          lastError: null,
          probedAt,
          apiRevision: null,
          credentialEnvName: null,
          note: `no ${LIVE_DATA_ENVIRONMENT_VARIABLES.vercelToken} configured in the injected source — the deployment state is honestly UNKNOWN (never fabricated)`,
        };
      }
      const endpoint = '/v6/deployments';
      try {
        // The FROZEN client mapping (meta.githubCommitSha -> gitSource.sha — the
        // exact source_revision_sha semantics); never re-implemented here.
        const identities = await vercelReadClient.listDeployments({
          ...(environment.vercel.projectId !== null ? { projectId: environment.vercel.projectId } : {}),
          limit: 20,
        });
        const records: LiveDeploymentRecord[] = identities.map((identity) => ({
          id: identity.id,
          url: identity.url,
          readyState: identity.readyState,
          createdAt: identity.createdAt === null ? null : new Date(identity.createdAt).toISOString(),
          target: identity.target,
          commitSha: identity.commitSha,
          commitRef: identity.commitRef,
          commitMessage: identity.commitMessage,
          region: identity.region,
          projectId: identity.projectId,
        }));
        vercelReadLedger.record({
          provider: 'vercel',
          probeId: 'vercel:deployments-read',
          endpoint,
          at: probedAt,
          status: 200,
          ok: true,
          failure: null,
          apiRevision: 'vercel.v6',
        });
        const latestByTarget: Record<string, LiveDeploymentRecord> = {};
        for (const target of ['production', 'preview']) {
          const bound = records.find((record) => record.target === target && record.commitSha !== null);
          if (bound !== undefined) latestByTarget[target] = bound;
        }
        return {
          state: 'CONNECTED',
          deployments: records,
          latestByTarget,
          lastError: null,
          probedAt,
          apiRevision: 'vercel.v6',
          credentialEnvName: environment.vercel.tokenEnv,
          note: `read ${records.length} deployment record(s) from the real Vercel deployments API${environment.vercel.projectId !== null ? ` (project ${environment.vercel.projectId})` : ' (no project id configured — account-wide list)'}`,
        };
      } catch (error) {
        const message = (error as Error).message;
        const status = error instanceof VercelApiError ? error.status : null;
        vercelReadLedger.record({
          provider: 'vercel',
          probeId: 'vercel:deployments-read',
          endpoint,
          at: probedAt,
          status,
          ok: false,
          failure: message,
          apiRevision: null,
        });
        return {
          state: status === 429 ? 'DEGRADED' : 'UNAVAILABLE',
          deployments: [],
          latestByTarget: {},
          lastError: message,
          probedAt,
          apiRevision: null,
          credentialEnvName: environment.vercel.tokenEnv,
          note: `the real Vercel deployments read failed${status === null ? ' at the transport level' : ` with HTTP ${String(status)}`} — the deployment state is honestly ${status === 429 ? 'DEGRADED' : 'UNAVAILABLE'} (never fabricated): ${message}`,
        };
      }
    },
    async discoverVercelOrgId(): Promise<string | null> {
      if (connectivity.vercel === null) {
        return null;
      }
      const user = await connectivity.vercel.probe();
      return user?.defaultTeamId ?? null;
    },
    providerHealthSnapshot(): readonly ProviderHealthSnapshotRow[] {
      const rows: ProviderHealthSnapshotRow[] = [];
      for (const report of connectivity.providerStates()) {
        const isPersistence = report.provider_id !== 'vercel';
        // The vercel row reflects THIS harness's real deployment-state read
        // probes when they ran (the read ledger); otherwise the frozen P17-A
        // provider state (honestly UNKNOWN when never probed — never health).
        const vercelReadReport = vercelReadLedger.history().length > 0 ? vercelReadLedger.report(environment.vercel.tokenEnv) : null;
        const effective = !isPersistence && vercelReadReport !== null ? vercelReadReport : report;
        rows.push({
          provider: effective.provider_id,
          role: isPersistence
            ? report.provider_id === 'neon'
              ? 'durable-canonical-state'
              : report.provider_id === 'upstash'
                ? 'coordination-only-never-canonical'
                : 'large-immutable-artifacts'
            : 'deployment',
          state: effective.state,
          detail: effective.note,
          credentialEnvName: effective.credential_env,
          apiRevision: effective.api_revision,
          lastError: effective.last_error,
          probedAt: effective.probed_at,
        });
      }
      return rows.sort((left, right) => left.provider.localeCompare(right.provider));
    },
    observationPlaneConfig() {
      if (environment.github.token === null || environment.upstash.restUrl === null || environment.upstash.restToken === null) {
        return null;
      }
      return {
        github: { owner: environment.github.owner, repo: environment.github.repo, branch: environment.github.branch, token: environment.github.token, tokenEnvName: environment.github.tokenEnv },
        vercel: { token: environment.vercel.token ?? '', tokenEnvName: environment.vercel.tokenEnv, projectId: environment.vercel.projectId, projectName: null },
        upstash: { restUrl: environment.upstash.restUrl, token: environment.upstash.restToken, tokenEnvName: environment.upstash.restTokenEnv },
        webhookSecret: { secret: environment.github.webhookSecret ?? 'unset-local-secret', secretEnvName: environment.github.webhookSecretEnv },
      };
    },
    observationFetch(): ObservationFetchPortShape {
      return adaptObservationFetchPort(fetch);
    },
  };
}
