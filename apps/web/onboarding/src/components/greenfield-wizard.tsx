/**
 * The greenfield wizard (Work Order P4): the step-by-step, resumable
 * mission-first journey — purpose → outcomes → stakeholders → measures
 * → constraints → review → authority confirmation → GitHub connection
 * → persisted.
 *
 * ZERO client JavaScript: every step is a native GET form whose fields
 * accumulate the journey state in the URL (resumable by URL, shareable,
 * back-button friendly), submitted to the same route and rendered
 * server-side from the pure onboarding projections. Validation errors
 * are the projections' typed findings (role=alert, actionable text —
 * never color-only). The authority confirmation is an explicit gate
 * (a checkbox the user must check; it never closes itself). The GitHub
 * connection step shows the provider-neutral connection state honestly
 * (SIMULATED reference provider, clearly badged; the real system stays
 * NOT_YET_CONNECTED). The persisted step shows the exact spine ids and
 * the linked repository revision under the DEMO badge — the durable
 * live-store write is exercised by the deterministic journey tests.
 *
 * Accessibility: labels bound with htmlFor/id, fieldsets with legends,
 * 44px touch targets on every interactive element, aria-describedby on
 * inputs with findings, landmarks from the P1 page shell.
 */

import { PageShell, PageHeading } from '../../../shell/components/page-shell';
import { Card, Row } from '../../../shell/components/card';
import { ValueChip } from '../../../shell/components/chips';
import {
  GREENFIELD_STAGES,
  formalizeMissionContent,
  greenfieldCurrentStage,
  greenfieldStageLabel,
} from '../../../../../packages/web-contracts/onboarding/src/index';
import type { GreenfieldStage } from '../../../../../packages/web-contracts/onboarding/src/index';
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
  fixtureRepositoryChoices,
  greenfieldDraftFromSearchParams,
  greenfieldResultView,
  greenfieldStageView,
  type OnboardingSearchParams,
} from '../view-state/onboarding-views';

const STAGE_KEYS = [...GREENFIELD_STAGES] as GreenfieldStage[];
const STEP_LABELS = STAGE_KEYS.map((stage) => greenfieldStageLabel(stage));

/** Which param prefixes each stage OWNS (its visible inputs); everything else is carried as hidden state. */
const STAGE_PARAM_PREFIXES: Record<GreenfieldStage, string[]> = {
  PURPOSE: ['purpose'],
  OUTCOMES: ['od', 'og'],
  STAKEHOLDERS: ['sn', 'si'],
  MEASURES: ['md', 'mt', 'mu'],
  CONSTRAINTS: ['cs', 'ch'],
  REVIEW: [],
  AUTHORITY_CONFIRMATION: ['authority'],
  GITHUB_CONNECTION: ['repo'],
  PERSISTED: [],
};

/** Render the accumulated journey state as hidden inputs (minus the current stage's own fields). */
function HiddenState({ params, stage }: { params: OnboardingSearchParams; stage: GreenfieldStage }) {
  const owned = STAGE_PARAM_PREFIXES[stage];
  const entries = Object.entries(params).filter(([key]) => {
    if (key === 'stage') {
      return false;
    }
    const value = key.replace(/[0-9]+$/, '');
    return !owned.some((prefix) => key === prefix || key.startsWith(prefix));
  });
  const seen = new Set<string>();
  const inputs = entries.flatMap(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    return values
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => {
        const identity = `${key}=${entry}`;
        if (seen.has(identity)) {
          return null;
        }
        seen.add(identity);
        return <input key={identity} type="hidden" name={key} value={entry} />;
      });
  });
  return <>{inputs.filter((input) => input !== null)}</>;
}

