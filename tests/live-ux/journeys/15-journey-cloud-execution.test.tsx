/**
 * JOURNEY 6/12 — LAPTOP OFF / CLOUD EXECUTION (Work Order P18-C).
 *
 * The user\u2019s computer is optional. The journey verifies the user can
 * LEARN this from the product and see it in the observation data: the
 * root understanding states the cloud-execution contract; the live
 * mission surface\u2019s watching note separates continuous observation
 * from body work; every observation source the drained state renders is
 * a CLOUD endpoint (no user-device dependency anywhere); and the history
 * link is offered as the "read what happened when you return" affordance.
 * The P15 flagship journey already pins the deeper mechanic (every cloud
 * tick ran with the user device offline) — this suite pins its
 * DISCOVERABILITY.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { LiveMissionPage } from '@live-mission/page';
import RootPage from '@web-app/root-page';
import { drainedObservation, h, render } from './helpers';

describe('journey: laptop off / cloud execution — the user\u2019s computer is optional', () => {
  it('the root understanding states the contract plainly (close the laptop; work continues)', () => {
    const html = render(h(RootPage));
    const block = html.slice(html.indexOf('data-first-run-understanding="computer-optional"'));
    expect(block).toContain('Your computer is optional');
    expect(block).toContain('work runs in the cloud');
    expect(block).toContain('You can close your laptop');
    expect(block).toContain('recorded for you to read when you return');
  });

  it('the root understanding links the history surface as the return affordance', () => {
    const html = render(h(RootPage));
    const block = html.slice(html.indexOf('data-first-run-understanding="computer-optional"'));
    expect(block).toContain('href="/history"');
    expect(block).toContain('The full history');
  });

  it('the live mission surface separates continuous watching from body work (the note renders on the observation card)', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    expect(html).toContain('data-watching-without-body="true"');
    expect(html).toContain('SOS is watching');
    expect(html).toContain('does not use a working body');
    expect(html).toContain('a body is summoned only when active inspection or change is required');
  });

  it('the drained state itself proves observation ran without the user: "SOS is watching without a body"', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    expect(html).toContain('The real observation plane last drained at');
    expect(html).toContain('SOS is watching without a body.');
    expect(html).toContain('12 events in the current window');
  });

  it('every observation source the surface renders is a cloud endpoint (no user-device dependency in the source list)', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    for (const source of ['github:rest-events:payswapdotorg/SOS-2.0', 'ci:github-actions:payswapdotorg/SOS-2.0', 'deploy:vercel', 'telemetry:upstash-redis']) {
      expect(html).toContain(source);
    }
    expect(html).not.toContain('user-device');
    expect(html).not.toContain('localhost');
  });

  it('the observation carries its evidence and provenance (what was seen while the user was away)', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    expect(html).toContain('drained at 2026-09-26T11:58:00Z');
    expect(html).toContain('store:');
    expect(html).toContain('live-store:observation-events');
    expect(html).toContain('What evidence supports it?');
  });

  it('the shell\u2019s own overview surface keeps the watching note separate from body work (the returning-user view)', () => {
    const html = render(h(RootPage));
    expect(html).toContain('SOS is watching');
    expect(html).toContain('does not use a working body');
    expect(html).toContain('Body leases');
  });
});
