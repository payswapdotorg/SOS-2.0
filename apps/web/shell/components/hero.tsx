/**
 * The Overview hero — the dominant surface (docs/ux/sharenet-inspired-
 * design.md "strong current-state hero"): mission outcome health, current
 * system condition, current shortfall/opportunity, and the NEXT ALLOWED
 * ACTION. Every entry carries its basis and a rationale deep-link; the
 * whole surface is DEMO-labelled.
 */

import Link from 'next/link';
import { actionAvailabilityLabel } from '@sos-2/web-contracts';
import type { MissionHeroVM, NextAllowedActionVM, ShortfallOpportunityVM, SystemConditionVM } from '@sos-2/web-contracts';
import { ConditionChip, ValueChip } from './chips';
import { DemoBadge } from './demo-badge';
import { rationaleHref, views } from '../view-state/demo-data';

function HeroEntry({
  id,
  title,
  chip,
  children,
  why,
}: {
  id: string;
  title: string;
  chip?: React.ReactNode;
  children: React.ReactNode;
  why?: string;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${id}-heading`} className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
          {title}
        </h2>
        {chip}
        {why !== undefined ? (
          <Link
            href={why}
            className="ml-auto inline-flex min-h-[44px] items-center rounded-md px-2 text-sm font-medium text-epistemic underline-offset-2 hover:underline"
          >
            Why?
            <span className="sr-only">{` — the reasoning behind ${title}`}</span>
          </Link>
        ) : null}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function HeroPanel({
  hero,
  systemCondition,
  shortfall,
  nextAction,
}: {
  hero: MissionHeroVM;
  systemCondition: SystemConditionVM;
  shortfall: ShortfallOpportunityVM | null;
  nextAction: NextAllowedActionVM;
}) {
  const availabilityLabel = actionAvailabilityLabel(nextAction.availability);
  return (
    <section aria-label="Current state" data-hero="true" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <DemoBadge revision={views.source.kind === 'DEMO' ? views.source.fixture_revision : undefined} note={views.source.kind === 'DEMO' ? views.source.note : undefined} />
        <p className="text-xs text-ink-soft">{views.source.kind === 'DEMO' ? views.source.note : 'Live authoritative stores.'}</p>
      </div>

      <p className="text-xl font-semibold leading-snug text-ink sm:text-2xl">{hero.purpose}</p>

      <div className="grid gap-3 md:grid-cols-2">
        <HeroEntry
          id="hero-mission-health"
          title="Mission outcome health"
          chip={<ConditionChip condition={hero.outcome_health} basis={hero.outcome_basis} />}
          why={rationaleHref(hero.mission_id)}
        >
          <p className="text-sm text-ink">{hero.outcome_basis}</p>
          <ul className="mt-2 space-y-1 text-sm text-ink-soft">
            {hero.goals.map((goal) => (
              <li key={goal.goal_id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{goal.statement}</span>
                <ValueChip label="status" value={goal.status} title={`Goal status from the frozen mission vocabulary: ${goal.status}`} />
              </li>
            ))}
          </ul>
        </HeroEntry>

        <HeroEntry
          id="hero-system-condition"
          title="Current system condition"
          chip={<ConditionChip condition={systemCondition.condition} basis={systemCondition.condition_basis} />}
          why={rationaleHref(systemCondition.system_state_id)}
        >
          <p className="text-sm text-ink">{systemCondition.condition_basis}</p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            {systemCondition.refs
              .filter((ref) => ref.kind === 'DEPLOYMENT' || ref.kind === 'IMPLEMENTATION')
              .map((ref) => (
                <ValueChip key={`${ref.kind}-${ref.id}`} label={ref.kind === 'DEPLOYMENT' ? 'deployment' : 'implementation'} value={ref.revision} title={`${ref.id} at exact revision ${ref.revision}`} />
              ))}
          </p>
        </HeroEntry>

        <HeroEntry id="hero-shortfall" title={shortfall?.kind === 'OPPORTUNITY' ? 'Current opportunity' : 'Current shortfall'} why={shortfall ? rationaleHref(shortfall.core.subject_id) : undefined}>
          {shortfall !== null ? (
            <>
              <p className="text-sm font-medium text-ink">{shortfall.statement}</p>
              <p className="mt-2 flex flex-wrap gap-1.5">
                {shortfall.measure_description !== null ? (
                  <ValueChip label="measure" value={`${shortfall.measure_description} (target ${shortfall.measure_target ?? 'not set'})`} />
                ) : null}
                <ValueChip label="uncertainty" value={shortfall.core.uncertainty.uncertainty_class} title={shortfall.core.uncertainty.statement} />
              </p>
              <p className="mt-2 text-xs text-ink-soft">{shortfall.core.uncertainty.statement}</p>
            </>
          ) : (
            <p className="text-sm text-ink-soft">No shortfall or opportunity is currently known.</p>
          )}
        </HeroEntry>

        <HeroEntry id="hero-next-action" title="Next allowed action" why={nextAction.action.rationale_ref !== null ? rationaleHref(nextAction.action.rationale_ref) : undefined}>
          <p className="text-base font-semibold text-ink">{nextAction.action.label}</p>
          <p className="mt-1 text-sm text-ink-soft">{nextAction.action.description}</p>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <ValueChip label="availability" value={availabilityLabel} title={nextAction.availability.reason} />
            <ValueChip label="authority" value={nextAction.core.authority.note} />
          </p>
          <p className="mt-2 text-xs text-ink-soft">{nextAction.priority_reason}</p>
          {nextAction.action.href !== null ? (
            <p className="mt-3">
              <Link
                href={nextAction.action.href}
                className="inline-flex min-h-[44px] items-center rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-ink/90"
              >
                {nextAction.action.kind === 'DECIDE' ? 'Review the question' : 'Open'}
                <span className="sr-only">{` — ${nextAction.action.label}`}</span>
              </Link>
            </p>
          ) : (
            <p className="mt-3 text-xs text-ink-soft">{nextAction.availability.reason}</p>
          )}
        </HeroEntry>
      </div>
    </section>
  );
}
