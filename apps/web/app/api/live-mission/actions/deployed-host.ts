/**
 * THE DEPLOYED LIVE ACTION HOST (Work Order P18-B): the process-boundary
 * composition the route handler binds. This module receives an already
 * resolved config OBJECT (the route reads the ambient environment exactly
 * once — env-only, values never echoed); it never reads process.env
 * itself, so the deterministic suite composes it with scripted configs.
 *
 * Binding (all fail-closed):
 *   - AUTHORITY: env-configured grants (SOS_LIVE_MISSION_GRANTS entries
 *     'actorId|family|scope'). The AuthorityPort re-reads the CURRENT
 *     configuration on EVERY evaluation — authority is evaluated at
 *     action time; an absent, removed or mistyped grant is GRANT_NEVER_HELD
 *     and the action fails CLOSED (the executor is never invoked).
 *   - EXECUTORS: REAL provider adapters behind the sync bridge (worker
 *     thread) when credentials are configured: body.start -> OpenRouter
 *     (BODY_PROVIDER_API_KEY); promotion/rollback/deployment -> the
 *     Vercel deployment API (VERCEL_TOKEN/VERCEL_PROJECT_ID); the acted-on
 *     source revision is verified against the real GitHub repository
 *     (GITHUB_ACCESS_TOKEN) inside the executor seam. Without credentials
 *     the provider executor is NOT bound at all — an action then fails
 *     with the typed NO_EXECUTOR_BOUND failure (honest; never a reference
 *     world transition presented as a live outcome).
 *   - ASK QUEUE: an honestly EMPTY AskQueue (no ask-plane producer is
 *     wired on this branch): resolutions of unknown entries are typed
 *     honest ASK_ENTRY_UNKNOWN failures, never fabricated resolutions.
 *   - RECEIPT LEDGER: in-process (the durable adapters are UNAVAILABLE
 *     from this environment — no durable confirmation is claimed; the
 *     receipt page states the scope honestly).
 */

import type { AuthorityPort, AuthorityQuery, AuthoritySnapshot, Clock, Timestamp } from '@sos-2/action-gateway';
import { AskQueue } from '@sos-2/ask';
import { createLiveActionHost } from './live-action-core';
import type { LiveActionHost, LiveActionReceiptView } from './live-action-core';
import { createSyncProviderBridge } from './real-executor-bridge';
import type { RealProviderConfig, SyncProviderBridge } from './real-executor-bridge';

// ---------------------------------------------------------------------------
// The env-resolved configuration (pure; the route maps the env onto it)
// ---------------------------------------------------------------------------

export interface DeployedHostConfig {
  /** 'actorId|family|scope' entries — the deployment's authority configuration. */
  readonly grants: readonly string[];
  readonly openRouter: RealProviderConfig['openRouter'];
  readonly vercel: RealProviderConfig['vercel'];
  readonly github: RealProviderConfig['github'];
}

const DEFAULT_BODY_MODEL = 'meta-llama/llama-3.3-70b-instruct';
const DEFAULT_VERCEL_API_BASE = 'https://api.vercel.com';
const DEFAULT_OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 20_000;

/** Map the ambient environment onto the deployed host config (names only; values flow, never echo). */
export function deployedHostConfigFromEnv(source: Record<string, string | undefined>): DeployedHostConfig {
  let grants: readonly string[] = [];
  const rawGrants = source['SOS_LIVE_MISSION_GRANTS'];
  if (rawGrants !== undefined && rawGrants.length > 0) {
    try {
      const parsed: unknown = JSON.parse(rawGrants);
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) {
        grants = parsed as readonly string[];
      }
    } catch {
      grants = [];
    }
  }
  const bodyKey = source['BODY_PROVIDER_API_KEY'];
  const openRouter =
    bodyKey !== undefined && bodyKey.length > 0
      ? {
          apiKey: bodyKey,
          model: source['SOS_LIVE_MISSION_BODY_MODEL'] ?? DEFAULT_BODY_MODEL,
          apiBase: source['SOS_LIVE_MISSION_OPENROUTER_API_BASE'] ?? DEFAULT_OPENROUTER_API_BASE,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        }
      : null;
  const vercelToken = source['VERCEL_TOKEN'];
  const vercelProjectId = source['VERCEL_PROJECT_ID'];
  const vercel =
    vercelToken !== undefined && vercelToken.length > 0 && vercelProjectId !== undefined && vercelProjectId.length > 0
      ? {
          token: vercelToken,
          projectId: vercelProjectId,
          teamId: source['VERCEL_ORG_ID'] ?? null,
          repoId: source['SOS_LIVE_MISSION_VERCEL_REPO_ID'] !== undefined ? Number(source['SOS_LIVE_MISSION_VERCEL_REPO_ID']) : null,
          target: source['SOS_LIVE_MISSION_VERCEL_TARGET'] === 'production' ? ('production' as const) : ('preview' as const),
          apiBase: source['SOS_LIVE_MISSION_VERCEL_API_BASE'] ?? DEFAULT_VERCEL_API_BASE,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        }
      : null;
  const githubToken = source['GITHUB_ACCESS_TOKEN'];
  const github =
    githubToken !== undefined && githubToken.length > 0
      ? {
          token: githubToken,
          apiBase: source['SOS_LIVE_MISSION_GITHUB_API_BASE'] ?? DEFAULT_GITHUB_API_BASE,
          owner: source['SOS_LIVE_MISSION_GITHUB_OWNER'] ?? 'payswapdotorg',
          repo: source['SOS_LIVE_MISSION_GITHUB_REPO'] ?? 'SOS-2.0',
          timeoutMs: DEFAULT_TIMEOUT_MS,
        }
      : null;
  return { grants, openRouter, vercel, github };
}

