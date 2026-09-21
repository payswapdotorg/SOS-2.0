/**
 * The History page — the revision timeline: mission and system-state
 * revisions with their supersedes relationships, dates and what changed.
 * (The deep revision-diff workspace is a later wave; this is the shell's
 * timeline surface.)
 */

import { PageShell, PageHeading } from '../page-shell';
import { Card } from '../card';
import { ValueChip } from '../chips';
import { rationaleHref, views } from '../../view-state/demo-data';

export function HistoryPage() {
  const fixtureRevision = views.source.kind === 'DEMO' ? views.source.fixture_revision : undefined;
  return (
    <PageShell section="history">
      <PageHeading
        title="History"
        intro="The revision timeline: what superseded what, when, and why. Identity is preserved across revisions."
        demoRevision={fixtureRevision}
      />
      <Card id="history-timeline" title="Timeline" demoRevision={fixtureRevision}>
        <ol className="relative space-y-4 border-l-2 border-line pl-5">
          {views.historyEntries.map((entry) => (
            <li key={entry.id} className="relative">
              <span
                aria-hidden="true"
                className={`absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 ${
                  entry.status === 'ACTIVE' ? 'border-ok bg-ok-soft' : 'border-line-strong bg-surface'
                }`}
              />
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{entry.what}</span>
                <ValueChip label="version" value={`v${String(entry.version)}`} />
                <ValueChip label="status" value={entry.status} />
                <ValueChip label="at" value={entry.at} />
              </p>
              <p className="mt-1 text-sm text-ink-soft">{entry.detail}</p>
              <p className="mt-1">
                <a href={rationaleHref(entry.id)} className="inline-flex min-h-[44px] items-center rounded-md px-1 text-xs font-medium text-epistemic underline-offset-2 hover:underline">
                  <span className="font-mono">{entry.id}</span> — rationale
                </a>
              </p>
            </li>
          ))}
        </ol>
      </Card>
    </PageShell>
  );
}
