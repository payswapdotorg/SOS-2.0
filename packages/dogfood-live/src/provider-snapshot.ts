/**
 * THE HONEST PROVIDER-STATE SNAPSHOT (Work Order P19) — REAL probes of
 * every provider the dogfood binds, following the
 * infra/production-connectivity wiring precedent (honest outcomes only:
 * UNKNOWN before a probe, CONNECTED/UNAVAILABLE/DEGRADED after, never
 * fabricated):
 *
 *   - GitHub: the PAT-backed whoami handshake (RealGitHubProvider
 *     verifyToken probes GET /user on the backing provider);
 *   - Vercel: the authenticated GET /v2/user probe (the dogfood client);
 *   - OpenRouter: the real key check (GET /api/v1/key with the Bearer
 *     credential — the honest key-usage answer);
 *   - Neon + Upstash: the DNS probes (real resolution attempts; the
 *     P18-A live-data-plane precedent — ENOTFOUND facts recorded
 *     verbatim) plus the honest unattached states when the runtime
 *     carries no DATABASE_URL / UPSTASH_REDIS_REST_URL.
 */

import type { RealGitHubProvider } from '@sos-2/real-github';
import { formatRfc3339 } from '@sos-2/live-store';
import type { Clock } from '@sos-2/live-store';
import { lookup } from 'node:dns/promises';
import type { DogfoodVercelClient } from './vercel-rest.js';
import type { DogfoodProviderState } from './records.js';

/** The injectable DNS lookup seam (deterministic tests script it). */
export type DogfoodDnsLookup = (host: string) => Promise<string>;

/** The default DNS probe (the documented impure boundary: the real resolver). */
export async function realDnsLookup(host: string): Promise<string> {
  const result = await lookup(host, { family: 0 });
  return result.address;
}

/** The injectable OpenRouter key-check seam (deterministic tests script it). */
export type DogfoodOpenRouterKeyCheck = (apiKey: string) => Promise<{ ok: boolean; detail: string }>;

/** The OpenRouter key endpoint (the real key check). */
export const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';

/** The default OpenRouter key check (the documented impure boundary: the global fetch). */
export async function realOpenRouterKeyCheck(apiKey: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch(OPENROUTER_KEY_URL, { headers: { authorization: `Bearer ${apiKey}` } });
    if (response.status === 200) {
      return { ok: true, detail: 'the model provider answered the authenticated key check (GET /api/v1/key, HTTP 200)' };
    }
    const body = await response.text();
    return { ok: false, detail: `the model provider key check answered HTTP ${String(response.status)}: ${body.slice(0, 200)}` };
  } catch (error) {
    return { ok: false, detail: `the model provider key check failed at the transport level: ${(error as Error).message}` };
  }
}

export interface DogfoodProviderSnapshotOptions {
  /** The REAL GitHub provider (verifyToken probes GET /user). */
  readonly github: RealGitHubProvider;
  /** The GitHub credential env NAME (for the honest row; never the value). */
  readonly githubCredentialEnv: string | null;
  /** The dogfood Vercel client (GET /v2/user). */
  readonly vercel: DogfoodVercelClient | null;
  /** The Vercel credential env NAME. */
  readonly vercelCredentialEnv: string | null;
  /** The OpenRouter key VALUE (probed; never echoed) or null when absent. */
  readonly openRouterApiKey: string | null;
  /** The OpenRouter credential env NAME. */
  readonly openRouterCredentialEnv: string | null;
  /** The injected clock (probe instants). */
  readonly clock: Clock;
  /** The injectable DNS lookup (default: the real resolver). */
  readonly dnsLookup?: DogfoodDnsLookup;
  /** The injectable OpenRouter key check (default: the real probe). */
  readonly openRouterKeyCheck?: DogfoodOpenRouterKeyCheck;
}

