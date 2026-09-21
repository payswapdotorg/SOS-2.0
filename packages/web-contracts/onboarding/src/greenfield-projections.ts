/**
 * The greenfield stage projections (Work Order P4): pure functions from
 * (draft, stage) → the stage view model carrying the six product review
 * questions (what, why, evidence refs, uncertainty, authority, next
 * allowed action) plus the typed validation results.
 *
 * Every stage view model carries the DEMO/LIVE data-source marker
 * structurally; a projection from the DEMO fixtures can never render as
 * LIVE (the P1 demo-honesty contract, consumed not redefined).
 */

import type { DataSource } from '@sos-2/web-contracts';
import { demoDataSource } from '@sos-2/web-contracts';
import type { NextActionView, UncertaintyView } from '@sos-2/web-contracts';
import type {
  GreenfieldJourneyDraft,
  GreenfieldStage,
  GreenfieldValidationError,
} from './greenfield';
import { GREENFIELD_STAGES, greenfieldStageLabel, validateGreenfieldStage } from './greenfield';
import type { OnboardingVmCore } from './review-core';
import { ONBOARDING_CONFIRMATION_PERMISSION, assertValidOnboardingVmCore } from './review-core';

/** One greenfield stage view model (the unit the wizard renders). */
export interface GreenfieldStageVm {
  /** The onboarding review core (the six product review questions). */
  core: OnboardingVmCore;
  /** The stage this view model presents. */
  stage: GreenfieldStage;
  /** The stage's user-facing label. */
  label: string;
  /** The journey progress: stage order / total steps (PERSISTED excluded from the steps). */
  progress: { current: number; total: number };
  /** The typed validation results of this stage against the draft (may be empty). */
  validation: GreenfieldValidationError[];
  /** The honest guidance for this stage's inputs (one sentence per guidance item). */
  guidance: string[];
  /** The input names this stage collects (form field ids — a11y and tests). */
  input_fields: string[];
}

/** The honest uncertainty of a journey stage (pre-artifact: UNQUANTIFIED, always stated). */
function stageUncertainty(stage: GreenfieldStage): UncertaintyView {
  switch (stage) {
    case 'PURPOSE':
      return { uncertainty_class: 'UNQUANTIFIED', statement: 'The purpose is a human statement — SOS cannot yet quantify how sharp it is; the review stage surfaces the domain validator\'s judgement.' };
    case 'OUTCOMES':
      return { uncertainty_class: 'UNQUANTIFIED', statement: 'Outcome completeness is uncertain until the review stage maps the draft onto the formal mission content.' };
    case 'STAKEHOLDERS':
      return { uncertainty_class: 'UNQUANTIFIED', statement: 'Whether every stakeholder with a stake in this mission is named remains genuinely uncertain.' };
    case 'MEASURES':
      return { uncertainty_class: 'UNQUANTIFIED', statement: 'Measure quality (targets, units, observability) is not yet quantified — unformalized targets stay honestly null.' };
    case 'CONSTRAINTS':
      return { uncertainty_class: 'UNQUANTIFIED', statement: 'Whether the stated constraints are exhaustive remains uncertain; hard constraints outrank preferences when they conflict.' };
    case 'REVIEW':
      return { uncertainty_class: 'UNQUANTIFIED', statement: 'The mission content is validated by the domain rules, but whether the mission is RIGHT is a human judgement (the authority gate).' };
    case 'AUTHORITY_CONFIRMATION':
      return { uncertainty_class: 'UNQUANTIFIED', statement: 'Authority confirmation is a human act — SOS never confirms it on your behalf.' };
    case 'GITHUB_CONNECTION':
      return { uncertainty_class: 'UNQUANTIFIED', statement: 'The real GitHub connection is not established in this Work Order (validation account pending); the reference provider is clearly simulated.' };
    case 'PERSISTED':
      return { uncertainty_class: 'UNQUANTIFIED', statement: 'The journey result is deterministic, but mission success itself is only ever evidence-gated — never self-certified.' };
  }
}

/** Why each stage exists (the typed why of the review core). */
function stageWhy(stage: GreenfieldStage): { basis: string; basis_refs: string[] } {
  switch (stage) {
    case 'PURPOSE':
      return { basis: 'The mission-first journey anchors everything on one honest purpose sentence before any engineering shape exists.', basis_refs: [] };
    case 'OUTCOMES':
      return { basis: 'Outcomes turn the purpose into observable after-states; they become the mission\'s goals at review.', basis_refs: [] };
    case 'STAKEHOLDERS':
      return { basis: 'Stakeholders name who the mission serves and what they need — the mission\'s accountability surface.', basis_refs: [] };
    case 'MEASURES':
      return { basis: 'Measures make outcomes observable; a goal with a measure becomes MEASURABLE in the formal mission vocabulary.', basis_refs: [] };
    case 'CONSTRAINTS':
      return { basis: 'Constraints bound the mission honestly: hard constraints can fail it, preferences only shape it.', basis_refs: [] };
    case 'REVIEW':
      return { basis: 'The review maps the whole draft onto the frozen Mission content and defers to the domain validator — the single validation authority.', basis_refs: [] };
    case 'AUTHORITY_CONFIRMATION':
      return { basis: 'Formalizing a mission is a consequential durable write: it requires your explicit REVISE-class authority confirmation as a gate, never an implied one.', basis_refs: [] };
    case 'GITHUB_CONNECTION':
      return { basis: 'The mission connects to a real project repository (empty or existing) with least-privilege scope; the connection state is shown honestly, simulated or not.', basis_refs: [] };
    case 'PERSISTED':
      return { basis: 'The formalized mission and its linked repository revision persist through the durable live-store repositories — the exact spine ids are shown.', basis_refs: [] };
  }
}