/** The wizard surface. `params` is the awaited searchParams forwarded by the thin route wrapper. */
export function GreenfieldWizard({ params }: { params: OnboardingSearchParams }) {
  const draft = greenfieldDraftFromSearchParams(params);
  const requestedRaw = typeof params['stage'] === 'string' ? params['stage'].toUpperCase() : undefined;
  const requestedStage = requestedRaw !== undefined ? (requestedRaw as GreenfieldStage) : undefined;
  const currentStage: GreenfieldStage =
    requestedStage !== undefined && STAGE_KEYS.includes(requestedStage) ? requestedStage : greenfieldCurrentStage(draft);
  const view = greenfieldStageView(currentStage, draft);
  const fixtureRevision = view.core.data_source.kind === 'DEMO' ? view.core.data_source.fixture_revision : undefined;

  return (
    <PageShell section="mission">
      <PageHeading
        title="Start a mission"
        intro="A mission-first journey: state the purpose, shape the outcomes, and connect a GitHub repository — empty or existing. No SOS artifact names required."
        demoRevision={fixtureRevision}
      />
      <StageProgress steps={STEP_LABELS} currentIndex={STAGE_KEYS.indexOf(currentStage)} />
      <div className="space-y-4">
        {currentStage === 'PURPOSE' ? <PurposeForm params={params} /> : null}
        {currentStage === 'OUTCOMES' ? <OutcomesForm params={params} /> : null}
        {currentStage === 'STAKEHOLDERS' ? <StakeholdersForm params={params} /> : null}
        {currentStage === 'MEASURES' ? <MeasuresForm params={params} /> : null}
        {currentStage === 'CONSTRAINTS' ? <ConstraintsForm params={params} /> : null}
        {currentStage === 'REVIEW' ? <ReviewCard params={params} draftValid={view.validation.length === 0} /> : null}
        {currentStage === 'AUTHORITY_CONFIRMATION' ? <AuthorityForm params={params} /> : null}
        {currentStage === 'GITHUB_CONNECTION' ? <ConnectionForm params={params} /> : null}
        {currentStage === 'PERSISTED' ? <PersistedCard draft={draft} /> : null}
      </div>
      <ValidationList errors={view.validation} label="Greenfield journey findings" />
      <ReviewQuestionsBlock core={view.core} />
      <p className="mt-4">
        <SecondaryLink href="/onboarding" label="Back to onboarding" />
      </p>
    </PageShell>
  );
}

type FormProps = { params: OnboardingSearchParams };

function PurposeForm({ params }: FormProps) {
  const draft = greenfieldDraftFromSearchParams(params);
  return (
    <form method="get" action="/onboarding/greenfield" aria-labelledby="greenfield-purpose-heading">
      <HiddenState params={params} stage="PURPOSE" />
      <Card id="greenfield-purpose" title="Purpose" demoRevision={undefined}>
        <GuidanceList
          guidance={[
            'One honest sentence: why does this mission exist?',
            'A fresh user never needs SOS artifact names — product language is enough.',
          ]}
        />
        <div className="space-y-1">
          <label htmlFor="purpose" className="block text-sm font-medium text-ink">
            Purpose
          </label>
          <textarea
            id="purpose"
            name="purpose"
            rows={3}
            defaultValue={draft.purpose ?? ''}
            className="min-h-[44px] w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
            placeholder="e.g. Give our small team a continuously-improving checkout service that stays comprehensible."
          />
        </div>
      </Card>
      <div className="mt-4">
        <PrimaryAction label="Continue to outcomes" />
      </div>
    </form>
  );
}

function OutcomesForm({ params }: FormProps) {
  const draft = greenfieldDraftFromSearchParams(params);
  return (
    <form method="get" action="/onboarding/greenfield" aria-labelledby="greenfield-outcomes-heading">
      <HiddenState params={params} stage="OUTCOMES" />
      <Card id="greenfield-outcomes" title="Outcomes">
        <GuidanceList guidance={['What should be true afterwards? Each outcome may carry goal statements (separate several with a semicolon).', 'Up to three outcomes in this wizard — the underlying journey model supports any list.']} />
        <div className="space-y-4">
          {[0, 1, 2].map((index) => (
            <fieldset key={index} className="space-y-2 rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-medium text-ink-soft">{`Outcome ${index + 1}${index === 0 ? ' (required)' : ' (optional)'}`}</legend>
              <div className="space-y-1">
                <label htmlFor={`od${index}`} className="block text-sm font-medium text-ink">
                  {`Outcome ${index + 1} description`}
                </label>
                <input
                  id={`od${index}`}
                  name={`od${index}`}
                  type="text"
                  defaultValue={draft.outcomes[index]?.description ?? ''}
                  className="min-h-[44px] w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink"
                  placeholder={index === 0 ? 'e.g. Checkout completes for EU customers without babysitting deploys.' : ''}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={`og${index}`} className="block text-sm font-medium text-ink">
                  {`Goal statements for outcome ${index + 1} (semicolon-separated, optional)`}
                </label>
                <input
                  id={`og${index}`}
                  name={`og${index}`}
                  type="text"
                  defaultValue={draft.outcomes[index]?.goals.join('; ') ?? ''}
                  className="min-h-[44px] w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink"
                  placeholder="e.g. Keep checkout dependable while the team stays small"
                />
              </div>
            </fieldset>
          ))}
        </div>
      </Card>
      <div className="mt-4">
        <PrimaryAction label="Continue to stakeholders" />
      </div>
    </form>
  );
}

