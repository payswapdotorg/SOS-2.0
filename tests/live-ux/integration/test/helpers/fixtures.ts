/**
 * The P18-INT integrated-suite fixtures: FIXED LITERALS for every instant
 * and identifier (offline, deterministic — the P18-C journeys-helpers
 * discipline), every DTO state built through the P17-C PRODUCER HELPERS
 * (emptyLiveObservation / liveObservationFromDrain — never hand-rolled
 * projection objects), and the real action-gateway composition for the
 * endpoint pipeline (the tests/real-observation action-wiring precedent).
 */

import type { ReactElement } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prerender } from 'react-dom/static';
import { emptyLiveObservation, liveObservationFromDrain } from '@live-mission/dto';
import type { ConnectivitySnapshotLike, DrainReportLike, LiveObservationData, LiveSourceState } from '@live-mission/dto';
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
import { createLiveActionHost, submitLiveAction } from '@integration/live-action-core';
import type { LiveActionHost, LiveActionReceiptView } from '@integration/live-action-core';

// ---------------------------------------------------------------------------
// 1. Fixed literals (no ambient time anywhere in the deterministic suite)
// ---------------------------------------------------------------------------

/** The fixed gateway time (epoch ms) — the P18-B endpoint-core precedent. */
export const GATEWAY_T0 = 1_797_123_600_000;
/** The fixed as-of instant for rendered receipt views. */
export const AS_OF = '2026-09-26T00:00:00Z';
/** The actor the live-mission surface stamps on every envelope. */
export const ACTOR = 'console-user';
/** The store ref the scripted drained observations carry (the reference marker, explicit). */
export const SCRIPTED_STORE_REF = 'reference:in-memory-observation-store';
/** The repository subject every scripted observation carries. */
export const SCRIPTED_SUBJECT = 'github:repo:payswapdotorg/SOS-2.0';
/** The exact head the scripted drained observation observed (evidence-bound everywhere it appears). */
export const OBSERVED_HEAD = 'efd44494d37580ebe4cf9e54bc188351642ae3fb';
/** The exact production revision the scripted drained observation observed. */
export const OBSERVED_PRODUCTION_REVISION = '740bc37c75a1b4c8d2e5f6071829a4b5c6d7e8f9';

// ---------------------------------------------------------------------------
// 2. The scripted honest DTO states (producer-built, fixed literals)
// ---------------------------------------------------------------------------

/** One scripted source status for the connectivity snapshot. */
function source(sourceId: string, provider: string, state: LiveSourceState, detail: string, lastError: string | null = null) {
  return { source: sourceId, provider, state, detail, lastError, lastProbedAt: '2026-09-26T11:58:00Z', probes: [] };
}

/** The full honest connectivity snapshot: every §5 family represented, mixed honest states. */
function fullConnectivity(): ConnectivitySnapshotLike {
  return {
    sources: [
      source('github:rest-events:payswapdotorg/SOS-2.0', 'github', 'CONNECTED', 'last real probe answered 200'),
      source('ci:github-actions:payswapdotorg/SOS-2.0', 'github', 'CONNECTED', 'last real probe answered 200'),
      source('deploy:vercel', 'vercel', 'UNAVAILABLE', 'failed with HTTP 401', 'HTTP 401: authentication failed'),
      source('telemetry:upstash-redis', 'upstash', 'DEGRADED', 'throttled — partial capture'),
      source('provider-health:real-probes', 'upstash', 'UNKNOWN', 'never probed'),
    ],
  };
}

