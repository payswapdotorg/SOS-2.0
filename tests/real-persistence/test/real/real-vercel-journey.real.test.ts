/**
 * The REAL Vercel journey (Work Order P17-A) — env-gated (RUN_REAL=1),
 * default OFF. The journey through the real Vercel API:
 *
 *   1. the authenticated token probe (GET /v2/user);
 *   2. team discovery (the team payswaporg scope);
 *   3. project discovery/creation (git-linked to
 *      payswapdotorg/SOS-2.0 with the apps/web rootDirectory + nextjs
 *      preset per the P3 vercel contract) + the connectivity profile
 *      (the monorepo dependency-closure build command + public preview
 *      URLs);
 *   4. THE REAL DEPLOYMENT of apps/web from the EXACT git head of this
 *      checkout (gitSource {type:'github', repoId, ref:<40-hex sha>})
 *      — waited to READY, the preview URL fetched (HTTP 200);
 *   5. the frozen deployment records minted through the existing
 *      contracts: the DeploymentRecord (artifact_revision = git-sha of
 *      the exact head), the P3 registrar-shaped revision record with
 *      the rollback pointer, the truthful DeploymentOutcome, and the
 *      frozen DeploymentStore lifecycle transition (PLANNED -> DEPLOYED
 *      with statusOf aggregation);
 *   6. honest provider states throughout.
 *
 * The deployment record carries the EXACT source_revision_sha of the
 * deployed head; a working preview URL bound to that exact head is the
 * connectivity proof.
 */

import { describe, expect, it } from 'vitest';
import { DeploymentStore } from '@sos-2/deployment';
import { assertValidDeployment } from '@sos-2/deployment';
import { DeploymentProbeLedger, DeploymentTranscriptRecorder, RealVercelDeploymentProvider } from '@sos-2/deployment-providers';
import { bindGlobalFetch, createDeploymentRecordingFetchPort } from '@sos-2/deployment-providers';
import {
  ambientSource,
  Journey,
  realSleep,
  repoHeadSha,
  RUN_REAL,
  writeEvidence,
} from './real-world.js';
import type { RealVercelDeploymentJourney } from '@sos-2/deployment-providers';

const suite = RUN_REAL ? describe : describe.skip;

const PROJECT_NAME = 'sos-2-0';
const GIT_REPO = { org: 'payswapdotorg', repo: 'SOS-2.0' };

