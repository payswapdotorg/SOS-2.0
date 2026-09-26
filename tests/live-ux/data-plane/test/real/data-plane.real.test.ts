/**
 * P18-A REAL-PROVIDER INTEGRATION SUITE (RUN_REAL=1 only, default OFF).
 *
 * The live data plane against the REAL providers — the same module the
 * app seam calls (produceLiveMissionData over the real defaults:
 * ambient env, system clock, global fetch), reading credentials from
 * the ENVIRONMENT at the test process boundary (P3 typed-registry
 * names; values never echoed, transcripts redacted through all three
 * lane corpora — fail-closed).
 *
 * HONEST OUTCOMES: every record written by this suite states what
 * actually happened:
 *   - GitHub observation (repo events + CI runs + the repo-head probe)
 *     is expected to be CONNECTED with the PAT;
 *   - the Vercel deployment-state read is expected to be CONNECTED
 *     (records + the EXACT source_revision_sha of the sos-2-0 project's
 *     deployments);
 *   - R2 connectivity is probed (HeadBucket through the SigV4 client);
 *   - Neon (api.neon.tech / the pooled endpoint) and Upstash are probed
 *     and their honest UNAVAILABLE outcomes — the real DNS facts — are
 *     recorded as VALID evidence (never a silent skip, never a
 *     fabricated CONNECTED);
 *   - the drain, the durable-store selection, the deployment binding
 *     and the per-field provenance are recorded for the evidence
 *     package (docs/evidence/production-connectivity/live-ux/data-plane).
 */

import { execFileSync } from 'node:child_process';
import { lookup as dnsLookupCallback } from 'node:dns';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ManualClock } from '@sos-2/live-store';
import { createLiveDataPlaneHarness } from '@sos-2/infra-production-connectivity';
import type { ProviderHealthSnapshotRow } from '@sos-2/infra-production-connectivity';
import { NeonAdminClient, bindGlobalFetch } from '@sos-2/real-persistence';
import { SystemClock, produceLiveMissionData } from '@live-data/producer';
import { repoHeadSha, writeEvidence } from '../../src/evidence';

const dnsLookup = promisify(dnsLookupCallback);

const producedAt = new Date().toISOString();

function ambientSource(): Record<string, string> {
  const source: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      source[key] = value;
    }
  }
  return source;
}

/** The honest state of one provider row (or the honest absence of the row). */
function rowState(rows: readonly ProviderHealthSnapshotRow[], provider: string): string {
  return rows.find((row) => row.provider === provider)?.state ?? 'ABSENT';
}

