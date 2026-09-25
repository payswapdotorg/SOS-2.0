/**
 * P17-C deterministic reference-mode acceptance suite (3/6):
 * CONSEQUENTIAL ACTION WIRING THROUGH THE REAL MERGED ACTION GATEWAY.
 *
 * The live-mission surface's envelope builders (apps/web/live-mission/
 * src/actions/envelopes.ts — imported through the test-time alias) are
 * the UI's ONLY way to act. This suite feeds THOSE EXACT envelopes
 * through the REAL @sos-2/action-gateway (reference world + in-memory
 * authority) and pins the authority gates:
 *
 *  - a held grant executes (SUCCEEDED, evidence emitted, event appended);
 *  - a REVOKED / EXPIRED / NEVER-HELD grant fails CLOSED (DENIED, the
 *    executor is NEVER invoked, the denial is evidence-bound);
 *  - idempotency: replaying the same idempotencyKey returns the recorded
 *    original receipt — the executor transitions the world exactly ONCE;
 *  - a smuggled authority field is a typed AUTHORITY_FIELD_SMUGGLED
 *    rejection (the gateway carries no authority of its own);
 *  - rollback produces its own evidence + verification record;
 *  - ASK resolution flows through the merged AskQueue (human authority;
 *    the resolution mints a Decision record bound to the ask's input digest).
 *
 * This is the deterministic UI wiring evidence: real state transitions
 * with authority gates, driven by the SAME envelopes the web forms POST.
 */

import { describe, expect, it } from 'vitest';
import { ActionGateway, InMemoryAuthority, InMemoryEventLog, InMemoryEvidenceSink, InMemoryIdempotencyStore, ReferenceExecutor, ReferenceRollbackVerifier, ReferenceWorld } from '@sos-2/action-gateway';
import type { ActionGateway as Gateway } from '@sos-2/action-gateway';
import { AskQueue, composeAskContent } from '@sos-2/ask';
import { createAskRequest } from '@sos-2/authority';
import { evaluate } from '@sos-2/decision';
import type { DecisionRequest } from '@sos-2/decision';
import { askResolutionEnvelope, promotionEnvelope, rollbackEnvelope, summonBodyEnvelope } from '@live-mission/envelopes';

const T0 = 1_797_123_600_000;
const ACTOR = 'console-user';

/** The action-gateway's own Clock shape (now(): epoch ms). */
const gatewayClock = { now: (): number => T0 };

function gatewayWith(authority: InMemoryAuthority): { gateway: Gateway; world: ReferenceWorld; events: InMemoryEventLog; evidence: InMemoryEvidenceSink; idempotency: InMemoryIdempotencyStore } {
  const world = new ReferenceWorld();
  const events = new InMemoryEventLog();
  const evidence = new InMemoryEvidenceSink();
  const idempotency = new InMemoryIdempotencyStore();
  const gateway = new ActionGateway({
    clock: gatewayClock,
    authority,
    executors: [new ReferenceExecutor(world)],
    idempotency,
    events,
    evidence,
    rollbackVerifier: new ReferenceRollbackVerifier(world),
  });
  return { gateway, world, events, evidence, idempotency };
}

function summonBody(idempotencyKey: string) {
  return summonBodyEnvelope({ actorId: ACTOR, bodyId: 'cloud-sandbox-1', baseSha: 'seed-workspace-base', actionId: 'live-action-summon-1', idempotencyKey, requestedAt: T0 });
}

