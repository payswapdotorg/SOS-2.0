/**
 * JOURNEY 2/12 — GREENFIELD (Work Order P18-C).
 *
 * The user is starting fresh (possibly from an empty repository). The
 * journey verifies they can FOLLOW the greenfield path through the UI:
 * the mission surface\u2019s "Start a mission" entry (with the honest
 * journey description), the resumable-mission continuation for a journey
 * already in flight (status + updated stamp + resume affordance), and the
 * hand-off into the guided wizard whose first step renders a usable
 * purpose form. Progressive formalization is visible end to end.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { LiveMissionPage } from '@live-mission/page';
import { GreenfieldWizard } from '@web-onboarding/greenfield';
import { drainedObservation, freshUserObservation, h, missionFixtures, render } from './helpers';

describe('journey: greenfield — start a mission from intent', () => {
  it('the mission surface offers the greenfield entry with the honest journey description', () => {
    const html = render(h(LiveMissionPage, { data: freshUserObservation(), missions: [] }));
    expect(html).toContain('Start a mission');
    expect(html).toContain('purpose → outcomes → stakeholders → measures → constraints → your authority confirmation → the GitHub connection');
    expect(html).toContain('including starting from an empty repository');
  });

  it('the primary entry is exactly the greenfield route (marked as the primary affordance)', () => {
    const html = render(h(LiveMissionPage, { data: freshUserObservation(), missions: [] }));
    expect(html).toContain('data-mission-entry="primary"');
    const primaryAnchor = (html.match(/<a[^>]*data-mission-entry="primary"[^>]*>/g) ?? [])[0];
    expect(primaryAnchor).toContain('href="/onboarding/greenfield"');
    // the anchor's accessible label (its text content) is the affordance
    const primaryLink = html.slice(html.indexOf('data-mission-entry="primary"'));
    expect(primaryLink.slice(0, primaryLink.indexOf('</a>'))).toContain('Start mission');
  });

  it('a mission already in flight is listed as resumable with its status and updated stamp', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: missionFixtures() }));
    expect(html).toContain('Ship the production connectivity wave');
    expect(html).toContain('status:');
    expect(html).toContain('ACTIVE');
    expect(html).toContain('updated:');
    expect(html).toContain('Resume this mission');
    expect(html).toContain('sos://Mission/m-active-0001');
  });

  it('resuming links through the onboarding journeys (progressive formalization from the recorded state)', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: missionFixtures() }));
    expect(html).toContain('Resuming links through the onboarding journeys, which resume progressive formalization from the recorded state.');
  });

  it('the DRAFT mission (started but not formalized) is equally resumable — the journey never loses state', () => {
    const html = render(h(LiveMissionPage, { data: freshUserObservation(), missions: missionFixtures() }));
    expect(html).toContain('Understand the legacy checkout before changing it');
    expect(html).toContain('DRAFT');
  });

  it('the hand-off lands on a usable first step: the wizard\u2019s purpose form (GET, resumable)', () => {
    const wizard = render(h(GreenfieldWizard, { params: {} }));
    expect(wizard).toContain('Start a mission');
    expect(wizard).toContain('Purpose');
    expect(wizard).toMatch(/<form[^>]*method="get"/);
    expect(wizard).toContain('aria-label="Journey progress"');
  });

  it('the wizard shows the authority confirmation and GitHub connection steps ahead of time (no surprises later)', () => {
    const wizard = render(h(GreenfieldWizard, { params: {} }));
    expect(wizard).toContain('Authority');
    expect(wizard).toContain('GitHub connection');
  });

  it('the live mission surface stays honest while a greenfield mission is in flight (LIVE badges, drained state)', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: missionFixtures() }));
    expect(html).toContain('The real observation plane last drained at');
    expect(html).toContain('SOS is watching without a body.');
    expect((html.match(/data-live-badge="true"/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
