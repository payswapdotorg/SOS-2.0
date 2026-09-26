/**
 * The DETERMINISTIC suite of the live web-contracts subpackage (Work
 * Order P18-A): pure projections, offline, zero dependencies, fixed
 * seed, run-to-run identical. Pins:
 *
 *   - the authoritative-store projection: PRODUCTION_DURABLE only on a
 *     CONNECTED canonical probe; every other honest state degrades to
 *     the explicit REFERENCE_FALLBACK marker with the real reason;
 *   - the never-canonical rule (the coordination provider is never
 *     selected, the sentence always carried);
 *   - provider rows (deterministic order, serialized field names);
 *   - the per-field provenance matrix (every live-mission DTO field
 *     family covered; reference mode marks store-served fields);
 *   - the deployment/source-SHA binding verdicts (VERIFIED / DIVERGED /
 *     UNAVAILABLE / NO_DEPLOYMENT — never ordering);
 *   - the fail-closed view validator (reference separation is
 *     machine-checked; fabricated durability is rejected);
 *   - determinism: same input -> deep-equal output.
 */

import { describe, expect, it } from 'vitest';
import {
  assertValidLiveDataPlaneView,
  isReferenceStoreRef,
  isValidLiveDataPlaneView,
  LIVE_NEVER_CANONICAL_NOTE,
  projectAuthoritativeStore,
  projectDataPlane,
  projectDeploymentBinding,
  projectProviderRows,
  projectProvenance,
} from '../src/index';
import type { LiveDurableStoreSelectionInput, LiveDataPlaneViewInput } from '../src/index';

const CONNECTED_SELECTION: LiveDurableStoreSelectionInput = {
  canonicalProvider: 'neon',
  canonicalState: 'CONNECTED',
  canonicalStoreRef: 'neon:postgres:sos@main',
  canonicalDetail: 'last real probe at 2026-09-25T12:00:00.000Z answered 200 on /sql',
  canonicalLastError: null,
  canonicalProbedAt: '2026-09-25T12:00:00.000Z',
  coordinationProvider: 'upstash',
  coordinationState: 'CONNECTED',
  coordinationDetail: 'last real probe answered 200 (PONG)',
};

const UNAVAILABLE_SELECTION: LiveDurableStoreSelectionInput = {
  canonicalProvider: 'neon',
  canonicalState: 'UNAVAILABLE',
  canonicalStoreRef: 'neon:postgres:sos@main',
  canonicalDetail: 'last real probe failed at the transport level: getaddrinfo ENOTFOUND ep-example.neon.tech',
  canonicalLastError: 'getaddrinfo ENOTFOUND ep-example.neon.tech (DNS)',
  canonicalProbedAt: '2026-09-25T12:00:00.000Z',
  coordinationProvider: 'upstash',
  coordinationState: 'UNAVAILABLE',
  coordinationDetail: 'last real probe failed at the transport level: NXDOMAIN',
};

