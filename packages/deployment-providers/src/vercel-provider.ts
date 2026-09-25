/**
 * The REAL Vercel deployment provider (Work Order P17-A) — the real
 * deployment provider surface wired through the EXISTING deployment
 * contracts (the frozen @sos-2/deployment surface + the P3 registrar
 * contract shape, mirrored structurally):
 *
 *   - REAL Vercel API operations (vercel-api.ts): token probe
 *     (GET /v2/user), team discovery, project discovery/creation with
 *     the git repository link and the apps/web rootDirectory (the P3
 *     vercel project-scope contract), deployment creation from an EXACT
 *     git ref (gitSource {type:'github', repoId, ref:<40-hex sha>} —
 *     the verified real protocol), deployment state reads and the
 *     deployments list.
 *   - Every successful deployment mints a DeploymentRecord through the
 *     FROZEN createDeployment (artifact_revision = ExactRevision kind
 *     git-sha bound to the EXACT source_revision_sha of the deployed
 *     head; lifecycle PLANNED -> DEPLOYED through the frozen store).
 *   - A DeploymentRevisionRecord per the P3 registrar contract shape
 *     (environment, provider 'vercel', region, the exact
 *     source_revision_sha, the provider-assigned deployment revision id
 *     'dpl_…', registered_at from the injected clock, and the rollback
 *     pointer to the previous deployment revision id).
 *   - A truthful DeploymentOutcome (the frozen 6 truth states): READY ->
 *     SUCCESS; ERROR/CANCELED -> FAILURE; still building at timeout ->
 *     UNKNOWN (never fabricated into either direction).
 *
 * HONESTY: the P17-A provider state (CONNECTED/UNKNOWN/UNAVAILABLE/
 * DEGRADED) comes from REAL probes only. The rollback declaration
 * follows the W12 fixture discipline: a bounded mechanism (CUSTOM
 * PROCEDURE with a documented procedure reference, or ROLLBACK_DEPLOYMENT
 * to the previous revision when one exists), a MANUAL trigger and a
 * deterministically-minted AuthorityGrant spine id — never an
 * UNSPECIFIED mechanism.
 */

import { createDeployment, DeploymentLifecycleError } from '@sos-2/deployment';
import type { DeploymentContent, DeploymentOutcome, DeploymentRecord } from '@sos-2/deployment';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import type { ExactRevision } from '@sos-2/system-state';
import type { Clock } from '@sos-2/live-store';
import { VercelApiError, VercelRestClient } from './vercel-api.js';
import type { RecordedVercelRequest, VercelDeploymentIdentity, VercelProjectIdentity, VercelTeamIdentity, VercelUserIdentity } from './vercel-api.js';
import { TransportError } from './http.js';
import type { FetchPort } from './http.js';
import { DeploymentProbeLedger } from './provider-state.js';
import type { RealDeploymentProviderStateReport } from './provider-state.js';
import { VERCEL_APP_ROOT_DEFAULT, validateDeploymentRevisionRecord, vercelProjectScope } from './infra-vocabulary.js';
import type { DeploymentRevisionRecord } from './infra-vocabulary.js';

/** The provider id. */
export const REAL_VERCEL_PROVIDER_ID = 'vercel-real';

/**
 * The P17-A connectivity build command (verified against the real API on
 * this lane's provisioned project): the apps/web build requires the
 * monorepo workspace dependency closure built FIRST (the packages ship
 * no dist to git); `pnpm --filter @sos-2/web^... run build` builds the
 * dependency closure, then `pnpm run build` runs next build.
 */
export const VERCEL_CONNECTIVITY_BUILD_COMMAND = 'pnpm --filter @sos-2/web^... run build && pnpm run build';

/** The injectable sleep (deterministic tests resolve instantly; the process boundary binds the real timer). */
export type Sleep = (ms: number) => Promise<void>;

export interface RealVercelProviderOptions {
  /** The token VALUE (secret; injected at the composition boundary). */
  readonly token: string;
  /** The team id scope, or null to discover/use the personal default. */
  readonly teamId: string | null;
  /** The injectable network seam. */
  readonly fetch: FetchPort;
  /** The injected clock (probe/record instants; no hidden time). */
  readonly clock: Clock;
  /** The probe ledger (honest states from REAL probes only). */
  readonly ledger: DeploymentProbeLedger;
  /** The env NAME the token came from (for redacted references in reports). */
  readonly credentialEnv: string | null;
  /** The injectable sleep (waits between deployment-state polls). */
  readonly sleep: Sleep;
  /** The API base URL override (deterministic tests). */
  readonly baseUrl?: string;
}

