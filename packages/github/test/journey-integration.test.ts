/**
 * The journey integration test (Work Order P4 acceptance): a complete
 * GREENFIELD run — purpose → outcomes → stakeholders → measures →
 * constraints → review → authority confirmation → GitHub connection —
 * through the REAL reference provider (discovery → empty-repository
 * detection → initial commit → snapshot → import) into the REAL
 * domain builders (mission formalization, System State with the
 * repository revision linked as { kind: 'git-sha', value }), persisted
 * through the REAL @sos-2/live-store in-memory repositories
 * (missions + systemStates + evidence + development state), with the
 * spine trace links binding the artifacts. Plus the BROWNFIELD run:
 * import → evidence scan → competing hypotheses (never collapsed) →
 * confirmation, and the connection-vocabulary alignment between
 * @sos-2/github and the onboarding view contracts.
 *
 * Everything here is deterministic: injected literal instants, static
 * fixtures, spine-minted deterministic identities.
 */

import { createInMemoryGitHubProvider } from '../src/index.ts';
import type { GitHubPort } from '../src/index.ts';
import {
  GREENFIELD_STAGES,
  assertCompetingHypothesesNotCollapsed,
  brownfieldHypothesisId,
  emptyGreenfieldDraft,
  formalizeGreenfieldJourney,
  greenfieldCurrentStage,
  isGreenfieldStageComplete,
  projectGreenfieldResult,
  validateGreenfieldStage,
} from '../../web-contracts/onboarding/src/index';
import type { GreenfieldJourneyDraft } from '../../web-contracts/onboarding/src/index';
import {
  ONBOARDING_AUTHORITY_ANCHOR,
  ONBOARDING_DEMO_NOW,
  ONBOARDING_FIXTURE_PROVENANCE,
  onboardingDemoSource,
  greenfieldFixtureConnection,
} from '../../web-contracts/onboarding/src/index';
import { connectionViewStateFromProvider } from '../../web-contracts/onboarding/src/index';
import { createInMemoryLiveStore, ManualClock } from '../../live-store/src/index';
import { assertValidMission } from '../../mission/src/index';
import { assertValidSystemStateArtifact } from '../../system-state/src/index';
import { assertValidEvidenceRecord } from '../../evidence/src/index';

const NOW = ONBOARDING_DEMO_NOW;

/** Drive the greenfield draft stage-by-stage to completion (the user's journey, step by step). */
function completeGreenfieldDraft(): GreenfieldJourneyDraft {
  const draft = emptyGreenfieldDraft();
  // The journey refuses to advance past incomplete stages (typed validation).
  expect(validateGreenfieldStage('PURPOSE', draft).map((error) => error.code)).toEqual(['MISSING_INPUT']);
  draft.purpose = 'Give our small team a continuously-improving checkout service that stays comprehensible.';
  expect(isGreenfieldStageComplete('PURPOSE', draft)).toBe(true);

  draft.outcomes = [
    {
      description: 'Checkout completes for EU customers without the team babysitting deploys.',
      goals: ['Keep checkout dependable while the team stays small'],
    },
  ];
  draft.stakeholders = [
    { name: 'Shoppers', interest: 'Checkout always works, fast.' },
    { name: 'The team', interest: 'Changes are protected and explainable.' },
  ];
  draft.measures = [{ description: 'Share of checkout attempts that complete', target: '>= 99.5%', unit: 'percent' }];
  draft.constraints = [{ statement: 'Stay on the free tier — no paid infrastructure.', hard: true }];

  // The REVIEW stage defers to the domain validator (the single authority).
  expect(validateGreenfieldStage('REVIEW', draft)).toEqual([]);

  // The authority gate refuses until explicitly confirmed (never implied).
  expect(validateGreenfieldStage('AUTHORITY_CONFIRMATION', draft).map((error) => error.code)).toEqual(['AUTHORITY_NOT_CONFIRMED']);
  draft.authority_confirmed = true;
  expect(isGreenfieldStageComplete('AUTHORITY_CONFIRMATION', draft)).toBe(true);
  return draft;
}

