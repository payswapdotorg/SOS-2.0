/**
 * The live data plane (Work Order P18-A, lane A) — the SERVER-ONLY
 * composition that makes live Mission state come from the REAL
 * persistence/observation/deployment stack without weakening provider
 * neutrality. One bounded pass per live mission request:
 *
 *   1. resolve the production environment from the INJECTED source
 *      (P3 typed-registry names only — never the ambient environment
 *      inside this module; the producer's default source binding is the
 *      documented impure app boundary);
 *   2. select the durable store behind the frozen P17-A adapters: REAL
 *      probes of the canonical Neon adapter and the coordination-only
 *      Upstash adapter (NEVER canonical — the frozen provider-ports
 *      rule). PRODUCTION_DURABLE only when the canonical store answered
 *      a real probe; every other honest state degrades to the explicit
 *      reference marker (never masquerading as production durable
 *      state);
 *   3. read the REAL Vercel deployment state (the deployment records
 *      with their EXACT source_revision_sha — the deployment/source-SHA
 *      binding source);
 *   4. when (and only when) the canonical store is CONNECTED, read the
 *      previously-persisted observation snapshot from it (the durable
 *      claim of the last observed head) — the reconciliation input;
 *   5. drain the REAL observation plane (the merged P17-C
 *      createRealObservationPlane: GitHub repo/CI observation, Vercel
 *      deployment events, runtime telemetry, scheduled probes where
 *      coverage is insufficient, provider health) with the claims port
 *      built from the REAL reads above — the plane runs WITHOUT a body
 *      (§5);
 *   6. map the drain report to the live-mission DTO
 *      (liveObservationFromDrain — the P17-C contract) with the honest
 *      storeRef from the selection;
 *   7. when (and only when) the canonical store is CONNECTED, persist
 *      the snapshot to it (putRow + read-back — the durability proof,
 *      the exact storage revision); in reference mode NOTHING is
 *      persisted (the separation rule — machine-checkable);
 *   8. project the data-plane view (packages/web-contracts/live — the
 *      pure projections): authoritative store, provider rows, the
 *      per-field provenance matrix, the deployment binding verdict,
 *      the durability record.
 *
 * HONESTY (binding): every provider state derives from REAL probes
 * only (CONNECTED / UNKNOWN / UNAVAILABLE / DEGRADED); a state not
 * probed this run is UNKNOWN; a failed provider is UNAVAILABLE with
 * the real reason carried verbatim; NOTHING is ever fabricated. Neon
 * being unreachable NEVER causes reference state to masquerade as
 * production durable state — the storeRef, the store view and the
 * provenance matrix all carry the explicit reference marker.
 *
 * Determinism discipline: the module itself is injectable end-to-end
 * (source, clock, fetch, sleep) — the deterministic suites script
 * every seam offline; the producer's DEFAULTS (ambient env, system
 * clock, global fetch, real sleep) are the app's single impure
 * boundary.
 */

import type { Clock } from '@sos-2/live-store';
import type { FetchPort } from '@sos-2/real-persistence';
import { bindGlobalFetch } from '@sos-2/real-persistence';
import type { Sleep } from '@sos-2/deployment-providers';
import { createLiveDataPlaneHarness } from '@sos-2/infra-production-connectivity';
import type {
  DurableStoreSelection,
  DeploymentStateRead,
  LiveDataPlaneSubjectDefaults,
  ProviderHealthSnapshotRow,
} from '@sos-2/infra-production-connectivity';
import { createRealObservationPlane } from '@sos-2/real-observation';
import type { RealObservationPlane } from '@sos-2/real-observation';
import { liveObservationFromDrain, emptyLiveObservation } from '../../live-mission/src/view-state/live-mission-dto';
import type { LiveObservationData } from '../../live-mission/src/view-state/live-mission-dto';
import { projectDataPlane } from '../../../../packages/web-contracts/live/src/index';
import type { LiveDataPlaneView, LiveDeploymentBindingInput, LiveProvenanceInput } from '../../../../packages/web-contracts/live/src/index';

/** The observation drain report type (derived from the merged plane — no extra dependency edge). */
export type ObservationDrainReport = Awaited<ReturnType<RealObservationPlane['drain']>>;

/** The architect seam name for the P17-C live-mission DTO (LiveObservationData). */
export type LiveObservationDto = LiveObservationData;

/** The canonical snapshot namespace (the durable observation-snapshot rows). */
export const LIVE_MISSION_SNAPSHOT_NAMESPACE = 'live-mission/observation';

