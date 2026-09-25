/**
 * P17-C deterministic reference-mode acceptance suite (1/6):
 * SOURCE → PLANE → SYSTEM STATE contract compliance.
 *
 * The COMPLETE real-observation composition (createRealObservationPlane)
 * runs against a scripted FetchPort — zero network, zero ambient time
 * (ManualClock), run-to-run identical. Pins:
 *  - the full event flow: real-source envelopes → merged P7 pipeline →
 *    durable events → live projections → read-only claims reconciliation;
 *  - the event SHAPES (github.push / github.pull_request / ci.run /
 *    deployment.change / telemetry.observation / provider-health.signal /
 *    scheduled-probe.result) with payloads preserved verbatim;
 *  - replay protection across drains (redelivery is typed DUPLICATE,
 *    never double-applied);
 *  - the NO-BODY plane rule (task + body-lease stores stay EMPTY through
 *    full drains — §5);
 *  - the plane writes ONLY the observation-event store;
 *  - System State reconciliation: ALIGNED / DIVERGED / STALE truthfully;
 *  - the probe fallback: runs while organic coverage is insufficient,
 *    stands down (SKIPPED_COVERED) once coverage is fresh.
 */

import { describe, expect, it } from 'vitest';
import { ManualClock } from '@sos-2/live-store';
import { createRealObservationPlane } from '@sos-2/real-observation';
import type { FetchPort, HttpRequest, HttpResponse } from '@sos-2/real-observation';

const T0 = Date.parse('2026-09-25T12:00:00Z');
const HEAD_BEFORE = '19c1bf26fdd2a23aabb9df2ae0f8a07095684ed4';
const HEAD_AFTER = '711cfd60b7eb90b338a8ce17cadcafb72a0d1e6e';
const CI_SHA = HEAD_AFTER;
const DEPLOY_REVISION = '740bc37c75';

