/**
 * The ASK page — the actionable inbox (P18: human ASK remains first-class).
 * A question only a human can answer, with everything a decider needs: the
 * exact decision requested, alternatives, evidence quality, uncertainty,
 * trade-offs, risk, and why current authority is insufficient. ASK is a
 * SUCCESS state — a valid first-class outcome, never an error.
 */

import Link from 'next/link';
import { PageShell, PageHeading } from '../page-shell';
import { Card, Row } from '../card';
import { ValueChip } from '../chips';
import { StateBlockView } from '../state-block';
import { rationaleHref, views } from '../../view-state/demo-data';

export function AskPage() {
  const ask = views.askView;
  const content = ask.request.content;
  const fixtureRevision = views.source.kind === 'DEMO' ? views.source.fixture_revision : undefined;
  return (
    <PageShell section="ask">
      <PageHeading
        title="ASK"
        intro="Questions waiting for a human decision. ASK is a success state: when observation cannot decide, asking is the right outcome."
        demoRevision={fixtureRevision}
      />
      <div className="space-y-4">
        <Card
          id="ask-open"
          title="Open question"
          chip={<ValueChip label="queue" value={`${String(ask.queue_size)} pending`} />}
          demoRevision={fixtureRevision}
          rationaleHref={rationaleHref(ask.request.envelope.id)}
        >
          <p className="text-base font-medium text-ink">{content.decision}</p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            <ValueChip label="priority" value={ask.context.priority} />
            <ValueChip label="raised" value={ask.request.envelope.created_at} />
          </p>
          <p className="mt-3 text-sm text-ink">{content.uncertainty.basis}</p>
        </Card>

        <Card id="ask-alternatives" title="Alternatives" demoRevision={fixtureRevision}>
          <ol className="space-y-2">
            {content.alternatives.map((alternative) => (
              <li key={alternative.id} className="rounded-lg border border-line bg-surface p-3">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">{alternative.id}</span>
                  <ValueChip label="action" value={alternative.action} />
                </p>
                <p className="mt-1 text-sm text-ink-soft">{alternative.description}</p>
              </li>
            ))}
          </ol>
          <div className="mt-4">
            <StateBlockView
              block={{
                kind: 'UNAVAILABLE',
                surface: 'resolve-ask',
                statement: 'Choosing an alternative is a real authority action.',
                present: null,
                missing: null,
                action: 'In this console build the answer cannot be recorded here — the resolution flow arrives with the live authority plane. Everything needed to decide is shown above.',
              }}
            />
          </div>
        </Card>

        <Card id="ask-context" title="What the decider needs to see" demoRevision={fixtureRevision} rationaleHref={rationaleHref(ask.decision.envelope.id)}>
          <dl>
            <Row label="Why authority is insufficient">
              {content.authority_insufficiency}
            </Row>
            <Row label="Trade-offs">
              <ul className="list-inside list-disc">
                {content.trade_offs.map((tradeOff) => (
                  <li key={tradeOff}>{tradeOff}</li>
                ))}
              </ul>
            </Row>
            <Row label="Risk profile">
              <span className="flex flex-wrap gap-1.5">
                <ValueChip label="impact" value={ask.context.decision_request.impact} />
                <ValueChip label="risk" value={ask.context.decision_request.risk} />
                <ValueChip label="reversibility" value={ask.context.decision_request.reversibility} />
                <ValueChip label="blast radius" value={ask.context.decision_request.blast_radius} />
              </span>
            </Row>
            <Row label="Evidence">
              <Link href={rationaleHref(ask.decision.content.evidence_refs[0] ?? ask.request.envelope.id)} className="font-mono text-xs text-epistemic underline-offset-2 hover:underline">
                {ask.decision.content.evidence_refs[0] ?? 'no evidence refs'}
              </Link>
              <span className="ml-2 text-ink-soft">legacy-adapter telemetry shows zero traffic in the current window</span>
            </Row>
          </dl>
        </Card>
      </div>
    </PageShell>
  );
}
