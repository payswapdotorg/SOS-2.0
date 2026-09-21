/**
 * The onboarding DEMO world (Work Order P4) — the deterministic,
 * revision-pinned fixture dataset every onboarding product surface
 * renders from. Mirrors the P1 core's demo-world discipline exactly:
 *
 *   - built EXCLUSIVELY through the frozen domain packages' own
 *     builders (createMission, createSystemState, createEvidence,
 *     createTraceLink, deterministic spine id derivation) — zero
 *     invented identities, zero re-implemented semantics;
 *   - static literal timestamps (no Date.now, no Math.random, no
 *     fetch, no ambient process.env) — rendering is byte-deterministic;
 *   - revision-pinned: the fixture revision is a static literal of the
 *     P4 base head;
 *   - every fixture-backed view model carries data_source { kind:
 *     'DEMO', label: 'DEMO — SIMULATED DATA', fixture_revision } — the
 *     marker is structural and can never be dropped (validated by the
 *     view-model validators and pinned by tests);
 *   - the simulated GitHub connection is the provider-side equivalent:
 *     the fixture states match what @sos-2/github's in-memory reference
 *     provider produces (the alignment is pinned by the journey
 *     integration test in packages/github).
 */

import { demoDataSource } from '@sos-2/web-contracts';
import type { DataSource } from '@sos-2/web-contracts';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { GreenfieldJourneyDraft } from '../greenfield';
import type { GreenfieldStageVm } from '../greenfield-projections';
import { projectGreenfieldStage } from '../greenfield-projections';
import type { BrownfieldJourneyState, BrownfieldStageVm } from '../brownfield';
import { projectBrownfieldStage } from '../brownfield';
import { projectAdvancedImport } from '../advanced-import';
import { formalizeGreenfieldJourney, projectGreenfieldResult } from '../persistence';
import type { GreenfieldResultVm } from '../persistence';
import type { OnboardingConnectionView } from '../connection-view';
import { projectOnboardingConnectionView } from '../connection-view';

/** The exact repository revision this fixture dataset is pinned to (static literal — the P4 base head). */
export const ONBOARDING_FIXTURE_REVISION = 'c9baa42a72d76246a19144bf1679b8687d5a2d62';

/** The fixture "now" (static literal — the P1 demo instant, reused for cross-fixture coherence). */
export const ONBOARDING_DEMO_NOW = '2025-06-15T12:00:00Z';

/** The one-line note rendered with every onboarding DEMO badge. */
export const ONBOARDING_DEMO_NOTE =
  'The onboarding journeys render a deterministic, revision-pinned fixture run — simulated data, never live state.';

/** The DEMO data source of every onboarding fixture view model. */
export function onboardingDemoSource(): DataSource {
  return demoDataSource(ONBOARDING_FIXTURE_REVISION, ONBOARDING_DEMO_NOTE);
}

/** The provenance literal stamped on every fixture artifact. */
export const ONBOARDING_FIXTURE_PROVENANCE = ['P4:onboarding-demo-fixture'];

/**
 * The constitution anchor used by the P1 demo world — reused verbatim
 * (the same golden-fixture anchor, never re-minted).
 */
export const ONBOARDING_AUTHORITY_ANCHOR = 'sos://Constitution/9adb696728b256d62bc7f4e2c796a401';

/** The fixture greenfield draft — a completed journey (the flagship: an EMPTY repository). */
export function greenfieldFixtureDraft(): GreenfieldJourneyDraft {
  return {
    purpose: 'Give our small team a continuously-improving checkout service that stays comprehensible.',
    outcomes: [
      {
        description: 'Checkout completes for EU customers without the team babysitting deploys.',
        goals: ['Keep checkout dependable while the team stays small'],
      },
    ],
    stakeholders: [
      { name: 'Shoppers', interest: 'Checkout always works, fast.' },
      { name: 'The team', interest: 'Changes are protected and explainable.' },
    ],
    measures: [
      { description: 'Share of checkout attempts that complete', target: '>= 99.5%', unit: 'percent' },
    ],
    constraints: [
      { statement: 'Stay on the free tier — no paid infrastructure.', hard: true },
      { statement: 'Prefer boring, well-understood components.', hard: false },
    ],
    authority_confirmed: true,
    repository: { owner: 'acme', name: 'empty-repo', is_empty: true, branch: null, head_sha: null },
  };
}