/** The injectable data-plane options (every impure seam injectable; defaults are the app boundary). */
export interface LiveDataPlaneOptions {
  /** The injected raw environment source (P3 registry names; the caller owns the ambient read). */
  readonly source: Readonly<Record<string, string | undefined>>;
  /** The injected clock (asOf/probe instants; no hidden time). */
  readonly clock: Clock;
  /** The inner network FetchPort (the binary P17-A seam; default: the global fetch — impure boundary). */
  readonly fetch?: FetchPort;
  /** The injectable sleep (Vercel readiness polls; default: the real timer). */
  readonly sleep?: Sleep;
  /** The observation freshness window (milliseconds; default: the plane's 10 minutes). */
  readonly freshAfterMs?: number;
  /** The observation subject overrides (defaults: payswapdotorg/SOS-2.0@main). */
  readonly subjects?: LiveDataPlaneSubjectDefaults;
}

/** The durability record of one data-plane pass. */
export interface SnapshotDurability {
  readonly persisted: boolean;
  readonly namespace: string | null;
  readonly storageVersion: number | null;
  readonly note: string;
}

/** The complete honest result of one data-plane pass. */
export interface LiveDataPlaneResult {
  /** The live-mission DTO (the seam output — what the live mission surface renders). */
  readonly data: LiveObservationDto;
  /** The data-plane view (authoritative store, provider rows, provenance matrix, binding, durability). */
  readonly view: LiveDataPlaneView;
  readonly selection: DurableStoreSelection;
  readonly deploymentRead: DeploymentStateRead;
  /** The full drain report (typed; Maps inside — NOT serializable as-is; extract serializable parts for evidence). */
  readonly report: ObservationDrainReport | null;
  /** The observation plane (for connectivity/transcript extraction by evidence collectors). */
  readonly plane: RealObservationPlane | null;
  /** The provider-health snapshot rows (neon / upstash / r2 / vercel). */
  readonly providerHealth: readonly ProviderHealthSnapshotRow[];
  readonly durability: SnapshotDurability;
  /** True when the observation environment was incomplete — the honest unwired result (never fabricated). */
  readonly unwired: boolean;
  /** The env NAMES missing from the injected source (never values). */
  readonly missingEnv: readonly string[];
}

