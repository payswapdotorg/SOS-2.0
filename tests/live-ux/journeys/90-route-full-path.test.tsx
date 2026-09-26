/**
 * ROUTE-LEVEL FULL-PATH SPECS — CAPABILITY-GATED (Work Order P18-C).
 *
 * The full P18 path is: mission route → live observed state →
 * consequential action → receipt → evidence, against the P18-B mounts
 * (apps/web/app/live-mission/page.tsx and the /api/live-mission/actions
 * endpoint — exactly what apps/web/live-mission/MOUNTING.md documents as
 * the architect's integration steps).
 *
 * PARALLEL-LANE REALITY (binding): those mounts DO NOT exist on this
 * branch — lane B builds them in parallel. These suites therefore gate on
 * an honest filesystem capability probe: while the mount is absent every
 * suite skips with the EXPLICIT reason `requires-p18b-mount`, and an
 * always-run probe test reports the gate state (never a fabricated pass).
 * At the architect's integration pass (A → B → C) the mounts exist, the
 * gate opens, and ALL of these suites MUST run green before P18 can
 * complete.
 *
 * The integration contract these specs assert (mirrors MOUNTING.md, which
 * lane B implements):
 *   1. the mission route renders the P17-C LiveMissionPage (its markers
 *      are guaranteed by that component: the "Mission — live" heading,
 *      the LIVE badges, the onboarding entry, the actionable entries,
 *      the six review questions);
 *   2. the route's forms POST to /api/live-mission/actions (the UI never
 *      mutates state directly);
 *   3. the endpoint accepts the SAME envelope shape the forms post
 *      (form-encoded `action` field carrying the typed ActionRequest
 *      JSON) and answers with a serialized gateway outcome — a receipt
 *      (SUCCEEDED or DENIED, evidence-bound) or a typed rejection —
 *      never a silent 5xx;
 *   4. a smuggled authority field is typed-rejected (the endpoint
 *      surfaces the gateway's AUTHORITY_FIELD_SMUGGLED, never executes).
 */

import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { summonBodyEnvelope } from '@live-mission/envelopes';
import type { ActionRequestEnvelope } from '@live-mission/envelopes';
import { P18B_SKIP_REASON, h, p18bMountState, render } from './helpers';

/** The honest capability probe (filesystem + source inspection — deterministic, offline). */
const MOUNT = p18bMountState();

/**
 * Lazy loaders for the P18-B mounts. import.meta.glob only registers files
 * that EXIST — absent files are simply not in the record, so the record and
 * the filesystem probe agree by construction.
 */
const liveMissionRouteLoaders = import.meta.glob<{ default: unknown }>('../../../apps/web/app/live-mission/page.tsx');
const missionRouteLoaders = import.meta.glob<{ default: unknown }>('../../../apps/web/app/mission/page.tsx');
const actionEndpointLoaders = import.meta.glob<{ POST?: (request: Request) => Promise<Response> }>(
  '../../../apps/web/app/api/live-mission/actions/route.ts',
);

const LIVE_MISSION_ROUTE_KEY = '../../../apps/web/app/live-mission/page.tsx';
const MISSION_ROUTE_KEY = '../../../apps/web/app/mission/page.tsx';
const ACTION_ENDPOINT_KEY = '../../../apps/web/app/api/live-mission/actions/route.ts';

/** Load the mounted mission route (the live-mission route when present; else the pointed /mission route). */
async function loadMissionRoute(): Promise<() => Promise<ReactNode> | ReactNode> {
  const loader = liveMissionRouteLoaders[LIVE_MISSION_ROUTE_KEY] ?? missionRouteLoaders[MISSION_ROUTE_KEY];
  expect(loader, 'the mounted mission route must be loadable').toBeDefined();
  const mod = await loader!();
  const Page = mod.default as () => Promise<ReactNode> | ReactNode;
  expect(typeof Page, 'the route module must export a page component').toBe('function');
  return Page;
}

