/**
 * THE REAL DOGFOOD HARNESS (Work Order P19) — the real-system composition
 * that drives the P13 flagship journey engine (packages/greenfield-runtime,
 * consumed NEVER modified) through REAL external systems:
 *
 *   user mission (real clock) -> REAL GitHub: repo created via the API,
 *   PAT whoami handshake, real discovery + empty-repository detection ->
 *   pre-approved typed authority (the gateway re-evaluates at action
 *   time, fail-closed) -> reference formalizer + planner (merged,
 *   unchanged) -> the durable task graph over the live store (HONEST
 *   store selection; the reference in-memory store with the explicit
 *   marker when Neon/Upstash are unreachable — the live-data-plane
 *   precedent) -> BodyBroker leases the REAL HostedCodingBody (REAL
 *   OpenRouter completions; every cloud tick records
 *   userDeviceOnline=false — the §7 pin) -> the body output committed
 *   through the gateway (REAL GitHub commits: the contents-API initial
 *   commit on the empty repository, then the Git Data API) -> REAL
 *   push (the remote branch ref observed at the exact sha) + pull
 *   request on the real repo -> REAL Vercel (fresh project:
 *   gitRepository link + ssoProtection null; production deployment of
 *   the PR head revision via gitSource {repoId, ref}) -> REAL runtime
 *   verification (HTTP GET the deployed URL + the real readyState) ->
 *   completion granted ONLY by the independent evaluation suite (the
 *   real dogfood probes — the body never certifies itself) -> package
 *   learning (data-only learned records carrying the REAL evidence
 *   refs).
 *
 * The async REAL API calls are driven at THIS composition boundary and
 * staged for the sync frozen seams (the P8 discipline — see staging.ts);
 * the drive loop interleaves the async staging with the journey's
 * deterministic cloud ticks. Honest states everywhere; typed aborts with
 * cleanup instructions on pre-existing repos/projects (never silently
 * reused); secrets by env NAMES only.
 */

import { ActionGateway, InMemoryAuthority, InMemoryEventLog, InMemoryEvidenceSink, InMemoryIdempotencyStore } from '@sos-2/action-gateway';
import type { ActionFamily, ActorRef, Clock as GatewayClock, GatewayDeps, GatewayOutcome, PlanningRef } from '@sos-2/action-gateway';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { BodyBroker } from '@sos-2/body-broker';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { EvaluationOrchestrator } from '@sos-2/evaluation-orchestration';
import { EvaluatorRegistry, IndependentEvaluationService } from '@sos-2/evaluator';
import { ExecutionFabric } from '@sos-2/execution-fabric';
import { CompletionCertifier, GreenfieldJourney, ReferenceAuthorityApproval } from '@sos-2/greenfield-runtime';
import type { GreenfieldJourneyDeps, NodeRepairExecutor } from '@sos-2/greenfield-runtime';
import type { GrantingAuthorityPort } from '@sos-2/greenfield-runtime';
import { ReferenceArchitecturePlanner, ReferenceMissionFormalizer, parseTaskWorkProgram } from '@sos-2/implementation-orchestrator';
import type { RawUserMission } from '@sos-2/implementation-orchestrator';
import { createInMemoryLiveStore, formatRfc3339 } from '@sos-2/live-store';
import type { Clock } from '@sos-2/live-store';
import { RepositoryRealizer } from '@sos-2/project-realization';
import { HostedCodingBody, OpenRouterModelClient } from '@sos-2/real-bodies';
import type { HostedModelPort } from '@sos-2/real-bodies';
import { FetchGitHubRequestPort, RealGitHubProvider } from '@sos-2/real-github';
import type { GitHubRequestPort, GitHubProviderResponse } from '@sos-2/real-github';
import { TaskGraph } from '@sos-2/task-graph';
import { createPackageArtifact } from '@sos-2/packages';
import type { PackageArtifact } from '@sos-2/packages';
import { createPackageComposition } from '@sos-2/composition';
import type { PackageCompositionArtifact } from '@sos-2/composition';
import { createEdgeAssertion, EcologyGraph } from '@sos-2/ecology';
import { DeploymentTranscriptRecorder, bindGlobalFetch } from '@sos-2/deployment-providers';
import type { FetchPort } from '@sos-2/deployment-providers';
import { createRealPersistenceStack } from '@sos-2/real-persistence';
import type { PostgresStoreAdapter } from '@sos-2/live-store';
import type { SandboxPolicy } from '@sos-2/sandbox';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { DOGFOOD_DEFAULT_BODY_MODEL, resolveDogfoodEnvironment } from './environment.js';
import type { DogfoodEnvironmentResolution } from './environment.js';
import { createDogfoodVercelClient } from './vercel-rest.js';
import type { DogfoodVercelClient, DogfoodVercelProject, DogfoodVercelDeployment } from './vercel-rest.js';
import { probeDogfoodProviders, selectDogfoodStore } from './provider-snapshot.js';
import type { DogfoodDnsLookup, DogfoodOpenRouterKeyCheck } from './provider-snapshot.js';
import { DogfoodStaging } from './staging.js';
import type { StagedBodyRun } from './staging.js';
import { createRealGitHubGatewayExecutor, createRealVercelGatewayExecutor } from './gateway-executors.js';
import { createRealHostedBodyTaskImplementation, goalForNode, readStagedRunFiles } from './body-binding.js';
import { createDogfoodNodeRepairExecutor } from './repair-binding.js';
import { createDogfoodEvaluatorProbes } from './evaluator-probes.js';
import type { DogfoodNodeRunner } from './evaluator-probes.js';
import { outcomeClassesOf, summarizeReceipt } from './records.js';
import type {
  DogfoodActionReceiptSummary,
  DogfoodDeploymentRecord,
  DogfoodLearningRecord,
  DogfoodModelCallRecord,
  DogfoodProviderState,
  DogfoodPullRequestRecord,
  DogfoodRepairRecord,
  DogfoodRunRecord,
  DogfoodRuntimeVerificationRecord,
  DogfoodStageRecord,
  DogfoodStoreSelection,
} from './records.js';

/** The honest empty-repository base marker (the realizer's workspace seed — an empty real repo carries no sha). */
export const DOGFOOD_EMPTY_REPOSITORY_BASE = 'dogfood:empty-repository-base';

/** The runtime fetch used for the runtime-verification GETs (the documented impure boundary). */
export type DogfoodRuntimeFetch = (url: string) => Promise<{ readonly status: number | null; readonly body: string | null }>;

async function defaultRuntimeFetch(url: string): Promise<{ readonly status: number | null; readonly body: string | null }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { status: null, body: `transport failure: ${(error as Error).message}` };
  }
}

/** The typed setup abort (pre-existing repo/project; missing credentials) — carries cleanup instructions, never silently reuses. */
export class DogfoodAbortError extends Error {
  readonly code: 'PRE_EXISTING_REPOSITORY' | 'PRE_EXISTING_PROJECT' | 'MISSING_CREDENTIALS' | 'PROVIDER_UNAVAILABLE' | 'CONNECTION_REFUSED';
  readonly cleanup: string;

  constructor(code: DogfoodAbortError['code'], message: string, cleanup: string) {
    super(message);
    this.name = 'DogfoodAbortError';
    this.code = code;
    this.cleanup = cleanup;
  }
}

export interface RealDogfoodHarnessOptions {
  /** The injected raw environment source (env-only credentials; NAMES only in every output). */
  readonly source: Readonly<Record<string, string>>;
  /** The runtime journey id (run 1: e.g. 'p19-dogfood-r1'; run 2 fresh). */
  readonly journeyId: string;
  /** The repository slug 'owner/name' the harness CREATES via the real API this run. */
  readonly repositorySlug: string;
  /** The Vercel project name (e.g. 'sos-dogfood-r1'). */
  readonly vercelProjectName: string;
  /** The mission statement (§1: 'Build a markdown notes service with a public API'). */
  readonly missionStatement: string;
  /** The injected live-store clock (real at the process boundary; ManualClock in the deterministic suites). */
  readonly clock: Clock;
  /** The injectable sleep for deployment polls (default: the real timer). */
  readonly sleep?: (ms: number) => Promise<void>;
  /** The injectable GitHub HTTP seam (default: the real FetchGitHubRequestPort with the resolved PAT). */
  readonly githubRequestPort?: GitHubRequestPort;
  /** The injectable Vercel FetchPort (default: the global fetch). */
  readonly vercelFetch?: FetchPort;
  /** The injectable hosted-model port (default: the real OpenRouter client). */
  readonly modelPort?: HostedModelPort;
  /** The injectable runtime fetch (default: the global fetch). */
  readonly runtimeFetch?: DogfoodRuntimeFetch;
  /** The injectable DNS lookup (default: the real resolver). */
  readonly dnsLookup?: DogfoodDnsLookup;
  /** The injectable OpenRouter key check (default: the real probe). */
  readonly openRouterKeyCheck?: DogfoodOpenRouterKeyCheck;
  /** The injectable node runner for the tests probe (default: the real spawnSync execution). */
  readonly nodeRunner?: DogfoodNodeRunner;
  /** The per-node engine attempts of the REAL model calls (default 3 — the P17-B honest-retry precedent). */
  readonly maxEngineAttempts?: number;
  /** The deployment poll bound (default 60 attempts). */
  readonly maxDeployPollAttempts?: number;
  /** The deployment poll interval ms (default 5_000). */
  readonly deployPollIntervalMs?: number;
  /** Advance a ManualClock by this many ms between ticks (deterministic runs; the real clock advances naturally). */
  readonly interTickAdvanceMs?: number;
  /** WHO approved the typed authority (default 'p19-dogfood:operator'). */
  readonly approvedBy?: string;
}

