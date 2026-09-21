/**
 * The card shell — every consequential card carries its title, an optional
 * status chip, the DEMO badge when fixture-backed, and a rationale
 * deep-link ("Why?") when the card answers for a spine subject.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { DemoBadge } from './demo-badge';

export function Card({
  id,
  title,
  chip,
  demoRevision,
  rationaleHref,
  children,
  className,
}: {
  id: string;
  title: string;
  chip?: ReactNode;
  /** The fixture revision — presence of this prop renders the DEMO badge. */
  demoRevision?: string;
  /** The rationale deep-link route (rendered as the "Why?" link). */
  rationaleHref?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className={`rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6 ${className ?? ''}`}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id={`${id}-heading`} className="text-base font-semibold text-ink sm:text-lg">
          {title}
        </h2>
        {chip}
        {demoRevision !== undefined ? <DemoBadge revision={demoRevision} /> : null}
        {rationaleHref !== undefined ? (
          <Link
            href={rationaleHref}
            className="ml-auto inline-flex min-h-[44px] items-center gap-1 rounded-md px-2 text-sm font-medium text-epistemic underline-offset-2 hover:underline"
          >
            Why?
            <span className="sr-only">{` — the reasoning behind ${title}`}</span>
          </Link>
        ) : null}
      </header>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A compact description list row (label + value), used inside cards. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-1.5 sm:grid-cols-[10rem_1fr] sm:gap-3">
      <dt className="text-sm font-medium text-ink-soft">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}
