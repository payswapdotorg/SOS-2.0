/**
 * JOURNEY 4/12 — ASK (Work Order P18-C).
 *
 * SOS asks when authority or evidence is insufficient. The journey
 * verifies the user can FOLLOW the ASK flow end to end: the root surface
 * explains the rule and links the queue; the live mission surface states
 * that pending asks wait for HUMAN resolution through the merged queue
 * (the resolution becomes a typed Decision record); the queue page is the
 * actionable inbox; and the actual resolution — driven through the SAME
 * envelope the surface builds — mints the Decision record bound to the
 * ask, terminally (a second resolution is a typed error, never a
 * duplicate decision).
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
import { AskPage } from '@web-shell/ask-page';
import { askResolutionEnvelope } from '@live-mission/envelopes';
import { AskQueue, composeAskContent } from '@sos-2/ask';
import { createAskRequest } from '@sos-2/authority';
import { evaluate } from '@sos-2/decision';
import type { DecisionRequest } from '@sos-2/decision';
import { GATEWAY_ACTOR, drainedObservation, h, render } from './helpers';

/** A pending ask in the merged queue (the tests/real-observation precedent composition). */
function pendingAsk(): { queue: AskQueue; entryId: string } {
  const decisionRequest: DecisionRequest = {
    action_kind: 'REVISE',
    action_description: 'Revise the mission with the revised budget.',
    target: { kind: 'KIND', artifact_kind: 'Mission' },
    blast_radius: 'SERVICE',
    impact: 'MODERATE',
    risk: 'LOW',
    reversibility: 'REVERSIBLE',
    causal_claim: false,
    uncertainty: { uncertainty_class: 'LOW', basis: 'the revision is fully specified' },
    rollback_signals: [],
    evidence: [],
    grants: [],
    evaluation_point: { kind: 'TIME', now: '2026-09-26T00:00:00.000Z' },
    explicit_authority_decision_ref: null,
    confidence: null,
  };
  const evaluation = evaluate(decisionRequest, { provenance: ['P18C:tests-live-ux'], created_at: '2026-09-26T00:00:00.000Z' });
  if (evaluation.action !== 'ASK') {
    throw new Error(`fixture expects ASK, received ${evaluation.action}`);
  }
  const ask = createAskRequest({
    content: composeAskContent({ decision: evaluation.record }),
    provenance: ['P18C:tests-live-ux'],
    created_at: '2026-09-26T00:00:00.000Z',
    version: 1,
  });
  const queue = new AskQueue();
  const entry = queue.enqueue({ ask, origin_decision: evaluation.record, enqueued_at: '2026-09-26T00:00:00.000Z' });
  return { queue, entryId: entry.id };
}

describe('journey: ASK — SOS asks when authority or evidence is insufficient', () => {
  it('the root surface explains the rule in the five first-run understandings', () => {
    const html = render(h(RootPage));
    expect(html).toContain('SOS asks when authority or evidence is insufficient');
    const block = html.slice(html.indexOf('data-first-run-understanding="asks-when-unsure"'));
    expect(block).toContain('it stops and asks');
    expect(block).toContain('typed decision record');
  });

  it('the root surface links the ASK queue (where the questions wait)', () => {
    const html = render(h(RootPage));
    expect(html).toContain('href="/ask"');
    expect(html).toContain('Open the ASK queue');
  });

  it('the live mission surface states the human-authority resolution contract honestly', () => {
    const html = render(h(LiveMissionPage, { data: drainedObservation(), missions: [] }));
    expect(html).toContain('Resolve a pending ASK');
    expect(html).toContain('resolved by HUMAN authority through the merged ASK queue');
    expect(html).toContain('human resolver');
    expect(html).toContain('Decision record (minted by the queue)');
  });

  it('the ASK queue page is the actionable inbox (questions waiting for a human decision)', () => {
    const html = render(h(AskPage));
    expect(html).toContain('Questions waiting for a human decision');
    expect(html).toContain('pending');
    expect(html).toContain('ASK is a success state');
  });

  it('the resolution envelope the surface builds resolves the pending ask through the merged queue', () => {
    const { queue, entryId } = pendingAsk();
    expect(queue.pendingCount).toBe(1);
    const envelope = askResolutionEnvelope({
      entryId,
      resolvedBy: GATEWAY_ACTOR,
      chosenAlternativeId: 'act-under-granted-authority',
      note: 'Approved from the live-mission surface (journey suite)',
      provenance: ['human:console-user', 'surface:live-mission'],
      createdAt: '2026-09-26T12:00:00Z',
    });
    const decision = queue.resolve(envelope.entryId, { ...envelope.resolution, provenance: [...envelope.resolution.provenance] });
    expect(decision.content.action).toBe('ACT');
    expect(queue.pendingCount).toBe(0);
    expect(decision.content.resolution?.resolved_by).toBe(GATEWAY_ACTOR);
    expect(decision.content.resolution?.alternative_id).toBe('act-under-granted-authority');
  });

  it('the resolution is terminal — a second resolution is a typed error, never a duplicate decision', () => {
    const { queue, entryId } = pendingAsk();
    const first = askResolutionEnvelope({ entryId, resolvedBy: GATEWAY_ACTOR, chosenAlternativeId: 'act-under-granted-authority', note: 'first', provenance: ['human:console-user'], createdAt: '2026-09-26T12:00:00Z' });
    queue.resolve(first.entryId, { ...first.resolution, provenance: [...first.resolution.provenance] });
    const second = askResolutionEnvelope({ entryId, resolvedBy: GATEWAY_ACTOR, chosenAlternativeId: 'act-under-granted-authority', note: 'second', provenance: ['human:console-user'], createdAt: '2026-09-26T12:01:00Z' });
    expect(() => queue.resolve(second.entryId, { ...second.resolution, provenance: [...second.resolution.provenance] })).toThrow(/already RESOLVED/);
  });

  it('the envelope carries no authority fields of its own (human authority is the resolution, never a smuggled grant)', () => {
    const serialized = JSON.stringify(
      askResolutionEnvelope({ entryId: 'ask-1', resolvedBy: GATEWAY_ACTOR, chosenAlternativeId: 'a', note: 'n', provenance: ['human:console-user'], createdAt: '2026-09-26T12:00:00Z' }),
    );
    expect(serialized).not.toContain('grant');
    expect(serialized).not.toContain('token');
  });
});
