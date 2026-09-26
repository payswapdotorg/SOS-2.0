/**
 * JOURNEY 10/12 — OBSERVATION WITHOUT A BODY (Work Order P18-C).
 *
 * Continuous observation does not require a body (the execution-fabric
 * rule). The journey verifies the user can SEE the separation everywhere
 * it matters: the root understanding, the live mission surface\u2019s
 * watching note in BOTH states (no body lease; body lease active — never
 * merged), the drained hero line, and the honest observation content that
 * exists with zero body presence (branch heads, CI runs, deployments,
 * findings — all with LIVE provenance and evidence ids).
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
import { drainedObservation, freshUserObservation, h, OBSERVED_HEAD_EVENT, render } from './helpers';

describe('journey: observation without a body — watching is continuous and body-free', () => {
  it('the root understanding states the watching contract (observation is how SOS holds state)', () => {
    const html = render(h(RootPage));
    const block = html.slice(html.indexOf('data-first-run-understanding="watches-continuously"'));
    expect(block).toContain('SOS watches continuously');
    expect(block).toContain('Watching is not something you start — it is how SOS holds state');
    expect(block).toContain('what changed and why is already there');
  });

  it('with no body lease active, the watching note says so explicitly', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(true), missions: [] }));
    expect(html).toContain('data-watching-without-body="true"');
    expect(html).toContain('no body lease is active right now');
  });

  it('with a body lease active, watching is shown separately — never merged with body work', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(false), missions: [] }));
    expect(html).toContain('data-watching-without-body="false"');
    expect(html).toContain('a body lease is active — shown separately, never merged with watching');
  });

  it('the drained hero states the no-body drain outright', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(true), missions: [] }));
    expect(html).toContain('SOS is watching without a body.');
  });

  it('observation content exists with ZERO body presence: heads, CI, deployments, findings — all LIVE', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(true), missions: [] }));
    expect(html).toContain('Repository — branch heads');
    expect(html).toContain(OBSERVED_HEAD_EVENT); // the evidence id behind the observed head
    expect(html).toContain('CI — latest runs');
    expect(html).toContain('SUCCESS'); // CI status carried verbatim
    expect(html).toContain('Deployments');
    expect(html).toContain('production');
    expect(html).toContain('Reconciliation — findings');
    expect(html).toContain('ALIGNED');
    expect(html).toContain('DIVERGED');
    expect((html.match(/data-live-badge="true"/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('the honest four-state source vocabulary renders with the real recorded error (never silence)', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(true), missions: [] }));
    // every state renders as a labelled chip (color is never the only channel)
    for (const state of ['CONNECTED', 'UNAVAILABLE', 'DEGRADED', 'UNKNOWN']) {
      expect(html).toContain(`Source state: `);
      expect(html).toContain(`>${state}</span>`);
    }
    expect(html).toContain('HTTP 401: authentication failed'); // the real recorded error, visible
    expect(html).toContain('never probed'); // the UNKNOWN source's honest detail
    expect(html).toContain('throttled — partial capture'); // the DEGRADED source's honest detail
  });

  it('the un-drained state still separates watching from bodies (the fresh surface is equally honest)', () => {
    const html = render(h(LiveMissionPage, { data: freshUserObservation(), missions: [] }));
    expect(html).toContain('data-watching-without-body="true"');
    expect(html).toContain('SOS is watching');
    expect(html).toContain('does not use a working body');
  });

  it('the shell overview carries the same separation for returning users (watching shown separately from body work)', () => {
    const html = render(h(RootPage));
    expect(html).toContain('Observation status'); // the autonomous-work section card
    expect(html).toContain('SOS is watching');
    expect(html).toContain('Body leases');
  });
});
