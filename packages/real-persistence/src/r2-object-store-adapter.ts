/**
 * The REAL R2 object-store adapter (Work Order P17-A) — the vendor-backed
 * realization of the frozen P2 ObjectStoreAdapter port over the
 * Cloudflare R2 S3-compatible API.
 *
 * Objects are IMMUTABLE and CONTENT-ADDRESSED: the S3 key is
 * `<tier-prefix>/<purpose>/<sha256-hex>` (the P3 r2ObjectKey contract,
 * mirrored structurally; the content anchor IS the sha-256 — identical
 * bytes produce the identical key, re-writes are unnecessary by
 * construction). The frozen port's object_ref stays `r2://<hash>` (the
 * provider-shaped reference of the P2 port — the bucket/region detail
 * lives in this adapter's configuration, not in the port).
 *
 * WRITE-ONCE DISCIPLINE (the P3 R2_IMMUTABILITY_CONTRACT):
 *   - putObject is create-only: when the object already exists it is
 *     verified byte-identical by construction (the key IS the content
 *     hash) and the SAME ref is returned — never a duplicate, never an
 *     overwrite;
 *   - deletion happens ONLY through the documented retention path
 *     (deleteObjectThroughRetentionPath — deliberately OUTSIDE the
 *     frozen port; no ad-hoc delete from request paths);
 *   - semantic metadata and content hashes remain in the durable
 *     semantic layer — R2 holds the bytes only.
 *
 * HONESTY: health() (the frozen port surface) reports the
 * AVAILABLE/UNAVAILABLE/UNKNOWN mapping of the P17-A probe state —
 * UNKNOWN before any probe, never fabricated. Provider failures throw
 * the frozen live-store ProviderUnavailableError (typed). The P17-A
 * provider-state surface carries CONNECTED/UNKNOWN/UNAVAILABLE/DEGRADED
 * with the full probe evidence.
 */

import { createHash } from 'node:crypto';
import { ProviderUnavailableError } from '@sos-2/live-store';
import type { Clock, ObjectStoreAdapter, ProviderHealthRecord, StoredObjectRef } from '@sos-2/live-store';
import { R2S3Client, R2S3Error } from './r2-s3.js';
import type { RecordedR2Request } from './r2-s3.js';
import { TransportError } from './http.js';
import type { FetchPort } from './http.js';
import type { PersistenceProbeLedger, RealPersistenceProviderStateReport } from './provider-state.js';
import { mapProviderStateToPortAvailability } from './provider-state.js';
import { r2ObjectKey, r2TierPrefix } from './infra-vocabulary.js';
import type { R2ObjectPurpose } from './infra-vocabulary.js';

const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Options for the real R2 object-store adapter. */
export interface R2ObjectStoreAdapterOptions {
  /** The R2 account id. */
  readonly accountId: string;
  /** The S3 access key id VALUE (secret; injected at the composition boundary). */
  readonly accessKeyId: string;
  /** The S3 secret access key VALUE (secret; injected at the composition boundary). */
  readonly secretAccessKey: string;
  /** The bucket name (the single free-tier bucket; tier isolation via key prefixes). */
  readonly bucketName: string;
  /** The environment tier whose prefix this adapter writes (the isolation seam). */
  readonly tier: 'local' | 'preview' | 'production';
  /** The object purpose segment (evidence/imports/reports — default evidence). */
  readonly purpose?: R2ObjectPurpose;
  /** The injectable network seam (the ONLY network this adapter performs). */
  readonly fetch: FetchPort;
  /** The injected clock (signing instants + probe timestamps; no hidden time). */
  readonly clock: Clock;
  /** The probe ledger (honest provider states from REAL probes only). */
  readonly ledger: PersistenceProbeLedger;
  /** The env NAME the access credentials came from (for redacted references in reports). */
  readonly credentialEnv: string | null;
  /** S3 endpoint override (deterministic tests). */
  readonly endpoint?: string;
}

/**
 * The REAL R2 object store adapter — large immutable artifacts behind
 * the frozen P2 port.
 */
export class R2ObjectStoreAdapter implements ObjectStoreAdapter {
  readonly providerName = 'object-store' as const;
  readonly providerRole = 'large-immutable-artifacts' as const;
  readonly providerTarget = 'cloudflare-r2' as const;