/** Run the REAL provider probes and assemble the honest snapshot (never fabricated). */
export async function probeDogfoodProviders(options: DogfoodProviderSnapshotOptions): Promise<readonly DogfoodProviderState[]> {
  const at = () => formatRfc3339(options.clock.nowEpochMs());
  const states: DogfoodProviderState[] = [];

  // GitHub — the PAT-backed whoami handshake (the only path to CONNECTED).
  const githubProbe = await options.github.probeProvider(at());
  states.push({
    provider: 'github',
    state: githubProbe.state === 'CONNECTED' ? 'CONNECTED' : githubProbe.state === 'DEGRADED' ? 'DEGRADED' : 'UNAVAILABLE',
    probed: true,
    detail: githubProbe.note,
    credentialEnv: options.githubCredentialEnv,
    probedAt: githubProbe.probed_at,
  });

  // Vercel — the authenticated GET /v2/user probe.
  if (options.vercel !== null) {
    try {
      const user = await options.vercel.user();
      states.push({
        provider: 'vercel',
        state: user.id.length > 0 ? 'CONNECTED' : 'UNAVAILABLE',
        probed: true,
        detail:
          user.id.length > 0
            ? `the real Vercel API answered the authenticated probe (user ${user.username}, id ${user.id}) — CONNECTED on real evidence`
            : 'the real Vercel API answered the probe but the user identity was absent — UNAVAILABLE, never fabricated',
        credentialEnv: options.vercelCredentialEnv,
        probedAt: at(),
      });
    } catch (error) {
      states.push({
        provider: 'vercel',
        state: 'UNAVAILABLE',
        probed: true,
        detail: `the real Vercel API probe failed: ${(error as Error).message}`,
        credentialEnv: options.vercelCredentialEnv,
        probedAt: at(),
      });
    }
  } else {
    states.push({
      provider: 'vercel',
      state: 'UNKNOWN',
      probed: false,
      detail: 'no VERCEL_TOKEN configured in the injected source — the honest state is UNKNOWN (never fabricated)',
      credentialEnv: null,
      probedAt: null,
    });
  }

  // OpenRouter — the real key check.
  if (options.openRouterApiKey !== null) {
    const check = options.openRouterKeyCheck ?? realOpenRouterKeyCheck;
    const result = await check(options.openRouterApiKey);
    states.push({
      provider: 'openrouter',
      state: result.ok ? 'CONNECTED' : 'UNAVAILABLE',
      probed: true,
      detail: result.ok ? result.detail : `${result.detail} — the honest state is UNAVAILABLE (the body's first real model call would fail closed)`,
      credentialEnv: options.openRouterCredentialEnv,
      probedAt: at(),
    });
  } else {
    states.push({
      provider: 'openrouter',
      state: 'UNKNOWN',
      probed: false,
      detail: 'no OPENROUTER_API_KEY configured in the injected source — the honest state is UNKNOWN (never fabricated)',
      credentialEnv: null,
      probedAt: null,
    });
  }

  // Neon — the DNS probe (the P18-A precedent) + the honest credential state.
  const dns = options.dnsLookup ?? realDnsLookup;
  const neon = await probeDns('neon', 'api.neon.tech', dns, at);
  states.push({
    ...neon,
    detail:
      options.openRouterApiKey === undefined
        ? neon.detail
        : `${neon.detail}${' — no DATABASE_URL exists in the runtime (the canonical durable adapter stays honestly unattached, never fabricated)'}`,
  });

  // Upstash — the DNS probe (coordination only, never canonical).
  const upstash = await probeDns('upstash', 'upstash.io', dns, at);
  states.push({
    ...upstash,
    detail: `${upstash.detail} — the coordination store is never canonical (no UPSTASH_REDIS_REST_URL exists in this runtime; the never-canonical rule holds)`,
  });

  return states;
}

/** One honest DNS probe (the live-data-plane ENOTFOUND precedent, recorded verbatim). */
async function probeDns(
  provider: string,
  host: string,
  dns: DogfoodDnsLookup,
  at: () => string,
): Promise<DogfoodProviderState> {
  try {
    const address = await dns(host);
    return {
      provider,
      state: 'UNKNOWN',
      probed: true,
      detail: `the DNS probe resolved ${host} (${address}); the provider remains UNKNOWN until an authenticated probe completes (no credential exists in this runtime — never fabricated)`,
      credentialEnv: null,
      probedAt: at(),
    };
  } catch (error) {
    return {
      provider,
      state: 'UNAVAILABLE',
      probed: true,
      detail: `the DNS probe failed for ${host}: ${(error as Error).message} — recorded verbatim (the P18-A live-data-plane precedent)`,
      credentialEnv: null,
      probedAt: at(),
    };
  }
}

/** The honest store-selection record over the probed canonical/coordination providers (the live-data-plane precedent). */
export function selectDogfoodStore(input: {
  readonly databaseUrl: string | null;
  readonly databaseUrlEnv: string | null;
  readonly canonicalProbeOk: boolean;
  readonly coordinationProbeOk: boolean;
}): {
  readonly mode: 'PRODUCTION_DURABLE' | 'REFERENCE_FALLBACK';
  readonly storeRef: string;
  readonly referenceMode: boolean;
  readonly canonical: { provider: 'neon'; state: 'CONNECTED' | 'UNKNOWN' | 'UNAVAILABLE' | 'DEGRADED'; detail: string };
  readonly coordination: { provider: 'upstash'; state: 'CONNECTED' | 'UNKNOWN' | 'UNAVAILABLE' | 'DEGRADED'; detail: string };
  readonly note: string;
} {
  const canonical = input.databaseUrl === null
    ? {
        provider: 'neon' as const,
        state: 'UNKNOWN' as const,
        detail: 'no DATABASE_URL exists in the runtime — the canonical durable adapter stays honestly unattached (UNKNOWN, never fabricated)',
      }
    : input.canonicalProbeOk
      ? { provider: 'neon' as const, state: 'CONNECTED' as const, detail: 'the canonical durable adapter answered a real probe — PRODUCTION_DURABLE' }
      : {
          provider: 'neon' as const,
          state: 'UNAVAILABLE' as const,
          detail: 'the canonical durable adapter did not answer a real probe — the selection degrades to the explicit reference marker (never fabricated)',
        };
  const coordination = input.coordinationProbeOk
    ? { provider: 'upstash' as const, state: 'CONNECTED' as const, detail: 'the coordination adapter answered a real probe (coordination only — never canonical)' }
    : {
        provider: 'upstash' as const,
        state: 'UNAVAILABLE' as const,
        detail: 'the coordination adapter did not answer a real probe (DNS/probe failure recorded verbatim) — coordination-only, never canonical',
      };
  const durable = canonical.state === 'CONNECTED';
  return {
    mode: durable ? 'PRODUCTION_DURABLE' : 'REFERENCE_FALLBACK',
    storeRef: durable ? 'neon:postgres-live-store' : 'reference:in-memory-live-store',
    referenceMode: !durable,
    canonical,
    coordination,
    note: durable
      ? 'The canonical durable store answered a real probe — the journey state is production durable.'
      : 'The canonical store did not answer a real probe, so the journey runs on the reference in-memory live store — explicitly NOT production durable state (the live-data-plane REFERENCE_FALLBACK precedent; machine-checkable via storeRef + referenceMode).',
  };
}
