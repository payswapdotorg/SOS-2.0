/**
 * THE CONSOLE AUTHORITY PORT (Work Order P18-B — integration seam).
 *
 * Authority for the live-mission surface's consequential actions is
 * re-evaluated AT ACTION TIME through the merged ActionGateway's frozen
 * AuthorityPort, fail-closed. This adapter binds the port to the
 * OPERATOR-DECLARED grant set: the deployment's environment declares
 * which action families (optionally scoped, optionally expiring) the
 * console operator holds as 'console-user' — the single impure boundary
 * (the P18-A live-data precedent: the ambient environment as the
 * operator's control plane; env NAMES only in every output, never
 * values).
 *
 * HONESTY (binding):
 *   - UNSET or EMPTY declarations => NO grants => every action fails
 *     CLOSED with GRANT_NEVER_HELD (the default — nothing is authorized
 *     implicitly, and the presence of a provider credential is NEVER
 *     authority by itself).
 *   - Every evaluation re-reads the CURRENT declaration: removing an
 *     entry is a revocation that takes effect at the NEXT action (the
 *     next evaluateCurrent call), and an entry's expiry is checked
 *     against the caller-supplied now.
 *   - Grant ids are stable and provenance-carrying:
 *     `live-mission-grant:<family>:<scope>` — the detail records the env
 *     NAME (LIVE_MISSION_GRANTS), never the value.
 *
 * The declaration format (comma-separated entries):
 *   family                     — a wildcard-scope grant (e.g. `rollback`)
 *   family:scope               — an exact-scope grant (e.g.
 *                                `body-lifecycle:cloud-sandbox-1`)
 *   family:scope:expiresAtMs   — an expiring exact-scope grant
 *   family:*:expiresAtMs       — an expiring wildcard-scope grant
 */

import type { ActionFamily } from '@sos-2/action-gateway';
import { ACTION_FAMILIES } from '@sos-2/action-gateway';
import type { AuthorityPort, AuthorityQuery, AuthorityReason, AuthoritySnapshot } from '@sos-2/action-gateway';

/** The env NAME carrying the operator's grant declaration (never a credential). */
export const LIVE_MISSION_GRANTS_ENV = 'LIVE_MISSION_GRANTS';

/** The actor the console's forms stamp on every envelope (the frozen P17-C literal). */
export const CONSOLE_ACTOR_ID = 'console-user';

/** The ambient environment source (injectable for the deterministic suites). */
export type EnvSource = () => Readonly<Record<string, string | undefined>>;

/** The ambient environment (the app's single impure env boundary — the P18-A precedent). */
export function ambientEnv(): Readonly<Record<string, string | undefined>> {
  return process.env as Record<string, string | undefined>;
}

interface DeclaredGrant {
  readonly family: ActionFamily;
  readonly scope: string;
  readonly expiresAt: number | null;
}

function isActionFamily(value: string): value is ActionFamily {
  return (ACTION_FAMILIES as readonly string[]).includes(value);
}

/**
 * Parse the operator's grant declaration. Malformed entries are IGNORED
 * loudly-in-detail (never authority) — an unrecognized family in the
 * declaration does not grant anything, and does not crash the console.
 */
export function parseGrantDeclaration(declaration: string): { readonly grants: readonly DeclaredGrant[]; readonly ignored: readonly string[] } {
  const grants: DeclaredGrant[] = [];
  const ignored: string[] = [];
  for (const rawEntry of declaration.split(',')) {
    const entry = rawEntry.trim();
    if (entry.length === 0) {
      continue;
    }
    const parts = entry.split(':');
    if (parts.length < 1 || parts.length > 3) {
      ignored.push(entry);
      continue;
    }
    const family = parts[0] ?? '';
    if (!isActionFamily(family)) {
      ignored.push(entry);
      continue;
    }
    const scope = parts.length >= 2 && (parts[1] ?? '').length > 0 ? (parts[1] as string) : '*';
    let expiresAt: number | null = null;
    if (parts.length === 3) {
      const parsed = Number.parseInt(parts[2] ?? '', 10);
      expiresAt = Number.isFinite(parsed) ? parsed : null;
    }
    grants.push({ family, scope, expiresAt });
  }
  return { grants, ignored };
}

function matches(declared: DeclaredGrant, query: AuthorityQuery): boolean {
  if (declared.family !== query.family) {
    return false;
  }
  return declared.scope === '*' || declared.scope === query.scope;
}

/**
 * The operator-env-backed authority port (fail-closed by default).
 * Everything is injectable for the deterministic suites; the app binds
 * the ambient env + this module's port.
 */
export class ConsoleEnvAuthority implements AuthorityPort {
  constructor(private readonly source: EnvSource) {}

  evaluateCurrent(query: AuthorityQuery, now: number): AuthoritySnapshot {
    const declaration = this.source()[LIVE_MISSION_GRANTS_ENV] ?? '';
    const { grants, ignored } = parseGrantDeclaration(declaration);
    const matched = grants.find((grant) => matches(grant, query));

    let reason: AuthorityReason;
    let grantId: string | null = null;
    let detail: string;
    if (matched === undefined) {
      reason = 'GRANT_NEVER_HELD';
      detail = `no currently-live grant for ${query.actor.id}|${query.family}|${query.scope}: the operator grant declaration (${LIVE_MISSION_GRANTS_ENV}) carries no matching entry (fail-closed)`;
    } else if (matched.expiresAt !== null && now >= matched.expiresAt) {
      reason = 'GRANT_EXPIRED';
      grantId = grantIdFor(matched);
      detail = `grant ${grantId} for ${query.actor.id}|${query.family}|${query.scope} expired at ${String(matched.expiresAt)} (declaration: ${LIVE_MISSION_GRANTS_ENV})`;
    } else {
      reason = 'GRANTED';
      grantId = grantIdFor(matched);
      detail = `operator-declared grant ${grantId} is currently live for ${query.actor.id}|${query.family}|${query.scope} (declaration: ${LIVE_MISSION_GRANTS_ENV})`;
    }
    const suffix =
      ignored.length > 0
        ? `; ${String(ignored.length)} malformed declaration entr${ignored.length === 1 ? 'y was' : 'ies were'} ignored (never authority)`
        : '';
    return {
      granted: reason === 'GRANTED',
      reason,
      grantId,
      evaluatedAt: now,
      detail: `${detail}${suffix}`,
    };
  }
}

function grantIdFor(grant: DeclaredGrant): string {
  return `live-mission-grant:${grant.family}:${grant.scope}`;
}

/** Compose the console authority port over an injectable env source. */
export function createConsoleAuthority(source: EnvSource): ConsoleEnvAuthority {
  return new ConsoleEnvAuthority(source);
}
