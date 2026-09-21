/**
 * The onboarding VIEW of the GitHub connection state — the view-level
 * vocabulary the onboarding surfaces render. The PROVIDER connection
 * contract (statuses, simulated marker, scopes) is owned by
 * @sos-2/github; this module owns how the ONBOARDING PRODUCT presents
 * connection truth to a fresh user, mirroring how the P1 shell owned
 * authority-mode VIEW states over @sos-2/authority's grant vocabulary.
 *
 * Honesty rules (structural):
 *   - a simulated provider connection can never render as a real
 *     connection (the view carries `simulated` through, and DEMO-backed
 *     views carry the DEMO data-source marker);
 *   - the real-system connection is NOT_YET_CONNECTED throughout this
 *     Work Order (validation GitHub account pending) — never fabricated
 *     as connected;
 *   - the provider's states are mapped 1:1 (the alignment is pinned by
 *     the journey integration test against @sos-2/github's vocabulary).
 */

import type { DataSource } from '@sos-2/web-contracts';

/** The onboarding connection view states (mapped from the provider connection statuses). */
export const ONBOARDING_CONNECTION_VIEW_STATES = [
  'NOT_YET_CONNECTED',
  'CONNECTED_SIMULATED',
  'CONNECTED_REAL',
  'EXPIRED',
  'REVOKED',
  'UNAVAILABLE',
  'UNKNOWN',
] as const;

export type OnboardingConnectionViewState = (typeof ONBOARDING_CONNECTION_VIEW_STATES)[number];

const VIEW_STATE_SET: ReadonlySet<string> = new Set<string>(ONBOARDING_CONNECTION_VIEW_STATES);

/** Is this a well-formed onboarding connection view state? */
export function isOnboardingConnectionViewState(value: unknown): value is OnboardingConnectionViewState {
  return typeof value === 'string' && VIEW_STATE_SET.has(value);
}

/**
 * The provider connection input the view maps from — the structural
 * shape of @sos-2/github's GitHubConnectionState (statuses + simulated
 * marker), carried structurally so this package needs no dependency
 * edge on the provider package (the alignment is pinned by test).
 */
export interface ProviderConnectionInput {
  status: string;
  simulated: boolean;
  granted_scopes: string[];
  note: string;
}

/**
 * The provider-neutral connection view carried by the onboarding
 * surfaces: the view state, the scopes the journey needs (the
 * least-privilege preset), the honest note and the data-source marker.
 */
export interface OnboardingConnectionView {
  state: OnboardingConnectionViewState;
  /** True when this view is backed by the in-memory reference provider (never a real connection). */
  simulated: boolean;
  /** The least-privilege scopes the onboarding journey requests. */
  requested_scopes: string[];
  /** One honest sentence rendered with the state (the provider's own note). */
  provider_note: string;
  /** DEMO vs LIVE provenance — structural, never dropped. */
  data_source: DataSource;
}

/** Map a provider connection input onto the onboarding connection view state. */
export function connectionViewStateFromProvider(connection: ProviderConnectionInput): OnboardingConnectionViewState {
  if (connection.status === 'NOT_YET_CONNECTED') {
    return 'NOT_YET_CONNECTED';
  }
  if (connection.status === 'EXPIRED') {
    return 'EXPIRED';
  }
  if (connection.status === 'REVOKED') {
    return 'REVOKED';
  }
  if (connection.status === 'UNAVAILABLE') {
    return 'UNAVAILABLE';
  }
  if (connection.status === 'UNKNOWN') {
    return 'UNKNOWN';
  }
  if (connection.status === 'CONNECTED') {
    return connection.simulated ? 'CONNECTED_SIMULATED' : 'CONNECTED_REAL';
  }
  return 'UNKNOWN';
}

/** Build the onboarding connection view from a provider connection input. */
export function projectOnboardingConnectionView(input: {
  connection: ProviderConnectionInput;
  requested_scopes: string[];
  data_source: DataSource;
}): OnboardingConnectionView {
  return {
    state: connectionViewStateFromProvider(input.connection),
    simulated: input.connection.simulated,
    requested_scopes: [...input.requested_scopes],
    provider_note: input.connection.note,
    data_source: input.data_source,
  };
}

/** The user-facing label of a connection view state (labels are presentation, not vocabulary). */
export function onboardingConnectionLabel(state: OnboardingConnectionViewState): string {
  switch (state) {
    case 'NOT_YET_CONNECTED':
      return 'Not connected yet';
    case 'CONNECTED_SIMULATED':
      return 'Connected — SIMULATED (reference provider)';
    case 'CONNECTED_REAL':
      return 'Connected — real GitHub';
    case 'EXPIRED':
      return 'Connection expired';
    case 'REVOKED':
      return 'Connection revoked';
    case 'UNAVAILABLE':
      return 'Provider unavailable';
    case 'UNKNOWN':
      return 'Connection unknown';
  }
}
