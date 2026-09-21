/**
 * The brownfield journey model (Work Order P4): GitHub
 * repository/runtime import → evidence scan → competing architecture
 * hypotheses → confirmation (spec/productization-execution-architecture
 * §12; docs/ux journey adaptations: "Brownfield: Repository/runtime
 * wizard first; raw JSON only advanced").
 *
 * The hypothesis records are VIEW-LEVEL records referencing spine
 * ArchitectureGraph artifact ids (deterministic, spine-minted) — the
 * heavy recovery machinery (@sos-2/recovery) is domain-side and composes
 * in the live path; the onboarding view presents the competing set with
 * its uncertainty, never collapsing it to a single winner (the frozen
 * diversity rule: "Do not collapse the solution repertoire into a
 * single global winner when materially different solution families are
 * useful").
 */

import type { DataSource, StateBlock } from '@sos-2/web-contracts';
import { buildStateBlock } from '@sos-2/web-contracts';
import type { UncertaintyView } from '@sos-2/web-contracts';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import type { OnboardingVmCore } from './review-core';
import { ONBOARDING_CONFIRMATION_PERMISSION, assertValidOnboardingVmCore } from './review-core';
import type { OnboardingConnectionView } from './connection-view';

/** The brownfield journey stages, in the Work Order's exact order. */
export const BROWNFIELD_STAGES = ['REPOSITORY_IMPORT', 'EVIDENCE_SCAN', 'COMPETING_HYPOTHESES', 'CONFIRMATION', 'CONFIRMED'] as const;

export type BrownfieldStage = (typeof BROWNFIELD_STAGES)[number];

/** The user-facing label of a brownfield stage. */
export function brownfieldStageLabel(stage: BrownfieldStage): string {
  switch (stage) {
    case 'REPOSITORY_IMPORT':
      return 'Repository import';
    case 'EVIDENCE_SCAN':
      return 'Evidence scan';
    case 'COMPETING_HYPOTHESES':
      return 'Competing architecture hypotheses';
    case 'CONFIRMATION':
      return 'Confirmation';
    case 'CONFIRMED':
      return 'Confirmed';
  }
}

/** The imported repository/runtime source. */
export interface BrownfieldImportSource {
  owner: string;
  name: string;
  /** The branch the import targets. */
  branch: string;
  /** The exact revision (commit sha) at import time. */
  head_sha: string;
  /** How the import reached the repository (the provider-neutral discovery or a URL). */
  origin: 'discovered' | 'url';
}

/** One evidence-scan phase result (the frozen truth-state vocabulary, imported). */
export interface BrownfieldScanPhase {
  /** The scanned area (e.g. 'repository-structure', 'interfaces', 'tests'). */
  area: string;
  /** The honest truth state of this scan area (SUCCESS/PARTIAL/UNKNOWN/...). */
  truth_state: EvidenceTruthState;
  /** What the scan found (one honest sentence). */
  statement: string;
}

/** The evidence scan report of one import. */
export interface BrownfieldScanReport {
  repository: BrownfieldImportSource;
  /** The scan phases, in scan order. */
  phases: BrownfieldScanPhase[];
  /** The coverage state block (first-class P1 model — a page never shows a blank hole). */
  coverage_block: StateBlock;
}

/**
 * One competing architecture hypothesis — a view-level record referencing
 * the spine ArchitectureGraph artifact id it presents. Competing
 * hypotheses carry their uncertainty HONESTLY; the set is never
 * collapsed to a winner by the view.
 */
export interface BrownfieldHypothesisRecord {
  /** sos://ArchitectureGraph/<32-hex> — spine-minted deterministic identity. */
  hypothesis_id: string;
  /** A short label (e.g. 'Service-oriented reading'). */
  label: string;
  /** The hypothesis statement: what architecture this reading believes the repository implements. */
  statement: string;
  /** Why SOS believes this reading (the evidence it draws on, one sentence). */
  basis: string;
  /** The spine Evidence ids supporting this reading (sorted, unique; may be empty — honest). */
  evidence_refs: string[];
  /** What remains uncertain about this reading. */
  uncertainty: UncertaintyView;
}

/** The brownfield journey state (accumulated, resumable). */
export interface BrownfieldJourneyState {
  /** The imported source, or null while not imported. */
  source: BrownfieldImportSource | null;
  /** The scan report, or null while not scanned. */
  scan: BrownfieldScanReport | null;
  /** The competing hypotheses (>= 2 when present — the diversity guard). */
  hypotheses: BrownfieldHypothesisRecord[];
  /** The hypothesis the user selected for confirmation, or null. */
  selected_hypothesis_id: string | null;
  /** The explicit confirmation (the gate — never implied). */
  confirmed: boolean;
}