function viewInput(store: LiveDurableStoreSelectionInput): LiveDataPlaneViewInput {
  return {
    asOf: '2026-09-25T12:00:00.000Z',
    store,
    providers: [
      { provider: 'vercel', role: 'deployment', state: 'CONNECTED', detail: 'probe answered', credentialEnv: 'VERCEL_TOKEN', apiRevision: 'vercel.v6', lastError: null, probedAt: '2026-09-25T12:00:00.000Z' },
      { provider: 'neon', role: 'durable-canonical-state', state: store.canonicalState, detail: store.canonicalDetail, credentialEnv: 'DATABASE_URL', apiRevision: 'neon.http-sql.v2', lastError: store.canonicalLastError, probedAt: store.canonicalProbedAt },
      { provider: 'upstash', role: 'coordination-only-never-canonical', state: store.coordinationState, detail: store.coordinationDetail, credentialEnv: 'UPSTASH_REDIS_REST_TOKEN', apiRevision: 'upstash.rest.v1', lastError: null, probedAt: store.canonicalProbedAt },
    ],
    provenance: {
      asOf: '2026-09-25T12:00:00.000Z',
      drainedAt: '2026-09-25T12:00:01.000Z',
      store,
      repository: { state: 'CONNECTED', freshness: 'FRESH', producedBy: 'github:rest-events:payswapdotorg/SOS-2.0', revision: '711cfd60b7eb90b338a8ce17cadcafb72a0d1e6e' },
      ci: { state: 'CONNECTED', freshness: 'FRESH', producedBy: 'ci:github-actions:payswapdotorg/SOS-2.0', revision: '9101' },
      deployments: { state: 'CONNECTED', freshness: 'FRESH', producedBy: 'deploy:vercel', revision: 'dpl_example' },
      providerHealth: { state: 'CONNECTED', freshness: 'FRESH', producedBy: 'provider-health:real-probes', revision: null },
      findings: { count: 2, detectedAt: '2026-09-25T12:00:01.000Z' },
      detections: { count: 1, detectedAt: '2026-09-25T12:00:01.000Z' },
      eventsInWindow: { count: 5 },
      deploymentBinding: {
        environment: 'production',
        deploymentId: 'dpl_example',
        sourceRevisionSha: '711cfd60b7eb90b338a8ce17cadcafb72a0d1e6e',
        readyState: 'READY',
        observedRepositoryHead: '711cfd60b7eb90b338a8ce17cadcafb72a0d1e6e',
        providerState: 'CONNECTED',
        url: 'https://example.vercel.app',
        since: '2026-09-25T11:00:00.000Z',
      },
    },
    deploymentBinding: {
      environment: 'production',
      deploymentId: 'dpl_example',
      sourceRevisionSha: '711cfd60b7eb90b338a8ce17cadcafb72a0d1e6e',
      readyState: 'READY',
      observedRepositoryHead: '711cfd60b7eb90b338a8ce17cadcafb72a0d1e6e',
      providerState: 'CONNECTED',
      url: 'https://example.vercel.app',
      since: '2026-09-25T11:00:00.000Z',
    },
    snapshotDurability: {
      persisted: store.canonicalState === 'CONNECTED',
      namespace: store.canonicalState === 'CONNECTED' ? 'live-mission/observation' : null,
      storageVersion: store.canonicalState === 'CONNECTED' ? 1 : null,
      note: store.canonicalState === 'CONNECTED' ? 'snapshot persisted + read back from the canonical store' : 'the canonical store is not CONNECTED — nothing persisted (never fabricated)',
    },
  };
}

describe('the authoritative-store projection', () => {
  it('selects PRODUCTION_DURABLE only on a CONNECTED canonical probe', () => {
    const view = projectAuthoritativeStore(CONNECTED_SELECTION);
    expect(view.mode).toBe('PRODUCTION_DURABLE');
    expect(view.reference_mode).toBe(false);
    expect(view.store_ref).toBe('neon:postgres:sos@main');
    expect(view.degradation_note).toBeNull();
    expect(view.coordination_note).toBe(LIVE_NEVER_CANONICAL_NOTE);
  });

  it('degrades to the explicit REFERENCE_FALLBACK marker with the real reason when the canonical store is UNAVAILABLE', () => {
    const view = projectAuthoritativeStore(UNAVAILABLE_SELECTION);
    expect(view.mode).toBe('REFERENCE_FALLBACK');
    expect(view.reference_mode).toBe(true);
    expect(isReferenceStoreRef(view.store_ref)).toBe(true);
    expect(view.store_ref).toBe('reference:in-memory-observation-store');
    expect(view.degradation_note).toContain('UNAVAILABLE');
    expect(view.degradation_note).toContain('getaddrinfo ENOTFOUND ep-example.neon.tech (DNS)');
    expect(view.degradation_note).toContain('explicitly NOT production durable state');
  });

  it('treats UNKNOWN and DEGRADED canonical stores as reference mode too (only CONNECTED is production durable)', () => {
    for (const state of ['UNKNOWN', 'DEGRADED'] as const) {
      const view = projectAuthoritativeStore({ ...CONNECTED_SELECTION, canonicalState: state });
      expect(view.mode).toBe('REFERENCE_FALLBACK');
      expect(isReferenceStoreRef(view.store_ref)).toBe(true);
    }
  });

  it('always carries the never-canonical sentence for the coordination provider', () => {
    for (const selection of [CONNECTED_SELECTION, UNAVAILABLE_SELECTION]) {
      const view = projectAuthoritativeStore(selection);
      expect(view.coordination_note).toContain('coordination only');
      expect(view.coordination_note).toContain('never the canonical store');
      expect(view.coordination_provider).toBe('upstash');
    }
  });
});

