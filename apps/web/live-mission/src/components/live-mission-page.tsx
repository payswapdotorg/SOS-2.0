/**
 * The live-mission page (Work Order P17-C) — the actionable mission
 * surface replacing the read-only mission view (new files only; the
 * existing shell route is untouched — see MOUNTING.md for the
 * architect's one-file integration pass).
 *
 * Sections:
 *   1. The hero: live observation summary + the six review questions
 *      (LIVE provenance; honest UNKNOWN until real probes answer).
 *   2. Mission becomes actionable: Start mission / Import system /
 *      Resume existing mission (+ onboarding stays first-class — the
 *      first-user path of the P18 roadmap).
 *   3. Live observation: real events/state from the real sources.
 *   4. Consequential actions: authority-gated through the merged
 *      action gateway; the UI never mutates state directly.
 *
 * Fully server-rendered; zero client components; the same P1 shell
 * landmarks, a11y standards and warm-light design.
 */

import type { LiveMissionEntry, LiveObservationData } from '../view-state/live-mission-dto';
import { emptyLiveObservation } from '../view-state/live-mission-dto';
import { PageShell, PageHeading } from '../../../shell/components/page-shell';
import { MissionEntryPoints } from './mission-entry-points';
import { LiveObservationView } from './live-observation-view';
import { ActionPanel } from './action-panel';
import { LiveBadge } from './shared';

export interface LiveMissionPageProps {
  /** The live observation data (omitted until the architect wires the data plane — then rendered LIVE). */
  readonly data?: LiveObservationData;
  /** Resumable missions from the authoritative mission store. */
  readonly missions?: readonly LiveMissionEntry[];
  /** The repository subject the composition observes (used for the honest empty state). */
  readonly repositorySubject?: string;
  /** The durable store reference for the honest empty state. */
  readonly storeRef?: string;
}

export function LiveMissionPage(props: LiveMissionPageProps) {
  const data = props.data ?? emptyLiveObservation(props.storeRef ?? 'unwired', 'never', props.repositorySubject ?? 'unwired');
  const missions = props.missions ?? [];
  return (
    <PageShell section="mission">
      <PageHeading
        title="Mission — live"
        intro="The actionable mission surface: start, import or resume a mission, watch the real system live, and act through authority-gated actions."
      />
      <div className="space-y-4">
        <section aria-labelledby="live-mission-hero-heading" className="rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6">
          <h2 id="live-mission-hero-heading" className="flex flex-wrap items-center gap-3 text-base font-semibold text-ink sm:text-lg">
            What is happening?
            <LiveBadge storeRef={data.storeRef} asOf={data.asOf} />
          </h2>
          <p className="mt-3 text-sm text-ink-soft">
            {data.drainedAt === null
              ? 'No live observation drain has run yet — this surface shows honest UNKNOWN states until the real sources are probed (never fabricated live state).'
              : `The real observation plane last drained at ${data.drainedAt}. ${data.eventsInWindow} events in the current window. SOS is watching without a body.`}
          </p>
          <p className="mt-3">
            <a href="/onboarding" className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-surface-warm">
              New here? Start with onboarding
            </a>
          </p>
        </section>

        <MissionEntryPoints missions={missions} storeRef={data.storeRef} asOf={data.asOf} />

        <LiveObservationView data={data} />

        <ActionPanel data={data} />
      </div>
    </PageShell>
  );
}