/** The next allowed action of a stage (a VIEW; the wizard renders it as the primary action). */
function stageNextAction(stage: GreenfieldStage, draft: GreenfieldJourneyDraft): NextActionView {
  const canComplete = validateGreenfieldStage(stage, draft).length === 0;
  const nextStage = GREENFIELD_STAGES[GREENFIELD_STAGES.indexOf(stage) + 1] ?? null;
  switch (stage) {
    case 'PURPOSE':
      return {
        action_id: 'greenfield-purpose-continue',
        kind: canComplete ? 'REVIEW' : 'DECIDE',
        label: canComplete ? 'Continue to outcomes' : 'State the purpose to continue',
        description: canComplete ? 'The purpose is stated — the journey moves to outcomes.' : 'The purpose field is required before the journey can continue.',
        href: null,
        rationale_ref: null,
        requires_authority: null,
      };
    case 'OUTCOMES':
      return {
        action_id: 'greenfield-outcomes-continue',
        kind: canComplete ? 'REVIEW' : 'DECIDE',
        label: canComplete ? 'Continue to stakeholders' : 'Add an outcome to continue',
        description: canComplete ? 'At least one outcome is stated — the journey moves to stakeholders.' : 'At least one outcome is required.',
        href: null,
        rationale_ref: null,
        requires_authority: null,
      };
    case 'STAKEHOLDERS':
      return {
        action_id: 'greenfield-stakeholders-continue',
        kind: canComplete ? 'REVIEW' : 'DECIDE',
        label: canComplete ? 'Continue to measures' : 'Add a stakeholder to continue',
        description: canComplete ? 'At least one stakeholder is named — the journey moves to measures.' : 'At least one stakeholder is required.',
        href: null,
        rationale_ref: null,
        requires_authority: null,
      };
    case 'MEASURES':
      return {
        action_id: 'greenfield-measures-continue',
        kind: canComplete ? 'REVIEW' : 'DECIDE',
        label: canComplete ? 'Continue to constraints' : 'Add a measure to continue',
        description: canComplete ? 'At least one measure is stated — the journey moves to constraints (optional).' : 'At least one measure is required.',
        href: null,
        rationale_ref: null,
        requires_authority: null,
      };
    case 'CONSTRAINTS':
      return {
        action_id: 'greenfield-constraints-continue',
        kind: 'REVIEW',
        label: 'Continue to the mission review',
        description: 'Constraints are optional — the journey moves to the review where the domain validator checks the whole mission content.',
        href: null,
        rationale_ref: null,
        requires_authority: null,
      };
    case 'REVIEW':
      return {
        action_id: 'greenfield-review-continue',
        kind: canComplete ? 'DECIDE' : 'REVIEW',
        label: canComplete ? 'Proceed to the authority gate' : 'Resolve the review findings',
        description: canComplete ? 'The mission content passes the domain validator — the explicit authority confirmation gate is next.' : 'The domain validator rejected the mission content; the findings must be resolved first.',
        href: null,
        rationale_ref: null,
        requires_authority: canComplete ? ONBOARDING_CONFIRMATION_PERMISSION : null,
      };
    case 'AUTHORITY_CONFIRMATION':
      return {
        action_id: 'greenfield-authority-continue',
        kind: canComplete ? 'DECIDE' : 'DECIDE',
        label: canComplete ? 'Confirm and continue to the GitHub connection' : 'Confirm your authority to formalize this mission',
        description: canComplete
          ? 'Your confirmation is recorded explicitly — the journey moves to the GitHub connection.'
          : `Formalizing the mission requires the ${ONBOARDING_CONFIRMATION_PERMISSION} permission; the gate waits for your explicit confirmation.`,
        href: null,
        rationale_ref: null,
        requires_authority: ONBOARDING_CONFIRMATION_PERMISSION,
      };
    case 'GITHUB_CONNECTION':
      return {
        action_id: 'greenfield-connection-continue',
        kind: canComplete ? 'DECIDE' : 'REVIEW',
        label: canComplete ? 'Connect the repository and formalize the mission' : 'Select a repository to continue',
        description: canComplete
          ? 'The repository is selected — the journey formalizes and persists the mission with the repository revision linked into System State.'
          : 'A GitHub repository (empty or existing) must be selected; an empty repository starts the mission from scratch.',
        href: null,
        rationale_ref: null,
        requires_authority: canComplete ? ONBOARDING_CONFIRMATION_PERMISSION : null,
      };
    case 'PERSISTED':
      return {
        action_id: 'greenfield-journey-complete',
        kind: 'NAVIGATE',
        label: 'Open the mission view',
        description: 'The mission is formalized and persisted with its linked repository revision — continue in the mission view.',
        href: '/mission',
        rationale_ref: null,
        requires_authority: null,
      };
  }
}

