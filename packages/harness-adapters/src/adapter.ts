/**
 * THE HARNESS PROVIDER ADAPTER (Work Order P8) — the provider-side face
 * of the P5 Harness Contract.
 *
 * An adapter maps the §9 contract onto ONE §4 integration shape
 * (native-api / mcp-protocol / local-bridge — the shape IS the tier)
 * over an INJECTABLE TRANSPORT: real provider endpoints attach later
 * through the same adapters without contract change; tests and local
 * development use fakes or the in-process bridges (in-process.ts).
 *
 * - HONEST ADVERTISEMENT: capabilities() is the binding §3 advertisement
 *   of the provider session; unsupported operations answer typed
 *   UNSUPPORTED results.
 * - HONEST CONNECTION: descriptor().connection is NOT_YET_CONNECTED for
 *   real providers (validation accounts pending) or carries the explicit
 *   simulated marker when a reference transport backs the adapter.
 * - PROVIDER IDENTITY IS PROVENANCE ONLY: the provider block is metadata
 *   — never a selection key (selectHarnessAdapter reads tier +
 *   advertisement + connection ONLY, pinned by provider-name-flip
 *   tests).
 * - THE SEAM CARRIES NO AUTHORITY: every marshaled request/reply is
 *   validated against exact field sets (transport.ts); a smuggled
 *   authority key is a typed violation named loudly.
 *
 * The §4 tier selection (deterministic, vendor-blind): use the HIGHEST
 * available control surface — an available native-api adapter beats an
 * mcp-protocol adapter beats a local-bridge adapter; SOS must never
 * require an extension when an equivalent safe API is available.
 */

import { InvalidHarnessAdapterSpecError } from './errors.js';
import type { AdapterConnection } from './status.js';
import { assertValidAdapterConnection } from './status.js';
import type { HarnessCapabilities, HarnessContract, HarnessIdentity, HarnessOperationName, HarnessPlacement } from '@sos-2/harness';
import { assertValidHarnessCapabilities, isOperationAdvertised } from '@sos-2/harness';
import { INTEGRATION_TIERS, INTEGRATION_TIER_RANK, assertValidRuntimeIdentifier } from '@sos-2/runtime-contracts';
import type { IntegrationTier } from '@sos-2/runtime-contracts';

/** The adapter descriptor — tier + provenance + honest connection (rendered in capability tables). */
export interface HarnessAdapterDescriptor {
  /** Adapter identity — a RUNTIME identifier, never a SOS semantic identity. */
  readonly adapter_id: string;
  /** The §4 integration shape this adapter realizes (the shape IS the tier). */
  readonly tier: IntegrationTier;
  /** Vendor provenance — metadata ONLY, never a selection key, never identity. */
  readonly provider: { readonly name: string; readonly version: string };
  /** Execution placement (§7). */
  readonly placement: HarnessPlacement;
  /** The honest connection state. */
  readonly connection: AdapterConnection;
  /** One honest sentence about this adapter. */
  readonly note: string;
}

/** The spec an adapter is constructed from (the tier comes from the SHAPE, not the spec). */
export interface HarnessAdapterSpec {
  /** Adapter identity — a RUNTIME identifier (never spine-shaped). */
  readonly adapterId: string;
  /** Vendor provenance (metadata only). */
  readonly provider: { readonly name: string; readonly version: string };
  /** Execution placement. */
  readonly placement: HarnessPlacement;
  /** The binding §3 advertisement of the provider session. */
  readonly capabilities: HarnessCapabilities;
  /** The honest connection state. */
  readonly connection: AdapterConnection;
  /** One honest sentence about this adapter. */
  readonly note?: string;
}

/** THE HARNESS PROVIDER ADAPTER port. */
export interface HarnessProviderAdapter {
  /** The adapter descriptor (tier + provenance + honest connection). */
  descriptor(): HarnessAdapterDescriptor;
  /** The §4 integration tier of this adapter's shape. */
  tier(): IntegrationTier;
  /** The binding §3 capability advertisement. */
  capabilities(): HarnessCapabilities;
  /** The provider-neutral harness identity (never a SOS semantic identity). */
  identity(): HarnessIdentity;
  /** The §9 HarnessContract surface backed by the injectable transport. */
  harness(): HarnessContract;
}

const SPEC_NAMESPACE = 'harness-adapter-spec';

