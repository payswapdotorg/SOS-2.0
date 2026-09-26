/**
 * ROOT-PAGE DISCOVERABILITY SPECS (Work Order P18-C) — suite 1 of the
 * journey instrumentation: a FRESH USER landing on `/` (no knowledge of
 * /onboarding, internal package names or the P17 architecture) must
 * immediately see and be able to follow:
 *
 *   - the accomplish question (the visible page headline);
 *   - onboarding as a first-class entry;
 *   - the mission entry points (start / import / resume);
 *   - the five first-run understandings (progressive disclosure);
 *   - and nothing but REAL routes (machine-checked against apps/web/app).
 *
 * Everything is asserted on the SERVER-RENDERED markup (renderToStaticMarkup
 * with next/link stubbed to an anchor — the P4/P17-C render discipline):
 * if a fresh user cannot see it in the static output, it is not
 * discoverable. Server-rendered-only is pinned structurally (no client
 * directive in the page source, no script tags in the output).
 */

import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

// The Next App Router is not mounted in these tests; a Link is an anchor
// (the P4/P17-C render-suite discipline).
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import RootPage from '@web-app/root-page';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorTags, discoverySection, h, hrefs, realAppRoutes, render } from './helpers';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
/** The root route (thin wrapper) + its colocated discovery module — the complete owned surface. */
const ROUTE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'apps/web/app/page.tsx'), 'utf8');
const SURFACE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'apps/web/app/start-surface.tsx'), 'utf8');
const PAGE_SOURCE = `${ROUTE_SOURCE}\n${SURFACE_SOURCE}`;

function renderRoot(): string {
  return render(h(RootPage));
}

describe('the root first-user surface: the accomplish question', () => {
  it('renders "What are you trying to accomplish?" as the visible page headline', () => {
    const html = renderRoot();
    expect(html).toContain('What are you trying to accomplish?');
    const headingMatch = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/);
    expect(headingMatch).not.toBeNull();
    expect(headingMatch?.[0]).toContain('What are you trying to accomplish?');
  });

  it('explains what SOS is in plain language on first contact (no internal names required)', () => {
    const section = discoverySection(renderRoot());
    expect(section).toContain('watches continuously');
    expect(section).toContain('asks when authority or evidence is insufficient');
    expect(section).toContain('acts only under authority you grant');
    expect(section).toContain('you do not need to know any internal names');
  });
});

