/**
 * Live-action projections — the P18-A live web-contracts subpackage.
 *
 * SERIALIZABLE VIEW TYPES + PURE PROJECTIONS for live mission data —
 * the data-side projections of the live data plane (apps/web/live-data,
 * Work Order P18-A): authoritative-store selection, honest provider
 * states, per-field provenance, deployment/source-SHA binding and
 * freshness — everything the live-mission surface needs to answer
 * "which store produced this value, at which revision, with which
 * honest state".
 *
 * DISCIPLINE (the P17-C live-mission-dto + P4 onboarding precedents):
 *   - SELF-CONTAINED, SERIALIZABLE, ZERO domain imports: every input is
 *     a structural subset the caller (the data plane / the seam) fills;
 *     TypeScript structural typing accepts the real shapes at the call
 *     site without a dependency edge. Outputs are plain JSON records +
 *     arrays (no Maps) so they cross the server-component boundary.
 *   - DETERMINISTIC + TOTAL: pure functions, fixed orderings, no
 *     clocks, no env, no network; same input -> byte-identical output.
 *   - HONEST STATES ONLY: the four machine-checkable provider states
 *     (CONNECTED / UNKNOWN / UNAVAILABLE / DEGRADED) and the three
 *     freshness states (FRESH / STALE / NO_DATA). A value not probed
 *     this run is UNKNOWN; a failed provider is UNAVAILABLE with its
 *     real reason carried verbatim; nothing is ever fabricated.
 *   - REFERENCE-MODE SEPARATION (the program-defining rule): when the
 *     canonical durable store is not CONNECTED, the data plane serves
 *     from the reference in-memory store and EVERY projection here
 *     marks it — store_ref starts with 'reference:', the store view
 *     carries mode REFERENCE_FALLBACK + the exact degradation reason,
 *     and reference mode can never masquerade as production durable
 *     state (assertValidLiveDataPlaneView rejects the mismatch).
 *   - THE NEVER-CANONICAL RULE (frozen @sos-2/live-store ports): the
 *     coordination provider (Upstash) is coordination ONLY — every
 *     store view carries the never-canonical sentence; it is never
 *     selected as the authoritative store under any state.
 */

// ---------------------------------------------------------------------------
// Honest vocabularies (type-level mirrors of the P17 lane vocabulary —
// no runtime edge to the owning packages; shapes pinned by test)
// ---------------------------------------------------------------------------

/** The four honest provider states (the P17 lane vocabulary). */
export const LIVE_HONEST_STATES = ['CONNECTED', 'UNKNOWN', 'UNAVAILABLE', 'DEGRADED'] as const;
export type LiveHonestState = (typeof LIVE_HONEST_STATES)[number];

/** Is this a well-formed honest provider state? */
export function isLiveHonestState(value: unknown): value is LiveHonestState {
  return typeof value === 'string' && (LIVE_HONEST_STATES as readonly string[]).includes(value);
}

/** The three explicit freshness states (the merged observation discipline). */
export const LIVE_FRESHNESS_STATES = ['FRESH', 'STALE', 'NO_DATA'] as const;
export type LiveFreshnessState = (typeof LIVE_FRESHNESS_STATES)[number];

/** Is this a well-formed freshness state? */
export function isLiveFreshnessState(value: unknown): value is LiveFreshnessState {
  return typeof value === 'string' && (LIVE_FRESHNESS_STATES as readonly string[]).includes(value);
}

/**
 * The two store modes of the live data plane:
 *   PRODUCTION_DURABLE — the canonical durable store (Neon) answered a
 *                        REAL probe and serves/persists this request;
 *   REFERENCE_FALLBACK — the canonical store is not CONNECTED; the
 *                        reference in-memory observation store serves
 *                        this request, explicitly marked (never
 *                        masquerading as production durable state).
 */
export const LIVE_STORE_MODES = ['PRODUCTION_DURABLE', 'REFERENCE_FALLBACK'] as const;
export type LiveStoreMode = (typeof LIVE_STORE_MODES)[number];

