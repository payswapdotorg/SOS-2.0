/**
 * The onboarding view-model contract tests (Work Order P4): the
 * greenfield stage machine (progressive formalization, typed
 * validation, the explicit authority gate), the brownfield stage
 * machine, the advanced raw-JSON mode, the DEMO-marker discipline and
 * fixture determinism.
 */

import {
  GREENFIELD_STAGES,
  advancedFixtureDraft,
  brownfieldFixtureState,
  emptyAdvancedImportDraft,
  emptyBrownfieldJourney,
  emptyGreenfieldDraft,
  formalizeMissionContent,
  greenfieldCurrentStage,
  greenfieldFixtureDraft,
  greenfieldFixtureResult,
  greenfieldFixtureResultVm,
  isGreenfieldStageComplete,
  onboardingDemoSource,
  projectAdvancedImport,
  projectBrownfieldStage,
  projectGreenfieldStage,
  validateAdvancedImport,
  validateBrownfieldStage,
  validateGreenfieldStage,
} from '../src/index';
import { ONBOARDING_FIXTURE_REVISION } from '../src/index';

const PURPOSE = 'Give our small team a continuously-improving checkout service that stays comprehensible.';

describe('the greenfield stage machine (progressive formalization)', () => {
  test('a fresh draft starts at PURPOSE and the journey advances only through completed stages', () => {
    const draft = emptyGreenfieldDraft();
    expect(greenfieldCurrentStage(draft)).toBe('PURPOSE');
    draft.purpose = PURPOSE;
    expect(greenfieldCurrentStage(draft)).toBe('OUTCOMES');
    draft.outcomes = [{ description: 'Checkout completes reliably.', goals: ['Keep checkout dependable'] }];
    expect(greenfieldCurrentStage(draft)).toBe('STAKEHOLDERS');
    draft.stakeholders = [{ name: 'Shoppers', interest: null }];
    expect(greenfieldCurrentStage(draft)).toBe('MEASURES');
    draft.measures = [{ description: 'Completion share', target: null, unit: null }];
    // Constraints are OPTIONAL: an empty list never blocks. The journey stops at
    // CONSTRAINTS only while a statement is blank (a typed finding).
    draft.constraints = [{ statement: '   ', hard: false }];
    expect(greenfieldCurrentStage(draft)).toBe('CONSTRAINTS');
    expect(validateGreenfieldStage('CONSTRAINTS', draft)[0]).toMatchObject({ code: 'EMPTY_STATEMENT', field: 'constraints[0].statement' });
    draft.constraints = [{ statement: 'Stay on the free tier — no paid infrastructure.', hard: true }];
    expect(isGreenfieldStageComplete('CONSTRAINTS', draft)).toBe(true);
    // REVIEW is a pass-through when the formalized content passes the domain
    // validator: the computed current stage moves straight to the authority gate.
    expect(isGreenfieldStageComplete('REVIEW', draft)).toBe(true);
    expect(greenfieldCurrentStage(draft)).toBe('AUTHORITY_CONFIRMATION');
    draft.authority_confirmed = true;
    expect(greenfieldCurrentStage(draft)).toBe('GITHUB_CONNECTION');
    draft.repository = { owner: 'acme', name: 'empty-repo', is_empty: true, branch: null, head_sha: null };
    expect(greenfieldCurrentStage(draft)).toBe('PERSISTED');
  });

  test('every stage carries the six product review fields and the structural DEMO marker', () => {
    const draft = greenfieldFixtureDraft();
    for (const stage of GREENFIELD_STAGES) {
      const view = projectGreenfieldStage({ stage, draft, data_source: onboardingDemoSource() });
      expect(view.core.subject_id).toBe(`onboarding:greenfield:${stage.toLowerCase().replace(/_/g, '-')}`);
      expect(view.core.what.length).toBeGreaterThan(0);
      expect(view.core.why.basis.length).toBeGreaterThan(0);
      expect(Array.isArray(view.core.evidence_refs)).toBe(true);
      expect(view.core.uncertainty.statement.length).toBeGreaterThan(0);
      expect(view.core.authority.note.length).toBeGreaterThan(0);
      expect(view.core.next_allowed_action.label.length).toBeGreaterThan(0);
      expect(view.core.data_source).toMatchObject({
        kind: 'DEMO',
        label: 'DEMO — SIMULATED DATA',
        fixture_revision: ONBOARDING_FIXTURE_REVISION,
      });
    }
  });

  test('typed validation errors bind to stages and fields with closed codes', () => {
    const draft = emptyGreenfieldDraft();
    const purposeErrors = validateGreenfieldStage('PURPOSE', draft);
    expect(purposeErrors[0]).toMatchObject({ stage: 'PURPOSE', field: 'purpose', code: 'MISSING_INPUT' });
    draft.purpose = '   ';
    expect(validateGreenfieldStage('PURPOSE', draft)[0]?.code).toBe('EMPTY_STATEMENT');
    draft.purpose = PURPOSE;
    draft.outcomes = [{ description: '', goals: [] }];
    expect(validateGreenfieldStage('OUTCOMES', draft)[0]).toMatchObject({ code: 'EMPTY_STATEMENT', field: 'outcomes[0].description' });
  });

  test('the authority confirmation gate is explicit and never implied', () => {
    const draft = greenfieldFixtureDraft();
    const unconfirmed = { ...draft, authority_confirmed: false };
    expect(validateGreenfieldStage('AUTHORITY_CONFIRMATION', unconfirmed).map((error) => error.code)).toEqual(['AUTHORITY_NOT_CONFIRMED']);
    const confirmed = { ...draft, authority_confirmed: true };
    expect(validateGreenfieldStage('AUTHORITY_CONFIRMATION', confirmed)).toEqual([]);
    // The gate's next action names the REVISE permission.
    const view = projectGreenfieldStage({ stage: 'AUTHORITY_CONFIRMATION', draft: unconfirmed, data_source: onboardingDemoSource() });
    expect(view.core.authority.required_permission).toBe('REVISE');
    expect(view.core.next_allowed_action.requires_authority).toBe('REVISE');
  });

  test('the review stage defers to the frozen domain validator (the single authority)', () => {
    const draft = greenfieldFixtureDraft();
    const formalization = formalizeMissionContent(draft);
    expect(formalization.valid).toBe(true);
    expect(formalization.content?.purpose).toBe(PURPOSE);
    expect(formalization.content?.goals[0]?.status).toBe('MEASURABLE');
    // The goal carries its measure; the outcome references the goal.
    expect(formalization.content?.goals[0]?.measures).toHaveLength(1);
    expect(formalization.content?.outcomes[0]?.goal_refs).toHaveLength(1);
  });

  test('the fixture result view binds the spine subject with the full P1 core', () => {
    const view = greenfieldFixtureResultVm();
    expect(view.core.subject_id).toBe(greenfieldFixtureResult().mission.envelope.id);
    expect(view.core.rationale.subject_id).toBe(view.core.subject_id);
    expect(view.core.evidence_refs).toEqual([...view.core.evidence_refs].sort());
    expect(view.linked_revision).toEqual({
      repository: 'acme/empty-repo',
      branch: 'main',
      sha: '2f1b0d4c8e9a7f3b5d6c1e0a4b8c2d9f6e3a1c7b',
    });
    expect(view.repository_was_empty).toBe(true);
    expect(view.connection.state).toBe('CONNECTED_SIMULATED');
  });
});

