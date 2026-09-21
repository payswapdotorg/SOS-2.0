/**
 * The product shell navigation model (docs/ux/sharenet-inspired-design.md):
 *
 *   Desktop primary rail: Overview, Mission, System, Changes, Evidence,
 *   Experiments, Packages, History, More — plus a persistent status strip
 *   (system condition, active experiment, authority mode).
 *
 *   Mobile: compact header + bottom navigation: Overview, Changes,
 *   Evidence, ASK, More — with drawers/sheets for deep artifact details.
 *
 * The model is pure data + pure functions consumed by the shell; routes are
 * part of the contract so navigation and deep-link expectations stay
 * testable. Section ids are also the stable a11y/active-state keys.
 */

import { WebContractError } from './errors.js';

/** The desktop rail sections, in the design contract's order. */
export const DESKTOP_RAIL_SECTIONS = [
  'overview',
  'mission',
  'system',
  'changes',
  'evidence',
  'experiments',
  'packages',
  'history',
  'more',
] as const;

export type DesktopRailSection = (typeof DESKTOP_RAIL_SECTIONS)[number];

/** The mobile bottom navigation sections, in the design contract's order. */
export const MOBILE_BOTTOM_NAV_SECTIONS = [
  'overview',
  'changes',
  'evidence',
  'ask',
  'more',
] as const;

export type MobileBottomNavSection = (typeof MOBILE_BOTTOM_NAV_SECTIONS)[number];

/** Every shell section id (the union of both navigations). */
export type ShellSectionId = DesktopRailSection | MobileBottomNavSection;

const SHELL_SECTION_IDS: ReadonlySet<string> = new Set<string>([
  ...DESKTOP_RAIL_SECTIONS,
  ...MOBILE_BOTTOM_NAV_SECTIONS,
]);

export function isShellSectionId(value: unknown): value is ShellSectionId {
  return typeof value === 'string' && SHELL_SECTION_IDS.has(value);
}

/** One navigation entry. Glyph ids name abstract geometric glyphs owned by the shell (never copied iconography). */
export interface NavItemView {
  section: ShellSectionId;
  /** In-app route. */
  href: string;
  /** User-facing label (a fresh user needs no package names). */
  label: string;
  /** One-line description (tooltips, the More index, sr-only context). */
  description: string;
  /** Whether the section is in the desktop rail. */
  on_desktop_rail: boolean;
  /** Whether the section is in the mobile bottom navigation. */
  on_mobile_bottom_nav: boolean;
}

/**
 * The complete navigation model (deterministic, fixed order). ASK is
 * reachable from the desktop More index and the mobile bottom navigation —
 * it is first-class product surface (P18) without crowding the nine-item
 * rail from the design contract.
 */
export function shellNavigationModel(): NavItemView[] {
  return [
    {
      section: 'overview',
      href: '/',
      label: 'Overview',
      description: 'Mission health, current system condition, what is changing and what happens next',
      on_desktop_rail: true,
      on_mobile_bottom_nav: true,
    },
    {
      section: 'mission',
      href: '/mission',
      label: 'Mission',
      description: 'Purpose, goals, measures, constraints and revision history',
      on_desktop_rail: true,
      on_mobile_bottom_nav: false,
    },
    {
      section: 'system',
      href: '/system',
      label: 'System',
      description: 'The current system state with exact implementation and deployment revisions',
      on_desktop_rail: true,
      on_mobile_bottom_nav: false,
    },
    {
      section: 'changes',
      href: '/changes',
      label: 'Changes',
      description: 'What is being changed, why, and how it is protected',
      on_desktop_rail: true,
      on_mobile_bottom_nav: true,
    },
    {
      section: 'evidence',
      href: '/evidence',
      label: 'Evidence',
      description: 'What SOS knows, per distinct truth state, with provenance',
      on_desktop_rail: true,
      on_mobile_bottom_nav: true,
    },
    {
      section: 'experiments',
      href: '/experiments',
      label: 'Experiments',
      description: 'Controlled changes: stages, guardrails and honest simulated evaluations',
      on_desktop_rail: true,
      on_mobile_bottom_nav: false,
    },
    {
      section: 'packages',
      href: '/packages',
      label: 'Packages',
      description: 'Validated, reusable capabilities with retained limitations',
      on_desktop_rail: true,
      on_mobile_bottom_nav: false,
    },
    {
      section: 'history',
      href: '/history',
      label: 'History',
      description: 'Revision timeline: what superseded what, and when',
      on_desktop_rail: true,
      on_mobile_bottom_nav: false,
    },
    {
      section: 'ask',
      href: '/ask',
      label: 'ASK',
      description: 'Questions waiting for a human decision, with everything needed to decide',
      on_desktop_rail: false,
      on_mobile_bottom_nav: true,
    },
    {
      section: 'more',
      href: '/more',
      label: 'More',
      description: 'Every section, authority detail, data-source status and keyboard help',
      on_desktop_rail: true,
      on_mobile_bottom_nav: true,
    },
  ];
}

/** The desktop rail items (fixed order, from the design contract). */
export function desktopRailItems(): NavItemView[] {
  const bySection = new Map(shellNavigationModel().map((item) => [item.section, item]));
  return DESKTOP_RAIL_SECTIONS.map((section) => {
    const item = bySection.get(section);
    if (!item) {
      throw new WebContractError(`navigation model is missing the rail section ${JSON.stringify(section)}`);
    }
    return item;
  });
}

/** The mobile bottom navigation items (fixed order, from the design contract). */
export function mobileBottomNavItems(): NavItemView[] {
  const bySection = new Map(shellNavigationModel().map((item) => [item.section, item]));
  return MOBILE_BOTTOM_NAV_SECTIONS.map((section) => {
    const item = bySection.get(section);
    if (!item) {
      throw new WebContractError(`navigation model is missing the bottom navigation section ${JSON.stringify(section)}`);
    }
    return item;
  });
}

/** The "More" index: every section in a stable order (mobile More + desktop More page). */
export function moreIndexItems(): NavItemView[] {
  const model = shellNavigationModel();
  const order: ShellSectionId[] = [
    'overview',
    'mission',
    'system',
    'changes',
    'evidence',
    'experiments',
    'packages',
    'history',
    'ask',
    'more',
  ];
  const bySection = new Map(model.map((item) => [item.section, item]));
  return order
    .map((section) => bySection.get(section))
    .filter((item): item is NavItemView => item !== undefined);
}

/** Resolve the nav item for a section id (throws for an unknown section). */
export function navItemFor(section: ShellSectionId): NavItemView {
  const item = shellNavigationModel().find((entry) => entry.section === section);
  if (!item) {
    throw new WebContractError(`unknown shell section: ${JSON.stringify(section)}`);
  }
  return item;
}

/** The minimum touch target, in px, every interactive element respects (a11y contract). */
export const MIN_TOUCH_TARGET_PX = 44;

/** The route for the rationale deep-link of a spine subject's path-safe parts. */
export function rationaleRoute(kind: string, segment: string): string {
  return `/rationale/${encodeURIComponent(kind)}/${encodeURIComponent(segment)}`;
}