/** The reference-mode store_ref prefix (the machine-checkable marker). */
export const LIVE_REFERENCE_STORE_PREFIX = 'reference:';

/** Is this store_ref the explicit reference marker? */
export function isReferenceStoreRef(storeRef: string): boolean {
  return storeRef.startsWith(LIVE_REFERENCE_STORE_PREFIX);
}

/**
 * THE NEVER-CANONICAL SENTENCE (carried verbatim on every store view —
 * the frozen provider-ports rule, rendered to the user).
 */
export const LIVE_NEVER_CANONICAL_NOTE =
  'Upstash Redis is coordination only (cache, idempotency, leases) — never the canonical store; the durable Postgres store (Neon) is the sole canonical store.';

// ---------------------------------------------------------------------------
// Durable-store selection — input + view
// ---------------------------------------------------------------------------

/**
 * The serializable outcome of the durable-store selection (the
 * structural subset of the data plane's selection record these
 * projections consume). Every state derives from a REAL probe — an
 * unprobed provider is UNKNOWN, never health.
 */
export interface LiveDurableStoreSelectionInput {
  /** The canonical durable provider id ('neon'). */
  readonly canonicalProvider: string;
  /** The canonical provider's honest state (real probe only). */
  readonly canonicalState: LiveHonestState;
  /** The canonical provider's public store identity (never a credential). */
  readonly canonicalStoreRef: string | null;
  /** How the canonical state was derived (probe evidence summary). */
  readonly canonicalDetail: string;
  /** The real failure reason for UNAVAILABLE/DEGRADED (redacted), or null. */
  readonly canonicalLastError: string | null;
  /** The probe instant (RFC3339), or null when never probed. */
  readonly canonicalProbedAt: string | null;
  /** The coordination-only provider id ('upstash'). */
  readonly coordinationProvider: string;
  /** The coordination provider's honest state (real probe only). */
  readonly coordinationState: LiveHonestState;
  /** How the coordination state was derived. */
  readonly coordinationDetail: string;
}

/** The authoritative-store view: which store serves live mission data, honestly. */
export interface LiveAuthoritativeStoreView {
  /** PRODUCTION_DURABLE only when the canonical store answered a real probe. */
  readonly mode: LiveStoreMode;
  /** The store identity that actually served this request. */
  readonly store_ref: string;
  /** True exactly when mode is REFERENCE_FALLBACK (machine-checkable). */
  readonly reference_mode: boolean;
  readonly canonical_provider: string;
  readonly canonical_state: LiveHonestState;
  /** The canonical store's public identity, or null when unknown. */
  readonly canonical_store_ref: string | null;
  readonly canonical_detail: string;
  readonly coordination_provider: string;
  readonly coordination_state: LiveHonestState;
  /** The never-canonical sentence (always carried). */
  readonly coordination_note: string;
  /** The exact honest reason reference mode is in effect, or null in production mode. */
  readonly degradation_note: string | null;
}

/**
 * Project the authoritative-store view from a durable-store selection.
 * Deterministic and total: PRODUCTION_DURABLE only on a CONNECTED
 * canonical probe; every other state is honest REFERENCE_FALLBACK with
 * the real reason.
 */
export function projectAuthoritativeStore(input: LiveDurableStoreSelectionInput): LiveAuthoritativeStoreView {
  const mode: LiveStoreMode = input.canonicalState === 'CONNECTED' ? 'PRODUCTION_DURABLE' : 'REFERENCE_FALLBACK';
  const degradationNote =
    mode === 'PRODUCTION_DURABLE'
      ? null
      : `the canonical store ${input.canonicalProvider} is ${input.canonicalState}` +
        (input.canonicalLastError !== null ? ` (${input.canonicalLastError})` : '') +
        ' — live mission data is served from the reference in-memory observation store, explicitly NOT production durable state';
  return {
    mode,
    store_ref:
      mode === 'PRODUCTION_DURABLE' ? (input.canonicalStoreRef ?? 'unknown:canonical') : `${LIVE_REFERENCE_STORE_PREFIX}in-memory-observation-store`,
    reference_mode: mode === 'REFERENCE_FALLBACK',
    canonical_provider: input.canonicalProvider,
    canonical_state: input.canonicalState,
    canonical_store_ref: input.canonicalStoreRef,
    canonical_detail: input.canonicalDetail,
    coordination_provider: input.coordinationProvider,
    coordination_state: input.coordinationState,
    coordination_note: LIVE_NEVER_CANONICAL_NOTE,
    degradation_note: degradationNote,
  };
}

