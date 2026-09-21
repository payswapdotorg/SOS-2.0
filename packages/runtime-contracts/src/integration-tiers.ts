/**
 * The harness integration priority order (Work Order P5) — the typed
 * selection model of spec/productization-execution-architecture.md §4:
 *
 *   "Use the highest available control surface:
 *      1. native API / SDK / app server
 *      2. MCP or equivalent tool protocol
 *      3. local companion / service bridge
 *      4. browser or IDE extension
 *      5. UI automation as a last resort
 *    SOS must never require an extension when an equivalent safe API is
 *    available."
 *
 * The order is FROZEN by the architecture: rank 1 is the highest control
 * surface, rank 5 the last resort. Selection is deterministic and depends
 * ONLY on tier availability — never on vendor identity.
 */

import { InvalidRuntimeContractError } from './errors.js';
import { assertValidRuntimeIdentifier } from './identifiers.js';

/** The frozen integration priority order (§4, highest control surface first). */
export const INTEGRATION_TIERS = [
  'native-api',
  'mcp-protocol',
  'local-bridge',
  'extension',
  'ui-automation',
] as const;

export type IntegrationTier = (typeof INTEGRATION_TIERS)[number];

const INTEGRATION_TIER_SET: ReadonlySet<string> = new Set(INTEGRATION_TIERS);

/**
 * Rank of a tier in the frozen order (1 = native API/SDK/app server, the
 * highest control surface; 5 = UI automation, the last resort).
 */
export const INTEGRATION_TIER_RANK: Readonly<Record<IntegrationTier, number>> = {
  'native-api': 1,
  'mcp-protocol': 2,
  'local-bridge': 3,
  extension: 4,
  'ui-automation': 5,
};

/** The encoded §4 rule (machine-checkable, mirrors the P3 contract-record style). */
export const RUNTIME_INTEGRATION_PRIORITY_CONTRACT = {
  rule: 'Use the highest available control surface',
  order: INTEGRATION_TIERS,
  neverRequireAnExtension:
    'SOS must never require an extension when an equivalent safe API is available',
  lastResort: 'ui-automation is selected only when no higher control surface is available',
  selectionBasis: 'tier availability and capability match — never vendor identity',
} as const;

/** Is `value` one of the frozen integration tiers? */
export function isIntegrationTier(value: unknown): value is IntegrationTier {
  return typeof value === 'string' && INTEGRATION_TIER_SET.has(value);
}

/** The rank of a tier (throws on an unknown tier — loud, never defaulted). */
export function integrationTierRank(tier: IntegrationTier): number {
  if (!isIntegrationTier(tier)) {
    throw new InvalidRuntimeContractError(
      'integration-tier',
      `unknown integration tier: ${JSON.stringify(tier)} (frozen order: ${INTEGRATION_TIERS.join(' -> ')})`,
    );
  }
  return INTEGRATION_TIER_RANK[tier];
}

/**
 * Does tier `a` offer a STRICTLY higher control surface than tier `b`?
 * (Rank 1 native API/SDK/app server is the highest; rank 5 UI automation
 * the last resort.)
 */
export function isHigherControlSurface(a: IntegrationTier, b: IntegrationTier): boolean {
  return integrationTierRank(a) < integrationTierRank(b);
}

/**
 * One concrete control surface onto one runtime capability — a native API
 * endpoint, an MCP server, a local companion bridge, a browser/IDE
 * extension, or a UI-automation driver.
 */
export interface RuntimeIntegration {
  /** Runtime identifier of this integration surface (NEVER a semantic id). */
  readonly integration_id: string;
  /** The §4 control surface used. */
  readonly tier: IntegrationTier;
  /** The runtime/cloud surface integrated (e.g. "github", "neon", "filesystem"). */
  readonly capability: string;
  /** Opaque, non-empty descriptor of how the surface is reached (url, server id, socket path...). */
  readonly endpoint: string;
  /** The operations reachable through THIS surface (non-empty, unique). */
  readonly operations: readonly string[];
  /** Honest current availability — false is explicit, never fabricated true. */
  readonly available: boolean;
}

const INTEGRATION_NAMESPACE = 'runtime-integration';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isUniqueStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => isNonEmptyString(entry)) &&
    new Set(value as string[]).size === (value as string[]).length
  );
}

/** Validate a runtime integration surface (throws InvalidRuntimeContractError). */
export function assertValidRuntimeIntegration(value: unknown): asserts value is RuntimeIntegration {
  if (!isPlainObject(value) || !hasExactKeys(value, ['integration_id', 'tier', 'capability', 'endpoint', 'operations', 'available'])) {
    throw new InvalidRuntimeContractError(
      INTEGRATION_NAMESPACE,
      'runtime integration must have the exact field set { integration_id, tier, capability, endpoint, operations, available }',
    );
  }
  try {
    assertValidRuntimeIdentifier(value['integration_id'], 'runtime integration integration_id');
  } catch (cause) {
    throw new InvalidRuntimeContractError(INTEGRATION_NAMESPACE, (cause as Error).message);
  }
  if (!isIntegrationTier(value['tier'])) {
    throw new InvalidRuntimeContractError(
      INTEGRATION_NAMESPACE,
      `runtime integration tier must be one of ${INTEGRATION_TIERS.join(', ')}, received: ${JSON.stringify(value['tier'])}`,
    );
  }
  if (!isNonEmptyString(value['capability'])) {
    throw new InvalidRuntimeContractError(
      INTEGRATION_NAMESPACE,
      `runtime integration capability must be a non-empty string, received: ${JSON.stringify(value['capability'])}`,
    );
  }
  if (!isNonEmptyString(value['endpoint'])) {
    throw new InvalidRuntimeContractError(
      INTEGRATION_NAMESPACE,
      `runtime integration endpoint must be a non-empty string, received: ${JSON.stringify(value['endpoint'])}`,
    );
  }
  if (!isUniqueStringArray(value['operations'])) {
    throw new InvalidRuntimeContractError(
      INTEGRATION_NAMESPACE,
      'runtime integration operations must be a non-empty, duplicate-free array of non-empty strings',
    );
  }
  if (typeof value['available'] !== 'boolean') {
    throw new InvalidRuntimeContractError(
      INTEGRATION_NAMESPACE,
      `runtime integration available must be a boolean (honest availability — never fabricated), received: ${JSON.stringify(value['available'])}`,
    );
  }
}