/** The fixture repository input (the EMPTY-repository flagship path: the initial commit creates the first revision). */
export function greenfieldFixtureRepository() {
  return {
    owner: 'acme',
    name: 'empty-repo',
    was_empty: true,
    branch: 'main',
    head_sha: '2f1b0d4c8e9a7f3b5d6c1e0a4b8c2d9f6e3a1c7b',
  };
}

/**
 * The fixture connection view — what the in-memory reference provider
 * produces after its SIMULATED handshake (structural input; the
 * alignment with @sos-2/github is pinned by the integration test).
 */
export function greenfieldFixtureConnection(): OnboardingConnectionView {
  return projectOnboardingConnectionView({
    connection: {
      status: 'CONNECTED',
      simulated: true,
      granted_scopes: ['repository:metadata:read', 'repository:contents:read'],
      note: 'SIMULATED connection over the in-memory reference provider — least-privilege read scopes granted. This is never presented as a real GitHub connection.',
    },
    requested_scopes: ['repository:metadata:read', 'repository:contents:read'],
    data_source: onboardingDemoSource(),
  });
}

/** The fixture greenfield journey result (formalized through the real domain builders). */
export function greenfieldFixtureResult() {
  return formalizeGreenfieldJourney({
    draft: greenfieldFixtureDraft(),
    repository: greenfieldFixtureRepository(),
    provenance: [...ONBOARDING_FIXTURE_PROVENANCE],
    created_at: ONBOARDING_DEMO_NOW,
    authority_ref: ONBOARDING_AUTHORITY_ANCHOR,
  });
}

/** The fixture greenfield RESULT view model (the PERSISTED step, spine-bound). */
export function greenfieldFixtureResultVm(): GreenfieldResultVm {
  return projectGreenfieldResult({
    result: greenfieldFixtureResult(),
    repository: greenfieldFixtureRepository(),
    connection: greenfieldFixtureConnection(),
    data_source: onboardingDemoSource(),
  });
}

/** The fixture brownfield journey state (the legacy-checkout import). */
export function brownfieldFixtureState(): BrownfieldJourneyState {
  const legacyRepo = { owner: 'acme', name: 'legacy-checkout' };
  const source = { ...legacyRepo, branch: 'main', head_sha: 'c0ffee10d5c0a11b2c3d4e5f60718293a4b5c6d7', origin: 'discovered' as const };
  return {
    source,
    scan: {
      repository: source,
      phases: [
        { area: 'repository-structure', truth_state: 'SUCCESS', statement: 'The tree was read at the exact imported revision (7 files across src/ and tests/).' },
        { area: 'component-inventory', truth_state: 'PARTIAL', statement: 'Two source files were grouped as components; their kinds are ambiguous (service vs library).' },
        { area: 'interfaces', truth_state: 'UNKNOWN', statement: 'No interface declarations were recovered — the reading is genuinely unknown here.' },
        { area: 'tests', truth_state: 'SUCCESS', statement: 'One test file was found and read (checkout.test.ts).' },
      ],
      coverage_block: {
        kind: 'PARTIAL',
        surface: 'brownfield-scan-coverage',
        statement: 'The evidence scan is partial — the present and missing areas are listed honestly.',
        present: ['repository-structure', 'tests'],
        missing: ['component-inventory', 'interfaces'],
        action: null,
      },
    },
    hypotheses: [
      {
        hypothesis_id: deriveDeterministicArtifactId('ArchitectureGraph', { journey: 'brownfield', reading: 'service-oriented' }),
        label: 'Service-oriented reading',
        statement: 'The repository is one deployable checkout service with a payments dependency and a datastore.',
        basis: 'src/checkout.ts and src/payments.ts read as one service with an external dependency edge.',
        evidence_refs: [],
        uncertainty: { uncertainty_class: 'MODERATE', statement: 'The component kinds are ambiguous in the scan — this reading could be wrong about the service boundary.' },
      },
      {
        hypothesis_id: deriveDeterministicArtifactId('ArchitectureGraph', { journey: 'brownfield', reading: 'library-first' }),
        label: 'Library-first reading',
        statement: 'The repository is a reusable checkout library consumed elsewhere, not a deployable service.',
        basis: 'No deployment manifests were found in the tree; the tests read like library tests.',
        evidence_refs: [],
        uncertainty: { uncertainty_class: 'MODERATE', statement: 'Absence of deployment manifests is weak evidence — a deployable reading remains plausible.' },
      },
      {
        hypothesis_id: deriveDeterministicArtifactId('ArchitectureGraph', { journey: 'brownfield', reading: 'split-services' }),
        label: 'Split-services reading',
        statement: 'checkout and payments are two separate services with a dependency edge between them.',
        basis: 'The two source files have distinct dependency footprints; the split reading explains both.',
        evidence_refs: [],
        uncertainty: { uncertainty_class: 'WEAK', statement: 'File-level footprints are the weakest evidence in the scan — this reading is the most uncertain of the set.' },
      },
    ],
    selected_hypothesis_id: null,
    confirmed: false,
  };
}