/** A scripted drain report with a live repository, CI and deployments. */
function drainedReport(): DrainReportLike {
  return {
    drainedAt: '2026-09-26T11:58:00Z',
    snapshot: {
      repositoryHeads: new Map([
        [
          SCRIPTED_SUBJECT,
          {
            branchHeads: { main: OBSERVED_HEAD },
            openPullRequests: [{ number: 7, head: 'pr-head-0000000000000000000000000000000000000000', base: 'main', openedAt: '2026-09-26T10:00:00Z' }],
            lastEventAt: '2026-09-26T11:58:00Z',
            freshness: { state: 'FRESH' },
            foldedEventIds: ['github:rest-events:payswapdotorg/SOS-2.0:22146051554'],
          },
        ],
      ]),
      ci: new Map([
        [
          SCRIPTED_SUBJECT,
          {
            latestByPipeline: { 'SOS repository verification': { runId: '36141162649', ref: OBSERVED_HEAD, status: 'SUCCESS', occurredAt: '2026-09-26T11:40:00Z' } },
            lastEventAt: '2026-09-26T11:40:00Z',
            freshness: { state: 'FRESH' },
          },
        ],
      ]),
      deployments: new Map([
        [
          SCRIPTED_SUBJECT,
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
      { subject: `${SCRIPTED_SUBJECT}@main`, kind: 'ALIGNED', claimedRevision: OBSERVED_HEAD, observedRevision: OBSERVED_HEAD, evidenceEventIds: ['github:rest-events:payswapdotorg/SOS-2.0:22146051554'] },
      { subject: `${SCRIPTED_SUBJECT}@production`, kind: 'DIVERGED', claimedRevision: OBSERVED_HEAD, observedRevision: OBSERVED_PRODUCTION_REVISION, evidenceEventIds: ['deploy:vercel:evt-1'] },
    ],
    detections: [],
  };
}

/** The drained state: a live repository head, CI runs, a production deployment, mixed honest source states. */
export function drainedObservation(): LiveObservationData {
  return liveObservationFromDrain({
    report: drainedReport(),
    connectivity: fullConnectivity(),
    repositorySubject: SCRIPTED_SUBJECT,
    storeRef: SCRIPTED_STORE_REF,
    asOf: '2026-09-26T12:00:00Z',
    eventsInWindow: 12,
    watchingWithoutBody: true,
  });
}

/**
 * The honest empty state for an incomplete environment: the producer's
 * actual unwired shape — the EXPLICIT reference-store marker, a real probe
 * instant, no drain (drainedAt null) — never a fabricated snapshot.
 */
export function honestEmptyObservation(): LiveObservationData {
  return emptyLiveObservation(SCRIPTED_STORE_REF, '2026-09-26T12:00:00Z', SCRIPTED_SUBJECT);
}

// ---------------------------------------------------------------------------
// 3. The render helper + the endpoint-pipeline driver (server render only)
// ---------------------------------------------------------------------------

/** Server-render an element to static markup (deterministic, byte-stable for the same props). */
export function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

/** Server-render an async server component tree to its full HTML (React 19 static prerender — the P18-B mount-seams discipline; what Next itself produces). */
export async function renderPage(page: () => ReactElement | Promise<ReactElement>): Promise<string> {
  const { prelude } = await prerender(createElement(page));
  const chunks: string[] = [];
  const reader = prelude.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value).toString('utf8'));
  }
  return chunks.join('');
}

/** createElement alias so spec files read like JSX without needing the pragma. */
export const h = createElement;

/** Compose the REAL endpoint-pipeline host over the reference world (deterministic, offline). */
export function pipelineHost(authority: InMemoryAuthority, asks?: LiveActionHost['asks']): LiveActionHost {
  return createLiveActionHost({ clock: { now: (): number => GATEWAY_T0 }, authority, asks });
}

/** Submit one envelope through the REAL endpoint pipeline (the same parsing the mounted route uses). */
export function submit(host: LiveActionHost, envelope: object): { view: LiveActionReceiptView; httpStatus: number } {
  return submitLiveAction({ body: JSON.stringify(envelope), contentType: 'application/json', host, now: GATEWAY_T0 });
}

/** The raw merged ActionGateway composition (the journeys-helpers precedent — for direct gateway invariants). */
export function gatewayWith(authority: InMemoryAuthority): {
  readonly gateway: Gateway;
  readonly world: ReferenceWorld;
  readonly events: InMemoryEventLog;
  readonly evidence: InMemoryEvidenceSink;
  readonly idempotency: InMemoryIdempotencyStore;
  readonly authority: InMemoryAuthority;
} {
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

/** The six product review questions (ARCHITECT_START_HERE) — the receipt-surface contract. */
export const SIX_QUESTIONS = [
  'What is happening?',
  'Why does SOS believe this?',
  'What evidence supports it?',
  'What uncertainty remains?',
  'What authority is required?',
  'What can happen next?',
] as const;
