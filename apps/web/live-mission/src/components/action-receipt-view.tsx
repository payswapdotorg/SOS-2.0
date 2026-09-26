/**
 * The live action receipt view (Work Order P18-B — the receipt rendering
 * wiring seam of apps/web/live-mission). Renders the typed receipts the
 * LIVE_ACTION_ENDPOINT answers with: the gateway action receipt
 * (SUCCEEDED / FAILED / DENIED — safe failure and denied-action UX with
 * the authority reason), the ASK resolution receipt (RESOLVED / typed
 * honest failure) and the typed validation rejections.
 *
 * INTEGRATION SEAM ONLY (the P17-C components/view-state/envelopes stay
 * semantically frozen): this component is a NEW file consuming the
 * endpoint's serializable view receipts through STRUCTURAL type mirrors
 * (the live-mission-dto precedent — no runtime edge, no gateway import;
 * the endpoint's receipts satisfy these shapes structurally).
 *
 * Honesty: every receipt renders its evidence ids and rationale links
 * (/evidence, /rationale), the authority decision re-evaluated at action
 * time, the idempotency scope (in-process; the durable adapters are
 * UNAVAILABLE — no durable confirmation is claimed) and the honest
 * rollback verification verdict. DENIED actions render the safe failure
 * UX with the authority reason. Nothing is ever fabricated.
 */

import type { ReactNode } from 'react';
import { Card, Row } from '../../../shell/components/card';
import { ValueChip } from '../../../shell/components/chips';
import { AuthorityGateNote, LiveBadge, LiveReviewBlock } from './shared';
import { shortSha } from '../view-state/live-mission-view';

// ---------------------------------------------------------------------------
// STRUCTURAL mirrors of the endpoint's receipt views (no runtime edge)
// ---------------------------------------------------------------------------

/** Mirrors ActionReceipt denial/authority (the merged gateway shape). */
export interface ReceiptAuthorityMirror {
  readonly granted: boolean;
  readonly reason: string;
  readonly grantId: string | null;
  readonly evaluatedAt: number;
  readonly detail: string;
}

export interface ReceiptDenialMirror {
  readonly reason: string;
  readonly authority: ReceiptAuthorityMirror | null;
  readonly detail: string;
}