/** The fixture advanced-mode draft (clearly secondary). */
export function advancedFixtureDraft() {
  const draft: GreenfieldJourneyDraft = greenfieldFixtureDraft();
  return {
    raw_text: JSON.stringify({
      purpose: draft.purpose,
      goals: [
        { id: 'keep-checkout-dependable', statement: 'Keep checkout dependable while the team stays small', status: 'PROPOSED', measures: ['completion-share'] },
      ],
      outcomes: [
        { id: 'dependable-checkout', description: 'Checkout completes for EU customers without the team babysitting deploys.', goal_refs: ['keep-checkout-dependable'] },
      ],
      stakeholders: draft.stakeholders.map((stakeholder, index) => ({ id: `stakeholder-${index + 1}`, ...stakeholder })),
      measures: [{ id: 'completion-share', description: 'Share of checkout attempts that complete', target: '>= 99.5%', unit: 'percent' }],
      assumptions: [],
      ambiguities: [],
      constraints: draft.constraints.map((constraint, index) => ({ id: `constraint-${index + 1}`, statement: constraint.statement, hard: constraint.hard, bound: null })),
    }),
    authority_confirmed: false,
  };
}

/**
 * The complete onboarding demo views — every stage view model of the
 * three journeys, projected from the fixtures. Deterministic: the same
 * fixtures produce the same views on every render.
 */
export function buildOnboardingDemoViews() {
  const source = onboardingDemoSource();
  const connection = greenfieldFixtureConnection();
  const greenfieldDraft = greenfieldFixtureDraft();
  const brownfieldState = brownfieldFixtureState();
  const advancedDraft = advancedFixtureDraft();
  return {
    source,
    connection,
    greenfield: {
      draft: greenfieldDraft,
      stages: {
        purpose: projectGreenfieldStage({ stage: 'PURPOSE', draft: greenfieldDraft, data_source: source }),
        outcomes: projectGreenfieldStage({ stage: 'OUTCOMES', draft: greenfieldDraft, data_source: source }),
        stakeholders: projectGreenfieldStage({ stage: 'STAKEHOLDERS', draft: greenfieldDraft, data_source: source }),
        measures: projectGreenfieldStage({ stage: 'MEASURES', draft: greenfieldDraft, data_source: source }),
        constraints: projectGreenfieldStage({ stage: 'CONSTRAINTS', draft: greenfieldDraft, data_source: source }),
        review: projectGreenfieldStage({ stage: 'REVIEW', draft: greenfieldDraft, data_source: source }),
        authority: projectGreenfieldStage({ stage: 'AUTHORITY_CONFIRMATION', draft: greenfieldDraft, data_source: source }),
        connection: projectGreenfieldStage({ stage: 'GITHUB_CONNECTION', draft: greenfieldDraft, data_source: source }),
        persisted: projectGreenfieldStage({ stage: 'PERSISTED', draft: greenfieldDraft, data_source: source }),
      } satisfies Record<string, GreenfieldStageVm>,
      result: greenfieldFixtureResultVm(),
    },
    brownfield: {
      state: brownfieldState,
      stages: {
        import: projectBrownfieldStage({ stage: 'REPOSITORY_IMPORT', state: brownfieldState, data_source: source, connection }),
        scan: projectBrownfieldStage({ stage: 'EVIDENCE_SCAN', state: brownfieldState, data_source: source, connection }),
        hypotheses: projectBrownfieldStage({ stage: 'COMPETING_HYPOTHESES', state: brownfieldState, data_source: source, connection }),
        confirmation: projectBrownfieldStage({ stage: 'CONFIRMATION', state: brownfieldState, data_source: source, connection }),
      } satisfies Record<string, BrownfieldStageVm>,
    },
    advanced: {
      draft: advancedDraft,
      view: projectAdvancedImport({ draft: advancedDraft, data_source: source }),
    },
  };
}
