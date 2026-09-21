/**
 * @sos-2/observation unit contract tests: projection folds (branch heads,
 * open PRs, CI latest runs, deployments, provider health), reconciliation
 * findings, and detection codes. (Journey acceptance lives in
 * tests/observation.)
 */

import { describe, expect, it } from 'vitest';
import { createInMemoryLiveStore, ManualClock } from '@sos-2/live-store';
import type { ObservationEventInput } from '@sos-2/live-store';
import { EventIngestionPipeline } from '@sos-2/event-ingestion';
import { ObservationProjections, reconcileClaims, DetectionEngine } from '../src/index.js';
import type { FreshnessMark, ObservedRevision, StateRevisionClaim, SubjectQuery } from '../src/index.js';

const T0 = Date.parse('2026-09-21T12:05:00Z');
const REPO = 'github:repo:payswapdotorg/SOS-2.0';
const GITHUB_WEBHOOK = 'github:webhook:payswapdotorg/SOS-2.0';
const CI_SOURCE = 'ci:github-actions:payswapdotorg/SOS-2.0';
const DEPLOYMENT_SOURCE = 'deploy:tracker:production';
const PROVIDER_HEALTH_SOURCE = 'status:page:aggregate';

async function storeWith(events: readonly ObservationEventInput[]) {
  const store = createInMemoryLiveStore();
  const pipeline = new EventIngestionPipeline({ observationEvents: store.observationEvents, clock: new ManualClock(T0) });
  for (const event of events) {
    await pipeline.ingest(event);
  }
  return store;
}

function projectionsOver(store: ReturnType<typeof createInMemoryLiveStore>, freshAfterMs = 600_000) {
  const repositorySubject: SubjectQuery = { subject: REPO, sources: [GITHUB_WEBHOOK] };
  const ciSubject: SubjectQuery = { subject: REPO, sources: [CI_SOURCE] };
  const deploymentSubject: SubjectQuery = { subject: REPO, sources: [DEPLOYMENT_SOURCE] };
  return new ObservationProjections({
    observationEvents: store.observationEvents,
    clock: new ManualClock(T0),
    freshAfterMs,
    repositorySubjects: [repositorySubject],
    ciSubjects: [ciSubject],
    deploymentSubjects: [deploymentSubject],
    providerHealthSources: [PROVIDER_HEALTH_SOURCE],
  });
}

describe('repository head fold', () => {
  it('applies pushes in chronological order and tracks open/closed PRs with evidence ids', async () => {
    const store = await storeWith([
      { id: 'e1', source: GITHUB_WEBHOOK, kind: 'github.push', occurred_at: '2026-09-21T11:50:00Z', payload: { ref: 'refs/heads/main', before: 'a', after: 'b' }, provenance: ['t'] },
      { id: 'e2', source: GITHUB_WEBHOOK, kind: 'github.push', occurred_at: '2026-09-21T11:58:00Z', payload: { ref: 'refs/heads/main', before: 'b', after: 'c' }, provenance: ['t'] },
      { id: 'e3', source: GITHUB_WEBHOOK, kind: 'github.pull_request', occurred_at: '2026-09-21T11:59:00Z', payload: { action: 'opened', number: 7, head: 'h7', base: 'main' }, provenance: ['t'] },
      { id: 'e4', source: GITHUB_WEBHOOK, kind: 'github.pull_request', occurred_at: '2026-09-21T12:00:00Z', payload: { action: 'closed', number: 7, head: 'h7', base: 'main' }, provenance: ['t'] },
      { id: 'e5', source: GITHUB_WEBHOOK, kind: 'github.pull_request', occurred_at: '2026-09-21T12:01:00Z', payload: { action: 'opened', number: 8, head: 'h8', base: 'main' }, provenance: ['t'] },
    ]);
    const snapshot = await projectionsOver(store).snapshot();
    const repository = snapshot.repositoryHeads.get(REPO);
    expect(repository?.branchHeads['main']).toBe('c');
    expect(repository?.openPullRequests.map((pull) => pull.number)).toEqual([8]);
    expect(repository?.foldedEventIds).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    expect(repository?.malformedEvents).toBe(0);
    expect(repository?.freshness.state).toBe('FRESH');
  });

  it('events from non-wired sources do not project (composition wiring is explicit)', async () => {
    const store = await storeWith([
      { id: 'x1', source: 'github:webhook:other/repo', kind: 'github.push', occurred_at: '2026-09-21T11:50:00Z', payload: { ref: 'refs/heads/main', before: 'a', after: 'zzz' }, provenance: ['t'] },
    ]);
    const snapshot = await projectionsOver(store).snapshot();
    const repository = snapshot.repositoryHeads.get(REPO);
    expect(repository?.branchHeads['main']).toBeUndefined();
    expect(repository?.freshness.state).toBe('NO_DATA');
  });
});

describe('ci + deployment folds', () => {
  it('latest run per pipeline by (occurred_at, runId); latest deployment per environment', async () => {
    const store = await storeWith([
      { id: 'c1', source: CI_SOURCE, kind: 'ci.run', occurred_at: '2026-09-21T11:40:00Z', payload: { pipeline: 'contract', ref: 'b', status: 'SUCCESS', runId: 'r1' }, provenance: ['t'] },
      { id: 'c2', source: CI_SOURCE, kind: 'ci.run', occurred_at: '2026-09-21T11:50:00Z', payload: { pipeline: 'contract', ref: 'c', status: 'FAILURE', runId: 'r2' }, provenance: ['t'] },
      { id: 'd1', source: DEPLOYMENT_SOURCE, kind: 'deployment.change', occurred_at: '2026-09-21T11:00:00Z', payload: { environment: 'production', revision: 'rev-1', action: 'deployed' }, provenance: ['t'] },
      { id: 'd2', source: DEPLOYMENT_SOURCE, kind: 'deployment.change', occurred_at: '2026-09-21T11:30:00Z', payload: { environment: 'production', revision: 'rev-2', action: 'deployed' }, provenance: ['t'] },
      { id: 'h1', source: PROVIDER_HEALTH_SOURCE, kind: 'provider-health.signal', occurred_at: '2026-09-21T11:45:00Z', payload: { provider: 'github', status: 'HEALTHY' }, provenance: ['t'] },
    ]);
    const snapshot = await projectionsOver(store).snapshot();
    expect(snapshot.ci.get(REPO)?.latestByPipeline['contract']?.runId).toBe('r2');
    expect(snapshot.deployments.get(REPO)?.deployedByEnvironment['production']?.revision).toBe('rev-2');
    expect(snapshot.providerHealth.lastSignalByProvider['github']?.status).toBe('HEALTHY');
  });
});

