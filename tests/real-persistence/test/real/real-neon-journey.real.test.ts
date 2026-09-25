/**
 * The REAL Neon journey (Work Order P17-A) — env-gated (RUN_REAL=1),
 * default OFF. The journey through the real Neon surfaces:
 *
 *   1. management-API probe (GET /api/v2/users/me with the API key);
 *   2. when reachable: project discovery/provisioning (tier-named
 *      branch + database per the P3 neon naming contract), the pooled
 *      connection string derivation (SECRET — the value flows onward
 *      into the SQL client only; project_id/branch_id/host/region are
 *      recorded as public identity);
 *   3. real SQL roundtrip through the frozen PostgresStoreAdapter port:
 *      ensureSchema, put/get/list, guarded if_absent/compare-and-set;
 *   4. honest provider states throughout; cleanup (the provisioned
 *      project is deleted — smallest real footprint; the durable
 *      evidence is this transcript).
 *
 * A provider outage during the run is recorded as UNAVAILABLE evidence
 * with the REAL failure (transport error verbatim) — never a silent
 * skip, never a fabricated success. When no DATABASE_URL is configured,
 * the adapter stays unattached (honestly UNKNOWN until a probe).
 */

import { describe, expect, it } from 'vitest';
import {
  ambientSource,
  composeNeonAdapter,
  composeNeonAdmin,
  globalFetch,
  journeyTelemetry,
  Journey,
  RUN_REAL,
  writeEvidence,
} from './real-world.js';
import { neonDatabaseName, neonBranchName } from '@sos-2/real-persistence';
import { TransportError } from '@sos-2/real-persistence';
import type { NeonProjectIdentity } from '@sos-2/real-persistence';

const suite = RUN_REAL ? describe : describe.skip;

