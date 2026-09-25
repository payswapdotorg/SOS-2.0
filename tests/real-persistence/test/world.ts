/**
 * The deterministic world of the real-persistence connectivity suites
 * (Work Order P17-A): a scripted FetchPort — NO network, fixed order,
 * run-to-run identical. The REAL adapter logic (SQL mapping, REST
 * command mapping, SigV4 signing, honest-state derivation, record
 * minting) is exercised through this seam exactly the way the
 * integration suite exercises it through the real fetch.
 */

import type { FetchPort, HttpRequest, HttpResponse } from '@sos-2/real-persistence';
import { ManualClock } from '@sos-2/live-store';
import { PersistenceProbeLedger } from '@sos-2/real-persistence';
import { PersistenceTranscriptRecorder } from '@sos-2/real-persistence';
import { createRecordingFetchPort } from '@sos-2/real-persistence';
import { NeonPostgresStoreAdapter } from '@sos-2/real-persistence';
import { UpstashRedisCoordinationAdapter } from '@sos-2/real-persistence';
import { R2ObjectStoreAdapter } from '@sos-2/real-persistence';

/** One scripted response: a provider-labeled HTTP response or a transport failure. */
export interface ScriptedHttpEntry {
  /** The provider label the request must belong to ('neon' | 'upstash' | 'r2' | 'vercel'). */
  readonly provider: string;
  readonly status: number;
  /** The JSON body (object) or raw text body ('' for empty). */
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  /** When set, the entry is a transport-level failure (DNS/network/timeout). */
  readonly transportError?: string;
}

/** The scripted FetchPort — deterministic, offline, ordered, provider-labeled. */
export class ScriptedHttpWorld {
  private readonly queue: ScriptedHttpEntry[];
  readonly requests: HttpRequest[] = [];

  constructor(entries: readonly ScriptedHttpEntry[]) {
    this.queue = [...entries];
  }

  readonly fetch: FetchPort = async (request: HttpRequest): Promise<HttpResponse> => {
    this.requests.push(request);
    const entry = this.queue.shift();
    if (entry === undefined) {
      throw new Error('the scripted port is exhausted — a deterministic defect in the test fixture');
    }
    const provider = providerOfUrl(request.url);
    if (provider !== entry.provider) {
      throw new Error(
        `scripted port provider mismatch: request went to '${provider}' but the next scripted entry is labeled '${entry.provider}' (${request.method} ${request.url})`,
      );
    }
    if (entry.transportError !== undefined) {
      throw new Error(entry.transportError);
    }
    const bodyText =
      entry.body === undefined ? '' : typeof entry.body === 'string' ? entry.body : JSON.stringify(entry.body);
    return {
      status: entry.status,
      headers: entry.headers ?? { 'content-type': 'application/json' },
      bytes: new TextEncoder().encode(bodyText),
    };
  };

  /** The recorded request log (audit — never carries credentials; bodies redacted downstream). */
  recorded(): readonly HttpRequest[] {
    return this.requests.map((request) => ({
      method: request.method,
      url: request.url,
      headers: { ...request.headers },
      body: null,
    }));
  }
}

/** Classify a request URL into its provider label (deterministic). */
export function providerOfUrl(url: string): string {
  if (url.includes('.r2.cloudflarestorage.com')) {
    return 'r2';
  }
  if (url.includes('.upstash.io')) {
    return 'upstash';
  }
  if (url.includes('api.vercel.com')) {
    return 'vercel';
  }
  if (url.includes('/sql') || url.includes('api.neon.tech')) {
    return 'neon';
  }
  throw new Error(`unclassified provider URL in the scripted world: ${url}`);
}

/** The fixed deterministic clock start (2026-04-16T12:00:00.000Z). */
export const T0 = 1_776_350_400_000;

/** The synthetic Neon pooled connection string (its VALUE never appears in evidence). */
export const NEON_URL = 'postgres://operator:neon-secret@ep-scripted-pooler.us-east-1.aws.neon.tech/sos?sslmode=require';

/** The synthetic Upstash REST endpoint + token. */
export const UPSTASH_URL = 'https://scripted-ewe-000000.upstash.io';
export const UPSTASH_TOKEN = 'AbCdEf1234567890123456789012345678901234';

/** The synthetic R2 credentials. */
export const R2_ACCOUNT = '0123456789abcdef0123456789abcdef';
export const R2_KEY = '00001111222233334444555566667777';
export const R2_SECRET = '9999888877776666555544443333222211110000999988887777666655554444';
export const R2_BUCKET = 'sos20-evidence-prod';

/** A Neon SQL result body for the scripted proxy. */
export function neonSql(command: string, rows: Record<string, unknown>[], fields: { name: string }[] = []): unknown {
  return { fields: fields.length > 0 ? fields : rows.length > 0 ? Object.keys(rows[0]!).map((name) => ({ name })) : [], rows, command, rowCount: rows.length };
}

/** Compose the deterministic persistence test world: adapters over the scripted fetch + recording transcript. */
export function persistenceWorld(
  entries: readonly ScriptedHttpEntry[],
): {
  world: ScriptedHttpWorld;
  clock: ManualClock;
  ledger: PersistenceProbeLedger;
  transcript: PersistenceTranscriptRecorder;
  postgres: NeonPostgresStoreAdapter;
  redis: UpstashRedisCoordinationAdapter;
  objectStore: R2ObjectStoreAdapter;
} {
  const world = new ScriptedHttpWorld(entries);
  const clock = new ManualClock(T0);
  const ledger = new PersistenceProbeLedger();
  const transcript = new PersistenceTranscriptRecorder({
    credentialReference: (provider) => {
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
  });
  const recordingNeon = createRecordingFetchPort({ provider: 'neon', inner: world.fetch, transcript, clock });
  const recordingUpstash = createRecordingFetchPort({ provider: 'upstash', inner: world.fetch, transcript, clock });
  const recordingR2 = createRecordingFetchPort({ provider: 'r2', inner: world.fetch, transcript, clock });
  const postgres = new NeonPostgresStoreAdapter({
    connectionString: NEON_URL,
    fetch: recordingNeon,
    clock,
    ledger,
    credentialEnv: 'DATABASE_URL',
    baseUrl: 'https://ep-scripted-pooler.us-east-1.aws.neon.tech',
  });
  const redis = new UpstashRedisCoordinationAdapter({
    restUrl: UPSTASH_URL,
    token: UPSTASH_TOKEN,
    tier: 'production',
    fetch: recordingUpstash,
    clock,
    ledger,
    credentialEnv: 'UPSTASH_REDIS_REST_TOKEN',
  });
  const objectStore = new R2ObjectStoreAdapter({
    accountId: R2_ACCOUNT,
    accessKeyId: R2_KEY,
    secretAccessKey: R2_SECRET,
    bucketName: R2_BUCKET,
    tier: 'production',
    fetch: recordingR2,
    clock,
    ledger,
    credentialEnv: 'R2_SECRET_ACCESS_KEY',
  });
  return { world, clock, ledger, transcript, postgres, redis, objectStore };
}