describe('the provider rows', () => {
  it('serialize field names and sort deterministically by provider id', () => {
    const rows = projectProviderRows([
      { provider: 'vercel', role: 'deployment', state: 'CONNECTED', detail: 'd', credentialEnv: 'VERCEL_TOKEN', apiRevision: 'vercel.v6', lastError: null, probedAt: null },
      { provider: 'neon', role: 'durable-canonical-state', state: 'UNKNOWN', detail: 'd', credentialEnv: null, apiRevision: null, lastError: null, probedAt: null },
    ]);
    expect(rows.map((row) => row.provider)).toEqual(['neon', 'vercel']);
    expect(rows[0]).toMatchObject({ credential_env: null, api_revision: null, probed_at: null });
    expect(JSON.parse(JSON.stringify(rows[1])).credential_env).toBe('VERCEL_TOKEN');
  });
});

describe('the deployment/source-SHA binding projection', () => {
  const head = '711cfd60b7eb90b338a8ce17cadcafb72a0d1e6e';
  const other = 'b5938ea4654144df287ce3e907389fc1f911ccf6';

  it('VERIFIED: the deployed source_revision_sha equals the observed head', () => {
    const view = projectDeploymentBinding({ environment: 'production', deploymentId: 'dpl_1', sourceRevisionSha: head, readyState: 'READY', observedRepositoryHead: head, providerState: 'CONNECTED', url: null, since: null });
    expect(view.verdict).toBe('VERIFIED');
    expect(view.source_revision_sha).toBe(head);
  });

  it('DIVERGED: difference only — ordering of shas is never claimed', () => {
    const view = projectDeploymentBinding({ environment: 'production', deploymentId: 'dpl_1', sourceRevisionSha: other, readyState: 'READY', observedRepositoryHead: head, providerState: 'CONNECTED', url: null, since: null });
    expect(view.verdict).toBe('DIVERGED');
    expect(view.note).toContain('difference only, ordering is never claimed');
    expect(view.note).not.toContain('newer');
    expect(view.note).not.toContain('older');
  });

  it('UNAVAILABLE: no binding is claimed when the provider read did not answer', () => {
    const view = projectDeploymentBinding({ environment: 'production', deploymentId: null, sourceRevisionSha: null, readyState: null, observedRepositoryHead: head, providerState: 'UNAVAILABLE', url: null, since: null });
    expect(view.verdict).toBe('UNAVAILABLE');
    expect(view.note).toContain('never fabricated');
  });

  it('NO_DEPLOYMENT: an answered provider with no sha-bound deployment, or no observed head', () => {
    const noDeployment = projectDeploymentBinding({ environment: 'production', deploymentId: null, sourceRevisionSha: null, readyState: null, observedRepositoryHead: head, providerState: 'CONNECTED', url: null, since: null });
    expect(noDeployment.verdict).toBe('NO_DEPLOYMENT');
    const noHead = projectDeploymentBinding({ environment: 'production', deploymentId: 'dpl_1', sourceRevisionSha: head, readyState: 'READY', observedRepositoryHead: null, providerState: 'CONNECTED', url: null, since: null });
    expect(noHead.verdict).toBe('NO_DEPLOYMENT');
    expect(noHead.note).toContain('no comparison is claimed');
  });
});

