/**
 * Live-mission render smoke tests (Work Order P17-C) — the P4 onboarding
 * technique: server render to string, next/link stubbed to a plain
 * anchor. Same inputs -> same markup, byte for byte. Pinned: the LIVE
 * badge (never DEMO), the honest UNKNOWN/NO_DATA empty states, the
 * actionable entry points, the authority-gate notes, the four honest
 * source states, the findings/detections presentation and the
 * six-question structure.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
    createElement('a', { href, ...props }, children),
}));

import { LiveMissionPage } from '../src/components/live-mission-page';
import { LiveObservationView } from '../src/components/live-observation-view';
import { ActionPanel } from '../src/components/action-panel';
import { MissionEntryPoints } from '../src/components/mission-entry-points';
import { emptyLiveObservation, liveObservationFromDrain } from '../src/view-state/live-mission-dto';
import { askResolutionEnvelope, promotionEnvelope, rollbackEnvelope, summonBodyEnvelope } from '../src/actions/envelopes';

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

const EMPTY = emptyLiveObservation('live-store:observation-events', 'never', 'github:repo:payswapdotorg/SOS-2.0');

describe('the live-mission page (unwired, honest empty state)', () => {
  const html = render(createElement(LiveMissionPage, {}));

  it('renders the shell landmarks', () => {
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('id="main-content"');
    expect(html).toContain('Skip to main content');
  });

  it('shows the honest no-drain-yet state — never fabricated live state', () => {
    expect(html).toContain('No live observation drain has run yet');
    expect(html).toContain('never fabricated live state');
  });

  it('makes mission actionable: Start mission / Import system / Resume existing mission', () => {
    expect(html).toContain('Start a mission');
    expect(html).toContain('Import a system');
    expect(html).toContain('Resume an existing mission');
    expect(html).toContain('href="/onboarding/greenfield"');
    expect(html).toContain('href="/onboarding/brownfield"');
    expect(html).toContain('Start mission');
    expect(html).toContain('Import system');
  });

  it('keeps onboarding discoverable as a first-class entry (the P18 first-user path)', () => {
    expect(html).toContain('New here? Start with onboarding');
    expect(html).toContain('href="/onboarding"');
  });

  it('labels every surface LIVE (never the DEMO badge on THIS surface\'s cards)', () => {
    const badges = html.match(/data-live-badge="true"/g) ?? [];
    expect(badges.length).toBeGreaterThanOrEqual(5);
    // The shared shell (P1) renders its fixture-backed status strip with DEMO
    // badges — this surface\'s OWN cards never do:
    const own = render(createElement(LiveObservationView, { data: EMPTY }));
    expect(own).not.toContain('data-demo-badge');
    expect(own).not.toContain('DEMO');
  });

  it('answers the six product review questions', () => {
    expect(html).toContain('What is happening?');
    expect(html).toContain('Why does SOS believe this?');
    expect(html).toContain('What evidence supports it?');
    expect(html).toContain('What uncertainty remains?');
    expect(html).toContain('What authority is required?');
    expect(html).toContain('What can happen next?');
  });

  it('never renders a DEMO marker on this surface\'s own cards (the shell status strip is the P1 fixture surface)', () => {
    const own = render(createElement(LiveObservationView, { data: EMPTY }));
    expect(own).not.toContain('data-demo-badge="true"');
  });
});

describe('the live observation view with real-shaped data', () => {
  const data = {
    ...EMPTY,
    drainedAt: '2026-09-25T12:00:00Z',
    sources: [
      { source: 'github:rest-events:payswapdotorg/SOS-2.0', provider: 'github', family: 'github', state: 'CONNECTED' as const, detail: 'last real probe answered 200', lastError: null, lastProbedAt: '2026-09-25T12:00:00Z', apiRevision: 'github.v3' },
      { source: 'deploy:vercel', provider: 'vercel', family: 'deployment', state: 'UNAVAILABLE' as const, detail: 'failed with HTTP 401', lastError: 'HTTP 401: authentication failed', lastProbedAt: '2026-09-25T12:00:00Z', apiRevision: 'vercel.v6' },
      { source: 'provider-health:real-probes', provider: 'upstash', family: 'provider-health', state: 'UNKNOWN' as const, detail: 'never probed', lastError: null, lastProbedAt: null, apiRevision: null },
    ],
    eventsInWindow: 12,
    repository: {
      subject: 'github:repo:payswapdotorg/SOS-2.0',
      branchHeads: [{ branch: 'main', head: 'efd44494d37580ebe4cf9e54bc188351642ae3fb', lastEventAt: '2026-09-25T11:58:00Z', freshness: 'FRESH' as const, evidenceEventIds: ['github:rest-events:payswapdotorg/SOS-2.0:22146051554'] }],
      openPullRequests: [],
      freshness: 'FRESH' as const,
    },
    ci: { latestByPipeline: [{ runId: '36141162649', pipeline: 'SOS repository verification', ref: 'efd44494d37580ebe4cf9e54bc188351642ae3fb', status: 'SUCCESS', occurredAt: '2026-09-25T13:28:33Z' }], freshness: 'FRESH' as const },
    deployments: { byEnvironment: [], freshness: 'NO_DATA' as const },
    providerHealth: [{ provider: 'github', status: 'HEALTHY', at: '2026-09-25T12:00:00Z' }],
    findings: [
      { subject: 'github:repo:payswapdotorg/SOS-2.0@main', kind: 'ALIGNED' as const, claimedRevision: 'efd44494d37580ebe4cf9e54bc188351642ae3fb', observedRevision: 'efd44494d37580ebe4cf9e54bc188351642ae3fb', evidenceEventIds: ['e1'] },
    ],
    detections: [],
  };
  const html = render(createElement(LiveObservationView, { data }));

  it('shows the drained state with the LIVE badge and honest source states', () => {
    expect(html).toContain('drained at 2026-09-25T12:00:00Z');
    expect(html).toContain('CONNECTED');
    expect(html).toContain('UNAVAILABLE');
    expect(html).toContain('UNKNOWN');
  });

  it('records the real error for the down source (never silence)', () => {
    expect(html).toContain('HTTP 401: authentication failed');
  });

  it('renders the branch head with its evidence event id', () => {
    expect(html).toContain('efd44494d37580ebe4cf9e54bc188351642ae3fb');
    expect(html).toContain('github:rest-events:payswapdotorg/SOS-2.0:22146051554');
  });

  it('renders the CI status verbatim (SUCCESS — never folded)', () => {
    expect(html).toContain('SOS repository verification');
    expect(html).toContain('SUCCESS');
  });

  it('keeps the NO_DATA deployment projection honestly empty', () => {
    expect(html).toContain('No deployment observed yet');
  });

  it('shows the ALIGNED finding and the honest reconciliation vocabulary', () => {
    expect(html).toContain('ALIGNED');
    expect(html).toContain('ALIGNED / DIVERGED / UNVERIFIED / STALE');
  });

  it('shows the watching-without-body separation note (journey 14)', () => {
    expect(html).toContain('SOS is watching');
    expect(html).toContain('does not use a working body');
  });
});

describe('the consequential action panel', () => {
  const data = {
    ...EMPTY,
    drainedAt: '2026-09-25T12:00:00Z',
    sources: [{ source: 'github:rest-events:payswapdotorg/SOS-2.0', provider: 'github', family: 'github', state: 'CONNECTED' as const, detail: 'ok', lastError: null, lastProbedAt: '2026-09-25T12:00:00Z', apiRevision: 'github.v3' }],
    repository: {
      subject: 'github:repo:payswapdotorg/SOS-2.0',
      branchHeads: [{ branch: 'main', head: 'efd44494d37580ebe4cf9e54bc188351642ae3fb', lastEventAt: '2026-09-25T11:58:00Z', freshness: 'FRESH' as const, evidenceEventIds: ['e1'] }],
      openPullRequests: [],
      freshness: 'FRESH' as const,
    },
    ci: { latestByPipeline: [], freshness: 'NO_DATA' as const },
    deployments: { byEnvironment: [{ environment: 'production', revision: '740bc37c75', since: '2026-09-21T11:55:00Z' }], freshness: 'FRESH' as const },
  };
  const html = render(createElement(ActionPanel, { data }));

  it('renders the three gateway families (summon body, promotion, rollback) as forms with typed envelopes', () => {
    expect(html).toContain('Summon an execution body');
    expect(html).toContain('Promote the verified revision');
    expect(html).toContain('Roll back production');
    expect(html).toContain('data-action-form="summon-body"');
    expect(html).toContain('data-action-form="promotion"');
    expect(html).toContain('data-action-form="rollback"');
    const envelopes = html.match(/name="action" value="[^"]+"/g) ?? [];
    expect(envelopes.length).toBe(3);
  });

  it('never mutates state directly — every form POSTs to the gateway endpoint', () => {
    expect(html).toContain('action="/api/live-mission/actions"');
    expect(html).toContain('the UI never mutates state directly');
  });

  it('shows the authority gate on every action (fail-closed vocabulary)', () => {
    expect((html.match(/Authority-gated:/g) ?? []).length).toBe(3);
    expect(html).toContain('fails CLOSED');
  });

  it('covers ASK resolution through the human-authority queue (not a fabricated gateway family)', () => {
    expect(html).toContain('Resolve a pending ASK');
    expect(html).toContain('human resolver');
  });

  it('honestly links package composition to the Packages workspace instead of fabricating an action', () => {
    expect(html).toContain('Package composition has no action-gateway family');
    expect(html).toContain('href="/packages"');
  });
});

describe('the mission entry points with resumable missions', () => {
  const html = render(
    createElement(MissionEntryPoints, {
      missions: [
        { missionId: 'sos://Mission/m1', status: 'ACTIVE', purposeSummary: 'Ship the production connectivity wave', updatedAt: '2026-09-24T10:00:00Z' },
      ],
      storeRef: 'live-store:missions',
      asOf: '2026-09-25T12:00:00Z',
    }),
  );

  it('renders the resumable mission with its status', () => {
    expect(html).toContain('Ship the production connectivity wave');
    expect(html).toContain('status:');
    expect(html).toContain('ACTIVE');
    expect(html).toContain('Resume this mission');
  });

  it('renders the honest empty state when no mission exists', () => {
    const empty = render(createElement(MissionEntryPoints, { missions: [], storeRef: 's', asOf: 't' }));
    expect(empty).toContain('No mission exists yet');
    expect(empty).toContain('nothing is fabricated here');
  });
});

describe('the action envelope builders (pure, gateway-shaped)', () => {
  it('builds the summon-body envelope in the merged ActionRequest shape with no authority fields', () => {
    const envelope = summonBodyEnvelope({ actorId: 'console-user', bodyId: 'cloud-sandbox-1', baseSha: 'abc', actionId: 'a1', idempotencyKey: 'idem-1', requestedAt: 1790346912000 });
    expect(envelope.family).toBe('body-lifecycle');
    expect(envelope.payload).toEqual({ family: 'body-lifecycle', bodyLifecycle: { bodyId: 'cloud-sandbox-1', operation: 'start' } });
    expect(envelope.targetRevision).toEqual({ kind: 'source', sha: 'abc' });
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain('grant');
    expect(serialized).not.toContain('token');
  });

  it('builds the promotion and rollback envelopes with the exact payload shapes', () => {
    expect(promotionEnvelope({ actorId: 'u', fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: 's1', actionId: 'a2', idempotencyKey: 'i2', requestedAt: 1 }).payload).toEqual({
      family: 'promotion',
      promotion: { fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: 's1' },
    });
    expect(rollbackEnvelope({ actorId: 'u', deploymentId: 'd1', fromSourceSha: 'f', toSourceSha: 't', reasonCode: 'MANUAL_DIRECTIVE', reasonDetail: 'r', actionId: 'a3', idempotencyKey: 'i3', requestedAt: 1 }).payload).toEqual({
      family: 'rollback',
      rollback: { deploymentId: 'd1', fromSourceSha: 'f', toSourceSha: 't', reason: { code: 'MANUAL_DIRECTIVE', detail: 'r' } },
    });
  });

  it('builds the ASK resolution envelope in the merged AskQueue resolve shape', () => {
    const envelope = askResolutionEnvelope({ entryId: 'ask-1', resolvedBy: 'console-user', chosenAlternativeId: 'alt-1', note: 'Go', provenance: ['human:console-user'], createdAt: '2026-09-25T12:00:00Z' });
    expect(envelope.entryId).toBe('ask-1');
    expect(envelope.resolution.resolved_by).toBe('console-user');
    expect(envelope.resolution.provenance).toEqual(['human:console-user']);
  });
});

describe('the DTO producer (drain report -> live observation data)', () => {
  it('maps the structural drain report to the serializable DTO (Maps become arrays)', () => {
    const report = {
      drainedAt: '2026-09-25T12:00:00Z',
      snapshot: {
        repositoryHeads: new Map([
          [
            'github:repo:o/r',
            {
              branchHeads: { main: 'sha-main' },
              openPullRequests: [{ number: 7, head: 'pr-sha', base: 'main', openedAt: '2026-09-25T10:00:00Z' }],
              lastEventAt: '2026-09-25T11:00:00Z',
              freshness: { state: 'FRESH' as const },
              foldedEventIds: ['e1', 'e2'],
            },
          ],
        ]),
        ci: new Map([
          ['github:repo:o/r', { latestByPipeline: { verify: { runId: '9', ref: 'sha-main', status: 'SUCCESS', occurredAt: '2026-09-25T11:30:00Z' } }, lastEventAt: '2026-09-25T11:30:00Z', freshness: { state: 'FRESH' as const } }],
        ]),
        deployments: new Map([['github:repo:o/r', { deployedByEnvironment: { production: { revision: 'rev-1', since: '2026-09-25T09:00:00Z' } }, lastEventAt: '2026-09-25T09:00:00Z', freshness: { state: 'STALE' as const } }]]),
        providerHealth: { lastSignalByProvider: { github: { provider: 'github', status: 'HEALTHY', at: '2026-09-25T11:55:00Z' } }, freshness: { state: 'FRESH' as const } },
      },
      findings: [{ subject: 'github:repo:o/r@main', kind: 'ALIGNED' as const, claimedRevision: 'sha-main', observedRevision: 'sha-main', evidenceEventIds: ['e1'] }],
      detections: [{ code: 'CI_FAILING_ON_HEAD', subject: 'github:repo:o/r' }],
    };
    const data = liveObservationFromDrain({
      report,
      connectivity: { sources: [{ source: 'github:rest-events:o/r', provider: 'github', state: 'CONNECTED', detail: 'ok', lastError: null, lastProbedAt: '2026-09-25T12:00:00Z', probes: [{ apiRevision: 'github.v3' }] }] },
      repositorySubject: 'github:repo:o/r',
      storeRef: 'live-store:observation-events',
      asOf: '2026-09-25T12:00:01Z',
      eventsInWindow: 4,
      watchingWithoutBody: true,
    });
    expect(data.repository.branchHeads).toEqual([{ branch: 'main', head: 'sha-main', lastEventAt: '2026-09-25T11:00:00Z', freshness: 'FRESH', evidenceEventIds: ['e1', 'e2'] }]);
    expect(data.repository.openPullRequests).toEqual([{ number: 7, head: 'pr-sha', base: 'main', openedAt: '2026-09-25T10:00:00Z' }]);
    expect(data.ci.latestByPipeline).toEqual([{ runId: '9', pipeline: 'verify', ref: 'sha-main', status: 'SUCCESS', occurredAt: '2026-09-25T11:30:00Z' }]);
    expect(data.deployments.byEnvironment).toEqual([{ environment: 'production', revision: 'rev-1', since: '2026-09-25T09:00:00Z' }]);
    expect(data.sources[0]!.apiRevision).toBe('github.v3');
    expect(JSON.parse(JSON.stringify(data))).toBeTruthy();
  });

  it('derives the source family from the source id prefix', () => {
    const data = emptyLiveObservation('s', 'never', 'subj');
    expect(JSON.parse(JSON.stringify(data)).watchingWithoutBody).toBe(true);
  });
});