describe('the live data plane against the REAL providers (RUN_REAL)', () => {
  it('runs the real producer pass (drain + selection + deployment read) and records everything honestly', async () => {
    const head = repoHeadSha();
    const result = await produceLiveMissionData({
      source: ambientSource(),
      clock: new SystemClock(),
      fetch: bindGlobalFetch({ timeoutMs: 30_000 }),
    });

    // --- the honest per-provider states (whatever they truly are) ---
    const rows = result.providerHealth;
    const githubEvents = result.data.sources.find((source) => source.source.startsWith('github:rest-events'));
    const githubCi = result.data.sources.find((source) => source.source.startsWith('ci:github-actions'));
    const vercelSource = result.data.sources.find((source) => source.source === 'deploy:vercel');

    // --- the durable-store selection record ---
    writeEvidence('provider-states.json', {
      work_order: 'P18-A',
      evidence_kind: 'provider-states',
      produced_at: producedAt,
      repo_head: head,
      durable_store_selection: {
        mode: result.selection.mode,
        canonical: {
          provider: result.selection.canonical.provider,
          state: result.selection.canonical.state,
          detail: result.selection.canonical.detail,
          last_error: result.selection.canonical.lastError,
          probed_at: result.selection.canonical.probedAt,
          api_revision: result.selection.canonical.apiRevision,
          credential_env: result.selection.canonical.credentialEnvName,
          store_ref: result.selection.canonicalStoreRef,
        },
        coordination: {
          provider: result.selection.coordination.provider,
          state: result.selection.coordination.state,
          detail: result.selection.coordination.detail,
          last_error: result.selection.coordination.lastError,
          never_canonical_note: result.selection.coordination.neverCanonicalNote,
        },
        store_ref: result.selection.storeRef,
        note: result.selection.note,
      },
      provider_rows: rows.map((row) => ({
        provider: row.provider,
        role: row.role,
        state: row.state,
        detail: row.detail,
        credential_env: row.credentialEnvName,
        api_revision: row.apiRevision,
        last_error: row.lastError,
        probed_at: row.probedAt,
      })),
      observation_sources: result.data.sources.map((source) => ({
        source: source.source,
        family: source.family,
        provider: source.provider,
        state: source.state,
        detail: source.detail,
        last_error: source.lastError,
        last_probed_at: source.lastProbedAt,
        api_revision: source.apiRevision,
      })),
      note:
        'Every state derives from a REAL probe through the injected fetch. Neon (api.neon.tech NODATA) and Upstash (NXDOMAIN) are probed and their honest UNAVAILABLE outcomes are recorded verbatim — never a fabricated CONNECTED; a provider that answered nothing is UNKNOWN.',
    });

    // --- the real drain record (what the plane actually observed) ---
    writeEvidence('real-drain.json', {
      work_order: 'P18-A',
      evidence_kind: 'real-drain',
      produced_at: producedAt,
      repo_head: head,
      drained_at: result.data.drainedAt,
      as_of: result.data.asOf,
      store_ref: result.data.storeRef,
      events_in_window: result.data.eventsInWindow,
      github_events: {
        state: githubEvents?.state ?? 'UNKNOWN',
        last_error: githubEvents?.lastError ?? null,
        api_revision: githubEvents?.apiRevision ?? null,
        observed_branch_heads: result.data.repository.branchHeads.map((branchHead) => ({ branch: branchHead.branch, head: branchHead.head, freshness: branchHead.freshness })),
        observed_head_matches_repo_head: result.data.repository.branchHeads.some((branchHead) => branchHead.branch === 'main' && branchHead.head === head),
        open_pull_requests: result.data.repository.openPullRequests.map((pull) => pull.number),
        freshness: result.data.repository.freshness,
      },
      ci: {
        state: githubCi?.state ?? 'UNKNOWN',
        last_error: githubCi?.lastError ?? null,
        latest_by_pipeline: result.data.ci.latestByPipeline.map((run) => ({ pipeline: run.pipeline, runId: run.runId, ref: run.ref, status: run.status, occurredAt: run.occurredAt })),
        freshness: result.data.ci.freshness,
      },
      deployment_observation: {
        state: vercelSource?.state ?? 'UNKNOWN',
        last_error: vercelSource?.lastError ?? null,
        by_environment: result.data.deployments.byEnvironment,
        freshness: result.data.deployments.freshness,
      },
      deployment_read: {
        state: result.deploymentRead.state,
        last_error: result.deploymentRead.lastError,
        api_revision: result.deploymentRead.apiRevision,
        record_count: result.deploymentRead.deployments.length,
        records: result.deploymentRead.deployments.map((record) => ({
          id: record.id,
          target: record.target,
          ready_state: record.readyState,
          source_revision_sha: record.commitSha,
          commit_ref: record.commitRef,
          url: record.url,
          created_at: record.createdAt,
          region: record.region,
          project_id: record.projectId,
        })),
      },
      findings: result.data.findings.map((finding) => ({ subject: finding.subject, kind: finding.kind, claimedRevision: finding.claimedRevision, observedRevision: finding.observedRevision })),
      detections: result.data.detections.map((detection) => ({ code: detection.code, subject: detection.subject, message: detection.message })),
      snapshot_durability: result.durability,
      note: 'The REAL observation drain (GitHub REST + GitHub Actions + Vercel deployments + telemetry + provider-health probes) through the live data plane. Statuses are carried verbatim from the providers; freshness is evaluated against the real clock.',
    });

    // --- the producer provenance record (every DTO field) ---
    writeEvidence('producer-provenance.json', {
      work_order: 'P18-A',
      evidence_kind: 'producer-provenance',
      produced_at: producedAt,
      repo_head: head,
      as_of: result.view.as_of,
      store: result.view.store,
      snapshot_durability: result.view.snapshot_durability,
      deployment_binding: result.view.deployment_binding,
      provenance: result.view.provenance,
      note:
        'For every field the live-mission DTO carries: which store/plane produced it, at which revision, with which honest state. Reference mode (a non-CONNECTED canonical store) is marked on every store-served field — reference in-memory state never masquerades as production durable state.',
    });

    // --- honest structural expectations (never provider-specific outcomes) ---
    // The GitHub sources must have been PROBED this run (a state, whatever it is)
    expect(githubEvents !== undefined || result.unwired).toBe(true);
    if (!result.unwired) {
      expect(['CONNECTED', 'UNKNOWN', 'UNAVAILABLE', 'DEGRADED']).toContain(githubEvents?.state);
      expect(result.data.drainedAt).not.toBeNull();
    }
    // The selection is honest either way: production durable ONLY on a connected canonical probe
    if (result.selection.canonical.state !== 'CONNECTED') {
      expect(result.selection.mode).toBe('REFERENCE_FALLBACK');
      expect(result.data.storeRef.startsWith('reference:')).toBe(true);
      expect(result.durability.persisted).toBe(false);
    } else {
      expect(result.selection.mode).toBe('PRODUCTION_DURABLE');
    }
  });

  it('probes the REAL Neon management API with the NEON_API_KEY (the honest provisioning path — the P17-A journey precedent)', async () => {
    const source = ambientSource();
    const apiKey = source['NEON_API_KEY'] ?? null;
    // The P3/persistence resolution semantics: an absent OR EMPTY value is NOT configured.
    const databaseUrl = source['DATABASE_URL'] !== undefined && source['DATABASE_URL'] !== '' ? source['DATABASE_URL'] : null;
    const fetch = bindGlobalFetch({ timeoutMs: 30_000 });
    let managementState = 'UNKNOWN';
    let managementError: string | null = null;
    let whoami: { login: string } | null = null;
    if (apiKey !== null) {
      const admin = new NeonAdminClient({ apiKey, fetch });
      try {
        const me = await admin.whoami();
        whoami = { login: me.login };
        managementState = 'CONNECTED';
      } catch (error) {
        managementState = 'UNAVAILABLE';
        managementError = error instanceof Error ? error.message : String(error);
      }
    }
    // The EXACT DNS facts (the dispatch requirement): public recursive
    // resolution of the Neon management host and the Upstash REST host.
    const dnsFacts: Record<string, { resolved: boolean; addresses: string[]; error: string | null }> = {};
    for (const host of ['api.neon.tech', 'meet-ewe-145933.upstash.io']) {
      try {
        const addresses = await dnsLookup(host, { all: true });
        dnsFacts[host] = { resolved: true, addresses: addresses.map((entry) => entry.address), error: null };
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
        dnsFacts[host] = { resolved: false, addresses: [], error: `${code}: ${error instanceof Error ? error.message : String(error)}`.trim() };
      }
    }
    writeEvidence('neon-management-probe.json', {
      work_order: 'P18-A',
      evidence_kind: 'neon-management-probe',
      produced_at: producedAt,
      repo_head: repoHeadSha(),
      credential_env: 'NEON_API_KEY',
      database_url_env: 'DATABASE_URL',
      database_url_configured: databaseUrl !== null,
      management_probe: {
        endpoint: 'GET https://api.neon.tech/api/v2/users/me',
        state: managementState,
        real_error: managementError,
        whoami: whoami === null ? null : { login: whoami.login },
        api_revision: managementState === 'CONNECTED' ? 'neon.api.v2' : null,
      },
      dns_facts: dnsFacts,
      note:
        databaseUrl === null
          ? `no DATABASE_URL configured (the durable adapter stays honestly unattached — UNKNOWN, never fabricated); the management probe is ${managementState}` +
            (managementError !== null ? ` with the REAL failure: ${managementError}` : '') +
            ' — provisioning cannot proceed this run (the exact P17-A honest record)'
          : 'DATABASE_URL configured — the durable adapter probe outcome is in provider-states.json',
    });
    // The honest structural expectation: a failed probe is UNAVAILABLE, never CONNECTED
    if (managementState === 'UNAVAILABLE') {
      expect(managementError).not.toBeNull();
    }
  });

  it('probes R2 connectivity through the frozen P17-A adapter (honest state recorded)', async () => {
    const harness = createLiveDataPlaneHarness({
      source: ambientSource(),
      tier: 'production',
      clock: new ManualClock(Date.now()),
      fetch: bindGlobalFetch({ timeoutMs: 30_000 }),
    });
    const outcomes = await harness.connectivity.startupProbes();
    const r2 = outcomes.find((outcome) => outcome.provider === 'r2');
    const vercel = outcomes.find((outcome) => outcome.provider === 'vercel');
    expect(r2?.probed).toBe(true);
    expect(vercel?.probed).toBe(true);
    writeEvidence('r2-connectivity.json', {
      work_order: 'P18-A',
      evidence_kind: 'r2-connectivity',
      produced_at: producedAt,
      repo_head: repoHeadSha(),
      startup_probes: outcomes.map((outcome) => ({ provider: outcome.provider, attached: outcome.attached, probed: outcome.probed, ok: outcome.ok })),
      provider_rows: harness.providerHealthSnapshot().map((row) => ({ provider: row.provider, role: row.role, state: row.state, detail: row.detail, api_revision: row.apiRevision, last_error: row.lastError })),
      note: 'The frozen P17-A startup probes through the real adapters: Neon SQL ping, Upstash PING, R2 HeadBucket (SigV4), Vercel /v2/user. Honest outcomes — an unreachable provider is recorded UNAVAILABLE with the real transport fact.',
    });
  });

  it('discovers the Vercel org id through the authenticated user probe (recorded for the topology)', async () => {
    const harness = createLiveDataPlaneHarness({
      source: ambientSource(),
      tier: 'production',
      clock: new ManualClock(Date.now()),
      fetch: bindGlobalFetch({ timeoutMs: 30_000 }),
    });
    const orgId = await harness.discoverVercelOrgId();
    const vercelState = rowState(harness.providerHealthSnapshot(), 'vercel');
    writeEvidence('vercel-org.json', {
      work_order: 'P18-A',
      evidence_kind: 'vercel-org-discovery',
      produced_at: producedAt,
      repo_head: repoHeadSha(),
      discovered_org_id: orgId,
      provider_state_after_probe: vercelState,
      note:
        orgId === null
          ? 'the /v2/user probe did not answer — no org id discovered (honest null, never guessed)'
          : 'the org/team id discovered through the authenticated GET /v2/user probe (defaultTeamId) — the VERCEL_ORG_ID topology record',
    });
    if (orgId === null) {
      expect(vercelState).not.toBe('CONNECTED');
    }
  });
});
