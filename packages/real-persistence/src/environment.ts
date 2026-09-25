/**
 * The P17-A environment resolution for the real persistence adapters —
 * the env-only credential discipline (the P17-B/P17-C environment
 * modules' pattern):
 *
 *   - this package NEVER reads the ambient environment (fail-closed,
 *     injectable-source discipline); the caller injects a raw source
 *     record at the composition boundary;
 *   - the variable NAMES follow the P3 typed registry
 *     (infra/deployment/src/environment/schema.ts) exactly:
 *     DATABASE_URL / NEON_API_KEY / NEON_DATABASE_NAME / NEON_BRANCH_NAME
 *     (neon), UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *     (upstash), R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY /
 *     R2_S3_ENDPOINT / R2_BUCKET_NAME (r2);
 *   - VALUES never appear in outcomes, notes, telemetry or evidence —
 *     NAMES only;
 *   - credentials are PREPARED, never CONNECTED (a real authenticated
 *     probe must complete before CONNECTED is ever claimed).
 */

/** The env variable names this lane understands (names only — never values; the P3 registry names). */
export const REAL_PERSISTENCE_ENVIRONMENT_VARIABLES = {
  neonApiKey: 'NEON_API_KEY',
  neonApiKeySecondary: 'NEON_API_KEY_SECONDARY',
  databaseUrl: 'DATABASE_URL',
  neonDatabaseName: 'NEON_DATABASE_NAME',
  neonBranchName: 'NEON_BRANCH_NAME',
  upstashRestUrl: 'UPSTASH_REDIS_REST_URL',
  upstashRestToken: 'UPSTASH_REDIS_REST_TOKEN',
  r2AccountId: 'R2_ACCOUNT_ID',
  r2AccessKeyId: 'R2_ACCESS_KEY_ID',
  r2SecretAccessKey: 'R2_SECRET_ACCESS_KEY',
  r2S3Endpoint: 'R2_S3_ENDPOINT',
  r2BucketName: 'R2_BUCKET_NAME',
} as const;

/** The injected raw environment source record (never the ambient environment). */
export type RealPersistenceRawEnvironmentSource = Readonly<Record<string, string>>;

/** The Neon credential slice (values flow onward into clients; never echoed). */
export interface NeonEnvironmentSlice {
  /** The management API key VALUE, or null when absent. */
  readonly apiKey: string | null;
  /** The env NAME the key came from, or null. */
  readonly apiKeyEnv: string | null;
  /** The pooled connection string VALUE (SECRET), or null when absent. */
  readonly databaseUrl: string | null;
  /** The env NAME the connection string came from ('DATABASE_URL'), or null. */
  readonly databaseUrlEnv: string | null;
  /** The declared database name (public identity), or null when absent. */
  readonly databaseName: string | null;
  /** The declared branch name (public identity), or null when absent. */
  readonly branchName: string | null;
}

/** The Upstash credential slice. */
export interface UpstashEnvironmentSlice {
  readonly restUrl: string | null;
  readonly restToken: string | null;
  readonly restTokenEnv: string | null;
}

/** The R2 credential slice. */
export interface R2EnvironmentSlice {
  readonly accountId: string | null;
  readonly accessKeyId: string | null;
  readonly secretAccessKey: string | null;
  readonly secretAccessKeyEnv: string | null;
  readonly s3Endpoint: string | null;
  readonly bucketName: string | null;
}

/** The honest resolution of the whole real-persistence environment slice. */
export interface RealPersistenceEnvironmentResolution {
  readonly neon: NeonEnvironmentSlice;
  readonly upstash: UpstashEnvironmentSlice;
  readonly r2: R2EnvironmentSlice;
  /** One honest sentence about this resolution. */
  readonly note: string;
}

function optional(source: RealPersistenceRawEnvironmentSource, name: string): string | null {
  const value = source[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Resolve the real-persistence environment slice from an injected source record (names only in the output notes). */
export function resolveRealPersistenceEnvironment(source: RealPersistenceRawEnvironmentSource): RealPersistenceEnvironmentResolution {
  const neonApiKey = optional(source, REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.neonApiKey)
    ?? optional(source, REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.neonApiKeySecondary);
  const databaseUrl = optional(source, REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.databaseUrl);
  const upstashRestUrl = optional(source, REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.upstashRestUrl);
  const upstashRestToken = optional(source, REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.upstashRestToken);
  const r2AccountId = optional(source, REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.r2AccountId);
  const r2AccessKeyId = optional(source, REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.r2AccessKeyId);
  const r2SecretAccessKey = optional(source, REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.r2SecretAccessKey);
  const r2S3Endpoint = optional(source, REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.r2S3Endpoint);
  const r2BucketName = optional(source, REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.r2BucketName);
  return {
    neon: {
      apiKey: neonApiKey,
      apiKeyEnv: neonApiKey === null ? null : REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.neonApiKey,
      databaseUrl,
      databaseUrlEnv: databaseUrl === null ? null : REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.databaseUrl,
      databaseName: optional(source, REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.neonDatabaseName),
      branchName: optional(source, REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.neonBranchName),
    },
    upstash: {
      restUrl: upstashRestUrl,
      restToken: upstashRestToken,
      restTokenEnv: upstashRestToken === null ? null : REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.upstashRestToken,
    },
    r2: {
      accountId: r2AccountId,
      accessKeyId: r2AccessKeyId,
      secretAccessKey: r2SecretAccessKey,
      secretAccessKeyEnv: r2SecretAccessKey === null ? null : REAL_PERSISTENCE_ENVIRONMENT_VARIABLES.r2SecretAccessKey,
      s3Endpoint: r2S3Endpoint,
      bucketName: r2BucketName,
    },
    note:
      'Credentials are resolved from the injected source by NAME (P3 registry names); values are never echoed. ' +
      'A resolved credential is PREPARED, never CONNECTED — connection requires the real authenticated probe.',
  };
}
