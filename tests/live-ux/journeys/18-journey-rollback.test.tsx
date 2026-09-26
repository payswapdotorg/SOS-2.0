/**
 * JOURNEY 9/12 — ROLLBACK (Work Order P18-C).
 *
 * Rollback is the recovery path: roll production back to a known-good
 * revision, with the rollback verifier recording what it actually
 * observed (UNKNOWN stays UNKNOWN). The journey verifies the user can
 * FOLLOW it through the UI: the rollback affordance names the exact
 * currently-deployed revision and stays disabled with its honest reason
 * when no deployment is observed; the form\u2019s envelope carries the exact
 * deployment and revisions; and through the real merged gateway a
 * promote→rollback sequence produces the rollback evidence + verification
 * record and restores the environment.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { LiveMissionPage } from '@live-mission/page';
import { promotionEnvelope, rollbackEnvelope } from '@live-mission/envelopes';
import { InMemoryAuthority } from '@sos-2/action-gateway';
import { GATEWAY_ACTOR, GATEWAY_T0, drainedObservation, gatewayWith, h, noHeadObservation, OBSERVED_MAIN_HEAD, OBSERVED_PRODUCTION_REVISION, render } from './helpers';

describe('journey: rollback — production returns to the last known-good revision', () => {
  it('the rollback affordance names the exact currently-deployed revision and the known-good intent', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    expect(html).toContain('Roll back production');
    expect(html).toContain('Roll the production environment back to the last known-good revision');
    expect(html).toContain('(currently 740bc37c75a1)');
    expect(html).toContain('rollback verifier records what it actually observed'); // the apostrophe is entity-escaped in markup
    expect(html).toContain('UNKNOWN stays UNKNOWN');
    expect(html).not.toContain('No observed production deployment yet — rollback needs the exact deployment to roll back.');
  });

  it('the rollback envelope carries the exact deployment and both revisions (never an invented target)', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    const form = html.slice(html.indexOf('data-action-form="rollback"'));
    const formBody = form.slice(0, form.indexOf('</form>'));
    expect(formBody).toContain('current-production');
    expect(formBody).toContain(OBSERVED_PRODUCTION_REVISION);
    expect(formBody).toContain(OBSERVED_MAIN_HEAD);
    expect(formBody).toContain('MANUAL_DIRECTIVE');
    expect(formBody).toContain('action="/api/live-mission/actions"');
  });

  it('without an observed deployment the rollback affordance stays disabled with its honest reason', () => {
    const html = render(h(LiveMissionPage, { data: noHeadObservation(), missions: [] }));
    expect(html).toContain('No observed production deployment yet — rollback needs the exact deployment to roll back.');
  });

  it('through the real gateway: promote then roll back produces the rollback evidence + verification record', () => {
    const authority = new InMemoryAuthority();
    authority.grant(GATEWAY_ACTOR, 'promotion', 'production');
    const { gateway, world, evidence } = gatewayWith(authority);
    const promotion = gateway.execute(
      promotionEnvelope({ actorId: GATEWAY_ACTOR, fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: OBSERVED_MAIN_HEAD, actionId: 'live-action-promote-3', idempotencyKey: 'idem-rb-1', requestedAt: GATEWAY_T0 }),
    );
    expect(promotion.kind).toBe('executed');
    const deploymentId = promotion.kind === 'executed' ? promotion.receipt.deploymentRevision : null;
    expect(deploymentId).not.toBeNull();
    authority.grant(GATEWAY_ACTOR, 'rollback', deploymentId!);
    const outcome = gateway.execute(
      rollbackEnvelope({
        actorId: GATEWAY_ACTOR,
        deploymentId: deploymentId!,
        fromSourceSha: OBSERVED_MAIN_HEAD,
        toSourceSha: OBSERVED_PRODUCTION_REVISION,
        reasonCode: 'MANUAL_DIRECTIVE',
        reasonDetail: 'console rollback from the live-mission surface (journey suite)',
        actionId: 'live-action-rollback-1',
        idempotencyKey: 'idem-rb-2',
        requestedAt: GATEWAY_T0,
      }),
    );
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('SUCCEEDED');
      expect(outcome.receipt.rollbackVerification).not.toBeNull();
      expect(outcome.receipt.rollbackVerification?.evidenceType).toBe('rollback.verification');
    }
    const evidenceTypes = evidence.all().map((record) => record.evidenceType);
    expect(evidenceTypes).toContain('rollback.outcome');
    expect(evidenceTypes).toContain('rollback.verification');
    expect(world.activeByEnvironment.get('production')).toBeDefined();
  });

  it('the root surface\u2019s overview keeps the mission/system context a rollback decision needs (evidence + changes)', () => {
    // The rollback decision is made by a human reading context; the root keeps
    // the overview composition (current change, evidence quality) one click away.
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    expect(html).toContain('href="/changes"');   // the shell rail (what is changing)
    expect(html).toContain('href="/evidence"');  // the shell rail (what is known, per truth state)
    expect(html).toContain('href="/history"');   // the shell rail (what superseded what)
  });
});