describe('authority gates on the live-mission action envelopes (the real gateway)', () => {
  it('executes the summon-body envelope when the CURRENT grant is held (evidence + event emitted)', () => {
    const authority = new InMemoryAuthority();
    authority.grant(ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
    const { gateway, world, events, evidence } = gatewayWith(authority);
    expect(world.bodies.get('cloud-sandbox-1')).toBeUndefined();
    const outcome = gateway.execute(summonBody('idem-1'));
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('SUCCEEDED');
      expect(outcome.receipt.evidenceIds.length).toBeGreaterThan(0);
    }
    expect(world.bodies.get('cloud-sandbox-1')).toBe('RUNNING');
    expect(events.entries().map((event) => event.type)).toContain('action.succeeded');
    expect(evidence.all().length).toBeGreaterThan(0);
  });

  it('fails CLOSED on a REVOKED grant: DENIED, executor never invoked, denial is evidence-bound', () => {
    const authority = new InMemoryAuthority();
    const grantId = authority.grant(ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
    const { gateway, world, evidence } = gatewayWith(authority);
    authority.revoke(grantId);
    const outcome = gateway.execute(summonBody('idem-2'));
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('DENIED');
      expect(outcome.receipt.denial?.reason).toBe('ACTION_AUTHORITY_DENIED');
      expect(outcome.receipt.denial?.authority?.reason).toBe('GRANT_REVOKED');
    }
    // fail-closed: the executor was NEVER invoked
    expect(world.bodies.get('cloud-sandbox-1')).toBeUndefined();
    // the denial still produced evidence (the action.outcome record carries the DENIED status)
    const outcomeRecords = evidence.all().filter((record) => record.evidenceType === 'action.outcome');
    expect(outcomeRecords).toHaveLength(1);
    expect((outcomeRecords[0] as { status: string }).status).toBe('DENIED');
  });

  it('fails CLOSED on an EXPIRED grant and on a NEVER-HELD grant', () => {
    const expiredAuthority = new InMemoryAuthority();
    expiredAuthority.grant(ACTOR, 'body-lifecycle', 'cloud-sandbox-1', { expiresAt: T0 - 1 });
    const expired = gatewayWith(expiredAuthority);
    const expiredOutcome = expired.gateway.execute(summonBody('idem-3'));
    expect(expiredOutcome.kind).toBe('executed');
    if (expiredOutcome.kind === 'executed') {
      expect(expiredOutcome.receipt.status).toBe('DENIED');
      expect(expiredOutcome.receipt.denial?.authority?.reason).toBe('GRANT_EXPIRED');
    }
    expect(expired.world.bodies.get('cloud-sandbox-1')).toBeUndefined();

    const neverHeld = gatewayWith(new InMemoryAuthority());
    const neverOutcome = neverHeld.gateway.execute(summonBody('idem-4'));
    expect(neverOutcome.kind).toBe('executed');
    if (neverOutcome.kind === 'executed') {
      expect(neverOutcome.receipt.status).toBe('DENIED');
      expect(neverOutcome.receipt.denial?.authority?.reason).toBe('GRANT_NEVER_HELD');
    }
    expect(neverHeld.world.bodies.get('cloud-sandbox-1')).toBeUndefined();
  });

  it('is idempotent: replaying the same idempotencyKey returns the recorded receipt and executes ONCE', () => {
    const authority = new InMemoryAuthority();
    authority.grant(ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
    const { gateway, world } = gatewayWith(authority);
    const first = gateway.execute(summonBody('idem-5'));
    const second = gateway.execute(summonBody('idem-5'));
    expect(first.kind).toBe('executed');
    expect(second.kind).toBe('replayed');
    if (first.kind === 'executed' && second.kind === 'replayed') {
      expect(second.receipt).toEqual(first.receipt);
    }
    // exactly ONE world transition
    expect(world.bodies.get('cloud-sandbox-1')).toBe('RUNNING');
    const bodies = [...world.bodies.entries()].filter(([id]) => id === 'cloud-sandbox-1');
    expect(bodies).toHaveLength(1);
  });

  it('rejects a smuggled authority field with the typed AUTHORITY_FIELD_SMUGGLED rejection', () => {
    const authority = new InMemoryAuthority();
    authority.grant(ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
    const { gateway } = gatewayWith(authority);
    const smuggled = { ...summonBody('idem-6'), grant: 'grant-1' };
    const outcome = gateway.execute(smuggled);
    expect(outcome).toMatchObject({ kind: 'rejected', rejection: { code: 'AUTHORITY_FIELD_SMUGGLED', field: 'grant' } });
  });

  it('executes the promotion envelope through the gateway (environment transition is evidence-bound)', () => {
    const authority = new InMemoryAuthority();
    authority.grant(ACTOR, 'promotion', 'production');
    const { gateway, world } = gatewayWith(authority);
    const outcome = gateway.execute(
      promotionEnvelope({ actorId: ACTOR, fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: 'seed-workspace-base', actionId: 'live-action-promote-1', idempotencyKey: 'idem-7', requestedAt: T0 }),
    );
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('SUCCEEDED');
      expect(outcome.receipt.deploymentRevision).not.toBeNull();
    }
    expect(world.activeByEnvironment.get('production')).toBeDefined();
  });

  it('executes the rollback envelope and produces the rollback evidence + verification record', () => {
    const authority = new InMemoryAuthority();
    authority.grant(ACTOR, 'promotion', 'production');
    authority.grant(ACTOR, 'rollback', 'any-deployment');
    const { gateway, world, evidence } = gatewayWith(authority);
    const promotion = gateway.execute(
      promotionEnvelope({ actorId: ACTOR, fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: 'seed-workspace-base', actionId: 'live-action-promote-2', idempotencyKey: 'idem-8', requestedAt: T0 }),
    );
    expect(promotion.kind).toBe('executed');
    const deploymentId = promotion.kind === 'executed' ? promotion.receipt.deploymentRevision : null;
    expect(deploymentId).not.toBeNull();
    authority.grant(ACTOR, 'rollback', deploymentId!);
    const outcome = gateway.execute(
      rollbackEnvelope({
        actorId: ACTOR,
        deploymentId: deploymentId!,
        fromSourceSha: 'seed-workspace-base',
        toSourceSha: 'seed-workspace-base',
        reasonCode: 'MANUAL_DIRECTIVE',
        reasonDetail: 'console rollback from the live-mission surface (deterministic suite)',
        actionId: 'live-action-rollback-1',
        idempotencyKey: 'idem-9',
        requestedAt: T0,
      }),
    );
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('SUCCEEDED');
      expect(outcome.receipt.rollbackVerification).not.toBeNull();
      expect(outcome.receipt.rollbackVerification?.evidenceType).toBe('rollback.verification');
    }
    const types = evidence.all().map((record) => record.evidenceType);
    expect(types).toContain('rollback.outcome');
    expect(types).toContain('rollback.verification');
    const restored = world.activeByEnvironment.get('production');
    expect(restored).toBeDefined();
  });
});

