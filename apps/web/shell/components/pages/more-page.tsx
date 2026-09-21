/**
 * The More page — the full section index (including ASK), the authority
 * detail, the data-source status (what is DEMO, what is not connected),
 * keyboard help and the about blurb. Serves both the mobile "More" tab and
 * the desktop rail's ninth item.
 */

import Link from 'next/link';
import { moreIndexItems } from '@sos-2/web-contracts';
import { PageShell, PageHeading } from '../page-shell';
import { Card, Row } from '../card';
import { ValueChip } from '../chips';
import { StateBlockView } from '../state-block';
import { notConnectedBlock } from '../../view-state/state-selection';
import { views } from '../../view-state/demo-data';

export function MorePage() {
  const fixtureRevision = views.source.kind === 'DEMO' ? views.source.fixture_revision : undefined;
  return (
    <PageShell section="more">
      <PageHeading
        title="More"
        intro="Every section of the console, the authority detail, what is demo versus live, and keyboard help."
        demoRevision={fixtureRevision}
      />
      <div className="space-y-4">
        <Card id="more-index" title="All sections" demoRevision={fixtureRevision}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {moreIndexItems().map((item) => (
              <li key={item.section}>
                <Link
                  href={item.href}
                  className="flex min-h-[44px] flex-col justify-center rounded-lg border border-line bg-surface px-3 py-2 hover:border-line-strong hover:bg-surface-warm"
                >
                  <span className="text-sm font-medium text-ink">{item.label}</span>
                  <span className="text-xs text-ink-soft">{item.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card id="more-authority" title="Authority" demoRevision={fixtureRevision}>
          <dl>
            <Row label="Mode">
              {views.authorityMode.label}
              <span className="block text-ink-soft">{views.authorityMode.note}</span>
            </Row>
            <Row label="Held grants">
              <ul className="space-y-1 text-xs">
                <li>
                  <span className="font-mono">{views.world.grants.mission_revision.envelope.id}</span> — REVISE Mission (time-bound)
                </li>
                <li>
                  <span className="font-mono">{views.world.grants.promotion.envelope.id}</span> — PROMOTE the current candidate (time-bound)
                </li>
                <li>
                  <span className="font-mono">{views.world.grants.retirement.envelope.id}</span> — RETIRE the legacy adapter (time-bound)
                </li>
              </ul>
            </Row>
            <Row label="Principles">
              Bodies cannot mint or widen authority. Authentication identity and SOS authority grants stay separate.
              LLM output is never authorization.
            </Row>
          </dl>
        </Card>

        <Card id="more-data-source" title="Data sources" demoRevision={fixtureRevision}>
          <p className="text-sm text-ink">
            Every surface in this build renders the fixed <span className="font-medium">demo dataset</span> —
            revision <code className="rounded bg-surface-warm px-1 py-0.5">{fixtureRevision}</code>.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
            <li className="flex flex-wrap items-center gap-2">
              <ValueChip label="mission · system · evidence · tasks" value="DEMO — SIMULATED DATA" />
            </li>
          </ul>
          <div className="mt-3 space-y-2">
            <StateBlockView block={notConnectedBlock('live-mission-store', 'The live mission/system store')} />
            <StateBlockView block={notConnectedBlock('live-observation-events', 'Live observation events')} />
          </div>
        </Card>

        <Card id="more-keyboard" title="Keyboard and accessibility" demoRevision={fixtureRevision}>
          <dl>
            <Row label="Skip link">Tab into the page and activate "Skip to main content" to jump past the navigation.</Row>
            <Row label="Navigation">Tab through rail and tab-bar links; the active section carries aria-current="page".</Row>
            <Row label="Details">Task and rationale detail sheets are native disclosures — focus and press Enter to open or close.</Row>
            <Row label="Landmarks">Every page has one header, nav, main and footer landmark; headings follow a single h1 hierarchy.</Row>
            <Row label="Status">Status is never color-only: every chip renders a glyph and a text label; uncertainty gets the separate dashed epistemic treatment.</Row>
          </dl>
        </Card>

        <Card id="more-about" title="About this build" demoRevision={fixtureRevision}>
          <p className="text-sm text-ink-soft">
            The SOS console shell (Work Order P1). The deterministic reference console for the frozen core lives
            separately; this is the production product surface. Every consequential card links to a rationale view
            answering: What is happening? Why does SOS believe this? What evidence supports it? What uncertainty
            remains? What authority is required? What can happen next?
          </p>
        </Card>
      </div>
    </PageShell>
  );
}