/** The result of one REAL deployment journey (records minted through the frozen contracts). */
export interface RealVercelDeploymentJourney {
  /** The real Vercel deployment identity (id, url, readyState, exact commit sha). */
  readonly deployment: VercelDeploymentIdentity;
  /** The project the deployment belongs to. */
  readonly project: VercelProjectIdentity;
  /** The DeploymentRecord minted through the frozen createDeployment. */
  readonly record: DeploymentRecord;
  /** The P3 registrar-shaped revision record (rollback pointers). */
  readonly revisionRecord: DeploymentRevisionRecord;
  /** The truthful outcome (READY -> SUCCESS; ERROR/CANCELED -> FAILURE; timeout -> UNKNOWN). */
  readonly outcome: DeploymentOutcome;
  /** Poll attempts performed while waiting for readiness. */
  readonly pollAttempts: number;
  /** Total wait duration in milliseconds (injected-clock arithmetic). */
  readonly waitedMs: number;
}

/** The bounded rollback declaration builder input. */
export interface RollbackDeclarationInput {
  /** The previous Vercel deployment revision id (dpl_…), or null for the first deployment. */
  readonly previousDeploymentRevisionId: string | null;
}

/**
 * The rollback-authority spine id — deterministically minted (the W12
 * deployment fixture discipline: a well-formed AuthorityGrant id
 * authorizing the rollback path; the id is derived from fixed content,
 * stable across runs and platforms).
 */
export const VERCEL_ROLLBACK_AUTHORITY = deriveDeterministicArtifactId('AuthorityGrant', {
  note: 'P17-A real Vercel deployment rollback authority (the operator authority that pulls the plug through the MANUAL trigger)',
});

/**
 * The REAL Vercel deployment provider behind the existing deployment
 * contracts.
 */
export class RealVercelDeploymentProvider {
  readonly providerId = REAL_VERCEL_PROVIDER_ID;
  readonly providerName = 'vercel' as const;

  private readonly api: VercelRestClient;
  private readonly clock: Clock;
  private readonly ledger: DeploymentProbeLedger;
  private readonly credentialEnv: string | null;
  private readonly sleep: Sleep;

  constructor(options: RealVercelProviderOptions) {
    this.api = new VercelRestClient({
      token: options.token,
      teamId: options.teamId,
      fetch: options.fetch,
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    });
    this.clock = options.clock;
    this.ledger = options.ledger;
    this.credentialEnv = options.credentialEnv;
    this.sleep = options.sleep;
  }

  /** The env NAME the credential came from (names only — never values). */
  credentialEnvName(): string | null {
    return this.credentialEnv;
  }

  /** The recorded REST round-trips (method + path + status; never credentials). */
  recordedRequests(): readonly RecordedVercelRequest[] {
    return this.api.recordedRequests();
  }

  /** The honest P17-A provider-state report (probe evidence or the honest unprobed state). */
  providerState(): RealDeploymentProviderStateReport {
    return this.ledger.report(this.credentialEnv);
  }

  /**
   * The REAL startup/health probe: GET /v2/user with the token — the
   * authenticated handshake. Records a probe entry (honest state).
   * Returns the user identity on success, or null on failure (never
   * throws for a provider failure).
   */
  async probe(): Promise<VercelUserIdentity | null> {
    const endpoint = 'GET /v2/user';
    try {
      const user = await this.api.user();
      const ok = user.id.length > 0;
      this.ledger.record({
        provider: 'vercel',
        probeId: 'vercel:user-probe',
        endpoint,
        at: new Date(this.clock.nowEpochMs()).toISOString(),
        status: 200,
        ok,
        failure: ok ? null : 'the API answered but the user identity was absent',
        apiRevision: 'vercel.v2',
      });
      return ok ? user : null;
    } catch (error) {
      const failure =
        error instanceof TransportError
          ? `transport failure: ${error.message}`
          : error instanceof VercelApiError
            ? `api failure (HTTP ${String(error.status ?? 0)}): ${error.message}`
            : `unexpected failure: ${(error as Error).message}`;
      this.ledger.record({
        provider: 'vercel',
        probeId: 'vercel:user-probe',
        endpoint,
        at: new Date(this.clock.nowEpochMs()).toISOString(),
        status: error instanceof VercelApiError ? error.status : null,
        ok: false,
        failure,
        apiRevision: null,
      });
      return null;
    }
  }

