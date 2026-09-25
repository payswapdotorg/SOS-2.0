/**
 * The P17-A composition boundary — assembling the REAL free-tier
 * persistence stack behind the frozen P2 ports from an injected
 * environment source (the P17-C composition precedent):
 *
 *   Neon   -> PostgresStoreAdapter      (durable canonical state)
 *   Upstash-> RedisCoordinationAdapter   (coordination only — never canonical)
 *   R2     -> ObjectStoreAdapter         (write-once immutable artifacts)
 *
 * The composition:
 *   - reads ONLY the injected source record (env-only credentials; the
 *     ambient environment is the process boundary's job);
 *   - wires ONE FetchPort per provider through the transcript-recording
 *     wrapper (every real round-trip becomes redacted evidence);
 *   - attaches adapters for the providers whose credentials resolved
 *     (absent credentials => that adapter is absent => its health stays
 *     UNKNOWN — never fabricated);
 *   - exposes the frozen ProviderHealthReport aggregation over the
 *     attached adapters plus the P17-A provider-state reports.
 *
 * NO adapter is auto-probed here: probing is an explicit act (the
 * startup probes of the wiring harness / integration journeys) — an
 * unprobed adapter reports UNKNOWN honestly.
 */

import type { Clock, ObjectStoreAdapter, PostgresStoreAdapter, ProviderHealthReport, RedisCoordinationAdapter } from '@sos-2/live-store';
import { PersistenceProbeLedger } from './provider-state.js';
import type { RealPersistenceProviderStateReport } from './provider-state.js';
import { PersistenceTranscriptRecorder } from './transcript.js';
import type { PersistenceTranscriptRecorderDeps } from './transcript.js';
import { createRecordingFetchPort } from './recording-fetch.js';
import type { FetchPort } from './http.js';
import { bindGlobalFetch } from './http.js';
import { NeonPostgresStoreAdapter } from './neon-postgres-adapter.js';
import { UpstashRedisCoordinationAdapter } from './upstash-redis-adapter.js';
import { R2ObjectStoreAdapter } from './r2-object-store-adapter.js';
import { resolveRealPersistenceEnvironment } from './environment.js';
import type { RealPersistenceEnvironmentResolution } from './environment.js';

/** The composed real persistence stack (frozen ports + honest evidence surfaces). */
export interface RealPersistenceStack {
  /** The REAL Neon durable adapter, or null when DATABASE_URL is absent (health stays UNKNOWN — never fabricated). */
  readonly postgres:
    | (PostgresStoreAdapter & {
        probe(): Promise<boolean>;
        providerState(): RealPersistenceProviderStateReport;
        credentialEnvName(): string | null;
        recordedSqlRequests(): readonly { method: string; path: string; status: number; command: string | null }[];
      })
    | null;
  /** The REAL Upstash coordination adapter, or null when its credentials are absent. */
  readonly redis:
    | (RedisCoordinationAdapter & {
        probe(): Promise<boolean>;
        providerState(): RealPersistenceProviderStateReport;
        credentialEnvName(): string | null;
        recordedRestRequests(): readonly { method: string; path: string; status: number }[];
      })
    | null;
  /** The REAL R2 object-store adapter, or null when its credentials are absent. */
  readonly objectStore:
    | (ObjectStoreAdapter & {
        probe(): Promise<boolean>;
        providerState(): RealPersistenceProviderStateReport;
        credentialEnvName(): string | null;
        recordedS3Requests(): readonly { method: string; path: string; status: number }[];
      })
    | null;
  /** The frozen P2 aggregate health report (unattached/unprobed => UNKNOWN). */
  health(): ProviderHealthReport;
  /** The P17-A honest provider-state reports (probe evidence or the honest unprobed state). */
  providerStates(): readonly RealPersistenceProviderStateReport[];
  /** The redacted transcript of every REAL round-trip performed so far. */
  transcript(): PersistenceTranscriptRecorder;
  /** The probe ledger (honest state derivation). */
  ledger(): PersistenceProbeLedger;
  /** The environment resolution actually used (names only — never values). */
  environment(): RealPersistenceEnvironmentResolution;
}

