/**
 * SHARED JOURNEY-SUITE HELPERS (Work Order P18-C).
 *
 * Everything here is deterministic and offline: fixed literals for every
 * instant and identifier, DTO states built through the P17-C PRODUCER
 * HELPERS (emptyLiveObservation / liveObservationFromDrain — never
 * hand-rolled projection objects), the render discipline of the P4/P17-C
 * render suites, and an honest FILESYSTEM capability probe for the P18-B
 * mounts. Nothing in this file touches the network, the clock or the
 * environment.
 *
 * Sections:
 *   1. the render helper (server render to string)
 *   2. the scripted honest DTO states (journey fixtures, producer-built)
 *   3. the capability probe for the P18-B route mounts (route-level specs)
 *   4. the real-app-route scanner (links-to-real-routes-only verification)
 *   5. markup assertions (anchor extraction, section slicing)
 */

import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyLiveObservation, liveObservationFromDrain } from '@live-mission/dto';
import type { ConnectivitySnapshotLike, DrainReportLike, LiveMissionEntry, LiveObservationData, LiveSourceState } from '@live-mission/dto';
import {
  ActionGateway,
  InMemoryAuthority,
  InMemoryEventLog,
  InMemoryEvidenceSink,
  InMemoryIdempotencyStore,
  ReferenceExecutor,
  ReferenceRollbackVerifier,
  ReferenceWorld,
} from '@sos-2/action-gateway';
import type { ActionGateway as Gateway } from '@sos-2/action-gateway';

// ---------------------------------------------------------------------------
// 1. The render helper (each spec file stubs next/link before importing
//    the app surfaces — the repository's established render discipline)
// ---------------------------------------------------------------------------

/** Server-render an element to static markup (deterministic, byte-stable for the same props). */
export function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

/** createElement alias so spec files read like JSX without needing the pragma. */
export const h = createElement;

// ---------------------------------------------------------------------------
// 2. The scripted honest DTO states (fixed literals; producer-built)
// ---------------------------------------------------------------------------

export const JOURNEY_STORE_REF = 'live-store:observation-events';
export const JOURNEY_SUBJECT = 'github:repo:payswapdotorg/SOS-2.0';
export const JOURNEY_AS_OF = '2026-09-26T12:00:00Z';
export const JOURNEY_DRAINED_AT = '2026-09-26T11:58:00Z';
/** The exact head a drained journey observed (evidence-bound everywhere it appears). */
export const OBSERVED_MAIN_HEAD = 'efd44494d37580ebe4cf9e54bc188351642ae3fb';
export const OBSERVED_HEAD_EVENT = 'github:rest-events:payswapdotorg/SOS-2.0:22146051554';
/** The exact production revision a drained journey observed. */
export const OBSERVED_PRODUCTION_REVISION = '740bc37c75a1b4c8d2e5f6071829a4b5c6d7e8f9';

/** One scripted source status for the connectivity snapshot (the probe evidence is part of the fixture). */
function source(sourceId: string, provider: string, state: LiveSourceState, detail: string, lastError: string | null = null, apiRevision: string | null = null) {
  return { source: sourceId, provider, state, detail, lastError, lastProbedAt: JOURNEY_DRAINED_AT, probes: apiRevision === null ? [] : [{ apiRevision }] };
}

/** The full honest connectivity snapshot: every §5 family represented, mixed honest states. */
function fullConnectivity(): ConnectivitySnapshotLike {
  return {
    sources: [
      source('github:rest-events:payswapdotorg/SOS-2.0', 'github', 'CONNECTED', 'last real probe answered 200', null, 'github.v3'),
      source('ci:github-actions:payswapdotorg/SOS-2.0', 'github', 'CONNECTED', 'last real probe answered 200', null, 'github.v3'),
      source('deploy:vercel', 'vercel', 'UNAVAILABLE', 'failed with HTTP 401', 'HTTP 401: authentication failed', 'vercel.v6'),
      source('telemetry:upstash-redis', 'upstash', 'DEGRADED', 'throttled — partial capture', null, null),
      source('provider-health:real-probes', 'upstash', 'UNKNOWN', 'never probed'),
    ],
  };
}

