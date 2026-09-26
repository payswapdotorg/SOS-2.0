/**
 * ONBOARDING DISCOVERABILITY SPECS (Work Order P18-C) — suite 2: the
 * FIRST-USER PATH through the REAL product surfaces, followed click by
 * click on server-rendered markup. The journey pinned here is the one the
 * P18 work order names: `/` → What are you trying to accomplish? → Start
 * mission → Greenfield / Brownfield. A fresh user must be able to follow
 * it WITHOUT knowing `/onboarding` exists — the root links it, the hub
 * links the guided journeys, and each journey's first step renders a
 * usable, accessible surface.
 *
 * Honesty pins: the hub shows the provider-neutral connection state
 * honestly (NOT_YET_CONNECTED for the real system; SIMULATED reference
 * provider badged DEMO); every surface that renders fixture data carries
 * the DEMO badge (a simulated connection can never render as a real one).
 */

import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import RootPage from '@web-app/root-page';
import { OnboardingHub } from '@web-onboarding/hub';
import { GreenfieldWizard } from '@web-onboarding/greenfield';
import { BrownfieldFlow } from '@web-onboarding/brownfield';
import { discoverySection, h, realAppRoutes, render } from './helpers';

const DEMO_LABEL = 'DEMO — SIMULATED DATA';

describe('first-user path, leg 1: the root links onboarding (verified on the root render)', () => {
  it('a fresh user who has never heard of /onboarding is offered it in plain language', () => {
    const section = discoverySection(render(h(RootPage)));
    expect(section).toContain('New here? Start with onboarding');
    expect(section).toContain('href="/onboarding"');
  });
});

describe('first-user path, leg 2: the onboarding hub renders the guided journeys', () => {
  const html = render(h(OnboardingHub));

  it('introduces itself in plain language (no SOS artifact names required)', () => {
    expect(html).toContain('Start here. Shape a mission and connect a GitHub repository');
    expect(html).toContain('without knowing any SOS artifact names');
  });

  it('offers the greenfield journey (the "Start mission" path from the root lands here)', () => {
    expect(html).toContain('Start a mission');
    expect(html).toContain('href="/onboarding/greenfield"');
    expect(html).toContain('purpose → outcomes → stakeholders → measures → constraints → review');
  });

  it('offers the brownfield import (the "Import system" path from the root lands here)', () => {
    expect(html).toContain('Import an existing system');
    expect(html).toContain('href="/onboarding/brownfield"');
    expect(html).toContain('COMPETING architecture readings');
  });

  it('offers the advanced raw-JSON import, clearly secondary', () => {
    expect(html).toContain('Advanced: raw JSON import');
    expect(html).toContain('href="/onboarding/advanced"');
    expect(html).toContain('clearly secondary');
  });

  it('shows the GitHub connection state honestly (reference provider SIMULATED; the real system honestly NOT_YET_CONNECTED)', () => {
    expect(html).toContain('GitHub connection');
    expect(html).toContain('Connected — SIMULATED (reference provider)');
    expect(html).toContain('never presented as a real GitHub connection');
    expect(html).toContain('The real-system connection is honestly NOT_YET_CONNECTED');
    expect(html).toContain(DEMO_LABEL);
    expect(html).toContain('data-demo-badge="true"');
  });

  it('renders the shell landmarks (the hub inherits the product a11y structure)', () => {
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('id="main-content"');
    expect(html).toContain('Skip to main content');
  });
});

describe('first-user path, leg 3a: the greenfield wizard\u2019s first step is usable (the journey continues)', () => {
  const html = render(h(GreenfieldWizard, { params: {} }));

  it('opens on the purpose step with a GET form a fresh user can fill', () => {
    expect(html).toContain('Start a mission');
    expect(html).toContain('Purpose');
    expect(html).toMatch(/<form[^>]*method="get"/);
  });

  it('shows the full journey ahead (progressive formalization is visible, not hidden)', () => {
    expect(html).toContain('aria-label="Journey progress"');
    expect(html).toContain('Purpose');
    expect(html).toContain('Review');
    expect(html).toContain('Authority');
    expect(html).toContain('GitHub connection');
  });

  it('labels the fixture-backed surface honestly (the fixture revision is stated; never a live claim)', () => {
    expect(html).toContain('Fixture revision');
    expect(html).toContain(DEMO_LABEL); // the P1 shell footer label rides along on every page
    expect(html).not.toContain('data-live-badge');
  });
});

describe('first-user path, leg 3b: the brownfield import\u2019s first step is usable (the journey continues)', () => {
  const html = render(h(BrownfieldFlow, { params: {} }));

  it('opens on the repository import step with the discovery list (fixture, badged)', () => {
    expect(html).toContain('Import an existing system');
    expect(html).toContain('Repository import');
    expect(html).toMatch(/<form[^>]*method="get"/);
    expect(html).toContain('acme/empty-repo');
    expect(html).toContain('acme/legacy-checkout');
  });

  it('states the honest scan contract up front (evidence scanned honestly; competing readings never collapsed)', () => {
    expect(html).toContain('scan the evidence honestly');
    expect(html).toContain('never collapsed');
    expect(html).toContain('What evidence supports it?');
    expect(html).toContain('honestly empty at this step, never fabricated');
  });

  it('carries the DEMO badge on the fixture-backed surface (never a live claim)', () => {
    expect(html).toContain('data-demo-badge="true"');
  });
});

describe('the followed path stays coherent end to end (the discovery chain has no dead leg)', () => {
  it('every link the root discovery surface and the onboarding hub offer targets a REAL app route (machine-checked)', () => {
    const root = render(h(RootPage));
    const hub = render(h(OnboardingHub));
    const combined = `${discoverySection(root)}\n${hub}`;
    const offered = (combined.match(/href="(\/[^"]*)"/g) ?? []).map((match) => match.slice('href="'.length, -1));
    expect(offered.length).toBeGreaterThanOrEqual(7);
    const { staticRoutes, dynamicPatterns } = realAppRoutes();
    for (const href of offered) {
      const isStatic = staticRoutes.has(href);
      const isDynamic = dynamicPatterns.some((pattern) => pattern.test(href));
      expect(isStatic || isDynamic, `the followed path links ${href}, which is not a real app route`).toBe(true);
    }
  });
});