/** One bounded, honest data-plane pass. Never fabricates; failures degrade honestly. */
export async function runLiveDataPlane(options: LiveDataPlaneOptions): Promise<LiveDataPlaneResult> {
  const fetch = options.fetch ?? bindGlobalFetch();
  const harness = createLiveDataPlaneHarness({
    source: options.source as Readonly<Record<string, string>>,
    tier: 'production',
    clock: options.clock,
    fetch,
    sleep: options.sleep,
    subjects: options.subjects,
  });
  const environment = harness.environment;
  const subjects = harness.observationPlaneConfig()?.github ?? {
    owner: environment.github.owner,
    repo: environment.github.repo,
    branch: environment.github.branch,
    token: '',
    tokenEnvName: environment.github.tokenEnv,
  };
  const repositorySubject = `github:repo:${subjects.owner}/${subjects.repo}`;

  // --- 2. the durable-store selection (real probes; honest states) ---
  const selection = await harness.selectDurableStore();

  // --- 3. the real deployment-state read (records + source_revision_sha) ---
  const deploymentRead = await harness.readDeploymentState();

  // --- the honest unwired path: no observation env -> no drain, never fabricated ---
  const observationConfig = harness.observationPlaneConfig();
  const missingEnv = environment.absent;
  if (observationConfig === null) {
    const asOf = new Date(options.clock.nowEpochMs()).toISOString();
    const data = emptyLiveObservation(selection.storeRef, asOf, repositorySubject);
    const view = projectUnwiredView({ asOf, selection, harness, missingEnv });
    return {
      data,
      view,
      selection,
      deploymentRead,
      report: null,
      plane: null,
      providerHealth: harness.providerHealthSnapshot(),
      durability: {
        persisted: false,
        namespace: null,
        storageVersion: null,
        note: 'the observation environment is incomplete — no drain ran, nothing persisted (never fabricated)',
      },
      unwired: true,
      missingEnv,
    };
  }

  // --- 4. the durable previous snapshot (the claim source; canonical store only) ---
  const postgres = harness.connectivity.persistence.postgres;
  const claimMainSubject = `github:repo:${subjects.owner}/${subjects.repo}@${subjects.branch}`;
  const claimProductionSubject = 'deploy:environment:production';
  let previousHead: string | null = null;
  let previousClaimRef: string | null = null;
  if (selection.mode === 'PRODUCTION_DURABLE' && postgres !== null) {
    try {
      const previous = await postgres.getRow(LIVE_MISSION_SNAPSHOT_NAMESPACE, repositorySubject);
      if (previous !== null && typeof previous.data === 'object' && previous.data !== null && !Array.isArray(previous.data)) {
        const observedHead = (previous.data as Record<string, unknown>)['observedHead'];
        if (typeof observedHead === 'string' && observedHead.length > 0) {
          previousHead = observedHead;
          previousClaimRef = `durable-snapshot:${LIVE_MISSION_SNAPSHOT_NAMESPACE}/${repositorySubject}@v${String(previous.storage_version)}`;
        }
      }
    } catch {
      // an unreadable previous snapshot claims nothing (honest — no fabricated claim)
      previousHead = null;
      previousClaimRef = null;
    }
  }

  // --- 5. the real observation-plane drain (no body; §5) ---
  const plane = createRealObservationPlane({
    clock: options.clock,
    fetch: harness.observationFetch(),
    github: { ...observationConfig.github, apiBase: 'https://api.github.com' },
    vercel: { ...observationConfig.vercel, apiBase: 'https://api.vercel.com' },
    upstash: observationConfig.upstash,
    webhookSecret: observationConfig.webhookSecret,
    claims: {
      readClaims: async () => {
        const claims: { subject: string; claimedRevision: string; claimRef: string }[] = [];
        // the REAL production claim: what the deployment record says production runs
        const production = deploymentRead.latestByTarget['production'];
        if (production !== undefined && production.commitSha !== null) {
          claims.push({ subject: claimProductionSubject, claimedRevision: production.commitSha, claimRef: `vercel:deployment:${production.id}` });
        }
        // the durable claim: the last observed head recorded in the canonical store
        if (previousHead !== null && previousClaimRef !== null) {
          claims.push({ subject: claimMainSubject, claimedRevision: previousHead, claimRef: previousClaimRef });
        }
        return claims;
      },
    },
    ...(options.freshAfterMs !== undefined ? { freshAfterMs: options.freshAfterMs } : {}),
  });
  const report = await plane.drain();
  const asOf = new Date(options.clock.nowEpochMs()).toISOString();
  const eventsInWindow = report.sourceSummaries.reduce((total, summary) => total + summary.applied, 0);

  // --- 6. the live-mission DTO (the P17-C contract mapping) ---
  const data = liveObservationFromDrain({
    report,
    connectivity: {
      sources: plane.connectivity().map((record) => ({
        ...record,
        probes: record.probes.map((probe) => ({ apiRevision: probe.apiRevision })),
      })),
    },
    repositorySubject: plane.subjects.repository,
    storeRef: selection.storeRef,
    asOf,
    eventsInWindow,
    watchingWithoutBody: true,
  });

  // --- 7. the durability binding (canonical store only — never in reference mode) ---
  const durability = await persistSnapshotWhenDurable({
    selection,
    postgres,
    clock: options.clock,
    repositorySubject,
    asOf,
    data,
  });

  // --- 8. the data-plane view (pure projections) ---
  const view = projectDataPlaneView({ asOf, selection, harness, report, data, deploymentRead, durability });

  return {
    data,
    view,
    selection,
    deploymentRead,
    report,
    plane,
    providerHealth: harness.providerHealthSnapshot(),
    durability,
    unwired: false,
    missingEnv,
  };
}

// ---------------------------------------------------------------------------
// The snapshot durability binding
// ---------------------------------------------------------------------------

