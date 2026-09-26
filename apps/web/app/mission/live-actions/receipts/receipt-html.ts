/**
 * THE ACTION RECEIPT HTML (Work Order P18-B — the receipt rendering
 * wiring): the standalone, self-contained HTML document the
 * /api/live-mission/actions endpoint answers browser form POSTs with.
 *
 * WHY A STRING DOCUMENT: Next.js 16 forbids react-dom/server in route
 * handlers ("render or return the content directly as a Server Component
 * instead"), and the browser form flow needs the receipt IN the POST
 * response (a redirect would depend on cross-instance state — the stores
 * are honestly process-local). The document is therefore built as an
 * escaped HTML string, carrying the same warm-light design language as
 * the console (the shell's design tokens, inlined), the same a11y
 * standards (skip link, landmarks, 44px touch targets, color never the
 * only semantic channel), and the same honesty rules:
 *
 *   - the TYPED RECEIPT verbatim (status, family, identity, revisions,
 *     evidence ids) with the evidence/rationale deep-links;
 *   - the six product review questions projected from the outcome;
 *   - the SAFE-FAILURE UX for DENIED actions (nothing was changed + the
 *     exact authority reason) and FAILED actions (the typed failure);
 *   - the REAL EXECUTION record (provider states with the honest
 *     four-state machine, the HTTP transcript method+path+status, the
 *     provider facts);
 *   - the honest scope limitations (process-local stores — never a fake
 *     durable confirmation);
 *   - a machine-checkable JSON data island with the EXACT typed receipt.
 *
 * Every interpolated value is HTML-escaped (one escape function, applied
 * everywhere — the receipt renders user-supplied notes and provider
 * messages).
 */

import type { LiveActionEndpointResponse } from '../submission';
import { receiptReview, receiptStatusLabel, receiptStatusTone, outcomeHeadline, executionRows } from '../receipt-view';
import type { ReceiptTone } from '../receipt-view';