function StakeholdersForm({ params }: FormProps) {
  const draft = greenfieldDraftFromSearchParams(params);
  return (
    <form method="get" action="/onboarding/greenfield" aria-labelledby="greenfield-stakeholders-heading">
      <HiddenState params={params} stage="STAKEHOLDERS" />
      <Card id="greenfield-stakeholders" title="Stakeholders">
        <GuidanceList guidance={['Who does this mission serve, and what do they need?']} />
        <div className="space-y-4">
          {[0, 1, 2].map((index) => (
            <fieldset key={index} className="space-y-2 rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-medium text-ink-soft">{`Stakeholder ${index + 1}${index === 0 ? ' (required)' : ' (optional)'}`}</legend>
              <div className="space-y-1">
                <label htmlFor={`sn${index}`} className="block text-sm font-medium text-ink">
                  {`Stakeholder ${index + 1} name`}
                </label>
                <input
                  id={`sn${index}`}
                  name={`sn${index}`}
                  type="text"
                  defaultValue={draft.stakeholders[index]?.name ?? ''}
                  className="min-h-[44px] w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink"
                  placeholder={index === 0 ? 'e.g. Shoppers' : ''}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={`si${index}`} className="block text-sm font-medium text-ink">
                  {`What they need (optional)`}
                </label>
                <input
                  id={`si${index}`}
                  name={`si${index}`}
                  type="text"
                  defaultValue={draft.stakeholders[index]?.interest ?? ''}
                  className="min-h-[44px] w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink"
                  placeholder="e.g. Checkout always works, fast."
                />
              </div>
            </fieldset>
          ))}
        </div>
      </Card>
      <div className="mt-4">
        <PrimaryAction label="Continue to measures" />
      </div>
    </form>
  );
}

function MeasuresForm({ params }: FormProps) {
  const draft = greenfieldDraftFromSearchParams(params);
  return (
    <form method="get" action="/onboarding/greenfield" aria-labelledby="greenfield-measures-heading">
      <HiddenState params={params} stage="MEASURES" />
      <Card id="greenfield-measures" title="Measures">
        <GuidanceList guidance={['How will you know the mission is working? Targets and units are optional while unformalized — they stay honestly empty.']} />
        <div className="space-y-4">
          {[0, 1, 2].map((index) => (
            <fieldset key={index} className="space-y-2 rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-medium text-ink-soft">{`Measure ${index + 1}${index === 0 ? ' (required)' : ' (optional)'}`}</legend>
              <div className="space-y-1">
                <label htmlFor={`md${index}`} className="block text-sm font-medium text-ink">
                  {`Measure ${index + 1} description`}
                </label>
                <input
                  id={`md${index}`}
                  name={`md${index}`}
                  type="text"
                  defaultValue={draft.measures[index]?.description ?? ''}
                  className="min-h-[44px] w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink"
                  placeholder={index === 0 ? 'e.g. Share of checkout attempts that complete' : ''}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor={`mt${index}`} className="block text-sm font-medium text-ink">
                    Target (optional)
                  </label>
                  <input
                    id={`mt${index}`}
                    name={`mt${index}`}
                    type="text"
                    defaultValue={draft.measures[index]?.target ?? ''}
                    className="min-h-[44px] w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink"
                    placeholder="e.g. >= 99.5%"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor={`mu${index}`} className="block text-sm font-medium text-ink">
                    Unit (optional)
                  </label>
                  <input
                    id={`mu${index}`}
                    name={`mu${index}`}
                    type="text"
                    defaultValue={draft.measures[index]?.unit ?? ''}
                    className="min-h-[44px] w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink"
                    placeholder="e.g. percent"
                  />
                </div>
              </div>
            </fieldset>
          ))}
        </div>
      </Card>
      <div className="mt-4">
        <PrimaryAction label="Continue to constraints" />
      </div>
    </form>
  );
}