/** The assembled real-dogfood world (introspection for the suites + evidence). */
export interface RealDogfoodHarness {
  readonly options: RealDogfoodHarnessOptions;
  readonly env: DogfoodEnvironmentResolution;
  readonly staging: DogfoodStaging;
  readonly githubRequestPort: GitHubRequestPort;
  readonly provider: RealGitHubProvider;
  readonly vercelClient: DogfoodVercelClient | null;
  readonly vercelTranscript: DeploymentTranscriptRecorder;
  readonly modelPort: HostedModelPort | null;
  readonly body: HostedCodingBody | null;
  readonly bodyId: string;
  readonly store: ReturnType<typeof createInMemoryLiveStore>;
  readonly gateway: ActionGateway;
  readonly authority: InMemoryAuthority;
  readonly broker: BodyBroker;
  readonly fabric: ExecutionFabric;
  readonly graph: TaskGraph;
  readonly realizer: RepositoryRealizer;
  readonly journey: GreenfieldJourney;
  readonly providerStates: readonly DogfoodProviderState[];
  readonly storeSelection: DogfoodStoreSelection;
  readonly repository: { readonly owner: string; readonly name: string };
  readonly vercelProject: DogfoodVercelProject | null;
  readonly modelCalls: readonly DogfoodModelCallRecord[];
  readonly repairs: readonly DogfoodRepairRecord[];
  readonly asks: readonly { readonly askId: string; readonly stage: string; readonly reasonCode: string; readonly detail: string }[];
  readonly realizedCommitShas: readonly string[];
  readonly pullRequest: DogfoodPullRequestRecord | null;
  /** The action-time grant ids the approval minted (revocation fixtures revoke these). */
  readonly grantedGrantIds: readonly string[];
  readonly deployment: DogfoodDeploymentRecord | null;
  /** The recorded preflight (provider probes + repo/project creation facts). */
  preflight(): Promise<void>;
  /**
   * The async composition-boundary staging of the NEXT ready node (the
   * model run + the gated real commit + the repo facts) — the exact step
   * the drive loop runs before each implementation tick. Exposed for the
   * MANUAL-DRIVE fixtures (e.g. the authority fail-closed suite): the
   * journey's own ticks stay untouched.
   */
  stageNextNode(): Promise<void>;
  /** Drive the full journey (the user-present phase + the staged cloud-tick loop) and return the honest run record. */
  run(): Promise<DogfoodRunRecord>;
}

/** The real sleep (the impure process boundary). */
export function dogfoodRealSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * THE RECEIPT-RECORDING GATEWAY (the P19 audit surface) — a thin subclass
 * of the FROZEN P9 gateway that delegates EVERY execute verbatim and
 * records each freshly-minted receipt (SUCCEEDED, FAILED and DENIED
 * alike) into the staging store: the receipts are the run's evidence
 * trail (replays return the recorded original and are not double-
 * counted; envelope rejections mint no receipt).
 */
class RecordingActionGateway extends ActionGateway {
  private readonly receiptSink: DogfoodStaging;

  constructor(deps: GatewayDeps, receiptSink: DogfoodStaging) {
    super(deps);
    this.receiptSink = receiptSink;
  }

  override execute(raw: unknown, planning?: PlanningRef): GatewayOutcome {
    const outcome = super.execute(raw, planning);
    if (outcome.kind === 'executed') {
      this.receiptSink.observeReceipt(outcome.receipt);
    }
    return outcome;
  }
}

/** The harness's real repository reader — the composition-boundary REST reads the evaluator facts need. */
class DogfoodRepoReader {
  constructor(
    private readonly port: GitHubRequestPort,
    private readonly repository: { readonly owner: string; readonly name: string },
  ) {}

  private async get<TResult>(path: string, query: Record<string, string> | null): Promise<GitHubProviderResponse<TResult>> {
    return this.port.request<null, TResult>({ method: 'GET', path, query, body: null, headers: { accept: 'application/vnd.github+json' } });
  }

  /** The full blob-path tree at an exact sha (the REAL tree read). */
  async treeAt(sha: string): Promise<string[]> {
    const response = await this.get<{ tree?: { path?: unknown; type?: unknown }[] }>(`/repos/${this.repository.owner}/${this.repository.name}/git/trees/${sha}`, { recursive: '1' });
    if (response.status !== 200 || response.body === null || !Array.isArray(response.body.tree)) {
      return [];
    }
    return response.body.tree.filter((entry) => entry.type === 'blob' && typeof entry.path === 'string').map((entry) => entry.path as string);
  }

  /** The decoded content of one path at an exact ref (the REAL content read; null when absent). */
  async contentAt(path: string, ref: string): Promise<string | null> {
    const response = await this.get<{ content?: unknown; encoding?: unknown }>(`/repos/${this.repository.owner}/${this.repository.name}/contents/${path}`, { ref });
    if (response.status !== 200 || response.body === null) {
      return null;
    }
    const content = response.body.content;
    if (typeof content !== 'string') {
      return null;
    }
    const encoding = response.body.encoding;
    try {
      if (encoding === 'base64') {
        return Buffer.from(content, 'base64').toString('utf8');
      }
      return content;
    } catch {
      return null;
    }
  }

  /** The exact sha a branch ref points at (the REAL ref read; null when absent). */
  async refHead(branch: string): Promise<string | null> {
    const response = await this.get<{ object?: { sha?: unknown } }>(`/repos/${this.repository.owner}/${this.repository.name}/git/ref/heads/${branch}`, null);
    if (response.status !== 200 || response.body === null) {
      return null;
    }
    const sha = response.body.object?.sha;
    return typeof sha === 'string' ? sha : null;
  }
}