describe('reconciliation', () => {
  const claim: StateRevisionClaim = { subject: 's1', claimedRevision: 'sha-a', claimRef: 'ref' };
  const detectedAt = '2026-09-21T12:05:00Z';

  function observed(subject: string, revision: string | null, state: FreshnessMark['state']): ObservedRevision {
    return { subject, revision, lastEventAt: revision === null ? null : '2026-09-21T11:59:00Z', freshness: { state, lastEventAt: '2026-09-21T11:59:00Z', evaluatedAt: detectedAt, freshAfterMs: 600_000 }, evidenceEventIds: ['e1'] };
  }

  it('ALIGNED when fresh and equal; DIVERGED when fresh and different', () => {
    const findings = reconcileClaims([claim, { ...claim, subject: 's2' }], [observed('s1', 'sha-a', 'FRESH'), observed('s2', 'sha-b', 'FRESH')], detectedAt);
    expect(findings[0]?.kind).toBe('ALIGNED');
    expect(findings[1]?.kind).toBe('DIVERGED');
    expect(findings[1]?.observedRevision).toBe('sha-b');
  });

  it('STALE and UNVERIFIED are their own truthful kinds — never folded into aligned/diverged', () => {
    const stale = reconcileClaims([claim], [observed('s1', 'sha-a', 'STALE')], detectedAt);
    expect(stale[0]?.kind).toBe('STALE');
    const unverified = reconcileClaims([claim], [], detectedAt);
    expect(unverified[0]?.kind).toBe('UNVERIFIED');
    const noData = reconcileClaims([claim], [observed('s1', null, 'NO_DATA')], detectedAt);
    expect(noData[0]?.kind).toBe('UNVERIFIED');
  });
});

describe('detection', () => {
  it('CI_FAILING_ON_HEAD + DEPLOYED_NOT_AT_HEAD + STATE_DIVERGED fire with evidence; aligned claims stay silent', async () => {
    const store = await storeWith([
      { id: 'p1', source: GITHUB_WEBHOOK, kind: 'github.push', occurred_at: '2026-09-21T11:58:00Z', payload: { ref: 'refs/heads/main', before: 'a', after: 'head-1' }, provenance: ['t'] },
      { id: 'c1', source: CI_SOURCE, kind: 'ci.run', occurred_at: '2026-09-21T11:59:00Z', payload: { pipeline: 'contract', ref: 'head-1', status: 'FAILURE', runId: 'r1' }, provenance: ['t'] },
      { id: 'd1', source: DEPLOYMENT_SOURCE, kind: 'deployment.change', occurred_at: '2026-09-21T11:00:00Z', payload: { environment: 'production', revision: 'older-1', action: 'deployed' }, provenance: ['t'] },
    ]);
    const snapshot = await projectionsOver(store).snapshot();
    const engine = new DetectionEngine({
      headRevisionOf: (subject, snap) => {
        const head = snap.repositoryHeads.get(subject)?.branchHeads['main'];
        return head === undefined ? null : { revision: head, evidenceEventIds: snap.repositoryHeads.get(subject)?.foldedEventIds ?? [] };
      },
      deployedRevisionOf: (subject, environment, snap) => {
        const deployed = snap.deployments.get(subject)?.deployedByEnvironment[environment];
        return deployed === undefined ? null : { revision: deployed.revision, evidenceEventIds: snap.deployments.get(subject)?.foldedEventIds ?? [] };
      },
      primaryEnvironment: 'production',
      repositorySubjects: [REPO],
    });
    const findings = reconcileClaims(
      [
        { subject: REPO, claimedRevision: 'head-1', claimRef: 'r' },
        { subject: 'deploy:environment:production', claimedRevision: 'head-1', claimRef: 'r' },
      ],
      [
        { subject: REPO, revision: 'head-1', lastEventAt: '2026-09-21T11:58:00Z', freshness: { state: 'FRESH', lastEventAt: '2026-09-21T11:58:00Z', evaluatedAt: 'x', freshAfterMs: 600_000 }, evidenceEventIds: ['p1'] },
        { subject: 'deploy:environment:production', revision: 'older-1', lastEventAt: '2026-09-21T11:00:00Z', freshness: { state: 'FRESH', lastEventAt: '2026-09-21T11:00:00Z', evaluatedAt: 'x', freshAfterMs: 600_000 }, evidenceEventIds: ['d1'] },
      ],
      '2026-09-21T12:05:00Z',
    );
    const detections = engine.detect(snapshot, findings, '2026-09-21T12:05:00Z');
    const codes = detections.map((detection) => detection.code).sort();
    expect(codes).toEqual(['CI_FAILING_ON_HEAD', 'DEPLOYED_NOT_AT_HEAD', 'STATE_DIVERGED']);
    for (const detection of detections) {
      expect(detection.evidenceEventIds.length).toBeGreaterThan(0);
    }
  });
});
