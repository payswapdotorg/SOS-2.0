/**
 * Semantic chips — the design system's restrained status colors WITH a
 * glyph and a label on every chip (color is never the only semantic
 * channel). The separate epistemic treatment (dashed outline + question
 * glyph) covers UNKNOWN / UNAVAILABLE.
 */

import type { ProductCondition, WebStateBlockKind, WebStatusTone } from '@sos-2/web-contracts';
import { evidenceTruthStateLabel, evidenceTruthStateTone, productConditionLabel, productConditionTone, stateBlockLabel, stateBlockTone } from '@sos-2/web-contracts';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';

/** The tone classes (background, border, text) per status tone. */
const TONE_CLASSES: Record<WebStatusTone, string> = {
  POSITIVE: 'bg-ok-soft text-ok border-ok/30',
  CAUTION: 'bg-warn-soft text-warn border-warn/30',
  NEGATIVE: 'bg-stop-soft text-stop border-stop/30',
  NEUTRAL: 'bg-surface-warm text-ink-soft border-line-strong',
  EPISTEMIC: 'bg-epistemic-soft text-epistemic border-epistemic/40 border-dashed',
};

/** The glyph color per tone (the glyph mirrors the tone, never replaces the label). */
function Glyph({ tone }: { tone: WebStatusTone }) {
  switch (tone) {
    case 'POSITIVE':
      return (
        <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0" fill="currentColor">
          <circle cx="6" cy="6" r="4.5" />
        </svg>
      );
    case 'CAUTION':
      return (
        <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0" fill="currentColor">
          <path d="M6 1.5 11 10.5H1Z" />
        </svg>
      );
    case 'NEGATIVE':
      return (
        <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0" fill="currentColor">
          <rect x="2" y="2" width="8" height="8" rx="1" />
        </svg>
      );
    case 'NEUTRAL':
      return (
        <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0" fill="currentColor">
          <rect x="2" y="5" width="8" height="2" rx="1" />
        </svg>
      );
    case 'EPISTEMIC':
      return (
        <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.5 2">
          <circle cx="6" cy="6" r="4.5" />
        </svg>
      );
  }
}

function Chip({ tone, children, title }: { tone: WebStatusTone; children: React.ReactNode; title?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
      title={title}
    >
      <Glyph tone={tone} />
      {children}
    </span>
  );
}

/** A product-condition chip (mission outcome health, system condition). */
export function ConditionChip({ condition, basis }: { condition: ProductCondition; basis?: string }) {
  return (
    <Chip tone={productConditionTone(condition)} title={basis}>
      <span className="sr-only">Status: </span>
      {productConditionLabel(condition)}
    </Chip>
  );
}

/** An evidence truth-state chip — the frozen vocabulary displayed verbatim, distinctly. */
export function TruthStateChip({ state }: { state: EvidenceTruthState }) {
  return (
    <Chip tone={evidenceTruthStateTone(state)}>
      <span className="sr-only">Truth state: </span>
      {evidenceTruthStateLabel(state)}
    </Chip>
  );
}

/** A state-block kind chip (state blocks carry their own named kind). */
export function StateKindChip({ kind }: { kind: WebStateBlockKind }) {
  return (
    <Chip tone={stateBlockTone(kind)}>
      <span className="sr-only">State: </span>
      {stateBlockLabel(kind)}
    </Chip>
  );
}

/** A small labelled value chip (measurements, revisions, phases). */
export function ValueChip({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-ink-soft"
      title={title}
    >
      <span className="font-medium text-ink">{label}:</span> {value}
    </span>
  );
}
