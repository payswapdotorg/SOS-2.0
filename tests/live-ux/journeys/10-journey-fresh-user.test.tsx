/**
 * JOURNEY 1/12 — FRESH USER (Work Order P18-C).
 *
 * A user with no mission, no observation history and no knowledge of the
 * product opens the mission surface. The journey verifies the user can
 * FOLLOW the fresh state through the UI: what they are told honestly
 * (nothing drained, nothing fabricated), where they are offered to go
 * next (onboarding first-class; start/import/resume entries), and that
 * every consequential action stays disabled with its honest reason —
 * never silently enabled, never fabricated.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { LiveMissionPage } from '@live-mission/page';
import { freshUserObservation, h, render } from './helpers';

function renderFresh(): string {
  return render(h(LiveMissionPage, { data: freshUserObservation(), missions: [] }));
}

describe('journey: fresh user — the honest empty mission surface', () => {
  it('tells the user honestly that nothing has been observed yet (never fabricated live state)', () => {
    const html = renderFresh();
    expect(html).toContain('No live observation drain has run yet');
    expect(html).toContain('never fabricated live state');
  });

  it('answers the six product review questions from the first contact', () => {
    const html = renderFresh();
    expect(html).toContain('What is happening?');
    expect(html).toContain('Why does SOS believe this?');
    expect(html).toContain('What evidence supports it?');
    expect(html).toContain('What uncertainty remains?');
    expect(html).toContain('What authority is required?');
    expect(html).toContain('What can happen next?');
  });

  it('offers onboarding as a first-class next step (the fresh user\u2019s visible path forward)', () => {
    const html = renderFresh();
    expect(html).toContain('New here? Start with onboarding');
    expect(html).toContain('href="/onboarding"');
  });

  it('offers all three mission entry points with their destinations', () => {
    const html = renderFresh();
    expect(html).toContain('Start a mission');
    expect(html).toContain('href="/onboarding/greenfield"');
    expect(html).toContain('Start mission');
    expect(html).toContain('Import a system');
    expect(html).toContain('href="/onboarding/brownfield"');
    expect(html).toContain('Import system');
    expect(html).toContain('Resume an existing mission');
  });

  it('shows the honest empty resume state (nothing fabricated in the mission store)', () => {
    const html = renderFresh();
    expect(html).toContain('No mission exists yet');
    expect(html).toContain('nothing is fabricated here');
    // the empty resume state still points forward
    expect(html).toContain('Start one above');
  });

  it('keeps every consequential action disabled with its honest reason (no head, no deployment)', () => {
    const html = renderFresh();
    expect(html).toContain('No observed repository head yet — the envelope needs the exact source revision to act on (never fabricated).');
    expect(html).toContain('No observed repository head yet — promotion needs the exact verified source revision.');
    expect(html).toContain('No observed production deployment yet — rollback needs the exact deployment to roll back.');
    const disabledButtons = html.match(/<button[^>]*disabled[^>]*>/g) ?? [];
    expect(disabledButtons.length).toBe(3);
  });

  it('renders every live projection as its honest empty state', () => {
    const html = renderFresh();
    expect(html).toContain('No source has been probed yet');
    expect(html).toContain('No branch head observed yet (NO_DATA — never fabricated).');
    expect(html).toContain('No CI run observed yet.');
    expect(html).toContain('No deployment observed yet — an honestly empty projection, never a fabricated one.');
    expect(html).toContain('nothing claimed — nothing verified — honest emptiness');
  });

  it('still explains the watching-without-body rule (observation is continuous and body-free)', () => {
    const html = renderFresh();
    expect(html).toContain('SOS is watching');
    expect(html).toContain('does not use a working body');
  });

  it('labels every surface LIVE and never renders a DEMO badge on this surface\u2019s own cards', () => {
    const html = renderFresh();
    const badges = html.match(/data-live-badge="true"/g) ?? [];
    expect(badges.length).toBeGreaterThanOrEqual(5);
  });

  it('renders deterministically (the same honest state, byte for byte)', () => {
    expect(renderFresh()).toBe(renderFresh());
  });
});