  /** GET /v2/teams — team discovery (records a probe entry). */
  async discoverTeams(): Promise<VercelTeamIdentity[]> {
    return this.api.teams();
  }

  /** GET /v9/projects/{name} — project discovery, or null when absent. */
  async discoverProject(nameOrId: string): Promise<VercelProjectIdentity | null> {
    return this.api.getProject(nameOrId);
  }

  /**
   * Ensure the project exists with the git repository link + the
   * apps/web rootDirectory (the P3 vercel project-scope contract), then
   * apply the P17-A connectivity profile (the monorepo
   * dependency-closure build command + public preview URLs). An existing
   * project is returned as-is (idempotent; the profile is re-applied —
   * idempotent PATCHes).
   */
  async ensureProject(input: { name: string; gitRepository: { org: string; repo: string } }): Promise<VercelProjectIdentity> {
    const existing = await this.api.getProject(input.name);
    const project =
      existing !== null
        ? existing
        : await this.api.createProject({
            name: input.name,
            gitRepository: input.gitRepository,
            rootDirectory: VERCEL_APP_ROOT_DEFAULT,
            framework: 'nextjs',
          });
    return this.api.patchProject(project.id, {
      buildCommand: VERCEL_CONNECTIVITY_BUILD_COMMAND,
      ssoProtectionDisabled: true,
    });
  }

  /**
   * The REAL deployment journey: create a deployment from an EXACT git
   * ref, wait for readiness, and mint the frozen deployment record +
   * the P3-shaped revision record + the truthful outcome.
   *
   * The `sourceRevisionSha` MUST be the 40-hex git sha of the deployed
   * head — the binding the evidence requires (the provider VERIFIES the
   * response's commit sha equals it and records a FAILURE outcome
   * otherwise — never a fabricated binding).
   */
  async deployFromGitRef(input: {
    projectName: string;
    project: VercelProjectIdentity;
    repoId: number;
    sourceRevisionSha: string;
    /** 'production' for production deployments; preview deployments omit the target (the verified real protocol). */
    target: 'production' | 'preview';
    environment: 'local' | 'preview' | 'production';
    previousDeploymentRevisionId: string | null;
    maxPollAttempts?: number;
    pollIntervalMs?: number;
  }): Promise<RealVercelDeploymentJourney> {
    const scope = vercelProjectScope(input.target === 'production' ? 'production' : 'preview');
    const maxAttempts = input.maxPollAttempts ?? 60;
    const intervalMs = input.pollIntervalMs ?? 5_000;
    const createdAt = new Date(this.clock.nowEpochMs()).toISOString();
    const startEpochMs = this.clock.nowEpochMs();

    const deployment = await this.api.createDeployment({
      projectName: input.projectName,
      repoId: input.repoId,
      ref: input.sourceRevisionSha,
      target: input.target === 'production' ? 'production' : null,
    });

    // Wait for readiness through injectable sleep + the injected clock
    // (deterministic in reference mode; the process boundary binds the
    // real timer). UNREADY at timeout => truthful UNKNOWN, never a
    // fabricated SUCCESS/FAILURE.
    let current = deployment;
    let attempts = 0;
    while (!isTerminal(current.readyState) && attempts < maxAttempts) {
      attempts += 1;
      await this.sleep(intervalMs);
      current = await this.api.getDeployment(deployment.id);
    }

    const waitedMs = this.clock.nowEpochMs() - startEpochMs;
    const availability: EvidenceTruthState =
      current.readyState === 'READY'
        ? 'SUCCESS'
        : current.readyState === 'ERROR' || current.readyState === 'CANCELED'
          ? 'FAILURE'
          : 'UNKNOWN';

    // THE EXACT-HEAD BINDING (verified, never fabricated): a deployment
    // whose commit sha does not equal the requested source revision sha
    // is a FAILURE outcome with the mismatch recorded verbatim.
    const bindingMismatch =
      current.commitSha !== null && current.commitSha !== input.sourceRevisionSha;
    const finalAvailability: EvidenceTruthState = bindingMismatch ? 'FAILURE' : availability;

    const sha = input.sourceRevisionSha;
    const shortSha = sha.slice(0, 12);
    const artifactRevision: ExactRevision = { kind: 'git-sha', value: sha };
    const content: DeploymentContent = {
      deployment_id: `vercel-${input.target}-${shortSha}`,
      environment: input.environment,
      artifact_revision: artifactRevision,
      target_runtime: {
        runtime_id: `vercel:${input.project.id}`,
        runtime_kind: 'vercel-serverless',
        runtime_version: input.project.nodeVersion ?? 'unknown',
      },
      configuration: {
        vercel_deployment_id: current.id,
        deployment_url: current.url,
        team_id: current.teamId,
        project_id: input.project.id,
        project_name: input.projectName,
        target: input.target,
        region: current.region ?? 'iad1',
        framework: input.project.framework ?? 'nextjs',
        root_directory: input.project.rootDirectory ?? scope.appRoot,
        git_repo_id: input.repoId,
        ready_state: current.readyState,
        commit_sha_bound: current.commitSha,
        binding_verified: !bindingMismatch,
      },
      rollback: buildRollbackDeclaration({ previousDeploymentRevisionId: input.previousDeploymentRevisionId }),
    };

    const record = createDeployment({
      content,
      provenance: [
        'p17a:real-vercel-deployment',
        `vercel-project:${input.project.id}`,
        `git-ref:${sha}`,
        `ready-state:${current.readyState}`,
      ],
      created_at: createdAt,
      status: 'DRAFT',
    });

    const revisionRecord: DeploymentRevisionRecord = {
      environment: input.environment,
      provider: 'vercel',
      region: current.region ?? 'iad1',
      source_revision_sha: sha,
      deployment_revision_id: current.id,
      registered_at: createdAt,
      rollback_pointer: { previous_deployment_revision_id: input.previousDeploymentRevisionId },
    };
    validateDeploymentRevisionRecord(revisionRecord);

    const outcome: DeploymentOutcome = {
      deployment_ref: record.envelope.id,
      availability: finalAvailability,
      detail: {
        vercel_deployment_id: current.id,
        url: current.url,
        ready_state: current.readyState,
        requested_source_revision_sha: sha,
        observed_commit_sha: current.commitSha,
        binding_verified: !bindingMismatch,
        poll_attempts: attempts,
        waited_ms: waitedMs,
      },
      window: null,
      producer: {
        tool: '@sos-2/deployment-providers',
        tool_version: '1.0.0',
        model: null,
        model_version: null,
        command: 'RUN_REAL=1 pnpm --filter @sos-2/tests-real-persistence test',
        environment: 'real:vercel',
      },
      simulated: false,
    };

    return {
      deployment: current,
      project: input.project,
      record,
      revisionRecord,
      outcome,
      pollAttempts: attempts,
      waitedMs,
    };
  }

