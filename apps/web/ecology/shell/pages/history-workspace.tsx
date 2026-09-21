/**
 * The History workspace (Work Order P10) — the revision TIMELINE: every
 * supersede chain of every revision-bearing kind read from the live-store
 * repositories (plus the clearly-labelled fixture-only kinds), each entry
 * carrying what changed, why (provenance) and its linked evidence, with
 * deep links into the revision DIFF detail.
 */

import Link from 'next/link';
import { PageShell, PageHeading } from '../../../shell/components/page-shell';
import { Card } from '../../../shell/components/card';
import { StateBlockView } from '../../../shell/components/state-block';
import { ValueChip } from '../../../shell/components/chips';
import { ecologyViews } from '../../view-state/ecology-data';

export async function HistoryWorkspace() {
  const views = await ecologyViews();
  const workspace = views.historyWorkspace;
  const fixtureRevision = workspace.core.data_source.kind === 'DEMO' ? workspace.core.data_source.fixture_revision : undefined;
  const fixtureOnlyKinds = new Set(['PackageComposition', 'MetaProcess']);

  // Group the chains by kind for progressive disclosure (details/summary).
  const byKind = new Map<string, typeof workspace.chains>();
  for (const chain of workspace.chains) {
    const list = byKind.get(chain.kind) ?? [];
    list.push(chain);
    byKind.set(chain.kind, list);
  }

  return (
    <PageShell section="history">
      <PageHeading
        title="History"
        intro="The revision timeline: what superseded what, when, and why — every chain read from the durable stores, every entry linking to its revision diff. Identity is preserved across revisions."
        demoRevision={fixtureRevision}
      />
      <div className="space-y-4">
        {workspace.state_blocks.map((block) => (
          <StateBlockView key={block.surface} block={block} />
        ))}
        {workspace.chains.length === 0 ? (
          <StateBlockView
            block={{
              kind: 'EMPTY',
              surface: 'history-timeline',
              statement: 'No revision chains are stored yet — the timeline grows as the durable stores accumulate revisions.',
              present: null,
              missing: null,
              action: 'Connect the live stores to see the revision history of every artifact kind.',
            }}
          />
        ) : null}
        {workspace.chains.map((chain) => (
          <Card
            key={`${chain.kind}-${chain.lineage_root}`}
            id={`chain-${chain.kind.toLowerCase()}-${chain.lineage_root.slice(-6)}`}
            title={`${chain.kind} chain`}
            chip={
              <span className="flex flex-wrap gap-1.5">
                <ValueChip label="revisions" value={String(chain.entries.length)} />
                <ValueChip
                  label="source"
                  value={fixtureOnlyKinds.has(chain.kind) ? 'DEMO fixture (not a live-store family yet)' : 'live-store read'}
                  title={fixtureOnlyKinds.has(chain.kind) ? 'This artifact kind is not yet a live-store repository family (the P2 support list); its chain renders from the clearly-labelled DEMO fixture.' : 'The chain records were read through the @sos-2/live-store repositories.'}
                />
              </span>
            }
            demoRevision={fixtureRevision}
          >
            <ol className="relative space-y-4 border-l-2 border-line pl-5">
              {chain.entries.map((entry) => (
                <li key={entry.artifact_id} className="relative">
                  <span
                    aria-hidden="true"
                    className={`absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 ${
                      entry.status === 'ACTIVE' ? 'border-ok bg-ok-soft' : entry.status === 'RETIRED' ? 'border-stop bg-stop-soft' : 'border-line-strong bg-surface'
                    }`}
                  />
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink">{entry.what_changed}</span>
                    <ValueChip label="version" value={`v${String(entry.version)}`} />
                    <ValueChip label="status" value={entry.status} />
                    <ValueChip label="at" value={entry.created_at} />
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">Why (provenance): {entry.why.join('; ')}</p>
                  {entry.evidence_refs.length > 0 ? (
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                      Evidence:
                      {entry.evidence_refs.map((ref) => (
                        <Link key={ref} href={views.rationaleHref(ref)} className="inline-flex min-h-[44px] items-center font-mono text-epistemic underline-offset-2 hover:underline">
                          {ref}
                        </Link>
                      ))}
                    </p>
                  ) : null}
                  <p className="mt-1">
                    <Link href={entry.href} className="inline-flex min-h-[44px] items-center rounded-md px-1 text-xs font-medium text-epistemic underline-offset-2 hover:underline">
                      <span className="font-mono">{entry.artifact_id}</span> — open the revision diff
                    </Link>
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