function ConstraintsForm({ params }: FormProps) {
  const draft = greenfieldDraftFromSearchParams(params);
  return (
    <form method="get" action="/onboarding/greenfield" aria-labelledby="greenfield-constraints-heading">
      <HiddenState params={params} stage="CONSTRAINTS" />
      <Card id="greenfield-constraints" title="Constraints">
        <GuidanceList guidance={['Hard constraints can fail the mission; preferences only shape it. This step is optional.']} />
        <div className="space-y-4">
          {[0, 1, 2].map((index) => (
            <fieldset key={index} className="space-y-2 rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-medium text-ink-soft">{`Constraint ${index + 1} (optional)`}</legend>
              <div className="space-y-1">
                <label htmlFor={`cs${index}`} className="block text-sm font-medium text-ink">
                  {`Constraint ${index + 1} statement`}
                </label>
                <input
                  id={`cs${index}`}
                  name={`cs${index}`}
                  type="text"
                  defaultValue={draft.constraints[index]?.statement ?? ''}
                  className="min-h-[44px] w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink"
                  placeholder="e.g. Stay on the free tier — no paid infrastructure."
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id={`ch${index}`}
                  name={`ch${index}`}
                  type="checkbox"
                  value="true"
                  defaultChecked={draft.constraints[index]?.hard ?? false}
                  className="size-6 rounded border-line-strong"
                />
                <label htmlFor={`ch${index}`} className="text-sm font-medium text-ink">
                  Hard constraint (violating it fails the mission)
                </label>
              </div>
            </fieldset>
          ))}
        </div>
      </Card>
      <div className="mt-4">
        <PrimaryAction label="Continue to the mission review" />
      </div>
    </form>
  );
}

function ReviewCard({ params, draftValid }: FormProps & { draftValid: boolean }) {
  const draft = greenfieldDraftFromSearchParams(params);
  const formalization = formalizeMissionContent(draft);
  return (
    <form method="get" action="/onboarding/greenfield" aria-labelledby="greenfield-review-heading">
      <HiddenState params={params} stage="REVIEW" />
      <Card id="greenfield-review" title="Review">
        <GuidanceList guidance={['The whole draft maps onto the formal mission content and is checked by the domain validator — the single validation authority.']} />
        {formalization.content !== null ? (
          <div className="space-y-2 text-sm">
            <Row label="Purpose">{formalization.content.purpose}</Row>
            <Row label="Goals">
              <ul className="list-disc pl-4">
                {formalization.content.goals.map((goal) => (
                  <li key={goal.id}>
                    {goal.statement} <ValueChip label="Status" value={goal.status} />
                  </li>
                ))}
              </ul>
            </Row>
            <Row label="Outcomes">
              <ul className="list-disc pl-4">
                {formalization.content.outcomes.map((outcome) => (
                  <li key={outcome.id}>{outcome.description}</li>
                ))}
              </ul>
            </Row>
            <Row label="Stakeholders">
              <ul className="list-disc pl-4">
                {formalization.content.stakeholders.map((stakeholder) => (
                  <li key={stakeholder.id}>{`${stakeholder.name}${stakeholder.interest === null ? '' : ` — ${stakeholder.interest}`}`}</li>
                ))}
              </ul>
            </Row>
            <Row label="Measures">
              <ul className="list-disc pl-4">
                {formalization.content.measures.map((measure) => (
                  <li key={measure.id}>{`${measure.description}${measure.target === null ? '' : ` (${measure.target}${measure.unit === null ? '' : ` ${measure.unit}`})`}`}</li>
                ))}
              </ul>
            </Row>
            <Row label="Constraints">
              <ul className="list-disc pl-4">
                {formalization.content.constraints.map((constraint) => (
                  <li key={constraint.id}>{`${constraint.statement} (${constraint.hard ? 'hard' : 'preference'})`}</li>
                ))}
              </ul>
            </Row>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">The mission content cannot be formalized yet — resolve the findings below.</p>
        )}
      </Card>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {draftValid ? <PrimaryAction label="Proceed to the authority gate" /> : null}
        <SecondaryLink href="/onboarding/greenfield?stage=purpose" label="Edit the purpose" />
      </div>
    </form>
  );
}

