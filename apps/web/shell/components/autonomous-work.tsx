/**
 * The active autonomous work surface: active tasks, body leases (ephemeral
 * execution resources) and observation status — with "SOS is watching"
 * rendered as a state SEPARATE from "a body is working" (journey 14).
 *
 * Tasks/leases render with native disclosure sheets (details/summary) for
 * deep details — keyboard-navigable, no client JavaScript. Cloud and local
 * execution are clearly distinguished (journeys 16/17), and interrupted
 * bodies are presented as interchangeable resources with retained
 * checkpoints (journey 15).
 */

import Link from 'next/link';
import type { ActiveTaskSummaryVM, BodyLeaseSummaryVM, ObservationStatusVM } from '@sos-2/web-contracts';
import { Card } from './card';
import { StateKindChip, ValueChip } from './chips';
import { DemoBadge } from './demo-badge';
import { rationaleHref, views } from '../view-state/demo-data';

const TASK_STATUS_LABELS: Record<string, string> = {
  RUNNING: 'Running',
  PAUSED: 'Paused — body lost',
  QUEUED: 'Queued — waiting for a local body',
  AWAITING_DECISION: 'Waiting for your decision',
  COMPLETED: 'Completed',
};

export function ActiveTasksCard() {
  return (
    <Card
      id="card-active-tasks"
      title="Active tasks"
      chip={<ValueChip label="open" value={String(views.tasks.filter((task) => task.status !== 'COMPLETED').length)} />}
      demoRevision={views.source.kind === 'DEMO' ? views.source.fixture_revision : undefined}
      rationaleHref={rationaleHref(views.mission.envelope.id)}
    >
      <ul className="space-y-2">
        {views.tasks.map((task) => (
          <li key={task.task_id}>
            <details className="group rounded-lg border border-line bg-surface">
              <summary className="flex min-h-[44px] cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2">
                <StateKindChip kind={task.status === 'RUNNING' ? 'LOADING' : task.status === 'COMPLETED' ? 'EMPTY' : 'UNKNOWN'} />
                <span className="text-sm font-medium text-ink">{task.title}</span>
                <span className="ml-auto text-xs text-ink-soft group-open:hidden">Details</span>
                <span className="ml-auto hidden text-xs text-ink-soft group-open:inline">Close</span>
              </summary>
              <div className="border-t border-line px-3 py-3">
                <p className="text-sm text-ink">{task.summary}</p>
                <p className="mt-2 flex flex-wrap gap-1.5">
                  <ValueChip label="status" value={TASK_STATUS_LABELS[task.status] ?? task.status} />
                  <ValueChip
                    label="body"
                    value={task.working_body_kind !== null ? `${task.working_body_kind.toLowerCase()} body working` : 'no body attached'}
                    title="A body is an interchangeable execution resource; observation and decisions do not need one."
                  />
                  <ValueChip
                    label="runs"
                    value={task.runs_in_cloud ? 'in the cloud' : 'on your device'}
                    title={task.runs_in_cloud ? 'Cloud work continues while your computer is off.' : 'Local tasks queue safely while the device is offline.'}
                  />
                  <ValueChip label="updated" value={task.updated_at} />
                </p>
                {task.checkpoint !== null ? (
                  <p className="mt-2 text-sm text-ink-soft">
                    <span className="font-medium text-ink">Checkpoint:</span> {task.checkpoint}
                  </p>
                ) : null}
                {task.ask_ref !== null ? (
                  <p className="mt-2">
                    <Link href="/ask" className="inline-flex min-h-[44px] items-center rounded-md px-1 text-sm font-medium text-epistemic underline-offset-2 hover:underline">
                      Open the question this task waits on
                    </Link>
                  </p>
                ) : null}
                {task.core.evidence_refs.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-ink-soft">
                    {task.core.evidence_refs.map((ref) => (
                      <li key={ref}>
                        Evidence <code className="rounded bg-surface-warm px-1 py-0.5">{ref}</code>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function BodyLeasesCard() {
  return (
    <Card
      id="card-body-leases"
      title="Body leases"
      chip={<ValueChip label="active" value={String(views.leases.filter((lease) => lease.status === 'ACTIVE').length)} />}
      demoRevision={views.source.kind === 'DEMO' ? views.source.fixture_revision : undefined}
      rationaleHref={rationaleHref(views.mission.envelope.id)}
    >
      <p className="text-sm text-ink-soft">
        Bodies are ephemeral execution resources. A task, its checkpoints and its evidence survive body replacement.
      </p>
      <ul className="mt-3 space-y-2">
        {views.leases.map((lease: BodyLeaseSummaryVM) => (
          <li key={lease.lease_id} className="rounded-lg border border-line bg-surface px-3 py-2.5">
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink">
                {lease.body_kind === 'CLOUD' ? 'Cloud body' : lease.body_kind === 'LOCAL' ? 'Local body' : 'Remote body'}
              </span>
              <ValueChip label="lease" value={lease.status} title={lease.status === 'SUSPENDED' ? lease.isolation : undefined} />
            </p>
            <p className="mt-1 text-xs text-ink-soft">{lease.isolation}</p>
            <p className="mt-1 flex flex-wrap gap-1.5">
              {lease.capabilities.map((capability) => (
                <ValueChip key={capability} label="capability" value={capability} />
              ))}
            </p>
            <p className="mt-1 text-xs text-ink-soft">
              Held by <code className="rounded bg-surface-warm px-1 py-0.5">{lease.held_by_task ?? 'no task'}</code> · granted {lease.granted_at}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ObservationStatusCard({ vm }: { vm: ObservationStatusVM }) {
  return (
    <Card
      id="card-observation"
      title="Observation status"
      chip={
        <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/30 bg-ok-soft px-2.5 py-0.5 text-xs font-medium text-ok">
          <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1.5 6s1.8-3.5 4.5-3.5S10.5 6 10.5 6 8.7 9.5 6 9.5 1.5 6 1.5 6Z" />
            <circle cx="6" cy="6" r="1.6" />
          </svg>
          {vm.watching ? 'SOS is watching' : 'Observation paused'}
        </span>
      }
      demoRevision={views.source.kind === 'DEMO' ? views.source.fixture_revision : undefined}
      rationaleHref={rationaleHref(vm.core.subject_id)}
    >
      <p className="text-sm text-ink">{vm.note}</p>
      <p className="mt-2 flex flex-wrap gap-1.5">
        <ValueChip label="last event" value={vm.last_event_at} />
        <ValueChip label="events in window" value={String(vm.events_in_window)} />
        <ValueChip
          label="a body is working"
          value={vm.any_body_working ? 'yes — one active lease' : 'no'}
          title="Shown separately from watching: observation never implies a working body."
        />
      </p>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Observed sources">
        {vm.sources.map((source) => (
          <li key={source}>
            <ValueChip label="source" value={source} />
          </li>
        ))}
      </ul>
      <p className="mt-3 rounded-lg border border-dashed border-epistemic/40 bg-epistemic-soft px-3 py-2 text-xs text-epistemic" data-separation-note="true">
        {vm.separation_note}
      </p>
    </Card>
  );
}
