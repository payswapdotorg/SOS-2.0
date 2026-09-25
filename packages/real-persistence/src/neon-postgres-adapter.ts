/**
 * The REAL Neon Postgres adapter (Work Order P17-A) — the vendor-backed
 * realization of the frozen P2 PostgresStoreAdapter port over the Neon
 * HTTPS SQL proxy (neon-http.ts). This is the DURABLE CANONICAL STORE:
 * every semantic row lives here and ONLY here.
 *
 * Rows are canonical-JSON documents keyed by (namespace, id) in one
 * Postgres table:
 *
 *   CREATE TABLE IF NOT EXISTS sos_rows (
 *     namespace       TEXT NOT NULL,
 *     id              TEXT NOT NULL,
 *     data            JSONB NOT NULL,
 *     storage_version BIGINT NOT NULL,
 *     PRIMARY KEY (namespace, id)
 *   )
 *
 * Write semantics mirror the in-memory reference EXACTLY (the semantics
 * a real Neon adapter realizes with `INSERT ... ON CONFLICT` /
 * `UPDATE ... WHERE version = $x` — the port's own words):
 *   - unguarded putRow: upsert, storage_version increments;
 *   - if_absent: INSERT ... ON CONFLICT DO NOTHING; no row returned =>
 *     typed ALREADY_EXISTS with the current version;
 *   - expected_storage_version: guarded compare-and-set UPDATE; no row
 *     returned => typed VERSION_CONFLICT with the current version (0
 *     when the row is absent);
 *   - listRows: all rows of a namespace in their LATEST version, sorted
 *     by id (deterministic) — the canonical truth, no cache.
 *
 * HONESTY: health() (the frozen port surface) reports the
 * AVAILABLE/UNAVAILABLE/UNKNOWN mapping of the P17-A probe state —
 * UNKNOWN before any probe, never fabricated. Provider failures throw
 * the frozen live-store ProviderUnavailableError (typed), which callers
 * surface as typed UNAVAILABLE. The P17-A provider-state surface
 * (providerState()) carries CONNECTED/UNKNOWN/UNAVAILABLE/DEGRADED with
 * the full probe evidence. Every network round-trip goes through the
 * injected FetchPort (typically the transcript-recording wrapper); the
 * adapter itself performs zero ambient network.
 */

import { ProviderUnavailableError } from '@sos-2/live-store';
import type { PostgresStoreAdapter, ProviderHealthRecord, RowPutOptions, RowPutOutcome, StoredRow } from '@sos-2/live-store';
import type { Clock } from '@sos-2/live-store';
import type { JsonValue } from '@sos-2/semantic-spine';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { NeonSqlError, NeonHttpClient } from './neon-http.js';
import type { RecordedNeonSqlRequest } from './neon-http.js';
import { TransportError } from './http.js';
import type { FetchPort } from './http.js';
import type { PersistenceProbeLedger, RealPersistenceProviderStateReport } from './provider-state.js';
import { mapProviderStateToPortAvailability } from './provider-state.js';

/** The default durable-rows table (the P2 row model in one Postgres table). */
export const NEON_ROWS_TABLE_DEFAULT = 'sos_rows';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** Options for the real Neon durable adapter. */
export interface NeonPostgresAdapterOptions {
  /** The pooled connection string VALUE (secret; injected at the composition boundary). */
  readonly connectionString: string;
  /** The injectable network seam (the ONLY network this adapter performs; typically the recording wrapper). */
  readonly fetch: FetchPort;
  /** The injected clock (probe instants; no hidden time). */
  readonly clock: Clock;
  /** The probe ledger (honest provider states from REAL probes only). */
  readonly ledger: PersistenceProbeLedger;
  /** The env NAME the connection string came from (for redacted references in reports). */
  readonly credentialEnv: string | null;
  /** The rows table name (default sos_rows). */
  readonly table?: string;
  /** SQL proxy base URL override (deterministic tests). */
  readonly baseUrl?: string;
}

/**
 * The REAL Neon Postgres store adapter — the durable canonical store
 * behind the frozen P2 port.
 */
export class NeonPostgresStoreAdapter implements PostgresStoreAdapter {
  readonly providerName = 'postgres' as const;
  readonly providerRole = 'durable-canonical-state' as const;
  readonly providerTarget = 'neon-postgres' as const;

  private readonly sql: NeonHttpClient;
  private readonly clock: Clock;
  private readonly ledger: PersistenceProbeLedger;
  private readonly credentialEnv: string | null;
  private readonly table: string;
  private schemaReady = false;

  constructor(options: NeonPostgresAdapterOptions) {
    this.sql = new NeonHttpClient({
      connectionString: options.connectionString,
      fetch: options.fetch,
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    });
    this.clock = options.clock;
    this.ledger = options.ledger;
    this.credentialEnv = options.credentialEnv;
    const table = options.table ?? NEON_ROWS_TABLE_DEFAULT;
    if (!IDENTIFIER.test(table)) {
      throw new ProviderUnavailableError('postgres', `rows table name '${table}' must be a lowercase postgres identifier`);
    }
    this.table = table;
  }

