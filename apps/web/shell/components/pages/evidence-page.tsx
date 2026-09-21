/**
 * The Evidence page — every record grouped under its DISTINCT truth state
 * (all six groups always rendered; empty groups render the EMPTY state
 * block), with provenance, producer, method and the model-output mark.
 * Coverage honesty: unreachable sources stay explicitly unavailable.
 */

import Link from 'next/link';
import { evidenceTruthStateLabel } from '@sos-2/web-contracts';
import { PageShell, PageHeading } from '../page-shell';
import { Card, Row } from '../card';
import { TruthStateChip, ValueChip } from '../chips';
import { StateBlockView } from '../state-block';
import { emptySectionBlock } from '../../view-state/state-selection';
import { rationaleHref, views } from '../../view-state/demo-data';

export function EvidencePage() {
  const fixtureRevision = views.source.kind === 'DEMO' ? views.source.fixture_revision : undefined;
  const quality = views.evidenceQuality;
  return (
    <PageShell section="evidence">
      <PageHeading
        title="Evidence"
        intro="What SOS knows, grouped by the six distinct truth states. Unknown, failed, unavailable and unsupported stay distinct — never conflated, never guessed."
        demoRevision={fixtureRevision}
      />
      <div className="space-y-4">
        <Card
          id="evidence-quality"
          title="Quality at a glance"
          chip={<ValueChip label="records" value={String(quality.total)} />}
          demoRevision={fixtureRevision}
          rationaleHref={rationaleHref(quality.core.subject_id)}
        >
          <ul className="flex flex-wrap gap-2" aria-label="Counts per truth state">
            {views.evidenceGroups.map((group) => (
              <li key={group.state} className="flex items-center gap-1.5">
                <TruthStateChip state={group.state} />
                <span className="text-sm font-semibold text-ink">{String(group.records.length)}</span>
              </li>
            ))}
          </ul>
          {quality.coverage_block !== null ? <div className="mt-3"><StateBlockView block={quality.coverage_block} /></div> : null}
        </Card>

        {views.evidenceGroups.map((group) => (
          <Card
            key={group.state}
            id={`evidence-group-${group.state.toLowerCase()}`}
            title={`${evidenceTruthStateLabel(group.state)} evidence`}
            chip={<ValueChip label="records" value={String(group.records.length)} />}
            demoRevision={fixtureRevision}
          >
            {group.records.length === 0 ? (
              <StateBlockView block={emptySectionBlock(`evidence-${group.state.toLowerCase()}`, `Evidence with truth state ${group.state}`)} />
            ) : (
              <ul className="space-y-2">
                {group.records.map((record) => (
                  <li key={record.id} className="rounded-lg border border-line bg-surface p-3">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink">{record.kind}</span>
                      <ValueChip label="method" value={record.method} title="How the truth state was assigned — explicit, never guessed." />
                      {record.llm_output ? <span className="text-xs font-medium text-warn">model output — never authoritative</span> : null}
                    </p>
                    <p className="mt-1 text-xs text-ink-soft">
                      About <Link href={rationaleHref(record.subject_ref)} className="font-mono underline-offset-2 hover:underline">{record.subject_ref}</Link>
                      {' · '}window {record.window !== null ? `${record.window.start} → ${record.window.end}` : 'not declared'}
                    </p>
                    <p className="mt-1 text-xs text-ink-soft">
                      Produced by <span className="font-medium text-ink">{record.producer.tool}</span>
                      {record.producer.environment !== null ? ` in ${record.producer.environment}` : ''} · provenance {record.provenance.join('; ')}
                    </p>
                    <p className="mt-1">
                      <Link href={rationaleHref(record.id)} className="inline-flex min-h-[44px] items-center rounded-md px-1 text-xs font-medium text-epistemic underline-offset-2 hover:underline">
                        Why this record says what it says
                      </Link>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}

        <Card id="evidence-discipline" title="Reading the truth states" demoRevision={fixtureRevision}>
          <dl>
            <Row label="Unknown">The answer is not known yet. No value is guessed and none is shown in its place.</Row>
            <Row label="Unavailable">A source cannot be reached right now. It stays explicitly unavailable — never folded into failure or success.</Row>
            <Row label="Unsupported">The kind of measurement is not supported by the source at all.</Row>
            <Row label="Partial">Only part of the measurement is available; the missing part is named.</Row>
          </dl>
        </Card>
      </div>
    </PageShell>
  );
}
