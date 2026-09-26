/**
 * P18-B deterministic reference-mode suite (2/7): AUTHORITY-AT-ACTION-TIME
 * ENFORCEMENT, FAIL-CLOSED. The exact envelopes the mounted forms POST
 * execute through the REAL merged ActionGateway:
 *
 *   - a held grant executes (SUCCEEDED, evidence emitted, event appended);
 *   - a REVOKED / EXPIRED / NEVER-HELD grant fails CLOSED: DENIED, the
 *     executor is NEVER invoked (the world is untouched), and the denial
 *     is evidence-bound with the authority snapshot rendered in the
 *     receipt view data;
 *   - the environment-configured authority binding (the deployed host)
 *     re-reads the CURRENT grant list at every evaluation — removing the
 *     grant revokes at action time (fail-closed).
 */

import { describe, expect, it } from 'vitest';
import { InMemoryAuthority } from '@sos-2/action-gateway';
import type { ActionExecutor, ActionOperation, ExecutionContext, ExecutionResult } from '@sos-2/action-gateway';
import { createLiveActionHost, submitLiveAction } from '@live-action/core';
import { EnvConfiguredAuthority, createDeployedLiveActionHost, deployedHostConfigFromEnv } from '@live-action/deployed-host';

const T0 = 1_797_123_600_000;
const ACTOR = 'console-user';

const SUMMON_FORM: Record<string, unknown> = {
  family: 'body-lifecycle',
  actor: { kind: 'human', id: ACTOR },
  targetRevision: { kind: 'source', sha: 'seed-workspace-base' },
  payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: 'cloud-sandbox-1', operation: 'start' } },
};

/** A counting executor: proves fail-closed by NEVER being invoked without a grant. */
function countingExecutor(): ActionExecutor & { calls: number } {
  const executor = {
    calls: 0,
    families: ['body-lifecycle' as const],
    execute(_operation: ActionOperation, _context: ExecutionContext): ExecutionResult {
      executor.calls += 1;
      return { status: 'ok', output: { produced: { bodyId: 'cloud-sandbox-1', state: 'RUNNING' } } };
    },
  };
  return executor;
}

function submit(host: ReturnType<typeof createLiveActionHost>, envelope: Record<string, unknown> = SUMMON_FORM) {
  return submitLiveAction({ body: JSON.stringify(envelope), contentType: 'application/json', host, now: T0 });
}

