/**
 * In-memory reference implementation of the ObjectStoreAdapter port
 * (Cloudflare R2 target).
 *
 * Objects are IMMUTABLE and CONTENT-ADDRESSED: the key is the sha-256 of
 * the bytes (64 lowercase hex). Identical bytes produce the identical ref —
 * idempotent puts, never a duplicate. Semantic metadata and content hashes
 * remain in the durable semantic layer (docs/deployment/free-tier-plan.md);
 * this port holds only the large immutable blobs.
 */

import { createHash } from 'node:crypto';
import { UnknownStoreError } from '../errors.js';
import type {
  ObjectStoreAdapter,
  ProviderHealthRecord,
  StoredObjectRef,
} from '../ports/provider-adapters.js';

const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class InMemoryObjectStoreAdapter implements ObjectStoreAdapter {
  readonly providerName = 'object-store' as const;
  readonly providerRole = 'large-immutable-artifacts' as const;
  readonly providerTarget = 'cloudflare-r2' as const;

  private readonly objects = new Map<string, Uint8Array>();

  health(): ProviderHealthRecord {
    return {
      provider: 'object-store',
      role: this.providerRole,
      status: 'UNKNOWN',
      detail: 'in-memory reference backend (R2 adapter not attached in P2; no external provider configured)',
    };
  }

  async putObject(bytes: Uint8Array): Promise<StoredObjectRef> {
    if (!(bytes instanceof Uint8Array)) {
      throw new UnknownStoreError('object bytes must be a Uint8Array');
    }
    const contentHash = sha256Hex(bytes);
    if (!this.objects.has(contentHash)) {
      // Copy so later mutation of the caller's buffer cannot mutate the
      // stored immutable object.
      this.objects.set(contentHash, new Uint8Array(bytes));
    }
    return { content_hash: contentHash, object_ref: `r2://${contentHash}`, size_bytes: bytes.byteLength };
  }

  async getObject(contentHash: string): Promise<Uint8Array | null> {
    if (typeof contentHash !== 'string' || !CONTENT_HASH_PATTERN.test(contentHash)) {
      throw new UnknownStoreError(`content hash must be 64 lowercase hex chars, received: ${JSON.stringify(contentHash)}`);
    }
    const stored = this.objects.get(contentHash);
    return stored === undefined ? null : new Uint8Array(stored);
  }

  async hasObject(contentHash: string): Promise<boolean> {
    if (typeof contentHash !== 'string' || !CONTENT_HASH_PATTERN.test(contentHash)) {
      throw new UnknownStoreError(`content hash must be 64 lowercase hex chars, received: ${JSON.stringify(contentHash)}`);
    }
    return this.objects.has(contentHash);
  }

  /** Number of stored objects (diagnostics/tests). */
  get objectCount(): number {
    return this.objects.size;
  }
}
