/**
 * P18-B deterministic reference-mode suite (5/7): RECEIPT RENDERING.
 * The receipt views produced by the REAL endpoint pipeline render
 * server-side (renderToStaticMarkup) — pinned:
 *
 *   - status presentation (SUCCEEDED / DENIED / FAILED / RESOLVED);
 *   - the authority decision block (re-evaluated at action time, reason,
 *     grant id) and the DENIED safe-failure UX with the authority reason;
 *   - evidence ids + the evidence/rationale deep links (the receipt
 *     carries them — never a bare status);
 *   - the idempotency scope (in-process; NO durable confirmation claimed)
 *     and the replay marker;
 *   - the six-question review block on the receipt (the rationale
 *     presentation preserved from the read-only mission view);
 *   - honest vocabulary only: no fabricated CONNECTED/complete/verified
 *     claims; UNKNOWN stays UNKNOWN.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { InMemoryAuthority } from '@sos-2/action-gateway';
import type { ActionFamily } from '@sos-2/action-gateway';
import { createLiveActionHost, submitLiveAction } from '@live-action/core';
import type { LiveActionReceiptView } from '@live-action/core';
import { ActionReceiptView } from '@live-action/receipt-view';
import { pendingAsk } from './helpers/ask-fixtures';

const T0 = 1_797_123_600_000;
const ACTOR = 'console-user';
const AS_OF = '2026-09-26T00:00:00Z';

const SUMMON_FORM: Record<string, unknown> = {
  family: 'body-lifecycle',
  actor: { kind: 'human', id: ACTOR },
  targetRevision: { kind: 'source', sha: 'seed-workspace-base' },
  payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: 'cloud-sandbox-1', operation: 'start' } },
};

const PROMOTION_FORM: Record<string, unknown> = {
  family: 'promotion',
  actor: { kind: 'human', id: ACTOR },
  targetRevision: { kind: 'source', sha: 'seed-workspace-base' },
  payload: { family: 'promotion', promotion: { fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: 'seed-workspace-base' } },
};

const ROLLBACK_FORM: Record<string, unknown> = {
  family: 'rollback',
  actor: { kind: 'human', id: ACTOR },
  targetRevision: { kind: 'source', sha: 'seed-workspace-base' },
  payload: {
    family: 'rollback',
    rollback: {
      deploymentId: 'current-production',
      fromSourceSha: 'seed-workspace-base',
      toSourceSha: 'seed-workspace-base',
      reason: { code: 'MANUAL_DIRECTIVE', detail: 'deterministic suite rollback' },
    },
  },
};

function renderView(view: LiveActionReceiptView): string {
  return renderToStaticMarkup(createElement(ActionReceiptView, { view, asOf: AS_OF }));
}

function submitTo(host: ReturnType<typeof createLiveActionHost>, envelope: Record<string, unknown>): LiveActionReceiptView {
  return submitLiveAction({ body: JSON.stringify(envelope), contentType: 'application/json', host, now: T0 }).view;
}

function grantedHost(...grantSpecs: Array<[ActionFamily, string]>): ReturnType<typeof createLiveActionHost> {
  const host = createLiveActionHost({ clock: { now: (): number => T0 } });
  const authority = host.reference!.authority as InMemoryAuthority;
  for (const [family, scope] of grantSpecs) {
    authority.grant(ACTOR, family, scope);
  }
  return host;
}

describe('the SUCCEEDED receipt rendering', () => {
  const host = grantedHost(['body-lifecycle', 'cloud-sandbox-1']);
  const view = submitTo(host, SUMMON_FORM);
  const html = renderView(view);

  it('renders the status, the LIVE provenance badge and the acted-on revision', () => {
    expect(html).toContain('SUCCEEDED');
    expect(html).toContain('data-live-badge="true"');
    expect(html).toContain('seed-workspace-base');
    expect(html).toContain('body-lifecycle');
  });

  it('renders the executor output (what actually happened) and the evidence ids', () => {
    expect(html).toContain('Executor output');
    expect(html).toContain('state');
    expect(html).toContain('RUNNING');
    expect(html).toContain('action-evidence:'); // the content-addressed evidence binding
    expect(html).toContain('Evidence');
  });

  it('carries the evidence and rationale deep links (the receipt never stands alone)', () => {
    expect(html).toContain('href="/evidence"');
    expect(html).toContain('href="/rationale"');
    expect(html).toContain('href="/mission"');
    expect(html).toContain('six evidence truth states');
  });

  it('answers the six review questions inline (the rationale presentation preserved)', () => {
    expect(html).toContain('What happened?');
    expect(html).toContain('Why does SOS believe this?');
    expect(html).toContain('What evidence supports it?');
    expect(html).toContain('What uncertainty remains?');
    expect(html).toContain('What authority is required?');
    expect(html).toContain('What can happen next?');
  });

  it('states the in-process idempotency scope honestly (NO durable confirmation claimed)', () => {
    expect(html).toContain('scope: in-process');
    expect(html).toContain('NO durable idempotency is claimed');
    expect(html).toContain('no durable confirmation is claimed');
  });

  it('states the authority-at-action-time guarantee', () => {
    expect(html).toContain('re-evaluated AT ACTION TIME');
    expect(html).toContain('fails CLOSED');
  });
});

describe('the DENIED receipt rendering (safe failure UX with the authority reason)', () => {
  const host = createLiveActionHost({ clock: { now: (): number => T0 } }); // no grant held
  const view = submitTo(host, SUMMON_FORM);
  const html = renderView(view);

  it('renders the DENIED status with the authority reason and grant state', () => {
    expect(html).toContain('DENIED');
    expect(html).toContain('ACTION_AUTHORITY_DENIED');
    expect(html).toContain('GRANT_NEVER_HELD');
  });

  it('renders the safe-failure block: nothing executed, the designed behavior, not an outage', () => {
    expect(html).toContain('Denied — safe failure (nothing executed)');
    expect(html).toContain('The executor was never invoked for this action');
    expect(html).toContain('not an outage');
  });

  it('never claims an execution outcome for a denied action', () => {
    expect(html).not.toContain('Executor output');
    expect(html).not.toContain('SUCCEEDED');
  });

  it('still carries the evidence/rationale links and the six questions (a denial is explainable)', () => {
    expect(html).toContain('href="/evidence"');
    expect(html).toContain('href="/rationale"');
    expect(html).toContain('What happened?');
  });
});

describe('the FAILED receipt rendering (typed operation failure)', () => {
  it('renders the typed failure with its operation, errorType and retryability', () => {
    const host = createLiveActionHost({ clock: { now: (): number => T0 }, executors: [] }); // no executor bound — typed NO_EXECUTOR_BOUND
    (host.reference!.authority as InMemoryAuthority).grant(ACTOR, 'body-lifecycle', 'cloud-sandbox-1');
    const view = submitTo(host, SUMMON_FORM);
    const html = renderView(view);
    expect(html).toContain('FAILED');
    expect(html).toContain('NO_EXECUTOR_BOUND');
    expect(html).toContain('Retryable');
    expect(html).toContain('typed operation failure');
  });
});

describe('the REPLAYED receipt rendering', () => {
  it('marks the replay: the recorded original receipt returned, no second execution', () => {
    const host = grantedHost(['body-lifecycle', 'cloud-sandbox-1']);
    submitTo(host, SUMMON_FORM);
    const replayView = submitTo(host, SUMMON_FORM);
    const html = renderView(replayView);
    expect(html).toContain('replay');
    expect(html).toContain('recorded original receipt returned');
    expect(html).toContain('no second execution');
  });
});

describe('the rollback receipt rendering (verification verdict honest)', () => {
  it('renders the rollback verification block with the honest verdict (UNKNOWN stays UNKNOWN)', () => {
    const host = grantedHost(['promotion', 'production'], ['rollback', 'any']);
    // a promotion first so the reference world has a REAL deployment to roll
    // back (the promotion receipt carries its content-addressed deployment id)
    const promotionView = submitTo(host, PROMOTION_FORM);
    const deploymentId = promotionView.kind === 'gateway-action' ? promotionView.receipt?.deploymentRevision ?? null : null;
    expect(deploymentId).not.toBeNull();
    // a second grant scoped to the REAL deployment id (authority is scope-exact)
    (host.reference!.authority as InMemoryAuthority).grant(ACTOR, 'rollback', deploymentId!);
    const view = submitTo(host, {
      ...ROLLBACK_FORM,
      payload: {
        family: 'rollback',
        rollback: {
          deploymentId: deploymentId!,
          fromSourceSha: 'seed-workspace-base',
          toSourceSha: 'seed-workspace-base',
          reason: { code: 'MANUAL_DIRECTIVE', detail: 'deterministic suite rollback' },
        },
      },
    });
    const html = renderView(view);
    expect(html).toContain('Rollback verification');
    expect(html).toContain('VERIFIED');
    expect(html).toContain('rollback.verification');
  });

  it('the UI logical deployment id (current-production) fails honestly when no such deployment exists (typed UNKNOWN_DEPLOYMENT)', () => {
    const host = grantedHost(['rollback', 'current-production']);
    const view = submitTo(host, ROLLBACK_FORM);
    const html = renderView(view);
    expect(html).toContain('FAILED');
    expect(html).toContain('UNKNOWN_DEPLOYMENT');
  });
});

describe('the rejected-envelope receipt rendering', () => {
  it('renders the typed validation rejection with its field and code (400 path)', () => {
    const host = grantedHost(['body-lifecycle', 'cloud-sandbox-1']);
    const smuggled: Record<string, unknown> = { ...SUMMON_FORM, token: 'smuggled' };
    const view = submitTo(host, smuggled);
    const html = renderView(view);
    expect(html).toContain('REJECTED');
    expect(html).toContain('AUTHORITY_FIELD_SMUGGLED');
    expect(html).toContain('fail-closed');
  });

  it('renders the malformed submission view (nothing executed)', () => {
    const html = renderView({ kind: 'malformed', detail: 'the submission body is empty' });
    expect(html).toContain('rejected submission');
    expect(html).toContain('nothing executed');
  });
});

describe('the ASK resolution receipt rendering', () => {
  it('renders the RESOLVED receipt with the decision reference as the evidence binding', () => {
    const { queue, entryId } = pendingAsk(['P18B:tests-live-ux-actions']);
    const host = createLiveActionHost({ clock: { now: (): number => T0 }, asks: queue });
    const view = submitTo(host, {
      entryId,
      resolution: {
        resolved_by: ACTOR,
        chosen_alternative_id: 'act-under-granted-authority',
        note: 'resolved in the deterministic suite',
        provenance: ['human:console-user'],
        created_at: '2026-09-26T00:00:00Z',
      },
    });
    const html = renderView(view);
    expect(html).toContain('RESOLVED');
    expect(html).toContain('Decision record');
    expect(html).toContain('sos://');
    expect(html).toContain('HUMAN resolver');
  });

  it('renders the honest ASK failure (unknown entry — never a fabricated resolution)', () => {
    const host = createLiveActionHost({ clock: { now: (): number => T0 } });
    const view = submitTo(host, {
      entryId: 'ask-unknown',
      resolution: {
        resolved_by: ACTOR,
        chosen_alternative_id: 'alt-1',
        note: 'try',
        provenance: ['human:console-user'],
        created_at: '2026-09-26T00:00:00Z',
      },
    });
    const html = renderView(view);
    expect(html).toContain('FAILED');
    expect(html).toContain('ASK_ENTRY_UNKNOWN');
    expect(html).toContain('never a fabricated resolution');
    expect(html).toContain('honestly empty');
  });
});

describe('receipt views are serializable (the JSON receipt contract)', () => {
  it('round-trips every receipt shape through JSON (machine-checkable receipts)', () => {
    const host = grantedHost(['body-lifecycle', 'cloud-sandbox-1'], ['promotion', 'production']);
    const views: LiveActionReceiptView[] = [
      submitTo(host, SUMMON_FORM),
      submitTo(host, SUMMON_FORM), // replay
      submitTo(createLiveActionHost({ clock: { now: (): number => T0 } }), SUMMON_FORM), // denied
      { kind: 'malformed', detail: 'x' },
    ];
    for (const view of views) {
      expect(() => JSON.parse(JSON.stringify(view))).not.toThrow();
    }
  });
});
