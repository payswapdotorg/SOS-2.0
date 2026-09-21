/**
 * The advanced raw-JSON import surface (Work Order P4): the typed
 * escape hatch for machine-written mission drafts — clearly secondary
 * to the guided journeys (the hub and the copy say so). Zero client
 * JavaScript: a native GET form carries the pasted JSON to the same
 * route; the domain validator is the single authority; the same
 * explicit REVISE-class confirmation gate applies.
 */

import { PageShell, PageHeading } from '../../../shell/components/page-shell';
import { Card } from '../../../shell/components/card';
import {
  GuidanceList,
  PrimaryAction,
  ReviewQuestionsBlock,
  SecondaryLink,
  ValidationList,
} from './shared';
import {
  advancedDraftFromSearchParams,
  advancedImportView,
  fixtureAdvancedDraft,
  type OnboardingSearchParams,
} from '../view-state/onboarding-views';

/** The advanced import surface. */
export function AdvancedImportSurface({ params }: { params: OnboardingSearchParams }) {
  const draft = advancedDraftFromSearchParams(params);
  const view = advancedImportView(draft);
  const fixtureRevision = view.core.data_source.kind === 'DEMO' ? view.core.data_source.fixture_revision : undefined;

  return (
    <PageShell section="mission">
      <PageHeading
        title="Advanced: import raw JSON"
        intro="The escape hatch for machine-written mission drafts — clearly secondary: the guided journeys are the primary paths."
        demoRevision={fixtureRevision}
      />
      <form method="get" action="/onboarding/advanced" aria-labelledby="advanced-import-heading">
        <Card id="advanced-import" title="Raw mission JSON" demoRevision={fixtureRevision}>
          <GuidanceList
            guidance={[
              'Paste a mission content JSON draft (purpose, goals, outcomes, stakeholders, measures, constraints).',
              'The draft is trusted only after the domain validator accepts it AND you confirm your authority — never before.',
            ]}
          />
          <div className="space-y-1">
            <label htmlFor="raw" className="block text-sm font-medium text-ink">
              Mission JSON
            </label>
            <textarea
              id="raw"
              name="raw"
              rows={12}
              defaultValue={draft.raw_text ?? ''}
              className="min-h-[44px] w-full rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-xs text-ink"
              placeholder={fixtureAdvancedDraft().raw_text ?? '{}'}
            />
          </div>
          <div className="mt-4 flex items-start gap-3">
            <input id="authority" name="authority" type="checkbox" value="true" defaultChecked={draft.authority_confirmed} className="mt-1 size-6 rounded border-line-strong" />
            <label htmlFor="authority" className="text-sm font-medium text-ink">
              I confirm my authority to formalize this mission from raw JSON (the REVISE permission).
              <span className="mt-1 block text-xs font-normal text-ink-soft">The same explicit gate as the guided journey — never implied.</span>
            </label>
          </div>
        </Card>
        <div className="mt-4">
          <PrimaryAction label="Validate and formalize" />
        </div>
      </form>
      <ValidationList errors={view.validation} label="Advanced import findings" />
      <ReviewQuestionsBlock core={view.core} />
      <p className="mt-4">
        <SecondaryLink href="/onboarding" label="Back to onboarding" />
      </p>
    </PageShell>
  );
}
