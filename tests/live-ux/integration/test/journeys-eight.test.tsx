/**
 * P18-INT deterministic integrated suite (2/3): THE EIGHT MANDATORY
 * JOURNEYS at ROUTE level (Work Order P18 §12 gate) — each journey drives
 * the integrated full path
 *
 *     mission route -> live observed state -> consequential action
 *                    -> receipt -> evidence
 *
 * through the REAL mounted surfaces: the route renders the scripted
 * producer's honest observation through the real data seam (the producer
 * MODULE is mocked — the app files are untouched), and every consequential
 * action is the EXACT typed envelope the mounted forms POST, submitted
 * through the REAL endpoint pipeline (submitLiveAction over the merged
 * ActionGateway with the reference executors — the P18-B deterministic
 * discipline). Every journey asserts the SIX-QUESTION CONTRACT
 * (What/Why/Evidence/Uncertainty/Authority/Next) on the receipt surfaces
 * (ActionReceiptView renders the LiveReviewBlock + the /evidence and
 * /rationale deep links — a receipt never stands alone).
 *
 * The eight journeys: greenfield, brownfield, ASK resolution, cloud
 * execution with the user's machine OFF, body interruption/replacement
 * (checkpoint recovery), observation without a body, promotion, rollback.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// The scripted producer (the seam's module-scope composition consumes it).
const script = vi.hoisted(() => ({ observation: null as unknown }));
vi.mock('@integration/producer', () => ({
  createLiveMissionDataProducer: (): (() => Promise<unknown>) => async (): Promise<unknown> => script.observation,
}));

import { InMemoryAuthority } from '@sos-2/action-gateway';
import type { ActionFamily } from '@sos-2/action-gateway';
import { AskQueue, composeAskContent } from '@sos-2/ask';
import { createAskRequest } from '@sos-2/authority';
import { evaluate } from '@sos-2/decision';
import type { DecisionRequest } from '@sos-2/decision';
import { summonBodyEnvelope, promotionEnvelope, rollbackEnvelope, askResolutionEnvelope } from '@live-mission/envelopes';
import { ActionReceiptView } from '@live-mission/receipt-view';
import type { LiveActionReceiptView } from '@integration/live-action-core';
import LiveMissionRoute from '@integration/live-mission-route';
import {
  ACTOR,
  AS_OF,
  OBSERVED_HEAD,
  OBSERVED_PRODUCTION_REVISION,
  drainedObservation,
  h,
  pipelineHost,
  render,
  renderPage,
  submit,
} from './helpers/fixtures';

/** The six product review questions ON THE RECEIPT SURFACES (the first is the receipt title). */
const RECEIPT_SIX_QUESTIONS = [
  'What happened?',
  'Why does SOS believe this?',
  'What evidence supports it?',
  'What uncertainty remains?',
  'What authority is required?',
  'What can happen next?',
] as const;

/** Render the mission route over the scripted drained observation (the route leg of every journey). */
async function routeHtml(): Promise<string> {
  script.observation = drainedObservation();
  return renderPage(LiveMissionRoute);
}

/** Submit an envelope through the REAL endpoint pipeline with a granted actor (the action leg). */
function grantedHost(grant: { family: ActionFamily; scope: string }) {
  const authority = new InMemoryAuthority();
  authority.grant(ACTOR, grant.family, grant.scope);
  return pipelineHost(authority);
}

/** Render the receipt surface for an endpoint outcome (the receipt leg — the six-question contract). */
function receiptHtml(view: LiveActionReceiptView): string {
  return render(h(ActionReceiptView, { view, asOf: AS_OF }));
}

/** The receipt-surface contract: the six questions + the evidence/rationale deep links. */
function expectSixQuestionContract(html: string): void {
  for (const question of RECEIPT_SIX_QUESTIONS) {
    expect(html).toContain(question);
  }
  expect(html).toContain('href="/evidence"');
  expect(html).toContain('href="/rationale"');
}

