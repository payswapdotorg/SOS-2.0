/**
 * The onboarding view state (Work Order P4) — the pure wiring between
 * the URL (searchParams) and the onboarding view models. The wizard is
 * RESUMABLE BY URL: every form is a native GET form whose accumulated
 * fields serialize the journey draft, so a journey URL is a complete,
 * shareable, resumable state (no client JS, no storage, no network).
 *
 * Pure functions only: same searchParams -> same draft -> same markup.
 * The fixture repositories shown at the connection/import steps are the
 * DEMO fixtures (the discovery capability is exercised against the
 * reference provider by the adapter tests; the app surface renders the
 * fixture discovery list under the DEMO badge).
 */

import type {
  AdvancedImportDraft,
  BrownfieldJourneyState,
  GreenfieldJourneyDraft,
  GreenfieldStage,
} from '../../../../../packages/web-contracts/onboarding/src/index';
import {
  advancedFixtureDraft,
  brownfieldFixtureState,
  buildOnboardingDemoViews,
  emptyAdvancedImportDraft,
  emptyBrownfieldJourney,
  emptyGreenfieldDraft,
  greenfieldFixtureConnection,
  greenfieldFixtureDraft,
  greenfieldFixtureRepository,
  greenfieldFixtureResult,
  greenfieldFixtureResultVm,
  onboardingDemoSource,
  projectAdvancedImport,
  projectBrownfieldStage,
  projectGreenfieldResult,
  projectGreenfieldStage,
} from '../../../../../packages/web-contracts/onboarding/src/index';

/** The read-only searchParams shape the routes forward. */
export type OnboardingSearchParams = Readonly<Record<string, string | string[] | undefined>>;

function firstValue(params: OnboardingSearchParams, key: string): string | null {
  const value = params[key];
  if (value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    const first = value[0];
    return first === undefined ? null : first;
  }
  return value;
}

function indexedValues(params: OnboardingSearchParams, base: string, count: number): string[] {
  const values: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = firstValue(params, `${base}${index}`);
    if (value !== null && value.trim().length > 0) {
      values.push(value);
    }
  }
  return values;
}

/** How many indexed rows each list stage collects (fixed arity — no client JS). */
export const WIZARD_LIST_ARITY = 3;

/** The fixture repositories offered at the connection/import steps (DEMO — clearly labelled). */
export function fixtureRepositoryChoices() {
  return [
    { slug: 'acme/empty-repo', label: 'acme/empty-repo — an empty repository (start from scratch)', is_empty: true, branch: null, head_sha: null },
    { slug: 'acme/legacy-checkout', label: 'acme/legacy-checkout — an existing service (brownfield)', is_empty: false, branch: 'main', head_sha: 'c0ffee10d5c0a11b2c3d4e5f60718293a4b5c6d7' },
    { slug: 'acme/archived-docs', label: 'acme/archived-docs — an archived docs mirror (no webhooks)', is_empty: false, branch: 'gh-pages', head_sha: 'abc123def4567890abcdef0123456789abcdef01' },
  ];
}

/** Parse a greenfield journey draft from the searchParams. */
export function greenfieldDraftFromSearchParams(params: OnboardingSearchParams): GreenfieldJourneyDraft {
  const draft = emptyGreenfieldDraft();
  const purpose = firstValue(params, 'purpose');
  draft.purpose = purpose !== null && purpose.trim().length > 0 ? purpose : null;

  for (let index = 0; index < WIZARD_LIST_ARITY; index += 1) {
    const description = firstValue(params, `od${index}`);
    if (description !== null && description.trim().length > 0) {
      const goalsText = firstValue(params, `og${index}`) ?? '';
      draft.outcomes.push({
        description,
        goals: goalsText.split(';').map((goal) => goal.trim()).filter((goal) => goal.length > 0),
      });
    }
    const name = firstValue(params, `sn${index}`);
    if (name !== null && name.trim().length > 0) {
      const interest = firstValue(params, `si${index}`);
      draft.stakeholders.push({ name, interest: interest !== null && interest.trim().length > 0 ? interest : null });
    }
    const measureDescription = firstValue(params, `md${index}`);
    if (measureDescription !== null && measureDescription.trim().length > 0) {
      const target = firstValue(params, `mt${index}`);
      const unit = firstValue(params, `mu${index}`);
      draft.measures.push({
        description: measureDescription,
        target: target !== null && target.trim().length > 0 ? target : null,
        unit: unit !== null && unit.trim().length > 0 ? unit : null,
      });
    }
    const constraintStatement = firstValue(params, `cs${index}`);
    if (constraintStatement !== null && constraintStatement.trim().length > 0) {
      const hard = firstValue(params, `ch${index}`) === 'true';
      draft.constraints.push({ statement: constraintStatement, hard });
    }
  }

  draft.authority_confirmed = firstValue(params, 'authority') === 'true';

  const repo = firstValue(params, 'repo');
  if (repo !== null) {
    const choice = fixtureRepositoryChoices().find((candidate) => candidate.slug === repo);
    if (choice !== undefined) {
      draft.repository = { owner: choice.slug.split('/')[0] ?? '', name: choice.slug.split('/')[1] ?? '', is_empty: choice.is_empty, branch: choice.branch, head_sha: choice.head_sha };
    }
  }
  return draft;
}

