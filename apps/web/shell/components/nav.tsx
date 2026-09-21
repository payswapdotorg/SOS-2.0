/**
 * The navigation system (docs/ux/sharenet-inspired-design.md):
 *
 *   Desktop: a left navigation rail — Overview, Mission, System, Changes,
 *   Evidence, Experiments, Packages, History, More — with the persistent
 *   status strip (system condition, active experiment, authority mode)
 *   docked at the rail's bottom.
 *
 *   Mobile: a compact sticky header with the wordmark, the current section
 *   and the system-condition chip, plus a bottom navigation — Overview,
 *   Changes, Evidence, ASK, More — with 44px+ touch targets and safe-area
 *   padding. Deep artifact details open as native disclosure sheets
 *   (details/summary) on the content pages.
 *
 * Fully server-rendered: the active section is passed by the page (no
 * client-side routing state), and active links carry aria-current="page".
 */

import Link from 'next/link';
import {
  desktopRailItems,
  MIN_TOUCH_TARGET_PX,
  mobileBottomNavItems,
  navItemFor,
  type ShellSectionId,
} from '@sos-2/web-contracts';
import { ConditionChip } from './chips';
import { StatusStrip } from './status-strip';
import { views } from '../view-state/demo-data';

/** An abstract geometric glyph per section (owned by this shell; nothing copied from the reference product). */
function SectionGlyph({ section }: { section: ShellSectionId }) {
  const common = 'h-4 w-4 shrink-0';
  switch (section) {
    case 'overview':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className={common} fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="6" />
          <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'mission':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className={common} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 2v8" />
          <path d="M8 13.5 5.5 9h5Z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'system':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className={common} fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
          <path d="M2.5 6h11M6 13.5V6" />
        </svg>
      );
    case 'changes':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className={common} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 4h10M3 8h7M3 12h4" />
        </svg>
      );
    case 'evidence':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className={common} fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="6.5" cy="6.5" r="4" />
          <path d="m9.5 9.5 4 4" />
        </svg>
      );
    case 'experiments':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className={common} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 12c2-6 4 4 6-2s4 2 6-4" />
        </svg>
      );
    case 'packages':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className={common} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 2 14 5v6l-6 3-6-3V5Z" />
          <path d="M2 5l6 3 6-3M8 8v6" />
        </svg>
      );
    case 'history':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className={common} fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3.5l2.5 1.5" />
        </svg>
      );
    case 'ask':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className={common} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h5A2.5 2.5 0 0 1 13 5.5v5A2.5 2.5 0 0 1 10.5 13h-5A2.5 2.5 0 0 1 3 10.5Z" />
          <path d="M6.2 6.4a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1" />
          <circle cx="8" cy="10.8" r="0.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'more':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className={common} fill="currentColor">
          <circle cx="4" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="12" cy="8" r="1.4" />
        </svg>
      );
  }
}

/** The desktop left navigation rail (fixed, with the status strip docked at the bottom). */
export function NavRail({ active }: { active: ShellSectionId }) {
  const items = desktopRailItems();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface lg:flex"
    >
      <p className="px-5 pb-2 pt-6">
        <span className="text-lg font-bold tracking-tight text-ink">SOS Console</span>
        <span className="mt-0.5 block text-xs text-ink-soft">System · Oversight · Stewardship</span>
      </p>
      <ul className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3">
        {items.map((item) => {
          const isActive = item.section === active;
          return (
            <li key={item.section}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                title={item.description}
                className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
                  isActive ? 'bg-surface-warm text-ink' : 'text-ink-soft hover:bg-surface-warm hover:text-ink'
                }`}
              >
                <span className={isActive ? 'text-ink' : 'text-ink-soft'}>
                  <SectionGlyph section={item.section} />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-line px-4 py-4">
        <StatusStrip />
      </div>
    </nav>
  );
}

/** The mobile compact header (sticky, with the system condition chip). */
export function MobileHeader({ active }: { active: ShellSectionId }) {
  const item = navItemFor(active);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur lg:hidden">
      <div className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-2">
        <p className="text-base font-bold tracking-tight text-ink">SOS Console</p>
        <div className="flex items-center gap-2">
          <ConditionChip
            condition={views.systemCondition.condition}
            basis={views.systemCondition.condition_basis}
          />
          <span className="text-sm text-ink-soft">{item.label}</span>
        </div>
      </div>
    </header>
  );
}

/** The mobile bottom navigation (44px+ touch targets, safe-area aware). */
export function MobileTabBar({ active }: { active: ShellSectionId }) {
  const items = mobileBottomNavItems();
  return (
    <nav
      aria-label="Bottom"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="flex items-stretch justify-around">
        {items.map((item) => {
          const isActive = item.section === active;
          return (
            <li key={item.section} className="flex-1">
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium ${
                  isActive ? 'text-ink' : 'text-ink-soft'
                }`}
                style={{ minHeight: `${MIN_TOUCH_TARGET_PX}px` }}
              >
                <SectionGlyph section={item.section} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
