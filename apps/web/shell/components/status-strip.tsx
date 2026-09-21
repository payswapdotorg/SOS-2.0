/**
 * The persistent status strip (docs/ux/sharenet-inspired-design.md
 * "Persistent status: system condition, active experiment, authority
 * mode") — docked at the bottom of the desktop rail and mirrored in the
 * mobile header / More page. Each entry is a labelled value, never a bare
 * color.
 */

import Link from 'next/link';
import { ValueChip } from './chips';
import { views } from '../view-state/demo-data';

export function StatusStrip() {
  return (
    <div className="space-y-2" aria-label="Persistent status">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Status</p>
      <dl className="space-y-1.5 text-xs text-ink-soft">
        <div className="flex items-start gap-2">
          <dt className="font-medium text-ink">System</dt>
          <dd className="flex flex-wrap items-center gap-1.5">
            {views.systemCondition.condition === 'HEALTHY' ? 'Healthy' : views.systemCondition.condition === 'DEGRADED' ? 'Needs attention' : views.systemCondition.condition === 'BLOCKED' ? 'Blocked' : views.systemCondition.condition === 'INACTIVE' ? 'Inactive' : views.systemCondition.condition === 'UNKNOWN' ? 'Unknown' : 'Unavailable'}
            <span className="sr-only">{` — ${views.systemCondition.condition_basis}`}</span>
          </dd>
        </div>
        <div className="flex items-start gap-2">
          <dt className="font-medium text-ink">Experiment</dt>
          <dd>
            <Link href="/experiments" className="underline-offset-2 hover:underline">
              {views.experimentStatus.title} · {views.experimentStatus.phase} {String(views.experimentStatus.exposure_percent)}%
            </Link>
          </dd>
        </div>
        <div className="flex items-start gap-2">
          <dt className="font-medium text-ink">Authority</dt>
          <dd>{views.authorityMode.label}</dd>
        </div>
      </dl>
      <p className="pt-1">
        <ValueChip label="Data" value="DEMO — SIMULATED DATA" title="Every surface in this build renders the fixed demo fixture dataset." />
      </p>
    </div>
  );
}