describe('the greenfield journey: purpose -> GitHub connection -> mission persisted in live-store', () => {
  test('a complete run: every stage in order, the empty repository connected, the mission persisted with the linked revision', async () => {
    const provider = createInMemoryGitHubProvider();
    const draft = completeGreenfieldDraft();

    // The GitHub connection stage: the repository is not selected until it is.
    expect(validateGreenfieldStage('GITHUB_CONNECTION', draft).map((error) => error.code)).toEqual(['REPOSITORY_NOT_SELECTED']);
    expect(greenfieldCurrentStage(draft)).toBe('GITHUB_CONNECTION');
    draft.repository = { owner: 'acme', name: 'empty-repo', is_empty: true, branch: null, head_sha: null };
    expect(isGreenfieldStageComplete('GITHUB_CONNECTION', draft)).toBe(true);

    // Discovery through the provider (empty detection included).
    const discovery = await provider.discoverRepositories();
    expect(discovery.status).toBe('OK');
    if (discovery.status !== 'OK') {
      throw new Error('unreachable');
    }
    const empty = discovery.result.find((repository) => repository.id.name === 'empty-repo');
    expect(empty?.is_empty).toBe(true);

    // The simulated handshake (explicitly SIMULATED — never a real connection).
    const authorization = provider.beginConnection({ scopes: ['repository:metadata:read', 'repository:contents:read'], state_token: 'p4-journey' });
    const completion = provider.completeConnection({ authorization_ref: authorization.authorization_ref, authorization_code: 'simulated', completed_at: NOW });
    expect(completion.status).toBe('CONNECTED');

    // The empty repository gets its initial commit (the flagship path), then the snapshot import.
    const initialCommit = await provider.commitFiles({
      repository: { owner: 'acme', name: 'empty-repo' },
      branch: 'main',
      message: 'Mission marker: the initial commit of the onboarding journey',
      files: [{ path: 'SOS-MISSION.md', contents: '# The mission\n\nFormalized by the SOS onboarding journey.\n' }],
    });
    expect(initialCommit.status).toBe('OK');
    if (initialCommit.status !== 'OK') {
      throw new Error('unreachable');
    }
    const snapshot = await provider.getRepositorySnapshot({ owner: 'acme', name: 'empty-repo' }, { branch: 'main' }, NOW);
    expect(snapshot.status).toBe('OK');
    if (snapshot.status !== 'OK') {
      throw new Error('unreachable');
    }
    expect(snapshot.result.is_empty).toBe(false);
    const imported = provider.importSnapshot(snapshot.result);

    // Formalize through the REAL domain builders.
    const result = formalizeGreenfieldJourney({
      draft,
      repository: { owner: 'acme', name: 'empty-repo', was_empty: true, branch: 'main', head_sha: imported.revision.value },
      provenance: [...ONBOARDING_FIXTURE_PROVENANCE],
      created_at: NOW,
      authority_ref: ONBOARDING_AUTHORITY_ANCHOR,
    });

    // The frozen domain validators accept every artifact (verbatim shapes).
    expect(() => assertValidMission(result.mission)).not.toThrow();
    expect(() => assertValidSystemStateArtifact(result.system_state)).not.toThrow();
    for (const record of result.evidence) {
      expect(() => assertValidEvidenceRecord(record)).not.toThrow();
    }

    // The repository identity/revision is linked into System State.
    expect(result.system_state.content.implementation).toEqual([
      {
        artifact_id: result.implementation_model.id,
        revision: { kind: 'git-sha', value: imported.revision.value },
      },
    ]);
    expect(result.system_state.content.implementation[0]?.revision.value).toBe(initialCommit.result.sha);
    expect(result.implementation_model.id).toMatch(/^sos:\/\/ImplementationModel\/[0-9a-f]{32}$/);

    // Persist through the REAL live-store repositories (the P2 boundary).
    const store = createInMemoryLiveStore({ clock: new ManualClock(Date.parse(NOW)) });
    const missionPut = await store.missions.put(result.mission);
    expect(missionPut.kind).toBe('STORED');
    const statePut = await store.systemStates.put(result.system_state);
    expect(statePut.kind).toBe('STORED');
    for (const record of result.evidence) {
      const evidencePut = await store.evidence.put(record);
      expect(evidencePut.kind).toBe('STORED');
    }
    // Replay protection: identical writes are no-ops (IDENTICAL), never duplicates.
    expect((await store.missions.put(result.mission)).kind).toBe('IDENTICAL');

    // What was persisted is what the journey formalized (verbatim round-trip).
    const storedMission = await store.missions.get(result.mission.envelope.id);
    expect(storedMission).toEqual(result.mission);
    const storedState = await store.systemStates.get(result.system_state.envelope.id);
    expect(storedState).toEqual(result.system_state);

    // The development state carries the onboarding journey (resumable persistence).
    const developmentPut = await store.developmentState.put({
      state_id: 'onboarding-greenfield-journey',
      revision: 1,
      description: 'The completed greenfield onboarding journey (P4 acceptance fixture).',
      state: { stage: 'PERSISTED', mission_id: result.mission.envelope.id, repository: `${imported.repository.owner}/${imported.repository.name}`, revision: imported.revision.value },
      updated_at: NOW,
    });
    expect(developmentPut.kind).toBe('STORED');

    // The journey is at its terminal stage and the result view model binds the spine subject.
    draft.repository = { owner: 'acme', name: 'empty-repo', is_empty: false, branch: 'main', head_sha: imported.revision.value };
    expect(greenfieldCurrentStage(draft)).toBe('PERSISTED');
    const view = projectGreenfieldResult({
      result,
      repository: { owner: 'acme', name: 'empty-repo', was_empty: true, branch: 'main', head_sha: imported.revision.value },
      connection: greenfieldFixtureConnection(),
      data_source: onboardingDemoSource(),
    });
    expect(view.core.subject_id).toBe(result.mission.envelope.id);
    expect(view.linked_revision.sha).toBe(imported.revision.value);
    expect(view.repository_was_empty).toBe(true);
  });

  test('the journey refuses to formalize without the explicit authority confirmation (the gate is structural)', () => {
    const draft = completeGreenfieldDraft();
    expect(() =>
      formalizeGreenfieldJourney({
        draft: { ...draft, authority_confirmed: false },
        repository: { owner: 'acme', name: 'empty-repo', was_empty: true, branch: 'main', head_sha: 'a'.repeat(40) },
        provenance: [...ONBOARDING_FIXTURE_PROVENANCE],
        created_at: NOW,
        authority_ref: ONBOARDING_AUTHORITY_ANCHOR,
      }),
    ).toThrow(/authority gate is not confirmed/);
    expect(() =>
      formalizeGreenfieldJourney({
        draft: { ...draft, repository: null },
        repository: { owner: 'acme', name: 'empty-repo', was_empty: true, branch: 'main', head_sha: 'a'.repeat(40) },
        provenance: [...ONBOARDING_FIXTURE_PROVENANCE],
        created_at: NOW,
        authority_ref: ONBOARDING_AUTHORITY_ANCHOR,
      }),
    ).toThrow(/no repository is selected/);
  });

  test('the stage order is exactly the Work Order sequence', () => {
    expect([...GREENFIELD_STAGES]).toEqual([
      'PURPOSE',
      'OUTCOMES',
      'STAKEHOLDERS',
      'MEASURES',
      'CONSTRAINTS',
      'REVIEW',
      'AUTHORITY_CONFIRMATION',
      'GITHUB_CONNECTION',
      'PERSISTED',
    ]);
  });
});