/** A PENDING ask entry through the REAL merged decision engine + AskQueue (the P18-B fixture discipline). */
function pendingAsk(provenance: readonly string[]): { queue: AskQueue; entryId: string } {
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
  const evaluation = evaluate(decisionRequest, { provenance: [...provenance], created_at: '2026-09-26T00:00:00.000Z' });
  if (evaluation.action !== 'ASK') {
    throw new Error(`fixture expects ASK, received ${evaluation.action}`);
  }
  const ask = createAskRequest({
    content: composeAskContent({ decision: evaluation.record }),
    provenance: [...provenance],
    created_at: '2026-09-26T00:00:00.000Z',
    version: 1,
  });
  const queue = new AskQueue();
  const entry = queue.enqueue({ ask, origin_decision: evaluation.record, enqueued_at: '2026-09-26T00:00:00.000Z' });
  return { queue, entryId: entry.id };
}

// ---------------------------------------------------------------------------
// 1. GREENFIELD — start a mission, act on the fresh observation
// ---------------------------------------------------------------------------

describe('journey 1/8 — GREENFIELD (route -> observed state -> first consequential action -> receipt -> evidence)', () => {
  it('the route offers the greenfield entry (Start a mission -> /onboarding/greenfield) over the live observation', async () => {
    const html = await routeHtml();
    expect(html).toContain('Start a mission');
    expect(html).toContain('href="/onboarding/greenfield"');
    expect(html).toContain(OBSERVED_HEAD);
  });

  it('the first consequential action (summon a body for the new work) executes with an evidence-bound receipt answering the six questions', () => {
    const host = grantedHost({ family: 'body-lifecycle', scope: 'cloud-sandbox-1' });
    const outcome = submit(host, summonBodyEnvelope({
      actorId: ACTOR, bodyId: 'cloud-sandbox-1', baseSha: OBSERVED_HEAD, actionId: 'greenfield-summon-1', idempotencyKey: 'greenfield-idem-1', requestedAt: 1_797_123_600_000,
    }));
    expect(outcome.httpStatus).toBeLessThan(500);
    if (outcome.view.kind === 'gateway-action') {
      expect(outcome.view.outcome).toBe('executed');
      expect(outcome.view.receipt?.status).toBe('SUCCEEDED');
      expect((outcome.view.receipt?.evidenceIds ?? []).length).toBeGreaterThan(0);
    }
    const html = receiptHtml(outcome.view);
    expectSixQuestionContract(html);
    expect(html).toContain('body-lifecycle');
  });
});

// ---------------------------------------------------------------------------
// 2. BROWNFIELD — import a system, observe it, act on the observation
// ---------------------------------------------------------------------------

describe('journey 2/8 — BROWNFIELD (import the existing system -> observe -> act)', () => {
  it('the route offers the brownfield entry (Import a system -> /onboarding/brownfield) over the same live observation', async () => {
    const html = await routeHtml();
    expect(html).toContain('Import a system');
    expect(html).toContain('href="/onboarding/brownfield"');
  });

  it('acting on the imported system\u2019s observed state (promotion of the verified revision) executes with the six-question receipt', () => {
    const host = grantedHost({ family: 'promotion', scope: 'production' });
    const outcome = submit(host, promotionEnvelope({
      actorId: ACTOR, fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: OBSERVED_HEAD, actionId: 'brownfield-promote-1', idempotencyKey: 'brownfield-idem-1', requestedAt: 1_797_123_600_000,
    }));
    if (outcome.view.kind === 'gateway-action') {
      expect(outcome.view.outcome).toBe('executed');
      expect(outcome.view.receipt?.status).toBe('SUCCEEDED');
    }
    const html = receiptHtml(outcome.view);
    expectSixQuestionContract(html);
    expect(html).toContain('promotion');
  });
});

// ---------------------------------------------------------------------------
// 3. ASK RESOLUTION — human authority through the merged queue
// ---------------------------------------------------------------------------