  /** The env NAME the credential came from (names only — never values). */
  credentialEnvName(): string | null {
    return this.credentialEnv;
  }

  /** The recorded SQL round-trips (method + path + status + command; never credentials). */
  recordedSqlRequests(): readonly RecordedNeonSqlRequest[] {
    return this.sql.recordedRequests();
  }

  /** The honest P17-A provider-state report (probe evidence or the honest unprobed state). */
  providerState(): RealPersistenceProviderStateReport {
    return this.ledger.reportFor('neon', this.credentialEnv);
  }

  /** The frozen port health surface (AVAILABLE/UNAVAILABLE/UNKNOWN — never fabricated). */
  health(): ProviderHealthRecord {
    const state = this.ledger.reportFor('neon', this.credentialEnv);
    const availability = mapProviderStateToPortAvailability(state.state);
    return {
      provider: 'postgres',
      role: this.providerRole,
      status: availability,
      detail:
        state.state === 'UNKNOWN'
          ? 'real Neon adapter attached; not yet probed this run (the honest state is UNKNOWN — never fabricated)'
          : state.state === 'CONNECTED'
            ? `real Neon adapter probed at ${state.probed_at} (canonical durable state; ${state.api_revision ?? 'api revision not reported'})`
            : state.state === 'DEGRADED'
              ? `real Neon adapter probed at ${state.probed_at} and DEGRADED (the provider answered its probe with a limitation: ${state.last_error ?? 'throttled'})`
              : `real Neon adapter probed at ${state.probed_at} and UNAVAILABLE (the real failure: ${state.last_error ?? 'unspecified'})`,
    };
  }

  /**
   * The REAL startup/health probe: a live SQL round-trip
   * (`SELECT 1 AS ping`) through the HTTP SQL proxy. Records a probe
   * entry (honest state). Returns the honest outcome — never throws for
   * a provider failure (the transcript records the failed round-trip
   * when the recording FetchPort wrapper is used).
   */
  async probe(): Promise<boolean> {
    const endpoint = '/sql (SELECT 1 AS ping)';
    try {
      const result = await this.sql.query('SELECT 1 AS ping');
      const ok = result.rows.length === 1 && result.rows[0]!['ping'] === 1;
      this.ledger.record({
        provider: 'neon',
        probeId: 'neon:sql-ping',
        endpoint,
        at: new Date(this.clock.nowEpochMs()).toISOString(),
        status: 200,
        ok,
        failure: ok ? null : 'the SQL proxy answered but the ping shape was unexpected',
        apiRevision: 'neon.http-sql.v1',
      });
      if (ok) {
        this.schemaReady = false;
      }
      return ok;
    } catch (error) {
      const failure =
        error instanceof TransportError
          ? `transport failure: ${error.message}`
          : error instanceof NeonSqlError
            ? `sql failure (HTTP ${String(error.status ?? 0)}): ${error.message}`
            : `unexpected failure: ${(error as Error).message}`;
      this.ledger.record({
        provider: 'neon',
        probeId: 'neon:sql-ping',
        endpoint,
        at: new Date(this.clock.nowEpochMs()).toISOString(),
        status: error instanceof NeonSqlError ? error.status : null,
        ok: false,
        failure,
        apiRevision: null,
      });
      return false;
    }
  }

  /**
   * Ensure the row table exists (idempotent DDL — the provisioning step
   * of the real SQL journey). A provider failure throws the frozen
   * typed ProviderUnavailableError.
   */
  async ensureSchema(): Promise<void> {
    if (this.schemaReady) {
      return;
    }
    await this.guarded('ensure schema', () =>
      this.sql.query(
        `CREATE TABLE IF NOT EXISTS ${this.table} (` +
          'namespace TEXT NOT NULL, ' +
          'id TEXT NOT NULL, ' +
          'data JSONB NOT NULL, ' +
          'storage_version BIGINT NOT NULL, ' +
          'PRIMARY KEY (namespace, id))',
      ),
    );
    this.schemaReady = true;
  }

  async getRow(namespace: string, id: string): Promise<StoredRow | null> {
    this.assertKey(namespace, 'namespace');
    this.assertKey(id, 'row id');
    const rows = await this.guarded('get row', () =>
      this.sql.query(
        `SELECT data::text AS data_text, storage_version FROM ${this.table} WHERE namespace = $1 AND id = $2`,
        [namespace, id],
      ),
    );
    if (rows.rows.length === 0) {
      return null;
    }
    const row = rows.rows[0]!;
    const storageVersion = Number(row['storage_version']);
    if (!Number.isInteger(storageVersion) || storageVersion < 1) {
      throw new ProviderUnavailableError('postgres', `durable row ${namespace}/${id} carries a non-integer storage version — refusing to fabricate`);
    }
    return { data: this.parseRowData(namespace, id, row['data_text']), storage_version: storageVersion };
  }