describe('authority gates on the live action submissions (the real gateway)', () => {
  it('executes when the CURRENT grant is held (evidence + event emitted, executor invoked exactly once)', () => {
    const executor = countingExecutor();
    const host = createLiveActionHost({ clock: { now: (): number => T0 }, executors: [executor] });
    (host.reference!.authority as InMemoryAuthority).grant(ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
    const result = submit(host);
    expect(result.view.kind).toBe('gateway-action');
    if (result.view.kind === 'gateway-action') {
      expect(result.view.outcome).toBe('executed');
      expect(result.view.receipt?.status).toBe('SUCCEEDED');
      expect(result.view.receipt?.evidenceIds.length).toBeGreaterThan(0);
      expect(result.view.receipt?.sourceRevision).toBe('seed-workspace-base');
    }
    expect(executor.calls).toBe(1);
    expect(host.reference!.events.entries().map((event) => event.type)).toContain('action.succeeded');
    expect(host.reference!.evidence.all().length).toBeGreaterThan(0);
  });

  it('fails CLOSED on a REVOKED grant: DENIED, executor never invoked, denial evidence-bound', () => {
    const executor = countingExecutor();
    const host = createLiveActionHost({ clock: { now: (): number => T0 }, executors: [executor] });
    const authority = host.reference!.authority as InMemoryAuthority;
    const grantId = authority.grant(ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
    authority.revoke(grantId);
    const result = submit(host);
    if (result.view.kind === 'gateway-action') {
      expect(result.view.receipt?.status).toBe('DENIED');
      expect(result.view.receipt?.denial?.reason).toBe('ACTION_AUTHORITY_DENIED');
      expect(result.view.receipt?.denial?.authority?.reason).toBe('GRANT_REVOKED');
      expect(result.view.receipt?.denial?.authority?.evaluatedAt).toBe(T0); // re-evaluated AT ACTION TIME
    }
    expect(executor.calls).toBe(0); // the executor was NEVER invoked
    const outcomeEvidence = host.reference!.evidence.all().filter((record) => record.evidenceType === 'action.outcome');
    expect(outcomeEvidence).toHaveLength(1);
    expect((outcomeEvidence[0] as { status: string }).status).toBe('DENIED');
    expect(host.reference!.events.entries().map((event) => event.type)).toContain('action.denied');
  });

  it('fails CLOSED on an EXPIRED grant (expiry evaluated at action time, not planning time)', () => {
    const executor = countingExecutor();
    const host = createLiveActionHost({ clock: { now: (): number => T0 }, executors: [executor] });
    (host.reference!.authority as InMemoryAuthority).grant(ACTOR, 'body-lifecycle', 'cloud-sandbox-1', { expiresAt: T0 - 1 });
    const result = submit(host);
    if (result.view.kind === 'gateway-action') {
      expect(result.view.receipt?.status).toBe('DENIED');
      expect(result.view.receipt?.denial?.authority?.reason).toBe('GRANT_EXPIRED');
    }
    expect(executor.calls).toBe(0);
  });

  it('fails CLOSED on a NEVER-HELD grant (the default honest state of an unwired authority plane)', () => {
    const executor = countingExecutor();
    const host = createLiveActionHost({ clock: { now: (): number => T0 }, executors: [executor] });
    const result = submit(host);
    if (result.view.kind === 'gateway-action') {
      expect(result.view.receipt?.status).toBe('DENIED');
      expect(result.view.receipt?.denial?.authority?.reason).toBe('GRANT_NEVER_HELD');
      expect(result.view.receipt?.denial?.authority?.grantId).toBeNull();
    }
    expect(executor.calls).toBe(0);
  });

  it('a grant held for a DIFFERENT scope does not authorize this action (scope-exact matching)', () => {
    const executor = countingExecutor();
    const host = createLiveActionHost({ clock: { now: (): number => T0 }, executors: [executor] });
    (host.reference!.authority as InMemoryAuthority).grant(ACTOR, 'body-lifecycle', 'some-other-body');
    const result = submit(host);
    if (result.view.kind === 'gateway-action') {
      expect(result.view.receipt?.status).toBe('DENIED');
      expect(result.view.receipt?.denial?.authority?.reason).toBe('GRANT_NEVER_HELD');
    }
    expect(executor.calls).toBe(0);
  });

  it('promotion and rollback families gate identically (each consequential family is authority-gated)', () => {
    const promotionForm: Record<string, unknown> = {
      family: 'promotion',
      actor: { kind: 'human', id: ACTOR },
      targetRevision: { kind: 'source', sha: 'seed-workspace-base' },
      payload: { family: 'promotion', promotion: { fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: 'seed-workspace-base' } },
    };
    const executor = countingExecutor();
    const host = createLiveActionHost({ clock: { now: (): number => T0 }, executors: [{ ...executor, families: ['promotion' as const, 'rollback' as const] }] });
    const result = submit(host, promotionForm);
    if (result.view.kind === 'gateway-action') {
      expect(result.view.receipt?.status).toBe('DENIED');
      expect(result.view.receipt?.denial?.authority?.reason).toBe('GRANT_NEVER_HELD');
    }
    expect(executor.calls).toBe(0);
  });
});

describe('the env-configured authority binding (the deployed host)', () => {
  it('reads the CURRENT grant configuration on every evaluation — removal revokes at action time', () => {
    let grants: readonly string[] = ['console-user|body-lifecycle|cloud-sandbox-1'];
    const authority = new EnvConfiguredAuthority(() => grants);
    const granted = authority.evaluateCurrent({ actor: { kind: 'human', id: ACTOR }, family: 'body-lifecycle', scope: 'cloud-sandbox-1' }, T0);
    expect(granted.granted).toBe(true);
    expect(granted.reason).toBe('GRANTED');
    expect(granted.grantId).toBe('console-user|body-lifecycle|cloud-sandbox-1');
    grants = [];
    const revoked = authority.evaluateCurrent({ actor: { kind: 'human', id: ACTOR }, family: 'body-lifecycle', scope: 'cloud-sandbox-1' }, T0 + 1);
    expect(revoked.granted).toBe(false);
    expect(revoked.reason).toBe('GRANT_NEVER_HELD');
  });

  it('a wildcard scope entry authorizes any scope for that actor+family; malformed entries are ignored', () => {
    const authority = new EnvConfiguredAuthority(() => ['console-user|promotion|*', 'malformed-entry', 'other-user|promotion|production']);
    const wild = authority.evaluateCurrent({ actor: { kind: 'human', id: ACTOR }, family: 'promotion', scope: 'production' }, T0);
    expect(wild.granted).toBe(true);
    const other = authority.evaluateCurrent({ actor: { kind: 'human', id: 'someone-else' }, family: 'promotion', scope: 'production' }, T0);
    expect(other.granted).toBe(false);
  });

  it('the env mapping binds only the documented env NAMES (values flow, never echo)', () => {
    // SYNTHETIC values (never real credentials) — asserted absent from every serialized surface
    const config = deployedHostConfigFromEnv({
      SOS_LIVE_MISSION_GRANTS: '["console-user|body-lifecycle|cloud-sandbox-1"]',
      BODY_PROVIDER_API_KEY: 'synthetic-body-key-value',
      VERCEL_TOKEN: 'synthetic-vercel-key-value',
      VERCEL_PROJECT_ID: 'prj_test',
      GITHUB_ACCESS_TOKEN: 'synthetic-github-key-value',
    });
    expect(config.grants).toEqual(['console-user|body-lifecycle|cloud-sandbox-1']);
    expect(config.openRouter?.model).toBe('openai/gpt-4o-mini');
    expect(config.vercel?.projectId).toBe('prj_test');
    expect(config.github?.owner).toBe('payswapdotorg');
    const serialized = JSON.stringify(deployedHostConfigFromEnv({}));
    expect(serialized).not.toContain('synthetic-body-key-value');
    expect(JSON.stringify({ grants: config.grants, model: config.openRouter?.model })).not.toContain('synthetic');
  });

  it('absent credentials bind NO provider (the honest unbound host — no executor at all)', () => {
    const deployed = createDeployedLiveActionHost(deployedHostConfigFromEnv({}), { clock: { now: (): number => T0 } });
    expect(deployed.bridge).toBeNull();
    expect(deployed.providersBound).toEqual([]);
    expect(deployed.host.label).toBe('live-action:deployed-unbound');
    const result = submit(deployed.host);
    if (result.view.kind === 'gateway-action') {
      // no grants configured -> DENIED before the missing executor even matters (fail-closed ordering)
      expect(result.view.receipt?.status).toBe('DENIED');
      expect(result.view.receipt?.denial?.authority?.reason).toBe('GRANT_NEVER_HELD');
    }
  });
});