describe('the brownfield stage machine (import -> scan -> hypotheses -> confirmation)', () => {
  test('the fixture journey advances through the four stages with honest typed validation', () => {
    const empty = emptyBrownfieldJourney();
    expect(validateBrownfieldStage('REPOSITORY_IMPORT', empty).map((error) => error.code)).toEqual(['REPOSITORY_NOT_IMPORTED']);
    const state = brownfieldFixtureState();
    expect(validateBrownfieldStage('REPOSITORY_IMPORT', state)).toEqual([]);
    expect(validateBrownfieldStage('EVIDENCE_SCAN', state)).toEqual([]);
    expect(validateBrownfieldStage('COMPETING_HYPOTHESES', state)).toEqual([]);
    expect(validateBrownfieldStage('CONFIRMATION', state).map((error) => error.code)).toEqual(['HYPOTHESIS_NOT_SELECTED']);
    state.selected_hypothesis_id = state.hypotheses[0]?.hypothesis_id ?? null;
    expect(validateBrownfieldStage('CONFIRMATION', state).map((error) => error.code)).toEqual(['CONFIRMATION_NOT_GIVEN']);
    state.confirmed = true;
    expect(validateBrownfieldStage('CONFIRMATION', state)).toEqual([]);
  });

  test('the scan phases carry the frozen truth states and the coverage block is PARTIAL (honest)', () => {
    const state = brownfieldFixtureState();
    expect(state.scan?.phases.map((phase) => phase.truth_state)).toEqual(['SUCCESS', 'PARTIAL', 'UNKNOWN', 'SUCCESS']);
    expect(state.scan?.coverage_block.kind).toBe('PARTIAL');
    expect(state.scan?.coverage_block.present).toEqual(['repository-structure', 'tests']);
    expect(state.scan?.coverage_block.missing).toEqual(['component-inventory', 'interfaces']);
  });

  test('the competing hypotheses present three readings with distinct uncertainty classes (never collapsed)', () => {
    const state = brownfieldFixtureState();
    expect(state.hypotheses).toHaveLength(3);
    const classes = new Set(state.hypotheses.map((hypothesis) => hypothesis.uncertainty.uncertainty_class));
    expect(classes.has('MODERATE')).toBe(true);
    expect(classes.has('WEAK')).toBe(true);
    expect(classes.size).toBe(2);
    for (const hypothesis of state.hypotheses) {
      expect(hypothesis.hypothesis_id).toMatch(/^sos:\/\/ArchitectureGraph\/[0-9a-f]{32}$/);
    }
  });

  test('the brownfield stage view models carry the six review fields and the DEMO marker', () => {
    const state = brownfieldFixtureState();
    const view = projectBrownfieldStage({ stage: 'COMPETING_HYPOTHESES', state, data_source: onboardingDemoSource(), connection: greenfieldFixtureResultVm().connection });
    expect(view.core.subject_id).toBe('onboarding:brownfield:competing-hypotheses');
    expect(view.core.why.basis).toContain('never a single collapsed winner');
    expect(view.core.data_source.kind).toBe('DEMO');
  });
});