export interface ReceiptFailureMirror {
  readonly operation: string;
  readonly errorType: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ReceiptVerificationMirror {
  readonly evidenceType: string;
  readonly actionId: string;
  readonly deploymentId: string;
  readonly expectedSourceSha: string;
  readonly observedSourceSha: string | null;
  readonly verdict: 'VERIFIED' | 'FAILED' | 'UNKNOWN';
  readonly limitation: string | null;
}

/** Mirrors the merged ActionReceipt (serializable; structural only). */
export interface ActionReceiptMirror {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly family: string;
  readonly actor: { readonly kind: string; readonly id: string };
  readonly status: 'SUCCEEDED' | 'FAILED' | 'DENIED';
  readonly sourceRevision: string;
  readonly deploymentRevision: string | null;
  readonly denial: ReceiptDenialMirror | null;
  readonly failure: ReceiptFailureMirror | null;
  readonly output: { readonly produced?: Readonly<Record<string, string>>; readonly noop?: boolean; readonly detail?: string } | null;
  readonly rollbackVerification: ReceiptVerificationMirror | null;
  readonly evidenceIds: readonly string[];
  readonly executedAt: number;
}

export interface ValidationRejectionMirror {
  readonly code: string;
  readonly field: string;
  readonly detail: string;
}

export interface GatewayActionReceiptViewMirror {
  readonly kind: 'gateway-action';
  readonly hostLabel: string;
  readonly outcome: 'executed' | 'replayed' | 'rejected';
  readonly replayed: boolean;
  readonly receipt: ActionReceiptMirror | null;
  readonly rejection: ValidationRejectionMirror | null;
  readonly submittedEnvelope: unknown;
  readonly derivation: string | null;
  readonly actionId: string | null;
  readonly idempotencyKey: string | null;
  readonly idempotencyScope: string;
  readonly honestyNotes: readonly string[];
}

export interface AskResolutionReceiptViewMirror {
  readonly kind: 'ask-resolution';
  readonly hostLabel: string;
  readonly status: 'RESOLVED' | 'FAILED';
  readonly replayed: boolean;
  readonly entryId: string;
  readonly resolvedBy: string | null;
  readonly decisionRef: string | null;
  readonly chosenAlternativeId: string | null;
  readonly resolvedAt: string | null;
  readonly error: { readonly code: string; readonly detail: string } | null;
  readonly submittedEnvelope: unknown;
  readonly idempotencyKey: string;
  readonly idempotencyScope: string;
  readonly honestyNotes: readonly string[];
}

export interface MalformedSubmissionViewMirror {
  readonly kind: 'malformed';
  readonly detail: string;
}

export type LiveActionReceiptViewMirror = GatewayActionReceiptViewMirror | AskResolutionReceiptViewMirror | MalformedSubmissionViewMirror;

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

function rfc3339(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function StatusChip({ status }: { status: string }) {
  const tone =
    status === 'SUCCEEDED' || status === 'RESOLVED'
      ? 'bg-ok-soft text-ok border-ok/30'
      : status === 'DENIED'
        ? 'bg-epistemic-soft text-epistemic border-epistemic/40'
        : 'bg-stop-soft text-stop border-stop/30';
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
      <span className="sr-only">Receipt status: </span>
      {status}
    </span>
  );
}

function BackLinks() {
  return (
    <p className="mt-3 flex flex-wrap gap-3 text-sm">
      <a href="/mission" className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-surface-warm">
        Back to the live Mission surface
      </a>
      <a href="/evidence" className="inline-flex min-h-[44px] items-center rounded-md px-1 text-sm font-medium text-epistemic underline-offset-2 hover:underline">
        Evidence workspace (the six evidence truth states)
      </a>
      <a href="/rationale" className="inline-flex min-h-[44px] items-center rounded-md px-1 text-sm font-medium text-epistemic underline-offset-2 hover:underline">
        Rationale (the six review questions)
      </a>
    </p>
  );
}

/** The action receipt view: safe failure and denied-action UX included. */
export function ActionReceiptView({ view, asOf }: { view: LiveActionReceiptViewMirror; asOf: string }) {
  if (view.kind === 'malformed') {
    return (
      <Card id="live-action-receipt" title="Action receipt — rejected submission">
        <p className="text-sm text-ink-soft">The submission could not be shaped into a typed envelope, so no action was possible (nothing executed — fail-closed).</p>
        <p className="mt-2 rounded-md border border-stop/30 bg-stop-soft p-2 text-sm text-stop" role="alert">
          {view.detail}
        </p>
        <BackLinks />
      </Card>
    );
  }

  const badgeAsOf =
    view.kind === 'gateway-action' && view.receipt !== null
      ? rfc3339(view.receipt.executedAt)
      : view.kind === 'ask-resolution' && view.resolvedAt !== null
        ? view.resolvedAt
        : asOf;
  return (
    <Card
      id="live-action-receipt"
      title="Action receipt"
      chip={<LiveBadge storeRef={view.hostLabel} asOf={badgeAsOf} />}
    >
      {view.kind === 'ask-resolution' ? <AskReceiptBody view={view} /> : <GatewayReceiptBody view={view} />}
      <ul className="mt-4 space-y-1 text-xs text-ink-soft">
        {view.honestyNotes.map((note) => (
          <li key={note} className="rounded-md border border-line bg-surface-warm p-2">
            {note}
          </li>
        ))}
      </ul>
      <BackLinks />
    </Card>
  );
}

function GatewayReceiptBody({ view }: { view: GatewayActionReceiptViewMirror }) {
  const receipt = view.receipt;
  const rejection = view.rejection;
  if (receipt === null) {
    const review = {
      what: `The submitted envelope was rejected before execution (${rejection?.code ?? 'typed rejection'}).`,
      why: 'The merged action gateway validates every envelope (typed shape; smuggled authority fields are named and rejected).',
      evidence: ['No evidence is emitted for a rejected envelope — nothing executed.'],
      uncertainty: 'Nothing was attempted; the typed rejection carries the exact field and reason.',
      authority: 'Not evaluated — authority is only consulted for a validated envelope (fail-closed ordering).',
      next: 'Fix the envelope and resubmit; the mounted forms on the Mission surface always post the validated shapes.',
    };
    return (
      <div>
        <p className="flex flex-wrap items-center gap-2">
          <StatusChip status="REJECTED" />
          <ValueChip label="code" value={rejection?.code ?? 'typed rejection'} />
          <ValueChip label="field" value={rejection?.field ?? '—'} />
        </p>
        <p className="mt-2 rounded-md border border-stop/30 bg-stop-soft p-2 text-sm text-stop" role="alert">
          {rejection?.detail}
        </p>
        <LiveReviewBlock review={review} title="What happened?" />
      </div>
    );
  }
  const denied = receipt.status === 'DENIED';
  const failed = receipt.status === 'FAILED';
  const review = {
    what: `The ${receipt.family} action ${denied ? 'was DENIED' : failed ? 'FAILED' : 'SUCCEEDED'} (receipt ${receipt.actionId}).`,
    why: denied
      ? `Authority re-evaluated at action time failed closed: ${receipt.denial?.detail ?? 'the current grant was not sufficient'} — the executor was never invoked.`
      : failed
        ? `The executor reported a typed failure at ${receipt.failure?.operation ?? 'the operation'}: ${receipt.failure?.message ?? ''}`
        : `The executor seam reported a typed operation outcome for source revision ${receipt.sourceRevision}.`,
    evidence: receipt.evidenceIds.length > 0 ? receipt.evidenceIds : ['No evidence ids were emitted — nothing executed (fail-closed).'],
    uncertainty:
      receipt.rollbackVerification !== null
        ? `Rollback verification verdict: ${receipt.rollbackVerification.verdict}${receipt.rollbackVerification.limitation !== null ? ` (${receipt.rollbackVerification.limitation})` : ''} — UNKNOWN stays UNKNOWN.`
        : denied || failed
          ? 'The failure is the honest record; no state was changed by this action.'
          : 'The receipt records what actually executed; the idempotency scope (in-process) is stated below — no durable confirmation is claimed.',
    authority:
      receipt.denial?.authority !== null && receipt.denial?.authority !== undefined
        ? `${receipt.denial.reason}: grant ${receipt.denial.authority.grantId ?? '—'} evaluated at action time -> ${receipt.denial.authority.reason} (${receipt.denial.authority.detail})`
        : 'Granted at action time by the merged action gateway (exactly one evaluation).',
    next: denied
      ? 'A revoked, expired or never-held grant fails closed by design. Request or renew the authority, then resubmit — the same envelope will replay the recorded outcome.'
      : 'Return to the Mission surface for the next action; the evidence and rationale workspaces explain the vocabulary.',
  };
  return (
    <div>
      <p className="flex flex-wrap items-center gap-2">
        <StatusChip status={receipt.status} />
        {view.replayed ? <ValueChip label="replay" value="recorded original receipt returned (no second execution)" /> : null}
        <ValueChip label="family" value={receipt.family} />
        <ValueChip label="actionId" value={receipt.actionId} />
      </p>
      <dl className="mt-3">
        <Row label="Actor">
          {receipt.actor.kind}:{receipt.actor.id}
        </Row>
        <Row label="Source revision acted on">
          <code className="rounded bg-surface-warm px-1 py-0.5">{receipt.sourceRevision}</code> <span className="text-xs text-ink-soft">({shortSha(receipt.sourceRevision)})</span>
        </Row>
        {receipt.deploymentRevision !== null ? (
          <Row label="Deployment revision">
            <code className="rounded bg-surface-warm px-1 py-0.5">{receipt.deploymentRevision}</code>
          </Row>
        ) : null}
        <Row label="Executed at">{rfc3339(receipt.executedAt)}</Row>
        <Row label="Idempotency key">
          <code className="rounded bg-surface-warm px-1 py-0.5">{receipt.idempotencyKey}</code> <span className="text-xs text-ink-soft">(scope: {view.idempotencyScope})</span>
        </Row>
        {view.derivation !== null ? <Row label="Envelope">{view.derivation === 'form-derived' ? 'form envelope — actionId/idempotencyKey derived deterministically from the submitted content' : 'full envelope — actionId/idempotencyKey carried by the submitter'}</Row> : null}
      </dl>

      {denied ? (
        <div className="mt-3 rounded-lg border border-epistemic/40 bg-epistemic-soft p-3" role="alert">
          <p className="text-sm font-semibold text-ink">Denied — safe failure (nothing executed)</p>
          <p className="mt-1 text-sm text-ink-soft">
            The action failed CLOSED: <code className="rounded bg-surface px-1 py-0.5">{receipt.denial?.reason}</code> — authority reason{' '}
            <code className="rounded bg-surface px-1 py-0.5">{receipt.denial?.authority?.reason}</code>
          </p>
          <p className="mt-1 text-sm text-ink-soft">{receipt.denial?.detail}</p>
          <p className="mt-1 text-xs text-ink-soft">The executor was never invoked for this action — no state was touched. This is the designed safe failure, not an outage.</p>
        </div>
      ) : null}

      {failed ? (
        <div className="mt-3 rounded-lg border border-stop/30 bg-stop-soft p-3" role="alert">
          <p className="text-sm font-semibold text-ink">Failed — typed operation failure</p>
          <p className="mt-1 text-sm text-stop">
            {receipt.failure?.errorType} at {receipt.failure?.operation}: {receipt.failure?.message}
          </p>
          <p className="mt-1 text-xs text-ink-soft">Retryable: {receipt.failure?.retryable === true ? 'yes' : 'no'} — the typed failure is the honest record.</p>
        </div>
      ) : null}

      {receipt.output !== null && receipt.output !== undefined && 'produced' in receipt.output && receipt.output.produced !== undefined ? (
        <div className="mt-3 rounded-lg border border-line bg-surface p-3">
          <p className="text-sm font-medium text-ink">Executor output (what actually happened)</p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(receipt.output.produced).map(([key, value]) => (
              <ValueChip key={key} label={key} value={value} />
            ))}
          </p>
        </div>
      ) : null}
      {receipt.output !== null && receipt.output !== undefined && 'detail' in receipt.output && receipt.output.detail !== undefined ? (
        <div className="mt-3 rounded-lg border border-line bg-surface p-3">
          <p className="text-sm font-medium text-ink">Executor output</p>
          <p className="mt-1 text-sm text-ink-soft">{receipt.output.detail}</p>
        </div>
      ) : null}

      {receipt.rollbackVerification !== null ? (
        <div className="mt-3 rounded-lg border border-line bg-surface p-3">
          <p className="text-sm font-medium text-ink">Rollback verification (the gateway&apos;s own verifier)</p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            <ValueChip label="record" value={receipt.rollbackVerification.evidenceType} />
            <ValueChip label="verdict" value={receipt.rollbackVerification.verdict} />
            <ValueChip label="expected" value={shortSha(receipt.rollbackVerification.expectedSourceSha)} />
            <ValueChip label="observed" value={receipt.rollbackVerification.observedSourceSha === null ? '—' : shortSha(receipt.rollbackVerification.observedSourceSha)} />
          </p>
          {receipt.rollbackVerification.limitation !== null ? <p className="mt-1 text-xs text-ink-soft">{receipt.rollbackVerification.limitation}</p> : null}
        </div>
      ) : null}

      <div className="mt-3 rounded-lg border border-line bg-surface p-3">
        <p className="text-sm font-medium text-ink">Evidence</p>
        <p className="mt-1 text-sm text-ink-soft">The content-addressed evidence ids bound to this exact outcome:</p>
        <ul className="mt-1 space-y-1 text-xs text-ink-soft">
          {receipt.evidenceIds.map((id) => (
            <li key={id}>
              <code className="rounded bg-surface-warm px-1 py-0.5">{id}</code>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-soft">
          The evidence ledger surface (with the six evidence truth states) is the <a href="/evidence" className="text-epistemic underline-offset-2 hover:underline">Evidence workspace</a>; the six-question rationale presentation for this receipt is below.
        </p>
      </div>

      <LiveReviewBlock review={review} title="What happened?" />
      <AuthorityGateNote requiredGrant="re-evaluated at action time" family={receipt.family} />
    </div>
  );
}

function AskReceiptBody({ view }: { view: AskResolutionReceiptViewMirror }) {
  const resolved = view.status === 'RESOLVED';
  const review = {
    what: resolved ? `ASK ${view.entryId} was RESOLVED by ${view.resolvedBy}.` : `ASK resolution FAILED (${view.error?.code ?? 'typed failure'}).`,
    why: resolved
      ? 'The merged AskQueue minted the Decision record bound to the origin ask\u2019s exact input digest (human resolution authority).'
      : view.error?.detail ?? 'The merged queue reported a typed honest failure.',
    evidence: resolved ? [`Decision record ${view.decisionRef ?? '—'} (the resolution\u2019s evidence binding)`] : ['No decision record was minted — the typed failure is the honest record.'],
    uncertainty: 'An entry is resolved at most once (terminal); a NEW ask for changed input has a different digest.',
    authority: 'The HUMAN resolver (resolved_by) is the resolution authority; the queue never mints authority of its own.',
    next: resolved ? 'The resolution is recorded; return to the Mission surface.' : 'The ask plane has no wired producer on this branch (the queue is honestly empty) — an unknown entry is a typed honest failure, never a fabricated resolution.',
  };
  return (
    <div>
      <p className="flex flex-wrap items-center gap-2">
        <StatusChip status={view.status} />
        {view.replayed ? <ValueChip label="replay" value="recorded original outcome returned" /> : null}
        <ValueChip label="entry" value={view.entryId} />
      </p>
      <dl className="mt-3">
        <Row label="Resolved by">{view.resolvedBy ?? '—'}</Row>
        <Row label="Chosen alternative">{view.chosenAlternativeId ?? '—'}</Row>
        <Row label="Resolved at">{view.resolvedAt ?? '—'}</Row>
        <Row label="Decision record">
          {view.decisionRef !== null ? <code className="rounded bg-surface-warm px-1 py-0.5">{view.decisionRef}</code> : '—'}
        </Row>
        <Row label="Idempotency key">
          <code className="rounded bg-surface-warm px-1 py-0.5">{view.idempotencyKey}</code> <span className="text-xs text-ink-soft">(scope: {view.idempotencyScope})</span>
        </Row>
      </dl>
      {view.error !== null ? (
        <div className="mt-3 rounded-lg border border-stop/30 bg-stop-soft p-3" role="alert">
          <p className="text-sm font-semibold text-ink">ASK resolution failure (typed, honest)</p>
          <p className="mt-1 text-sm text-stop">
            {view.error.code}: {view.error.detail}
          </p>
          <p className="mt-1 text-xs text-ink-soft">Nothing was fabricated — the queue is honestly empty until the ask plane lands.</p>
        </div>
      ) : null}
      <LiveReviewBlock review={review} title="What happened?" />
    </div>
  );
}

/** The full receipt page (shell + heading + the receipt card). */
export function LiveActionReceiptPage({ view, asOf, children }: { view: LiveActionReceiptViewMirror; asOf: string; children?: ReactNode }) {
  return (
    <div className="space-y-4">
      <ActionReceiptView view={view} asOf={asOf} />
      {children}
    </div>
  );
}
