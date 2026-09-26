/**
 * P18-B deterministic reference-mode acceptance suite (2/8):
 * AUTHORITY-AT-ACTION-TIME ENFORCEMENT (fail-closed).
 *
 * Every consequential action goes through the endpoint's OWN host
 * composition (createLiveActionHost — the same submitAction code path the
 * route serves) with every seam injected: a fixed clock, a scripted model
 * port (so "the executor was never invoked" is COUNTABLE), a scripted
 * Vercel FetchPort, and either the env-declared operator authority or an
 * injected authority port for the revoked/expired paths.
 *
 * The gates pinned here (the frozen gateway contract):
 *   - a CURRENT grant executes (SUCCEEDED, evidence-bound, the real
 *     provider facts bound to the receipt);
 *   - a REVOKED / EXPIRED / NEVER-HELD grant fails CLOSED (DENIED, the
 *     executor NEVER invoked — the scripted model port call count stays
 *     at zero, the providers never probed);
 *   - authority is re-evaluated AT ACTION TIME: the same operator grant
 *     declaration that authorized one action can deny the NEXT (the env
 *     source is read per action);
 *   - a provider credential is NEVER authority by itself (a configured
 *     provider with no grant declaration still denies).
 */

import { describe, expect, it } from 'vitest';
import { InMemoryAuthority } from '@sos-2/action-gateway';
import type { HostedModelPort, HostedModelRequest, HostedModelCall } from '@sos-2/real-bodies';
import { createLiveActionHost } from '@live-mission/host';
import { summonBodyEnvelope, promotionEnvelope, rollbackEnvelope } from '@live-mission/envelopes';
import { vercelRecordsFetch } from './helpers/scripted-vercel';

const T0 = 1_797_123_600_000;
const ACTOR = 'console-user';
const BASE_SHA = '3717b6ccac8e0741e8a0eef7fd3b0aa92502f6ea';
const PRODUCTION_SHA = 'b5938ea4654144df287ce3e907389fc1f911ccf6';

/** A scripted model port that COUNTS its calls (the executor-invocation proof). */
class CountingModelPort implements HostedModelPort {
  readonly calls: HostedModelRequest[] = [];
  constructor(private readonly respond: () => HostedModelCall) {}
  complete(request: HostedModelRequest): Promise<HostedModelCall> {
    this.calls.push(request);
    return Promise.resolve(this.respond());
  }
}

function okModelPort(): CountingModelPort {
  return new CountingModelPort(() => ({
    ok: true,
    response: { id: 'resp-deterministic-0001', model: 'qwen/qwen3-coder-flash', content: 'ready', finish_reason: 'stop', usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 } },
  }));
}

function grantsEnv(declaration: string): () => Record<string, string | undefined> {
  const record: Record<string, string | undefined> = {
    LIVE_MISSION_GRANTS: declaration,
    BODY_PROVIDER_API_KEY: 'sk-or-v1-deterministic-scripted-not-a-real-credential',
    VERCEL_TOKEN: 'deterministic-scripted-vercel-token',
    VERCEL_PROJECT_ID: 'prj-deterministic-scripted',
  };
  return () => record;
}

function summon(bodyId: string, idempotencyKey: string) {
  return summonBodyEnvelope({ actorId: ACTOR, bodyId, baseSha: BASE_SHA, actionId: `authority-test-${bodyId}`, idempotencyKey, requestedAt: T0 });
}