/** A scripted drain report with a live repository, CI and deployments (the structural producer input). */
function drainedReport(): DrainReportLike {
  return {
    drainedAt: JOURNEY_DRAINED_AT,
    snapshot: {
      repositoryHeads: new Map([
        [
          JOURNEY_SUBJECT,
          {
            branchHeads: { main: OBSERVED_MAIN_HEAD },
            openPullRequests: [{ number: 7, head: 'pr-head-0000000000000000000000000000000000000000', base: 'main', openedAt: '2026-09-26T10:00:00Z' }],
            lastEventAt: '2026-09-26T11:58:00Z',
            freshness: { state: 'FRESH' },
            foldedEventIds: [OBSERVED_HEAD_EVENT, 'ci:github-actions:payswapdotorg/SOS-2.0:36141162649'],
          },
        ],
      ]),
      ci: new Map([
        [
          JOURNEY_SUBJECT,
          {
            latestByPipeline: { 'SOS repository verification': { runId: '36141162649', ref: OBSERVED_MAIN_HEAD, status: 'SUCCESS', occurredAt: '2026-09-26T11:40:00Z' } },
            lastEventAt: '2026-09-26T11:40:00Z',
            freshness: { state: 'FRESH' },
          },
        ],
      ]),
      deployments: new Map([
        [
          JOURNEY_SUBJECT,
          {
            deployedByEnvironment: { production: { revision: OBSERVED_PRODUCTION_REVISION, since: '2026-09-21T11:55:00Z' } },
            lastEventAt: '2026-09-21T11:55:00Z',
            freshness: { state: 'STALE' },
          },
        ],
      ]),
      providerHealth: { lastSignalByProvider: { github: { provider: 'github', status: 'HEALTHY', at: '2026-09-26T11:55:00Z' } }, freshness: { state: 'FRESH' } },
    },
    findings: [
      { subject: `${JOURNEY_SUBJECT}@main`, kind: 'ALIGNED', claimedRevision: OBSERVED_MAIN_HEAD, observedRevision: OBSERVED_MAIN_HEAD, evidenceEventIds: [OBSERVED_HEAD_EVENT] },
      { subject: `${JOURNEY_SUBJECT}@production`, kind: 'DIVERGED', claimedRevision: OBSERVED_MAIN_HEAD, observedRevision: OBSERVED_PRODUCTION_REVISION, evidenceEventIds: ['deploy:vercel:evt-1'] },
    ],
    detections: [{ code: 'CI_FAILING_ON_HEAD', subject: JOURNEY_SUBJECT, message: 'The latest run on the observed head failed (carried verbatim).' }],
  };
}

/** A drained report with NO repository head observed yet (the honest no-head state). */
function noHeadReport(): DrainReportLike {
  const report = drainedReport();
  return {
    ...report,
    snapshot: { ...report.snapshot, repositoryHeads: new Map(), ci: new Map(), deployments: new Map() },
    findings: [],
  };
}

/** The fresh-user state: nothing drained, nothing probed, honestly UNKNOWN (never fabricated). */
export function freshUserObservation(): LiveObservationData {
  return emptyLiveObservation(JOURNEY_STORE_REF, 'never', JOURNEY_SUBJECT);
}

/** The drained state: a live repository head, CI runs, a production deployment, mixed honest source states. */
export function drainedObservation(watchingWithoutBody = true): LiveObservationData {
  return liveObservationFromDrain({
    report: drainedReport(),
    connectivity: fullConnectivity(),
    repositorySubject: JOURNEY_SUBJECT,
    storeRef: JOURNEY_STORE_REF,
    asOf: JOURNEY_AS_OF,
    eventsInWindow: 12,
    watchingWithoutBody,
  });
}

/** The no-head state: sources probed, but no repository head observed (actions stay disabled, honestly). */
export function noHeadObservation(): LiveObservationData {
  return liveObservationFromDrain({
    report: noHeadReport(),
    connectivity: fullConnectivity(),
    repositorySubject: JOURNEY_SUBJECT,
    storeRef: JOURNEY_STORE_REF,
    asOf: JOURNEY_AS_OF,
    eventsInWindow: 3,
    watchingWithoutBody: true,
  });
}

/** Resumable mission fixtures (the authoritative mission store entries the surface renders). */
export function missionFixtures(): readonly LiveMissionEntry[] {
  return [
    { missionId: 'sos://Mission/m-active-0001', status: 'ACTIVE', purposeSummary: 'Ship the production connectivity wave', updatedAt: '2026-09-26T10:00:00Z' },
    { missionId: 'sos://Mission/m-draft-0002', status: 'DRAFT', purposeSummary: 'Understand the legacy checkout before changing it', updatedAt: '2026-09-25T09:30:00Z' },
  ];
}

// ---------------------------------------------------------------------------
// 2b. The real action-gateway composition (the tests/real-observation
//     action-wiring precedent): the SAME envelopes the live-mission forms
//     POST execute through the merged gateway with authority gates,
//     idempotency and evidence — driven deterministically at a fixed time.
// ---------------------------------------------------------------------------

/** The fixed gateway time (epoch ms) — no ambient clock anywhere in the journeys. */
export const GATEWAY_T0 = 1_797_123_600_000;
/** The actor the live-mission surface stamps on every envelope. */
export const GATEWAY_ACTOR = 'console-user';

export interface JourneyGateway {
  readonly gateway: Gateway;
  readonly world: ReferenceWorld;
  readonly events: InMemoryEventLog;
  readonly evidence: InMemoryEvidenceSink;
  readonly idempotency: InMemoryIdempotencyStore;
  readonly authority: InMemoryAuthority;
}