  async putRow(namespace: string, id: string, data: JsonValue, options?: RowPutOptions): Promise<RowPutOutcome> {
    this.assertKey(namespace, 'namespace');
    this.assertKey(id, 'row id');
    if (data === undefined) {
      throw new ProviderUnavailableError('postgres', 'row data must be a JSON value (undefined is not storable)');
    }
    const serialized = canonicalSerialize(data);
    if (options?.if_absent === true) {
      const inserted = await this.guarded('put row (if_absent)', () =>
        this.sql.query(
          `INSERT INTO ${this.table} (namespace, id, data, storage_version) VALUES ($1, $2, $3::jsonb, 1) ` +
            `ON CONFLICT (namespace, id) DO NOTHING RETURNING storage_version`,
          [namespace, id, serialized],
        ),
      );
      if (inserted.rows.length > 0) {
        return { ok: true, storage_version: Number(inserted.rows[0]!['storage_version']) };
      }
      const current = await this.currentVersion(namespace, id);
      return { ok: false, kind: 'ALREADY_EXISTS', current_storage_version: current };
    }
    if (options?.expected_storage_version !== undefined) {
      const expected = options.expected_storage_version;
      const updated = await this.guarded('put row (compare-and-set)', () =>
        this.sql.query(
          `UPDATE ${this.table} SET data = $3::jsonb, storage_version = storage_version + 1 ` +
            `WHERE namespace = $1 AND id = $2 AND storage_version = $4 RETURNING storage_version`,
          [namespace, id, serialized, expected],
        ),
      );
      if (updated.rows.length > 0) {
        return { ok: true, storage_version: Number(updated.rows[0]!['storage_version']) };
      }
      const current = await this.currentVersion(namespace, id);
      return { ok: false, kind: 'VERSION_CONFLICT', current_storage_version: current };
    }
    const upserted = await this.guarded('put row (upsert)', () =>
      this.sql.query(
        `INSERT INTO ${this.table} (namespace, id, data, storage_version) VALUES ($1, $2, $3::jsonb, 1) ` +
          `ON CONFLICT (namespace, id) DO UPDATE SET data = EXCLUDED.data, storage_version = ${this.table}.storage_version + 1 ` +
          `RETURNING storage_version`,
        [namespace, id, serialized],
      ),
    );
    if (upserted.rows.length === 0) {
      throw new ProviderUnavailableError('postgres', `upsert of ${namespace}/${id} returned no row — refusing to fabricate a storage version`);
    }
    return { ok: true, storage_version: Number(upserted.rows[0]!['storage_version']) };
  }

  async listRows(namespace: string): Promise<StoredRow[]> {
    this.assertKey(namespace, 'namespace');
    const listed = await this.guarded('list rows', () =>
      this.sql.query(
        `SELECT id, data::text AS data_text, storage_version FROM ${this.table} WHERE namespace = $1 ORDER BY id ASC`,
        [namespace],
      ),
    );
    return listed.rows.map((row) => ({
      data: this.parseRowData(namespace, String(row['id'] ?? ''), row['data_text']),
      storage_version: Number(row['storage_version']),
    }));
  }

  // ------------------------------------------------------------------ internals

  private async currentVersion(namespace: string, id: string): Promise<number> {
    const rows = await this.guarded('read current version', () =>
      this.sql.query(`SELECT storage_version FROM ${this.table} WHERE namespace = $1 AND id = $2`, [namespace, id]),
    );
    if (rows.rows.length === 0) {
      return 0;
    }
    return Number(rows.rows[0]!['storage_version']);
  }

  private parseRowData(namespace: string, id: string, raw: unknown): JsonValue {
    if (typeof raw !== 'string') {
      throw new ProviderUnavailableError(
        'postgres',
        `durable row ${namespace}/${id} data is not JSON text — refusing to fabricate a document`,
      );
    }
    try {
      return JSON.parse(raw) as JsonValue;
    } catch (cause) {
      throw new ProviderUnavailableError(
        'postgres',
        `durable row ${namespace}/${id} data is not parseable JSON (${(cause as Error).message}) — refusing to fabricate a document`,
      );
    }
  }

  private assertKey(value: string, what: string): void {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ProviderUnavailableError('postgres', `${what} must be a non-empty string, received: ${JSON.stringify(value)}`);
    }
  }

  /** Map provider failures to the frozen typed ProviderUnavailableError — never a fabricated success. */
  private async guarded<T>(what: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        throw error;
      }
      const failure =
        error instanceof TransportError
          ? error.message
          : error instanceof NeonSqlError
            ? error.message
            : (error as Error).message;
      throw new ProviderUnavailableError(
        'postgres',
        `the real Neon provider failed during "${what}" (${failure}) — the honest state is UNAVAILABLE, never a fabricated success`,
      );
    }
  }
}
