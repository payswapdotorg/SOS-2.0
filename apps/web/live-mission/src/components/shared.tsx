/**
 * The live-mission shared surface pieces (Work Order P17-C): the honest
 * source-state chip, the LIVE badge, the six-question review block and
 * the authority-gate note — composing the P1 shell primitives and the
 * P1/P4 a11y standards. Every piece is a pure server component.
 */

import type { ReactNode } from 'react';
import { Card } from '../../../shell/components/card';

/** The honest four-state chip (color + glyph + label — color is never the only channel). */
export function SourceStateChip({ state }: { state: 'CONNECTED' | 'UNKNOWN' | 'UNAVAILABLE' | 'DEGRADED' }) {
  const tone =
    state === 'CONNECTED'
      ? 'bg-ok-soft text-ok border-ok/30'
      : state === 'DEGRADED'
        ? 'bg-warn-soft text-warn border-warn/30'
        : state === 'UNAVAILABLE'
          ? 'bg-stop-soft text-stop border-stop/30'
          : 'border-dashed border-epistemic/40 bg-epistemic-soft text-epistemic';
  const glyph =
    state === 'CONNECTED' ? (
      <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0" fill="currentColor">
        <circle cx="6" cy="6" r="4.5" />
      </svg>
    ) : state === 'DEGRADED' ? (
      <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0" fill="currentColor">
        <path d="M6 1.5 11 10.5H1Z" />
      </svg>
    ) : state === 'UNAVAILABLE' ? (
      <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0" fill="currentColor">
        <rect x="2" y="2" width="8" height="8" rx="1" />
      </svg>
    ) : (
      <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.5 2">
        <circle cx="6" cy="6" r="4.5" />
      </svg>
    );
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      {glyph}
      <span className="sr-only">Source state: </span>
      {state}
    </span>
  );
}

/** The LIVE provenance badge (the counterpart of the shell's DEMO badge — live state is labelled LIVE, fixture state DEMO, never mixed). */
export function LiveBadge({ storeRef, asOf }: { storeRef: string; asOf: string }) {
  return (
    <span
      data-live-badge="true"
      className="inline-flex items-center gap-1.5 rounded-full border border-ok/30 bg-ok-soft px-2.5 py-0.5 text-xs font-medium text-ok"
      title={`Read from the durable store ${storeRef} as of ${asOf}`}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0" fill="currentColor">
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="6" cy="6" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      LIVE
    </span>
  );
}

/** The six product review questions block (ARCHITECT_START_HERE: the user journey must always answer them). */
export function LiveReviewBlock({ review, title = 'What is happening?' }: { review: { what: string; why: string; evidence: readonly string[]; uncertainty: string; authority: string; next: string }; title?: string }) {
  return (
    <div className="mt-4 space-y-2 rounded-lg border border-line bg-surface-warm p-4 text-sm" aria-label="Product review questions">
      <p className="font-semibold text-ink">{title}</p>
      <p className="text-ink-soft">{review.what}</p>
      <p className="font-semibold text-ink">Why does SOS believe this?</p>
      <p className="text-ink-soft">{review.why}</p>
      <p className="font-semibold text-ink">What evidence supports it?</p>
      <p className="text-ink-soft">
        {review.evidence.length > 0 ? review.evidence.join(', ') : 'No evidence event ids bound to this surface yet — honestly empty, never fabricated.'}
      </p>
      <p className="font-semibold text-ink">What uncertainty remains?</p>
      <p className="text-ink-soft">{review.uncertainty}</p>
      <p className="font-semibold text-ink">What authority is required?</p>
      <p className="text-ink-soft">{review.authority}</p>
      <p className="font-semibold text-ink">What can happen next?</p>
      <p className="text-ink-soft">{review.next}</p>
    </div>
  );
}

/** The authority-gate note shown beside every consequential action form. */
export function AuthorityGateNote({ requiredGrant, family }: { requiredGrant: string; family: string }) {
  return (
    <p className="mt-2 text-xs text-ink-soft">
      <span className="sr-only">Authority gate: </span>
      Authority-gated: the {family} action re-evaluates the CURRENT grant <code className="rounded bg-surface px-1 py-0.5">{requiredGrant}</code> at action time through
      the merged action gateway — a revoked, expired or never-held grant fails CLOSED and the executor is never invoked. This form never carries authority of its own.
    </p>
  );
}

/** The watching-vs-body separation note (user journey 14: continuous monitoring without a body). */
export function WatchingNote({ watchingWithoutBody }: { watchingWithoutBody: boolean }) {
  return (
    <p className="mt-3 text-xs text-ink-soft" data-watching-without-body={watchingWithoutBody ? 'true' : 'false'}>
      SOS is watching — observation is continuous and does not use a working body; a body is summoned only when active inspection or change is required
      {watchingWithoutBody ? ' (no body lease is active right now).' : ' (a body lease is active — shown separately, never merged with watching).'}
    </p>
  );
}

/** A live card with the LIVE badge (instead of the DEMO badge). */
export function LiveCard({ id, title, storeRef, asOf, children, chip }: { id: string; title: string; storeRef: string; asOf: string; children: ReactNode; chip?: ReactNode }) {
  return (
    <Card id={id} title={title} chip={chip}>
      <div className="-mt-2 mb-2 flex flex-wrap items-center gap-2">
        <LiveBadge storeRef={storeRef} asOf={asOf} />
      </div>
      {children}
    </Card>
  );
}