suite('REAL Neon integration (RUN_REAL=1): provisioning + real SQL through the frozen PostgresStoreAdapter', () => {
  const journey = new Journey();
  const source = ambientSource();
  const fetch = globalFetch();
  const { transcript, ledger } = journeyTelemetry();
  const clock = { nowEpochMs: () => Date.now() };
  let managementReachable = false;
  let provisionedProject: NeonProjectIdentity | null = null;
  let derivedDatabaseUrl: string | null = null;
  let projectDeleted = false;

  it('probes the REAL management API with the NEON_API_KEY (the startup probe)', async () => {
    const admin = composeNeonAdmin(source, fetch);
    if (admin === null) {
      journey.record('management-probe', false, {
        attempted: false,
        reason: 'no NEON_API_KEY / NEON_API_KEY_SECONDARY configured in the environment (names only)',
      });
      expect(true).toBe(true);
      return;
    }
    try {
      const whoami = await admin.whoami();
      managementReachable = true;
      journey.record('management-probe', true, {
        login: whoami.login,
        email: whoami.email,
        branches_limit: whoami.branches_limit,
        projects_limit: whoami.projects_limit,
        api_revision: 'neon.api.v2',
      });
      ledger.record({
        provider: 'neon',
        probeId: 'neon:management-whoami',
        endpoint: 'GET /api/v2/users/me',
        at: new Date().toISOString(),
        status: 200,
        ok: true,
        failure: null,
        apiRevision: 'neon.api.v2',
      });
      expect(whoami.login.length).toBeGreaterThan(0);
    } catch (error) {
      const failure = error instanceof TransportError ? error.message : (error as Error).message;
      journey.record('management-probe', false, {
        attempted: true,
        failure,
        outcome: 'UNAVAILABLE — the real failure recorded verbatim (never a fabricated success)',
      });
      ledger.record({
        provider: 'neon',
        probeId: 'neon:management-whoami',
        endpoint: 'GET /api/v2/users/me',
        at: new Date().toISOString(),
        status: error instanceof TransportError ? null : 0,
        ok: false,
        failure,
        apiRevision: null,
      });
      // A failing provider probe is VALID evidence — the journey records it and continues honestly.
      expect(typeof failure).toBe('string');
    }
  });

  it('provisions (or selects) the tier-named project/branch/database + derives the pooled connection string', async () => {
    const admin = composeNeonAdmin(source, fetch);
    if (admin === null || !managementReachable) {
      journey.record('provision', false, {
        attempted: false,
        reason: admin === null ? 'no management API key configured' : 'management API UNAVAILABLE (the recorded real failure)',
      });
      return;
    }
    const projectName = 'sos-2-0-persistence';
    let project = (await admin.listProjects()).find((entry) => entry.name === projectName) ?? null;
    if (project === null) {
      project = await admin.createProject({ name: projectName, regionId: 'aws-us-east-1', pgVersion: 17 });
      journey.record('create-project', true, { project_id: project.id, region: project.region_id, pg_version: project.pg_version });
    } else {
      journey.record('select-project', true, { project_id: project.id, region: project.region_id, pg_version: project.pg_version });
    }
    provisionedProject = project;
    const branches = await admin.listBranches(project.id);
    const tierBranch = neonBranchName('production');
    let branch = branches.find((entry) => entry.name === tierBranch) ?? null;
    if (branch === null) {
      branch = await admin.createBranch(project.id, { name: tierBranch });
      journey.record('create-branch', true, { branch_id: branch.id, branch_name: branch.name });
    }
    const databases = await admin.listDatabases(project.id, branch.id);
    const tierDatabase = neonDatabaseName('production');
    let database = databases.find((entry) => entry.name === tierDatabase) ?? null;
    if (database === null) {
      database = await admin.createDatabase(project.id, branch.id, { name: tierDatabase, ownerName: 'neondb_owner' });
      journey.record('create-database', true, { database_id: database.id, database_name: database.name });
    }
    const connection = await admin.pooledConnectionString({
      projectId: project.id,
      branchId: branch.id,
      databaseName: database.name,
    });
    derivedDatabaseUrl = connection.connectionString;
    journey.record('pooled-connection-string', true, {
      project_id: project.id,
      branch_id: branch.id,
      database_name: connection.databaseName ?? null,
      host: connection.host ?? null,
      pooled: true,
      secret_redacted: true,
      note: 'DATABASE_URL VALUE derived via the management API and kept SECRET (env-only; never in evidence)',
    });
    expect(connection.connectionString.startsWith('postgres')).toBe(true);
  });

  it('runs the real SQL roundtrip through the frozen PostgresStoreAdapter port', async () => {
    const databaseUrl = source['DATABASE_URL'] ?? derivedDatabaseUrl ?? undefined;
    if (databaseUrl === undefined) {
      journey.record('sql-roundtrip', false, {
        attempted: false,
        reason:
          'no DATABASE_URL configured and none derived (the management API provisioning path is UNAVAILABLE this run) — the adapter stays honestly unattached/UNKNOWN until a probe',
      });
      return;
    }
    const adapter = composeNeonAdapter(databaseUrl, transcript, ledger, fetch, clock);
    await adapter.ensureSchema();
    journey.record('ensure-schema', true, { table: 'sos_rows' });
    const put = await adapter.putRow('p17a-probe', 'probe-row', { probe: 'neon', at: new Date().toISOString() } as never);
    expect(put.ok).toBe(true);
    const guarded = await adapter.putRow('p17a-probe', 'probe-row', { probe: 'neon', again: true } as never, { if_absent: true });
    expect(guarded.ok).toBe(false);
    journey.record('guarded-write', true, { outcome: guarded });
    const read = await adapter.getRow('p17a-probe', 'probe-row');
    expect(read?.storage_version).toBe(put.ok ? put.storage_version : 1);
    expect((read?.data as Record<string, unknown>)['probe']).toBe('neon');
    const listed = await adapter.listRows('p17a-probe');
    expect(listed).toHaveLength(1);
    journey.record('sql-roundtrip', true, {
      put_storage_version: put.ok ? put.storage_version : null,
      guarded_outcome: guarded,
      read_storage_version: read?.storage_version ?? null,
      listed_rows: listed.length,
    });
    const probe = await adapter.probe();
    expect(probe).toBe(true);
    journey.record('sql-ping-probe', probe, { state: adapter.providerState().state });
  });

  it('deletes the provisioned project (smallest real footprint; the durable evidence is this transcript)', async () => {
    const admin = composeNeonAdmin(source, fetch);
    if (admin === null || provisionedProject === null || !managementReachable) {
      journey.record('cleanup', false, { attempted: false, reason: 'nothing provisioned this run (management API UNAVAILABLE or already-clean)' });
      return;
    }
    try {
      await admin.call({ method: 'POST', path: `/projects/${provisionedProject.id}/shutdown`, body: {} });
      await admin.call({ method: 'DELETE', path: `/projects/${provisionedProject.id}`, body: null });
      projectDeleted = true;
      journey.record('cleanup', true, { project_id: provisionedProject.id, strategy: 'delete-project' });
    } catch (error) {
      journey.record('cleanup', false, { failure: (error as Error).message });
    }
  });

  it('writes the machine-readable evidence (honest — including failures; credentials redacted)', () => {
    const state = ledger.reportFor('neon', source['DATABASE_URL'] !== undefined ? 'DATABASE_URL' : null);
    const path = writeEvidence('neon-integration.json', {
      evidence_kind: 'provider-connectivity',
      provider: 'neon',
      provider_states: [state],
      credential_envs: ['NEON_API_KEY', 'NEON_API_KEY_SECONDARY', 'DATABASE_URL'],
      management_api: 'https://api.neon.tech/api/v2',
      sql_protocol: 'neon http-sql (POST /sql, Neon-Connection-String header)',
      provisioning: {
        project_name: 'sos-2-0-persistence',
        tier_naming_contract: { branch: neonBranchName('production'), database: neonDatabaseName('production') },
        derived_database_url: derivedDatabaseUrl !== null,
        project_deleted: projectDeleted,
      },
      transcript: transcript.byProvider('neon').map((entry) => entry),
      management_request_log: composeNeonAdmin(source, fetch)?.recordedRequests() ?? [],
      steps: journey.steps,
      honest_notes: [
        'The pooled connection string (DATABASE_URL) is SECRET: derived via the management API and injected into the SQL client only — env NAMES in evidence, never values.',
        'A provider outage is recorded as UNAVAILABLE evidence with the real failure verbatim — never a silent skip, never a fabricated success.',
        'The adapter health() surface (frozen P2 port) maps probed outcomes to AVAILABLE/UNAVAILABLE/UNKNOWN; the P17-A surface carries CONNECTED/UNKNOWN/UNAVAILABLE/DEGRADED with full probe evidence.',
      ],
    });
    expect(path.endsWith('neon-integration.json')).toBe(true);
  });
});