/** Load the mounted action endpoint's POST handler. */
async function loadActionEndpoint(): Promise<(request: Request) => Promise<Response>> {
  const loader = actionEndpointLoaders[ACTION_ENDPOINT_KEY];
  expect(loader, 'the action endpoint must be loadable').toBeDefined();
  const mod = await loader!();
  expect(typeof mod.POST, 'the endpoint module must export a POST handler').toBe('function');
  return mod.POST!;
}

/** POST one action envelope exactly the way the mounted form does (form-encoded `action` field). */
async function postEnvelope(POST: (request: Request) => Promise<Response>, envelope: ActionRequestEnvelope): Promise<{ status: number; body: unknown }> {
  const response = await POST(
    new Request('http://localhost/api/live-mission/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action: JSON.stringify(envelope) }).toString(),
    }),
  );
  const body = (await response.json()) as unknown;
  return { status: response.status, body };
}

describe('route-level capability probe (always runs — the honest gate state)', () => {
  it(`reports the P18-B mount state honestly (while absent: every full-path suite skips with the reason ${P18B_SKIP_REASON})`, () => {
    // The explicit, machine-readable gate state. This line is the visible
    // skip reason in the suite output — a skipped suite is a reported fact,
    // never a fabricated pass.
    console.info(
      `[P18-C route-level specs] liveMissionRoute=${String(MOUNT.liveMissionRoute)} missionRouteRendersLive=${String(MOUNT.missionRouteRendersLive)} actionEndpoint=${String(MOUNT.actionEndpoint)} => ${MOUNT.mounted ? 'ENABLED (running the full-path suites)' : `SKIPPED (${P18B_SKIP_REASON})`}`,
    );
    // the loader records agree with the filesystem probe by construction
    expect(Object.hasOwn(liveMissionRouteLoaders, LIVE_MISSION_ROUTE_KEY)).toBe(MOUNT.liveMissionRoute);
    expect(Object.hasOwn(actionEndpointLoaders, ACTION_ENDPOINT_KEY)).toBe(MOUNT.actionEndpoint);
    // the mount is complete exactly when both halves exist
    expect(MOUNT.mounted).toBe(MOUNT.actionEndpoint && (MOUNT.liveMissionRoute || MOUNT.missionRouteRendersLive));
    expect(MOUNT.skipReason === null).toBe(MOUNT.mounted);
  });
});