/** Create the real dogfood harness (ONE harness = ONE run; run 2 uses a FRESH instance + fresh stores). */
export function createRealDogfoodHarness(options: RealDogfoodHarnessOptions): RealDogfoodHarness {
  const env = resolveDogfoodEnvironment(options.source);
  const clock = options.clock;
  const gatewayClock: GatewayClock = { now: () => clock.nowEpochMs() };
  const now = () => formatRfc3339(clock.nowEpochMs());
  const sleep = options.sleep ?? dogfoodRealSleep;
  const runtimeFetch = options.runtimeFetch ?? defaultRuntimeFetch;

  const slugParts = options.repositorySlug.split('/');
  /** The recorded GitHub transport round-trips (method + path + status; never bodies, never credentials). */
  const githubRequestCount = (): number => {
    const transport = githubRequestPort as unknown as { recordedRequests?: () => readonly unknown[] };
    return typeof transport.recordedRequests === 'function' ? transport.recordedRequests().length : 0;
  };
  if (slugParts.length !== 2 || slugParts[0] === undefined || slugParts[1] === undefined || slugParts[0].length === 0 || slugParts[1].length === 0) {
    throw new Error(`the dogfood repository slug must be 'owner/name', received: ${JSON.stringify(options.repositorySlug)}`);
  }
  const repository = { owner: slugParts[0], name: slugParts[1] };
  const branch = `sos/mission-${options.journeyId}`;

  // ------------------------------------------------------------- providers
  const githubRequestPort = options.githubRequestPort ?? new FetchGitHubRequestPort({ token: env.github.token });
  const provider = new RealGitHubProvider({ requestPort: githubRequestPort, credentialEnv: env.github.credentialEnv });
  const vercelTranscript = new DeploymentTranscriptRecorder({ credentialReference: env.vercel.credentialEnv });
  const vercelClient = env.vercel.token !== null ? createDogfoodVercelClient({ token: env.vercel.token, teamId: env.vercel.orgId, fetch: options.vercelFetch ?? bindGlobalFetch() }) : null;
  const modelPort = options.modelPort ?? (env.openRouter.apiKey !== null ? new OpenRouterModelClient({ apiKey: env.openRouter.apiKey }) : null);
  const bodyModel = env.bodyModel ?? DOGFOOD_DEFAULT_BODY_MODEL;

  // --------------------------------------------------------------- staging
  const staging = new DogfoodStaging();
  const repoReader = new DogfoodRepoReader(githubRequestPort, repository);

  // ---------------------------------------------------------- the raw store
  // HONEST store selection (§1 GRAPH_BUILT): real Neon/Upstash probes; the
  // reference in-memory live store with the EXPLICIT marker when the
  // canonical store is unreachable (the live-data-plane precedent).
  let store: ReturnType<typeof createInMemoryLiveStore> | null = null;
  let storeSelection: DogfoodStoreSelection | null = null;

  // ---------------------------------------------------------- the harness
  let providerStates: DogfoodProviderState[] = [];
  let pullRequest: DogfoodPullRequestRecord | null = null;
  let deploymentRecord: DogfoodDeploymentRecord | null = null;
  let vercelProject: DogfoodVercelProject | null = null;
  let repoCreatedThisRun = false;
  const modelCalls: DogfoodModelCallRecord[] = [];
  const repairs: DogfoodRepairRecord[] = [];
  const asks: { askId: string; stage: string; reasonCode: string; detail: string }[] = [];
  const realizedCommitShas: string[] = [];
  const stageRecords: DogfoodStageRecord[] = [];
  const honestNotes: string[] = [];

  const harness: RealDogfoodHarness = {
    options,
    env,
    staging,
    githubRequestPort,
    provider,
    vercelClient,
    vercelTranscript,
    modelPort,
    get body(): HostedCodingBody | null {
      return bodyRef;
    },
    bodyId: 'p19-dogfood-openrouter-hosted-coding',
    get store(): ReturnType<typeof createInMemoryLiveStore> {
      if (store === null) {
        throw new Error('the store is composed during preflight() — call preflight() first');
      }
      return store;
    },
    get gateway(): ActionGateway {
      return gatewayRef!;
    },
    get authority(): InMemoryAuthority {
      return authorityRef!;
    },
    get broker(): BodyBroker {
      return brokerRef!;
    },
    get fabric(): ExecutionFabric {
      return fabricRef!;
    },
    get graph(): TaskGraph {
      return graphRef!;
    },
    get realizer(): RepositoryRealizer {
      return realizerRef!;
    },
    get journey(): GreenfieldJourney {
      return journeyRef!;
    },
    get providerStates(): readonly DogfoodProviderState[] {
      return providerStates;
    },
    get storeSelection(): DogfoodStoreSelection {
      if (storeSelection === null) {
        throw new Error('the store selection is composed during preflight() — call preflight() first');
      }
      return storeSelection;
    },
    repository,
    get vercelProject(): DogfoodVercelProject | null {
      return vercelProject;
    },
    get modelCalls(): readonly DogfoodModelCallRecord[] {
      return modelCalls;
    },
    get repairs(): readonly DogfoodRepairRecord[] {
      return repairs;
    },
    get asks(): readonly { askId: string; stage: string; reasonCode: string; detail: string }[] {
      return asks;
    },
    get grantedGrantIds(): readonly string[] {
      return grantedGrantIdsRef ?? [];
    },
    get realizedCommitShas(): readonly string[] {
      return realizedCommitShas;
    },
    get pullRequest(): DogfoodPullRequestRecord | null {
      return pullRequest;
    },
    get deployment(): DogfoodDeploymentRecord | null {
      return deploymentRecord;
    },
    preflight,
    stageNextNode,
    run,
  };

  // The composed world (filled by preflight()).
  let bodyRef: HostedCodingBody | null = null;
  let gatewayRef: ActionGateway | null = null;
  let authorityRef: InMemoryAuthority | null = null;
  let brokerRef: BodyBroker | null = null;
  let fabricRef: ExecutionFabric | null = null;
  let graphRef: TaskGraph | null = null;
  let realizerRef: RepositoryRealizer | null = null;
  let journeyRef: GreenfieldJourney | null = null;
  let grantedGrantIdsRef: string[] | null = null;
  let authorityPreflightRef: ((family: 'commit' | 'push' | 'pull-request' | 'deployment', scope: string) => boolean) | null = null;
  let preflightDone = false;

  async function preflight(): Promise<void> {
    if (preflightDone) {
      return;
    }
    // 1. The honest provider-state snapshot (REAL probes only).
    providerStates = [
      ...await probeDogfoodProviders({
        github: provider,
        githubCredentialEnv: env.github.credentialEnv,
        vercel: vercelClient,
        vercelCredentialEnv: env.vercel.credentialEnv,
        openRouterApiKey: env.openRouter.apiKey,
        openRouterCredentialEnv: env.openRouter.credentialEnv,
        clock,
        ...(options.dnsLookup !== undefined ? { dnsLookup: options.dnsLookup } : {}),
        ...(options.openRouterKeyCheck !== undefined ? { openRouterKeyCheck: options.openRouterKeyCheck } : {}),
      }),
    ];
    const githubState = providerStates.find((state) => state.provider === 'github');
    if (githubState?.state !== 'CONNECTED') {
      throw new DogfoodAbortError(
        'PROVIDER_UNAVAILABLE',
        `the real GitHub provider did not answer the authenticated whoami probe (${githubState?.state ?? 'UNKNOWN'}: ${githubState?.detail ?? 'no probe'}) — the dogfood run cannot proceed honestly`,
        'Check the GitHub credential (env names: PAYSWAP_GITHUB_TOKEN or GITHUB_ACCESS_TOKEN) and the provider reachability, then re-run.',
      );
    }
    if (vercelClient === null || env.vercel.token === null) {
      throw new DogfoodAbortError('MISSING_CREDENTIALS', 'no VERCEL_TOKEN configured in the injected source — the deployment stage cannot run', 'Set VERCEL_TOKEN (and VERCEL_ORG_ID) in the environment and re-run.');
    }
    const vercelState = providerStates.find((state) => state.provider === 'vercel');
    if (vercelState?.state !== 'CONNECTED') {
      throw new DogfoodAbortError('PROVIDER_UNAVAILABLE', `the real Vercel API did not answer the authenticated /v2/user probe (${vercelState?.state ?? 'UNKNOWN'}: ${vercelState?.detail ?? 'no probe'})`, 'Check VERCEL_TOKEN / VERCEL_ORG_ID and the provider reachability, then re-run.');
    }
    if (modelPort === null || env.openRouter.apiKey === null) {
      throw new DogfoodAbortError('MISSING_CREDENTIALS', 'no OPENROUTER_API_KEY configured in the injected source — the cloud body cannot execute work programs', 'Set OPENROUTER_API_KEY in the environment and re-run.');
    }

    // 2. HONEST store selection (§1 GRAPH_BUILT): the real-persistence
    // composition when DATABASE_URL exists + probes; the reference
    // in-memory live store with the EXPLICIT marker otherwise.
    let canonicalProbeOk = false;
    let durable: PostgresStoreAdapter | undefined = undefined;
    if (env.databaseUrl !== null) {
      try {
        const stack = createRealPersistenceStack({ source: options.source, tier: 'production', clock });
        if (stack.postgres !== null) {
          canonicalProbeOk = await stack.postgres.probe();
          durable = canonicalProbeOk ? stack.postgres : undefined;
        }
      } catch (error) {
        honestNotes.push(`the real-persistence composition failed honestly: ${(error as Error).message}`);
      }
    }
    store = createInMemoryLiveStore({ clock, ...(durable !== undefined ? { durable } : {}) });
    const selection = selectDogfoodStore({
      databaseUrl: env.databaseUrl,
      databaseUrlEnv: env.databaseUrlEnv,
      canonicalProbeOk,
      coordinationProbeOk: false,
    });
    storeSelection = selection;
    if (selection.referenceMode) {
      honestNotes.push(
        `the durable store selection degraded to ${selection.storeRef} (reference mode, explicitly NOT production durable state — the live-data-plane precedent); the canonical Neon adapter is ${selection.canonical.state} (${selection.canonical.detail})`,
      );
    }

    // 3. The dogfood repository — CREATED this run via the real API; a
    // pre-existing repository of the same name is a typed abort with
    // cleanup instructions (never silently reused).
    const existingProbe = await repoReader.refHead(branch);
    const repoExistsResponse = await githubRequestPort.request<null, { name?: unknown }>({
      method: 'GET',
      path: `/repos/${repository.owner}/${repository.name}`,
      query: null,
      body: null,
      headers: { accept: 'application/vnd.github+json' },
    });
    if (repoExistsResponse.status === 200) {
      throw new DogfoodAbortError(
        'PRE_EXISTING_REPOSITORY',
        `the repository ${options.repositorySlug} already exists (HTTP 200) — the dogfood creates a FRESH repository each run and never silently reuses one`,
        `Delete the repository first (gh repo delete ${options.repositorySlug} --yes, or the GitHub UI), along with the Vercel project '${options.vercelProjectName}' if it exists, then re-run.`,
      );
    }
    void existingProbe;
    const created = await provider.createRepository({
      name: repository.name,
      private: false,
      description: 'SOS 2.0 P19 real-world dogfood — the flagship journey against real external systems (evidence repository; do not delete)',
    });
    if (created.status !== 'OK') {
      throw new DogfoodAbortError('PROVIDER_UNAVAILABLE', `the real repository creation failed: ${created.reason}`, `Inspect the GitHub provider state and the slug ${options.repositorySlug}, then re-run.`);
    }
    repoCreatedThisRun = true;

    // 4. The Vercel project — pre-checked the same way (never silently reused).
    const existingProject = await vercelClient.getProject(options.vercelProjectName);
    if (existingProject !== null) {
      throw new DogfoodAbortError(
        'PRE_EXISTING_PROJECT',
        `the Vercel project '${options.vercelProjectName}' already exists — the dogfood provisions a FRESH project each run and never silently reuses one`,
        `Delete the Vercel project '${options.vercelProjectName}' first (vercel project rm ${options.vercelProjectName}, or the Vercel dashboard), along with the repository ${options.repositorySlug} if it exists, then re-run.`,
      );
    }

    // 5. Compose the world (the merged surfaces, everything injected).
    const authority = new InMemoryAuthority();
    authorityRef = authority;
    /**
     * The composition-boundary authority PRE-CHECK (advisory; the gateway
     * remains the SOLE authority evaluator at action time): when the current
     * grant snapshot is absent, the harness SKIPS the real provider call —
     * a revoked/expired grant therefore produces the typed gateway denial
     * with NO executor invocation AND no real side effect outside the
     * gateway (fail-closed end-to-end).
     */
    const authorityPreflight = (family: 'commit' | 'push' | 'pull-request' | 'deployment', scope: string): boolean => {
      const snapshot = authority.evaluateCurrent({ actor: actingBody, family, scope }, gatewayClock.now());
      if (!snapshot.granted) {
        honestNotes.push(`the composition-boundary authority pre-check for ${family}:${scope} answered ${snapshot.reason} — the real provider call was SKIPPED (the gateway denies at action time; fail-closed end-to-end)`);
      }
      return snapshot.granted;
    };
    const grantedGrantIds: string[] = [];
    grantedGrantIdsRef = grantedGrantIds;
    const grantingAuthority: GrantingAuthorityPort = {
      grantFor: (actorId: string, family: ActionFamily, scope: string, grantOptions?: { grantId?: string }) => {
        const grantId = authority.grant(actorId, family, scope, grantOptions);
        grantedGrantIds.push(grantId);
        return grantId;
      },
      evaluateCurrent: (query, at) => authority.evaluateCurrent(query, at),
    };

    const sandboxPolicy: SandboxPolicy = {
      filesystem: { mode: 'workspace', root: `/workspace/p19-dogfood-${options.journeyId}` },
      network: { egress: 'allowlist', allowedHosts: ['openrouter.ai'] },
      secrets: ['openrouter-api-key'],
      budgets: { fileWrites: 200, fileBytes: 1_000_000, shellCommands: 100, networkCalls: 60, secretReveals: 10 },
      resourceEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 1024 },
    };
    const body = new HostedCodingBody({
      bodyId: harness.bodyId,
      modelPort,
      model: bodyModel,
      maxOutputTokens: 4000,
      sandboxPolicy,
      placement: 'cloud',
      provider: { name: 'openrouter-hosted-coding', version: '1.0.0' },
      ...(env.openRouter.apiKey !== null ? { secrets: { 'openrouter-api-key': env.openRouter.apiKey } } : {}),
    });
    bodyRef = body;

    const broker = new BodyBroker({ leases: store.bodyLeases, clock });
    brokerRef = broker;
    broker.registerBody({
      body_id: harness.bodyId,
      provider: { name: 'openrouter-hosted-coding', version: '1.0.0' },
      capabilities: body.capabilities(),
      placement: 'cloud',
      harness: body,
    });

    const fabric = new ExecutionFabric({
      tasks: store.tasks,
      authorityGrants: store.authorityGrants,
      observationEvents: store.observationEvents,
      objects: store.objects,
      broker,
      clock,
    });
    fabricRef = fabric;

    const graph = new TaskGraph({ tasks: store.tasks, observationEvents: store.observationEvents, clock });
    graphRef = graph;

    const gateway = new RecordingActionGateway({
      clock: gatewayClock,
      authority,
      executors: [
        createRealGitHubGatewayExecutor({ staging, repository }),
        createRealVercelGatewayExecutor({ staging, projectName: options.vercelProjectName }),
      ],
      idempotency: new InMemoryIdempotencyStore(),
      events: new InMemoryEventLog(),
      evidence: new InMemoryEvidenceSink(),
      rollbackVerifier: null,
    }, staging);
    gatewayRef = gateway;

    const actingBody: ActorRef = { kind: 'body', id: `p13-acting-body:${options.journeyId}` };
    const realizer = new RepositoryRealizer({ gateway, actor: actingBody, clock: gatewayClock, workspaceBaseSha: DOGFOOD_EMPTY_REPOSITORY_BASE });
    realizerRef = realizer;
    // Bind the composition-boundary authority pre-check (defined above; the
    // closure reads actingBody lazily — assigned here so the gate is LIVE).
    authorityPreflightRef = authorityPreflight;

    const registry = new EvaluatorRegistry();
    for (const probe of createDogfoodEvaluatorProbes({ staging, ...(options.nodeRunner !== undefined ? { nodeRunner: options.nodeRunner } : {}) })) {
      registry.register(probe);
    }
    const evaluation = new IndependentEvaluationService(registry, gatewayClock);
    const orchestration = new EvaluationOrchestrator(evaluation, gatewayClock);
    const certifier = new CompletionCertifier({ orchestration, clock: gatewayClock });

    const bodyExecutor = createRealHostedBodyTaskImplementation({ staging, broker });

    const stageRepoFacts = async (revision: string, plannedPaths: readonly string[], componentId: string | null): Promise<void> => {
      const paths = await repoReader.treeAt(revision);
      const contents: Record<string, string> = {};
      for (const path of plannedPaths) {
        const content = await repoReader.contentAt(path, revision);
        if (content !== null) {
          contents[path] = content;
        }
      }
      staging.stageRepoFacts({
        revision,
        branch,
        paths,
        contents,
        plannedPaths: [...plannedPaths],
        componentId,
        commitUrl: `https://github.com/${repository.owner}/${repository.name}/commit/${revision}`,
        stagedAt: now(),
      });
    };

    const repair = createDogfoodNodeRepairExecutor({
      provider,
      staging,
      repository,
      branch,
      realizer,
      stageRepoFacts,
    });
    const nodeRepair: NodeRepairExecutor = {
      repair: (input) => {
        const startedAt = now();
        void startedAt;
        return repair.repair(input).then((result) => {
          if (result.newSourceRevision !== null) {
            repairs.push({
              taskId: input.node.task_id,
              attempt: input.attempt,
              newSourceRevision: result.newSourceRevision,
              detail: result.detail,
            });
            realizedCommitShas.push(result.newSourceRevision);
          }
          return result;
        });
      },
    };

    const formalizer = new ReferenceMissionFormalizer({ createdAt: now(), provenance: ['p19-dogfood-real'] });
    const planner = new ReferenceArchitecturePlanner({ createdAt: now() });
    const authorityApproval = new ReferenceAuthorityApproval({
      authorityGrants: store.authorityGrants,
      gatewayAuthority: grantingAuthority,
      clock,
      provenance: ['p19-dogfood:authority-approval'],
    });

    const journeyProviderStatuses = [
      {
        name: 'github-connection (RealGitHubProvider, P17-B)',
        status: 'CONNECTED',
        detail: `the PAT-backed real handshake (login verified via GET /user) — the journey's repository connection is REAL (credential env ${env.github.credentialEnv ?? 'none'}, name only)`,
      },
      {
        name: 'git-host + pull-requests (the real GitHub gateway executors)',
        status: 'CONNECTED',
        detail: 'commits/push/pull-requests realize through the REAL GitHub REST API (the contents-API initial commit on the empty repository, then the Git Data API single-commit path; PR via POST /repos/<slug>/pulls)',
      },
      {
        name: 'deployment-target (the real Vercel executor)',
        status: 'CONNECTED',
        detail: `deployments realize through the REAL Vercel API (fresh project '${options.vercelProjectName}': gitRepository link + ssoProtection null; production deployment via gitSource {repoId, ref})`,
      },
      {
        name: 'bodies (HostedCodingBody, OpenRouter)',
        status: 'CONNECTED',
        detail: `the cloud body executes work programs through REAL OpenRouter completions (model ${bodyModel}; credential env ${env.openRouter.credentialEnv ?? 'none'}, name only)`,
      },
      {
        name: 'evaluators (the real dogfood probes)',
        status: 'CONNECTED',
        detail: 'repo-contents-at-revision, deployment-state, runtime-HTTP and security-scan probes over REAL reads + REAL node execution of the generated test — the body never certifies itself',
      },
      {
        name: 'durable store (Neon/Upstash probes; the live-data-plane precedent)',
        status: storeSelection.referenceMode ? 'REFERENCE' : 'PRODUCTION_DURABLE',
        detail: storeSelection.note,
      },
    ];

    const journey = new GreenfieldJourney({
      journeyId: options.journeyId,
      store: {
        missions: store.missions,
        authorityGrants: store.authorityGrants,
        tasks: store.tasks,
        observationEvents: store.observationEvents,
      },
      graph,
      broker,
      fabric,
      github: provider,
      formalizer,
      planner,
      authorityApproval,
      bodyExecutor,
      nodeRepair,
      certifier,
      evaluationOrchestration: orchestration,
      realizer,
      clock,
      presence: { userDeviceOnline: () => false },
      providerStatuses: journeyProviderStatuses,
      deploymentEnvironment: 'production',
    } satisfies GreenfieldJourneyDeps);
    journeyRef = journey;

    preflightDone = true;
    stageRepoFactsRef = stageRepoFacts;
  }

  // Stash refs for the harness getters + the drive loop (assigned during preflight).

  let stageRepoFactsRef: ((revision: string, plannedPaths: readonly string[], componentId: string | null) => Promise<void>) | null = null;

  // ------------------------------------------------------------------
  // The staged cloud-tick drive loop
  // ------------------------------------------------------------------

  function advanceClock(): void {
    const advance = options.interTickAdvanceMs;
    if (advance !== undefined) {
      const manual = clock as unknown as { advance?: (ms: number) => void };
      if (typeof manual.advance === 'function') {
        manual.advance(advance);
      }
    }
  }

  /** Stage the next node's REAL model run + REAL commit + repo facts (the async composition boundary). */
  async function stageNextNode(): Promise<void> {
    const journey = journeyRef!;
    const graph = graphRef!;
    const realizer = realizerRef!;
    const state = journey.state();
    if (state.plan === null) {
      return;
    }
    const nodes = await graph.nodes();
    // The journey's tick re-queues FAILED RETRYABLE nodes (retries < 3) first;
    // the effective pending set reflects that.
    const willRetry = (node: (typeof nodes)[number]): boolean => node.state === 'FAILED' && node.recovery.status === 'RETRYABLE' && node.retries < 3;
    const effective = (node: (typeof nodes)[number]): 'PENDING' | 'COMPLETED' | 'OTHER' =>
      willRetry(node) ? 'PENDING' : node.state === 'PENDING' ? 'PENDING' : node.state === 'COMPLETED' ? 'COMPLETED' : 'OTHER';
    const ready = nodes.find((node) => effective(node) === 'PENDING' && node.dependencies.every((dependency) => effective(nodes.find((candidate) => candidate.task_id === dependency)!) === 'COMPLETED'));
    if (ready === undefined) {
      return;
    }
    const attempt = willRetry(ready) ? ready.retries + 2 : ready.retries + 1;
    const program = parseTaskWorkProgram(ready.steps);
    const plannedPaths = program.files.map((file) => file.path);
    const { goal, deliverablePath } = goalForNode(ready.steps);

    // 1. The REAL model run (the §9 createTask + the async engine, with honest engine retries).
    const body = bodyRef!;
    const broker = brokerRef!;
    const created = body.createTask({ task_ref: ready.task_id, input: { goal, ...(deliverablePath.length > 0 ? { deliverable_path: deliverablePath } : {}) } });
    if (created.status !== 'OK') {
      staging.stageBodyRun(ready.task_id, attempt, {
        ok: false,
        files: [],
        model: null,
        responseId: null,
        usage: null,
        summary: null,
        error: `the §9 createTask failed: ${'error' in created ? String(created.error) : created.status}`,
        engineAttempt: 0,
      });
      return;
    }
    const maxEngineAttempts = options.maxEngineAttempts ?? 3;
    let lastRun: Awaited<ReturnType<HostedCodingBody['runWorkProgram']>> | null = null;
    for (let engineAttempt = 1; engineAttempt <= maxEngineAttempts; engineAttempt += 1) {
      const run = await body.runWorkProgram(ready.task_id);
      lastRun = run;
      modelCalls.push({
        taskId: ready.task_id,
        attempt,
        engineAttempt,
        ok: run.ok,
        model: run.model,
        responseId: run.response_id,
        usage: run.usage === null ? null : { ...run.usage },
        filesApplied: run.files_applied.map((file) => file.path),
        error: run.error,
      });
      if (run.ok) {
        break;
      }
      // Honest engine retry with the same goal (the failed run is recorded).
    }
    if (lastRun === null || !lastRun.ok) {
      staging.stageBodyRun(ready.task_id, attempt, {
        ok: false,
        files: [],
        model: lastRun?.model ?? null,
        responseId: lastRun?.response_id ?? null,
        usage: lastRun?.usage === null ? null : lastRun?.usage ? { ...lastRun.usage } : null,
        summary: null,
        error: lastRun?.error ?? 'the real model-driven engine did not produce a run',
        engineAttempt: maxEngineAttempts,
      });
      return;
    }

    // 2. Read the applied files back through the §9 workspace surface.
    const readBack = readStagedRunFiles(broker, { files: lastRun.files_applied }, harness.bodyId, ready.task_id);
    if (!readBack.ok) {
      staging.stageBodyRun(ready.task_id, attempt, {
        ok: false,
        files: [],
        model: lastRun.model,
        responseId: lastRun.response_id,
        usage: lastRun.usage === null ? null : { ...lastRun.usage },
        summary: lastRun.summary,
        error: readBack.reason,
        engineAttempt: maxEngineAttempts,
      });
      return;
    }
    const stagedRun: StagedBodyRun = {
      ok: true,
      files: readBack.files,
      model: lastRun.model,
      responseId: lastRun.response_id,
      usage: lastRun.usage === null ? null : { ...lastRun.usage },
      summary: lastRun.summary,
      error: null,
      engineAttempt: maxEngineAttempts,
    };
    staging.stageBodyRun(ready.task_id, attempt, stagedRun);

    // 3. The REAL commit on the implementation branch (staged for the sync
    //    gateway) — gated by the advisory authority pre-check (fail-closed
    //    end-to-end: no real provider call when the grant is absent).
    if (authorityPreflightRef !== null && !authorityPreflightRef('commit', 'workspace')) {
      return;
    }
    const message = `Implement: ${ready.title} (attempt ${attempt})`;
    const baseSha = realizer.currentHead();
    const committed = await provider.commitFiles({ repository, branch, message, files: stagedRun.files.map((file) => ({ path: file.path, contents: file.contents })) });
    if (committed.status !== 'OK') {
      // The commit will fail through the gateway honestly; stage nothing
      // (the typed not-prepared failure surfaces — never a fabricated success).
      honestNotes.push(`the real commit for ${ready.task_id} (attempt ${attempt}) failed at the provider: ${committed.reason}`);
      return;
    }
    staging.stageCommit({ message, baseSha, changes: stagedRun.files }, {
      newSha: committed.result.sha,
      committedAt: committed.result.committed_at,
      providerNote: 'the real GitHub commit (contents-API initial commit on the empty repository, or the Git Data API single-commit path)',
    });
    realizedCommitShas.push(committed.result.sha);

    // 4. The repo facts at the EXACT new revision (the evaluator-probe evidence).
    await stageRepoFactsRef!(committed.result.sha, plannedPaths, program.componentId);
  }

  /** Stage the push ref-read + the default-branch provisioning + the REAL pull request. */
  async function stageChangeRealization(): Promise<void> {
    const journey = journeyRef!;
    const realizer = realizerRef!;
    const state = journey.state();
    if (state.plan === null) {
      return;
    }
    const head = realizer.currentHead();
    const remote = `github.com/${repository.owner}/${repository.name}`;

    // 1. The REAL push verification: the remote branch ref observed at the
    //    exact sha — gated by the advisory authority pre-check (fail-closed
    //    end-to-end).
    if (authorityPreflightRef !== null && (!authorityPreflightRef('push', branch) || !authorityPreflightRef('pull-request', branch))) {
      return;
    }
    const observedSha = await repoReader.refHead(branch);
    staging.stagePush({ remote, ref: branch, fromSha: head }, {
      observedSha: observedSha ?? '',
      bindingVerified: observedSha === head,
      refReadAt: now(),
    });

    // 2. The default branch 'main' — an empty GitHub repository carries NO
    // branch at all; the realization plan's PR contract (base 'main') needs
    // the default branch provisioned at the FIRST realized commit (the
    // workspace-provisioning revision). Provider-side repo mechanics, the
    // harness composition boundary — the PR then carries the task commits.
    const branches = await provider.listBranches(repository);
    const branchList = branches.status === 'OK' ? branches.result : [];
    if (branchList.length === 0 || !branchList.some((candidate) => candidate.name === 'main')) {
      const firstCommit = realizedCommitShas[0] ?? head;
      const mainCreation = await provider.createBranch({ repository, name: 'main', from_sha: firstCommit });
      if (mainCreation.status !== 'OK') {
        throw new DogfoodAbortError('PROVIDER_UNAVAILABLE', `the default-branch provisioning failed: ${mainCreation.reason}`, 'Inspect the repository state and re-run after cleanup.');
      }
      honestNotes.push(`the default branch 'main' was provisioned at the first realized commit ${firstCommit.slice(0, 12)} (an empty GitHub repository carries no branch; the realization plan's PR contract needs the base branch)`);
    }

    // 3. The REAL pull request (POST /repos/<slug>/pulls) — staged for the
    //    sync gateway. The title/description are derived exactly the way the
    //    journey's realization plan builds them (tickBuildGraph's format).
    const mission = state.mission;
    const pullRequestTitle = `SOS mission implementation: ${mission?.content.purpose ?? options.missionStatement}`;
    const pullRequestDescription = `Realized by the SOS 2.0 mission-to-implementation pipeline (journey ${options.journeyId}, mission ${mission?.envelope.id ?? 'unknown'}). Every consequential action flowed through the authority-gated action gateway; completion was granted only by the independent evaluation suite.`;
    const pr = await provider.createPullRequest({
      repository,
      title: pullRequestTitle,
      head_branch: branch,
      base_branch: 'main',
      body: pullRequestDescription,
    });
    if (pr.status !== 'OK') {
      throw new DogfoodAbortError('PROVIDER_UNAVAILABLE', `the real pull-request creation failed: ${pr.reason}`, 'Inspect the repository branches and re-run after cleanup.');
    }
    staging.stagePullRequest({ title: pullRequestTitle, headBranch: branch, baseBranch: 'main', description: pullRequestDescription }, {
      number: pr.result.number,
      url: pr.result.url,
      headSha: pr.result.head_sha,
      state: pr.result.state,
      createdAt: now(),
    });
    pullRequest = {
      number: pr.result.number,
      url: pr.result.url,
      headBranch: branch,
      baseBranch: 'main',
      headSha: pr.result.head_sha,
      actionId: '',
    };
  }

  /** Stage the REAL Vercel project + production deployment of the exact PR head revision. */
  async function stageDeployment(): Promise<void> {
    const realizer = realizerRef!;
    const client = vercelClient!;
    const head = realizer.currentHead();

    // 1. The fresh project (gitRepository link + ssoProtection null) — never silently reuse.
    const existing = await client.getProject(options.vercelProjectName);
    if (existing !== null) {
      throw new DogfoodAbortError(
        'PRE_EXISTING_PROJECT',
        `the Vercel project '${options.vercelProjectName}' appeared during the run — the dogfood never silently reuses a project`,
        `Delete the Vercel project '${options.vercelProjectName}' (vercel project rm ${options.vercelProjectName}) and the repository ${options.repositorySlug}, then re-run.`,
      );
    }
    const created = await client.createProject({ name: options.vercelProjectName, org: repository.owner, repo: repository.name });
    const patched = await client.patchProjectSsoProtectionNull(options.vercelProjectName);
    vercelProject = patched;

    // 2. The repoId (the project link carries it).
    const repoId = patched.gitRepository?.repoId ?? created.gitRepository?.repoId ?? null;
    if (repoId === null) {
      throw new DogfoodAbortError('PROVIDER_UNAVAILABLE', `the Vercel project link carries no repoId for ${options.repositorySlug} — the gitSource deployment protocol cannot proceed`, 'Inspect the project link (dashboard or API) and re-run after cleanup.');
    }

    // 3. The production deployment of the EXACT PR head revision — gated
    //    by the advisory authority pre-check (fail-closed end-to-end).
    if (authorityPreflightRef !== null && !authorityPreflightRef('deployment', 'production')) {
      return;
    }
    const startedAt = clock.nowEpochMs();
    const deployment = await client.createProductionDeployment({ projectName: options.vercelProjectName, repoId, ref: head });
    let current: DogfoodVercelDeployment = deployment;
    const maxPollAttempts = options.maxDeployPollAttempts ?? 60;
    const intervalMs = options.deployPollIntervalMs ?? 5_000;
    let pollAttempts = 0;
    while (current.readyState !== 'READY' && current.readyState !== 'ERROR' && current.readyState !== 'CANCELED' && pollAttempts < maxPollAttempts) {
      pollAttempts += 1;
      await sleep(intervalMs);
      current = await client.getDeployment(deployment.id);
    }
    const waitedMs = clock.nowEpochMs() - startedAt;
    const readyState = current.readyState;
    if (readyState !== 'READY') {
      honestNotes.push(`the REAL Vercel deployment ${current.id} answered readyState ${readyState} after ${String(pollAttempts)} poll(s) — the honest state is recorded, never fabricated (a DEGRADED/rate-tripped deployment fails the run truthfully)`);
    }

    // 4. Stage the deployment outcome + the deployment facts (the probe evidence).
    staging.stageDeployment({ environment: 'production', sourceSha: head }, {
      deploymentId: current.id,
      url: current.url,
      readyState,
      commitSha: current.commitSha,
      projectId: patched.id,
      projectName: options.vercelProjectName,
      target: 'production',
    });
    staging.stageDeploymentFacts({
      deploymentId: current.id,
      url: current.url,
      readyState,
      commitSha: current.commitSha,
      projectId: patched.id,
      projectName: options.vercelProjectName,
      target: current.target,
      pollAttempts,
      waitedMs,
    });
    deploymentRecord = {
      deploymentId: current.id,
      url: current.url !== null ? normalizeUrl(current.url) : '',
      readyState,
      commitSha: current.commitSha,
      projectId: patched.id,
      projectName: options.vercelProjectName,
      target: 'production',
      actionId: '',
      pollAttempts,
      waitedMs,
    };

    // 5. The runtime facts (the REAL HTTP GETs of the deployed URL).
    await stageRuntimeFactsAt(head, current);
  }

  /** Stage the fresh runtime-verification facts (real HTTP GETs + the README at the exact revision). */
  async function stageRuntimeFactsAt(deployedRevision: string, deployment: { id: string; url: string | null }): Promise<void> {
    const client = vercelClient!;
    const facts = staging.deploymentFactsSnapshot();
    const current = await client.getDeployment(deployment.id);
    const url = normalizeUrl(current.url ?? deployment.url ?? '');
    const root = await runtimeFetch(url);
    const readme = await runtimeFetch(`${url}/README.md`);
    const readmeAtRevision = await repoReader.contentAt('README.md', deployedRevision);
    staging.stageRuntimeFacts({
      rootStatus: root.status,
      rootBodyExcerpt: root.body === null ? null : root.body.slice(0, 200),
      readmeStatus: readme.status,
      readmeBody: readme.body,
      readmeAtRevision,
      deploymentUrl: url,
      deployedRevision,
      fetchedAt: now(),
    });
    if (facts === null) {
      staging.stageDeploymentFacts({
        deploymentId: current.id,
        url: current.url,
        readyState: current.readyState,
        commitSha: current.commitSha,
        projectId: vercelProject?.id ?? '',
        projectName: options.vercelProjectName,
        target: current.target,
        pollAttempts: 0,
        waitedMs: 0,
      });
    }
  }

  /** Stage the completion-level facts (the full final-revision evidence set). */
  async function stageCompletionFacts(): Promise<void> {
    const journey = journeyRef!;
    const realizer = realizerRef!;
    const state = journey.state();
    if (state.plan === null) {
      return;
    }
    const head = realizer.currentHead();
    const allPlannedPaths = state.plan.components.flatMap((component) => component.files.map((file) => file.path));
    await stageRepoFactsRef!(head, allPlannedPaths, null);
    const deployment = staging.deploymentFactsSnapshot();
    if (deployment !== null) {
      await stageRuntimeFactsAt(head, { id: deployment.deploymentId, url: deployment.url });
    }
  }

  function normalizeUrl(url: string): string {
    return url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
  }

  /** Record the per-stage journey records from the transitions (each with its EXACT revision). */
  function captureStageRecords(priorTransitionCount: number): void {
    const journey = journeyRef!;
    const state = journey.state();
    const receipts: DogfoodActionReceiptSummary[] = staging.observedReceiptList().map((receipt) => summarizeReceipt(receipt));
    for (let index = priorTransitionCount; index < state.transitions.length; index += 1) {
      const transition = state.transitions[index]!;
      let revision: string | null = null;
      let detail = '';
      switch (transition.to) {
        case 'MISSION_RECEIVED':
          revision = null;
          detail = `the raw mission captured at ${state.rawMissionStatement ?? ''} (source web-console:greenfield)`;
          break;
        case 'REPOSITORY_CONNECTED': {
          const imported = state.importedRevision;
          revision = imported === null || imported.revision.value === '' ? null : imported.revision.value;
          detail =
            imported !== null && imported.revision.value === ''
              ? `the honest empty-repository state (no revisions exist — the greenfield journey realizes into the empty repository ${repository.owner}/${repository.name})`
              : `the imported revision of ${repository.owner}/${repository.name}`;
          break;
        }
        case 'AUTHORITY_APPROVED':
          revision = null;
          detail = `the typed grant ${state.authorityGrantId ?? ''} (pre-approved by the harness operator; the gateway re-evaluates authority at action time, fail-closed)`;
          break;
        case 'MISSION_FORMALIZED':
          revision = state.mission?.envelope.id ?? null;
          detail = `the formalized mission ${state.mission?.envelope.id ?? ''}`;
          break;
        case 'PLAN_PREPARED':
          revision = state.plan?.planId ?? null;
          detail = `the implementation plan ${state.plan?.planId ?? ''} (${String(state.plan?.components.length ?? 0)} components, maxRepairAttempts ${String(state.plan?.maxRepairAttempts ?? 0)})`;
          break;
        case 'GRAPH_BUILT':
          revision = state.plan?.planId ?? null;
          detail = `the durable task graph + the repository realization plan (implementation branch ${branch})`;
          break;
        case 'WORKSPACE_PROVISIONED':
          revision = realizedCommitShas[0] ?? null;
          detail = `the scaffold commit (the repository's first real commit on ${branch})`;
          break;
        case 'IMPLEMENTING':
          revision = realizedCommitShas[realizedCommitShas.length - 1] ?? null;
          detail = 'the first non-scaffold dispatch (the implementation stage begins)';
          break;
        case 'IMPLEMENTED':
          revision = realizerRef?.currentHead() ?? null;
          detail = `all nodes completed (the workspace head is the last realized commit)`;
          break;
        case 'CHANGE_REALIZED':
          revision = pullRequest?.headSha ?? null;
          detail = pullRequest === null ? 'the branch push + pull request' : `the pull request #${String(pullRequest.number)} (${pullRequest.url}) on branch ${branch} at head ${pullRequest.headSha.slice(0, 12)}`;
          break;
        case 'DEPLOYED':
          revision = deploymentRecord?.commitSha ?? null;
          detail = deploymentRecord === null ? 'the deployment' : `the production deployment ${deploymentRecord.deploymentId} (${deploymentRecord.url}) of the exact revision ${deploymentRecord.commitSha?.slice(0, 12) ?? 'unknown'} — readyState ${deploymentRecord.readyState}`;
          break;
        case 'RUNTIME_VERIFIED':
          revision = staging.runtimeFactsSnapshot()?.deployedRevision ?? null;
          detail = 'the independent runtime verification (HTTP GET the deployed URL + the real readyState)';
          break;
        case 'COMPLETED':
          revision = realizerRef?.currentHead() ?? null;
          detail = 'the evidence-backed completion report granted ONLY by the independent evaluation suite';
          break;
        default:
          break;
      }
      stageRecords.push({
        stage: transition.to,
        at: transition.at,
        revision,
        detail,
        receipts: [...receipts],
        transcriptRefs: [
          { provider: 'github', requests: githubRequestCount() },
          ...(vercelClient !== null ? [{ provider: 'vercel', requests: vercelClient.recordedRequests().length }] : []),
        ],
      });
    }
  }

  /** The user-present phase: kickoff (real clock) -> the REAL whoami handshake -> connect -> pre-approved authority. */
  async function userPresentPhase(): Promise<void> {
    const journey = journeyRef!;
    const raw: RawUserMission = {
      statement: options.missionStatement,
      repositorySlug: options.repositorySlug,
      capturedAt: now(),
      source: 'web-console:greenfield',
    };
    await journey.kickoff(raw);
    captureStageRecords(0);

    // The REAL PAT-backed whoami handshake (completeConnection requires the
    // verified probe — CONNECTED is never fabricated).
    const verification = await provider.verifyToken(now());
    if (!verification.verified) {
      throw new DogfoodAbortError('CONNECTION_REFUSED', `the real GitHub handshake did not verify: ${verification.failure ?? 'unknown failure'}`, 'Check the GitHub credential and re-run.');
    }
    const beforeConnect = journey.state().transitions.length;
    const connect = await journey.connectRepository(options.repositorySlug);
    if (connect.kind !== 'CONNECTED') {
      throw new DogfoodAbortError('CONNECTION_REFUSED', `the repository connection refused (${connect.kind}): ${connect.detail}`, 'Inspect the repository (it must be empty) and re-run after cleanup.');
    }
    if (!connect.simulated) {
      honestNotes.push('the repository connection is REAL (the PAT-backed handshake verified; empty-repository detection ran over the real branches API)');
    }
    captureStageRecords(beforeConnect); // captures the REPOSITORY_CONNECTED transition (the honest empty-repository state)
    const prior = journey.state().transitions.length;
    await journey.approveAuthority({ approvedBy: options.approvedBy ?? 'p19-dogfood:operator' });
    captureStageRecords(prior);
  }

  /** The staged cloud-tick loop (the §7 pin: the presence recorder stays offline, never consulted). */
  async function driveLoop(): Promise<void> {
    const journey = journeyRef!;
    let stallCount = 0;
    let lastStage: string | null = journey.state().stage;
    let lastCompleted = 0;
    for (let tick = 0; tick < 96; tick += 1) {
      const state = journey.state();
      if (state.stage === 'COMPLETED' || state.status !== 'RUNNING') {
        break;
      }
      const priorTransitions = state.transitions.length;
      const priorAskCount = asks.length;
      switch (state.stage) {
        case 'MISSION_RECEIVED':
        case 'REPOSITORY_CONNECTED':
          throw new DogfoodAbortError('CONNECTION_REFUSED', `the drive loop expects the user-present phase complete, but the journey is at ${state.stage}`, 'This is a harness sequencing defect — report it.');
        case 'AUTHORITY_APPROVED':
        case 'MISSION_FORMALIZED':
        case 'PLAN_PREPARED':
          break; // the deterministic pipeline ticks need no staging
        case 'GRAPH_BUILT':
        case 'WORKSPACE_PROVISIONED':
        case 'IMPLEMENTING':
          await stageNextNode();
          break;
        case 'IMPLEMENTED':
          await stageChangeRealization();
          break;
        case 'CHANGE_REALIZED':
          await stageDeployment();
          break;
        case 'DEPLOYED': {
          const deployment = staging.deploymentFactsSnapshot();
          if (deployment !== null) {
            await stageRuntimeFactsAt(realizerRef!.currentHead(), { id: deployment.deploymentId, url: deployment.url });
          }
          break;
        }
        case 'RUNTIME_VERIFIED':
          await stageCompletionFacts();
          break;
        default:
          break;
      }
      advanceClock();
      const record = await journey.onCloudTick();
      if (record.action.kind === 'ASK_PARKED' && record.action.ask !== undefined) {
        const ask = record.action.ask;
        asks.push({ askId: ask.askId, stage: ask.stage, reasonCode: ask.reasonCode, detail: ask.detail });
      }
      const after = journey.state();
      captureStageRecords(priorTransitions);
      const nodes = await graphRef!.nodes();
      const completed = nodes.filter((node) => node.state === 'COMPLETED').length;
      const advanced = after.stage !== lastStage || completed !== lastCompleted || asks.length !== priorAskCount;
      if (advanced) {
        stallCount = 0;
      } else {
        stallCount += 1;
        if (stallCount >= 3) {
          honestNotes.push(`the drive loop stalled for 3 consecutive ticks at stage ${after.stage ?? 'NONE'} (the last tick action: ${record.action.kind}) — the honest state is recorded, never fabricated`);
          break;
        }
      }
      lastStage = after.stage;
      lastCompleted = completed;
      if (record.action.kind === 'IDLE') {
        break;
      }
    }
  }

  /** The post-journey package learning (data-only learned records carrying the REAL evidence refs). */
  function recordLearning(): DogfoodLearningRecord {
    const journey = journeyRef!;
    const store = harness.store;
    const state = journey.state();
    const completion = journey.completionReport();
    const realEvidenceRefs = {
      pullRequestUrl: pullRequest?.url ?? null,
      pullRequestHeadSha: pullRequest?.headSha ?? null,
      deploymentUrl: deploymentRecord?.url ?? null,
      deploymentCommitSha: deploymentRecord?.commitSha ?? null,
      evaluatorVerdictRefs: completion?.evaluation.verdictRefs.map((verdict) => verdict.verdictId) ?? [],
    };
    const producer = {
      tool: '@sos-2/dogfood-live',
      tool_version: '1.0.0',
      model: null,
      model_version: null,
      command: 'RUN_REAL=1 pnpm --filter @sos-2/tests-real-dogfood run test:real',
      environment: 'real:github+vercel+openrouter',
    };
    const window = {
      start: stageRecords[0]?.at ?? now(),
      end: completion?.completedAt ?? now(),
    };

    // 1. The realized-solution package (data-only; FORMING — no promotion claimed).
    //    The ids are deterministically minted through the spine (valid sos://Kind/<32hex> ids;
    //    stable per journey — the sanctioned mint-first flow for evidence subject refs).
    const solutionId = deriveDeterministicArtifactId('Package', { workOrder: 'P19', journeyId: options.journeyId, role: 'realized-solution' });
    const practiceId = deriveDeterministicArtifactId('Package', { workOrder: 'P19', journeyId: options.journeyId, role: 'composition-practice' });
    const compositionId = deriveDeterministicArtifactId('PackageComposition', { workOrder: 'P19', journeyId: options.journeyId, role: 'dogfood-composition' });
    const solutionEvidence = createEvidence({
      kind: 'dogfood-journey-outcome',
      subject_ref: solutionId,
      availability: 'SUCCESS',
      evidence_class: 'OBSERVATIONAL',
      method: 'p19-dogfood: the flagship journey completed against real external systems (real GitHub repo/commits/PR, real Vercel production deployment, real runtime HTTP verification, independent evaluation verdicts)',
      provenance: [
        `p19-dogfood:${options.journeyId}`,
        `pull-request:${pullRequest?.url ?? 'none'}`,
        `pull-request-head-sha:${pullRequest?.headSha ?? 'none'}`,
        `deployment:${deploymentRecord?.url ?? 'none'}`,
        `deployment-commit-sha:${deploymentRecord?.commitSha ?? 'none'}`,
        `completion:${completion?.completionId ?? 'none'}`,
      ],
      window,
      subject_revision: pullRequest?.headSha ?? null,
      deployment_revision: deploymentRecord?.deploymentId ?? null,
      producer,
    });
    const practiceEvidence = createEvidence({
      kind: 'dogfood-journey-practice',
      subject_ref: practiceId,
      availability: 'SUCCESS',
      evidence_class: 'OBSERVATIONAL',
      method: 'p19-dogfood: the journey composition practice (real adapters behind the frozen ports; staged-outcome sync seams; independent evaluation) proved viable end-to-end',
      provenance: [
        `p19-dogfood:${options.journeyId}`,
        `model:${modelCalls.find((call) => call.model !== null)?.model ?? 'none'}`,
        `model-calls:${String(modelCalls.length)}`,
        `repairs:${String(repairs.length)}`,
        `asks:${String(asks.length)}`,
      ],
      window,
      subject_revision: pullRequest?.headSha ?? null,
      deployment_revision: null,
      producer,
    });

    const solutionPackage: PackageArtifact = createPackageArtifact({
      id: solutionId,
      content: {
        semantic_capability: 'markdown notes service with a public API (the §11 flagship mission, realized end-to-end)',
        contracts: ['contract:markdown-notes-public-api'],
        preconditions: ['an empty GitHub repository connected by the user', 'pre-approved authority for the realization families'],
        postconditions: ['the repository carries the realized implementation on a pull request', 'the production deployment serves the realized content', 'independent evaluation verdicts pass at the exact revisions'],
        realizations: [
          { ref: solutionEvidence.id, revision: pullRequest?.headSha ?? null, note: `the real pull request ${pullRequest?.url ?? ''} (head sha ${pullRequest?.headSha ?? 'none'})` },
          { ref: solutionEvidence.id, revision: deploymentRecord?.commitSha ?? null, note: `the real production deployment ${deploymentRecord?.url ?? ''} (dpl ${deploymentRecord?.deploymentId ?? 'none'})` },
        ],
        applicability: [
          {
            kind: 'QUALITATIVE',
            uncertainty_class: 'WEAK',
            context: { mission: 'markdown-notes-public-api', runtime: 'github+vercel+openrouter', journey: 'greenfield-flagship' },
            sample_size: 1,
            window,
          },
        ],
        evidence_refs: [solutionEvidence.id, practiceEvidence.id],
        failure_refs: [],
        compatibility_refs: [],
        composition_refs: [],
        assurance_obligations: [{ kind: 'RUNTIME_VERIFICATION', obligation: 'the deployed runtime serves the realized content at the exact revision' }],
        context: { mission: options.missionStatement, runtime: 'github+vercel+openrouter', workOrder: 'P19' },
        learned_limitations: [
          'one observed run per repository (the applicability estimate is honestly WEAK; no calibrated probability is claimed)',
          ...(storeSelection?.referenceMode ? ['the journey store ran in reference mode (not production durable state)'] : []),
        ],
        diversity_profile: {
          family: 'greenfield-journey-realization',
          dimensions: [
            { dimension: 'COST', stance: 'free-tier external providers (GitHub/Vercel/OpenRouter)' },
            { dimension: 'OPERATIONAL_COMPLEXITY', stance: 'fully autonomous after kick-off (the §7 device-optional pin)' },
          ],
        },
        maturity: 'FORMING',
        changes: `the P19 dogfood run ${options.journeyId} recorded the validated solution with real evidence refs`,
        superseded_by: null,
      },
      provenance: [`p19-dogfood:${options.journeyId}`, `mission:${state.mission?.envelope.id ?? 'none'}`],
      created_at: now(),
      version: 1,
    });

    const practicePackage: PackageArtifact = createPackageArtifact({
      id: practiceId,
      content: {
        semantic_capability: 'the real-world dogfood journey composition practice (real adapters behind the frozen ports)',
        contracts: ['contract:greenfield-journey-composition'],
        preconditions: ['the merged P13 journey engine', 'real provider credentials (env-only)'],
        postconditions: ['the flagship journey completes against real external systems with exact revisions recorded'],
        realizations: [{ ref: practiceEvidence.id, revision: pullRequest?.headSha ?? null, note: 'the composed real run' }],
        applicability: [
          {
            kind: 'QUALITATIVE',
            uncertainty_class: 'WEAK',
            context: { practice: 'real-system-dogfood', runtime: 'github+vercel+openrouter' },
            sample_size: 1,
            window,
          },
        ],
        evidence_refs: [practiceEvidence.id],
        failure_refs: [],
        compatibility_refs: [],
        composition_refs: [],
        assurance_obligations: [{ kind: 'RUNTIME_VERIFICATION', obligation: 'the composition practice is validated by the real run it drove' }],
        context: { practice: 'real-system-dogfood', workOrder: 'P19' },
        learned_limitations: ['the staged-outcome composition boundary is required by the frozen sync seams (documented; not a semantic change)'],
        diversity_profile: {
          family: 'journey-composition-practice',
          dimensions: [{ dimension: 'HUMAN_COMPREHENSIBILITY', stance: 'every staged outcome is inspectable evidence' }],
        },
        maturity: 'FORMING',
        changes: `the P19 dogfood run ${options.journeyId} recorded the composition practice`,
        superseded_by: null,
      },
      provenance: [`p19-dogfood:${options.journeyId}`],
      created_at: now(),
      version: 1,
    });

    const composition: PackageCompositionArtifact = createPackageComposition({
      id: compositionId,
      content: {
        semantic_capability: 'the real-world dogfood: the flagship journey realized through real external systems',
        contracts: ['contract:markdown-notes-public-api', 'contract:greenfield-journey-composition'],
        members: [
          { package_id: solutionId, role: 'realized-solution', bound_contracts: ['contract:markdown-notes-public-api'] },
          { package_id: practiceId, role: 'composition-practice', bound_contracts: ['contract:greenfield-journey-composition'] },
        ],
        bindings: [
          { kind: 'DATA_FLOW', source_role: 'composition-practice', target_role: 'realized-solution', contract: 'contract:markdown-notes-public-api', wiring: { journeyId: options.journeyId } },
        ],
        independence: [
          {
            value: 1,
            method: 'INDEPENDENCE_JUSTIFIED_PRODUCT',
            justification: { basis: 'ARCHITECTURAL_PARTITION', justification: 'the composition practice (mechanism) and the realized solution (output) are architecturally partitioned; the independent evaluator gates the output', evidence_ref: solutionEvidence.id },
            members: [
              { package_id: solutionId, probability: 1 },
              { package_id: practiceId, probability: 1 },
            ],
          },
        ],
        preconditions: ['the P19 runtime credentials (env-only)'],
        postconditions: ['the dogfood evidence package carries the real refs'],
        applicability: [
          {
            kind: 'QUALITATIVE',
            uncertainty_class: 'WEAK',
            context: { composition: 'p19-dogfood', runtime: 'github+vercel+openrouter' },
            sample_size: 1,
            window,
          },
        ],
        evidence_refs: [],
        failure_refs: [],
        compatibility_refs: [],
        assurance_obligations: [{ kind: 'RUNTIME_VERIFICATION', obligation: 'the composition is validated by the real run it composed' }],
        context: { composition: 'p19-dogfood', workOrder: 'P19' },
        learned_limitations: ['data-only learned record (no registry promotion claimed)'],
        diversity_profile: {
          family: 'dogfood-composition',
          dimensions: [{ dimension: 'TOPOLOGY', stance: 'one journey, one repository, one deployment target' }],
        },
        maturity: 'DISCOVERED',
        changes: `the P19 dogfood run ${options.journeyId} recorded the composition`,
        superseded_by: null,
      },
      provenance: [`p19-dogfood:${options.journeyId}`],
      created_at: now(),
      status: 'DRAFT',
      version: 1,
    });

    const ecology = new EcologyGraph();
    const edge = createEdgeAssertion({
      source: practiceId,
      target: solutionId,
      kind: 'COMPATIBLE_WITH',
      evidence_refs: [practiceEvidence.id, solutionEvidence.id],
      provenance: [`p19-dogfood:${options.journeyId}`],
      note: 'the composition practice and the realized solution co-exist (the practice drove the solution into existence; the evidence carries the real PR/deployment refs)',
    });
    ecology.addAssertion(edge);

    return {
      packageIds: [solutionId, practiceId],
      compositionId,
      evidenceIds: [solutionEvidence.id, practiceEvidence.id],
      ecologyAssertion: { source: edge.source, target: edge.target, kind: edge.kind },
      realEvidenceRefs,
      note: 'data-only learned records (FORMING/DISCOVERED maturities; no promotion claimed) carrying the REAL evidence refs (PR sha, deployment URL, evaluator verdict records)',
    };
  }

  async function run(): Promise<DogfoodRunRecord> {
    if (!preflightDone) {
      await preflight();
    }
    const journey = journeyRef!;
    const store = harness.store;
    await userPresentPhase();
    await driveLoop();

    const state = journey.state();
    const completion = journey.completionReport();
    const runtimeFacts = staging.runtimeFactsSnapshot();
    const learning = completion !== null ? recordLearning() : null;

    const runtimeVerification: DogfoodRuntimeVerificationRecord | null = runtimeFacts === null
      ? null
      : {
          rootStatus: runtimeFacts.rootStatus,
          rootBodyExcerpt: runtimeFacts.rootBodyExcerpt,
          readmeStatus: runtimeFacts.readmeStatus,
          readmeByteExact: runtimeFacts.readmeBody !== null && runtimeFacts.readmeAtRevision !== null && runtimeFacts.readmeBody === runtimeFacts.readmeAtRevision,
          deployedRevision: runtimeFacts.deployedRevision,
          fetchedAt: runtimeFacts.fetchedAt,
        };

    // Record asks that were parked during the run (the honest ASK path) —
    // deduplicated by ask id (the tick loop already recorded the parked ones).
    if (state.pendingAsk !== null && !asks.some((ask) => ask.askId === state.pendingAsk!.askId)) {
      asks.push({ askId: state.pendingAsk.askId, stage: state.pendingAsk.stage, reasonCode: state.pendingAsk.reasonCode, detail: state.pendingAsk.detail });
    }

    return {
      runId: `p19-dogfood:${options.journeyId}`,
      journeyId: options.journeyId,
      mission: { statement: options.missionStatement, repositorySlug: options.repositorySlug, source: 'web-console:greenfield' },
      repository: { owner: repository.owner, name: repository.name, createdThisRun: repoCreatedThisRun, htmlUrl: `https://github.com/${repository.owner}/${repository.name}` },
      implementationBranch: branch,
      providerStates: [...providerStates],
      storeSelection: storeSelection!,
      modelCalls: [...modelCalls],
      repairs: [...repairs],
      realizedCommitShas: [...realizedCommitShas],
      asks,
      stages: [...stageRecords],
      ticks: journey.ticks().map((tick) => ({ ...tick })),
      pullRequest,
      deployment: deploymentRecord,
      runtimeVerification,
      learning,
      completion,
      finalState: state,
      pendingAsk: state.pendingAsk,
      honestNotes: [
        ...honestNotes,
        ...(state.stage === 'COMPLETED'
          ? [`the journey COMPLETED against real external systems with exact revisions recorded at every stage (${String(journey.ticks().length)} cloud ticks, every one with userDeviceOnline=false — the §7 pin)`]
          : [`the journey stopped honestly at stage ${state.stage ?? 'NONE'} (status ${state.status}) — never fabricated`]),
        ...(modelCalls.length === 0 ? ['no model calls were recorded (the drive did not reach the implementation stage)'] : []),
        ...(repairs.length === 0 ? ['no repair occurred (honest: every body output passed its checks on the first attempt)' ] : [`repairs occurred: ${String(repairs.length)} (the engine's bounded repair discipline ran for real)`]),
      ],
    };
  }

  void store;
  void fabricRef;

  return harness;
}

export { outcomeClassesOf };