  private readonly s3: R2S3Client;
  private readonly bucket: string;
  private readonly tier: 'local' | 'preview' | 'production';
  private readonly purpose: R2ObjectPurpose;
  private readonly clock: Clock;
  private readonly ledger: PersistenceProbeLedger;
  private readonly credentialEnv: string | null;

  constructor(options: R2ObjectStoreAdapterOptions) {
    this.s3 = new R2S3Client({
      accountId: options.accountId,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      fetch: options.fetch,
      ...(options.endpoint !== undefined ? { endpoint: options.endpoint } : {}),
    });
    if (typeof options.bucketName !== 'string' || options.bucketName.length === 0) {
      throw new ProviderUnavailableError('object-store', 'R2 adapter requires a non-empty bucket name (fail closed)');
    }
    this.bucket = options.bucketName;
    this.tier = options.tier;
    this.purpose = options.purpose ?? 'evidence';
    this.clock = options.clock;
    this.ledger = options.ledger;
    this.credentialEnv = options.credentialEnv;
  }

  /** The env NAME the credentials came from (names only — never values). */
  credentialEnvName(): string | null {
    return this.credentialEnv;
  }

  /** The recorded S3 round-trips (method + path + status; never signing material). */
  recordedS3Requests(): readonly RecordedR2Request[] {
    return this.s3.recordedRequests();
  }

  /** The exact S3 key this adapter uses for a content hash (the P3 r2ObjectKey contract). */
  objectKeyFor(contentHash: string): string {
    return r2ObjectKey(this.tier, this.purpose, contentHash);
  }

  /** The honest P17-A provider-state report (probe evidence or the honest unprobed state). */
  providerState(): RealPersistenceProviderStateReport {
    return this.ledger.reportFor('r2', this.credentialEnv);
  }

  /** The frozen port health surface (AVAILABLE/UNAVAILABLE/UNKNOWN — never fabricated). */
  health(): ProviderHealthRecord {
    const state = this.ledger.reportFor('r2', this.credentialEnv);
    const availability = mapProviderStateToPortAvailability(state.state);
    return {
      provider: 'object-store',
      role: this.providerRole,
      status: availability,
      detail:
        state.state === 'UNKNOWN'
          ? 'real R2 adapter attached; not yet probed this run (the honest state is UNKNOWN — never fabricated)'
          : state.state === 'CONNECTED'
            ? `real R2 adapter probed at ${state.probed_at} (write-once immutable artifacts, bucket ${this.bucket}; ${state.api_revision ?? 'api revision not reported'})`
            : state.state === 'DEGRADED'
              ? `real R2 adapter probed at ${state.probed_at} and DEGRADED (the provider answered its probe with a limitation: ${state.last_error ?? 'throttled'})`
              : `real R2 adapter probed at ${state.probed_at} and UNAVAILABLE (the real failure: ${state.last_error ?? 'unspecified'})`,
    };
  }

  /**
   * The REAL startup/health probe: a live HeadBucket round-trip against
   * the configured bucket. Records a probe entry (honest state).
   * Returns the honest outcome — never throws for a provider failure.
   */
  async probe(): Promise<boolean> {
    const endpoint = `/${this.bucket} (HEAD)`;
    const instant = new Date(this.clock.nowEpochMs());
    try {
      const exists = await this.s3.headBucket(this.bucket, instant);
      this.ledger.record({
        provider: 'r2',
        probeId: 'r2:head-bucket',
        endpoint,
        at: instant.toISOString(),
        status: 200,
        ok: exists,
        failure: exists ? null : `the R2 endpoint answered but bucket '${this.bucket}' does not exist (provisioning required)`,
        apiRevision: 's3.2006-03-01',
      });
      return exists;
    } catch (error) {
      const failure =
        error instanceof TransportError
          ? `transport failure: ${error.message}`
          : error instanceof R2S3Error
            ? `s3 failure (HTTP ${String(error.status ?? 0)}): ${error.message}`
            : `unexpected failure: ${(error as Error).message}`;
      this.ledger.record({
        provider: 'r2',
        probeId: 'r2:head-bucket',
        endpoint,
        at: instant.toISOString(),
        status: error instanceof R2S3Error ? error.status : null,
        ok: false,
        failure,
        apiRevision: null,
      });
      return false;
    }
  }