describe('the advanced raw-JSON import (typed, clearly secondary)', () => {
  test('an empty draft is MISSING_MISSION with the guided-journey guidance', () => {
    const result = validateAdvancedImport(emptyAdvancedImportDraft());
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe('MISSING_MISSION');
    expect(result.errors[0]?.message).toContain('guided greenfield journey');
  });

  test('invalid JSON is NOT_JSON; a non-object is NOT_AN_OBJECT', () => {
    expect(validateAdvancedImport({ raw_text: '{nope', authority_confirmed: false }).errors[0]?.code).toBe('NOT_JSON');
    expect(validateAdvancedImport({ raw_text: '[1,2]', authority_confirmed: false }).errors[0]?.code).toBe('NOT_AN_OBJECT');
  });

  test('a domain-valid draft still needs the explicit authority confirmation', () => {
    const draft = advancedFixtureDraft();
    const unconfirmed = validateAdvancedImport(draft);
    expect(unconfirmed.valid).toBe(false);
    expect(unconfirmed.errors.map((error) => error.code)).toEqual(['AUTHORITY_NOT_CONFIRMED']);
    expect(unconfirmed.content?.purpose).toBe(PURPOSE);
    const confirmed = validateAdvancedImport({ ...draft, authority_confirmed: true });
    expect(confirmed.valid).toBe(true);
    expect(confirmed.errors).toEqual([]);
  });

  test('the advanced view model states it is secondary to the guided journeys', () => {
    const view = projectAdvancedImport({ draft: advancedFixtureDraft(), data_source: onboardingDemoSource() });
    expect(view.core.subject_id).toBe('onboarding:advanced:raw-import');
    expect(view.core.why.basis).toContain('clearly secondary');
  });
});

describe('fixture determinism (revision-pinned, no hidden clocks)', () => {
  test('the fixture world produces identical spine identities on every build', () => {
    const first = greenfieldFixtureResult();
    const second = greenfieldFixtureResult();
    expect(first.mission.envelope.id).toBe(second.mission.envelope.id);
    expect(first.system_state.envelope.id).toBe(second.system_state.envelope.id);
    expect(first.implementation_model.id).toBe(second.implementation_model.id);
    expect(first.evidence.map((record) => record.id)).toEqual(second.evidence.map((record) => record.id));
  });

  test('the fixture revision is the P4 base head (a static literal)', () => {
    expect(ONBOARDING_FIXTURE_REVISION).toBe('c9baa42a72d76246a19144bf1679b8687d5a2d62');
  });
});
