/**
 * P18-B deterministic reference-mode suite (6/7): THE MOUNT SEAMS.
 * Pins the structural fix and the honest wiring:
 *
 *   - the data seam (apps/web/app/live-mission/data-seam.ts) delegates to
 *     the lane-A producer (the P18-INT A→B→C seam swap): with an
 *     INCOMPLETE observation environment (this suite runs offline, no
 *     provider credentials) the producer returns the honest empty
 *     observation — the EXPLICIT reference-store marker (a selection DID
 *     run; reference state never masquerades as production durable
 *     state), the real probe instant, no drain — never fabricated live
 *     state; every mission surface consumes ONLY the seam;
 *
 * P18-INT FLAGGED DEVIATION (cross-owned-path; architect ruling
 * requested — see the P18-INT evidence README + completion report): the
 * work order mandates the seam swap (§1) AND a green full suite (§3);
 * the swap necessarily obsoletes three of this file's original pins on
 * the PRE-swap body ('unwired'/'never'/byte-equal calls). Those three
 * assertions were updated here to pin the POST-swap honest states with
 * equal strength — the work order's owned surface does not include this
 * file; the architect may revert/re-pin in one commit. Every other
 * assertion in this file is byte-identical to the P18-B delivery.
 *
 *   - the /mission route (REPLACED — the operator's structural fix)
 *     renders the live Mission experience server-side: the actionable
 *     entry points (Start mission / Import system / Resume existing
 *     mission + first-class onboarding), the live observation view with
 *     honest empty states, and the consequential action panel whose
 *     forms POST to /api/live-mission/actions;
 *   - the /live-mission route mounts identically (MOUNTING.md step 1);
 *   - both routes are dynamic (live state is never statically cached);
 *   - the receipt page renders the honest not-in-this-process state for
 *     unknown keys (never fabricated from the key alone).
 */

import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { getLiveMissionData, LIVE_MISSION_REPOSITORY_SUBJECT } from '@live-action/seam';
import MissionPage from '@live-action/mission-route';
import LiveMissionRoute from '@live-action/live-mission-route';
import ReceiptPage from '@live-action/receipt-page';

