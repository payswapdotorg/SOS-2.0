/**
 * Honest adapter connection statuses (Work Order P8).
 *
 * NO real cloud accounts exist in this Work Order: every REAL provider
 * endpoint is honestly NOT_YET_CONNECTED (validation provider accounts
 * pending) — connection evidence is NEVER fabricated. When a reference
 * or scripted transport backs an adapter (tests, local development), the
 * connection carries the explicit SIMULATED marker so a simulated
 * connection can never render as a real one (the P4 github-connection
 * honesty discipline).
 */

/** The honest adapter connection statuses. */
export const ADAPTER_CONNECTION_STATUSES = ['NOT_YET_CONNECTED', 'CONNECTED', 'UNAVAILABLE', 'UNKNOWN'] as const;

export type AdapterConnectionStatus = (typeof ADAPTER_CONNECTION_STATUSES)[number];

const STATUS_SET: ReadonlySet<string> = new Set(ADAPTER_CONNECTION_STATUSES);

/** The connection state of one provider adapter. */
export interface AdapterConnection {
  readonly status: AdapterConnectionStatus;
  /** True when a reference/simulated transport backs this connection (never a real provider). */
  readonly simulated: boolean;
  /** One honest sentence about this state (rendered with it). */
  readonly note: string;
}

/**
 * The honest real-provider status: no real endpoint is attached
 * (validation provider accounts pending); connection evidence is never
 * fabricated.
 */
export const ADAPTER_NOT_YET_CONNECTED: AdapterConnection = {
  status: 'NOT_YET_CONNECTED',
  simulated: false,
  note: 'No real provider endpoint is attached yet (validation provider accounts pending) — the adapter is wired to no provider and connection evidence is never fabricated.',
};

/** The simulated connection of a reference/in-process transport (tests, local development). */
export function simulatedAdapterConnection(note?: string): AdapterConnection {
  return {
    status: 'CONNECTED',
    simulated: true,
    note:
      note ??
      'A reference/in-process transport backs this adapter (SIMULATED connection — never a real provider; real endpoints attach later through the same adapter without contract change).',
  };
}

/** An honest unavailable connection (a real endpoint exists and is down). */
export function unavailableAdapterConnection(reason: string): AdapterConnection {
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new Error('an unavailable adapter connection requires a non-empty reason');
  }
  return { status: 'UNAVAILABLE', simulated: false, note: reason };
}

/** Is this a well-formed adapter connection status? */
export function isAdapterConnectionStatus(value: unknown): value is AdapterConnectionStatus {
  return typeof value === 'string' && STATUS_SET.has(value);
}

/** Validate an adapter connection (throws loudly on a fabricated shape). */
export function assertValidAdapterConnection(value: unknown): asserts value is AdapterConnection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`adapter connection must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = ['status', 'simulated', 'note'];
  if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) {
    throw new Error(`adapter connection must have the exact field set { ${expected.join(', ')} }`);
  }
  if (!isAdapterConnectionStatus(record['status'])) {
    throw new Error(`adapter connection status must be one of ${ADAPTER_CONNECTION_STATUSES.join(', ')}`);
  }
  if (typeof record['simulated'] !== 'boolean') {
    throw new Error('adapter connection simulated must be a boolean (the honesty marker)');
  }
  if (typeof record['note'] !== 'string' || record['note'].length === 0) {
    throw new Error('adapter connection note must be a non-empty string');
  }
}
