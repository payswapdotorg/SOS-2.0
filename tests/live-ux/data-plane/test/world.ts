/**
 * The deterministic world of the live data-plane suites (Work Order
 * P18-A): ONE scripted router FetchPort (the binary P17-A seam — every
 * provider of the data plane flows through it: Neon HTTP SQL, Upstash
 * REST, the Vercel REST client, GitHub REST) — NO network, fixed seed,
 * run-to-run identical. The REAL data-plane logic (durable-store
 * selection, deployment-state read, the observation-plane drain, the
 * snapshot durability binding, the provenance projections) is exercised
 * through this seam exactly the way the env-gated real suite exercises
 * it through the real fetch.
 *
 * Route keys are URL/body patterns with per-route mutable behavior —
 * the scenario suites flip the knobs (DNS failure, partial providers,
 * stale data) and the router responds deterministically. The Neon row
 * state (the durable snapshot row) is WORLD STATE: a putRow writes it,
 * a getRow reads it — the replay/reconciliation suite observes versions
 * increment across runs.
 */

import type { FetchPort, HttpRequest, HttpResponse } from '@sos-2/real-persistence';

/** The fixed deterministic clock start. */
export const T0 = Date.parse('2026-09-25T12:00:00Z');

/** The observed repository head fixtures. */
export const HEAD_A = '711cfd60b7eb90b338a8ce17cadcafb72a0d1e6e';
export const HEAD_B = 'b5938ea4654144df287ce3e907389fc1f911ccf6';
export const PREVIOUS_HEAD = '0123456789abcdef0123456789abcdef01234567';

/** The synthetic environment (its VALUES never appear in evidence; the real suite reads the ambient env instead). */
export function scriptedSource(): Record<string, string> {
  return {
    GITHUB_ACCESS_TOKEN: 'ghp_scriptedobservationtoken0000000000000',
    GITHUB_WEBHOOK_SECRET: 'whsec_scripted',
    VERCEL_TOKEN: 'vcp_scripteddeploymenttoken0000000000000',
    VERCEL_PROJECT_ID: 'prj_scripted00000000000000000000',
    VERCEL_ORG_ID: 'team_scripted00000000000000000',
    DATABASE_URL: 'postgres://operator:neon-secret@ep-scripted-pooler.us-east-1.aws.neon.tech/sos?sslmode=require',
    NEON_API_KEY: 'napi_scripted0000000000000000000000000',
    NEON_DATABASE_NAME: 'sos',
    NEON_BRANCH_NAME: 'main',
    UPSTASH_REDIS_REST_URL: 'https://scripted-ewe-000000.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'AAAAscriptedscriptedscriptedscripted',
    R2_ACCOUNT_ID: 'account123',
    R2_ACCESS_KEY_ID: 'accesskey123',
    R2_SECRET_ACCESS_KEY: 'secretkey1234567890abcdef',
    R2_BUCKET_NAME: 'sos20-evidence-prod',
  };
}

/** The scripted knobs (per-route behavior; defaults = the healthy path). */
export interface ScriptedKnobs {
  /** The Neon SQL probe: 'ok' (CONNECTED) | 'dns-fail' (transport/DNS failure). */
  readonly neonProbe: 'ok' | 'dns-fail';
  /** The durable putRow: 'ok' | 'fail' (SQL failure after a successful probe). */
  readonly neonPut: 'ok' | 'fail';
  /** The read-back getRow after a successful putRow: 'match' | 'empty' (the row vanished — honest failure). */
  readonly neonReadBack: 'match' | 'empty';
  /** The Upstash REST probe: 'ok' | 'nxdomain'. */
  readonly upstashProbe: 'ok' | 'nxdomain';
  /** The harness deployment-state read (teamId-scoped /v6/deployments?limit=20): the production deployment source sha. */
  readonly harnessDeployment: 'head' | 'other' | 'empty' | 'fail';
  /** The observation plane's vercel deployments source poll (NO teamId): same knobs. */
  readonly observationDeployment: 'head' | 'other' | 'empty' | 'fail';
  /** The scheduled deployment probe (/v6/deployments?limit=1). */
  readonly deploymentProbe: 'head' | 'other' | 'empty' | 'fail';
  /** The GitHub REST events poll. 'push-a-replayed' serves the SAME event id twice (redelivery — the replay-protected pipeline dedups). */
  readonly githubEvents: 'push-a' | 'push-b' | 'push-a-replayed' | 'empty' | 'fail';
  /** The GitHub Actions runs poll. */
  readonly githubCi: 'success-a' | 'success-b' | 'failing-a' | 'empty' | 'fail';
  /** The scheduled CI probe (GET /actions/runs?per_page=1) — 'old' serves the same old run, 'fail'/'empty' create nothing fresh. */
  readonly ciProbe: 'old' | 'fail' | 'empty';
  /** The scheduled repo-head probe (GET /branches/main). */
  readonly branchProbe: 'head-a' | 'head-b' | 'empty' | 'fail';
  /** The GitHub rate-limit telemetry/health endpoint. */
  readonly rateLimit: 'ok' | 'fail';
  /** Events/CI/deployment timestamps offset from the drain instant (for the stale scenario). */
  readonly dataAgeMs: number;
}