// ---------------------------------------------------------------------------
// The env-configured authority (fail-closed; re-read at action time)
// ---------------------------------------------------------------------------

function parseGrantEntry(entry: string): { actorId: string; family: string; scope: string } | null {
  const parts = entry.split('|');
  if (parts.length !== 3) return null;
  const [actorId, family, scope] = parts;
  if (actorId === undefined || family === undefined || scope === undefined) return null;
  if (actorId.length === 0 || family.length === 0 || scope.length === 0) return null;
  return { actorId, family, scope };
}

/**
 * The env-configured authority: the CURRENT grant list is re-read on every
 * evaluation (action-time re-evaluation; fail-closed). A matching entry is
 * GRANTED with the entry itself as the auditable grant id; anything else
 * is GRANT_NEVER_HELD — the action fails CLOSED.
 */
export class EnvConfiguredAuthority implements AuthorityPort {
  constructor(private readonly source: () => readonly string[]) {}

  evaluateCurrent(query: AuthorityQuery, now: Timestamp): AuthoritySnapshot {
    let matched: string | null = null;
    for (const entry of this.source()) {
      const parsed = parseGrantEntry(entry);
      if (parsed === null) continue;
      const scopeMatch = parsed.scope === query.scope || parsed.scope === '*';
      if (parsed.actorId === query.actor.id && parsed.family === query.family && scopeMatch) {
        matched = entry;
        break;
      }
    }
    if (matched === null) {
      return {
        granted: false,
        reason: 'GRANT_NEVER_HELD',
        grantId: null,
        evaluatedAt: now,
        detail: `no currently-live env-configured grant for ${query.actor.id}|${query.family}|${query.scope} (SOS_LIVE_MISSION_GRANTS) — the action fails CLOSED`,
      };
    }
    return {
      granted: true,
      reason: 'GRANTED',
      grantId: matched,
      evaluatedAt: now,
      detail: `env-configured grant ${matched} is currently live for ${query.actor.id}|${query.family}|${query.scope} (re-evaluated at action time)`,
    };
  }
}

// ---------------------------------------------------------------------------
// The deployed host (bridge + authority + honest empty ask queue)
// ---------------------------------------------------------------------------

export interface DeployedLiveActionHost {
  readonly host: LiveActionHost;
  readonly bridge: SyncProviderBridge | null;
  readonly providersBound: readonly string[];
}

/** Compose the deployed host from a resolved config (async only for the repoId discovery probe). */
export function createDeployedLiveActionHost(config: DeployedHostConfig, options: { clock?: Clock } = {}): DeployedLiveActionHost {
  const providersBound: string[] = [];
  let bridge: SyncProviderBridge | null = null;
  const hasRealProvider = config.openRouter !== null || config.vercel !== null || config.github !== null;
  if (hasRealProvider) {
    bridge = createSyncProviderBridge(config as RealProviderConfig);
    if (bridge.live) {
      if (config.openRouter !== null) providersBound.push('openrouter (body provider)');
      if (config.vercel !== null) providersBound.push('vercel (deployment provider)');
      if (config.github !== null) providersBound.push('github (revision binding)');
    } else {
      bridge.close();
      bridge = null;
    }
  }
  const authority = new EnvConfiguredAuthority(() => config.grants);
  const host = createLiveActionHost({
    clock: options.clock,
    authority,
    executors: bridge === null ? [] : [bridge.executor],
    rollbackVerifier: bridge === null ? null : bridge.verifier,
    asks: new AskQueue(),
    hostLabel: bridge === null ? 'live-action:deployed-unbound' : 'live-action:deployed',
  });
  return { host, bridge, providersBound };
}

// ---------------------------------------------------------------------------
// The process singleton + the in-process receipt ledger
// ---------------------------------------------------------------------------

/**
 * The Next.js server bundles the route handler and the receipt page as
 * SEPARATE entries — each would hold its own module instance. The host
 * singleton + receipt ledger are therefore keyed on globalThis (the
 * standard cross-entry singleton pattern): ONE host per PROCESS, shared
 * by the endpoint and the receipt page.
 */
const GLOBAL_HOST_ID = '__sos2LiveActionHostSingleton__';

interface LiveActionGlobalHost {
  readonly active: DeployedLiveActionHost;
}

function globalHostRegistry(): Record<string, LiveActionGlobalHost | undefined> {
  const registry = globalThis as Record<string, unknown>;
  if (typeof registry[GLOBAL_HOST_ID] !== 'object' || registry[GLOBAL_HOST_ID] === null) {
    registry[GLOBAL_HOST_ID] = {};
  }
  return registry[GLOBAL_HOST_ID] as Record<string, LiveActionGlobalHost | undefined>;
}

/** Bind (once per process) the deployed host resolved from the ambient environment. The clock is supplied by the route handler (the process boundary). */
export function ensureDeployedHost(config: DeployedHostConfig, options: { clock?: Clock } = {}): DeployedLiveActionHost {
  const registry = globalHostRegistry();
  if (registry['host'] === undefined) {
    registry['host'] = { active: createDeployedLiveActionHost(config, options) };
  }
  return registry['host'].active;
}

/** The active host's in-process receipt ledger (null before any submission in this process). */
export function getActiveReceiptLedger(): Map<string, LiveActionReceiptView> | null {
  const registry = globalHostRegistry();
  return registry['host'] === undefined ? null : registry['host'].active.host.receiptLedger;
}
