/**
 * The revision detail (Work Order P10) — the deep view of ONE supersede
 * chain: every revision with its what/why/evidence, the field-level
 * revision DIFF between consecutive revisions (with restored values
 * highlighted — including the exact parameter restore of a rolled-back
 * meta change), and the six-question rationale of the chain head.
 * Unknown chains render the honest UNKNOWN state block.
 */

import { buildStateBlock } from '@sos-2/web-contracts';
import { PageShell, PageHeading } from '../../../shell/components/page-shell';
import { Card, Row } from '../../../shell/components/card';
import { StateBlockView } from '../../../shell/components/state-block';
import { ValueChip } from '../../../shell/components/chips';
import { ecologyViews } from '../../view-state/ecology-data';
import { EcologyRationale } from '../../components/ecology-rationale';

export async function RevisionDetail({ kind, segment }: { kind: string; segment: string }) {
  const views = await ecologyViews();
  const chain = views.revisionChain(kind, segment);
  const fixtureRevision = views.historyWorkspace.core.data_source.kind === 'DEMO' ? views.historyWorkspace.core.data_source.fixture_revision : undefined;

  if (chain === null) {
    return (
      <PageShell section="history">
        <PageHeading
          title="Revision detail"
          intro="The deep revision view of one artifact chain."
          demoRevision={fixtureRevision}
        />
        <StateBlockView
          block={buildStateBlock({
            kind: 'UNKNOWN',
            surface: 'revision-chain',
            statement: `No stored revision chain starts at sos://${decodeURIComponent(kind)}/${decodeURIComponent(segment)} — the link does not name a known chain root.`,
            action: 'Return to the History timeline and open a revision from a stored chain.',
          })}
        />
      </PageShell>
    );
  }

  const diffs = views.revisionDiffs(chain);
  const head = chain.entries[chain.entries.length - 1]!;
  const rationale = views.rationaleOf(head.artifact_id);

  return (
    <PageShell section="history">
      <PageHeading
        title={`${chain.kind} revision chain`}
        intro="What changed across the stored revisions, why, with which evidence — and the field-level diff between consecutive revisions. Identity is preserved across revisions."
        demoRevision={fixtureRevision}
      />
      <div className="space-y-4">
        <Card
          id="revision-chain"
          title="The chain (oldest to newest)"
          chip={<ValueChip label="revisions" value={String(chain.entries.length)} />}
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
                <p className="mt-1 font-mono text-xs text-ink-soft">{entry.artifact_id}</p>
              </li>
            ))}
          </ol>
        </Card>

        {diffs.length === 0 ? (
          <StateBlockView
            block={buildStateBlock({
              kind: 'EMPTY',
              surface: 'revision-diff',
              statement: 'This chain has a single stored revision — there is no diff yet.',
              action: 'A diff appears as soon as a revision supersedes this one.',
            })}
          />
        ) : (
          diffs.map((diff) => (
            <Card
              key={diff.revision_range.to}
              id={`diff-${diff.to.artifact_id.slice(-6)}`}
              title={`Diff: v${String(diff.from.version)} → v${String(diff.to.version)}`}
              chip={
                <span className="flex flex-wrap gap-1.5">
                  <ValueChip label="range" value={`${diff.revision_range.from} → ${diff.revision_range.to}`} />
                  {diff.status_change ? <ValueChip label="status" value={`${diff.status_change.from} → ${diff.status_change.to}`} /> : null}
                </span>
              }
              demoRevision={fixtureRevision}
            >
              <dl>
                <Row label="What changed">{diff.what_changed}</Row>
                <Row label="Why (provenance)">{diff.why.join('; ')}</Row>
                <Row label="Field changes">
                  {diff.field_changes.length === 0 ? (
                    <span className="text-sm text-ink-soft">No content field changed in this revision.</span>
                  ) : (
                    <ul className="space-y-2">
                      {diff.field_changes.map((change) => (
                        <li key={change.field} className="rounded-lg border border-line bg-surface-warm p-3 text-sm" data-field-change={change.field}>
                          <p className="font-medium text-ink">
                            {change.field}
                            {change.added ? ' (added)' : ''}
                            {change.removed ? ' (removed)' : ''}
                            {change.restored_from !== null ? (
                              <span className="ml-2 rounded-md border border-ok/30 bg-ok-soft px-1.5 py-0.5 text-xs font-medium text-ok">
                                restored to the v{String(change.restored_from.version)} value — byte-equal
                              </span>
                            ) : null}
                          </p>
                          {!change.added ? <p className="mt-1 break-all font-mono text-xs text-ink-soft">from: {change.from_summary}</p> : null}
                          {!change.removed ? <p className="mt-0.5 break-all font-mono text-xs text-ink">to: {change.to_summary}</p> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </Row>
                {diff.exact_restore_of !== null ? (
                  <Row label="Exact restore">
                    This revision&apos;s ENTIRE content is byte-equal to revision {diff.exact_restore_of.artifact_id} (v{String(diff.exact_restore_of.version)}).
                  </Row>
                ) : null}
              </dl>
            </Card>
          ))
        )}

        {rationale !== null ? (
          <section aria-label="Rationale of the chain head">
            <h2 className="mb-2 text-lg font-semibold text-ink">Why? — the six questions for the current head</h2>
            <EcologyRationale vm={rationale} />
          </section>
        ) : (
          <StateBlockView
            block={buildStateBlock({
              kind: 'UNKNOWN',
              surface: 'revision-rationale',
              statement: 'The chain head has no typed trace links in the current link web, so no rationale view is rendered.',
              action: 'Open the timeline to see the chains that carry rationale.',
            })}
          />
        )}
      </div>
    </PageShell>
  );
}
