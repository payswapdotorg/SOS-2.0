/**
 * JOURNEY 3/12 — BROWNFIELD (Work Order P18-C).
 *
 * The user brings an existing system. The journey verifies they can
 * FOLLOW the brownfield path through the UI: the mission surface\u2019s
 * "Import a system" entry with its honest description (observe, recover
 * COMPETING readings, ask the user to confirm one), and the hand-off into
 * the import flow whose first step renders the repository selection with
 * the fixture discovery list (DEMO-badged, honest). Partial evidence
 * stays partial; the set of readings is never collapsed.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { LiveMissionPage } from '@live-mission/page';
import { BrownfieldFlow } from '@web-onboarding/brownfield';
import { freshUserObservation, h, render } from './helpers';

describe('journey: brownfield — import an existing system', () => {
  it('the mission surface offers the brownfield entry with the honest import description', () => {
    const html = render(h(LiveMissionPage, { data: freshUserObservation(), missions: [] }));
    expect(html).toContain('Import a system');
    expect(html).toContain('SOS observes it, recovers the competing architecture readings, and asks you to confirm one');
  });

  it('the import entry is exactly the brownfield route', () => {
    const html = render(h(LiveMissionPage, { data: freshUserObservation(), missions: [] }));
    const importAnchor = (html.match(/<a[^>]*href="\/onboarding\/brownfield"[^>]*>/g) ?? [])[0];
    expect(importAnchor).toBeDefined();
    expect(html).toContain('Import system');
  });

  it('the hand-off lands on the repository import step (GET form, discovery list, DEMO-badged)', () => {
    const flow = render(h(BrownfieldFlow, { params: {} }));
    expect(flow).toContain('Import an existing system');
    expect(flow).toContain('Repository import');
    expect(flow).toMatch(/<form[^>]*method="get"/);
    expect(flow).toContain('acme/legacy-checkout');
    expect(flow).toContain('data-demo-badge="true"');
  });

  it('the import step states the honest fixture/live discovery distinction', () => {
    const flow = render(h(BrownfieldFlow, { params: {} }));
    expect(flow).toContain('the fixture discovery list is shown (DEMO); the live discovery runs against the connected provider');
  });

  it('the evidence-scan contract is visible ahead of time (honest scan; competing readings never collapsed)', () => {
    const flow = render(h(BrownfieldFlow, { params: {} }));
    expect(flow).toContain('scan the evidence honestly');
    expect(flow).toContain('never collapsed');
    expect(flow).toContain('Competing architecture hypotheses');
  });

  it('the mission surface itself is where the imported system is then WATCHED (drained state with branch heads + CI)', () => {
    const html = render(h(LiveMissionPage, { data: freshUserObservation(), missions: [] }));
    // The live surface\u2019s sections are the post-import continuation: repository, CI, deployments, findings
    expect(html).toContain('Repository — branch heads');
    expect(html).toContain('CI — latest runs');
    expect(html).toContain('Deployments');
    expect(html).toContain('Reconciliation — findings');
  });
});