  /**
   * Provision the bucket when absent (the real journey's provisioning
   * step; idempotent). A provider failure throws the frozen typed
   * ProviderUnavailableError.
   */
  async ensureBucket(): Promise<'existing' | 'created'> {
    const instant = new Date(this.clock.nowEpochMs());
    return this.guarded('ensure bucket', async () => {
      const exists = await this.s3.headBucket(this.bucket, instant);
      if (exists) {
        return 'existing' as const;
      }
      await this.s3.createBucket(this.bucket, instant);
      return 'created' as const;
    });
  }

  async putObject(bytes: Uint8Array): Promise<StoredObjectRef> {
    if (!(bytes instanceof Uint8Array)) {
      throw new ProviderUnavailableError('object-store', 'object bytes must be a Uint8Array');
    }
    const contentHash = sha256Hex(bytes);
    const key = this.objectKeyFor(contentHash);
    const instant = new Date(this.clock.nowEpochMs());
    // WRITE-ONCE, content-addressed: when the object already exists, the
    // identical content is proven by construction (the key IS the content
    // hash) — return the same ref, never a duplicate, never an overwrite.
    await this.guarded('put object', async () => {
      const existing = await this.s3.headObject(this.bucket, key, instant);
      if (existing !== null) {
        if (existing.sizeBytes !== bytes.byteLength) {
          // Content-addressing violated — a size mismatch at the same
          // hash is corruption or a provider defect: REFUSE, never paper over.
          throw new R2S3Error(
            `object at ${this.bucket}/${key} exists with size ${String(existing.sizeBytes)} but the content hash implies ${String(bytes.byteLength)} bytes — refusing to touch a corrupted content-addressed object`,
            null,
            'ContentCollision',
          );
        }
        return;
      }
      await this.s3.putObject(this.bucket, key, new Uint8Array(bytes), instant);
    });
    return { content_hash: contentHash, object_ref: `r2://${contentHash}`, size_bytes: bytes.byteLength };
  }

  async getObject(contentHash: string): Promise<Uint8Array | null> {
    this.assertContentHash(contentHash);
    const key = this.objectKeyFor(contentHash);
    const instant = new Date(this.clock.nowEpochMs());
    return this.guarded('get object', () => this.s3.getObject(this.bucket, key, instant));
  }

  async hasObject(contentHash: string): Promise<boolean> {
    this.assertContentHash(contentHash);
    const key = this.objectKeyFor(contentHash);
    const instant = new Date(this.clock.nowEpochMs());
    const head = await this.guarded('has object', () => this.s3.headObject(this.bucket, key, instant));
    return head !== null;
  }

  /**
   * THE DOCUMENTED RETENTION PATH (deliberately OUTSIDE the frozen
   * port): delete one object by content hash. The P3 immutability
   * contract: deletion happens only through the documented retention
   * policy — no ad-hoc delete from request paths. The real integration
   * journey exercises it once to prove the lifecycle end-to-end.
   */
  async deleteObjectThroughRetentionPath(contentHash: string): Promise<void> {
    this.assertContentHash(contentHash);
    const key = this.objectKeyFor(contentHash);
    const instant = new Date(this.clock.nowEpochMs());
    await this.guarded('delete object (retention path)', () => this.s3.deleteObject(this.bucket, key, instant));
  }

  /** List the objects under this adapter's tier/purpose prefix (verification evidence). */
  async listOwnObjects(): Promise<readonly { key: string; sizeBytes: number }[]> {
    const instant = new Date(this.clock.nowEpochMs());
    const prefix = `${r2TierPrefix(this.tier)}/${this.purpose}/`;
    const summaries = await this.guarded('list objects', () => this.s3.listObjects(this.bucket, prefix, instant));
    return summaries.map((summary) => ({ key: summary.key, sizeBytes: summary.sizeBytes }));
  }

  // ------------------------------------------------------------------ internals

  private assertContentHash(contentHash: string): void {
    if (typeof contentHash !== 'string' || !CONTENT_HASH_PATTERN.test(contentHash)) {
      throw new ProviderUnavailableError(
        'object-store',
        `content hash must be 64 lowercase hex chars, received: ${JSON.stringify(contentHash)}`,
      );
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
          : error instanceof R2S3Error
            ? error.message
            : (error as Error).message;
      throw new ProviderUnavailableError(
        'object-store',
        `the real R2 provider failed during "${what}" (${failure}) — the honest state is UNAVAILABLE, never a fabricated success`,
      );
    }
  }
}