function AuthorityForm({ params }: FormProps) {
  const draft = greenfieldDraftFromSearchParams(params);
  return (
    <form method="get" action="/onboarding/greenfield" aria-labelledby="greenfield-authority-heading">
      <HiddenState params={params} stage="AUTHORITY_CONFIRMATION" />
      <Card id="greenfield-authority" title="Authority confirmation">
        <GuidanceList guidance={['Formalizing the mission is a durable write: it requires your explicit REVISE-class authority confirmation — the gate never closes itself.']} />
        <div className="flex items-start gap-3">
          <input
            id="authority"
            name="authority"
            type="checkbox"
            value="true"
            defaultChecked={draft.authority_confirmed}
            className="mt-1 size-6 rounded border-line-strong"
          />
          <label htmlFor="authority" className="text-sm font-medium text-ink">
            I confirm my authority to formalize this mission (the REVISE permission).
            <span className="mt-1 block text-xs font-normal text-ink-soft">The confirmation is recorded explicitly; SOS never confirms on your behalf.</span>
          </label>
        </div>
      </Card>
      <div className="mt-4">
        <PrimaryAction label="Confirm and continue to the GitHub connection" />
      </div>
    </form>
  );
}

function ConnectionForm({ params }: FormProps) {
  const draft = greenfieldDraftFromSearchParams(params);
  return (
    <form method="get" action="/onboarding/greenfield" aria-labelledby="greenfield-connection-heading">
      <HiddenState params={params} stage="GITHUB_CONNECTION" />
      <Card id="greenfield-connection-select" title="Select a repository">
        <GuidanceList guidance={['Connect with least-privilege repository scope (read for onboarding). An empty repository starts the mission from scratch; an existing one links its exact revision.']} />
        <fieldset className="space-y-2">
          <legend className="sr-only">Repository selection</legend>
          {fixtureRepositoryChoices().map((choice) => (
            <div key={choice.slug} className="flex items-center gap-3">
              <input
                id={`repo-${choice.slug.replace('/', '-')}`}
                name="repo"
                type="radio"
                value={choice.slug}
                defaultChecked={draft.repository !== null && `${draft.repository.owner}/${draft.repository.name}` === choice.slug}
                className="size-6 border-line-strong"
              />
              <label htmlFor={`repo-${choice.slug.replace('/', '-')}`} className="text-sm text-ink">
                {choice.label}
              </label>
            </div>
          ))}
        </fieldset>
      </Card>
      <div className="mt-4">
        <PrimaryAction label="Connect the repository and formalize the mission" />
      </div>
    </form>
  );
}

function PersistedCard({ draft }: { draft: ReturnType<typeof greenfieldDraftFromSearchParams> }) {
  const view = greenfieldResultView(draft);
  const fixtureRevision = view.core.data_source.kind === 'DEMO' ? view.core.data_source.fixture_revision : undefined;
  return (
    <>
      <Card id="greenfield-persisted" title="Mission persisted" demoRevision={fixtureRevision} chip={<ValueChip label="Status" value="DRAFT mission" />}>
        <Row label="Mission">
          <code className="rounded bg-surface-warm px-1 py-0.5 text-xs">{view.mission_id}</code>
        </Row>
        <Row label="System State">
          <code className="rounded bg-surface-warm px-1 py-0.5 text-xs">{`${view.system_state_id} (v${view.system_state_version})`}</code>
        </Row>
        <Row label="Implementation">
          <code className="rounded bg-surface-warm px-1 py-0.5 text-xs">{view.implementation_model_id}</code>
        </Row>
        <Row label="Linked revision (git-sha)">
          {`${view.linked_revision.repository} @ ${view.linked_revision.branch} (${view.linked_revision.sha.slice(0, 12)}…)`}
        </Row>
        <Row label="Repository path">{view.repository_was_empty ? 'Empty repository — the initial commit created the first revision (the greenfield flagship path).' : 'Existing repository — its exact revision is linked into System State.'}</Row>
        <p className="mt-3 text-xs text-ink-soft">
          DEMO — SIMULATED DATA: this surface renders the simulated persistence (deterministic fixture revisions); the durable live-store write is exercised end-to-end by the deterministic journey tests.
        </p>
      </Card>
      <ConnectionCard connection={view.connection} />
    </>
  );
}
