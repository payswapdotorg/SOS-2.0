/**
 * THE CONSOLE'S VERCEL DEPLOYMENT-RECORDS ADAPTER (Work Order P18-B —
 * composition-boundary integration seam).
 *
 * The merged @sos-2/deployment-providers VercelRestClient is consumed
 * READ-ONLY through its SOURCE entry (the P18-A source-consumption
 * discipline: the package is not inside the @sos-2/web build closure, so
 * the app imports the self-contained client source directly — no dist,
 * no build-order dependency; the frozen contracts are consumed read-only).
 *
 * WHAT THIS ADAPTER IS FOR: the live action endpoint's real promotion /
 * rollback / deployment actions bind to the REAL Vercel deployment
 * records — the deployment ids and their EXACT source_revision_sha
 * (githubCommitSha) values, the current production pointer — read through
 * ONE real authenticated REST round-trip at action time. The reads are
 * observation (no authority required); the actions that consume them stay
 * authority-gated through the gateway. Every REST round-trip lands in the
 * transcript (method + path + status — never credentials, never bodies).
 *
 * HONEST STATES (the P17-C four-state machine, machine-checkable):
 *   CONNECTED   — the records read answered (records present, apiRevision set)
 *   UNAVAILABLE — the real read failed (the exact error recorded verbatim)
 *   UNKNOWN     — not configured (missing env; never probed — never health)
 *
 * Credentials arrive env-only (VERCEL_TOKEN, VERCEL_PROJECT_ID,
 * VERCEL_ORG_ID optional — the team is discovered through the
 * authenticated /v2/user probe when the org id is not declared), injected
 * at the composition boundary, never echoed.
 */

import { VercelRestClient } from '@sos-2/deployment-providers';
import { bindGlobalFetch } from '@sos-2/deployment-providers';
import type { FetchPort } from '@sos-2/deployment-providers';
import type { RecordedVercelRequest, VercelDeploymentIdentity } from '@sos-2/deployment-providers';

/** The env NAMES (the P3 typed registry — never values). */
export const VERCEL_TOKEN_ENV = 'VERCEL_TOKEN';
export const VERCEL_PROJECT_ID_ENV = 'VERCEL_PROJECT_ID';
export const VERCEL_ORG_ID_ENV = 'VERCEL_ORG_ID';

/** The honest adapter state (the P17-C four-state machine subset this surface reports). */
export type VercelRecordsState = 'CONNECTED' | 'UNAVAILABLE' | 'UNKNOWN';

/** The result of one real records read. */
export interface VercelRecordsResult {
  readonly state: VercelRecordsState;
  readonly detail: string;
  /** The real deployment records (empty unless CONNECTED — never fabricated). */
  readonly deployments: readonly VercelDeploymentIdentity[];
  /** The deployment currently serving production (latest by target=production, createdAt desc) — or null. */
  readonly production: VercelDeploymentIdentity | null;
  readonly lastError: string | null;
  readonly apiRevision: string | null;
  /** The REST transcript (method + path + status; never credentials, never bodies). */
  readonly requests: readonly RecordedVercelRequest[];
}

export interface VercelRecordsInput {
  readonly token: string | null;
  readonly projectId: string | null;
  /** The declared org/team id, or null to discover it through the /v2/user probe. */
  readonly orgId: string | null;
  /** The injectable network seam (defaults to the global fetch — the app's impure boundary). */
  readonly fetch?: FetchPort;
  /** The page size for the records read (default 20). */
  readonly limit?: number;
}

function unconfigured(missing: readonly string[]): VercelRecordsResult {
  return {
    state: 'UNKNOWN',
    detail: `not configured — missing env ${missing.join(', ')} (never probed; absence of configuration is never health)`,
    deployments: [],
    production: null,
    lastError: null,
    apiRevision: null,
    requests: [],
  };
}

/**
 * Read the REAL Vercel deployment records for the configured project.
 * Fail-closed: any failure is an honest UNAVAILABLE with the exact error.
 */
export async function readVercelDeploymentRecords(input: VercelRecordsInput): Promise<VercelRecordsResult> {
  const missing: string[] = [];
  if (input.token === null || input.token.length === 0) {
    missing.push(VERCEL_TOKEN_ENV);
  }
  if (input.projectId === null || input.projectId.length === 0) {
    missing.push(VERCEL_PROJECT_ID_ENV);
  }
  if (missing.length > 0) {
    return unconfigured(missing);
  }

  const fetch = input.fetch ?? bindGlobalFetch({ timeoutMs: 15_000 });
  const requests: RecordedVercelRequest[] = [];
  try {
    let teamId = input.orgId;
    if (teamId === null || teamId.length === 0) {
      const probe = new VercelRestClient({ token: input.token!, teamId: null, fetch });
      const user = await probe.user();
      teamId = user.defaultTeamId;
      requests.push(...probe.recordedRequests());
    }
    const client = new VercelRestClient({ token: input.token!, teamId, fetch });
    const deployments = await client.listDeployments({ projectId: input.projectId!, limit: input.limit ?? 20 });
    const production = pickProduction(deployments);
    requests.push(...client.recordedRequests());
    return {
      state: 'CONNECTED',
      detail: `read ${String(deployments.length)} real deployment record(s) for project ${input.projectId} (team ${teamId ?? 'personal'}); production ${
        production !== null ? `${production.id} at ${production.commitSha ?? 'unknown-sha'}` : 'none observed'
      }`,
      deployments,
      production,
      lastError: null,
      apiRevision: 'vercel.v6',
      requests,
    };
  } catch (error) {
    return {
      state: 'UNAVAILABLE',
      detail: 'the real Vercel records read failed — recorded verbatim, never folded into success',
      deployments: [],
      production: null,
      lastError: error instanceof Error ? error.message : String(error),
      apiRevision: null,
      requests,
    };
  }
}

/** The latest production-targeted record (createdAt desc); null when none observed. */
export function pickProduction(deployments: readonly VercelDeploymentIdentity[]): VercelDeploymentIdentity | null {
  const production = deployments.filter((entry) => entry.target === 'production');
  if (production.length === 0) {
    return null;
  }
  return [...production].sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))[0] ?? null;
}

/** The latest record bound to an exact commit sha (the promotion target must be a REALLY deployed revision). */
export function findByCommitSha(deployments: readonly VercelDeploymentIdentity[], sha: string): VercelDeploymentIdentity | null {
  return deployments.find((entry) => entry.commitSha === sha) ?? null;
}