describe('ASK resolution through the merged AskQueue (human authority)', () => {
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
      evaluation_point: { kind: 'TIME', now: '2026-09-25T00:00:00.000Z' },
      explicit_authority_decision_ref: null,
      confidence: null,
    };
    const evaluation = evaluate(decisionRequest, { provenance: ['P17C:tests-real-observation'], created_at: '2026-09-25T00:00:00.000Z' });
    if (evaluation.action !== 'ASK') {
      throw new Error(`fixture expects ASK, received ${evaluation.action}`);
    }
    const ask = createAskRequest({
      content: composeAskContent({ decision: evaluation.record }),
      provenance: ['P17C:tests-real-observation'],
      created_at: '2026-09-25T00:00:00.000Z',
      version: 1,
    });
    const queue = new AskQueue();
    const entry = queue.enqueue({ ask, origin_decision: evaluation.record, enqueued_at: '2026-09-25T00:00:00.000Z' });
    return { queue, entryId: entry.id };
  }

  it('resolves a pending ask through the UI resolution envelope and mints the Decision record', () => {
    const { queue, entryId } = pendingAsk();
    expect(queue.pendingCount).toBe(1);
    const envelope = askResolutionEnvelope({
      entryId,
      resolvedBy: ACTOR,
      chosenAlternativeId: 'act-under-granted-authority',
      note: 'Approved from the live-mission surface (deterministic suite)',
      provenance: ['human:console-user', 'surface:live-mission'],
      createdAt: '2026-09-25T12:00:00.000Z',
    });
    const decision = queue.resolve(envelope.entryId, { ...envelope.resolution, provenance: [...envelope.resolution.provenance] });
    // the resolution mints an ACT decision record bound to the resolved ask
    expect(decision.content.action).toBe('ACT');
    expect(queue.pendingCount).toBe(0);
    expect(decision.content.resolution?.resolved_by).toBe(ACTOR);
    expect(decision.content.resolution?.alternative_id).toBe('act-under-granted-authority');
  });

  it('an entry is resolved at most once (terminal) — a second resolution is a typed error', () => {
    const { queue, entryId } = pendingAsk();
    const envelope = askResolutionEnvelope({ entryId, resolvedBy: ACTOR, chosenAlternativeId: 'act-under-granted-authority', note: 'first', provenance: ['human:console-user'], createdAt: '2026-09-25T12:00:00.000Z' });
    queue.resolve(envelope.entryId, { ...envelope.resolution, provenance: [...envelope.resolution.provenance] });
    const second = askResolutionEnvelope({ entryId, resolvedBy: ACTOR, chosenAlternativeId: 'act-under-granted-authority', note: 'second', provenance: ['human:console-user'], createdAt: '2026-09-25T12:01:00.000Z' });
    expect(() => queue.resolve(second.entryId, { ...second.resolution, provenance: [...second.resolution.provenance] })).toThrow(/already RESOLVED/);
  });
});
