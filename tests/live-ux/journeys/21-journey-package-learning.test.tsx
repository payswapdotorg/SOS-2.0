/**
 * JOURNEY 12/12 — PACKAGE LEARNING (Work Order P18-C).
 *
 * Validated, reusable capabilities with retained limitations. The journey
 * verifies the user can FOLLOW package learning through the UI: the live
 * mission surface links the Packages workspace HONESTLY (package
 * composition has no action-gateway family — no fabricated action, an
 * honest note instead); the shell rail carries the Packages section; the
 * packages page renders the reusable capabilities; and the overview keeps
 * the "Recent learning" + "Package reuse" cards visible (learning is a
 * first-class product outcome, never hidden inside package internals).
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
import { PackagesPage } from '@web-shell/packages-page';
import { drainedObservation, h, render } from './helpers';

describe('journey: package learning — validated, reusable capabilities with retained limitations', () => {
  it('the live mission surface links the Packages workspace instead of fabricating a composition action', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    expect(html).toContain('Package composition');
    expect(html).toContain('no action-gateway family in the merged contracts');
    expect(html).toContain('rather than fabricate an action, this surface links the existing Packages');
    expect(html).toContain('href="/packages"');
    expect(html).toContain('Open the Packages workspace');
  });

  it('the shell rail carries the Packages section on every page (persistent discovery)', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    const railAnchor = (html.match(/<a[^>]*href="\/packages"[^>]*>/g) ?? [])[0];
    expect(railAnchor).toBeDefined();
    expect(railAnchor).toContain('min-h-[44px]');
    expect(html).toContain('Validated, reusable capabilities with retained limitations');
  });

  it('the packages page renders the reusable capabilities with their honest data source', () => {
    const html = render(h(PackagesPage));
    expect(html).toContain('Packages');
    expect(html).toContain('data-demo-badge="true"');
  });

  it('the overview keeps learning visible as a first-class outcome (recent learning + package reuse)', () => {
    const html = render(h(RootPage));
    expect(html).toContain('Recent learning');
    expect(html).toContain('Package reuse');
  });

  it('the overview\u2019s learning card renders its content after the discovery surface (kept strengths, below)', () => {
    const html = render(h(RootPage));
    expect(html.indexOf('What are you trying to accomplish?')).toBeLessThan(html.indexOf('Recent learning'));
  });

  it('the root understanding on completion names the independent-evaluation gate that package reuse depends on', () => {
    const html = render(h(RootPage));
    const block = html.slice(html.indexOf('data-first-run-understanding="independent-verification"'));
    expect(block).toContain('Completion requires independent verification');
    expect(block).toContain('unresolved uncertainty stays visible');
  });
});
