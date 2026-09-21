/**
 * The named state-block view — renders one of the six first-class states
 * (loading / empty / unknown / unavailable / partial / error) as a visible,
 * nameable block. A page never shows a blank hole: absence, uncertainty and
 * failure are information, rendered with their honest next step.
 */

import type { StateBlock, WebStateBlockKind } from '@sos-2/web-contracts';
import { stateBlockLabel, stateBlockTone } from '@sos-2/web-contracts';

const BLOCK_TONE_CLASSES: Record<string, string> = {
  POSITIVE: 'border-ok/30 bg-ok-soft',
  CAUTION: 'border-warn/30 bg-warn-soft',
  NEGATIVE: 'border-stop/30 bg-stop-soft',
  NEUTRAL: 'border-line-strong bg-surface-warm',
  EPISTEMIC: 'border-epistemic/40 bg-epistemic-soft border-dashed',
};

const BLOCK_TEXT_CLASSES: Record<string, string> = {
  POSITIVE: 'text-ok',
  CAUTION: 'text-warn',
  NEGATIVE: 'text-stop',
  NEUTRAL: 'text-ink-soft',
  EPISTEMIC: 'text-epistemic',
};

/** Render a named state block (deterministic, semantic HTML). */
export function StateBlockView({ block }: { block: StateBlock }) {
  const tone = stateBlockTone(block.kind as WebStateBlockKind);
  return (
    <section
      aria-label={`${stateBlockLabel(block.kind)}: ${block.surface}`}
      data-state-block={block.kind}
      data-surface={block.surface}
      className={`rounded-xl border p-4 sm:p-5 ${BLOCK_TONE_CLASSES[tone] ?? BLOCK_TONE_CLASSES['NEUTRAL']!}`}
    >
      <p className={`flex items-center gap-2 text-sm font-semibold ${BLOCK_TEXT_CLASSES[tone] ?? 'text-ink-soft'}`}>
        {stateBlockLabel(block.kind)}
        <span className="sr-only">{` (surface: ${block.surface})`}</span>
      </p>
      <p className="mt-1 text-sm text-ink">{block.statement}</p>
      {block.kind === 'PARTIAL' && block.present !== null && block.missing !== null ? (
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="font-medium text-ink">Present</p>
            <ul className="mt-1 list-inside list-disc text-ink-soft">
              {block.present.map((part) => (
                <li key={part}>{part}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium text-ink">Missing</p>
            <ul className="mt-1 list-inside list-disc text-ink-soft">
              {block.missing.map((part) => (
                <li key={part}>{part}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {block.action !== null ? <p className="mt-3 text-sm text-ink-soft">Next: {block.action}</p> : null}
    </section>
  );
}
