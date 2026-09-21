/**
 * Deployment revision registration (Work Order P3).
 *
 * The machine-checkable record contract for deployment revisions — the
 * shape later waves wire into System State (this package provides the
 * contract and an in-memory/local REFERENCE registrar; durable
 * registration via the live System State store arrives with the live-data
 * waves, exactly like real provider credentials).
 *
 * A DeploymentRevisionRecord binds, for one provider in one environment:
 *   - the EXACT source revision sha (40-hex git sha — the exact-head rule),
 *   - the provider-assigned deployment revision id,
 *   - the region,
 *   - a registered-at instant supplied by an INJECTED clock (never
 *     Date.now inside library code),
 *   - a rollback pointer to the previous deployment revision id (or null
 *     for the first deployment of that environment/provider).
 *
 * Records are append-only: registration never overwrites, history is
 * retained, and the rollback target for an environment/provider is always
 * the previous record's deployment revision id.
 */

import {
  DeploymentRevisionError,
  isEnvironmentTier,
  isInfraProviderId,
  type EnvironmentTier,
  type InfraProviderId,
} from '../core/types.ts';
import { NEON_REGIONS, NEON_DEFAULT_REGION } from '../providers/neon.ts';
import { R2_REGIONS, R2_DEFAULT_REGION } from '../providers/r2.ts';
import { UPSTASH_REGIONS, UPSTASH_DEFAULT_REGION } from '../providers/upstash.ts';
import { GITHUB_REGIONS, GITHUB_DEFAULT_REGION } from '../providers/github.ts';

/** Vercel regions (documented subset of the deployment contract). */
export const VERCEL_REGIONS = ['iad1', 'sfo1', 'fra1', 'cdg1', 'hnd1', 'syd1'] as const;
export type VercelRegion = (typeof VERCEL_REGIONS)[number];
export const VERCEL_DEFAULT_REGION: VercelRegion = 'iad1';

/** Region contract per provider. */
export const PROVIDER_REGION_CONTRACT: Readonly<
  Record<InfraProviderId, { readonly regions: readonly string[]; readonly default: string }>
> = {
  vercel: { regions: VERCEL_REGIONS, default: VERCEL_DEFAULT_REGION },
  neon: { regions: NEON_REGIONS, default: NEON_DEFAULT_REGION },
  upstash: { regions: UPSTASH_REGIONS, default: UPSTASH_DEFAULT_REGION },
  r2: { regions: R2_REGIONS, default: R2_DEFAULT_REGION },
  github: { regions: GITHUB_REGIONS, default: GITHUB_DEFAULT_REGION },
  'execution-body-provider': {
    regions: ['provider-defined'],
    default: 'provider-defined',
  },
} as const;

/**
 * The deployment revision record (machine-checkable). registered_at is an
 * injected clock value: RFC3339 UTC string (the caller owns time; library
 * code never reads a clock).
 */
export interface DeploymentRevisionRecord {
  readonly environment: EnvironmentTier;
  readonly provider: InfraProviderId;
  readonly region: string;
  /** Exact source revision this deployment was built from (40-hex git sha). */
  readonly source_revision_sha: string;
  /** Provider-assigned deployment revision id (non-empty, opaque). */
  readonly deployment_revision_id: string;
  /** RFC3339 UTC instant, injected by the caller. */
  readonly registered_at: string;
  /** Previous deployment revision id for this environment+provider (null on first). */
  readonly rollback_pointer: { readonly previous_deployment_revision_id: string | null } ;
}

const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SHA_40 = /^[0-9a-f]{40}$/;

/** Validates one deployment revision record against the contract. */
export function validateDeploymentRevisionRecord(record: DeploymentRevisionRecord): void {
  if (!isEnvironmentTier(record.environment)) {
    throw new DeploymentRevisionError(
      `deployment revision record environment must be one of local|preview|production (got '${String(record.environment)}')`,
    );
  }
  if (!isInfraProviderId(record.provider)) {
    throw new DeploymentRevisionError(
      `deployment revision record provider must be a known infra provider id (got '${String(record.provider)}')`,
    );
  }
  const regionContract = PROVIDER_REGION_CONTRACT[record.provider];
  if (!regionContract.regions.includes(record.region)) {
    throw new DeploymentRevisionError(
      `deployment revision record region '${record.region}' is not in the ${record.provider} region contract (${regionContract.regions.join(', ')})`,
    );
  }
  if (!SHA_40.test(record.source_revision_sha)) {
    throw new DeploymentRevisionError(
      'deployment revision record source_revision_sha must be a 40-char lowercase hex git sha (the exact-head rule)',
    );
  }
  if (typeof record.deployment_revision_id !== 'string' || record.deployment_revision_id.length === 0) {
    throw new DeploymentRevisionError('deployment revision record deployment_revision_id must be a non-empty string');
  }
  if (!RFC3339_UTC.test(record.registered_at)) {
    throw new DeploymentRevisionError(
      `deployment revision record registered_at must be an RFC3339 UTC instant (injected clock value); got '${record.registered_at}'`,
    );
  }
  if (record.rollback_pointer === null || typeof record.rollback_pointer !== 'object') {
    throw new DeploymentRevisionError(
      'deployment revision record rollback_pointer must be an object { previous_deployment_revision_id: string | null }',
    );
  }
  const previous = record.rollback_pointer.previous_deployment_revision_id;
  if (previous !== null && (typeof previous !== 'string' || previous.length === 0)) {
    throw new DeploymentRevisionError(
      'deployment revision record rollback_pointer.previous_deployment_revision_id must be a non-empty string or null',
    );
  }
}

