/**
 * JOURNEY 8/12 — PROMOTION (Work Order P18-C).
 *
 * Promotion is a consequential, authority-gated action bound to the exact
 * observed revision. The journey verifies the user can FOLLOW it through
 * the UI: the promote affordance names the observed head and the
 * currently-deployed revision (the DIVERGED finding stays visible —
 * production is behind the head), the form\u2019s envelope carries the exact
 * staging→production transition, and the SAME envelope executes through
 * the real merged gateway with evidence-bound receipts under a held
 * grant.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { LiveMissionPage } from '@live-mission/page';
import { promotionEnvelope } from '@live-mission/envelopes';
import { InMemoryAuthority } from '@sos-2/action-gateway';
import { GATEWAY_ACTOR, GATEWAY_T0, drainedObservation, gatewayWith, h, noHeadObservation, OBSERVED_MAIN_HEAD, render } from './helpers';

describe('journey: promotion — the verified revision moves between environments', () => {
  it('the promote affordance names the exact observed head and the currently-deployed revision', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    expect(html).toContain('Promote the verified revision');
    expect(html).toContain('(currently deployed: 740bc37c75a1)'); // the observed production revision, shortened for display
    expect(html).not.toContain('No observed repository head yet — promotion needs the exact verified source revision.');
  });

  it('the DIVERGED finding stays visible (production behind the observed head — never folded into success)', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    expect(html).toContain('DIVERGED');
    expect(html).toContain('ALIGNED / DIVERGED / UNVERIFIED / STALE');
    expect(html).toContain('stale and unverified stay visible, never folded into success');
  });

  it('the promotion envelope carries the exact staging→production transition bound to the observed head', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    const form = html.slice(html.indexOf('data-action-form="promotion"'));
    const formBody = form.slice(0, form.indexOf('</form>'));
    expect(formBody).toContain(OBSERVED_MAIN_HEAD);
    expect(formBody).toContain('staging');
    expect(formBody).toContain('production');
    expect(formBody).toContain('action="/api/live-mission/actions"');
  });

  it('without an observed head the promote affordance stays disabled with its honest reason', () => {
    const html = render(h(LiveMissionPage, { data: noHeadObservation(), missions: [] }));
    expect(html).toContain('No observed repository head yet — promotion needs the exact verified source revision.');
  });

  it('the authority gate is visible on the promotion form', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    const form = html.slice(html.indexOf('data-action-form="promotion"'));
    expect(form).toContain('Authority-gated:');
    expect(form).toContain('promotion into the target environment');
  });

  it('through the real gateway: a held grant promotes with an evidence-bound deployment revision', () => {
    const authority = new InMemoryAuthority();
    authority.grant(GATEWAY_ACTOR, 'promotion', 'production');
    const { gateway, world, evidence } = gatewayWith(authority);
    const outcome = gateway.execute(
      promotionEnvelope({ actorId: GATEWAY_ACTOR, fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: OBSERVED_MAIN_HEAD, actionId: 'live-action-promote-1', idempotencyKey: 'idem-promote-1', requestedAt: GATEWAY_T0 }),
    );
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('SUCCEEDED');
      expect(outcome.receipt.deploymentRevision).not.toBeNull();
      expect(outcome.receipt.evidenceIds.length).toBeGreaterThan(0);
    }
    expect(world.activeByEnvironment.get('production')).toBeDefined();
    expect(evidence.all().length).toBeGreaterThan(0);
  });

  it('through the real gateway: promotion without a held grant fails CLOSED (the environment untouched)', () => {
    const { gateway, world } = gatewayWith(new InMemoryAuthority());
    const outcome = gateway.execute(
      promotionEnvelope({ actorId: GATEWAY_ACTOR, fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: OBSERVED_MAIN_HEAD, actionId: 'live-action-promote-2', idempotencyKey: 'idem-promote-2', requestedAt: GATEWAY_T0 }),
    );
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('DENIED');
      expect(outcome.receipt.denial?.authority?.reason).toBe('GRANT_NEVER_HELD');
    }
    expect(world.activeByEnvironment.get('production')).toBeUndefined();
  });
});
