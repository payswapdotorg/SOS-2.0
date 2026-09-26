/**
 * The root first-user surface (Work Order P18-C, UX-discoverability lane).
 *
 * A fresh user landing on `/` previously saw the DEMO-fixture overview with
 * no way to learn what SOS is, no onboarding entry and no mission entry.
 * This module puts the discovery surface FIRST — "What are you trying to
 * accomplish?" — while keeping the overview composition (the dominant hero,
 * the below-hero cards, the active autonomous work surface) below it for
 * returning users, exactly as the P1 shell delivered it.
 *
 * Composition (all links target REAL routes that exist in this app):
 *   1. The accomplish question (the visible h1) + the three accomplishment
 *      paths: start something new (greenfield), bring an existing system
 *      (brownfield), resume or watch current work (the mission surface).
 *   2. Onboarding as a first-class entry (the P18 structural fix): the
 *      guided hub is one link away, labelled for someone who has never
 *      heard of `/onboarding`.
 *   3. The five first-run understandings (progressive disclosure via
 *      native details/summary — the shell's own disclosure pattern, zero
 *      client JavaScript): SOS watches continuously; SOS can summon
 *      bodies; the user's computer is optional; SOS asks when authority
 *      or evidence is insufficient; completion requires independent
 *      verification. Each understanding links where the user can SEE it.
 *
 * Honesty: the discovery surface makes no live/connected data claims of its
 * own — it is static guidance plus links; the overview below remains the
 * P1 fixture-backed surface under its own DEMO badges; the mission entry
 * points lead to surfaces that render their own honest states (live/DEMO
 * provenance is owned by those surfaces, never re-stated here).
 *
 * Fully server-rendered (no client components, no client fetches, no
 * hidden clocks); the P1 shell landmarks and a11y standards are inherited
 * from PageShell; every interactive element keeps the 44px touch target.
 *
 * This module is a COLOCATED non-route file beside app/page.tsx (the
 * Next.js colocation pattern): the route file stays the thin wrapper the
 * frozen shell contract pins (apps/web/shell/test/navigation.test.ts), and
 * the discovery surface lives here where this lane owns it.
 */

import Link from 'next/link';
import { Card } from '../shell/components/card';
import { HeroPanel } from '../shell/components/hero';
import {
  CurrentChangeCard,
  EvidenceQualityCard,
  ExperimentStatusCard,
  PackageReuseCard,
  RecentLearningCard,
} from '../shell/components/overview-cards';
import { ActiveTasksCard, BodyLeasesCard, ObservationStatusCard } from '../shell/components/autonomous-work';
import { views } from '../shell/view-state/demo-data';

/** One accomplishment path a first user can follow (links to real routes only). */
interface AccomplishmentPath {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly note: string;
  readonly href: string;
  readonly actionLabel: string;
  readonly primary: boolean;
}

const ACCOMPLISHMENT_PATHS: readonly AccomplishmentPath[] = [
  {
    id: 'start',
    title: 'Start something new',
    body: 'Shape a mission from intent: purpose, outcomes, measures, constraints — then connect a repository (even an empty one) and grant authority for the work.',
    note: 'The guided, resumable greenfield journey.',
    href: '/onboarding/greenfield',
    actionLabel: 'Start mission',
    primary: true,
  },
  {
    id: 'import',
    title: 'Bring an existing system',
    body: 'Import a repository or runtime that already exists: SOS observes it, scans the evidence honestly, recovers the COMPETING architecture readings, and asks you to confirm one.',
    note: 'The brownfield import — partial stays partial.',
    href: '/onboarding/brownfield',
    actionLabel: 'Import system',
    primary: false,
  },
  {
    id: 'resume',
    title: 'Resume or watch current work',
    body: 'Open the mission surface: what is happening, what SOS observes right now, what remains uncertain, and the actions available under your authority.',
    note: 'Missions, observation and the authority-gated actions live here.',
    href: '/mission',
    actionLabel: 'Go to the mission surface',
    primary: false,
  },
];

/** One first-run understanding (progressive disclosure: headline always visible, explanation on demand). */
interface FirstRunUnderstanding {
  readonly id: string;
  readonly headline: string;
  readonly body: string;
  readonly links: readonly { readonly href: string; readonly label: string }[];
}

const FIVE_FIRST_RUN_UNDERSTANDINGS: readonly FirstRunUnderstanding[] = [
  {
    id: 'watches-continuously',
    headline: 'SOS watches continuously',
    body: 'SOS observes your repositories, CI runs, deployments and runtime signals all the time, folding every real event into an honest, time-ordered picture that carries its evidence. Watching is not something you start — it is how SOS holds state — and when you return, what changed and why is already there.',
    links: [
      { href: '/mission', label: 'See the mission surface' },
      { href: '/evidence', label: 'See what SOS knows' },
    ],
  },
  {
    id: 'summons-bodies',
    headline: 'SOS can summon bodies to do the work',
    body: 'When something needs hands — inspecting a repository, making a change, verifying a deployment — SOS summons an execution body: a leased worker that acts under authority you granted. Bodies are ephemeral and replaceable; the task, its checkpoints and its evidence outlive any single body.',
    links: [{ href: '/mission', label: 'Start or resume a mission' }],
  },
  {
    id: 'computer-optional',
    headline: 'Your computer is optional',
    body: 'Once you have shaped a mission and granted authority, work runs in the cloud and observation never sleeps. You can close your laptop: missions keep moving, evidence keeps accumulating, and every step is recorded for you to read when you return.',
    links: [
      { href: '/mission', label: 'The mission surface' },
      { href: '/history', label: 'The full history' },
    ],
  },
  {
    id: 'asks-when-unsure',
    headline: 'SOS asks when authority or evidence is insufficient',
    body: 'SOS does not guess. When a step needs authority you have not granted, or evidence it does not hold, it stops and asks — with the alternatives, the evidence it has, and what remains uncertain, all in one place. Your answer becomes a typed decision record.',
    links: [{ href: '/ask', label: 'Open the ASK queue' }],
  },
  {
    id: 'independent-verification',
    headline: 'Completion requires independent verification',
    body: 'Nothing is done just because a body reported it done. Completion is gated by independent evaluation against the mission\u2019s own measures — a body can never certify its own work — and unresolved uncertainty stays visible instead of being folded into success.',
    links: [
      { href: '/evidence', label: 'The evidence' },
      { href: '/experiments', label: 'Experiments' },
    ],
  },
];

