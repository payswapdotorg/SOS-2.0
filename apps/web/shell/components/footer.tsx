/**
 * The sticky footer — sticks to the viewport bottom on short pages, is
 * pushed down naturally by long content, respects the safe-area inset, and
 * on mobile clears the fixed bottom navigation.
 */

import { views } from '../view-state/demo-data';

export function FooterBar() {
  return (
    <footer
      role="contentinfo"
      className="mt-auto border-t border-line bg-surface px-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 lg:px-10 lg:pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
        <p>
          SOS Console — every consequential surface answers what, why, evidence, uncertainty, authority and next.
        </p>
        <p className="font-medium text-warn">{views.source.kind === 'DEMO' ? views.source.label : 'Live data'}</p>
      </div>
    </footer>
  );
}