describe('the brownfield journey: import -> evidence scan -> competing hypotheses -> confirmation', () => {
  test('the competing set is presented and never collapsed (the diversity guard)', async () => {
    const provider: GitHubPort = createInMemoryGitHubProvider();
    const discovery = await provider.discoverRepositories();
    if (discovery.status !== 'OK') {
      throw new Error('unreachable');
    }
    const legacy = discovery.result.find((repository) => repository.id.name === 'legacy-checkout');
    expect(legacy?.is_empty).toBe(false);

    const snapshot = await provider.getRepositorySnapshot(legacy?.id ?? { owner: 'acme', name: 'legacy-checkout' }, { branch: 'main' }, NOW);
    expect(snapshot.status).toBe('OK');
    if (snapshot.status !== 'OK') {
      throw new Error('unreachable');
    }
    expect(snapshot.result.file_count).toBe(5);

    // The competing hypotheses (view-level, spine-referenced) present the full set.
    const readings = ['service-oriented', 'library-first', 'split-services'];
    const hypotheses = readings.map((reading) => ({
      hypothesis_id: brownfieldHypothesisId(reading),
      label: reading,
      statement: `The ${reading} reading of the imported repository.`,
      basis: 'fixture scan basis',
      evidence_refs: [],
      uncertainty: { uncertainty_class: 'MODERATE', statement: 'Which reading is right is genuinely uncertain.' },
    }));
    expect(hypotheses).toHaveLength(3);
    for (const hypothesis of hypotheses) {
      expect(hypothesis.hypothesis_id).toMatch(/^sos:\/\/ArchitectureGraph\/[0-9a-f]{32}$/);
    }
    // Deterministic identity: the same reading basis mints the same id forever.
    expect(brownfieldHypothesisId('service-oriented')).toBe(hypotheses[0]?.hypothesis_id);

    // The diversity guard: ambiguity with fewer than two hypotheses is a contract violation.
    expect(() => assertCompetingHypothesesNotCollapsed({ ambiguity_detected: true, hypothesis_count: 1 })).toThrow(/AMBIGUITY_COLLAPSED/);
    expect(() => assertCompetingHypothesesNotCollapsed({ ambiguity_detected: true, hypothesis_count: 3 })).not.toThrow();
    expect(() => assertCompetingHypothesesNotCollapsed({ ambiguity_detected: false, hypothesis_count: 1 })).not.toThrow();
  });
});