/** The guidance sentences and input field ids of a stage. */
function stageInputs(stage: GreenfieldStage): { guidance: string[]; input_fields: string[] } {
  switch (stage) {
    case 'PURPOSE':
      return {
        guidance: ['One honest sentence: why does this mission exist?', 'No engineering jargon is required — a fresh user never needs SOS artifact names.'],
        input_fields: ['purpose'],
      };
    case 'OUTCOMES':
      return {
        guidance: ['What should be true afterwards?', 'Each outcome may carry goal statements that become the mission\'s goals.'],
        input_fields: ['outcomes[].description', 'outcomes[].goals'],
      };
    case 'STAKEHOLDERS':
      return {
        guidance: ['Who does this mission serve, and what do they need?'],
        input_fields: ['stakeholders[].name', 'stakeholders[].interest'],
      };
    case 'MEASURES':
      return {
        guidance: ['How will you know it is working?', 'A target and unit are optional while unformalized — they stay honestly null.'],
        input_fields: ['measures[].description', 'measures[].target', 'measures[].unit'],
      };
    case 'CONSTRAINTS':
      return {
        guidance: ['Hard constraints can fail the mission; preferences only shape it.'],
        input_fields: ['constraints[].statement', 'constraints[].hard'],
      };
    case 'REVIEW':
      return {
        guidance: ['The whole draft maps onto the formal mission content and is checked by the domain validator.'],
        input_fields: [],
      };
    case 'AUTHORITY_CONFIRMATION':
      return {
        guidance: [`Formalizing the mission requires the ${ONBOARDING_CONFIRMATION_PERMISSION} permission — confirm explicitly; the gate never closes itself.`],
        input_fields: ['authority_confirmed'],
      };
    case 'GITHUB_CONNECTION':
      return {
        guidance: ['Connect with least-privilege repository scope (read for onboarding).', 'An empty repository starts the mission from scratch — an existing one links its exact revision.'],
        input_fields: ['repository'],
      };
    case 'PERSISTED':
      return { guidance: ['The mission and its repository link are durable — exact spine ids and revisions are shown.'], input_fields: [] };
  }
}

/**
 * Project one greenfield stage view model from a draft. Deterministic
 * and total; the projection validates its own output (the core
 * validator) — a malformed projection throws immediately.
 */
export function projectGreenfieldStage(input: {
  stage: GreenfieldStage;
  draft: GreenfieldJourneyDraft;
  data_source: DataSource;
}): GreenfieldStageVm {
  const { stage, draft, data_source } = input;
  const what = `The greenfield mission journey is at the ${greenfieldStageLabel(stage)} step.`;
  const validation = validateGreenfieldStage(stage, draft);
  const { guidance, input_fields: inputFields } = stageInputs(stage);
  const steps = GREENFIELD_STAGES.filter((candidate) => candidate !== 'PERSISTED');
  const core: OnboardingVmCore = {
    subject_id: `onboarding:greenfield:${stage.toLowerCase().replace(/_/g, '-')}`,
    data_source: data_source.kind === 'DEMO' ? demoDataSource(data_source.fixture_revision, data_source.note) : data_source,
    what,
    why: stageWhy(stage),
    evidence_refs: [],
    uncertainty: stageUncertainty(stage),
    authority: {
      mode: 'SUPERVISED',
      required_permission: stageNextAction(stage, draft).requires_authority,
      grant_ref: null,
      note:
        stage === 'AUTHORITY_CONFIRMATION' || stage === 'GITHUB_CONNECTION' || stage === 'REVIEW'
          ? `This step needs ${ONBOARDING_CONFIRMATION_PERMISSION}-class authority (a durable semantic write); the gate is explicit and human.`
          : 'The mission-formalization steps run under supervised authority; the explicit gate comes at the authority confirmation step.',
    },
    next_allowed_action: stageNextAction(stage, draft),
  };
  assertValidOnboardingVmCore(core);
  return {
    core,
    stage,
    label: greenfieldStageLabel(stage),
    progress: { current: GREENFIELD_STAGES.indexOf(stage) + 1, total: steps.length + 1 },
    validation,
    guidance,
    input_fields: inputFields,
  };
}
