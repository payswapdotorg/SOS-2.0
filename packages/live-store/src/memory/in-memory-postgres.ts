/**
 * In-memory reference implementation of the PostgresStoreAdapter port
 * (Neon target).
 *
 * This is the DURABLE CANONICAL STORE of the reference backend: every
 * semantic row lives here. Rows are canonical-JSON documents keyed by
 * (namespace, id); every write increments a monotonic storage version and
 * guarded writes are compare-and-set (the semantics a real Neon adapter
 * realizes with `INSERT ... ON CONFLICT` / `UPDATE ... WHERE version = $x`).
 *
 * providerConfigured is FALSE by design: no Neon adapter is attached in
 * this Work Order, so health() honestly reports UNKNOWN ("in-memory
 * reference backend; no external provider configured") — never fabricated
 * AVAILABLE. Real provider adapters arrive in later waves as optional
 * peers and report their own probed availability.
 */

import { UnknownStoreError } from '../errors.js';
import type {
  PostgresStoreAdapter,
  ProviderHealthRecord,
  RowPutOptions,
  RowPutOutcome,
  StoredRow,
} from '../ports/provider-adapters.js';
import type { JsonValue } from '@sos-2/semantic-spine';

interface InternalRow {
  data: JsonValue;
  storage_version: number;
}

function assertNamespace(namespace: string): void {
  if (typeof namespace !== 'string' || namespace.length === 0) {
    throw new UnknownStoreError(`namespace must be a non-empty string, received: ${JSON.stringify(namespace)}`);
  }
}

function assertId(id: string): void {
  if (typeof id !== 'string' || id.length === 0) {
    throw new UnknownStoreError(`row id must be a non-empty string, received: ${JSON.stringify(id)}`);
  }
}

export class InMemoryPostgresStoreAdapter implements PostgresStoreAdapter {
  readonly providerName = 'postgres' as const;
  readonly providerRole = 'durable-canonical-state' as const;
  readonly providerTarget = 'neon-postgres' as const;

  private readonly tables = new Map<string, Map<string, InternalRow>>();

  health(): ProviderHealthRecord {
    return {
      provider: 'postgres',
      role: this.providerRole,
      status: 'UNKNOWN',
      detail: 'in-memory reference backend (Neon adapter not attached in P2; no external provider configured)',
    };
  }

  private tableFor(namespace: string): Map<string, InternalRow> {
    const existing = this.tables.get(namespace);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Map<string, InternalRow>();
    this.tables.set(namespace, created);
    return created;
  }

  async getRow(namespace: string, id: string): Promise<StoredRow | null> {
    assertNamespace(namespace);
    assertId(id);
    const row = this.tableFor(namespace).get(id);
    if (row === undefined) {
      return null;
    }
    return { data: structuredClone(row.data), storage_version: row.storage_version };
  }

  async putRow(namespace: string, id: string, data: JsonValue, options?: RowPutOptions): Promise<RowPutOutcome> {
    assertNamespace(namespace);
    assertId(id);
    if (data === undefined) {
      throw new UnknownStoreError('row data must be a JSON value (undefined is not storable)');
    }
    const table = this.tableFor(namespace);
    const existing = table.get(id);
    if (options?.if_absent === true && existing !== undefined) {
      return { ok: false, kind: 'ALREADY_EXISTS', current_storage_version: existing.storage_version };
    }
    if (options?.expected_storage_version !== undefined) {
      if (existing === undefined) {
        return { ok: false, kind: 'VERSION_CONFLICT', current_storage_version: 0 };
      }
      if (existing.storage_version !== options.expected_storage_version) {
        return { ok: false, kind: 'VERSION_CONFLICT', current_storage_version: existing.storage_version };
      }
    }
    const nextVersion = existing === undefined ? 1 : existing.storage_version + 1;
    table.set(id, { data: structuredClone(data), storage_version: nextVersion });
    return { ok: true, storage_version: nextVersion };
  }

  async listRows(namespace: string): Promise<StoredRow[]> {
    assertNamespace(namespace);
    const table = this.tables.get(namespace);
    if (table === undefined) {
      return [];
    }
    return [...table.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([, row]) => ({ data: structuredClone(row.data), storage_version: row.storage_version }));
  }

  /** Number of rows in a namespace (diagnostics/tests). */
  rowCount(namespace: string): number {
    const table = this.tables.get(namespace);
    return table === undefined ? 0 : table.size;
  }
}
