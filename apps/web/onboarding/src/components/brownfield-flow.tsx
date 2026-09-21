/**
 * The brownfield import flow (Work Order P4): GitHub repository/runtime
 * import → evidence scan → competing architecture hypotheses →
 * confirmation.
 *
 * Zero client JavaScript (native GET forms; the gates — hypothesis
 * selection and the explicit confirmation — are carried in the URL).
 * The scan phases render the frozen truth-state vocabulary with the
 * first-class state blocks (a page never shows a blank hole); the
 * competing hypotheses render as a SET with their uncertainty — never
 * collapsed to a single winner. The fixture journey is the
 * legacy-checkout import (DEMO-badged); the confirmation gate requires
 * the same explicit REVISE-class authority as the greenfield journey.
 */

import { PageShell, PageHeading } from '../../../shell/components/page-shell';
import { Card, Row } from '../../../shell/components/card';
import { StateBlockView } from '../../../shell/components/state-block';
import { ValueChip } from '../../../shell/components/chips';
import type { BrownfieldStage } from '../../../../../packages/web-contracts/onboarding/src/index';
import {
  brownfieldCurrentStage,
  brownfieldStageLabel,
} from '../../../../../packages/web-contracts/onboarding/src/index';
import {
  ConnectionCard,
  GuidanceList,
  PrimaryAction,
  ReviewQuestionsBlock,
  SecondaryLink,
  StageProgress,
  ValidationList,
} from './shared';
import {
  brownfieldStageView,
  brownfieldStateFromSearchParams,
  fixtureRepositoryChoices,
  type OnboardingSearchParams,
} from '../view-state/onboarding-views';

const STAGE_ORDER: BrownfieldStage[] = ['REPOSITORY_IMPORT', 'EVIDENCE_SCAN', 'COMPETING_HYPOTHESES', 'CONFIRMATION', 'CONFIRMED'];
const STEP_LABELS = STAGE_ORDER.map((stage) => brownfieldStageLabel(stage));

