/**
 * P17-C deterministic reference-mode acceptance suite (4/6): the LIVE
 * UX projections — the real observation plane's output flows into the
 * live-mission view models with LIVE provenance (never DEMO), honest
 * source states, retained uncertainty and the six-question review
 * structure; and the action envelopes derived FROM the live data execute
 * through the real gateway (the deterministic UI wiring evidence).
 */

import { describe, expect, it } from 'vitest';
import { ManualClock } from '@sos-2/live-store';
import { ActionGateway, InMemoryAuthority, InMemoryEventLog, InMemoryEvidenceSink, InMemoryIdempotencyStore, ReferenceExecutor, ReferenceRollbackVerifier, ReferenceWorld } from '@sos-2/action-gateway';
import { aggregateProviderHealth, createRealObservationPlane } from '@sos-2/real-observation';
import type { FetchPort, HttpRequest, HttpResponse } from '@sos-2/real-observation';
import { emptyLiveObservation, liveObservationFromDrain } from '@live-mission/dto';
import { heroView, sortedSources, sourceRowView } from '@live-mission/view';
import { promotionEnvelope, summonBodyEnvelope } from '@live-mission/envelopes';

const T0 = Date.parse('2026-09-25T12:00:00Z');
const HEAD_AFTER = '711cfd60b7eb90b338a8ce17cadcafb72a0d1e6e';

function response(status: number, body: unknown): HttpResponse {
  return { status, headers: { 'x-github-media-type': 'github.v3; format=json' }, body: JSON.stringify(body) };
}

const SCRIPTED: FetchPort = async (request: HttpRequest): Promise<HttpResponse> => {
  if (request.url.includes('/branches/main')) {
    return response(200, { name: 'main', commit: { sha: HEAD_AFTER } });
  }
  if (request.url.includes('/repos/payswapdotorg/SOS-2.0/events')) {
    return response(200, [{ id: 'evt-0001', type: 'PushEvent', created_at: '2026-09-25T11:58:00Z', payload: { ref: 'refs/heads/main', head: HEAD_AFTER, before: 'b' } }]);
  }
  if (request.url.includes('/actions/runs')) {
    return response(200, { workflow_runs: [{ id: 9101, name: 'repository-contract', head_sha: HEAD_AFTER, status: 'completed', conclusion: 'success', created_at: '2026-09-25T11:59:30Z', updated_at: '2026-09-25T11:59:45Z' }] });
  }
  if (request.url.includes('/rate_limit')) {
    return response(200, { resources: { core: { limit: 5000, used: 5, remaining: 4995, reset: 1 } } });
  }
  if (request.url.includes('/v6/deployments')) {
    return response(200, { deployments: [] });
  }
  if (request.url.includes('/pipeline')) {
    return response(200, [{ result: 'PONG' }, { result: 0 }]);
  }
  throw new Error(`no route for ${request.url}`);
};

async function drainedPlane() {
  const clock = new ManualClock(T0);
  const plane = createRealObservationPlane({
    clock,
    fetch: SCRIPTED,
    github: { owner: 'payswapdotorg', repo: 'SOS-2.0', branch: 'main', token: 'ghp_scripted', tokenEnvName: 'PAYSWAP_GITHUB_TOKEN' },
    vercel: { token: 'vcp_scripted', tokenEnvName: 'PAYSWAP_VERCEL_TOKEN' },
    upstash: { restUrl: 'https://scripted.upstash.io', token: 'upstash_scripted', tokenEnvName: 'UPSTASH_REDIS_REST_TOKEN' },
    webhookSecret: { secret: 'whsec_scripted', secretEnvName: 'PAYSWAP_GITHUB_WEBHOOK_SECRET' },
    claims: { readClaims: async () => [{ subject: 'github:repo:payswapdotorg/SOS-2.0@main', claimedRevision: HEAD_AFTER, claimRef: 'claim:main' }] },
  });
  const report = await plane.drain();
  const data = liveObservationFromDrain({
    report,
    connectivity: { sources: plane.connectivity().map((record) => ({ ...record, probes: record.probes.map((probe) => ({ apiRevision: probe.apiRevision })) })) },
    repositorySubject: plane.subjects.repository,
    storeRef: 'live-store:observation-events',
    asOf: new Date(T0).toISOString(),
    eventsInWindow: report.sourceSummaries.reduce((total, summary) => total + summary.applied, 0),
    watchingWithoutBody: true,
  });
  return { plane, report, data };
}