describe('authority gates on the endpoint host composition (the real machinery, every seam injected)', () => {
  it('executes the summon-body action when the CURRENT grant is held (real provider facts bound to the receipt)', async () => {
    const modelPort = okModelPort();
    const host = createLiveActionHost({
      env: grantsEnv('body-lifecycle:cloud-sandbox-1'),
      now: () => T0,
      modelPort,
    });
    const outcome = await host.submitAction(summon('cloud-sandbox-1', 'auth-idem-1'));
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('SUCCEEDED');
      expect(outcome.receipt.evidenceIds.length).toBeGreaterThan(0);
      expect(outcome.receipt.output).toMatchObject({ produced: { bodyId: 'cloud-sandbox-1', state: 'RUNNING', provider: 'openrouter' } });
    }
    // the real provider probe ran exactly once (the executor WAS invoked under the grant)
    expect(modelPort.calls).toHaveLength(1);
    if (outcome.kind === 'executed') {
      // the execution record carries the real provider facts + the honest CONNECTED state
      expect(outcome.execution?.mode).toBe('real');
      expect(outcome.execution?.providers[0]?.state).toBe('CONNECTED');
      expect(outcome.execution?.facts['bodyModelResponseId']).toBe('resp-deterministic-0001');
    }
  });

  it('fails CLOSED on a NEVER-HELD grant: DENIED, the executor never invoked, the provider never probed', async () => {
    const modelPort = okModelPort();
    const host = createLiveActionHost({ env: grantsEnv(''), now: () => T0, modelPort });
    const outcome = await host.submitAction(summon('cloud-sandbox-1', 'auth-idem-2'));
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('DENIED');
      expect(outcome.receipt.denial?.authority?.reason).toBe('GRANT_NEVER_HELD');
    }
    // fail-closed: the model port was NEVER called (no probe without authority)
    expect(modelPort.calls).toHaveLength(0);
    // no execution record for a denied action (nothing happened at the providers)
    expect(outcome.kind === 'executed' ? outcome.execution : null).toBeNull();
  });

  it('fails CLOSED on a REVOKED grant (the injected authority port)', async () => {
    const authority = new InMemoryAuthority();
    const grantId = authority.grant(ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
    const modelPort = okModelPort();
    const host = createLiveActionHost({ env: grantsEnv(''), now: () => T0, authority, modelPort });
    authority.revoke(grantId);
    const outcome = await host.submitAction(summon('cloud-sandbox-1', 'auth-idem-3'));
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('DENIED');
      expect(outcome.receipt.denial?.authority?.reason).toBe('GRANT_REVOKED');
    }
    expect(modelPort.calls).toHaveLength(0);
  });

  it('fails CLOSED on an EXPIRED grant (the injected authority port)', async () => {
    const authority = new InMemoryAuthority();
    authority.grant(ACTOR, 'body-lifecycle', 'cloud-sandbox-1', { expiresAt: T0 - 1 });
    const modelPort = okModelPort();
    const host = createLiveActionHost({ env: grantsEnv(''), now: () => T0, authority, modelPort });
    const outcome = await host.submitAction(summon('cloud-sandbox-1', 'auth-idem-4'));
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('DENIED');
      expect(outcome.receipt.denial?.authority?.reason).toBe('GRANT_EXPIRED');
    }
    expect(modelPort.calls).toHaveLength(0);
  });

  it('re-evaluates authority AT ACTION TIME: the operator declaration read per action (a removed grant denies the NEXT action)', async () => {
    const record: Record<string, string | undefined> = {
      LIVE_MISSION_GRANTS: 'body-lifecycle:cloud-sandbox-1',
      BODY_PROVIDER_API_KEY: 'sk-or-v1-deterministic-scripted-not-a-real-credential',
    };
    const modelPort = okModelPort();
    const host = createLiveActionHost({ env: () => record, now: () => T0, modelPort });
    const first = await host.submitAction(summon('cloud-sandbox-1', 'auth-idem-5'));
    expect(first.kind === 'executed' && first.receipt.status).toBe('SUCCEEDED');
    // the operator revokes (removes the declaration) between actions
    record['LIVE_MISSION_GRANTS'] = '';
    const second = await host.submitAction(summon('cloud-sandbox-1', 'auth-idem-6'));
    expect(second.kind === 'executed' && second.receipt.status).toBe('DENIED');
    if (second.kind === 'executed') {
      expect(second.receipt.denial?.authority?.reason).toBe('GRANT_NEVER_HELD');
    }
    // only the FIRST action probed the provider
    expect(modelPort.calls).toHaveLength(1);
  });

  it('honors grant SCOPES: a grant for another body id does not authorize this one (fail-closed)', async () => {
    const modelPort = okModelPort();
    const host = createLiveActionHost({ env: grantsEnv('body-lifecycle:cloud-sandbox-other'), now: () => T0, modelPort });
    const outcome = await host.submitAction(summon('cloud-sandbox-1', 'auth-idem-7'));
    expect(outcome.kind === 'executed' && outcome.receipt.status).toBe('DENIED');
    expect(modelPort.calls).toHaveLength(0);
  });

  it('a wildcard-scope declaration covers every scope of the family (the documented operator format)', async () => {
    const modelPort = okModelPort();
    const host = createLiveActionHost({ env: grantsEnv('body-lifecycle'), now: () => T0, modelPort });
    const outcome = await host.submitAction(summon('any-body-id', 'auth-idem-8'));
    expect(outcome.kind === 'executed' && outcome.receipt.status).toBe('SUCCEEDED');
    expect(modelPort.calls).toHaveLength(1);
  });

  it('a provider credential is NEVER authority by itself (configured providers, no declaration -> DENIED)', async () => {
    const modelPort = okModelPort();
    const record: Record<string, string | undefined> = {
      LIVE_MISSION_GRANTS: '',
      BODY_PROVIDER_API_KEY: 'sk-or-v1-deterministic-scripted-not-a-real-credential',
      VERCEL_TOKEN: 'deterministic-scripted-vercel-token',
      VERCEL_PROJECT_ID: 'prj-deterministic-scripted',
    };
    const host = createLiveActionHost({ env: () => record, now: () => T0, modelPort });
    const outcome = await host.submitAction(summon('cloud-sandbox-1', 'auth-idem-9'));
    expect(outcome.kind === 'executed' && outcome.receipt.status).toBe('DENIED');
    expect(modelPort.calls).toHaveLength(0);
  });

  it('an expiring declaration denies after its expiry epoch (the documented operator format)', async () => {
    const modelPort = okModelPort();
    const host = createLiveActionHost({
      env: grantsEnv(`body-lifecycle:cloud-sandbox-1:${String(T0 - 1)}`),
      now: () => T0,
      modelPort,
    });
    const outcome = await host.submitAction(summon('cloud-sandbox-1', 'auth-idem-10'));
    expect(outcome.kind === 'executed' && outcome.receipt.status).toBe('DENIED');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.denial?.authority?.reason).toBe('GRANT_EXPIRED');
    }
    expect(modelPort.calls).toHaveLength(0);
  });

  it('malformed declaration entries are IGNORED loudly-in-detail (never authority)', async () => {
    const modelPort = okModelPort();
    const host = createLiveActionHost({
      env: grantsEnv('body-lifecycle:cloud-sandbox-1, not-a-family, body-lifecycle:cloud-sandbox-1:NaN'),
      now: () => T0,
      modelPort,
    });
    const outcome = await host.submitAction(summon('cloud-sandbox-1', 'auth-idem-11'));
    expect(outcome.kind === 'executed' && outcome.receipt.status).toBe('SUCCEEDED');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.denial).toBeNull();
    }
  });
});