/** The brownfield flow surface. */
export function BrownfieldFlow({ params }: { params: OnboardingSearchParams }) {
  const state = brownfieldStateFromSearchParams(params);
  const requestedRaw = typeof params['stage'] === 'string' ? params['stage'].toUpperCase() : undefined;
  const requestedStage = requestedRaw !== undefined ? (requestedRaw as BrownfieldStage) : undefined;
  const currentStage: BrownfieldStage =
    requestedStage !== undefined && STAGE_ORDER.includes(requestedStage) ? requestedStage : brownfieldCurrentStage(state);
  const view = brownfieldStageView(currentStage, state);
  const fixtureRevision = view.core.data_source.kind === 'DEMO' ? view.core.data_source.fixture_revision : undefined;

  return (
    <PageShell section="mission">
      <PageHeading
        title="Import an existing system"
        intro="Start from what exists: import a GitHub repository (or runtime), scan the evidence honestly, review the COMPETING architecture readings, and confirm one — the set is never collapsed for you."
        demoRevision={fixtureRevision}
      />
      <StageProgress steps={STEP_LABELS} currentIndex={STAGE_ORDER.indexOf(currentStage)} />
      <div className="space-y-4">
        {currentStage === 'REPOSITORY_IMPORT' ? (
          <form method="get" action="/onboarding/brownfield" aria-labelledby="brownfield-import-heading">
            <Card id="brownfield-import" title="Repository import" demoRevision={fixtureRevision}>
              <GuidanceList guidance={['Pick the repository to import — the fixture discovery list is shown (DEMO); the live discovery runs against the connected provider.']} />
              <fieldset className="space-y-2">
                <legend className="sr-only">Repository to import</legend>
                {fixtureRepositoryChoices().map((choice) => (
                  <div key={choice.slug} className="flex items-center gap-3">
                    <input
                      id={`brownfield-repo-${choice.slug.replace('/', '-')}`}
                      name="repo"
                      type="radio"
                      value={choice.slug}
                      defaultChecked={state.source !== null && `${state.source.owner}/${state.source.name}` === choice.slug}
                      className="size-6 border-line-strong"
                    />
                    <label htmlFor={`brownfield-repo-${choice.slug.replace('/', '-')}`} className="text-sm text-ink">
                      {choice.label}
                    </label>
                  </div>
                ))}
              </fieldset>
            </Card>
            <div className="mt-4">
              <PrimaryAction label="Import and run the evidence scan" />
            </div>
          </form>
        ) : null}

        {currentStage === 'EVIDENCE_SCAN' && state.scan !== null ? (
          <Card id="brownfield-scan" title="Evidence scan" demoRevision={fixtureRevision}>
            <Row label="Imported">
              {`${state.scan.repository.owner}/${state.scan.repository.name} @ ${state.scan.repository.branch} (${state.scan.repository.head_sha.slice(0, 12)}…)`}
            </Row>
            <div className="mt-3 space-y-2">
              {state.scan.phases.map((phase) => (
                <div key={phase.area} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">{phase.area}</p>
                    <ValueChip label="Truth state" value={phase.truth_state} />
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">{phase.statement}</p>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <StateBlockView block={state.scan.coverage_block} />
            </div>
            <p className="mt-3">
              <SecondaryLink href="/onboarding/brownfield" label="Change the imported repository" />
            </p>
          </Card>
        ) : null}

        {currentStage === 'COMPETING_HYPOTHESES' && state.hypotheses.length > 0 ? (
          <form method="get" action="/onboarding/brownfield" aria-labelledby="brownfield-hypotheses-heading">
            <input type="hidden" name="repo" value={`${state.source?.owner}/${state.source?.name}`} />
            <Card id="brownfield-hypotheses" title="Competing architecture hypotheses" demoRevision={fixtureRevision}>
              <GuidanceList guidance={['Ambiguity is honest: the scan recovered COMPETING readings — select the one to proceed with; the full set stays retained either way.']} />
              <fieldset className="space-y-3">
                <legend className="sr-only">Hypothesis selection</legend>
                {state.hypotheses.map((hypothesis) => (
                  <div key={hypothesis.hypothesis_id} className="rounded-lg border border-line p-3">
                    <div className="flex items-start gap-3">
                      <input
                        id={`hypothesis-${hypothesis.hypothesis_id.slice(-8)}`}
                        name="hypothesis"
                        type="radio"
                        value={hypothesis.hypothesis_id}
                        defaultChecked={state.selected_hypothesis_id === hypothesis.hypothesis_id}
                        className="mt-1 size-6 border-line-strong"
                      />
                      <div>
                        <label htmlFor={`hypothesis-${hypothesis.hypothesis_id.slice(-8)}`} className="text-sm font-semibold text-ink">
                          {hypothesis.label}
                          <span className="sr-only">{` — hypothesis ${hypothesis.hypothesis_id}`}</span>
                        </label>
                        <p className="mt-1 text-sm text-ink">{hypothesis.statement}</p>
                        <p className="mt-1 text-sm text-ink-soft">{`Basis: ${hypothesis.basis}`}</p>
                        <p className="mt-1 text-xs text-ink-soft">{`Uncertainty (${hypothesis.uncertainty.uncertainty_class}): ${hypothesis.uncertainty.statement}`}</p>
                        <p className="mt-1 text-xs text-ink-soft">
                          <code className="rounded bg-surface-warm px-1 py-0.5">{hypothesis.hypothesis_id}</code>
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </fieldset>
            </Card>
            <div className="mt-4">
              <PrimaryAction label="Continue to the confirmation gate" />
            </div>
          </form>
        ) : null}

        {currentStage === 'CONFIRMATION' && state.source !== null ? (
          <form method="get" action="/onboarding/brownfield" aria-labelledby="brownfield-confirmation-heading">
            <input type="hidden" name="repo" value={`${state.source.owner}/${state.source.name}`} />
            {state.selected_hypothesis_id !== null ? <input type="hidden" name="hypothesis" value={state.selected_hypothesis_id} /> : null}
            <Card id="brownfield-confirmation" title="Confirmation" demoRevision={fixtureRevision}>
              <GuidanceList guidance={['Adopting a reading into System State is a durable semantic write — it requires your explicit REVISE-class confirmation; the gate never closes itself.']} />
              <div className="flex items-start gap-3">
                <input id="confirmed" name="confirmed" type="checkbox" value="true" defaultChecked={state.confirmed} className="mt-1 size-6 rounded border-line-strong" />
                <label htmlFor="confirmed" className="text-sm font-medium text-ink">
                  I confirm my authority to import this repository state into System State (the REVISE permission).
                  <span className="mt-1 block text-xs font-normal text-ink-soft">The competing set stays retained — confirming one reading never erases the others.</span>
                </label>
              </div>
            </Card>
            <div className="mt-4">
              <PrimaryAction label="Confirm and link into System State" />
            </div>
          </form>
        ) : null}

        {currentStage === 'CONFIRMED' && state.source !== null ? (
          <>
            <Card id="brownfield-confirmed" title="Confirmed and linked" demoRevision={fixtureRevision}>
              <Row label="Imported">
                {`${state.source.owner}/${state.source.name} @ ${state.source.branch} (${state.source.head_sha.slice(0, 12)}…)`}
              </Row>
              <Row label="Selected reading">
                {state.selected_hypothesis_id === null
                  ? '—'
                  : state.hypotheses.find((hypothesis) => hypothesis.hypothesis_id === state.selected_hypothesis_id)?.label ?? state.selected_hypothesis_id}
              </Row>
              <p className="mt-3 text-xs text-ink-soft">
                DEMO — SIMULATED DATA: the confirmed reading links the exact repository revision into System State in the live path; this surface renders the fixture journey.
              </p>
            </Card>
            <ConnectionCard connection={view.core.data_source.kind === 'DEMO' ? { state: 'CONNECTED_SIMULATED', simulated: true, requested_scopes: ['repository:metadata:read', 'repository:contents:read'], provider_note: 'SIMULATED connection over the in-memory reference provider — least-privilege read scopes granted. This is never presented as a real GitHub connection.', data_source: view.core.data_source } : { state: 'NOT_YET_CONNECTED', simulated: false, requested_scopes: [], provider_note: '', data_source: view.core.data_source }} />
          </>
        ) : null}
      </div>
      <ValidationList errors={view.validation} label="Brownfield journey findings" />
      <ReviewQuestionsBlock core={view.core} />
      <p className="mt-4">
        <SecondaryLink href="/onboarding" label="Back to onboarding" />
      </p>
    </PageShell>
  );
}