export function defaultKnobs(): ScriptedKnobs {
  return {
    neonProbe: 'ok',
    neonPut: 'ok',
    neonReadBack: 'match',
    upstashProbe: 'ok',
    harnessDeployment: 'head',
    observationDeployment: 'head',
    deploymentProbe: 'head',
    githubEvents: 'push-a',
    githubCi: 'success-a',
    ciProbe: 'old',
    branchProbe: 'head-a',
    rateLimit: 'ok',
    dataAgeMs: 120_000,
  };
}

/** The durable Neon row state (world state — putRow writes, getRow reads). */
export interface NeonRowState {
  present: boolean;
  storageVersion: number;
  snapshot: Record<string, unknown> | null;
}

function jsonResponse(status: number, body: unknown): HttpResponse {
  return { status, headers: { 'content-type': 'application/json' }, bytes: new TextEncoder().encode(JSON.stringify(body)) };
}

function notFound(): HttpResponse {
  return { status: 404, headers: {}, bytes: new Uint8Array() };
}

export interface ScriptedWorld {
  readonly fetch: FetchPort;
  /** Every request that flowed through the seam (audit; never carries credentials in evidence). */
  readonly requests: HttpRequest[];
  /** Request counts by route key (replay/never-persisted assertions). */
  readonly counts: Record<string, number>;
  /** The mutable durable-row state (the replay suite advances it across runs). */
  readonly neonRow: NeonRowState;
  /** The mutable knobs (multi-run scenarios flip them between runs on the SAME world). */
  knobs: ScriptedKnobs;
  /** The GitHub event external ids served (replay serves the SAME ids — GitHub's own durable event ids). */
  eventIds: { push: string; ci: string; deployment: string };
}