/** The DEMO views singleton (fixture-backed, deterministic). */
export const onboardingViews = buildOnboardingDemoViews();

/** The fixture connection view (SIMULATED reference provider — never a real connection). */
export const fixtureConnection = greenfieldFixtureConnection();

/** Project a greenfield stage view from the searchParams-driven draft. */
export function greenfieldStageView(stage: GreenfieldStage, draft: GreenfieldJourneyDraft) {
  return projectGreenfieldStage({ stage, draft, data_source: onboardingDemoSource() });
}

/**
 * The persisted-step view: when the draft is complete, the journey
 * formalizes DETERMINISTICALLY (the fixture repository revisions — the
 * real provider handshake and the durable live-store write are exercised
 * by the adapter/journey tests; the surface renders the simulated
 * persistence under the DEMO badge).
 */
export function greenfieldResultView(draft: GreenfieldJourneyDraft) {
  const repositoryChoice =
    draft.repository === null
      ? greenfieldFixtureRepository()
      : draft.repository.is_empty
        ? greenfieldFixtureRepository()
        : { owner: draft.repository.owner, name: draft.repository.name, was_empty: false, branch: draft.repository.branch ?? 'main', head_sha: draft.repository.head_sha ?? 'c0ffee10d5c0a11b2c3d4e5f60718293a4b5c6d7' };
  return projectGreenfieldResult({
    result: greenfieldFixtureResult(),
    repository: repositoryChoice,
    connection: fixtureConnection,
    data_source: onboardingDemoSource(),
  });
}

/** Parse the brownfield journey state from the searchParams (fixture-driven with functional gates). */
export function brownfieldStateFromSearchParams(params: OnboardingSearchParams): BrownfieldJourneyState {
  const state = brownfieldFixtureState();
  const imported = firstValue(params, 'repo');
  if (imported === null) {
    return emptyBrownfieldJourney();
  }
  const selected = firstValue(params, 'hypothesis');
  state.selected_hypothesis_id = selected !== null && selected.trim().length > 0 ? selected : null;
  state.confirmed = firstValue(params, 'confirmed') === 'true';
  return state;
}

/** Project a brownfield stage view. */
export function brownfieldStageView(stage: Parameters<typeof projectBrownfieldStage>[0]['stage'], state: BrownfieldJourneyState) {
  return projectBrownfieldStage({ stage, state, data_source: onboardingDemoSource(), connection: fixtureConnection });
}

/** Parse the advanced import draft from the searchParams. */
export function advancedDraftFromSearchParams(params: OnboardingSearchParams): AdvancedImportDraft {
  const raw = firstValue(params, 'raw');
  if (raw === null) {
    return emptyAdvancedImportDraft();
  }
  return { raw_text: raw, authority_confirmed: firstValue(params, 'authority') === 'true' };
}

/** Project the advanced import view. */
export function advancedImportView(draft: AdvancedImportDraft) {
  return projectAdvancedImport({ draft, data_source: onboardingDemoSource() });
}

/** The fixture advanced draft (the pre-filled example under the textarea). */
export const fixtureAdvancedDraft = advancedFixtureDraft;

/** The fixture greenfield draft (referenced by tests and the hub copy). */
export const fixtureGreenfieldDraft = greenfieldFixtureDraft;

/** The fixture greenfield result view (the completed journey, DEMO-labelled). */
export const fixtureGreenfieldResultVm = greenfieldFixtureResultVm;

/** Values collected from the indexed list params (test helper). */
export function listParamValues(params: OnboardingSearchParams, base: string): string[] {
  return indexedValues(params, base, WIZARD_LIST_ARITY);
}
