/**
 * THE LIVE ACTION ENDPOINT (Work Order P18-B — MOUNTING.md integration
 * step 2): `LIVE_ACTION_ENDPOINT` = `/api/live-mission/actions`.
 *
 * The mounted action forms POST their typed envelopes here (the surface
 * never mutates state directly). This route handler is the THIN adapter:
 * it reads the ambient environment exactly ONCE per process (env-only
 * credentials; values never echoed), binds the deployed host
 * (env-configured authority — re-evaluated at action time, fail-closed;
 * real provider executors when credentials exist; the honestly-empty ask
 * queue) and delegates to the endpoint core (validation, deterministic
 * envelope completion, the merged ActionGateway execution, ASK
 * resolution, typed receipts).
 *
 * Responses (honest):
 *   - a browser form POST (Accept: text/html) -> 303 See Other to the
 *     server-rendered receipt page /mission/receipt?key=<idempotencyKey>
 *     (POST-redirect-GET; the receipt renders inside the app shell with
 *     its evidence and rationale links — no client fetches anywhere);
 *   - a programmatic submission (Accept: application/json) -> the typed
 *     receipt as JSON (machine-checkable; the real-integration suite
 *     consumes this);
 *   - malformed submissions -> 400 with the typed rejection.
 */

import { compactReceiptForCookie, receiptUrlFor, submitLiveAction } from './live-action-core';
import type { LiveActionReceiptView } from './live-action-core';
import { deployedHostConfigFromEnv, ensureDeployedHost } from './deployed-host';

export const dynamic = 'force-dynamic'; // live actions — never cached

/** The process boundary: the ambient environment is read HERE (once per process; env-only). */
function ambientSource(): Record<string, string | undefined> {
  const source: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      source[key] = value;
    }
  }
  return source;
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? 'application/x-www-form-urlencoded';
  const accept = (request.headers.get('accept') ?? 'text/html').toLowerCase();
  const body = await request.text();
  const now = Date.now(); // the process boundary's injected clock for this submission
  // the host is bound once per process; its gateway clock keeps reading the
  // REAL boundary time on every evaluation (authority/executedAt stay honest):
  const deployed = ensureDeployedHost(deployedHostConfigFromEnv(ambientSource()), { clock: { now: (): number => Date.now() } });
  const result = submitLiveAction({ body, contentType, host: deployed.host, now });

  const receiptPageUrl = receiptUrlFor(result.view);
  if (accept.includes('application/json')) {
    const payload: { receipt: LiveActionReceiptView; receiptPageUrl: string | null } = {
      receipt: result.view,
      receiptPageUrl,
    };
    return Response.json(payload, {
      status: result.httpStatus,
      headers: { 'cache-control': 'no-store' },
    });
  }
  if (receiptPageUrl !== null) {
    // the browser PRG hop: the receipt page renders inside the app shell.
    // The receipt also round-trips through a server-minted, key-validated
    // cookie so the page renders on ANY serverless instance (the in-process
    // ledger alone is instance-local — the honest multi-instance reality).
    const compact = compactReceiptForCookie(result.view);
    const headers: Record<string, string> = { location: receiptPageUrl, 'cache-control': 'no-store' };
    if (compact !== null) {
      headers['set-cookie'] = `live-action-receipt=${encodeURIComponent(compact)}; Path=/mission/receipt; HttpOnly; SameSite=Lax; Max-Age=600`;
    }
    return new Response(null, { status: 303, headers });
  }
  // malformed submissions have no idempotency key to key a receipt page —
  // answer with the typed rejection as a JSON body (the honest 400).
  return Response.json({ receipt: result.view, receiptPageUrl: null }, {
    status: result.httpStatus,
    headers: { 'cache-control': 'no-store' },
  });
}
