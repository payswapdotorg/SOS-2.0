/**
 * The DEMO badge — rendered on EVERY fixture-backed surface. The exact
 * marker text is part of the @sos-2/web-contracts contract
 * (DEMO_MARKER_TEXT): demo fixture state can never render as live state.
 */

import { DEMO_MARKER_TEXT } from '@sos-2/web-contracts';

export function DemoBadge({ revision, note }: { revision?: string; note?: string }) {
  const title = [
    note ?? 'This surface renders a fixed, simulated dataset.',
    revision ? `Fixture revision: ${revision}` : null,
  ]
    .filter(Boolean)
    .join(' — ');
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-warn/50 bg-warn-soft px-2 py-0.5 text-[11px] font-semibold tracking-wide text-warn"
      title={title}
      data-demo-badge="true"
    >
      <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M6 1v6" />
        <circle cx="6" cy="9.5" r="0.9" fill="currentColor" stroke="none" />
      </svg>
      {DEMO_MARKER_TEXT}
    </span>
  );
}
