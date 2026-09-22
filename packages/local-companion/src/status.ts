/**
 * Honest companion installation statuses (Work Order P11).
 *
 * NO real desktop companion app ships in this Work Order: the package
 * carries provider-neutral contracts plus LOCAL REFERENCE RUNTIMES
 * (deterministic, offline-testable) satisfying the same shapes — real
 * companions attach later through the same seams without contract change.
 * INSTALLATION/CONNECTION EVIDENCE IS NEVER FABRICATED: while no real
 * companion is installed the honest status is NOT_YET_INSTALLED with the
 * explicit simulated marker (the P4/P8 honesty discipline).
 */

/** The honest companion installation statuses. */
export const COMPANION_INSTALLATION_STATUSES = ['NOT_YET_INSTALLED', 'INSTALLED'] as const;

export type CompanionInstallationStatus = (typeof COMPANION_INSTALLATION_STATUSES)[number];

const STATUS_SET: ReadonlySet<string> = new Set(COMPANION_INSTALLATION_STATUSES);

/** The installation state of the local companion on the user's device. */
export interface CompanionInstallationDescriptor {
  /** The honest installation status. */
  readonly status: CompanionInstallationStatus;
  /** True when a reference/simulated runtime backs this surface (never a real companion). */
  readonly simulated: boolean;
  /** One honest sentence about this state. */
  readonly note: string;
}

/**
 * THE HONEST REFERENCE STATUS: no real desktop companion app exists in
 * this Work Order — the deterministic reference runtime satisfies the
 * same contracts, and installation evidence is never fabricated.
 */
export const REFERENCE_COMPANION_INSTALLATION: CompanionInstallationDescriptor = {
  status: 'NOT_YET_INSTALLED',
  simulated: true,
  note: 'No real desktop companion app ships in this Work Order — a deterministic LOCAL REFERENCE RUNTIME satisfies the same contracts (real companions attach later through the same seams without contract change); installation evidence is never fabricated.',
};

/** Is this a well-formed companion installation status? */
export function isCompanionInstallationStatus(value: unknown): value is CompanionInstallationStatus {
  return typeof value === 'string' && STATUS_SET.has(value);
}

/** Validate an installation descriptor (throws loudly on a fabricated shape). */
export function assertValidCompanionInstallationDescriptor(value: unknown): asserts value is CompanionInstallationDescriptor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`companion installation descriptor must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = ['status', 'simulated', 'note'];
  if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) {
    throw new Error(`companion installation descriptor must have the exact field set { ${expected.join(', ')} }`);
  }
  if (!isCompanionInstallationStatus(record['status'])) {
    throw new Error(`companion installation status must be one of ${COMPANION_INSTALLATION_STATUSES.join(', ')}`);
  }
  if (typeof record['simulated'] !== 'boolean') {
    throw new Error('companion installation simulated must be a boolean (the honesty marker)');
  }
  if (typeof record['note'] !== 'string' || record['note'].length === 0) {
    throw new Error('companion installation note must be a non-empty string');
  }
  // The honesty invariant: an INSTALLED status with the simulated marker
  // would render a simulated install as a real one — rejected loudly.
  if (record['status'] === 'INSTALLED' && record['simulated'] === true) {
    throw new Error('a SIMULATED runtime must never report status INSTALLED — connection/installation evidence is never fabricated');
  }
}