/** A link styled to the shell's 44px-touch-target discipline. */
function SurfaceLink({ href, label, withChevron = false }: { href: string; label: string; withChevron?: boolean }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-surface-warm"
    >
      {label}
      {withChevron ? (
        <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M2.5 2.5 6 6l3.5-3.5" />
        </svg>
      ) : null}
    </Link>
  );
}

/** The primary accomplishment action (the dark button treatment the live-mission surface uses). */
function PrimarySurfaceLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper hover:opacity-90"
    >
      {label}
    </Link>
  );
}

/**
 * The discovery surface: the accomplish question, the entry points, the
 * onboarding first-class entry and the five first-run understandings.
 * Rendered INSIDE the shell's main landmark, above the overview body.
 */
export function RootStartSurface() {
  return (
    <section aria-labelledby="start-heading" data-start-surface="true" className="mb-10">
      <h1 id="start-heading" className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
        What are you trying to accomplish?
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-soft sm:text-base">
        SOS is a mission-driven system for your software: it watches continuously, asks when authority or evidence is insufficient, and acts only under authority you grant — with every step evidenced. Start below; you do not need to know any internal names.
      </p>

      <ul className="mt-6 grid gap-4 md:grid-cols-3" aria-label="What you can do">
        {ACCOMPLISHMENT_PATHS.map((path) => (
          <li key={path.id}>
            <Card id={`start-path-${path.id}`} title={path.title}>
              <p className="text-sm text-ink">{path.body}</p>
              <p className="mt-1 text-sm text-ink-soft">{path.note}</p>
              <p className="mt-3" data-accomplishment-entry={path.id}>
                {path.primary ? <PrimarySurfaceLink href={path.href} label={path.actionLabel} /> : <SurfaceLink href={path.href} label={path.actionLabel} />}
              </p>
            </Card>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-xl border border-line bg-surface-warm p-5 shadow-sm sm:p-6" data-onboarding-entry="true">
        <h2 className="text-base font-semibold text-ink sm:text-lg">New here? Start with onboarding</h2>
        <p className="mt-2 max-w-3xl text-sm text-ink-soft">
          The onboarding hub walks a first mission end to end in plain language — start a mission, import an existing system, or paste a machine-written draft — and shows the GitHub connection state honestly at every step.
        </p>
        <p className="mt-3">
          <SurfaceLink href="/onboarding" label="Open onboarding" withChevron />
        </p>
      </div>

      <section aria-labelledby="first-run-heading" className="mt-8">
        <h2 id="first-run-heading" className="text-lg font-semibold text-ink">
          How SOS works — five things to understand first
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Open any line to read what it means for you and where you can see it in this product. These hold for every mission, every body and every completion record.
        </p>
        <ul className="mt-4 space-y-2" aria-label="The five first-run understandings">
          {FIVE_FIRST_RUN_UNDERSTANDINGS.map((understanding) => (
            <li key={understanding.id}>
              <details data-first-run-understanding={understanding.id} className="rounded-xl border border-line bg-surface shadow-sm">
                <summary className="flex min-h-[44px] cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-3 text-sm font-semibold text-ink sm:text-base">
                  <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M3 2.5 8 6l-5 3.5Z" />
                  </svg>
                  {understanding.headline}
                </summary>
                <div className="border-t border-line px-5 py-4">
                  <p className="text-sm text-ink">{understanding.body}</p>
                  <p className="mt-3 flex flex-wrap gap-3">
                    {understanding.links.map((link) => (
                      <SurfaceLink key={link.href} href={link.href} label={link.label} />
                    ))}
                  </p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

/**
 * The overview body kept below the discovery surface for returning users —
 * the P1 OverviewPage composition (the dominant hero, the below-hero cards,
 * the active autonomous work surface), rendered from the same exported
 * shell components and the same fixture view models.
 */
export function OverviewBody() {
  return (
    <section aria-label="Mission and system overview" className="mt-2">
      <HeroPanel
        hero={views.hero}
        systemCondition={views.systemCondition}
        shortfall={views.shortfall}
        nextAction={views.nextAction}
      />
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <CurrentChangeCard vm={views.currentChange} />
        <EvidenceQualityCard vm={views.evidenceQuality} />
        <ExperimentStatusCard vm={views.experimentStatus} />
        <PackageReuseCard vm={views.packageReuse} />
        <div className="md:col-span-2">
          <RecentLearningCard vm={views.recentLearning} />
        </div>
      </div>
      <section aria-labelledby="autonomous-work-heading" className="mt-8">
        <h2 id="autonomous-work-heading" className="mb-3 text-lg font-semibold text-ink">
          Active autonomous work
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <ActiveTasksCard />
          <BodyLeasesCard />
          <div className="md:col-span-2">
            <ObservationStatusCard vm={views.observation} />
          </div>
        </div>
      </section>
    </section>
  );
}