describe('the root first-user surface: onboarding + mission entry discovery', () => {
  it('makes onboarding a first-class entry (the P18 structural fix)', () => {
    const section = discoverySection(renderRoot());
    expect(section).toContain('New here? Start with onboarding');
    expect(section).toContain('href="/onboarding"');
    expect(section).toContain('Open onboarding');
  });

  it('offers the three accomplishment paths with their real destinations', () => {
    const html = renderRoot();
    expect(html).toContain('Start something new');
    expect(html).toContain('Bring an existing system');
    expect(html).toContain('Resume or watch current work');
    expect(html).toContain('data-accomplishment-entry="start"');
    expect(html).toContain('data-accomplishment-entry="import"');
    expect(html).toContain('data-accomplishment-entry="resume"');
    // the exact entry destinations: the greenfield journey, the brownfield import, the mission surface
    expect(html).toContain('href="/onboarding/greenfield"');
    expect(html).toContain('href="/onboarding/brownfield"');
    expect(html).toContain('href="/mission"');
    expect(html).toContain('Start mission');
    expect(html).toContain('Import system');
    expect(html).toContain('Go to the mission surface');
  });

  it('a fresh user needs no knowledge of /onboarding or package names to follow an entry', () => {
    const section = discoverySection(renderRoot());
    // The entry copy speaks journeys and outcomes, never internal artifact names
    // or route jargon; the labels themselves are the affordance.
    for (const label of ['Start mission', 'Import system', 'Go to the mission surface', 'Open onboarding']) {
      expect(section).toContain(label);
    }
    expect(section).not.toMatch(/@[a-z0-9-]+\//); // no workspace package names in the discovery copy
    expect(section).not.toContain('greenfield-runtime');
    expect(section).not.toContain('action-gateway');
    expect(section).not.toContain('P17');
  });
});

describe('the root first-user surface: the five first-run understandings', () => {
  const html = renderRoot();
  const section = discoverySection(html);

  it('presents all five understandings with stable ids (progressive disclosure via native details/summary)', () => {
    for (const id of ['watches-continuously', 'summons-bodies', 'computer-optional', 'asks-when-unsure', 'independent-verification']) {
      expect(section).toContain(`data-first-run-understanding="${id}"`);
    }
    const detailsCount = (section.match(/<details\b/g) ?? []).length;
    expect(detailsCount).toBe(5);
    const summaryCount = (section.match(/<summary\b/g) ?? []).length;
    expect(summaryCount).toBe(5);
  });

  it('headline 1: SOS watches continuously — visible on the closed disclosure, explanation on demand', () => {
    expect(section).toContain('SOS watches continuously');
    const block = section.slice(section.indexOf('data-first-run-understanding="watches-continuously"'));
    expect(block).toContain('observes your repositories, CI runs, deployments and runtime signals all the time');
    expect(block).toContain('carries its evidence');
  });

  it('headline 2: SOS can summon bodies', () => {
    expect(section).toContain('SOS can summon bodies to do the work');
    const block = section.slice(section.indexOf('data-first-run-understanding="summons-bodies"'));
    expect(block).toContain('leased worker that acts under authority you granted');
    expect(block).toContain('the task, its checkpoints and its evidence outlive any single body');
  });

  it('headline 3: the user\u2019s computer is optional', () => {
    expect(section).toContain('Your computer is optional');
    const block = section.slice(section.indexOf('data-first-run-understanding="computer-optional"'));
    expect(block).toContain('work runs in the cloud');
    expect(block).toContain('You can close your laptop');
  });

  it('headline 4: SOS asks when authority or evidence is insufficient', () => {
    expect(section).toContain('SOS asks when authority or evidence is insufficient');
    const block = section.slice(section.indexOf('data-first-run-understanding="asks-when-unsure"'));
    expect(block).toContain('it stops and asks');
    expect(block).toContain('typed decision record');
  });

  it('headline 5: completion requires independent verification', () => {
    expect(section).toContain('Completion requires independent verification');
    const block = section.slice(section.indexOf('data-first-run-understanding="independent-verification"'));
    expect(block).toContain('a body can never certify its own work');
    expect(block).toContain('unresolved uncertainty stays visible');
  });

  it('each understanding links where the user can SEE it (real routes, 44px touch targets)', () => {
    const links = [
      { href: '/mission', label: 'See the mission surface' },
      { href: '/evidence', label: 'See what SOS knows' },
      { href: '/ask', label: 'Open the ASK queue' },
      { href: '/history', label: 'The full history' },
      { href: '/experiments', label: 'Experiments' },
    ];
    for (const link of links) {
      const anchor = anchorTags(section).find((tag) => tag.includes(`href="${link.href}"`));
      expect(anchor, `the discovery surface must link ${link.href} (${link.label})`).toBeDefined();
      expect(anchor).toContain('min-h-[44px]');
    }
  });
});

describe('the root first-user surface: honesty + server-rendering discipline', () => {
  it('links only REAL routes (machine-checked against the app directory)', () => {
    const html = renderRoot();
    const { staticRoutes, dynamicPatterns } = realAppRoutes();
    const linked = hrefs(html).filter((href) => href.startsWith('/'));
    expect(linked.length).toBeGreaterThan(10); // the shell nav + the discovery surface
    for (const href of linked) {
      const isStatic = staticRoutes.has(href);
      const isDynamic = dynamicPatterns.some((pattern) => pattern.test(href));
      expect(
        isStatic || isDynamic,
        `the root page links ${href}, which is not a real app route`,
      ).toBe(true);
    }
  });

  it('is server-rendered only: no client directive, no client script, no client fetch in the page source', () => {
    expect(PAGE_SOURCE).not.toContain("'use client'");
    expect(PAGE_SOURCE).not.toContain('"use client"');
    expect(PAGE_SOURCE).not.toContain('useEffect');
    expect(PAGE_SOURCE).not.toContain('fetch(');
    const html = renderRoot();
    expect(html).not.toContain('<script');
  });

  it('keeps the route a THIN wrapper (the frozen shell contract) with the discovery surface colocated beside it', () => {
    // The frozen shell test (apps/web/shell/test/navigation.test.ts) pins every
    // shell route to a thin wrapper importing from the shell; this suite pins
    // the same contract independently so the integration head cannot regress it.
    const nonEmpty = ROUTE_SOURCE.split('\n').filter((line) => line.trim().length > 0);
    expect(nonEmpty.length, 'the root route must stay a thin wrapper (≤ 11 non-empty lines)').toBeLessThanOrEqual(11);
    expect(ROUTE_SOURCE).toMatch(/shell\//);
    // the discovery module is a COLOCATED non-route file (no page.tsx of its own — it creates no route)
    expect(fs.existsSync(path.join(REPO_ROOT, 'apps/web/app/start-surface/page.tsx'))).toBe(false);
  });

  it('the discovery surface makes no live/connected data claims of its own', () => {
    const section = discoverySection(renderRoot());
    // The discovery copy guides and links; it never asserts a live or connected
    // state — provenance belongs to the surfaces it links (they render their own
    // LIVE/DEMO badges).
    expect(section).not.toContain('data-live-badge');
    expect(section).not.toContain('CONNECTED');
    expect(section).not.toMatch(/\bLIVE\b/);
  });

  it('keeps the overview composition below the discovery surface (returning users keep their surface)', () => {
    const html = renderRoot();
    expect(html.indexOf('What are you trying to accomplish?')).toBeLessThan(html.indexOf('Mission outcome health'));
    for (const kept of ['Current change', 'Evidence quality', 'Active autonomous work', 'SOS is watching']) {
      expect(html).toContain(kept);
    }
  });

  it('preserves the shell landmarks and a11y structure', () => {
    const html = renderRoot();
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('aria-label="Bottom"');
    expect(html).toContain('id="main-content"');
    expect(html).toContain('Skip to main content');
    expect(html).toContain('aria-labelledby="start-heading"');
    expect(html).toContain('aria-labelledby="first-run-heading"');
    expect(html).toContain('aria-label="What you can do"');
    expect(html).toContain('aria-label="The five first-run understandings"');
    expect(html).toContain('aria-label="Mission and system overview"');
  });

  it('renders byte-identically for the same input (deterministic server output)', () => {
    expect(renderRoot()).toBe(renderRoot());
  });
});
