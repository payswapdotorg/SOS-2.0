/**
 * The SCRIPTED VERCEL FETCH PORT (Work Order P18-B deterministic suite):
 * one page of REAL-SHAPED deployment records served offline, plus typed
 * transport-failure injection. Deterministic, offline, fixed literals —
 * the P17 scripted-FetchPort discipline.
 */

import { TransportError } from '@sos-2/deployment-providers';
import type { FetchPort, HttpRequest, HttpResponse } from '@sos-2/deployment-providers';

/** Two real-shaped deployment records: the observed head + the previous production revision. */
export const RECORDS = [
  {
    uid: 'dpl_deterministic_head_0001',
    name: 'sos-2-0',
    url: 'sos-2-0-deterministic.vercel.app',
    readyState: 'READY',
    createdAt: 1_797_123_000_000,
    target: 'production',
    projectId: 'prj_deterministic_scripted',
    meta: { githubCommitSha: '3717b6ccac8e0741e8a0eef7fd3b0aa92502f6ea', githubCommitRef: 'main', githubCommitMessage: 'gov: reconcile state' },
  },
  {
    uid: 'dpl_deterministic_old_0002',
    name: 'sos-2-0',
    url: 'sos-2-0-deterministic-old.vercel.app',
    readyState: 'READY',
    createdAt: 1_797_000_000_000,
    target: 'production',
    projectId: 'prj_deterministic_scripted',
    meta: { githubCommitSha: 'b5938ea4654144df287ce3e907389fc1f911ccf6', githubCommitRef: 'main', githubCommitMessage: 'P17-A Real Persistence + Deployment' },
  },
] as const;

function jsonResponse(body: unknown): HttpResponse {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return { status: 200, headers: { 'content-type': 'application/json' }, bytes };
}

/**
 * The scripted records read: GET /v2/user -> the team probe; GET
 * /v6/deployments -> one page of real-shaped records.
 */
export function vercelRecordsFetch(): FetchPort {
  return async (request: HttpRequest): Promise<HttpResponse> => {
    if (request.url.includes('/v2/user')) {
      return jsonResponse({ user: { id: 'usr_deterministic', username: 'deterministic-scripted', defaultTeamId: 'team_deterministic_scripted', billing: { plan: 'pro' } } });
    }
    if (request.url.includes('/v6/deployments')) {
      return jsonResponse({ deployments: [...RECORDS] });
    }
    return jsonResponse({ error: { code: 'not_found', message: `unscripted endpoint ${request.url}` } });
  };
}

/** A scripted transport failure (the honest UNAVAILABLE path — typed, never an HTTP status). */
export function vercelTransportFailureFetch(): FetchPort {
  return async (request: HttpRequest): Promise<HttpResponse> => {
    throw new TransportError(`getaddrinfo ENOTFOUND api.vercel.com (scripted) — ${request.url}`);
  };
}