function githubJson(status: number, body: unknown): HttpResponse {
  return { status, headers: { 'x-github-media-type': 'github.v3; format=json', 'x-github-request-id': 'req-1', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4999' }, body: JSON.stringify(body) };
}

/** The full scripted provider world: every endpoint the composition touches. */
function scriptedWorld(options?: { eventsStatus?: number; ciStatus?: number; vercelStatus?: number }): FetchPort {
  const eventsStatus = options?.eventsStatus ?? 200;
  const ciStatus = options?.ciStatus ?? 200;
  const vercelStatus = options?.vercelStatus ?? 200;
  return async (request: HttpRequest): Promise<HttpResponse> => {
    if (request.url.includes('/repos/payswapdotorg/SOS-2.0/events')) {
      if (eventsStatus !== 200) {
        return githubJson(eventsStatus, { message: 'scripted failure' });
      }
      return githubJson(200, [
        {
          id: 'evt-0001',
          type: 'PushEvent',
          created_at: '2026-09-25T11:58:00Z',
          payload: { ref: 'refs/heads/main', head: HEAD_AFTER, before: HEAD_BEFORE },
        },
        {
          id: 'evt-0002',
          type: 'PullRequestEvent',
          created_at: '2026-09-25T11:59:00Z',
          payload: { action: 'opened', number: 27, pull_request: { head: { sha: 'pr-head-sha' }, base: { ref: 'main' } } },
        },
        {
          id: 'evt-0003',
          type: 'CreateEvent',
          created_at: '2026-09-25T12:00:00Z',
          payload: { ref: 'wo/x', ref_type: 'branch' },
        },
      ]);
    }
    if (request.url.includes('/actions/runs')) {
      if (ciStatus !== 200) {
        return githubJson(ciStatus, { message: 'scripted failure' });
      }
      return githubJson(200, {
        workflow_runs: [
          { id: 9101, name: 'repository-contract', head_sha: CI_SHA, status: 'completed', conclusion: 'success', created_at: '2026-09-25T11:59:30Z', updated_at: '2026-09-25T11:59:45Z' },
          { id: 9102, name: 'verify', head_sha: CI_SHA, status: 'in_progress', conclusion: null, created_at: '2026-09-25T11:59:50Z', updated_at: '2026-09-25T12:00:10Z' },
        ],
      });
    }
    if (request.url.includes('/branches/main')) {
      return githubJson(200, { name: 'main', commit: { sha: HEAD_AFTER } });
    }
    if (request.url.includes('/rate_limit')) {
      return githubJson(200, { resources: { core: { limit: 5000, used: 10, remaining: 4990, reset: 1790346912 } } });
    }
    if (request.url.includes('/v6/deployments')) {
      if (vercelStatus !== 200) {
        return { status: vercelStatus, headers: { 'x-vercel-id': 'v1' }, body: JSON.stringify({ error: 'scripted failure' }) };
      }
      return {
        status: 200,
        headers: { 'x-vercel-id': 'v1' },
        body: JSON.stringify({
          deployments: [
            { uid: 'dpl_1', readyState: 'READY', created: Date.parse('2026-09-21T11:55:00Z'), target: null, source: 'git', meta: { githubCommitSha: DEPLOY_REVISION, githubCommitRepo: 'SOS-2.0' } },
            { uid: 'dpl_2', readyState: 'BUILDING', created: Date.parse('2026-09-25T12:00:00Z'), target: 'preview', source: 'git', meta: { githubCommitSha: 'not-yet', githubCommitRepo: 'SOS-2.0' } },
            { uid: 'dpl_3', readyState: 'READY', created: Date.parse('2026-09-25T10:00:00Z'), target: 'production', source: 'git', meta: { githubCommitSha: 'another-repos-sha', githubCommitRepo: 'RoamLink' } },
          ],
        }),
      };
    }
    if (request.url.includes('/pipeline')) {
      return { status: 200, headers: {}, body: JSON.stringify([{ result: 'PONG' }, { result: 20 }]) };
    }
    throw new Error(`scripted world: no route for ${request.url}`);
  };
}

interface Composed {
  plane: ReturnType<typeof createRealObservationPlane>;
  clock: ManualClock;
}

function compose(
  claims: readonly { subject: string; claimedRevision: string; claimRef: string }[],
  options?: { fetch?: FetchPort; freshAfterMs?: number },
): Composed {
  const clock = new ManualClock(T0);
  const plane = createRealObservationPlane({
    clock,
    fetch: options?.fetch ?? scriptedWorld(),
    github: { owner: 'payswapdotorg', repo: 'SOS-2.0', branch: 'main', token: 'ghp_scripted', tokenEnvName: 'PAYSWAP_GITHUB_TOKEN' },
    vercel: { token: 'vcp_scripted', tokenEnvName: 'PAYSWAP_VERCEL_TOKEN' },
    upstash: { restUrl: 'https://scripted.upstash.io', token: 'upstash_scripted', tokenEnvName: 'UPSTASH_REDIS_REST_TOKEN' },
    webhookSecret: { secret: 'whsec_scripted', secretEnvName: 'PAYSWAP_GITHUB_WEBHOOK_SECRET' },
    claims: { readClaims: async () => claims },
    freshAfterMs: options?.freshAfterMs ?? 600_000,
  });
  return { plane, clock };
}

describe('the full source → plane → System State flow (deterministic reference mode)', () => {
  it('drains every real source into the merged plane and projects live state with NO body', async () => {
    const { plane } = compose([{ subject: 'github:repo:payswapdotorg/SOS-2.0@main', claimedRevision: HEAD_AFTER, claimRef: 'claim:main' }]);
    const report = await plane.drain();

    // every organic source polled and applied its envelopes
    const summaries = report.sourceSummaries.map((summary) => ({ source: summary.source, applied: summary.applied, poll: summary.poll.kind }));
    expect(summaries).toEqual([
      { source: 'github:rest-events:payswapdotorg/SOS-2.0', applied: 2, poll: 'POLLED' },
      { source: 'ci:github-actions:payswapdotorg/SOS-2.0', applied: 2, poll: 'POLLED' },
      { source: 'deploy:vercel', applied: 1, poll: 'POLLED' },
      { source: 'provider-health:real-probes', applied: 3, poll: 'POLLED' },
    ]);

    // the NO-BODY rule: no task, no body lease — observation is the whole plane
    const tasks = await plane.store.tasks.list({});
    const leases = await plane.store.bodyLeases.list({});
    expect(tasks.items).toEqual([]);
    expect(leases.items).toEqual([]);

    // repository projection: the push moved the branch head; the PR opened
    const repository = report.snapshot.repositoryHeads.get('github:repo:payswapdotorg/SOS-2.0');
    expect(repository?.branchHeads['main']).toBe(HEAD_AFTER);
    expect(repository?.openPullRequests).toEqual([{ number: 27, head: 'pr-head-sha', base: 'main', openedAt: '2026-09-25T11:59:00Z' }]);
    expect(repository?.freshness.state).toBe('FRESH');

    // CI projection: latest run per pipeline, statuses verbatim (SUCCESS + IN_PROGRESS, never folded)
    const ci = report.snapshot.ci.get('github:repo:payswapdotorg/SOS-2.0');
    expect(ci?.latestByPipeline['repository-contract']).toMatchObject({ runId: '9101', status: 'SUCCESS' });
    expect(ci?.latestByPipeline['verify']).toMatchObject({ runId: '9102', status: 'IN_PROGRESS' });

    // deployment projection: ONLY the READY deployment (the BUILDING one never fabricated)
    const deployments = report.snapshot.deployments.get('github:repo:payswapdotorg/SOS-2.0');
    expect(deployments?.deployedByEnvironment['production']).toMatchObject({ revision: DEPLOY_REVISION });
    expect(Object.keys(deployments?.deployedByEnvironment ?? {})).toEqual(['production']);

    // provider health projection: the real probes' honest signals
    const health = report.snapshot.providerHealth.lastSignalByProvider;
    expect(health['github']?.status).toBe('HEALTHY');
    expect(health['vercel']?.status).toBe('HEALTHY');
    expect(health['upstash']?.status).toBe('HEALTHY');

    // System State reconciliation: the claim is ALIGNED with the observed head
    expect(report.findings).toEqual([
      expect.objectContaining({ kind: 'ALIGNED', subject: 'github:repo:payswapdotorg/SOS-2.0@main', claimedRevision: HEAD_AFTER, observedRevision: HEAD_AFTER }),
    ]);
  });

  it('reports DIVERGED when the System State claim does not match the real observed revision', async () => {
    const { plane } = compose([{ subject: 'github:repo:payswapdotorg/SOS-2.0@main', claimedRevision: HEAD_BEFORE, claimRef: 'claim:stale' }]);
    const report = await plane.drain();
    expect(report.findings[0]).toMatchObject({ kind: 'DIVERGED', claimedRevision: HEAD_BEFORE, observedRevision: HEAD_AFTER });
  });

  it('reports STALE (never ALIGNED) when observation is older than the freshness window and the fallback probe cannot refresh it', async () => {
    // Stateful world: healthy on the first drain; after the window passes,
    // the branch endpoint fails so the probe honestly cannot refresh — the
    // projection stays stale and the finding is STALE (never folded into
    // ALIGNED).
    let branchEndpointHealthy = true;
    const stateful: FetchPort = async (request: HttpRequest): Promise<HttpResponse> => {
      if (request.url.includes('/branches/main')) {
        return branchEndpointHealthy ? githubJson(200, { name: 'main', commit: { sha: HEAD_AFTER } }) : githubJson(500, { message: 'scripted outage' });
      }
      return scriptedWorld()(request);
    };
    const { plane, clock } = compose([{ subject: 'github:repo:payswapdotorg/SOS-2.0@main', claimedRevision: HEAD_AFTER, claimRef: 'claim:main' }], { fetch: stateful });
    await plane.drain();
    branchEndpointHealthy = false;
    clock.advance(600_001);
    const report = await plane.drain();
    expect(report.findings[0]).toMatchObject({ kind: 'STALE', observedRevision: HEAD_AFTER });
    // the probe honestly FAILED (never fabricated a refresh)
    expect(report.probeOutcomes).toContainEqual(expect.objectContaining({ probeId: 'probe-repo-head:payswapdotorg/SOS-2.0@main', kind: 'FAILED' }));
  });

  it('reports UNVERIFIED when no observation is wired for a claim subject', async () => {
    const { plane } = compose([{ subject: 'not:wired:anywhere', claimedRevision: 'x', claimRef: 'claim:unwired' }]);
    const report = await plane.drain();
    expect(report.findings[0]).toMatchObject({ kind: 'UNVERIFIED' });
  });

  it('preserves payload truth states VERBATIM end-to-end (durable events carry the exact payloads)', async () => {
    const { plane } = compose([{ subject: 'github:repo:payswapdotorg/SOS-2.0@main', claimedRevision: HEAD_AFTER, claimRef: 'claim:main' }]);
    await plane.drain();
    const stored = await plane.store.observationEvents.get('github:rest-events:payswapdotorg/SOS-2.0:evt-0001');
    expect(stored).toMatchObject({
      id: 'github:rest-events:payswapdotorg/SOS-2.0:evt-0001',
      source: 'github:rest-events:payswapdotorg/SOS-2.0',
      kind: 'github.push',
      occurred_at: '2026-09-25T11:58:00Z',
      payload: { ref: 'refs/heads/main', before: HEAD_BEFORE, after: HEAD_AFTER },
      provenance: ['github-rest:events:payswapdotorg/SOS-2.0', 'api:github.v3'],
    });
    const telemetry = await plane.store.observationEvents.list({ limit: 1000 });
    const telemetryEvents = telemetry.items.filter((event) => event.kind === 'telemetry.observation');
    expect(telemetryEvents.length).toBeGreaterThanOrEqual(2);
    const rateLimit = telemetryEvents.find((event) => (event.payload as Record<string, unknown>)['subject_ref'] === 'telemetry:github:rate-limit:core');
    expect(rateLimit?.payload).toMatchObject({ subject_ref: 'telemetry:github:rate-limit:core', availability: 'SUCCESS' });
    const redis = telemetryEvents.find((event) => (event.payload as Record<string, unknown>)['subject_ref'] === 'telemetry:upstash:redis');
    expect(redis?.payload).toMatchObject({ subject_ref: 'telemetry:upstash:redis', availability: 'SUCCESS' });
  });

  it('replay protection: a second identical drain double-applies NOTHING (typed DUPLICATE)', async () => {
    const { plane } = compose([{ subject: 'github:repo:payswapdotorg/SOS-2.0@main', claimedRevision: HEAD_AFTER, claimRef: 'claim:main' }]);
    await plane.drain();
    const report = await plane.drain();
    for (const summary of report.sourceSummaries) {
      expect(summary.applied).toBe(0);
      expect(summary.duplicates).toBeGreaterThan(0);
    }
    const all = await plane.store.observationEvents.list({ limit: 1000 });
    const githubEvents = all.items.filter((event) => event.source === 'github:rest-events:payswapdotorg/SOS-2.0');
    expect(githubEvents).toHaveLength(2);
  });

  it('the plane writes ONLY the observation-event store (no semantic mutation anywhere else)', async () => {
    const { plane } = compose([{ subject: 'github:repo:payswapdotorg/SOS-2.0@main', claimedRevision: HEAD_AFTER, claimRef: 'claim:main' }]);
    await plane.drain();
    const families = [
      plane.store.missions,
      plane.store.contexts,
      plane.store.systemStates,
      plane.store.evidence,
      plane.store.architecture,
      plane.store.candidates,
      plane.store.assurance,
      plane.store.experiments,
      plane.store.decisions,
      plane.store.authorityGrants,
      plane.store.packages,
    ] as const;
    for (const family of families) {
      const result = await family.list({});
      expect(result.items).toEqual([]);
    }
  });

  it('the scheduled probe runs while organic coverage is insufficient, then STANDS DOWN when coverage is fresh', async () => {
    // A world where the events polling FAILS (source down): the organic github
    // family has no coverage, so the repo-head probe is due and fills it.
    const { plane } = compose([{ subject: 'github:repo:payswapdotorg/SOS-2.0@main', claimedRevision: HEAD_AFTER, claimRef: 'claim:main' }], { fetch: scriptedWorld({ eventsStatus: 401 }) });
    const report = await plane.drain();
    expect(
      report.probeOutcomes.some((outcome) => outcome.probeId === 'probe-repo-head:payswapdotorg/SOS-2.0@main' && outcome.kind === 'RAN'),
    ).toBe(true);
    // The probe filled the branch head: the claim reconciles ALIGNED through probe evidence
    expect(report.findings[0]).toMatchObject({ kind: 'ALIGNED', observedRevision: HEAD_AFTER });
    expect(report.findings[0]!.evidenceEventIds.some((id) => id.startsWith('scheduled-probe:probe-repo-head'))).toBe(true);

    // Now a healthy world: organic pushes are FRESH, the probe stands down.
    const healthy = compose([{ subject: 'github:repo:payswapdotorg/SOS-2.0@main', claimedRevision: HEAD_AFTER, claimRef: 'claim:main' }]);
    const healthyReport = await healthy.plane.drain();
    expect(
      healthyReport.probeOutcomes.some((outcome) => outcome.probeId === 'probe-repo-head:payswapdotorg/SOS-2.0@main' && outcome.kind === 'SKIPPED_COVERED'),
    ).toBe(true);
  });

  it('a failed poll is a typed POLL_FAILED (never fabricated success) and the source is honestly UNAVAILABLE', async () => {
    const { plane } = compose([{ subject: 'github:repo:payswapdotorg/SOS-2.0@main', claimedRevision: HEAD_AFTER, claimRef: 'claim:main' }], { fetch: scriptedWorld({ eventsStatus: 401 }) });
    const report = await plane.drain();
    const eventsSummary = report.sourceSummaries.find((summary) => summary.source === 'github:rest-events:payswapdotorg/SOS-2.0');
    expect(eventsSummary?.poll).toMatchObject({ kind: 'POLL_FAILED' });
    const record = plane.connectivity().find((entry) => entry.source === 'github:rest-events:payswapdotorg/SOS-2.0');
    expect(record?.state).toBe('UNAVAILABLE');
    expect(record?.lastError).toContain('HTTP 401');
  });

  it('the webhook receiver feeds the SAME plane through the merged pipeline (one contract, two delivery shapes)', async () => {
    const { plane } = compose([]);
    const body = JSON.stringify({ ref: 'refs/heads/feature', before: 'b1', after: 'a1' });
    const signature = `sha256=${await import('node:crypto').then((crypto) => crypto.createHmac('sha256', 'whsec_scripted').update(body, 'utf8').digest('hex'))}`;
    const receipts = await plane.webhookReceiver.handleDelivery({
      method: 'POST',
      headers: { 'x-hub-signature-256': signature, 'x-github-delivery': 'delivery-77', 'x-github-event': 'push' },
      body,
    });
    expect(receipts[0]!.kind).toBe('INGESTED');
    const stored = await plane.store.observationEvents.get('github:webhook:delivery-77');
    expect(stored).toMatchObject({ kind: 'github.push', payload: { ref: 'refs/heads/feature', before: 'b1', after: 'a1' }, provenance: ['github-webhook:delivery:delivery-77'] });
    // the projection folds webhook-shaped events through the same wiring
    // (the composition wires the receiver's source into the repository subject)
    await plane.drain();
    const repository = (await plane.projections.snapshot()).repositoryHeads.get('github:repo:payswapdotorg/SOS-2.0');
    expect(repository?.branchHeads['feature']).toBe('a1');
  });
});
