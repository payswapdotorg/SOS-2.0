/**
 * The artifact blob store (Work Order P2) — large immutable artifacts by
 * content hash over the ObjectStoreAdapter port (R2 target).
 *
 * Content addressing: put(bytes) computes sha-256, stores the immutable
 * blob, and returns the hash; re-putting identical bytes is an idempotent
 * no-op (ALREADY_PRESENT). Task records REFERENCE artifacts by content
 * hash (TaskArtifactRef); the bytes live here. Semantic metadata (what the
 * artifact means) stays in the durable semantic layer — the object store
 * holds blobs only.
 */

import { createHash } from 'node:crypto';
import { ObjectIntegrityError } from './errors.js';
import type { ObjectStoreAdapter } from './provider-ports.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** The artifact blob port (content-addressed immutable bytes). */
export interface ArtifactBlobPort {
  /** Store bytes; returns the content hash (idempotent for identical bytes). */
  put(bytes: Uint8Array): Promise<{ content_hash: string; size_bytes: number; outcome: 'STORED' | 'ALREADY_PRESENT' }>;
  /** Fetch bytes by content hash, or undefined. */
  get(contentHash: string): Promise<Uint8Array | undefined>;
  /** Does the blob exist? */
  has(contentHash: string): Promise<boolean>;
  /** All blobs (hash + size), sorted by hash (deterministic). */
  list(): Promise<{ content_hash: string; size_bytes: number }[]>;
}

/** The reference artifact blob store over the ObjectStoreAdapter port. */
export class ArtifactBlobStore implements ArtifactBlobPort {
  private readonly objectStore: ObjectStoreAdapter;

  constructor(objectStore: ObjectStoreAdapter) {
    this.objectStore = objectStore;
  }

  async put(bytes: Uint8Array): Promise<{ content_hash: string; size_bytes: number; outcome: 'STORED' | 'ALREADY_PRESENT' }> {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('artifact bytes must be a Uint8Array');
    }
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    return this.objectStore.putObject(contentHash, bytes);
  }

  async get(contentHash: string): Promise<Uint8Array | undefined> {
    this.assertHash(contentHash);
    return this.objectStore.getObject(contentHash);
  }

  async has(contentHash: string): Promise<boolean> {
    this.assertHash(contentHash);
    return this.objectStore.hasObject(contentHash);
  }

  async list(): Promise<{ content_hash: string; size_bytes: number }[]> {
    return this.objectStore.listObjects();
  }

  private assertHash(contentHash: string): void {
    if (typeof contentHash !== 'string' || !SHA256_PATTERN.test(contentHash)) {
      throw new ObjectIntegrityError(String(contentHash), 'content hash must be 64 lowercase hex characters (sha-256)');
    }
  }
}
