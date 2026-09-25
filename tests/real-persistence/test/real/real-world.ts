/**
 * The shared composition boundary of the REAL-provider integration
 * suite (Work Order P17-A): the ONE place the ambient environment is
 * read (env-only credentials; names only in every output), the global
 * fetch is bound (the documented impure process boundary) and the real
 * clocks/timers are attached. Every journey composes from here.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ManualClock } from '@sos-2/live-store';
import type { Clock } from '@sos-2/live-store';
import { PersistenceProbeLedger, PersistenceTranscriptRecorder } from '@sos-2/real-persistence';
import { createRecordingFetchPort } from '@sos-2/real-persistence';
import { NeonAdminClient } from '@sos-2/real-persistence';
import { NeonPostgresStoreAdapter } from '@sos-2/real-persistence';
import { UpstashRedisCoordinationAdapter } from '@sos-2/real-persistence';
import { R2ObjectStoreAdapter } from '@sos-2/real-persistence';
import { bindGlobalFetch } from '@sos-2/real-persistence';
import type { FetchPort } from '@sos-2/real-persistence';
import { buildEvidenceRecord, serializeEvidenceRecord, assertEvidenceIsRedacted } from '@sos-2/infra-production-connectivity';

/** The evidence directory of the persistence-deployment lane. */
export const EVIDENCE_DIR = join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'evidence', 'production-connectivity', 'persistence-deployment');

/** The ambient environment snapshot (string values only). */
export function ambientSource(): Record<string, string> {
  const source: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      source[key] = value;
    }
  }
  return source;
}

/** The real system clock (process boundary; the journeys' probe/record instants). */
export class SystemClock implements Clock {
  nowEpochMs(): number {
    return Date.now();
  }
}

/** The real sleep (process boundary; the Vercel readiness polls). */
export const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The repo head sha (40-hex) of the current checkout — the exact-head binding source. */
export function repoHeadSha(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(import.meta.dirname, '..', '..', '..', '..') })
    .toString()
    .trim();
}

/** Write one redacted evidence record (fail-closed on residual secret-shaped material). */
export function writeEvidence(fileName: string, body: Record<string, unknown>): string {
  const record = buildEvidenceRecord({
    schema: `sos-2/p17a/${fileName.replace(/\.json$/, '')}`,
    workOrder: 'P17-A',
    producedAt: new Date().toISOString(),
    body,
  });
  const serialized = serializeEvidenceRecord(record);
  assertEvidenceIsRedacted(serialized);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const path = join(EVIDENCE_DIR, fileName);
  writeFileSync(path, serialized);
  return path;
}

/** One journey step (machine-readable, chronological). */
export interface JourneyStep {
  readonly step: string;
  readonly ok: boolean;
  readonly at: string;
  readonly detail: Record<string, unknown>;
}

/** A journey recorder (steps + honest outcome notes). */
export class Journey {
  readonly steps: JourneyStep[] = [];

  record(step: string, ok: boolean, detail: Record<string, unknown>): void {
    this.steps.push({ step, ok, at: new Date().toISOString(), detail });
  }
}

/** Compose the real Neon management client from the ambient source (env-only). */
export function composeNeonAdmin(source: Record<string, string>, fetch: FetchPort): NeonAdminClient | null {
  const apiKey = source['NEON_API_KEY'] ?? source['NEON_API_KEY_SECONDARY'];
  if (apiKey === undefined || apiKey.length === 0) {
    return null;
  }
  return new NeonAdminClient({ apiKey, fetch });
}

/** Compose the real Neon durable adapter from a pooled connection string (env-only). */
export function composeNeonAdapter(
  connectionString: string,
  transcript: PersistenceTranscriptRecorder,
  ledger: PersistenceProbeLedger,
  fetch: FetchPort,
  clock: Clock,
): NeonPostgresStoreAdapter {
  return new NeonPostgresStoreAdapter({
    connectionString,
    fetch: createRecordingFetchPort({ provider: 'neon', inner: fetch, transcript, clock }),
    clock,
    ledger,
    credentialEnv: 'DATABASE_URL',
  });
}

/** Compose the real Upstash coordination adapter from the ambient source (env-only). */
export function composeUpstashAdapter(
  source: Record<string, string>,
  transcript: PersistenceTranscriptRecorder,
  ledger: PersistenceProbeLedger,
  fetch: FetchPort,
  clock: Clock,
): UpstashRedisCoordinationAdapter | null {
  const restUrl = source['UPSTASH_REDIS_REST_URL'];
  const token = source['UPSTASH_REDIS_REST_TOKEN'];
  if (restUrl === undefined || token === undefined || restUrl.length === 0 || token.length === 0) {
    return null;
  }
  return new UpstashRedisCoordinationAdapter({
    restUrl,
    token,
    tier: 'production',
    fetch: createRecordingFetchPort({ provider: 'upstash', inner: fetch, transcript, clock }),
    clock,
    ledger,
    credentialEnv: 'UPSTASH_REDIS_REST_TOKEN',
  });
}

/** Compose the real R2 object-store adapter from the ambient source (env-only). */
export function composeR2Adapter(
  source: Record<string, string>,
  transcript: PersistenceTranscriptRecorder,
  ledger: PersistenceProbeLedger,
  fetch: FetchPort,
  clock: Clock,
): R2ObjectStoreAdapter | null {
  const accountId = source['R2_ACCOUNT_ID'];
  const accessKeyId = source['R2_ACCESS_KEY_ID'];
  const secretAccessKey = source['R2_SECRET_ACCESS_KEY'];
  const bucketName = source['R2_BUCKET_NAME'];
  if (
    accountId === undefined || accessKeyId === undefined || secretAccessKey === undefined || bucketName === undefined ||
    accountId.length === 0 || accessKeyId.length === 0 || secretAccessKey.length === 0 || bucketName.length === 0
  ) {
    return null;
  }
  return new R2ObjectStoreAdapter({
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    tier: 'production',
    fetch: createRecordingFetchPort({ provider: 'r2', inner: fetch, transcript, clock }),
    clock,
    ledger,
    credentialEnv: 'R2_SECRET_ACCESS_KEY',
  });
}

/** The global-fetch port bound at the process boundary (the ONE impure network binding). */
export function globalFetch(): FetchPort {
  return bindGlobalFetch({ timeoutMs: 30_000 });
}

/** A fresh transcript + ledger pair for one provider's journey (credential env-name references). */
export function journeyTelemetry(): { transcript: PersistenceTranscriptRecorder; ledger: PersistenceProbeLedger; clock: ManualClock } {
  return {
    transcript: new PersistenceTranscriptRecorder({
      credentialReference: (provider: string) => {
        switch (provider) {
          case 'neon':
            return 'DATABASE_URL';
          case 'upstash':
            return 'UPSTASH_REDIS_REST_TOKEN';
          case 'r2':
            return 'R2_SECRET_ACCESS_KEY';
          default:
            return null;
        }
      },
    }),
    ledger: new PersistenceProbeLedger(),
    clock: new ManualClock(Date.now()),
  };
}

export const RUN_REAL = process.env['RUN_REAL'] === '1';