/** The empty brownfield journey state. */
export function emptyBrownfieldJourney(): BrownfieldJourneyState {
  return { source: null, scan: null, hypotheses: [], selected_hypothesis_id: null, confirmed: false };
}

/** Deterministically mint a hypothesis record id for a reading basis. */
export function brownfieldHypothesisId(readingBasis: string): string {
  return deriveDeterministicArtifactId('ArchitectureGraph', { journey: 'brownfield', reading: readingBasis });
}

/**
 * The diversity guard (the frozen rule "do not collapse the solution
 * repertoire"): an ambiguous import MUST present >= 2 competing
 * hypotheses. The guard throws when an ambiguous scan produces fewer —
 * a collapsed set is a contract violation, never a silent pass
 * (mirrors @sos-2/brownfield's assertCompetingHypotheses).
 */
export function assertCompetingHypothesesNotCollapsed(input: { ambiguity_detected: boolean; hypothesis_count: number }): void {
  if (input.ambiguity_detected && input.hypothesis_count < 2) {
    throw new Error(
      'AMBIGUITY_COLLAPSED: the scan detected ambiguity but fewer than two competing hypotheses were presented — the repertoire must not be collapsed into a single winner.',
    );
  }
}

/** Build a scan report's coverage state block from its phases (the first-class P1 model). */
export function scanCoverageBlock(phases: readonly BrownfieldScanPhase[]): StateBlock {
  const complete = phases.filter((phase) => phase.truth_state === 'SUCCESS').map((phase) => phase.area);
  const missing = phases.filter((phase) => phase.truth_state !== 'SUCCESS').map((phase) => phase.area);
  if (missing.length === 0) {
    return buildStateBlock({
      kind: 'EMPTY',
      surface: 'brownfield-scan-coverage',
      statement: 'Every scan area completed — the scan is whole.',
    });
  }
  return buildStateBlock({
    kind: 'PARTIAL',
    surface: 'brownfield-scan-coverage',
    statement: 'The evidence scan is partial — the present and missing areas are listed honestly.',
    present: complete,
    missing,
  });
}

/** One brownfield stage view model (the unit the flow renders). */
export interface BrownfieldStageVm {
  /** The onboarding review core (the six product review questions). */
  core: OnboardingVmCore;
  stage: BrownfieldStage;
  label: string;
  /** The typed validation errors of this stage (the closed vocabulary below). */
  validation: BrownfieldValidationError[];
}

/** The closed validation-error vocabulary of the brownfield journey. */
export const BROWNFIELD_VALIDATION_CODES = [
  'REPOSITORY_NOT_IMPORTED',
  'SCAN_NOT_RUN',
  'HYPOTHESES_NOT_PRESENTED',
  'HYPOTHESIS_NOT_SELECTED',
  'CONFIRMATION_NOT_GIVEN',
] as const;

export type BrownfieldValidationCode = (typeof BROWNFIELD_VALIDATION_CODES)[number];

export interface BrownfieldValidationError {
  stage: BrownfieldStage;
  code: BrownfieldValidationCode;
  message: string;
}

/** Validate one brownfield stage (typed errors). */
export function validateBrownfieldStage(stage: BrownfieldStage, state: BrownfieldJourneyState): BrownfieldValidationError[] {
  switch (stage) {
    case 'REPOSITORY_IMPORT':
      return state.source === null
        ? [{ stage, code: 'REPOSITORY_NOT_IMPORTED', message: 'Import a GitHub repository (or runtime) to begin the brownfield journey.' }]
        : [];
    case 'EVIDENCE_SCAN':
      return state.scan === null
        ? [{ stage, code: 'SCAN_NOT_RUN', message: 'The evidence scan has not run against the imported repository yet.' }]
        : [];
    case 'COMPETING_HYPOTHESES':
      if (state.hypotheses.length === 0) {
        return [{ stage, code: 'HYPOTHESES_NOT_PRESENTED', message: 'No competing architecture hypotheses have been recovered from the scan yet.' }];
      }
      if (state.hypotheses.length < 2) {
        return [{ stage, code: 'HYPOTHESES_NOT_PRESENTED', message: 'An ambiguous scan must present at least two competing hypotheses — the repertoire is never collapsed.' }];
      }
      return [];
    case 'CONFIRMATION':
      if (state.selected_hypothesis_id === null) {
        return [{ stage, code: 'HYPOTHESIS_NOT_SELECTED', message: 'Select the reading you want SOS to proceed with — the competing set stays retained either way.' }];
      }
      if (!state.confirmed) {
        return [{ stage, code: 'CONFIRMATION_NOT_GIVEN', message: `Importing repository state into System State requires your explicit ${ONBOARDING_CONFIRMATION_PERMISSION}-class confirmation.` }];
      }
      return [];
    case 'CONFIRMED':
      return [];
  }
}