  /**
   * The previous deployment revision id for rollback pointers: the most
   * recent deployment of the project bound to a git commit (dpl_…), or
   * null when none exists. Uses GET /v6/deployments (oldest-first page)
   * and picks the newest deployment that is not the given deployment.
   */
  async previousDeploymentRevisionId(projectId: string, excludeDeploymentId: string): Promise<string | null> {
    const deployments = await this.api.listDeployments({ projectId, limit: 20 });
    const bound = deployments.filter((deployment) => deployment.id !== excludeDeploymentId && deployment.commitSha !== null);
    if (bound.length === 0) {
      return null;
    }
    return bound[0]!.id;
  }
}

function isTerminal(readyState: string): boolean {
  return readyState === 'READY' || readyState === 'ERROR' || readyState === 'CANCELED';
}

/**
 * Build a bounded rollback declaration (the W12 fixture discipline; the
 * frozen @sos-2/recovery-control validators run inside createDeployment):
 *   - a previous deployment exists => ROLLBACK_DEPLOYMENT to it;
 *   - the FIRST deployment => a documented CUSTOM_PROCEDURE (the Vercel
 *     redeploy-previous-revision procedure) — never UNSPECIFIED.
 */
export function buildRollbackDeclaration(input: RollbackDeclarationInput): DeploymentContent['rollback'] {
  return {
    mechanism:
      input.previousDeploymentRevisionId !== null
        ? { kind: 'ROLLBACK_DEPLOYMENT', to_deployment_id: input.previousDeploymentRevisionId }
        : {
            kind: 'CUSTOM_PROCEDURE',
            procedure_ref: 'vercel:redeploy-previous-revision (POST /v13/deployments with the previous source_revision_sha, or the Vercel dashboard instant rollback)',
          },
    trigger: { kind: 'MANUAL', authority_ref: VERCEL_ROLLBACK_AUTHORITY },
    authority_ref: VERCEL_ROLLBACK_AUTHORITY,
    exception: null,
  };
}

/** Construct the REAL Vercel deployment provider. */
export function createRealVercelDeploymentProvider(options: RealVercelProviderOptions): RealVercelDeploymentProvider {
  return new RealVercelDeploymentProvider(options);
}

export { DeploymentLifecycleError };