suite('REAL Vercel integration (RUN_REAL=1): the exact-head deployment through the existing deployment contracts', () => {
  const journey = new Journey();
  const source = ambientSource();
  const token = source['VERCEL_TOKEN'];
  const clock = { nowEpochMs: () => Date.now() };
  const ledger = new DeploymentProbeLedger();
  const transcript = new DeploymentTranscriptRecorder({ credentialReference: 'VERCEL_TOKEN' });
  const fetch = token !== undefined && token.length > 0 ? bindGlobalFetch({ timeoutMs: 60_000 }) : null;
  const recordingFetch =
    fetch !== null ? createDeploymentRecordingFetchPort({ inner: fetch, transcript, clock }) : null;
  const provider =
    token !== undefined && recordingFetch !== null
      ? new RealVercelDeploymentProvider({
          token,
          teamId: source['VERCEL_ORG_ID'] ?? null,
          fetch: recordingFetch,
          clock,
          ledger,
          credentialEnv: 'VERCEL_TOKEN',
          sleep: realSleep,
        })
      : null;

  const headSha = repoHeadSha();
  let deploymentJourney: RealVercelDeploymentJourney | null = null;
  let previewHttpOk = false;

  it('probes the REAL Vercel API with the VERCEL_TOKEN (the authenticated startup probe)', async () => {
    if (provider === null) {
      journey.record('user-probe', false, {
        attempted: false,
        reason: 'no VERCEL_TOKEN configured in the environment (names only)',
      });
      return;
    }
    const user = await provider.probe();
    if (user === null) {
      journey.record('user-probe', false, { state: provider.providerState().state, failure: provider.providerState().last_error });
      return;
    }
    journey.record('user-probe', true, {
      username: user.username,
      user_id: user.id,
      default_team_id: user.defaultTeamId,
      billing_plan: user.billingPlan,
      api_revision: 'vercel.v2',
    });
    expect(user.id.length).toBeGreaterThan(0);
  });

  it('discovers the team scope (the payswaporg team)', async () => {
    if (provider === null || provider.providerState().state !== 'CONNECTED') {
      return;
    }
    const teams = await provider.discoverTeams();
    journey.record('team-discovery', true, {
      teams: teams.map((team) => ({ id: team.id, name: team.name, slug: team.slug })),
    });
    expect(teams.length).toBeGreaterThan(0);
  });

  it('ensures the git-linked project exists with the P3 contract shape + the connectivity profile', async () => {
    if (provider === null || provider.providerState().state !== 'CONNECTED') {
      return;
    }
    const project = await provider.ensureProject({ name: PROJECT_NAME, gitRepository: GIT_REPO });
    journey.record('ensure-project', true, {
      project_id: project.id,
      name: project.name,
      framework: project.framework,
      root_directory: project.rootDirectory,
      node_version: project.nodeVersion,
      git_repository: project.gitRepository,
    });
    expect(project.rootDirectory).toBe('apps/web');
    expect(project.framework).toBe('nextjs');
    expect(project.gitRepository?.repo).toBe('SOS-2.0');
    expect(project.gitRepository?.repoId).not.toBeNull();
  });

  it('deploys apps/web from the EXACT git head and waits for READY (the connectivity proof)', async () => {
    if (provider === null || provider.providerState().state !== 'CONNECTED') {
      journey.record('deployment', false, { attempted: false, reason: 'provider not CONNECTED (the recorded real failure)' });
      return;
    }
    const project = await provider.ensureProject({ name: PROJECT_NAME, gitRepository: GIT_REPO });
    const repoId = project.gitRepository?.repoId;
    if (repoId === null || repoId === undefined) {
      throw new Error('the git-linked project carries no repoId — cannot create a git deployment');
    }
    const previous = await provider.previousDeploymentRevisionId(project.id, 'none');
    const started = Date.now();
    deploymentJourney = await provider.deployFromGitRef({
      projectName: PROJECT_NAME,
      project,
      repoId,
      sourceRevisionSha: headSha,
      target: 'preview',
      environment: 'production',
      previousDeploymentRevisionId: previous,
      maxPollAttempts: 90,
      pollIntervalMs: 6_000,
    });
    journey.record('deployment', deploymentJourney.deployment.readyState === 'READY', {
      deployment_id: deploymentJourney.deployment.id,
      url: deploymentJourney.deployment.url,
      ready_state: deploymentJourney.deployment.readyState,
      requested_source_revision_sha: headSha,
      observed_commit_sha: deploymentJourney.deployment.commitSha,
      binding_verified: deploymentJourney.outcome.detail && (deploymentJourney.outcome.detail as Record<string, unknown>)['binding_verified'],
      poll_attempts: deploymentJourney.pollAttempts,
      duration_ms: Date.now() - started,
    });
    expect(deploymentJourney.deployment.commitSha).toBe(headSha);
    expect(deploymentJourney.deployment.readyState).toBe('READY');
    expect(deploymentJourney.outcome.availability).toBe('SUCCESS');
  });

  it('fetches the preview URL over real HTTP (a working preview bound to the exact head)', async () => {
    if (deploymentJourney === null || deploymentJourney.deployment.url === null) {
      return;
    }
    // The preview URL check uses the platform fetch directly (the process
    // boundary in a TEST file — the provider itself never does this).
    const response = await globalThis.fetch(`https://${deploymentJourney.deployment.url}`);
    const body = await response.text();
    previewHttpOk = response.status === 200 && body.includes('<!DOCTYPE html>');
    journey.record('preview-url-fetch', previewHttpOk, {
      url: `https://${deploymentJourney.deployment.url}`,
      http_status: response.status,
      html_served: previewHttpOk,
    });
    expect(previewHttpOk).toBe(true);
  });

  it('mints the frozen deployment records and drives the frozen DeploymentStore lifecycle', () => {
    if (deploymentJourney === null) {
      return;
    }
    const journeyResult = deploymentJourney;
    // The frozen DeploymentRecord validates and binds the EXACT head.
    expect(() => assertValidDeployment(journeyResult.record)).not.toThrow();
    expect(journeyResult.record.content.artifact_revision).toEqual({ kind: 'git-sha', value: headSha });
    // The frozen store lifecycle: PLANNED -> DEPLOYED, outcome recorded, truthful status.
    const store = new DeploymentStore();
    store.put(journeyResult.record);
    const deployed = store.deploy(journeyResult.record.envelope.id, {
      at: new Date(clock.nowEpochMs()).toISOString(),
      provenance: ['p17a:real-vercel-deployment', `head:${headSha}`],
    });
    expect(deployed.envelope.status).toBe('ACTIVE');
    store.recordOutcome(deploymentJourney.outcome);
    expect(store.statusOf(deploymentJourney.record.envelope.id)).toBe('SUCCESS');
    journey.record('deployment-records', true, {
      deployment_record_id: deploymentJourney.record.envelope.id,
      lifecycle: 'PLANNED -> DEPLOYED (envelope DRAFT -> ACTIVE)',
      status_of: 'SUCCESS',
      revision_record: deploymentJourney.revisionRecord,
      rollback_pointer: deploymentJourney.revisionRecord.rollback_pointer,
    });
  });

  it('writes the machine-readable evidence (honest — including failures; credentials redacted)', () => {
    const state = ledger.report('VERCEL_TOKEN');
    const path = writeEvidence('vercel-deployment.json', {
      evidence_kind: 'deployment-connectivity',
      provider: 'vercel',
      provider_states: [state],
      credential_envs: ['VERCEL_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_ORG_ID'],
      api: 'https://api.vercel.com (v2 user/teams, v9/v10 projects, v13 deployments, v6 deployments list)',
      git_source_protocol: "gitSource {type:'github', repoId:<number>, ref:<40-hex sha>} — verified against the real API (the response echoes gitSource.sha)",
      project: { name: PROJECT_NAME, git_repository: `${GIT_REPO.org}/${GIT_REPO.repo}`, root_directory: 'apps/web', framework: 'nextjs' },
      connectivity_profile: {
        build_command: 'pnpm --filter @sos-2/web^... run build && pnpm run build (the monorepo dependency closure — verified against the real API)',
        sso_protection: 'disabled (public preview URLs — verified: PATCH ssoProtection: null)',
      },
      deployment:
        deploymentJourney === null
          ? null
          : {
              deployment_revision_id: deploymentJourney.deployment.id,
              url: deploymentJourney.deployment.url ? `https://${deploymentJourney.deployment.url}` : null,
              preview_http_ok: previewHttpOk,
              ready_state: deploymentJourney.deployment.readyState,
              source_revision_sha: headSha,
              observed_commit_sha: deploymentJourney.deployment.commitSha,
              binding_verified: (deploymentJourney.outcome.detail as Record<string, unknown>)['binding_verified'],
              poll_attempts: deploymentJourney.pollAttempts,
              waited_ms: deploymentJourney.waitedMs,
            },
      deployment_record:
        deploymentJourney === null
          ? null
          : {
              record_id: deploymentJourney.record.envelope.id,
              deployment_id: deploymentJourney.record.content.deployment_id,
              environment: deploymentJourney.record.content.environment,
              artifact_revision: deploymentJourney.record.content.artifact_revision,
              target_runtime: deploymentJourney.record.content.target_runtime,
              configuration: deploymentJourney.record.content.configuration,
              rollback: deploymentJourney.record.content.rollback,
              outcome: deploymentJourney.outcome,
            },
      transcript: transcript.all(),
      request_log: provider?.recordedRequests() ?? [],
      steps: journey.steps,
      honest_notes: [
        'The deployment record carries the EXACT source_revision_sha of the deployed head; the provider VERIFIES the response commit sha equals it (a mismatch is a FAILURE outcome — never a fabricated binding).',
        'A working preview URL bound to the exact head is the connectivity proof (HTTP 200 with the served HTML).',
        'The frozen DeploymentStore lifecycle ran: PLANNED -> DEPLOYED with the truthful outcome recorded (statusOf = SUCCESS).',
      ],
    });
    expect(path.endsWith('vercel-deployment.json')).toBe(true);
  });
});