describe.skipIf(!MOUNT.mounted)(`route-level full path: mission route -> live observed state -> consequential action -> receipt -> evidence [gate: ${P18B_SKIP_REASON}]`, () => {
  it('the mounted mission route renders the P17-C live mission surface (its guaranteed markers)', async () => {
    const Page = await loadMissionRoute();
    const element = await Page(); // handles sync and async server components
    const html = render(element as React.ReactElement);
    expect(html).toContain('Mission — live');
    expect(html).toContain('What is happening?');
    expect(html).toContain('New here? Start with onboarding');
    expect(html).toContain('Start mission');
    expect(html).toContain('Import system');
    expect(html).toContain('Resume an existing mission');
    expect(html).toContain('data-live-badge="true"');
    expect(html).toContain('Why does SOS believe this?');
    expect(html).toContain('What uncertainty remains?');
  });

  it('the route renders honest state — either the drained live observation or the honest UNKNOWN empty state', async () => {
    const Page = await loadMissionRoute();
    const element = await Page();
    const html = render(element as React.ReactElement);
    // MOUNTING.md: unwired renders emptyLiveObservation (drainedAt null); wired
    // renders the real drain. Both are honest; a THIRD state does not exist.
    const honestEmpty = html.includes('No live observation drain has run yet');
    const drained = html.includes('The real observation plane');
    expect(honestEmpty || drained, 'the mission route must render an honest observation state (never a fabricated one)').toBe(true);
  });

  it('the route\u2019s consequential forms POST to the mounted action endpoint (the UI never mutates state directly)', async () => {
    const Page = await loadMissionRoute();
    const element = await Page();
    const html = render(element as React.ReactElement);
    expect(html).toContain('action="/api/live-mission/actions"');
    expect(html).toContain('the UI never mutates state directly');
    const actionForms = html.match(/data-action-form="/g) ?? [];
    expect(actionForms.length).toBe(3); // summon-body, promotion, rollback
  });

  it('the action endpoint answers the surface\u2019s envelope with a typed, evidence-bound outcome (never a silent 5xx)', async () => {
    const POST = await loadActionEndpoint();
    const envelope = summonBodyEnvelope({
      actorId: 'console-user',
      bodyId: 'route-level-body-1',
      baseSha: 'route-level-seed-sha',
      actionId: 'route-level-summon-1',
      idempotencyKey: 'route-level-idem-1',
      requestedAt: 1_797_123_600_000,
    });
    const { status, body } = await postEnvelope(POST, envelope);
    expect(status, 'a mounted endpoint must answer, never 5xx').toBeLessThan(500);
    const serialized = JSON.stringify(body);
    // a serialized gateway outcome: an executed/replayed receipt (SUCCEEDED or
    // DENIED — both are honest, evidence-bound outcomes) or a typed rejection
    expect(serialized, `the endpoint must return a typed gateway outcome, received: ${serialized}`).toMatch(/SUCCEEDED|DENIED|executed|replayed|rejected/);
    // a SUCCEEDED execution is evidence-bound: the receipt carries its evidence ids
    if (serialized.includes('SUCCEEDED')) {
      expect(serialized).toMatch(/evidenceIds|evidence_ids|evidence-ids/);
      expect(serialized).not.toMatch(/"evidenceIds"\s*:\s*\[\s*\]/);
    }
  });

  it('the endpoint is idempotent for the replayed envelope (the same idempotency key answers the recorded outcome)', async () => {
    const POST = await loadActionEndpoint();
    const envelope = summonBodyEnvelope({
      actorId: 'console-user',
      bodyId: 'route-level-body-2',
      baseSha: 'route-level-seed-sha',
      actionId: 'route-level-summon-2',
      idempotencyKey: 'route-level-idem-2',
      requestedAt: 1_797_123_600_000,
    });
    const first = await postEnvelope(POST, envelope);
    const second = await postEnvelope(POST, envelope);
    expect(second.status).toBeLessThan(500);
    // a replay either returns the recorded receipt verbatim or reports the replay
    const firstOutcome = JSON.stringify(first.body);
    const secondOutcome = JSON.stringify(second.body);
    expect(secondOutcome).toMatch(/SUCCEEDED|DENIED|executed|replayed|rejected/);
    if (firstOutcome.includes('SUCCEEDED')) {
      expect(secondOutcome).not.toContain('FAILED');
    }
  });

  it('a smuggled authority field is typed-rejected (the endpoint surfaces AUTHORITY_FIELD_SMUGGLED, never executes)', async () => {
    const POST = await loadActionEndpoint();
    const envelope = {
      ...summonBodyEnvelope({
        actorId: 'console-user',
        bodyId: 'route-level-body-3',
        baseSha: 'route-level-seed-sha',
        actionId: 'route-level-summon-3',
        idempotencyKey: 'route-level-idem-3',
        requestedAt: 1_797_123_600_000,
      }),
      grant: 'smuggled-grant-id',
    } as unknown as ActionRequestEnvelope;
    const { status, body } = await postEnvelope(POST, envelope);
    const serialized = JSON.stringify(body);
    const typedRejection = status >= 400 || serialized.includes('AUTHORITY_FIELD_SMUGGLED');
    expect(typedRejection, `a smuggled authority field must be typed-rejected (status ${String(status)}: ${serialized})`).toBe(true);
    // a rejected envelope never executes
    expect(serialized).not.toContain('"status":"SUCCEEDED"');
  });
});
