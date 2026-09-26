/**
 * The action receipt page (Work Order P18-B): the POST-redirect-GET target
 * for consequential actions submitted to /api/live-mission/actions.
 *
 * The endpoint executes the action through the merged gateway and records
 * the typed receipt into the IN-PROCESS receipt ledger (idempotencyKey ->
 * receipt view); this page reads that ledger and renders the receipt
 * server-side inside the app shell — status, the authority decision
 * re-evaluated at action time, the evidence ids and their links, the
 * idempotency scope (in-process; no durable confirmation is claimed), the
 * safe-failure / denied-action UX and the rationale block.
 *
 * Honest scope: when the key is unknown in THIS process (a cold serverless
 * instance, or a stale link), the page says exactly that — the receipt is
 * not fabricated from the key alone.
 */

import { cookies } from 'next/headers';
import { PageShell, PageHeading } from '../../../shell/components/page-shell';
import { LiveActionReceiptPage } from '../../../live-mission/src/components/action-receipt-view';
import type { LiveActionReceiptViewMirror } from '../../../live-mission/src/components/action-receipt-view';
import { getActiveReceiptLedger } from '../../api/live-mission/actions/deployed-host';
import { parseReceiptCookie } from '../../api/live-mission/actions/live-action-core';
import type { LiveActionReceiptView } from '../../api/live-mission/actions/live-action-core';

export const metadata = { title: 'Action receipt — Mission' };
export const dynamic = 'force-dynamic'; // the receipt ledger is live in-process state

export default async function Page({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  const params = await searchParams;
  const key = typeof params.key === 'string' ? params.key : '';
  const ledger = getActiveReceiptLedger();
  let view: LiveActionReceiptView | undefined = key.length > 0 && ledger !== null ? ledger.get(key) : undefined;
  let source = 'in-process ledger';
  if (view === undefined && key.length > 0) {
    // The cross-instance PRG hop: the submission's own receipt round-trips
    // through a server-minted cookie, key-validated here (never an
    // injection surface: the cookie's idempotency key must match the URL).
    let raw: string | undefined;
    try {
      const store = await cookies(); // outside a Next request scope (tests) this throws — degrade honestly
      raw = store.get('live-action-receipt')?.value;
    } catch {
      raw = undefined;
    }
    if (raw !== undefined) {
      const parsed = parseReceiptCookie(raw, key);
      if (parsed !== null) {
        view = parsed;
        source = 'the submission receipt round-trip (key-validated)';
      }
    }
  }

  return (
    <PageShell section="mission">
      <PageHeading
        title="Action receipt"
        intro="The typed receipt for a consequential action: what executed, the authority decision re-evaluated at action time, the evidence binding and the idempotency scope — honestly, never fabricated."
      />
      {view === undefined ? (
        <div className="rounded-xl border border-epistemic/40 bg-epistemic-soft p-5" role="note">
          <h2 className="text-base font-semibold text-ink">No receipt for this key in the current process</h2>
          <p className="mt-2 text-sm text-ink-soft">
            The receipt ledger is IN-PROCESS by design (the durable store adapters are UNAVAILABLE from this environment — no durable confirmation is claimed). A receipt key resolves in the process that executed the action, or through the submission's own key-validated receipt round-trip; this instance has neither (cold start or a followed stale link). The action outcome is not fabricated from the key alone.
          </p>
          <p className="mt-3">
            <a href="/mission" className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-surface-warm">
              Back to the live Mission surface
            </a>
          </p>
        </div>
      ) : (
        <>
          <LiveActionReceiptPage
            view={view as LiveActionReceiptViewMirror}
            asOf={
              view.kind === 'ask-resolution' && view.resolvedAt !== null
                ? view.resolvedAt
                : view.kind === 'gateway-action' && view.receipt !== null
                  ? new Date(view.receipt.executedAt).toISOString()
                  : 'at submission'
            }
          />
          <p className="text-xs text-ink-soft">Receipt source: {source}.</p>
        </>
      )}
    </PageShell>
  );
}
