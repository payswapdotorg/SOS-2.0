/**
 * JOURNEY 7/12 — BODY INTERRUPTION / REPLACEMENT (Work Order P18-C).
 *
 * Bodies are replaceable; the task, checkpoints and evidence survive.
 * The journey verifies the user can LEARN the replacement contract from
 * the UI, and that the merged gateway really carries the full lifecycle:
 * start → pause (interruption) → resume → replace → a fresh start, each
 * step an evidence-bound receipt through the same authority gates — the
 * world shows exactly one body state at a time, and every transition is
 * recorded in the event log. The envelope TYPE the surface exports admits
 * all five operations (the shipped form offers start; that UI gap is
 * recorded honestly in the discoverability record).
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
import { summonBodyEnvelope } from '@live-mission/envelopes';
import type { ActionRequestEnvelope } from '@live-mission/envelopes';
import { InMemoryAuthority } from '@sos-2/action-gateway';
import { GATEWAY_ACTOR, GATEWAY_T0, drainedObservation, gatewayWith, h, OBSERVED_MAIN_HEAD, render } from './helpers';

/** A body-lifecycle envelope for any operation (the exported envelope TYPE admits all five). */
function bodyLifecycleEnvelope(operation: 'start' | 'pause' | 'resume' | 'cancel' | 'replace', actionId: string, idempotencyKey: string): ActionRequestEnvelope {
  return {
    actionId,
    idempotencyKey,
    family: 'body-lifecycle',
    actor: { kind: 'human', id: GATEWAY_ACTOR },
    requestedAt: GATEWAY_T0,
    targetRevision: { kind: 'source', sha: OBSERVED_MAIN_HEAD },
    payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: 'cloud-sandbox-1', operation } },
  };
}

describe('journey: body interruption / replacement — bodies are ephemeral, the work survives', () => {
  it('the root understanding states the replacement contract (authority-granted, ephemeral, replaceable)', () => {
    const html = render(h(RootPage));
    const block = html.slice(html.indexOf('data-first-run-understanding="summons-bodies"'));
    expect(block).toContain('SOS can summon bodies to do the work');
    expect(block).toContain('leased worker that acts under authority you granted');
    expect(block).toContain('the task, its checkpoints and its evidence outlive any single body');
  });

  it('the live mission surface\u2019s summon affordance carries the same contract at the point of action', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    expect(html).toContain('The lease is ephemeral; the task, checkpoints and evidence survive body replacement.');
  });

  it('the shipped summon builder produces the start operation the form offers', () => {
    const envelope = summonBodyEnvelope({ actorId: GATEWAY_ACTOR, bodyId: 'cloud-sandbox-1', baseSha: OBSERVED_MAIN_HEAD, actionId: 'a', idempotencyKey: 'k', requestedAt: GATEWAY_T0 });
    expect(envelope.payload).toEqual({ family: 'body-lifecycle', bodyLifecycle: { bodyId: 'cloud-sandbox-1', operation: 'start' } });
  });

  it('through the real gateway: interruption (pause) and resume are evidence-bound transitions', () => {
    const authority = new InMemoryAuthority();
    authority.grant(GATEWAY_ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
    const { gateway, world } = gatewayWith(authority);
    expect(gateway.execute(bodyLifecycleEnvelope('start', 'live-action-body-start-1', 'idem-body-1')).kind).toBe('executed');
    expect(world.bodies.get('cloud-sandbox-1')).toBe('RUNNING');
    const paused = gateway.execute(bodyLifecycleEnvelope('pause', 'live-action-body-pause-1', 'idem-body-2'));
    expect(paused.kind).toBe('executed');
    if (paused.kind === 'executed') {
      expect(paused.receipt.status).toBe('SUCCEEDED');
      expect(paused.receipt.evidenceIds.length).toBeGreaterThan(0);
    }
    expect(world.bodies.get('cloud-sandbox-1')).toBe('PAUSED');
    gateway.execute(bodyLifecycleEnvelope('resume', 'live-action-body-resume-1', 'idem-body-3'));
    expect(world.bodies.get('cloud-sandbox-1')).toBe('RUNNING');
  });

  it('through the real gateway: replacement marks the body REPLACED and a fresh start brings a new lease', () => {
    const authority = new InMemoryAuthority();
    authority.grant(GATEWAY_ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
    const { gateway, world, events, evidence } = gatewayWith(authority);
    gateway.execute(bodyLifecycleEnvelope('start', 'live-action-body-start-2', 'idem-body-4'));
    const replaced = gateway.execute(bodyLifecycleEnvelope('replace', 'live-action-body-replace-1', 'idem-body-5'));
    expect(replaced.kind).toBe('executed');
    if (replaced.kind === 'executed') {
      expect(replaced.receipt.status).toBe('SUCCEEDED');
      expect(replaced.receipt.evidenceIds.length).toBeGreaterThan(0);
    }
    expect(world.bodies.get('cloud-sandbox-1')).toBe('REPLACED');
    gateway.execute(bodyLifecycleEnvelope('start', 'live-action-body-start-3', 'idem-body-6'));
    expect(world.bodies.get('cloud-sandbox-1')).toBe('RUNNING');
    // the full lifecycle is recorded — every DISTINCT transition (distinct action ids) left a typed event + evidence
    const succeeded = events.entries().filter((event) => event.type === 'action.succeeded');
    expect(succeeded.length).toBe(3);
    expect(evidence.all().length).toBeGreaterThanOrEqual(3);
  });

  it('replacement obeys the same authority gate (a revoked grant fails CLOSED, the body untouched)', () => {
    const authority = new InMemoryAuthority();
    const grantId = authority.grant(GATEWAY_ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
    const { gateway, world } = gatewayWith(authority);
    gateway.execute(bodyLifecycleEnvelope('start', 'live-action-body-start-4', 'idem-body-7'));
    // revoke the only held grant — the replacement of the running body must fail closed
    authority.revoke(grantId);
    const denied = gateway.execute(bodyLifecycleEnvelope('replace', 'live-action-body-replace-2', 'idem-body-8'));
    expect(denied.kind).toBe('executed');
    if (denied.kind === 'executed') {
      expect(denied.receipt.status).toBe('DENIED');
      expect(denied.receipt.denial?.reason).toBe('ACTION_AUTHORITY_DENIED');
    }
    expect(world.bodies.get('cloud-sandbox-1')).toBe('RUNNING'); // untouched by the denied action
  });
});