/** Round-trip: serialize + parse with validation (the machine-checkable form). */
export function serializeDeploymentRevisionRecord(record: DeploymentRevisionRecord): string {
  validateDeploymentRevisionRecord(record);
  return JSON.stringify(record);
}

export function parseDeploymentRevisionRecord(serialized: string): DeploymentRevisionRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new DeploymentRevisionError('deployment revision record serialization is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DeploymentRevisionError('deployment revision record must serialize to a JSON object');
  }
  const record = parsed as DeploymentRevisionRecord;
  validateDeploymentRevisionRecord(record);
  return record;
}

/** The registrar contract later waves implement against durable stores. */
export interface DeploymentRevisionRegistrar {
  /** Appends a validated record; append-only (no overwriting). */
  register(record: DeploymentRevisionRecord): void;
  /** All records for one environment+provider, oldest first. */
  list(environment: EnvironmentTier, provider: InfraProviderId): readonly DeploymentRevisionRecord[];
  /** The most recent record for an environment+provider, if any. */
  latest(environment: EnvironmentTier, provider: InfraProviderId): DeploymentRevisionRecord | undefined;
  /**
   * The rollback target for an environment+provider: the deployment
   * revision id the current deployment would roll back to, or null when
   * the current deployment is the first (nothing to roll back to).
   */
  rollbackTarget(environment: EnvironmentTier, provider: InfraProviderId): string | null;
}

/**
 * In-memory/local REFERENCE registrar. Deterministic: no clock (records
 * arrive with injected instants), no entropy, append-only ordering.
 */
export class InMemoryDeploymentRevisionRegistrar implements DeploymentRevisionRegistrar {
  private readonly records: DeploymentRevisionRecord[] = [];

  register(record: DeploymentRevisionRecord): void {
    validateDeploymentRevisionRecord(record);
    for (const existing of this.records) {
      if (
        existing.environment === record.environment &&
        existing.provider === record.provider &&
        existing.deployment_revision_id === record.deployment_revision_id
      ) {
        throw new DeploymentRevisionError(
          `deployment revision '${record.deployment_revision_id}' is already registered for ${record.environment}/${record.provider} — registration is append-only, re-registration is rejected`,
        );
      }
    }
    const current = this.latest(record.environment, record.provider);
    if (current !== undefined) {
      const expected = current.deployment_revision_id;
      if (record.rollback_pointer.previous_deployment_revision_id !== expected) {
        throw new DeploymentRevisionError(
          `deployment revision '${record.deployment_revision_id}' rollback pointer must reference the current revision '${expected}' for ${record.environment}/${record.provider} (rollback pointers form the actual chain)`,
        );
      }
    } else if (record.rollback_pointer.previous_deployment_revision_id !== null) {
      throw new DeploymentRevisionError(
        `deployment revision '${record.deployment_revision_id}' is the first for ${record.environment}/${record.provider} and must carry a null rollback pointer`,
      );
    }
    this.records.push(record);
  }

  list(environment: EnvironmentTier, provider: InfraProviderId): readonly DeploymentRevisionRecord[] {
    return this.records.filter(
      (record) => record.environment === environment && record.provider === provider,
    );
  }

  latest(environment: EnvironmentTier, provider: InfraProviderId): DeploymentRevisionRecord | undefined {
    const list = this.list(environment, provider);
    return list.length === 0 ? undefined : list[list.length - 1];
  }

  rollbackTarget(environment: EnvironmentTier, provider: InfraProviderId): string | null {
    const latest = this.latest(environment, provider);
    return latest === undefined ? null : latest.rollback_pointer.previous_deployment_revision_id;
  }
}
