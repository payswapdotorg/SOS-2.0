/**
 * Network policy declarations (Work Order P14).
 *
 * Declarative body network policies per environment tier, extending the
 * P3 body-provider network contract (infra/deployment/src/execution/
 * body-providers.ts — 'none | allowlist | open' with the none+open
 * unsafe combination typed-rejected) and the P8 sandbox egress policy
 * discipline.
 *
 * PINNED RULES:
 *   - production bodies run under an ALLOWLIST ONLY — 'open' egress in
 *     production is a typed violation (unrepresentable);
 *   - preview bodies run under a (narrower) allowlist;
 *   - local bodies may declare open egress EXPLICITLY (developer
 *     machines), never implicitly;
 *   - allowlists are duplicate-free, whitespace-free hosts; an empty
 *     allowlist is 'none' (the honest declaration).
 *
 * Contracts, not enforcement: the real network policy engine (VPC
 * rules, egress proxies) attaches later as an adapter realizing the
 * same declarations. Status: NOT_YET_CONNECTED.
 *
 * Determinism: pure functions over injected declarations.
 */

import { HardeningContractError, isNonEmptyString, isPlainObject } from './tiers.ts';

/** The egress policy shapes (P3/P8-aligned vocabulary). */
export type EgressMode = 'none' | 'allowlist' | 'open';

/** One tier's network policy declaration. */
export interface NetworkPolicyDeclaration {
  readonly tier: 'local' | 'preview' | 'production';
  readonly egress: EgressMode;
  /** Required for allowlist; forbidden otherwise. */
  readonly allowedHosts: readonly string[] | null;
  /** Why this policy exists (the runbook link). */
  readonly rationale: string;
}

/** The repo-standard declarations. */
export const DEFAULT_NETWORK_POLICIES: readonly NetworkPolicyDeclaration[] = [
  {
    tier: 'local',
    egress: 'open',
    allowedHosts: null,
    rationale: 'developer machines run trusted interactive work; open egress is the explicit local default',
  },
  {
    tier: 'preview',
    egress: 'allowlist',
    allowedHosts: ['github.com', 'api.github.com', 'objects.githubusercontent.com'],
    rationale: 'preview bodies may reach the repository host family only (unreviewed autonomous work stays narrow)',
  },
  {
    tier: 'production',
    egress: 'allowlist',
    allowedHosts: ['github.com', 'api.github.com', 'objects.githubusercontent.com'],
    rationale: 'production bodies run under an explicit allowlist — open egress is unrepresentable',
  },
] as const;

/** Validate one network policy declaration (fail-closed). */
export function assertValidNetworkPolicyDeclaration(declaration: NetworkPolicyDeclaration): void {
  if (!isPlainObject(declaration)) {
    throw new HardeningContractError('network policy declaration must be an object');
  }
  if (declaration.tier !== 'local' && declaration.tier !== 'preview' && declaration.tier !== 'production') {
    throw new HardeningContractError(`network policy tier must be local | preview | production, received: ${JSON.stringify(declaration.tier)}`);
  }
  if (declaration.egress !== 'none' && declaration.egress !== 'allowlist' && declaration.egress !== 'open') {
    throw new HardeningContractError(`network policy egress must be none | allowlist | open, received: ${JSON.stringify(declaration.egress)}`);
  }
  if (declaration.egress === 'open' && declaration.tier !== 'local') {
    throw new HardeningContractError(
      `open network egress in tier "${declaration.tier}" is unrepresentable — preview/production bodies run under an allowlist`,
    );
  }
  if (declaration.egress === 'allowlist') {
    const hosts = declaration.allowedHosts;
    if (!Array.isArray(hosts) || hosts.length === 0) {
      throw new HardeningContractError('egress "allowlist" requires a non-empty allowedHosts array (use egress "none" instead of an empty allowlist)');
    }
    if (!hosts.every((host) => isNonEmptyString(host) && !/\s/.test(host))) {
      throw new HardeningContractError('allowlist hosts must be non-empty, whitespace-free strings');
    }
    if (new Set(hosts).size !== hosts.length) {
      throw new HardeningContractError('allowlist hosts must be duplicate-free');
    }
  } else if (declaration.allowedHosts !== null) {
    throw new HardeningContractError(`egress "${declaration.egress}" carries no allowedHosts (null is the honest declaration)`);
  }
  if (!isNonEmptyString(declaration.rationale)) {
    throw new HardeningContractError('network policy declaration requires a non-empty rationale (the runbook link)');
  }
}

/** Validate a complete tier set (exactly one policy per tier). */
export function assertValidNetworkPolicySet(declarations: readonly NetworkPolicyDeclaration[]): void {
  const tiers = new Set(declarations.map((declaration) => declaration.tier));
  if (tiers.size !== declarations.length) {
    throw new HardeningContractError('duplicate network policy declarations for the same tier');
  }
  for (const expected of ['local', 'preview', 'production'] as const) {
    if (!tiers.has(expected)) {
      throw new HardeningContractError(`missing network policy declaration for tier "${expected}"`);
    }
  }
  for (const declaration of declarations) {
    assertValidNetworkPolicyDeclaration(declaration);
  }
}

/**
 * Egress check against a declaration: is `host` reachable under the
 * declared policy? (The offline contract check the real engine must
 * realize.) Fail-closed: unknown modes deny.
 */
export function egressAllowed(declaration: NetworkPolicyDeclaration, host: string): boolean {
  assertValidNetworkPolicyDeclaration(declaration);
  if (declaration.egress === 'open') return true;
  if (declaration.egress === 'none') return false;
  return declaration.allowedHosts?.includes(host) === true;
}
