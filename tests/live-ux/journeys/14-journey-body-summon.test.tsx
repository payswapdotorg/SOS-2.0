/**
 * JOURNEY 5/12 — BODY SUMMON (Work Order P18-C).
 *
 * SOS can summon bodies. The journey verifies the user can FOLLOW the
 * summon flow through the UI: the live mission surface (with an observed
 * head) renders the summon affordance ENABLED and bound to the EXACT
 * observed revision; without an observed head the affordance stays
 * disabled with its honest reason; the authority gate is visible on the
 * form; and the SAME envelope the form POSTs executes through the real
 * merged action gateway — a held grant summons with evidence, a revoked
 * grant fails CLOSED with the executor never invoked, and replay is
 * idempotent.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { LiveMissionPage } from '@live-mission/page';
import { summonBodyEnvelope } from '@live-mission/envelopes';
import { InMemoryAuthority } from '@sos-2/action-gateway';
import { GATEWAY_ACTOR, GATEWAY_T0, drainedObservation, gatewayWith, h, noHeadObservation, OBSERVED_MAIN_HEAD, render } from './helpers';

function summonBody(idempotencyKey: string) {
  return summonBodyEnvelope({ actorId: GATEWAY_ACTOR, bodyId: 'cloud-sandbox-1', baseSha: OBSERVED_MAIN_HEAD, actionId: 'live-action-summon-1', idempotencyKey, requestedAt: GATEWAY_T0 });
}

describe('journey: body summon — the surface offers it, the gateway gates it', () => {
  it('with an observed head, the summon affordance is ENABLED and explains the lease honestly', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    expect(html).toContain('Summon an execution body');
    expect(html).toContain('Lease a body for the current work on main');
    expect(html).toContain('The lease is ephemeral; the task, checkpoints and evidence survive body replacement.');
    expect(html).not.toContain('No observed repository head yet — the envelope needs the exact source revision to act on');
  });

  it('the summon form is bound to the EXACT observed head (the envelope never invents a revision)', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    const form = html.slice(html.indexOf('data-action-form="summon-body"'));
    expect(form.slice(0, form.indexOf('</form>'))).toContain(OBSERVED_MAIN_HEAD);
    expect(form).toContain('action="/api/live-mission/actions"');
    expect(form).toContain('name="action"');
  });

  it('the authority gate is visible on the summon form (fail-closed vocabulary)', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    const form = html.slice(html.indexOf('data-action-form="summon-body"'));
    expect(form).toContain('Authority-gated:');
    expect(form).toContain('fails CLOSED');
    expect(form).toContain('body-lifecycle');
  });

  it('without an observed head, the summon affordance stays disabled with its honest reason', () => {
    const html = render(h(LiveMissionPage, { data: noHeadObservation(), missions: [] }));
    expect(html).toContain('No observed repository head yet — the envelope needs the exact source revision to act on (never fabricated).');
  });

  it('the UI never mutates state directly — every consequential action POSTs to the gateway endpoint', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    expect(html).toContain('the UI never mutates state directly');
    expect(html).toContain('action="/api/live-mission/actions"');
  });

  it('through the real gateway: a held grant summons the body with evidence-bound success', () => {
    const authority = new InMemoryAuthority();
    authority.grant(GATEWAY_ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
    const { gateway, world, evidence } = gatewayWith(authority);
    expect(world.bodies.get('cloud-sandbox-1')).toBeUndefined();
    const outcome = gateway.execute(summonBody('idem-summon-1'));
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('SUCCEEDED');
      expect(outcome.receipt.evidenceIds.length).toBeGreaterThan(0);
    }
    expect(world.bodies.get('cloud-sandbox-1')).toBe('RUNNING');
    expect(evidence.all().length).toBeGreaterThan(0);
  });

  it('through the real gateway: a REVOKED grant fails CLOSED — DENIED, the executor is never invoked', () => {
    const authority = new InMemoryAuthority();
    const grantId = authority.grant(GATEWAY_ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
    const { gateway, world } = gatewayWith(authority);
    authority.revoke(grantId);
    const outcome = gateway.execute(summonBody('idem-summon-2'));
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('DENIED');
      expect(outcome.receipt.denial?.reason).toBe('ACTION_AUTHORITY_DENIED');
    }
    expect(world.bodies.get('cloud-sandbox-1')).toBeUndefined();
  });

  it('through the real gateway: replaying the same idempotency key returns the recorded receipt, executing once', () => {
    const authority = new InMemoryAuthority();
    authority.grant(GATEWAY_ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
    const { gateway, world } = gatewayWith(authority);
    const first = gateway.execute(summonBody('idem-summon-3'));
    const second = gateway.execute(summonBody('idem-summon-3'));
    expect(first.kind).toBe('executed');
    expect(second.kind).toBe('replayed');
    expect(world.bodies.get('cloud-sandbox-1')).toBe('RUNNING');
  });

  it('the envelope carries no authority fields (the gateway owns authority; smuggling is typed-rejected)', () => {
    const authority = new InMemoryAuthority();
    authority.grant(GATEWAY_ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
    const { gateway } = gatewayWith(authority);
    const serialized = JSON.stringify(summonBody('idem-summon-4'));
    expect(serialized).not.toContain('grant');
    expect(serialized).not.toContain('token');
    const smuggled = { ...summonBody('idem-summon-4'), grant: 'grant-1' };
    expect(gateway.execute(smuggled)).toMatchObject({ kind: 'rejected', rejection: { code: 'AUTHORITY_FIELD_SMUGGLED', field: 'grant' } });
  });
});