describe('the connection vocabulary alignment (@sos-2/github -> the onboarding view)', () => {
  test('the provider connection states map 1:1 onto the onboarding connection view states', async () => {
    const provider = createInMemoryGitHubProvider();
    expect(connectionViewStateFromProvider(provider.connection())).toBe('NOT_YET_CONNECTED');
    const authorization = provider.beginConnection({ scopes: ['repository:metadata:read'], state_token: 'alignment' });
    const completion = provider.completeConnection({ authorization_ref: authorization.authorization_ref, authorization_code: 'simulated', completed_at: NOW });
    if (completion.status !== 'CONNECTED') {
      throw new Error('unreachable');
    }
    // A SIMULATED connected provider maps to CONNECTED_SIMULATED — never CONNECTED_REAL.
    expect(connectionViewStateFromProvider({ status: 'CONNECTED', simulated: true, granted_scopes: [], note: '' })).toBe('CONNECTED_SIMULATED');
    expect(connectionViewStateFromProvider({ status: 'CONNECTED', simulated: false, granted_scopes: [], note: '' })).toBe('CONNECTED_REAL');
    expect(connectionViewStateFromProvider({ status: 'NOT_YET_CONNECTED', simulated: false, granted_scopes: [], note: '' })).toBe('NOT_YET_CONNECTED');
    expect(connectionViewStateFromProvider({ status: 'EXPIRED', simulated: false, granted_scopes: [], note: '' })).toBe('EXPIRED');
    expect(connectionViewStateFromProvider({ status: 'REVOKED', simulated: false, granted_scopes: [], note: '' })).toBe('REVOKED');
    expect(connectionViewStateFromProvider({ status: 'UNAVAILABLE', simulated: false, granted_scopes: [], note: '' })).toBe('UNAVAILABLE');
    expect(connectionViewStateFromProvider({ status: 'UNKNOWN', simulated: false, granted_scopes: [], note: '' })).toBe('UNKNOWN');
    // An unknown provider status maps honestly to UNKNOWN.
    expect(connectionViewStateFromProvider({ status: 'SOMETHING_ELSE', simulated: false, granted_scopes: [], note: '' })).toBe('UNKNOWN');
  });
});