/** HTML-escape a value for text content and attribute contexts (one escape, applied everywhere). */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Escape a value for embedding inside a JSON <script> data island (never a </script> breakout). */
function escapeJsonIsland(value: string): string {
  return value.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const TOKENS_STYLE = `
  :root {
    --paper: #faf8f3; --surface: #ffffff; --surface-warm: #f4f0e8;
    --ink: #2b2620; --ink-soft: #6f675c; --line: #e8e1d4; --line-strong: #d8cebb;
    --ok: #1f7a4d; --ok-soft: #e6f2eb; --warn: #94660e; --warn-soft: #f9efdb;
    --stop: #a23429; --stop-soft: #f9e8e5; --epistemic: #5d5871; --epistemic-soft: #efeef5;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; line-height: 1.55; }
  a { color: inherit; }
  .wrap { max-width: 60rem; margin: 0 auto; padding: 1rem 1rem 3rem; }
  .skip { position: absolute; left: -9999px; }
  .skip:focus { left: 0.75rem; top: 0.75rem; z-index: 10; background: var(--ink); color: var(--paper); padding: 0.5rem 1rem; border-radius: 0.375rem; }
  header.page { border-bottom: 1px solid var(--line); padding: 1rem 0; display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
  header.page .title { font-size: 1.05rem; font-weight: 600; }
  nav.links { margin-left: auto; display: flex; flex-wrap: wrap; gap: 0.5rem; }
  nav.links a, a.action-link { min-height: 44px; display: inline-flex; align-items: center; border: 1px solid var(--line-strong); border-radius: 0.375rem; padding: 0.5rem 0.9rem; font-size: 0.85rem; text-decoration: none; background: var(--surface); }
  nav.links a:hover, a.action-link:hover { background: var(--surface-warm); }
  h1 { font-size: 1.4rem; line-height: 1.25; margin: 1.25rem 0 0.25rem; display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; }
  p.intro { color: var(--ink-soft); margin: 0.25rem 0 1.25rem; font-size: 0.95rem; }
  section.card { background: var(--surface); border: 1px solid var(--line); border-radius: 0.75rem; padding: 1.25rem; margin: 1rem 0; box-shadow: 0 1px 2px rgba(43,38,32,0.04); }
  section.card > h2 { font-size: 1rem; margin: 0 0 0.5rem; }
  dl.rows { margin: 0; display: grid; gap: 0.4rem; }
  dl.rows > div { display: grid; grid-template-columns: 11rem 1fr; gap: 0.75rem; }
  @media (max-width: 640px) { dl.rows > div { grid-template-columns: 1fr; gap: 0.1rem; } }
  dl.rows dt { color: var(--ink-soft); font-size: 0.85rem; }
  dl.rows dd { margin: 0; font-size: 0.9rem; word-break: break-all; }
  .chip { display: inline-flex; align-items: center; gap: 0.35rem; border-radius: 999px; border-width: 1px; border-style: solid; padding: 0.15rem 0.6rem; font-size: 0.75rem; font-weight: 500; }
  .chip.positive { background: var(--ok-soft); color: var(--ok); border-color: rgba(31,122,77,0.3); }
  .chip.negative { background: var(--stop-soft); color: var(--stop); border-color: rgba(162,52,41,0.3); }
  .chip.caution { background: var(--warn-soft); color: var(--warn); border-color: rgba(148,102,14,0.3); }
  .chip.epistemic { background: var(--epistemic-soft); color: var(--epistemic); border-color: rgba(93,88,113,0.4); border-style: dashed; }
  .safefailure { border: 1px solid rgba(162,52,41,0.3); background: var(--stop-soft); border-radius: 0.75rem; padding: 1rem 1.25rem; margin: 1rem 0; }
  .safefailure strong { color: var(--stop); }
  .typedfailure { border: 1px solid rgba(148,102,14,0.3); background: var(--warn-soft); border-radius: 0.75rem; padding: 1rem 1.25rem; margin: 1rem 0; }
  .typedfailure strong { color: var(--warn); }
  .scope { border: 1px dashed rgba(93,88,113,0.4); background: var(--epistemic-soft); border-radius: 0.75rem; padding: 1rem 1.25rem; margin: 1rem 0; font-size: 0.88rem; }
  .questions { background: var(--surface-warm); border: 1px solid var(--line); border-radius: 0.75rem; padding: 1rem 1.25rem; margin: 1rem 0; }
  .questions p { margin: 0.2rem 0 0.6rem; font-size: 0.9rem; }
  .questions p.q { font-weight: 600; margin-top: 0.6rem; }
  ul.plain { margin: 0.25rem 0; padding-left: 1.1rem; font-size: 0.9rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.82rem; background: var(--surface-warm); border-radius: 0.25rem; padding: 0.05rem 0.3rem; word-break: break-all; }
  footer.page { border-top: 1px solid var(--line); margin-top: 2rem; padding-top: 1rem; color: var(--ink-soft); font-size: 0.8rem; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

/** Map the view tone to the chip class (POSITIVE → positive, …). */
function toneClass(tone: ReceiptTone | 'positive' | 'negative' | 'caution' | 'epistemic'): 'positive' | 'negative' | 'caution' | 'epistemic' {
  const lowered = tone.toLowerCase() as 'positive' | 'negative' | 'caution' | 'epistemic';
  return lowered === 'positive' || lowered === 'negative' || lowered === 'caution' || lowered === 'epistemic' ? lowered : 'epistemic';
}

function chip(tone: 'positive' | 'negative' | 'caution' | 'epistemic' | ReceiptTone, label: string): string {
  const cls = toneClass(tone);
  const glyph = cls === 'positive' ? '●' : cls === 'negative' ? '■' : cls === 'caution' ? '▲' : '◌';
  return `<span class="chip ${cls}"><span class="visually-hidden">status: </span><span aria-hidden="true">${glyph}</span>${escapeHtml(label)}</span>`;
}

function rows(entries: readonly { readonly label: string; readonly value: string }[]): string {
  return `<dl class="rows">${entries
    .map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd>${row.value}</dd></div>`)
    .join('')}</dl>`;
}

function list(items: readonly string[]): string {
  return `<ul class="plain">${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

/** Build the standalone receipt document for one typed endpoint outcome. */
export function renderActionReceiptHtml(outcome: LiveActionEndpointResponse): string {
  const review = receiptReview(outcome);
  const isAction = outcome.kind === 'executed' || outcome.kind === 'replayed';
  const receipt = isAction ? outcome.receipt : null;
  const tone = receipt !== null ? receiptStatusTone(receipt.status) : outcome.kind === 'ask-resolved' ? 'positive' : 'negative';
  const statusChip = isAction ? chip(tone, receiptStatusLabel(receipt?.status ?? '')) : chip(tone, outcome.kind);
  const execution = executionRows(isAction ? outcome.execution : null);
  const title = `Action receipt — ${isAction ? (receipt?.status ?? '') : outcome.kind}`;

  const receiptRows: { label: string; value: string }[] = [];
  if (receipt !== null) {
    receiptRows.push(
      { label: 'Status', value: chip(receiptStatusTone(receipt.status), receiptStatusLabel(receipt.status)) },
      { label: 'Family', value: `<code>${escapeHtml(receipt.family)}</code>` },
      { label: 'Action id', value: `<code>${escapeHtml(receipt.actionId)}</code>` },
      { label: 'Idempotency key', value: `<code>${escapeHtml(receipt.idempotencyKey)}</code>` },
      { label: 'Actor', value: `<code>${escapeHtml(`${receipt.actor.kind}:${receipt.actor.id}`)}</code>` },
      { label: 'Source revision', value: `<code>${escapeHtml(receipt.sourceRevision)}</code>` },
      { label: 'Deployment revision', value: receipt.deploymentRevision !== null ? `<code>${escapeHtml(receipt.deploymentRevision)}</code>` : '—' },
      { label: 'Executed at', value: escapeHtml(new Date(receipt.executedAt).toISOString()) },
      {
        label: 'Evidence ids',
        value: receipt.evidenceIds.length > 0 ? list(receipt.evidenceIds.map((id) => `<code>${escapeHtml(id)}</code>`)) : '—',
      },
      {
        label: 'Rollback verification',
        value:
          receipt.rollbackVerification !== null
            ? `${escapeHtml(receipt.rollbackVerification.verdict)} (observed ${escapeHtml(receipt.rollbackVerification.observedSourceSha ?? 'nothing')}${
                receipt.rollbackVerification.limitation !== null ? ` — ${escapeHtml(receipt.rollbackVerification.limitation)}` : ''
              })`
            : '—',
      },
    );
  }

  const askRows: { label: string; value: string }[] =
    outcome.kind === 'ask-resolved'
      ? [
          { label: 'Entry id', value: `<code>${escapeHtml(outcome.resolution.entryId)}</code>` },
          { label: 'Decision record', value: `<code>${escapeHtml(outcome.resolution.decisionRef)}</code>` },
          { label: 'Action', value: `<code>${escapeHtml(outcome.resolution.action)}</code>` },
          { label: 'Resolved by', value: `<code>${escapeHtml(outcome.resolution.resolvedBy)}</code>` },
          { label: 'Chosen alternative', value: `<code>${escapeHtml(outcome.resolution.chosenAlternativeId)}</code>` },
          { label: 'Note', value: escapeHtml(outcome.resolution.note) },
          { label: 'Created at', value: escapeHtml(outcome.resolution.createdAt) },
          { label: 'Provenance', value: outcome.resolution.provenance.map((entry) => `<code>${escapeHtml(entry)}</code>`).join(' ') },
          { label: 'Queue', value: `${escapeHtml(String(outcome.resolution.queue.pending))} pending of ${escapeHtml(String(outcome.resolution.queue.total))}` },
        ]
      : [];

  const typedErrorRows: { label: string; value: string }[] =
    outcome.kind === 'rejected'
      ? [
          { label: 'Code', value: `<code>${escapeHtml(outcome.rejection.code)}</code>` },
          { label: 'Field', value: `<code>${escapeHtml(outcome.rejection.field === '' ? '(the envelope)' : outcome.rejection.field)}</code>` },
          { label: 'Detail', value: escapeHtml(outcome.rejection.detail) },
        ]
      : outcome.kind === 'ask-failed' || outcome.kind === 'endpoint-error'
        ? [
            { label: 'Code', value: `<code>${escapeHtml(outcome.error.code)}</code>` },
            { label: 'Message', value: escapeHtml(outcome.error.message) },
          ]
        : [];

  const deniedBlock =
    receipt?.status === 'DENIED'
      ? `<div class="safefailure" role="note" data-receipt-denied="true"><strong>Nothing was changed.</strong> The action was DENIED — authority failed closed, the executor was never invoked, and no state was mutated. The exact authority reason: <code>${escapeHtml(
          receipt.denial?.authority?.reason ?? 'unknown',
        )}</code> — ${escapeHtml(receipt.denial?.detail ?? 'no detail recorded')}.</div>`
      : '';
  const failedBlock =
    receipt?.status === 'FAILED'
      ? `<div class="typedfailure" role="note" data-receipt-failed="true"><strong>A typed failure, honestly recorded.</strong> ${escapeHtml(
          receipt.failure?.errorType ?? 'UNKNOWN',
        )} at ${escapeHtml(receipt.failure?.operation ?? 'unknown')} — ${escapeHtml(receipt.failure?.message ?? '')} (${receipt.failure?.retryable === true ? 'retryable' : 'not retryable'}).</div>`
      : '';

  const executionSection =
    isAction && outcome.execution !== null
      ? `<section class="card" aria-labelledby="execution-heading">
        <h2 id="execution-heading">The real execution (provider facts)</h2>
        <p>Mode: ${chip(execution.mode === 'real' ? 'positive' : 'epistemic', execution.mode === 'real' ? 'REAL providers' : 'REFERENCE mode')}</p>
        ${execution.providers.length > 0 ? list(execution.providers.map((provider) => `<strong>${escapeHtml(provider.label)}</strong> — ${chip(provider.state === 'CONNECTED' ? 'positive' : provider.state === 'UNAVAILABLE' ? 'negative' : 'epistemic', provider.state)} ${escapeHtml(provider.detail)}${provider.lastError !== null ? ` (last error: ${escapeHtml(provider.lastError)})` : ''}`)) : ''}
        ${execution.requests.length > 0 ? `<p class="q">HTTP transcript (method + path + status — never credentials)</p>${list(execution.requests.map((request) => `<code>${escapeHtml(`${request.label} → ${String(request.status)}`)}</code>`))}` : ''}
        ${execution.facts.length > 0 ? `<p class="q">The real facts this receipt is bound to</p>${rows(execution.facts.map((fact) => ({ label: fact.label, value: `<code>${escapeHtml(fact.value)}</code>` })))}` : ''}
      </section>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${TOKENS_STYLE}</style>
</head>
<body>
<a class="skip" href="#main-content">Skip to the receipt</a>
<div class="wrap">
<header class="page">
  <span class="title">SOS Console — action receipt</span>
  <nav class="links" aria-label="Receipt navigation">
    <a href="/mission">Back to Mission</a>
    <a href="/evidence">Evidence</a>
    <a href="/rationale">Rationale</a>
  </nav>
</header>
<main id="main-content" tabindex="-1">
  <h1>${escapeHtml(outcomeHeadline(outcome))} ${statusChip}</h1>
  <p class="intro">This receipt is the typed answer of the live action endpoint <code>/api/live-mission/actions</code>: the action went through the merged authority-gated gateway — authority was re-evaluated at action time, and the outcome below is evidence-bound.</p>
  ${deniedBlock}
  ${failedBlock}
  ${receiptRows.length > 0 ? `<section class="card" aria-labelledby="receipt-details-heading"><h2 id="receipt-details-heading">The typed receipt</h2>${rows(receiptRows)}<p><a class="action-link" href="/evidence">Open the evidence surface (the six truth states)</a> <a class="action-link" href="/rationale">Open the rationale surface</a></p></section>` : ''}
  ${askRows.length > 0 ? `<section class="card" aria-labelledby="ask-receipt-heading"><h2 id="ask-receipt-heading">The ask resolution receipt</h2>${rows(askRows)}</section>` : ''}
  ${typedErrorRows.length > 0 ? `<section class="card" aria-labelledby="typed-error-heading"><h2 id="typed-error-heading">The typed failure</h2>${rows(typedErrorRows)}</section>` : ''}
  <section class="questions" aria-label="Product review questions">
    <p class="q">What happened?</p><p>${escapeHtml(review.what)}</p>
    <p class="q">Why does SOS believe this?</p><p>${escapeHtml(review.why)}</p>
    <p class="q">What evidence supports it?</p><p>${escapeHtml(review.evidence.length > 0 ? review.evidence.join(', ') : 'No evidence ids on this outcome (rejected before execution).')}</p>
    <p class="q">What uncertainty remains?</p><p>${escapeHtml(review.uncertainty)}</p>
    <p class="q">What authority was required?</p><p>${escapeHtml(review.authority)}</p>
    <p class="q">What can happen next?</p><p>${escapeHtml(review.next)}</p>
  </section>
  ${executionSection}
  <div class="scope" role="note" data-receipt-scope="true"><strong>Honest scope.</strong> ${escapeHtml(
    (isAction ? outcome.limitations : [review.uncertainty]).join(' '),
  )} Never a fabricated durable confirmation.</div>
  <script type="application/json" id="action-receipt" data-action-receipt="true">${escapeJsonIsland(JSON.stringify(outcome))}</script>
</main>
<footer class="page">
  <p>The live action endpoint answers every typed submission with a typed receipt — authority is re-evaluated at action time and fails closed. Live state is labelled LIVE; reference state is labelled REFERENCE; absence of information is never health.</p>
</footer>
</div>
</body>
</html>`;
}