describe('the per-field provenance matrix', () => {
  it('covers every live-mission DTO field family', () => {
    const entries = projectProvenance(viewInput(CONNECTED_SELECTION).provenance);
    const fields = entries.map((entry) => entry.field);
    for (const expected of [
      'storeRef',
      'asOf',
      'drainedAt',
      'sources',
      'eventsInWindow',
      'repository.branchHeads',
      'repository.openPullRequests',
      'ci.latestByPipeline',
      'deployments.byEnvironment',
      'providerHealth',
      'findings',
      'detections',
      'deployments.sourceRevisionShaBinding',
    ]) {
      expect(fields).toContain(expected);
    }
  });

  it('marks store-served fields DURABLE_CANONICAL when the canonical store is CONNECTED', () => {
    const storeRefEntry = projectProvenance(viewInput(CONNECTED_SELECTION).provenance).find((entry) => entry.field === 'storeRef');
    expect(storeRefEntry?.store_kind).toBe('DURABLE_CANONICAL');
    expect(storeRefEntry?.state).toBe('CONNECTED');
    expect(storeRefEntry?.revision).toBe('neon:postgres:sos@main');
  });

  it('marks store-served fields REFERENCE_IN_MEMORY with the real reason in reference mode', () => {
    const storeRefEntry = projectProvenance(viewInput(UNAVAILABLE_SELECTION).provenance).find((entry) => entry.field === 'storeRef');
    expect(storeRefEntry?.store_kind).toBe('REFERENCE_IN_MEMORY');
    expect(storeRefEntry?.state).toBe('UNAVAILABLE');
    expect(storeRefEntry?.revision).toBe('reference:in-memory-observation-store');
    expect(storeRefEntry?.note).toContain('getaddrinfo ENOTFOUND ep-example.neon.tech (DNS)');
    expect(storeRefEntry?.note).toContain('explicitly NOT production durable state');
  });

  it('carries freshness per observation field (STALE/NO_DATA never fold into success notes)', () => {
    const input = viewInput(CONNECTED_SELECTION).provenance;
    const stale = projectProvenance({ ...input, repository: { ...input.repository, freshness: 'STALE' } });
    expect(stale.find((entry) => entry.field === 'repository.branchHeads')?.note).toContain('STALE: older than the freshness window');
    const noData = projectProvenance({ ...input, ci: { ...input.ci, freshness: 'NO_DATA' } });
    expect(noData.find((entry) => entry.field === 'ci.latestByPipeline')?.note).toContain('NO_DATA: absence of observation is never success');
  });
});

describe('the aggregate data-plane view + the fail-closed validator', () => {
  it('projects and validates the production-durable view', () => {
    const view = projectDataPlane(viewInput(CONNECTED_SELECTION));
    assertValidLiveDataPlaneView(view);
    expect(view.store.mode).toBe('PRODUCTION_DURABLE');
    expect(view.snapshot_durability.persisted).toBe(true);
    expect(view.snapshot_durability.storage_version).toBe(1);
    expect(view.deployment_binding?.verdict).toBe('VERIFIED');
    expect(JSON.parse(JSON.stringify(view)).store.store_ref).toBe('neon:postgres:sos@main');
  });

  it('projects and validates the reference-fallback view (explicit separation)', () => {
    const view = projectDataPlane(viewInput(UNAVAILABLE_SELECTION));
    assertValidLiveDataPlaneView(view);
    expect(view.store.mode).toBe('REFERENCE_FALLBACK');
    expect(view.store.degradation_note).toContain('getaddrinfo ENOTFOUND');
    expect(view.snapshot_durability.persisted).toBe(false);
    expect(view.snapshot_durability.storage_version).toBeNull();
  });

  it('rejects fabricated durability (reference mode claiming persistence)', () => {
    const view = projectDataPlane(viewInput(UNAVAILABLE_SELECTION));
    const fabricated = { ...view, snapshot_durability: { ...view.snapshot_durability, persisted: true } };
    expect(() => assertValidLiveDataPlaneView(fabricated)).toThrow(/must never claim production durable persistence/);
    expect(isValidLiveDataPlaneView(fabricated)).toBe(false);
  });

  it('rejects a production-durable mode without a CONNECTED canonical store', () => {
    const view = projectDataPlane(viewInput(UNAVAILABLE_SELECTION));
    const fabricated = { ...view, store: { ...view.store, mode: 'PRODUCTION_DURABLE' as const, reference_mode: false, degradation_note: null } };
    expect(() => assertValidLiveDataPlaneView(fabricated)).toThrow(/PRODUCTION_DURABLE mode requires a CONNECTED canonical store/);
  });

  it('rejects a reference mode without the reference store marker', () => {
    const view = projectDataPlane(viewInput(UNAVAILABLE_SELECTION));
    const fabricated = { ...view, store: { ...view.store, store_ref: 'neon:postgres:sos@main' } };
    expect(() => assertValidLiveDataPlaneView(fabricated)).toThrow(/reference:.*store marker/);
  });

  it('is deterministic: same input -> deep-equal output', () => {
    expect(projectDataPlane(viewInput(CONNECTED_SELECTION))).toEqual(projectDataPlane(viewInput(CONNECTED_SELECTION)));
    expect(projectProvenance(viewInput(UNAVAILABLE_SELECTION).provenance)).toEqual(projectProvenance(viewInput(UNAVAILABLE_SELECTION).provenance));
  });
});