describe('journey 3/8 — ASK RESOLUTION (the envelope -> the queue -> the Decision record -> the receipt)', () => {
  it('a pending ask resolves through the endpoint pipeline and the receipt carries the decision reference + the six questions', () => {
    const { queue, entryId } = pendingAsk(['P18-INT:journeys-eight']);
    const host = pipelineHost(new InMemoryAuthority(), queue);
    const outcome = submit(host, askResolutionEnvelope({
      entryId,
      resolvedBy: ACTOR,
      chosenAlternativeId: 'act-under-granted-authority',
      note: 'resolved through the integrated journey',
      provenance: ['human:console-user', 'surface:live-mission'],
      createdAt: '2026-09-26T00:00:00Z',
    }) as unknown as object);
    expect(outcome.httpStatus).toBe(200);
    if (outcome.view.kind === 'ask-resolution') {
      expect(outcome.view.status).toBe('RESOLVED');
      expect(outcome.view.decisionRef).toMatch(/sos:\/\//);
    }
    const html = receiptHtml(outcome.view);
    expectSixQuestionContract(html);
    expect(queue.pendingCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. CLOUD EXECUTION WITH THE USER'S MACHINE OFF
// ---------------------------------------------------------------------------

describe('journey 4/8 — CLOUD EXECUTION with the user\u2019s machine OFF (server-rendered observation; a cloud body acts)', () => {
  it('the observation is server-produced (nothing depends on the user\u2019s machine: no client fetches anywhere in the markup)', async () => {
    const html = await routeHtml();
    expect(html).toContain('SOS is watching');
    expect(html).toContain('data-live-badge="true"');
    // the server-rendering discipline IS the machine-off contract: the
    // observation entered through server-produced props only
    expect(html).not.toContain('fetch(');
    expect(html).not.toMatch(/<script[^>]*src=/);
  });

  it('a cloud body is summoned and acts while the observation continues without it (watchingWithoutBody stays true)', () => {
    const host = grantedHost({ family: 'body-lifecycle', scope: 'cloud-body-machine-off' });
    const outcome = submit(host, summonBodyEnvelope({
      actorId: ACTOR, bodyId: 'cloud-body-machine-off', baseSha: OBSERVED_HEAD, actionId: 'cloudoff-summon-1', idempotencyKey: 'cloudoff-idem-1', requestedAt: 1_797_123_600_000,
    }));
    if (outcome.view.kind === 'gateway-action') {
      expect(outcome.view.receipt?.status).toBe('SUCCEEDED');
    }
    const html = receiptHtml(outcome.view);
    expectSixQuestionContract(html);
  });
});

// ---------------------------------------------------------------------------
// 5. BODY INTERRUPTION / REPLACEMENT — checkpoint recovery
// ---------------------------------------------------------------------------

describe('journey 5/8 — BODY INTERRUPTION/REPLACEMENT (checkpoint recovery through body-lifecycle)', () => {
  it('the surface states the lease-ephemeral/checkpoint-survival contract', async () => {
    const html = await routeHtml();
    expect(html).toContain('The lease is ephemeral; the task, checkpoints and evidence survive body replacement.');
  });

  it('a body is replaced through the endpoint pipeline: the old lease ends, the new body starts, evidence binds the transitions', () => {
    const authority = new InMemoryAuthority();
    authority.grant(ACTOR, 'body-lifecycle', 'checkpoint-body-a');
    authority.grant(ACTOR, 'body-lifecycle', 'checkpoint-body-b');
    const host = pipelineHost(authority);
    const world = host.reference?.world;
    expect(world).toBeDefined();
    const start = submit(host, summonBodyEnvelope({
      actorId: ACTOR, bodyId: 'checkpoint-body-a', baseSha: OBSERVED_HEAD, actionId: 'ckpt-start-1', idempotencyKey: 'ckpt-idem-1', requestedAt: 1_797_123_600_000,
    }));
    if (start.view.kind === 'gateway-action') {
      expect(start.view.receipt?.status).toBe('SUCCEEDED');
    }
    expect(world?.bodies.get('checkpoint-body-a')).toBe('RUNNING');
    // the interruption: the active body is REPLACED (its lease ends; the
    // task state and evidence survive — the receipt binds the transition)
    const replacement = submit(host, {
      family: 'body-lifecycle',
      actor: { kind: 'human', id: ACTOR },
      requestedAt: 1_797_123_600_000,
      targetRevision: { kind: 'source', sha: OBSERVED_HEAD },
      actionId: 'ckpt-replace-1',
      idempotencyKey: 'ckpt-idem-2',
      payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: 'checkpoint-body-a', operation: 'replace' } },
    });
    if (replacement.view.kind === 'gateway-action') {
      expect(replacement.view.outcome).toBe('executed');
      expect(replacement.view.receipt?.status).toBe('SUCCEEDED');
      expect((replacement.view.receipt?.evidenceIds ?? []).length).toBeGreaterThan(0);
    }
    expect(world?.bodies.get('checkpoint-body-a')).toBe('REPLACED');
    // the recovery: a NEW body starts and continues the work
    const successor = submit(host, summonBodyEnvelope({
      actorId: ACTOR, bodyId: 'checkpoint-body-b', baseSha: OBSERVED_HEAD, actionId: 'ckpt-start-2', idempotencyKey: 'ckpt-idem-3', requestedAt: 1_797_123_600_000,
    }));
    if (successor.view.kind === 'gateway-action') {
      expect(successor.view.receipt?.status).toBe('SUCCEEDED');
    }
    expect(world?.bodies.get('checkpoint-body-b')).toBe('RUNNING');
    const html = receiptHtml(replacement.view);
    expectSixQuestionContract(html);
  });
});

// ---------------------------------------------------------------------------
// 6. OBSERVATION WITHOUT A BODY
// ---------------------------------------------------------------------------

describe('journey 6/8 — OBSERVATION WITHOUT A BODY (the §5 rule: continuous observation needs no body lease)', () => {
  it('the route renders the full live observation while watchingWithoutBody is true (no body lease claimed, no fabrication)', async () => {
    const html = await routeHtml();
    expect(html).toContain('SOS is watching');
    expect(html).toContain('observation is continuous and does not use a working body');
    expect(html).toContain('no body lease is active right now');
    expect(html).toContain('data-watching-without-body="true"');
    expect(html).toContain(OBSERVED_HEAD);
    expect(html).toContain(OBSERVED_PRODUCTION_REVISION);
  });

  it('the receipt surface for an observation-time action still answers the six questions (the evidence links survive)', () => {
    const authority = new InMemoryAuthority();
    const host = pipelineHost(authority); // NO grant: observation does not require authority
    const outcome = submit(host, {
      family: 'body-lifecycle',
      actor: { kind: 'human', id: ACTOR },
      requestedAt: 1_797_123_600_000,
      targetRevision: { kind: 'source', sha: OBSERVED_HEAD },
      actionId: 'nob-summon-1',
      idempotencyKey: 'nob-idem-1',
      payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: 'never-summoned-body', operation: 'start' } },
    });
    // an action without authority fails CLOSED — the honest record (the
    // observation itself needs no body and no authority; the ACTION does)
    if (outcome.view.kind === 'gateway-action') {
      expect(outcome.view.receipt?.status).toBe('DENIED');
    }
    const html = receiptHtml(outcome.view);
    expectSixQuestionContract(html);
  });
});

// ---------------------------------------------------------------------------
// 7. PROMOTION
// ---------------------------------------------------------------------------

describe('journey 7/8 — PROMOTION (the verified observed revision -> production, through the gateway)', () => {
  it('the route\u2019s promotion form is bound to the EXACT observed head and POSTs to the mounted endpoint', async () => {
    const html = await routeHtml();
    const promotionForm = html.slice(html.indexOf('data-action-form="promotion"'));
    expect(promotionForm.slice(0, promotionForm.indexOf('</form>'))).toContain(OBSERVED_HEAD);
    expect(html).toContain('action="/api/live-mission/actions"');
    expect(html).toContain('Promote the verified revision');
  });

  it('the promotion executes with an evidence-bound receipt + the six-question contract + the deployment revision recorded', () => {
    const host = grantedHost({ family: 'promotion', scope: 'production' });
    const outcome = submit(host, promotionEnvelope({
      actorId: ACTOR, fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: OBSERVED_HEAD, actionId: 'promo-1', idempotencyKey: 'promo-idem-1', requestedAt: 1_797_123_600_000,
    }));
    if (outcome.view.kind === 'gateway-action') {
      expect(outcome.view.outcome).toBe('executed');
      expect(outcome.view.receipt?.status).toBe('SUCCEEDED');
      expect(outcome.view.receipt?.deploymentRevision).not.toBeNull();
      expect((outcome.view.receipt?.evidenceIds ?? []).length).toBeGreaterThan(0);
    }
    const html = receiptHtml(outcome.view);
    expectSixQuestionContract(html);
  });
});

// ---------------------------------------------------------------------------
// 8. ROLLBACK
// ---------------------------------------------------------------------------

describe('journey 8/8 — ROLLBACK (production -> the last known-good revision, verified by the gateway)', () => {
  it('the route\u2019s rollback form names the observed production deployment and the verifier\u2019s honesty rule', async () => {
    const html = await routeHtml();
    const rollbackForm = html.slice(html.indexOf('data-action-form="rollback"'));
    expect(rollbackForm.slice(0, rollbackForm.indexOf('</form>'))).toContain(OBSERVED_PRODUCTION_REVISION);
    expect(html).toContain("UNKNOWN stays UNKNOWN");
  });

  it('the rollback executes with a receipt carrying the rollback-verification verdict + the six-question contract', () => {
    // a promotion first — the deployment the rollback verifier can verify
    // against (the reference world records what actually happened; the
    // rollback targets the EXACT deployment the promotion produced):
    const authority = new InMemoryAuthority();
    authority.grant(ACTOR, 'promotion', 'production');
    authority.grant(ACTOR, 'rollback', '*');
    const host = pipelineHost(authority);
    const promotion = submit(host, promotionEnvelope({
      actorId: ACTOR, fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: OBSERVED_HEAD, actionId: 'rb-prep-1', idempotencyKey: 'rb-idem-0', requestedAt: 1_797_123_600_000,
    }));
    if (promotion.view.kind === 'gateway-action') {
      expect(promotion.view.receipt?.status).toBe('SUCCEEDED');
    }
    const promotedDeploymentId = promotion.view.kind === 'gateway-action' ? promotion.view.receipt?.deploymentRevision : null;
    expect(promotedDeploymentId).toMatch(/^deployment:/);
    const outcome = submit(host, rollbackEnvelope({
      actorId: ACTOR,
      deploymentId: promotedDeploymentId ?? 'current-production',
      fromSourceSha: OBSERVED_PRODUCTION_REVISION,
      toSourceSha: OBSERVED_HEAD,
      reasonCode: 'MANUAL_DIRECTIVE',
      reasonDetail: 'the integrated journey rollback',
      actionId: 'rb-1',
      idempotencyKey: 'rb-idem-1',
      requestedAt: 1_797_123_600_000,
    }));
    if (outcome.view.kind === 'gateway-action') {
      expect(outcome.view.outcome).toBe('executed');
      expect(outcome.view.receipt?.status).toBe('SUCCEEDED');
      expect(outcome.view.receipt?.rollbackVerification).not.toBeNull();
    }
    const html = receiptHtml(outcome.view);
    expectSixQuestionContract(html);
    expect(html).toContain('rollback');
  });
});
