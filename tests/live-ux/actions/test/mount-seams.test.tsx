/**
 * P18-B deterministic reference-mode acceptance suite (6/8):
 * THE MOUNT SEAMS — the mission routes render the P17-C live experience
 * over the honest 'unwired' data seam.
 *
 * The operator's structural fix (the work order): the read-only Mission
 * view is REPLACED by the live Mission experience. Both mission routes
 * (apps/web/app/mission/page.tsx and apps/web/app/live-mission/page.tsx —
 * imported through the test-time aliases, exactly the modules the app
 * serves) render LiveMissionPage through getLiveMissionData() — the
 * architect-defined seam whose honest default is the UNWIRED empty state
 * (never a fabricated snapshot). The frozen consequential action forms
 * POST to /api/live-mission/actions and stay DISABLED until a real
 * repository head is observed (honest, never fabricated).
 */

import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import MissionRoute from '@web-app/mission-route';
import LiveMissionRoute from '@web-app/live-mission-route';
import { getLiveMissionData, LIVE_MISSION_REPOSITORY_SUBJECT } from '@web-app/data-seam';
import { emptyLiveObservation } from '@live-mission/dto';

/** Render one mounted mission route (the server-render discipline of the P4/P17-C render suites). */
async function renderRoute(Page: () => Promise<ReactNode> | ReactNode): Promise<string> {
  const element = await Page();
  return renderToStaticMarkup(element as React.ReactElement);
}

describe('the data seam (the architect-defined one-function, one-file seam)', () => {
  it('returns the HONEST unwired empty state — exactly emptyLiveObservation(unwired, never, subject)', async () => {
    const data = await getLiveMissionData();
    expect(data).toEqual(emptyLiveObservation('unwired', 'never', LIVE_MISSION_REPOSITORY_SUBJECT));
    // the honest-shape pins (drilled field by field):
    expect(data.storeRef).toBe('unwired');
    expect(data.asOf).toBe('never');
    expect(data.drainedAt).toBeNull();
    expect(data.sources).toEqual([]);
    expect(data.eventsInWindow).toBe(0);
    expect(data.repository).toMatchObject({ subject: 'github:repo:payswapdotorg/SOS-2.0', branchHeads: [], openPullRequests: [], freshness: 'NO_DATA' });
    expect(data.ci).toMatchObject({ latestByPipeline: [], freshness: 'NO_DATA' });
    expect(data.deployments).toMatchObject({ byEnvironment: [], freshness: 'NO_DATA' });
    expect(data.providerHealth).toEqual([]);
    expect(data.findings).toEqual([]);
    expect(data.detections).toEqual([]);
    expect(data.watchingWithoutBody).toBe(true);
  });

  it('carries the fixed repository subject of the P18 lanes', () => {
    expect(LIVE_MISSION_REPOSITORY_SUBJECT).toBe('github:repo:payswapdotorg/SOS-2.0');
  });
});

describe.each([
  ['the production mission route (the structural fix)', MissionRoute],
  ['the live-mission route (the MOUNTING.md mount)', LiveMissionRoute],
] as const)('%s', (_label, Page) => {
  it('renders the P17-C live mission experience (the guaranteed markers)', async () => {
    const html = await renderRoute(Page);
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

  it('renders the HONEST unwired state (never a fabricated live state)', async () => {
    const html = await renderRoute(Page);
    expect(html).toContain('No live observation drain has run yet');
    expect(html).toContain('store:</span> unwired'); // the LIVE badge's provenance title carries the storeRef
    expect(html).toContain('No source has been probed yet');
    expect(html).toContain('No branch head observed yet');
    expect(html).toContain('No mission exists yet — this is honestly empty');
  });

  it('exposes the actionable entry points to the REAL onboarding routes (first-class onboarding entry)', async () => {
    const html = await renderRoute(Page);
    expect(html).toContain('href="/onboarding/greenfield"');
    expect(html).toContain('href="/onboarding/brownfield"');
    expect(html).toContain('href="/onboarding"');
  });

  it('posts the consequential action forms to the mounted endpoint (the UI never mutates state directly)', async () => {
    const html = await renderRoute(Page);
    expect(html).toContain('action="/api/live-mission/actions"');
    const forms = html.match(/data-action-form="/g) ?? [];
    expect(forms.length).toBe(3); // summon-body, promotion, rollback
    expect(html).toContain('the UI never mutates state directly');
  });

  it('keeps the unobserved actions honestly DISABLED with their reasons (never fabricated envelopes)', async () => {
    const html = await renderRoute(Page);
    expect(html).toContain('No observed repository head yet — the envelope needs the exact source revision to act on (never fabricated).');
    expect(html).toContain('No observed production deployment yet — rollback needs the exact deployment to roll back.');
    expect(html.match(/disabled/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('keeps package composition linked to the Packages workspace (no fabricated action family)', async () => {
    const html = await renderRoute(Page);
    expect(html).toContain('Package composition has no action-gateway family');
    expect(html).toContain('href="/packages"');
  });
});

describe('the two mission routes are the same live experience (the structural fix leaves one truth)', () => {
  it('render byte-identical bodies for the same seam data', async () => {
    const missionHtml = await renderRoute(MissionRoute);
    const liveHtml = await renderRoute(LiveMissionRoute);
    expect(missionHtml).toBe(liveHtml);
  });
});