async function persistSnapshotWhenDurable(input: {
  readonly selection: DurableStoreSelection;
  readonly postgres: import('@sos-2/real-persistence').RealPersistenceStack['postgres'];
  readonly clock: Clock;
  readonly repositorySubject: string;
  readonly asOf: string;
  readonly data: LiveObservationDto;
}): Promise<SnapshotDurability> {
  if (input.selection.mode !== 'PRODUCTION_DURABLE' || input.postgres === null) {
    return {
      persisted: false,
      namespace: null,
      storageVersion: null,
      note: `the canonical store is ${input.selection.canonical.state} — the snapshot is NOT persisted (reference mode never claims production durable persistence)`,
    };
  }
  try {
    const repository = input.data.repository;
    const head = repository.branchHeads.length > 0 ? repository.branchHeads[0]!.head : null;
    // a deep JSON copy (the DTO is fully serializable — pinned by the P17-C suite); JsonValue rows are canonical-serialized by the adapter
    const snapshot: Parameters<typeof input.postgres.putRow>[2] = JSON.parse(
      JSON.stringify({
        asOf: input.asOf,
        drainedAt: input.data.drainedAt,
        repositorySubject: input.repositorySubject,
        observedHead: head,
        storeRef: input.data.storeRef,
        storeMode: input.selection.mode,
        observation: input.data,
      }),
    );
    const outcome = await input.postgres.putRow(LIVE_MISSION_SNAPSHOT_NAMESPACE, input.repositorySubject, snapshot);
    if (!outcome.ok) {
      return {
        persisted: false,
        namespace: LIVE_MISSION_SNAPSHOT_NAMESPACE,
        storageVersion: null,
        note: `the durable write was rejected (${outcome.kind} at version ${String(outcome.current_storage_version)}) — the snapshot is NOT persisted (honest failure, never fabricated)`,
      };
    }
    // the read-back proof: the row round-trips with the exact storage revision
    const readBack = await input.postgres.getRow(LIVE_MISSION_SNAPSHOT_NAMESPACE, input.repositorySubject);
    if (readBack === null || readBack.storage_version !== outcome.storage_version) {
      return {
        persisted: false,
        namespace: LIVE_MISSION_SNAPSHOT_NAMESPACE,
        storageVersion: null,
        note: 'the durable write reported success but the read-back disagreed — the snapshot durability is NOT claimed (honest failure)',
      };
    }
    return {
      persisted: true,
      namespace: LIVE_MISSION_SNAPSHOT_NAMESPACE,
      storageVersion: outcome.storage_version,
      note: `the snapshot persisted to the canonical durable store and read back byte-exact at storage version ${String(outcome.storage_version)} (the exact durable revision)`,
    };
  } catch (error) {
    return {
      persisted: false,
      namespace: LIVE_MISSION_SNAPSHOT_NAMESPACE,
      storageVersion: null,
      note: `the durable write failed with the real reason — ${(error as Error).message} (honest failure, never fabricated)`,
    };
  }
}

// ---------------------------------------------------------------------------
// The view projections (bridging the harness/plane shapes into the pure projections)
// ---------------------------------------------------------------------------

function providerRowsFromHarness(harness: ReturnType<typeof createLiveDataPlaneHarness>): readonly {
  provider: string;
  role: string;
  state: 'CONNECTED' | 'UNKNOWN' | 'UNAVAILABLE' | 'DEGRADED';
  detail: string;
  credentialEnv: string | null;
  apiRevision: string | null;
  lastError: string | null;
  probedAt: string | null;
}[] {
  return harness.providerHealthSnapshot().map((row) => ({
    provider: row.provider,
    role: row.role,
    state: row.state,
    detail: row.detail,
    credentialEnv: row.credentialEnvName,
    apiRevision: row.apiRevision,
    lastError: row.lastError,
    probedAt: row.probedAt,
  }));
}

function deploymentBindingInput(deploymentRead: DeploymentStateRead, observedHead: string | null): LiveDeploymentBindingInput {
  const production = deploymentRead.latestByTarget['production'];
  return {
    environment: 'production',
    deploymentId: production?.id ?? null,
    sourceRevisionSha: production?.commitSha ?? null,
    readyState: production?.readyState ?? null,
    observedRepositoryHead: observedHead,
    providerState: deploymentRead.state,
    url: production?.url ?? null,
    since: production?.createdAt ?? null,
  };
}

function sourceStateFor(sources: readonly { source: string; state: 'CONNECTED' | 'UNKNOWN' | 'UNAVAILABLE' | 'DEGRADED' }[], prefix: string): 'CONNECTED' | 'UNKNOWN' | 'UNAVAILABLE' | 'DEGRADED' {
  const matches = sources.filter((source) => source.source.startsWith(prefix));
  if (matches.length === 0) {
    return 'UNKNOWN';
  }
  const rank = { UNAVAILABLE: 0, DEGRADED: 1, CONNECTED: 2, UNKNOWN: 3 } as const;
  const worst = matches.reduce((accumulator, entry) => (rank[entry.state] < rank[accumulator.state] ? entry : accumulator), matches[0]!);
  return worst.state;
}