describe('the live-mission view projections over the real plane output', () => {
  it('carries LIVE provenance (store_ref + as_of) — never the DEMO fixture marker', async () => {
    const { data } = await drainedPlane();
    expect(data.storeRef).toBe('live-store:observation-events');
    const hero = heroView(data);
    expect(hero.data_source).toEqual({ kind: 'LIVE', store_ref: 'live-store:observation-events', as_of: '2026-09-25T12:00:00.000Z' });
  });

  it('surfaces the honest source states from the real probe records', async () => {
    const { data } = await drainedPlane();
    const states = new Map(sortedSources(data.sources).map((source) => [source.source, source.state]));
    expect(states.get('github:rest-events:payswapdotorg/SOS-2.0')).toBe('CONNECTED');
    expect(states.get('ci:github-actions:payswapdotorg/SOS-2.0')).toBe('CONNECTED');
    expect(states.get('deploy:vercel')).toBe('CONNECTED');
    expect(states.get('github:rate-limit')).toBe('CONNECTED');
    expect(states.get('upstash:redis')).toBe('CONNECTED');
    // API revisions surface for evidence
    expect(data.sources.find((source) => source.family === 'github')?.apiRevision).toContain('github.v3');
  });

  it('keeps retained uncertainty visible (findings + freshness + review core)', async () => {
    const { data } = await drainedPlane();
    expect(data.findings).toEqual([expect.objectContaining({ kind: 'ALIGNED', subject: 'github:repo:payswapdotorg/SOS-2.0@main', observedRevision: HEAD_AFTER })]);
    const hero = heroView(data);
    expect(hero.review.what).toContain('drained at');
    expect(hero.review.uncertainty).toContain('Repository data is FRESH');
    expect(hero.review.evidence.length).toBeGreaterThan(0);
  });

  it('serializes the whole view (no Maps — plain JSON across the boundary)', async () => {
    const { data } = await drainedPlane();
    const serialized = JSON.parse(JSON.stringify(data));
    expect(serialized.repository.branchHeads[0].head).toBe(HEAD_AFTER);
    expect(serialized.ci.latestByPipeline[0].status).toBe('SUCCESS');
  });

  it('renders the honest UNKNOWN state before any drain (never fabricated)', () => {
    const empty = emptyLiveObservation('live-store:observation-events', 'never', 'github:repo:payswapdotorg/SOS-2.0');
    const hero = heroView(empty);
    expect(hero.anySourceConnected).toBe(false);
    expect(hero.review.what).toContain('No live observation drain has run yet');
    expect(hero.review.uncertainty).toContain('Repository data is NO_DATA');
    expect(sourceRowView({ source: 'x', provider: 'p', family: 'f', state: 'UNKNOWN', detail: 'never probed', lastError: null, lastProbedAt: null, apiRevision: null }).stateLabel).toContain('never probed');
  });
});

describe('the deterministic UI wiring evidence: live data -> action envelopes -> real gateway -> receipts', () => {
  it('derives the summon-body action from the LIVE branch head and executes it through the gateway with an authority grant', async () => {
    const { data } = await drainedPlane();
    const head = data.repository.branchHeads.find((branch) => branch.branch === 'main')!;
    expect(head.head).toBe(HEAD_AFTER);
    // The ActionPanel derivation: the envelope acts on the observed revision
    const envelope = summonBodyEnvelope({ actorId: 'console-user', bodyId: 'cloud-sandbox-1', baseSha: head.head, actionId: 'live-action-summon-1', idempotencyKey: 'idem-ui-1', requestedAt: T0 });
    const authority = new InMemoryAuthority();
    authority.grant('console-user', 'body-lifecycle', 'cloud-sandbox-1');
    const world = new ReferenceWorld();
    const gateway = new ActionGateway({
      clock: { now: () => T0 },
      authority,
      executors: [new ReferenceExecutor(world)],
      idempotency: new InMemoryIdempotencyStore(),
      events: new InMemoryEventLog(),
      evidence: new InMemoryEvidenceSink(),
      rollbackVerifier: new ReferenceRollbackVerifier(world),
    });
    const outcome = gateway.execute(envelope);
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('SUCCEEDED');
      expect(outcome.receipt.sourceRevision).toBe(HEAD_AFTER);
    }
    expect(world.bodies.get('cloud-sandbox-1')).toBe('RUNNING');
  });

  it('the same derivation WITHOUT a grant fails CLOSED — the UI cannot act without authority', async () => {
    const { data } = await drainedPlane();
    const head = data.repository.branchHeads.find((branch) => branch.branch === 'main')!;
    const envelope = promotionEnvelope({ actorId: 'console-user', fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: head.head, actionId: 'live-action-promote-1', idempotencyKey: 'idem-ui-2', requestedAt: T0 });
    const world = new ReferenceWorld();
    const gateway = new ActionGateway({
      clock: { now: () => T0 },
      authority: new InMemoryAuthority(),
      executors: [new ReferenceExecutor(world)],
      idempotency: new InMemoryIdempotencyStore(),
      events: new InMemoryEventLog(),
      evidence: new InMemoryEvidenceSink(),
      rollbackVerifier: new ReferenceRollbackVerifier(world),
    });
    const outcome = gateway.execute(envelope);
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('DENIED');
    }
    expect(world.activeByEnvironment.get('production')).toBeUndefined();
  });
});
