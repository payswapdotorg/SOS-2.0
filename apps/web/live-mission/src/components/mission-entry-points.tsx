/**
 * The mission entry points (Work Order P17-C / P18 structural fix):
 * mission becomes actionable — `Start mission` / `Import system` /
 * `Resume existing mission` — replacing the read-only mission view with
 * an actionable surface. Onboarding stays discoverable as a first-class
 * entry (the greenfield/brownfield journeys are one click away, and the
 * onboarding hub itself is linked for progressive formalization).
 */

import Link from 'next/link';
import type { LiveMissionEntry } from '../view-state/live-mission-dto';
import { resumableMissions } from '../view-state/live-mission-view';
import { Card } from '../../../shell/components/card';
import { ValueChip } from '../../../shell/components/chips';
import { LiveBadge } from './shared';

function EntryLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-surface-warm"
    >
      {label}
    </Link>
  );
}

function PrimaryEntryLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      data-mission-entry="primary"
      className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper hover:opacity-90"
    >
      {label}
    </Link>
  );
}

export function MissionEntryPoints({
  missions,
  storeRef,
  asOf,
}: {
  missions: readonly LiveMissionEntry[];
  storeRef: string;
  asOf: string;
}) {
  const resumable = resumableMissions(missions);
  return (
    <div className="space-y-4">
      <Card id="mission-entry-start" title="Start a mission">
        <p className="text-sm text-ink">Shape a mission from intent: purpose → outcomes → stakeholders → measures → constraints → your authority confirmation → the GitHub connection.</p>
        <p className="mt-1 text-sm text-ink-soft">For greenfield work — including starting from an empty repository.</p>
        <p className="mt-3">
          <PrimaryEntryLink href="/onboarding/greenfield" label="Start mission" />
        </p>
      </Card>

      <Card id="mission-entry-import" title="Import a system">
        <p className="text-sm text-ink">Connect an existing GitHub repository or runtime: SOS observes it, recovers the competing architecture readings, and asks you to confirm one.</p>
        <p className="mt-3">
          <EntryLink href="/onboarding/brownfield" label="Import system" />
        </p>
      </Card>

      <Card id="mission-entry-resume" title="Resume an existing mission" chip={<LiveBadge storeRef={storeRef} asOf={asOf} />}>
        {resumable.length === 0 ? (
          <p className="text-sm text-ink-soft">
            No mission exists yet — this is honestly empty (the authoritative mission store has no active or draft mission). Start one above; nothing is fabricated here.
          </p>
        ) : (
          <ul className="space-y-2">
            {resumable.map((mission) => (
              <li key={mission.missionId} className="rounded-lg border border-line bg-surface p-3">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">{mission.purposeSummary}</span>
                  <ValueChip label="status" value={mission.status} />
                  <ValueChip label="updated" value={mission.updatedAt} />
                </p>
                <p className="mt-1 text-xs text-ink-soft">{mission.missionId}</p>
                <p className="mt-2">
                  <EntryLink href="/onboarding/greenfield" label="Resume this mission" />
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-soft">Resuming links through the onboarding journeys, which resume progressive formalization from the recorded state.</p>
      </Card>
    </div>
  );
}