describe('the deployment-record families bind to the REAL records (fail-closed on unknown revisions)', () => {
  it('executes a promotion bound to a REALLY-deployed revision (the receipt carries the real dpl id)', async () => {
    const host = createLiveActionHost({
      env: grantsEnv('promotion:production'),
      now: () => T0,
      modelPort: okModelPort(),
      vercelFetch: vercelRecordsFetch(),
    });
    const outcome = await host.submitAction(
      promotionEnvelope({ actorId: ACTOR, fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: BASE_SHA, actionId: 'auth-promote-1', idempotencyKey: 'auth-idem-12', requestedAt: T0 }),
    );
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('SUCCEEDED');
      expect(outcome.receipt.deploymentRevision).toBe('dpl_deterministic_head_0001');
      expect(outcome.execution?.requests.length).toBeGreaterThan(0); // the real HTTP transcript
    }
  });

  it('fails CLOSED when the promoted revision was never really deployed (NO_REAL_DEPLOYMENT_FOR_SHA)', async () => {
    const host = createLiveActionHost({
      env: grantsEnv('promotion:production'),
      now: () => T0,
      modelPort: okModelPort(),
      vercelFetch: vercelRecordsFetch(),
    });
    const outcome = await host.submitAction(
      promotionEnvelope({ actorId: ACTOR, fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: 'never-deployed-sha-0000000000000000000000000000000000000000', actionId: 'auth-promote-2', idempotencyKey: 'auth-idem-13', requestedAt: T0 }),
    );
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('FAILED');
      expect(outcome.receipt.failure?.errorType).toBe('NO_REAL_DEPLOYMENT_FOR_SHA');
    }
  });

  it('executes a rollback with the VERIFIED rollback verification against the real records', async () => {
    const host = createLiveActionHost({
      env: grantsEnv('promotion:production,rollback:*'),
      now: () => T0,
      modelPort: okModelPort(),
      vercelFetch: vercelRecordsFetch(),
    });
    const outcome = await host.submitAction(
      rollbackEnvelope({
        actorId: ACTOR,
        deploymentId: 'dpl_deterministic_head_0001',
        fromSourceSha: BASE_SHA,
        toSourceSha: PRODUCTION_SHA,
        reasonCode: 'MANUAL_DIRECTIVE',
        reasonDetail: 'deterministic suite rollback',
        actionId: 'auth-rollback-1',
        idempotencyKey: 'auth-idem-14',
        requestedAt: T0,
      }),
    );
    expect(outcome.kind).toBe('executed');
    if (outcome.kind === 'executed') {
      expect(outcome.receipt.status).toBe('SUCCEEDED');
      expect(outcome.receipt.rollbackVerification).toMatchObject({ verdict: 'VERIFIED', observedSourceSha: PRODUCTION_SHA });
      // the restored deployment is the REAL record for the target sha
      expect(outcome.receipt.deploymentRevision).toBe('dpl_deterministic_old_0002');
    }
  });
});
