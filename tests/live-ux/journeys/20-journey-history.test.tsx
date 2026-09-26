/**
 * JOURNEY 11/12 — HISTORY (Work Order P18-C).
 *
 * History is the "what happened while you were away / what superseded
 * what" surface. The journey verifies the user can FOLLOW it from every
 * entry point they naturally sit at: the root understanding links it as
 * the return affordance; the shell rail (rendered by every page,
 * including the live mission surface) carries the History section; and
 * the history page itself renders the revision timeline with supersedes
 * relationships, dates and rationale deep-links (identity preserved
 * across revisions).
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
import { HistoryPage } from '@web-shell/history-page';
import { drainedObservation, h, render } from './helpers';

describe('journey: history — what superseded what, and when', () => {
  it('the root understanding links history as the return affordance (read what happened)', () => {
    const html = render(h(RootPage));
    const block = html.slice(html.indexOf('data-first-run-understanding="computer-optional"'));
    expect(block).toContain('href="/history"');
    expect(block).toContain('The full history');
  });

  it('every page the user sits on carries the History section in the shell rail (persistent discovery)', () => {
    const liveMission = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    const railAnchor = (liveMission.match(/<a[^>]*href="\/history"[^>]*>/g) ?? [])[0];
    expect(railAnchor).toBeDefined();
    expect(railAnchor).toContain('min-h-[44px]');
    expect(liveMission).toContain('History');

    const root = render(h(RootPage));
    expect((root.match(/<a[^>]*href="\/history"[^>]*>/g) ?? [])[0]).toBeDefined();
  });

  it('the history page renders the revision timeline with supersedes relationships and dates', () => {
    const html = render(h(HistoryPage));
    expect(html).toContain('History');
    expect(html).toContain('The revision timeline: what superseded what, when, and why. Identity is preserved across revisions.');
    expect(html).toContain('Timeline');
    expect(html).toContain('status:');
    expect(html).toContain('at:');
    expect(html).toContain('version:');
  });

  it('every timeline entry links its rationale (the why behind each revision)', () => {
    const html = render(h(HistoryPage));
    expect(html).toContain('href="/rationale/');
    expect(html).toContain('— rationale');
  });

  it('the history surface is honest about its data source (DEMO-badged fixture timeline)', () => {
    const html = render(h(HistoryPage));
    expect(html).toContain('data-demo-badge="true"');
    expect(html).toContain('DEMO — SIMULATED DATA');
    expect(html).not.toContain('data-live-badge');
  });

  it('the live mission surface\u2019s observation data links forward into the same evidence discipline (drained-at + store)', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    expect(html).toContain('drained at');
    expect(html).toContain('store:');
    expect(html).toContain('What evidence supports it?');
  });
});
