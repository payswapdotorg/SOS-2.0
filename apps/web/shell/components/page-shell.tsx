/**
 * The page shell — composes the desktop rail, the mobile header, the main
 * landmark and the sticky footer for every page. The active section is
 * passed by the page (fully server-rendered navigation state).
 *
 * Footer behavior (platform conventions): the footer sticks to the bottom
 * of the viewport when content is short (flex column + mt-auto) and is
 * pushed down naturally when content is long; on mobile it clears the
 * bottom navigation and respects the safe-area inset.
 */

import type { ReactNode } from 'react';
import type { ShellSectionId } from '@sos-2/web-contracts';
import { MobileHeader, MobileTabBar, NavRail } from './nav';
import { FooterBar } from './footer';

export function PageShell({ section, children }: { section: ShellSectionId; children: ReactNode }) {
  return (
    <div className="min-h-screen lg:pl-64">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-paper"
      >
        Skip to main content
      </a>
      <NavRail active={section} />
      <div className="flex min-h-screen flex-col">
        <MobileHeader active={section} />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-5xl flex-1 px-4 pb-20 pt-6 sm:px-6 lg:px-10 lg:pb-12"
        >
          {children}
        </main>
        <FooterBar />
      </div>
      <MobileTabBar active={section} />
    </div>
  );
}

/** The page heading block (h1 + intro) used by every page. */
export function PageHeading({ title, intro, demoRevision }: { title: string; intro: string; demoRevision?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-soft sm:text-base">{intro}</p>
      {demoRevision !== undefined ? (
        <p className="mt-2 text-xs text-ink-soft">
          Fixture revision <code className="rounded bg-surface-warm px-1 py-0.5">{demoRevision}</code>
        </p>
      ) : null}
    </div>
  );
}