/** Server-render an async server component tree to its full HTML (React 19 static prerender — what Next itself produces). */
async function renderPage(page: () => ReactElement | Promise<ReactElement>): Promise<string> {
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

// The mission routes are async server components (they await the data
// seam) — the honest render happens once at module top level and every
// assertion reads the SAME server-rendered markup a user receives.
const missionHtml = await renderPage(MissionPage);
const liveMissionHtml = await renderPage(LiveMissionRoute);

describe('the data seam (the architect-defined binding)', () => {
  it('returns the honest producer-backed empty observation for an incomplete environment (never fabricated live state)', async () => {
    const data = await getLiveMissionData();
    // P18-INT swap: the seam delegates to the lane-A producer. This suite
    // runs offline with no provider credentials, so the producer takes its
    // honest incomplete-environment path: no observation env -> no drain
    // (drainedAt null), no durable store answered a real probe -> the
    // EXPLICIT reference marker (never 'unwired': a real selection probe
    // DID run; never production durable state), asOf = the real selection
    // instant. (P18-INT flagged deviation: this pin was updated from the
    // pre-swap 'unwired'/'never' values — see the file header.)
    expect(data.storeRef).toBe('reference:in-memory-observation-store');
    expect(data.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(data.drainedAt).toBeNull();
    expect(data.repository.subject).toBe(LIVE_MISSION_REPOSITORY_SUBJECT);
    expect(data.repository.subject).toBe('github:repo:payswapdotorg/SOS-2.0');
    expect(data.repository.freshness).toBe('NO_DATA');
    expect(data.ci.freshness).toBe('NO_DATA');
    expect(data.deployments.freshness).toBe('NO_DATA');
    expect(data.sources).toEqual([]);
    expect(data.eventsInWindow).toBe(0);
    expect(data.watchingWithoutBody).toBe(true);
  });

  it('is structurally deterministic (the same honest shape every call; only the observation instant moves with the real clock)', async () => {
    const first = await getLiveMissionData();
    const second = await getLiveMissionData();
    // (P18-INT flagged deviation: the pre-swap body was byte-identical per
    // call; live observation is per-request by design — each call is ONE
    // bounded data-plane pass at the real clock. The SHAPE is pinned
    // deterministically: everything except asOf is equal, and asOf never
    // regresses.)
    const { asOf: firstAsOf, ...firstShape } = first;
    const { asOf: secondAsOf, ...secondShape } = second;
    expect(firstShape).toEqual(secondShape);
    expect(secondAsOf >= firstAsOf).toBe(true);
  });
});

describe('the REPLACED /mission route mounts the live Mission experience', () => {
  const html = missionHtml;

  it('renders the live mission surface (the actionable mission — the structural fix)', () => {
    expect(html).toContain('Mission — live');
    expect(html).toContain('actionable mission surface');
  });

  it('keeps the shell landmarks and navigation (the P1 discipline)', () => {
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('id="main-content"');
    expect(html).toContain('Skip to main content');
  });

  it('makes mission actionable: Start mission / Import system / Resume existing mission', () => {
    expect(html).toContain('Start a mission');
    expect(html).toContain('Import a system');
    expect(html).toContain('Resume an existing mission');
    expect(html).toContain('href="/onboarding/greenfield"');
    expect(html).toContain('href="/onboarding/brownfield"');
  });

  it('keeps onboarding a first-class entry (the P18 first-user path)', () => {
    expect(html).toContain('New here? Start with onboarding');
    expect(html).toContain('href="/onboarding"');
  });

  it('renders the honest unwired observation states (UNKNOWN/NO_DATA — never fabricated)', () => {
    expect(html).toContain('No live observation drain has run yet');
    expect(html).toContain('never fabricated live state');
    expect(html).toContain('No branch head observed yet');
    expect(html).toContain('No deployment observed yet');
    expect(html).toContain('SOS is watching');
  });

  it('labels the surface LIVE (the honest provenance badge, the explicit reference-store marker)', () => {
    // (P18-INT flagged deviation: pinned 'unwired' pre-swap; post-swap the
    // badge carries the producer's honest store identity — the explicit
    // reference marker while the canonical store is unattached.)
    expect(html).toContain('data-live-badge="true"');
    expect(html).toContain('reference:in-memory-observation-store');
  });

  it('renders the consequential action panel with the forms POSTing to the live action endpoint', () => {
    expect(html).toContain('Consequential actions');
    expect(html).toContain('action="/api/live-mission/actions"');
    expect(html).toContain('the UI never mutates state directly');
    expect((html.match(/name="action" value="/g) ?? []).length).toBe(3);
  });

  it('honestly disables the actions until a head is observed (the forms carry no fabricated sha)', () => {
    expect(html).toContain('disabled');
    expect(html).toContain('No observed repository head yet');
    expect(html).toContain('No observed production deployment yet');
  });

  it('answers the six product review questions (rationale + uncertainty preserved)', () => {
    expect(html).toContain('What is happening?');
    expect(html).toContain('Why does SOS believe this?');
    expect(html).toContain('What evidence supports it?');
    expect(html).toContain('What uncertainty remains?');
    expect(html).toContain('What authority is required?');
    expect(html).toContain('What can happen next?');
  });

  it('honestly links package composition to the Packages workspace (no fabricated action family)', () => {
    expect(html).toContain('Package composition has no action-gateway family');
    expect(html).toContain('href="/packages"');
  });

  it('renders the resumable-missions card honestly empty (no mission store wired)', () => {
    expect(html).toContain('No mission exists yet');
    expect(html).toContain('nothing is fabricated here');
  });
});

describe('the /live-mission route mounts the same experience (MOUNTING.md step 1)', () => {
  const html = liveMissionHtml;

  it('renders the live mission page through the SAME data seam', () => {
    expect(html).toContain('Mission — live');
    expect(html).toContain('No live observation drain has run yet');
    expect(html).toContain('action="/api/live-mission/actions"');
  });
});

describe('the route modules export the live-data discipline', () => {
  it('both mission routes are force-dynamic (live state is never statically cached)', async () => {
    const mission = await import('@live-action/mission-route');
    const liveMission = await import('@live-action/live-mission-route');
    expect(mission.dynamic).toBe('force-dynamic');
    expect(liveMission.dynamic).toBe('force-dynamic');
  });
});

describe('the receipt page renders the honest not-in-this-process state', () => {
  it('an unknown key (no submission in this process) renders the honest empty receipt state', async () => {
    const html = await renderPage(() => createElement(ReceiptPage, { searchParams: Promise.resolve({ key: 'never-submitted' }) }));
    expect(html).toContain('No receipt for this key in the current process');
    expect(html).toContain('not fabricated from the key alone');
    expect(html).toContain('IN-PROCESS');
    expect(html).toContain('href="/mission"');
  });

  it('a missing key parameter renders the same honest state', async () => {
    const html = await renderPage(() => createElement(ReceiptPage, { searchParams: Promise.resolve({}) }));
    expect(html).toContain('No receipt for this key in the current process');
  });
});
