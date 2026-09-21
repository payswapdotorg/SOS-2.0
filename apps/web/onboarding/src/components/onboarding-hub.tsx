/**
 * The onboarding hub (Work Order P4): the first-land surface at
 * /onboarding — the two guided journeys (greenfield mission-first;
 * brownfield import), the advanced raw-JSON mode (clearly secondary),
 * and the provider-neutral connection state shown honestly (the real
 * system NOT_YET_CONNECTED; the reference provider SIMULATED and
 * badged).
 *
 * A fresh user needs no SOS artifact names: three plain-language cards
 * with what/why/next-action, the DEMO badge on every fixture-backed
 * surface, and the P1 shell landmarks.
 */

import { PageShell, PageHeading } from '../../../shell/components/page-shell';
import { Card } from '../../../shell/components/card';
import { ConnectionCard, SecondaryLink } from './shared';
import { fixtureConnection } from '../view-state/onboarding-views';

/** The onboarding hub surface. */
export function OnboardingHub() {
  const fixtureRevision = fixtureConnection.data_source.kind === 'DEMO' ? fixtureConnection.data_source.fixture_revision : undefined;
  return (
    <PageShell section="mission">
      <PageHeading
        title="Onboarding"
        intro="Start here. Shape a mission and connect a GitHub repository — empty or existing — without knowing any SOS artifact names."
        demoRevision={fixtureRevision}
      />
      <div className="space-y-4">
        <Card id="onboarding-greenfield" title="Start a mission" demoRevision={fixtureRevision}>
          <p className="text-sm text-ink">
            A guided, resumable journey: purpose → outcomes → stakeholders → measures → constraints → review → your explicit authority confirmation → the GitHub connection.
          </p>
          <p className="mt-1 text-sm text-ink-soft">Best when you are starting fresh — including from an empty repository.</p>
          <p className="mt-3">
            <SecondaryLink href="/onboarding/greenfield" label="Start the greenfield journey" />
          </p>
        </Card>
        <Card id="onboarding-brownfield" title="Import an existing system" demoRevision={fixtureRevision}>
          <p className="text-sm text-ink">
            Import a GitHub repository (or runtime), scan the evidence honestly — partial stays partial — review the COMPETING architecture readings, and confirm one.
          </p>
          <p className="mt-1 text-sm text-ink-soft">Best when something already exists and SOS should understand it first.</p>
          <p className="mt-3">
            <SecondaryLink href="/onboarding/brownfield" label="Start the brownfield import" />
          </p>
        </Card>
        <Card id="onboarding-advanced" title="Advanced: raw JSON import" demoRevision={fixtureRevision}>
          <p className="text-sm text-ink">Paste a machine-written mission draft as JSON — typed validation, the same authority gate, clearly secondary to the guided journeys.</p>
          <p className="mt-3">
            <SecondaryLink href="/onboarding/advanced" label="Open the advanced import" />
          </p>
        </Card>
        <ConnectionCard connection={fixtureConnection} />
      </div>
    </PageShell>
  );
}