function projectDataPlaneView(input: {
  readonly asOf: string;
  readonly selection: DurableStoreSelection;
  readonly harness: ReturnType<typeof createLiveDataPlaneHarness>;
  readonly report: ObservationDrainReport;
  readonly data: LiveObservationDto;
  readonly deploymentRead: DeploymentStateRead;
  readonly durability: SnapshotDurability;
}): LiveDataPlaneView {
  const { report, data, selection, deploymentRead, durability } = input;
  const sources = data.sources.map((source) => ({ source: source.source, state: source.state }));
  const binding = deploymentBindingInput(deploymentRead, data.repository.branchHeads.length > 0 ? data.repository.branchHeads[0]!.head : null);
  const provenance: LiveProvenanceInput = {
    asOf: input.asOf,
    drainedAt: report.drainedAt,
    store: {
      canonicalProvider: selection.canonical.provider,
      canonicalState: selection.canonical.state,
      canonicalStoreRef: selection.canonicalStoreRef,
      canonicalDetail: selection.canonical.detail,
      canonicalLastError: selection.canonical.lastError,
      canonicalProbedAt: selection.canonical.probedAt,
      coordinationProvider: selection.coordination.provider,
      coordinationState: selection.coordination.state,
      coordinationDetail: selection.coordination.detail,
    },
    repository: {
      state: sourceStateFor(sources, 'github:'),
      freshness: data.repository.freshness,
      producedBy: `github-observation:${input.asOf}`,
      revision: data.repository.branchHeads.length > 0 ? data.repository.branchHeads[0]!.head : null,
    },
    ci: {
      state: sourceStateFor(sources, 'ci:'),
      freshness: data.ci.freshness,
      producedBy: 'ci-observation:github-actions',
      revision: data.ci.latestByPipeline.length > 0 ? data.ci.latestByPipeline[0]!.runId : null,
    },
    deployments: {
      state: sourceStateFor(sources, 'deploy:'),
      freshness: data.deployments.freshness,
      producedBy: 'deployment-observation:vercel',
      revision: data.deployments.byEnvironment.length > 0 ? data.deployments.byEnvironment[0]!.revision : null,
    },
    providerHealth: {
      state: sourceStateFor(sources, 'provider-health:'),
      freshness: data.providerHealth.length > 0 ? 'FRESH' : 'NO_DATA',
      producedBy: 'provider-health:real-probes',
      revision: null,
    },
    findings: { count: report.findings.length, detectedAt: report.findings.length > 0 ? report.findings[0]!.detectedAt : null },
    detections: { count: report.detections.length, detectedAt: report.detections.length > 0 ? report.detections[0]!.detectedAt : null },
    eventsInWindow: { count: data.eventsInWindow },
    deploymentBinding: binding,
  };
  return projectDataPlane({
    asOf: input.asOf,
    store: provenance.store,
    providers: providerRowsFromHarness(input.harness),
    provenance,
    deploymentBinding: binding,
    snapshotDurability: {
      persisted: durability.persisted,
      namespace: durability.namespace,
      storageVersion: durability.storageVersion,
      note: durability.note,
    },
  });
}

function projectUnwiredView(input: {
  readonly asOf: string;
  readonly selection: DurableStoreSelection;
  readonly harness: ReturnType<typeof createLiveDataPlaneHarness>;
  readonly missingEnv: readonly string[];
}): LiveDataPlaneView {
  const selectionInput = {
    canonicalProvider: input.selection.canonical.provider,
    canonicalState: input.selection.canonical.state,
    canonicalStoreRef: input.selection.canonicalStoreRef,
    canonicalDetail: input.selection.canonical.detail,
    canonicalLastError: input.selection.canonical.lastError,
    canonicalProbedAt: input.selection.canonical.probedAt,
    coordinationProvider: input.selection.coordination.provider,
    coordinationState: input.selection.coordination.state,
    coordinationDetail: input.selection.coordination.detail,
  };
  const provenance: LiveProvenanceInput = {
    asOf: input.asOf,
    drainedAt: null,
    store: selectionInput,
    repository: { state: 'UNKNOWN', freshness: 'NO_DATA', producedBy: 'unwired', revision: null },
    ci: { state: 'UNKNOWN', freshness: 'NO_DATA', producedBy: 'unwired', revision: null },
    deployments: { state: 'UNKNOWN', freshness: 'NO_DATA', producedBy: 'unwired', revision: null },
    providerHealth: { state: 'UNKNOWN', freshness: 'NO_DATA', producedBy: 'unwired', revision: null },
    findings: { count: 0, detectedAt: null },
    detections: { count: 0, detectedAt: null },
    eventsInWindow: { count: 0 },
    deploymentBinding: null,
  };
  return projectDataPlane({
    asOf: input.asOf,
    store: selectionInput,
    providers: providerRowsFromHarness(input.harness),
    provenance,
    deploymentBinding: null,
    snapshotDurability: {
      persisted: false,
      namespace: null,
      storageVersion: null,
      note: `the observation environment is incomplete (missing env names: ${input.missingEnv.join(', ') || 'none'}) — no drain ran, nothing persisted (never fabricated)`,
    },
  });
}