/** Validate an adapter spec (throws InvalidHarnessAdapterSpecError). */
export function assertValidHarnessAdapterSpec(value: unknown): asserts value is HarnessAdapterSpec {
  if (typeof value !== 'object' || value === null) {
    throw new InvalidHarnessAdapterSpecError(SPEC_NAMESPACE, 'harness adapter spec must be an object');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = ['adapterId', 'provider', 'placement', 'capabilities', 'connection', 'note'];
  if (keys.length < 5 || !expected.every((key) => (key === 'note' ? true : Object.prototype.hasOwnProperty.call(record, key)))) {
    throw new InvalidHarnessAdapterSpecError(SPEC_NAMESPACE, `harness adapter spec must have the exact field set { ${expected.join(', ')} } (note optional)`);
  }
  try {
    assertValidRuntimeIdentifier(record['adapterId'], 'harness adapter spec adapterId');
  } catch (cause) {
    throw new InvalidHarnessAdapterSpecError(SPEC_NAMESPACE, (cause as Error).message);
  }
  const provider = record['provider'];
  if (
    typeof provider !== 'object' ||
    provider === null ||
    Object.keys(provider).length !== 2 ||
    typeof (provider as Record<string, unknown>)['name'] !== 'string' ||
    ((provider as Record<string, unknown>)['name'] as string).length === 0 ||
    typeof (provider as Record<string, unknown>)['version'] !== 'string' ||
    ((provider as Record<string, unknown>)['version'] as string).length === 0
  ) {
    throw new InvalidHarnessAdapterSpecError(
      SPEC_NAMESPACE,
      `harness adapter spec provider must be { name, version } (non-empty vendor provenance strings — metadata only), received: ${JSON.stringify(provider)}`,
    );
  }
  if (typeof record['placement'] !== 'string' || !['cloud', 'remote', 'user-device'].includes(String(record['placement']))) {
    throw new InvalidHarnessAdapterSpecError(
      SPEC_NAMESPACE,
      `harness adapter spec placement must be cloud | remote | user-device, received: ${JSON.stringify(record['placement'])}`,
    );
  }
  try {
    assertValidHarnessCapabilities(record['capabilities']);
  } catch (cause) {
    throw new InvalidHarnessAdapterSpecError(SPEC_NAMESPACE, (cause as Error).message);
  }
  try {
    assertValidAdapterConnection(record['connection']);
  } catch (cause) {
    throw new InvalidHarnessAdapterSpecError(SPEC_NAMESPACE, (cause as Error).message);
  }
  if (record['note'] !== undefined && (typeof record['note'] !== 'string' || (record['note'] as string).length === 0)) {
    throw new InvalidHarnessAdapterSpecError(SPEC_NAMESPACE, 'harness adapter spec note must be a non-empty string when present');
  }
}

// ---------------------------------------------------------------------------
// The §4 tier selection (deterministic, vendor-blind)
// ---------------------------------------------------------------------------

/** The outcome of an adapter tier selection. */
export type HarnessAdapterSelection =
  | {
      readonly status: 'SELECTED';
      readonly adapter: HarnessProviderAdapter;
      /** Every considered candidate, in deterministic (rank, adapter id) order — traceability. */
      readonly considered: readonly HarnessProviderAdapter[];
      readonly reason: string;
    }
  | {
      readonly status: 'UNAVAILABLE';
      readonly adapter: null;
      readonly considered: readonly HarnessProviderAdapter[];
      readonly reason: string;
    };

/** Options for the tier selection. */
export interface SelectHarnessAdapterOptions {
  /** Restrict to adapters whose advertisement carries this §9 operation; null selects over all. */
  readonly operation?: HarnessOperationName | null;
  /** Restrict to these §4 tiers; null = all tiers. */
  readonly allowedTiers?: readonly IntegrationTier[] | null;
}

/**
 * Select the adapter offering the HIGHEST available control surface
 * (§4): available (honestly connected) adapters advertising the required
 * operation, ordered by frozen tier rank, tie-broken by adapter id.
 * Selection inputs carry NO vendor fields — provider identity can never
 * be a selection key.
 */
export function selectHarnessAdapter(
  adapters: readonly HarnessProviderAdapter[],
  options?: SelectHarnessAdapterOptions,
): HarnessAdapterSelection {
  for (const adapter of adapters) {
    if (typeof adapter !== 'object' || adapter === null || typeof adapter.descriptor !== 'function') {
      throw new InvalidHarnessAdapterSpecError('adapter-selection', 'every selection candidate must be a HarnessProviderAdapter');
    }
    const tier = adapter.tier();
    if (!INTEGRATION_TIERS.includes(tier)) {
      throw new InvalidHarnessAdapterSpecError('adapter-selection', `adapter ${JSON.stringify(adapter.descriptor().adapter_id)} declares unknown tier ${JSON.stringify(tier)}`);
    }
  }
  const operation = options?.operation ?? null;
  const allowedTiers =
    options?.allowedTiers === undefined || options?.allowedTiers === null ? null : new Set(options.allowedTiers);

  const eligible = adapters.filter((adapter) => {
    if (adapter.descriptor().connection.status !== 'CONNECTED') {
      return false;
    }
    if (operation !== null && !isOperationAdvertised(adapter.capabilities(), operation)) {
      return false;
    }
    if (allowedTiers !== null && !allowedTiers.has(adapter.tier())) {
      return false;
    }
    return true;
  });

  const ordered = [...eligible].sort((a, b) => {
    const rankDelta = INTEGRATION_TIER_RANK[a.tier()] - INTEGRATION_TIER_RANK[b.tier()];
    if (rankDelta !== 0) {
      return rankDelta;
    }
    const idA = a.descriptor().adapter_id;
    const idB = b.descriptor().adapter_id;
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  });

  if (ordered.length === 0) {
    const reason =
      adapters.length === 0
        ? 'no harness adapters are registered'
        : 'no honestly-connected adapter advertising the required operation is available at any §4 tier — the selection is unavailable (never fabricated)';
    return { status: 'UNAVAILABLE', adapter: null, considered: [], reason };
  }

  const selected = ordered[0]!;
  const reason = `§4 tier selection: adapter ${JSON.stringify(selected.descriptor().adapter_id)} offers the highest available control surface (tier ${selected.tier()}, rank ${INTEGRATION_TIER_RANK[selected.tier()]})${operation !== null ? ` advertising ${JSON.stringify(operation)}` : ''} — tier availability and capability match only, never vendor identity`;
  return { status: 'SELECTED', adapter: selected, considered: ordered, reason };
}