/** The current brownfield stage (the first incomplete one). */
export function brownfieldCurrentStage(state: BrownfieldJourneyState): BrownfieldStage {
  for (const stage of BROWNFIELD_STAGES) {
    if (stage === 'CONFIRMED') {
      return stage;
    }
    if (validateBrownfieldStage(stage, state).length > 0) {
      return stage;
    }
  }
  return 'CONFIRMED';
}

/** Project one brownfield stage view model. */
export function projectBrownfieldStage(input: {
  stage: BrownfieldStage;
  state: BrownfieldJourneyState;
  data_source: DataSource;
  connection: OnboardingConnectionView;
}): BrownfieldStageVm {
  const { stage, state, data_source, connection } = input;
  const validation = validateBrownfieldStage(stage, state);
  const what = `The brownfield import journey is at the ${brownfieldStageLabel(stage)} step.`;
  const core: OnboardingVmCore = {
    subject_id: `onboarding:brownfield:${stage.toLowerCase().replace(/_/g, '-')}`,
    data_source: data_source.kind === 'DEMO' ? { ...data_source, label: data_source.label } : data_source,
    what,
    why: {
      basis:
        stage === 'REPOSITORY_IMPORT'
          ? 'Brownfield starts from what exists: the repository (or runtime) is imported before any recovery is attempted.'
          : stage === 'EVIDENCE_SCAN'
            ? 'The scan observes what the import actually provides — per area, with the frozen truth states, never a fabricated whole.'
            : stage === 'COMPETING_HYPOTHESES'
              ? 'Ambiguity is honest: the scan recovers COMPETING architecture readings and presents the full set — never a single collapsed winner.'
              : stage === 'CONFIRMATION'
                ? 'Adopting a reading into System State is a durable semantic write: it requires your explicit confirmation (the gate never closes itself).'
                : 'The confirmed reading is linked into System State with the exact repository revision; the competing set stays retained.',
      basis_refs: [],
    },
    evidence_refs: state.scan === null ? [] : [],
    uncertainty: {
      uncertainty_class: 'UNQUANTIFIED',
      statement:
        stage === 'COMPETING_HYPOTHESES'
          ? 'Which reading is RIGHT is genuinely uncertain — that is why the set is presented as competing instead of collapsed.'
          : 'The brownfield journey observes and recovers; whether the confirmed reading matches reality is only ever evidence-gated.',
    },
    authority: {
      mode: 'SUPERVISED',
      required_permission: stage === 'CONFIRMATION' || stage === 'CONFIRMED' ? ONBOARDING_CONFIRMATION_PERMISSION : null,
      grant_ref: null,
      note: stage === 'CONFIRMATION' ? `This step needs ${ONBOARDING_CONFIRMATION_PERMISSION}-class authority (a durable semantic write).` : 'The import and scan steps are observational; the confirmation step carries the authority gate.',
    },
    next_allowed_action: {
      action_id: `brownfield-${stage.toLowerCase().replace(/_/g, '-')}-continue`,
      kind: validation.length === 0 ? 'REVIEW' : 'DECIDE',
      label:
        stage === 'REPOSITORY_IMPORT'
          ? state.source === null ? 'Import a repository' : 'Run the evidence scan'
          : stage === 'EVIDENCE_SCAN'
            ? state.scan === null ? 'Run the evidence scan' : 'Recover the competing hypotheses'
            : stage === 'COMPETING_HYPOTHESES'
              ? state.hypotheses.length < 2 ? 'Present the competing hypotheses' : 'Select a reading to confirm'
              : stage === 'CONFIRMATION'
                ? validation.length === 0 ? 'Confirm and link into System State' : 'Resolve the confirmation gate'
                : 'Open the system view',
      description:
        stage === 'CONFIRMED'
          ? 'The confirmed reading is linked into System State with the exact repository revision.'
          : validation.length === 0
            ? 'This step is complete — the journey can advance.'
            : 'This step is blocked until its validation findings are resolved.',
      href: stage === 'CONFIRMED' ? '/system' : null,
      rationale_ref: null,
      requires_authority: stage === 'CONFIRMATION' ? ONBOARDING_CONFIRMATION_PERMISSION : null,
    },
  };
  assertValidOnboardingVmCore(core);
  return {
    core,
    stage,
    label: brownfieldStageLabel(stage),
    validation,
  };
}