/** Compose the real merged ActionGateway over the reference world (deterministic, offline). */
export function gatewayWith(authority: InMemoryAuthority): JourneyGateway {
  const world = new ReferenceWorld();
  const events = new InMemoryEventLog();
  const evidence = new InMemoryEvidenceSink();
  const idempotency = new InMemoryIdempotencyStore();
  const gateway = new ActionGateway({
    clock: { now: (): number => GATEWAY_T0 },
    authority,
    executors: [new ReferenceExecutor(world)],
    idempotency,
    events,
    evidence,
    rollbackVerifier: new ReferenceRollbackVerifier(world),
  });
  return { gateway, world, events, evidence, idempotency, authority };
}

// ---------------------------------------------------------------------------
// 3. The capability probe for the P18-B route mounts (route-level specs)
// ---------------------------------------------------------------------------

/** The single explicit skip reason the route-level suites carry while the P18-B mount is absent. */
export const P18B_SKIP_REASON = 'requires-p18b-mount';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

export interface P18bMountState {
  /** apps/web/app/live-mission/page.tsx exists (the MOUNTING.md step-1 route). */
  readonly liveMissionRoute: boolean;
  /** apps/web/app/mission/page.tsx renders LiveMissionPage (the MOUNTING.md optional /mission pointing). */
  readonly missionRouteRendersLive: boolean;
  /** apps/web/app/api/live-mission/actions/route.ts exists (the MOUNTING.md step-2 action endpoint). */
  readonly actionEndpoint: boolean;
  /** True only when the FULL path (mission route + action endpoint) is mounted. */
  readonly mounted: boolean;
  /** The explicit skip reason while not mounted; null once mounted. */
  readonly skipReason: string | null;
}

/**
 * The honest filesystem capability probe. Route-level full-path specs gate
 * on this; while `mounted` is false every one of them skips with the
 * EXPLICIT reason `requires-p18b-mount`. At the architect's integration
 * pass the mounts exist, the gate opens and every suite must run green —
 * pass states are never fabricated on this branch.
 */
export function p18bMountState(): P18bMountState {
  const liveMissionRoute = fs.existsSync(path.join(REPO_ROOT, 'apps/web/app/live-mission/page.tsx'));
  let missionRouteRendersLive = false;
  try {
    missionRouteRendersLive = fs.readFileSync(path.join(REPO_ROOT, 'apps/web/app/mission/page.tsx'), 'utf8').includes('LiveMissionPage');
  } catch {
    missionRouteRendersLive = false; // honest: the route file is unreadable — treat as not mounted
  }
  const actionEndpoint = fs.existsSync(path.join(REPO_ROOT, 'apps/web/app/api/live-mission/actions/route.ts'));
  const mounted = actionEndpoint && (liveMissionRoute || missionRouteRendersLive);
  return { liveMissionRoute, missionRouteRendersLive, actionEndpoint, mounted, skipReason: mounted ? null : P18B_SKIP_REASON };
}

// ---------------------------------------------------------------------------
// 4. The real-app-route scanner (links-to-real-routes-only verification)
// ---------------------------------------------------------------------------

/**
 * Scan apps/web/app for page.tsx files and derive the REAL route paths
 * (dynamic [segment] directories become :segment patterns). A link target
 * that is not in this set (and is not an anchor or external URL) would be
 * a fabricated route — the discovery surface never links one.
 */
export function realAppRoutes(): { readonly staticRoutes: ReadonlySet<string>; readonly dynamicPatterns: readonly RegExp[] } {
  const appDir = path.join(REPO_ROOT, 'apps/web/app');
  const staticRoutes = new Set<string>();
  const dynamicPatterns: RegExp[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), `${prefix}/${entry.name}`);
      } else if (entry.name === 'page.tsx' || entry.name === 'page.ts') {
        if (prefix.includes('[')) {
          const pattern = new RegExp(`^${prefix.replace(/\/\[[^\]]+\]/g, '/[^/]+')}$`);
          dynamicPatterns.push(pattern);
        } else {
          staticRoutes.add(prefix === '' ? '/' : prefix);
        }
      }
    }
  };
  walk(appDir, '');
  return { staticRoutes, dynamicPatterns };
}

// ---------------------------------------------------------------------------
// 5. Markup assertions (anchor extraction, section slicing)
// ---------------------------------------------------------------------------

/** Extract every anchor opening tag from rendered markup (full tags, attributes included). */
export function anchorTags(html: string): string[] {
  return html.match(/<a\b[^>]*>/g) ?? [];
}

/** Every href value referenced by the rendered markup. */
export function hrefs(html: string): string[] {
  return (html.match(/href="([^"]*)"/g) ?? []).map((match) => match.slice('href="'.length, -1));
}

/** Slice the rendered root page's discovery section (data-start-surface) out of the full markup. */
export function discoverySection(html: string): string {
  const start = html.indexOf('data-start-surface="true"');
  expectDefined(start, 'the discovery section must render (data-start-surface)');
  const end = html.indexOf('Mission and system overview');
  const bounded = end > start ? end : html.length;
  return html.slice(start, bounded);
}

/** Assert a value is defined with a useful message (the noUncheckedIndexedAccess discipline). */
export function expectDefined<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}