export interface RealPersistenceStackOptions {
  /** The injected raw environment source (env-only credentials; the caller owns the ambient read). */
  readonly source: Readonly<Record<string, string>>;
  /** The environment tier (namespace/prefix scope — the isolation seam). */
  readonly tier: 'local' | 'preview' | 'production';
  /** The injected clock (probe/transcript instants; no hidden time). */
  readonly clock: Clock;
  /**
   * The inner FetchPort (the network). Defaults to the global-fetch port
   * bound at THIS composition boundary — the documented impure boundary
   * (reference-mode compositions inject a scripted port instead).
   */
  readonly fetch?: FetchPort;
  /** Transcript recorder overrides (retained headers, credential references). */
  readonly transcript?: PersistenceTranscriptRecorderDeps;
}

/** Compose the REAL persistence stack from the injected environment (fail-open per provider; honest UNKNOWN when unconfigured). */
export function createRealPersistenceStack(options: RealPersistenceStackOptions): RealPersistenceStack {
  const resolution = resolveRealPersistenceEnvironment(options.source);
  const inner: FetchPort = options.fetch ?? bindGlobalFetch();
  const transcript = new PersistenceTranscriptRecorder({
    ...(options.transcript ?? {}),
    // The default credential references: each provider's credential
    // header becomes its env NAME (names only — never values).
    credentialReference:
      options.transcript?.credentialReference ??
      ((provider: string) => {
        switch (provider) {
          case 'neon':
            return resolution.neon.databaseUrlEnv;
          case 'upstash':
            return resolution.upstash.restTokenEnv;
          case 'r2':
            return resolution.r2.secretAccessKeyEnv;
          default:
            return null;
        }
      }),
  });
  const ledger = new PersistenceProbeLedger();
  const tier = options.tier;
  const clock = options.clock;

  const neonFetch = createRecordingFetchPort({ provider: 'neon', inner, transcript, clock });
  const upstashFetch = createRecordingFetchPort({ provider: 'upstash', inner, transcript, clock });
  const r2Fetch = createRecordingFetchPort({ provider: 'r2', inner, transcript, clock });

  const postgres =
    resolution.neon.databaseUrl !== null
      ? new NeonPostgresStoreAdapter({
          connectionString: resolution.neon.databaseUrl,
          fetch: neonFetch,
          clock,
          ledger,
          credentialEnv: resolution.neon.databaseUrlEnv,
        })
      : null;

  const redis =
    resolution.upstash.restUrl !== null && resolution.upstash.restToken !== null
      ? new UpstashRedisCoordinationAdapter({
          restUrl: resolution.upstash.restUrl,
          token: resolution.upstash.restToken,
          tier,
          fetch: upstashFetch,
          clock,
          ledger,
          credentialEnv: resolution.upstash.restTokenEnv,
        })
      : null;

  const objectStore =
    resolution.r2.accountId !== null &&
    resolution.r2.accessKeyId !== null &&
    resolution.r2.secretAccessKey !== null &&
    resolution.r2.bucketName !== null
      ? new R2ObjectStoreAdapter({
          accountId: resolution.r2.accountId,
          accessKeyId: resolution.r2.accessKeyId,
          secretAccessKey: resolution.r2.secretAccessKey,
          bucketName: resolution.r2.bucketName,
          tier,
          fetch: r2Fetch,
          clock,
          ledger,
          credentialEnv: resolution.r2.secretAccessKeyEnv,
        })
      : null;

  return {
    postgres,
    redis,
    objectStore,
    health(): ProviderHealthReport {
      return {
        postgres:
          postgres?.health() ?? {
            provider: 'postgres',
            role: 'durable-canonical-state',
            status: 'UNKNOWN',
            detail: 'no DATABASE_URL configured in the injected source (the honest state is UNKNOWN — never fabricated)',
          },
        redis:
          redis?.health() ?? {
            provider: 'redis',
            role: 'coordination-only-never-canonical',
            status: 'UNKNOWN',
            detail: 'no Upstash REST credentials configured in the injected source; coordination only — never canonical',
          },
        objectStore:
          objectStore?.health() ?? {
            provider: 'object-store',
            role: 'large-immutable-artifacts',
            status: 'UNKNOWN',
            detail: 'no R2 credentials configured in the injected source (the honest state is UNKNOWN — never fabricated)',
          },
      };
    },
    providerStates(): readonly RealPersistenceProviderStateReport[] {
      return [
        ledger.reportFor('neon', resolution.neon.databaseUrlEnv),
        ledger.reportFor('upstash', resolution.upstash.restTokenEnv),
        ledger.reportFor('r2', resolution.r2.secretAccessKeyEnv),
      ];
    },
    transcript: () => transcript,
    ledger: () => ledger,
    environment: () => resolution,
  };
}