/** Build the scripted router world from the knobs (deterministic, offline; the knobs stay mutable for multi-run scenarios). */
export function scriptedWorld(initial: ScriptedKnobs = defaultKnobs()): ScriptedWorld {
  const requests: HttpRequest[] = [];
  const counts: Record<string, number> = {};
  const neonRow: NeonRowState = { present: false, storageVersion: 0, snapshot: null };
  const world: ScriptedWorld = {
    requests,
    counts,
    neonRow,
    knobs: initial,
    eventIds: { push: 'evt-0001', ci: '9101', deployment: 'dpl_production000000000000000' },
    fetch: async (request: HttpRequest): Promise<HttpResponse> => {
      const knobs = world.knobs;
      requests.push(request);
      const url = request.url;
      const bodyText = request.body === null ? '' : new TextDecoder().decode(request.body);
      const count = (key: string): number => {
        counts[key] = (counts[key] ?? 0) + 1;
        return counts[key]!;
      };
      // ---------------------------------------------------------------- Neon
      if (url.endsWith('/sql')) {
        const parsed = JSON.parse(bodyText) as { query: string; params: unknown[] };
        const query = parsed.query;
        if (query.includes('SELECT 1 AS ping')) {
          count('neon:probe');
          if (knobs.neonProbe === 'dns-fail') {
            throw new Error(`transport failure for POST ${url}: fetch failed (getaddrinfo ENOTFOUND ep-scripted-pooler.us-east-1.aws.neon.tech)`);
          }
          return jsonResponse(200, { fields: [{ name: 'ping', type: 'int4' }], rows: [{ ping: 1 }], command: 'SELECT', rowCount: 1 });
        }
        if (query.includes('SELECT data::text')) {
          count('neon:getRow');
          if (!neonRow.present || neonRow.snapshot === null) {
            return jsonResponse(200, { fields: [{ name: 'data_text', type: 'text' }, { name: 'storage_version', type: 'int8' }], rows: [], command: 'SELECT', rowCount: 0 });
          }
          return jsonResponse(200, {
            fields: [{ name: 'data_text', type: 'text' }, { name: 'storage_version', type: 'int8' }],
            rows: [{ data_text: JSON.stringify(neonRow.snapshot), storage_version: neonRow.storageVersion }],
            command: 'SELECT',
            rowCount: 1,
          });
        }
        if (query.includes('INSERT INTO')) {
          count('neon:putRow');
          if (knobs.neonPut === 'fail') {
            return jsonResponse(400, { error: 'relation "sos_rows" does not exist' });
          }
          // upsert semantics: the version increments; the row becomes the world state
          const data = (parsed.params[2] as string | undefined) ?? '{}';
          neonRow.present = true;
          neonRow.storageVersion += 1;
          neonRow.snapshot = JSON.parse(data) as Record<string, unknown>;
          if (knobs.neonReadBack === 'empty') {
            // the read-back will honestly find nothing (the write "succeeded" but the row vanished)
            neonRow.present = false;
            neonRow.snapshot = null;
          }
          return jsonResponse(200, { fields: [{ name: 'storage_version', type: 'int8' }], rows: [{ storage_version: neonRow.storageVersion }], command: 'INSERT', rowCount: 1 });
        }
        throw new Error(`unscripted Neon SQL: ${query.slice(0, 60)}`);
      }
      // -------------------------------------------------------------- Upstash
      if (url.includes('scripted-ewe-000000.upstash.io/ping')) {
        count('upstash:probe');
        if (knobs.upstashProbe === 'nxdomain') {
          throw new Error(`transport failure for POST ${url}: fetch failed (getaddrinfo ENOTFOUND scripted-ewe-000000.upstash.io — NXDOMAIN)`);
        }
        return jsonResponse(200, { result: 'PONG' });
      }
      if (url.includes('scripted-ewe-000000.upstash.io/pipeline')) {
        count('upstash:pipeline');
        if (knobs.upstashProbe === 'nxdomain') {
          throw new Error(`transport failure for POST ${url}: fetch failed (getaddrinfo ENOTFOUND scripted-ewe-000000.upstash.io — NXDOMAIN)`);
        }
        return jsonResponse(200, [{ result: 'PONG' }, { result: 0 }]);
      }
      // --------------------------------------------------------------- Vercel
      if (url.includes('api.vercel.com/v6/deployments')) {
        const isHarnessRead = url.includes('teamId=') && url.includes('limit=20');
        const isProbe = url.includes('limit=1');
        const mode: ScriptedKnobs['harnessDeployment'] = isHarnessRead ? knobs.harnessDeployment : isProbe ? knobs.deploymentProbe : knobs.observationDeployment;
        count(isHarnessRead ? 'vercel:harness-read' : isProbe ? 'vercel:probe' : 'vercel:observation');
        if (mode === 'fail') {
          throw new Error(`transport failure for GET ${url}: fetch failed (connect ETIMEDOUT api.vercel.com:443)`);
        }
        if (mode === 'empty') {
          return jsonResponse(200, { deployments: [] });
        }
        const sha = mode === 'head' ? HEAD_A : HEAD_B;
        return jsonResponse(200, {
          deployments: [
            {
              uid: world.eventIds.deployment,
              url: 'sos-2-0-scripted.vercel.app',
              readyState: 'READY',
              createdAt: T0 - knobs.dataAgeMs,
              target: 'production',
              meta: { githubCommitSha: sha, githubCommitRef: 'main', githubCommitRepo: 'SOS-2.0', githubCommitMessage: 'scripted: the deployed head' },
              projectId: 'prj_scripted00000000000000000000',
              regions: ['iad1'],
            },
          ],
        });
      }
      if (url.includes('api.vercel.com/v2/user')) {
        count('vercel:user');
        return jsonResponse(200, { user: { id: 'user_1', username: 'operator', defaultTeamId: 'team_scripted00000000000000000', billing: { plan: 'hobby' } } });
      }
      // --------------------------------------------------------------- GitHub
      if (url.includes('/rate_limit')) {
        count('github:rate-limit');
        if (knobs.rateLimit === 'fail') {
          throw new Error(`transport failure for GET ${url}: fetch failed (connect ETIMEDOUT api.github.com:443)`);
        }
        return jsonResponse(200, { resources: { core: { limit: 5000, used: 5, remaining: 4995, reset: 1 } } });
      }
      if (url.includes('/repos/payswapdotorg/SOS-2.0/events')) {
        count('github:events');
        if (knobs.githubEvents === 'fail') {
          throw new Error(`transport failure for GET ${url}: fetch failed (connect ETIMEDOUT api.github.com:443)`);
        }
        if (knobs.githubEvents === 'empty') {
          return jsonResponse(200, []);
        }
        const sha = knobs.githubEvents === 'push-b' ? HEAD_B : HEAD_A;
        const eventId = knobs.githubEvents === 'push-b' ? 'evt-0002' : world.eventIds.push;
        const event = { id: eventId, type: 'PushEvent', created_at: new Date(T0 - knobs.dataAgeMs).toISOString(), payload: { ref: 'refs/heads/main', head: sha, before: PREVIOUS_HEAD } };
        if (knobs.githubEvents === 'push-a-replayed') {
          // GitHub redelivery: the SAME durable event id twice in one poll — the replay-protected pipeline dedups
          return jsonResponse(200, [event, { ...event }]);
        }
        return jsonResponse(200, [event]);
      }
      if (url.includes('/repos/payswapdotorg/SOS-2.0/actions/runs')) {
        const isProbe = url.includes('per_page=1');
        count(isProbe ? 'github:ci-probe' : 'github:ci');
        if (isProbe && knobs.ciProbe === 'fail') {
          throw new Error(`transport failure for GET ${url}: fetch failed (connect ETIMEDOUT api.github.com:443)`);
        }
        if (isProbe && knobs.ciProbe === 'empty') {
          return jsonResponse(200, { total_count: 0, workflow_runs: [] });
        }
        const mode = knobs.githubCi;
        if (mode === 'fail') {
          throw new Error(`transport failure for GET ${url}: fetch failed (connect ETIMEDOUT api.github.com:443)`);
        }
        if (mode === 'empty') {
          return jsonResponse(200, { total_count: 0, workflow_runs: [] });
        }
        const sha = mode === 'success-b' ? HEAD_B : HEAD_A;
        const conclusion = mode === 'failing-a' ? 'failure' : 'success';
        const runId = isProbe ? 1 : Number(mode.endsWith('b') ? '9102' : '9101');
        return jsonResponse(200, {
          total_count: 1,
          workflow_runs: [
            { id: runId, name: 'repository-contract', head_sha: sha, status: 'completed', conclusion, created_at: new Date(T0 - knobs.dataAgeMs).toISOString(), updated_at: new Date(T0 - knobs.dataAgeMs + 15_000).toISOString() },
          ],
        });
      }
      if (url.includes('/repos/payswapdotorg/SOS-2.0/branches/main')) {
        count('github:branch-probe');
        if (knobs.branchProbe === 'fail') {
          throw new Error(`transport failure for GET ${url}: fetch failed (connect ETIMEDOUT api.github.com:443)`);
        }
        if (knobs.branchProbe === 'empty') {
          return notFound();
        }
        const sha = knobs.branchProbe === 'head-b' ? HEAD_B : HEAD_A;
        return jsonResponse(200, { name: 'main', commit: { sha } });
      }
      throw new Error(`no scripted route for ${request.method} ${url}`);
    },
  };
  return world;
}

/** The instant sleep (offline determinism). */
export const instantSleep = async (): Promise<void> => {};