// ---------------------------------------------------------------------------
// Provider-health rows
// ---------------------------------------------------------------------------

/** One provider's honest state row (input — structural). */
export interface LiveProviderStateRowInput {
  readonly provider: string;
  /** The provider's role ('durable-canonical-state' | 'coordination-only-never-canonical' | 'deployment' | ...). */
  readonly role: string;
  readonly state: LiveHonestState;
  readonly detail: string;
  /** The credential env NAME (never the value), or null. */
  readonly credentialEnv: string | null;
  readonly apiRevision: string | null;
  readonly lastError: string | null;
  readonly probedAt: string | null;
}

/** One provider's honest state row (view — serialized field names). */
export interface LiveProviderStateRow {
  readonly provider: string;
  readonly role: string;
  readonly state: LiveHonestState;
  readonly detail: string;
  readonly credential_env: string | null;
  readonly api_revision: string | null;
  readonly last_error: string | null;
  readonly probed_at: string | null;
}

/** Project provider rows (deterministic order: provider id, then role). */
export function projectProviderRows(states: readonly LiveProviderStateRowInput[]): readonly LiveProviderStateRow[] {
  return [...states]
    .map((state) => ({
      provider: state.provider,
      role: state.role,
      state: state.state,
      detail: state.detail,
      credential_env: state.credentialEnv,
      api_revision: state.apiRevision,
      last_error: state.lastError,
      probed_at: state.probedAt,
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider) || left.role.localeCompare(right.role));
}

// ---------------------------------------------------------------------------
// Deployment / source-SHA binding
// ---------------------------------------------------------------------------

/** The binding verdicts: is what production runs the observed head? */
export const LIVE_DEPLOYMENT_BINDING_VERDICTS = ['VERIFIED', 'DIVERGED', 'UNAVAILABLE', 'NO_DEPLOYMENT'] as const;
export type LiveDeploymentBindingVerdict = (typeof LIVE_DEPLOYMENT_BINDING_VERDICTS)[number];

/** The deployment-read input (structural subset of the provider read). */
export interface LiveDeploymentBindingInput {
  /** The environment the binding is about ('production'). */
  readonly environment: string;
  /** The provider-assigned deployment id ('dpl_…'), or null when none. */
  readonly deploymentId: string | null;
  /** The EXACT source revision sha the deployment was built from (source_revision_sha). */
  readonly sourceRevisionSha: string | null;
  /** The deployment's provider truth state, verbatim ('READY' | 'ERROR' | ...), or null. */
  readonly readyState: string | null;
  /** The observed repository head sha the binding compares against, or null. */
  readonly observedRepositoryHead: string | null;
  /** The provider's honest state for this read (real probe only). */
  readonly providerState: LiveHonestState;
  readonly url: string | null;
  readonly since: string | null;
}

/** The deployment/source-SHA binding view. */
export interface LiveDeploymentBindingView {
  readonly environment: string;
  readonly deployment_id: string | null;
  readonly source_revision_sha: string | null;
  readonly ready_state: string | null;
  readonly observed_repository_head: string | null;
  readonly verdict: LiveDeploymentBindingVerdict;
  readonly provider_state: LiveHonestState;
  readonly url: string | null;
  readonly since: string | null;
  readonly note: string;
}

/**
 * Project the deployment/source-SHA binding verdict. Honest rules:
 *   UNAVAILABLE   the provider read did not answer (never fabricated);
 *   NO_DEPLOYMENT the provider answered but no deployment of this
 *                 environment carries a source sha (or the repository
 *                 head is not observed — no comparison is claimed);
 *   VERIFIED      the deployed source_revision_sha IS the observed head;
 *   DIVERGED      both present and different (difference only —
 *                 ordering of shas is NEVER claimed).
 */
export function projectDeploymentBinding(input: LiveDeploymentBindingInput): LiveDeploymentBindingView {
  let verdict: LiveDeploymentBindingVerdict;
  let note: string;
  if (input.providerState !== 'CONNECTED') {
    verdict = 'UNAVAILABLE';
    note = `the deployment provider read is ${input.providerState} — no binding is claimed (never fabricated)`;
  } else if (input.deploymentId === null || input.sourceRevisionSha === null) {
    verdict = 'NO_DEPLOYMENT';
    note = `the provider answered but no ${input.environment} deployment with a source revision sha exists yet`;
  } else if (input.observedRepositoryHead === null) {
    verdict = 'NO_DEPLOYMENT';
    note = 'a deployed source revision exists but the repository head is not observed (NO_DATA) — no comparison is claimed';
  } else if (input.sourceRevisionSha === input.observedRepositoryHead) {
    verdict = 'VERIFIED';
    note = `the deployed source_revision_sha equals the observed repository head (${input.sourceRevisionSha.slice(0, 12)}…)`;
  } else {
    verdict = 'DIVERGED';
    note = `the deployed source_revision_sha (${input.sourceRevisionSha.slice(0, 12)}…) differs from the observed repository head (${input.observedRepositoryHead.slice(0, 12)}…) — difference only, ordering is never claimed`;
  }
  return {
    environment: input.environment,
    deployment_id: input.deploymentId,
    source_revision_sha: input.sourceRevisionSha,
    ready_state: input.readyState,
    observed_repository_head: input.observedRepositoryHead,
    verdict,
    provider_state: input.providerState,
    url: input.url,
    since: input.since,
    note,
  };
}

// ---------------------------------------------------------------------------
// Per-field provenance — the "every value has an honest provenance state" matrix
// ---------------------------------------------------------------------------

/** Which kind of store/plane produced a value. */
export const LIVE_PROVENANCE_STORE_KINDS = ['DURABLE_CANONICAL', 'COORDINATION_ONLY', 'REFERENCE_IN_MEMORY', 'OBSERVATION_PLANE', 'PROVIDER_READ'] as const;
export type LiveProvenanceStoreKind = (typeof LIVE_PROVENANCE_STORE_KINDS)[number];

/** One provenance entry: one field family of the live-mission DTO. */
export interface LiveProvenanceEntry {
  /** The live-mission DTO field family ('storeRef', 'repository.branchHeads', ...). */
  readonly field: string;
  /** Which plane/store/adapter produced it. */
  readonly produced_by: string;
  readonly store_kind: LiveProvenanceStoreKind;
  /** The exact revision the value is bound to (sha, storage version, instant), or null. */
  readonly revision: string | null;
  /** The honest provider state of the producer for this field. */
  readonly state: LiveHonestState;
  /** The freshness of the underlying observation, or NOT_APPLICABLE for non-observation fields. */
  readonly freshness: LiveFreshnessState | 'NOT_APPLICABLE';
  readonly note: string;
}

/** The per-field observation summaries the provenance matrix consumes. */
export interface LiveProvenanceObservationField {
  readonly state: LiveHonestState;
  readonly freshness: LiveFreshnessState;
  readonly producedBy: string;
  /** The bound revision (e.g. the observed head sha), or null. */
  readonly revision: string | null;
}

/** The provenance-matrix input (structural; the data plane fills it from the real drain). */
export interface LiveProvenanceInput {
  readonly asOf: string;
  readonly drainedAt: string | null;
  readonly store: LiveDurableStoreSelectionInput;
  readonly repository: LiveProvenanceObservationField;
  readonly ci: LiveProvenanceObservationField;
  readonly deployments: LiveProvenanceObservationField;
  readonly providerHealth: LiveProvenanceObservationField;
  readonly findings: { readonly count: number; readonly detectedAt: string | null };
  readonly detections: { readonly count: number; readonly detectedAt: string | null };
  readonly eventsInWindow: { readonly count: number };
  readonly deploymentBinding: LiveDeploymentBindingInput | null;
}

/**
 * Project the per-field provenance matrix: one entry for every field
 * family the live-mission DTO carries, each with its producing plane,
 * bound revision and honest state. Reference mode marks every
 * store-served field REFERENCE_IN_MEMORY (the separation rule).
 */
export function projectProvenance(input: LiveProvenanceInput): readonly LiveProvenanceEntry[] {
  const store: LiveProvenanceStoreKind = input.store.canonicalState === 'CONNECTED' ? 'DURABLE_CANONICAL' : 'REFERENCE_IN_MEMORY';
  const storeState = input.store.canonicalState;
  const storeNote =
    input.store.canonicalState === 'CONNECTED'
      ? 'served from the canonical durable store (real probe answered)'
      : `served from the reference in-memory store — the canonical store is ${input.store.canonicalState}` +
        (input.store.canonicalLastError !== null ? ` (${input.store.canonicalLastError})` : '') +
        ' (explicitly NOT production durable state)';
  const entries: LiveProvenanceEntry[] = [
    {
      field: 'storeRef',
      produced_by: 'durable-store-selection',
      store_kind: store,
      revision:
        input.store.canonicalState === 'CONNECTED'
          ? (input.store.canonicalStoreRef ?? null)
          : `${LIVE_REFERENCE_STORE_PREFIX}in-memory-observation-store`,
      state: storeState,
      freshness: 'NOT_APPLICABLE',
      note: storeNote,
    },
    {
      field: 'asOf',
      produced_by: 'data-plane-clock',
      store_kind: 'OBSERVATION_PLANE',
      revision: input.asOf,
      state: 'CONNECTED',
      freshness: 'NOT_APPLICABLE',
      note: 'the caller-supplied snapshot instant (never a hidden clock)',
    },
    {
      field: 'drainedAt',
      produced_by: 'observation-plane-drain',
      store_kind: 'OBSERVATION_PLANE',
      revision: input.drainedAt,
      state: input.drainedAt === null ? 'UNKNOWN' : 'CONNECTED',
      freshness: 'NOT_APPLICABLE',
      note: input.drainedAt === null ? 'no drain has run — nothing is fabricated' : 'the bounded no-body drain pass instant',
    },
    {
      field: 'sources',
      produced_by: 'observation-connectivity-tracker',
      store_kind: 'OBSERVATION_PLANE',
      revision: input.drainedAt,
      state: input.drainedAt === null ? 'UNKNOWN' : 'CONNECTED',
      freshness: 'NOT_APPLICABLE',
      note: 'per-source honest states from REAL probe records (CONNECTED/UNKNOWN/UNAVAILABLE/DEGRADED)',
    },
    {
      field: 'eventsInWindow',
      produced_by: 'observation-plane-drain',
      store_kind: 'OBSERVATION_PLANE',
      revision: input.drainedAt,
      state: input.drainedAt === null ? 'UNKNOWN' : 'CONNECTED',
      freshness: 'NOT_APPLICABLE',
      note: `${input.eventsInWindow.count} event(s) applied by this drain (replay-protected ingestion)`,
    },
    observationField('repository.branchHeads', input.repository, 'the observed branch heads (github.push events folded by the projection)'),
    observationField('repository.openPullRequests', input.repository, 'the open pull requests observed by the repository sources'),
    observationField('ci.latestByPipeline', input.ci, 'the latest CI run per pipeline, status carried verbatim from the provider'),
    observationField('deployments.byEnvironment', input.deployments, 'the deployed revision per environment (deployment.change events)'),
    observationField('providerHealth', input.providerHealth, 'the last health signal per provider (provider-health probes)'),
    {
      field: 'findings',
      produced_by: 'observation-reconciliation',
      store_kind: 'OBSERVATION_PLANE',
      revision: input.findings.detectedAt,
      state: input.findings.detectedAt === null ? 'UNKNOWN' : 'CONNECTED',
      freshness: 'NOT_APPLICABLE',
      note: `${input.findings.count} reconciliation finding(s) — claims vs observed revisions (ALIGNED/DIVERGED/UNVERIFIED/STALE)`,
    },
    {
      field: 'detections',
      produced_by: 'observation-detection',
      store_kind: 'OBSERVATION_PLANE',
      revision: input.detections.detectedAt,
      state: input.detections.detectedAt === null ? 'UNKNOWN' : 'CONNECTED',
      freshness: 'NOT_APPLICABLE',
      note: `${input.detections.count} detection(s) — shortfalls/opportunities, non-authoritative inputs`,
    },
  ];
  if (input.deploymentBinding !== null) {
    const binding = projectDeploymentBinding(input.deploymentBinding);
    entries.push({
      field: 'deployments.sourceRevisionShaBinding',
      produced_by: 'deployment-provider-read',
      store_kind: 'PROVIDER_READ',
      revision: binding.source_revision_sha,
      state: binding.provider_state,
      freshness: 'NOT_APPLICABLE',
      note: `${binding.verdict}: ${binding.note}`,
    });
  }
  return entries;
}

function observationField(field: string, observed: LiveProvenanceObservationField, note: string): LiveProvenanceEntry {
  return {
    field,
    produced_by: observed.producedBy,
    store_kind: 'OBSERVATION_PLANE',
    revision: observed.revision,
    state: observed.state,
    freshness: observed.freshness,
    note:
      observed.freshness === 'NO_DATA'
        ? `${note} — NO_DATA: absence of observation is never success`
        : observed.freshness === 'STALE'
          ? `${note} — STALE: older than the freshness window (never reported as aligned)`
          : note,
  };
}

// ---------------------------------------------------------------------------
// The aggregate data-plane view + its fail-closed validator
// ---------------------------------------------------------------------------

/** The canonical-store durability proof of this request's snapshot. */
export interface LiveSnapshotDurabilityInput {
  /** Was the snapshot persisted to the canonical durable store this request? */
  readonly persisted: boolean;
  /** The row namespace, or null when not persisted. */
  readonly namespace: string | null;
  /** The adapter's storage version (the exact durable revision), or null. */
  readonly storageVersion: number | null;
  readonly note: string;
}

/** The durability view (serialized). */
export interface LiveSnapshotDurabilityView {
  readonly persisted: boolean;
  readonly namespace: string | null;
  readonly storage_version: number | null;
  readonly note: string;
}

/** The aggregate data-plane view input. */
export interface LiveDataPlaneViewInput {
  readonly asOf: string;
  readonly store: LiveDurableStoreSelectionInput;
  readonly providers: readonly LiveProviderStateRowInput[];
  readonly provenance: LiveProvenanceInput;
  readonly deploymentBinding: LiveDeploymentBindingInput | null;
  readonly snapshotDurability: LiveSnapshotDurabilityInput;
}

/** The aggregate data-plane view — everything a live mission request can determine, honestly. */
export interface LiveDataPlaneView {
  readonly as_of: string;
  readonly store: LiveAuthoritativeStoreView;
  readonly providers: readonly LiveProviderStateRow[];
  readonly provenance: readonly LiveProvenanceEntry[];
  readonly deployment_binding: LiveDeploymentBindingView | null;
  readonly snapshot_durability: LiveSnapshotDurabilityView;
}

/** Project the aggregate data-plane view (pure, deterministic). */
export function projectDataPlane(input: LiveDataPlaneViewInput): LiveDataPlaneView {
  return {
    as_of: input.asOf,
    store: projectAuthoritativeStore(input.store),
    providers: projectProviderRows(input.providers),
    provenance: projectProvenance(input.provenance),
    deployment_binding: input.deploymentBinding === null ? null : projectDeploymentBinding(input.deploymentBinding),
    snapshot_durability: {
      persisted: input.snapshotDurability.persisted,
      namespace: input.snapshotDurability.namespace,
      storage_version: input.snapshotDurability.storageVersion,
      note: input.snapshotDurability.note,
    },
  };
}

/**
 * Fail-closed view validation (machine-checkable honesty):
 *   - every state within the frozen vocabularies;
 *   - reference mode <=> store_ref marker <=> persisted=false (the
 *     separation rule: reference in-memory state can never claim
 *     production durable persistence);
 *   - PRODUCTION_DURABLE requires a CONNECTED canonical state (no
 *     fabricated durability);
 *   - the provenance matrix covers the storeRef field family.
 * Throws naming the violation — never the matched values.
 */
export function assertValidLiveDataPlaneView(view: unknown): asserts view is LiveDataPlaneView {
  if (typeof view !== 'object' || view === null) {
    throw new Error('a live data-plane view must be an object');
  }
  const record = view as Record<string, unknown>;
  const store = record['store'];
  if (typeof store !== 'object' || store === null) {
    throw new Error('a live data-plane view must carry a store view');
  }
  const storeRecord = store as Record<string, unknown>;
  const mode = storeRecord['mode'];
  const storeRef = storeRecord['store_ref'];
  if (mode === 'PRODUCTION_DURABLE') {
    if (storeRecord['canonical_state'] !== 'CONNECTED') {
      throw new Error('PRODUCTION_DURABLE mode requires a CONNECTED canonical store (never fabricated durability)');
    }
    if (typeof storeRef === 'string' && isReferenceStoreRef(storeRef)) {
      throw new Error('PRODUCTION_DURABLE mode must not carry the reference store marker');
    }
    if (storeRecord['degradation_note'] !== null) {
      throw new Error('PRODUCTION_DURABLE mode must not carry a degradation note');
    }
  } else if (mode === 'REFERENCE_FALLBACK') {
    if (storeRecord['reference_mode'] !== true) {
      throw new Error('REFERENCE_FALLBACK mode must set reference_mode (the explicit separation marker)');
    }
    if (typeof storeRef !== 'string' || !isReferenceStoreRef(storeRef)) {
      throw new Error(
        `REFERENCE_FALLBACK mode requires the ${LIVE_REFERENCE_STORE_PREFIX} store marker (reference state must be clearly distinguishable)`,
      );
    }
    if (storeRecord['canonical_state'] === 'CONNECTED') {
      throw new Error('REFERENCE_FALLBACK mode with a CONNECTED canonical store is a contradiction');
    }
  } else {
    throw new Error(`store mode must be one of ${LIVE_STORE_MODES.join(', ')}`);
  }
  const durability = record['snapshot_durability'];
  if (typeof durability !== 'object' || durability === null) {
    throw new Error('a live data-plane view must carry a snapshot durability view');
  }
  const durabilityRecord = durability as Record<string, unknown>;
  if (mode === 'REFERENCE_FALLBACK' && durabilityRecord['persisted'] === true) {
    throw new Error('reference in-memory state must never claim production durable persistence');
  }
  const providers = record['providers'];
  if (!Array.isArray(providers)) {
    throw new Error('a live data-plane view must carry provider rows');
  }
  for (const row of providers) {
    if (typeof row !== 'object' || row === null || !isLiveHonestState((row as Record<string, unknown>)['state'])) {
      throw new Error('every provider row must carry an honest state (CONNECTED/UNKNOWN/UNAVAILABLE/DEGRADED)');
    }
  }
  const provenance = record['provenance'];
  if (!Array.isArray(provenance) || provenance.length === 0) {
    throw new Error('a live data-plane view must carry a non-empty provenance matrix');
  }
  for (const entry of provenance) {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error('every provenance entry must be an object');
    }
    const entryRecord = entry as Record<string, unknown>;
    if (!isLiveHonestState(entryRecord['state'])) {
      throw new Error(`the provenance entry for ${JSON.stringify(entryRecord['field'])} must carry an honest state`);
    }
  }
  if (!provenance.some((entry) => typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>)['field'] === 'storeRef')) {
    throw new Error('the provenance matrix must cover the storeRef field family');
  }
}

/** Predicate form of assertValidLiveDataPlaneView. */
export function isValidLiveDataPlaneView(value: unknown): value is LiveDataPlaneView {
  try {
    assertValidLiveDataPlaneView(value);
    return true;
  } catch {
    return false;
  }
}
