/**
 * Deterministic runtime integration selection (Work Order P5).
 *
 * THE §4 RULE: "Use the highest available control surface ... SOS must
 * never require an extension when an equivalent safe API is available."
 *
 * Selection depends ONLY on tier availability (and the caller's capability
 * filter) — NEVER on vendor identity: the selection inputs carry no vendor
 * fields at all, and the tie-break is the deterministic integration id.
 */

import { InvalidRuntimeContractError } from './errors.js';
import { INTEGRATION_TIER_RANK, assertValidRuntimeIntegration } from './integration-tiers.js';
import type { RuntimeIntegration } from './integration-tiers.js';

/** The outcome of a runtime integration selection. */
export type RuntimeIntegrationSelection =
  | {
      /** A surface was selected: the highest available control surface. */
      readonly status: 'SELECTED';
      readonly selected: RuntimeIntegration;
      /** Every considered candidate, in deterministic (rank, id) order — traceability. */
      readonly considered: readonly RuntimeIntegration[];
      readonly reason: string;
    }
  | {
      /** No candidate surface satisfied the requirement — honest, typed. */
      readonly status: 'UNAVAILABLE';
      readonly selected: null;
      readonly considered: readonly RuntimeIntegration[];
      readonly reason: string;
    };

/** Options for selection. */
export interface SelectRuntimeIntegrationOptions {
  /**
   * Restrict to surfaces exposing this operation (from the capability
   * vocabulary); null selects over all candidate surfaces.
   */
  readonly operation?: string | null;
  /** Restrict to these tiers (e.g. exclude UI automation explicitly); null = all tiers. */
  readonly allowedTiers?: readonly string[] | null;
}

/**
 * Select the integration surface for a capability: the HIGHEST available
 * control surface (§4 order), deterministically. Candidates are validated
 * (loud on malformed input); unavailable surfaces are never selected — an
 * unavailable higher tier falls through to the next available tier, and a
 * world with only an extension available honestly selects the extension.
 */
export function selectRuntimeIntegration(
  candidates: readonly RuntimeIntegration[],
  options?: SelectRuntimeIntegrationOptions,
): RuntimeIntegrationSelection {
  for (const candidate of candidates) {
    assertValidRuntimeIntegration(candidate);
  }
  const operation = options?.operation ?? null;
  const allowedTiers =
    options?.allowedTiers === undefined || options.allowedTiers === null
      ? null
      : new Set(options.allowedTiers);

  const eligible = candidates.filter((candidate) => {
    if (!candidate.available) {
      return false;
    }
    if (operation !== null && !candidate.operations.includes(operation)) {
      return false;
    }
    if (allowedTiers !== null && !allowedTiers.has(candidate.tier)) {
      return false;
    }
    return true;
  });

  // Deterministic order: §4 rank first (highest control surface first),
  // then integration id ascending. Selection inputs carry NO vendor
  // fields — vendor identity can never be a selection key.
  const ordered = [...eligible].sort((a, b) => {
    const rankDelta = INTEGRATION_TIER_RANK[a.tier] - INTEGRATION_TIER_RANK[b.tier];
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return a.integration_id < b.integration_id ? -1 : a.integration_id > b.integration_id ? 1 : 0;
  });

  if (ordered.length === 0) {
    const reason =
      candidates.length === 0
        ? 'no candidate integration surfaces were offered'
        : operation === null
          ? 'no offered integration surface is currently available'
          : `no offered integration surface is currently available and exposing operation ${JSON.stringify(operation)}`;
    return { status: 'UNAVAILABLE', selected: null, considered: [], reason };
  }

  const selected = ordered[0]!;
  const reason =
    `selected the highest available control surface (tier ${JSON.stringify(selected.tier)}, rank ${INTEGRATION_TIER_RANK[selected.tier]} of the frozen §4 order)` +
    (ordered.length > 1
      ? ` over ${ordered.length - 1} lower-ranked available surface(s) — SOS never requires an extension when an equivalent safe API is available`
      : '');
  return { status: 'SELECTED', selected, considered: ordered, reason };
}

/**
 * The honest availability projection of a set of candidate surfaces:
 * which §4 tiers are currently reachable. UNAVAILABLE tiers are reported
 * as absent — never fabricated.
 */
export function availableTiers(candidates: readonly RuntimeIntegration[]): readonly string[] {
  for (const candidate of candidates) {
    assertValidRuntimeIntegration(candidate);
  }
  const tiers = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.available) {
      tiers.add(candidate.tier);
    }
  }
  return [...tiers].sort((a, b) => INTEGRATION_TIER_RANK[a as keyof typeof INTEGRATION_TIER_RANK] - INTEGRATION_TIER_RANK[b as keyof typeof INTEGRATION_TIER_RANK]);
}

/** Validate that an `allowedTiers` restriction only names known tiers (loud otherwise). */
export function assertValidAllowedTiers(tiers: readonly string[]): void {
  for (const tier of tiers) {
    if (!(tier in INTEGRATION_TIER_RANK)) {
      throw new InvalidRuntimeContractError(
        'integration-tier',
        `allowedTiers names unknown tier ${JSON.stringify(tier)} (frozen order: ${Object.keys(INTEGRATION_TIER_RANK).join(', ')})`,
      );
    }
  }
}
