/**
 * Assurance obligations (spec/architecture.md §5: a Package carries
 * "assurance obligations"; §13 lists the assurance mechanisms).
 *
 * Every package — even a freshly DISCOVERED one — declares what assurance
 * it owes before its reuse is trusted. The kind vocabulary is the §13
 * mechanism list, frozen:
 *
 *   STATIC_ANALYSIS, TEST, PROPERTY_CHECK, REPLAY, SIMULATION,
 *   FAULT_INJECTION, RUNTIME_VERIFICATION, SHADOW, CANARY,
 *   CONTROLLED_EXPERIMENT
 *
 * Obligations are statements (non-empty), not booleans: an obligation says
 * WHAT must be shown, by which mechanism, before the package's reuse
 * bypasses assurance (spec/architecture-lock.md forbids "package reuse
 * bypassing compatibility or assurance").
 */

import { PackageError } from './errors.js';

export const ASSURANCE_OBLIGATION_KINDS = [
  'STATIC_ANALYSIS',
  'TEST',
  'PROPERTY_CHECK',
  'REPLAY',
  'SIMULATION',
  'FAULT_INJECTION',
  'RUNTIME_VERIFICATION',
  'SHADOW',
  'CANARY',
  'CONTROLLED_EXPERIMENT',
] as const;

export type AssuranceObligationKind = (typeof ASSURANCE_OBLIGATION_KINDS)[number];

const ASSURANCE_OBLIGATION_KIND_SET: ReadonlySet<string> = new Set(ASSURANCE_OBLIGATION_KINDS);

export function isAssuranceObligationKind(value: unknown): value is AssuranceObligationKind {
  return typeof value === 'string' && ASSURANCE_OBLIGATION_KIND_SET.has(value);
}

/** A single assurance obligation owed by a package/composition. */
export interface AssuranceObligation {
  /** One of the 10 frozen §13 mechanism kinds. */
  kind: AssuranceObligationKind;
  /** The obligation statement (non-empty): what must be shown, when. */
  obligation: string;
}

export function assertValidAssuranceObligation(value: unknown): asserts value is AssuranceObligation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PackageError(`assurance obligation must be an object { kind, obligation }, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !('kind' in record) || !('obligation' in record)) {
    throw new PackageError('assurance obligation must have the exact field set { kind, obligation }');
  }
  if (!isAssuranceObligationKind(record['kind'])) {
    throw new PackageError(
      `assurance obligation kind must be one of ${ASSURANCE_OBLIGATION_KINDS.join(', ')}, received: ${JSON.stringify(record['kind'])}`,
    );
  }
  if (typeof record['obligation'] !== 'string' || record['obligation'].length === 0) {
    throw new PackageError(`assurance obligation statement must be a non-empty string, received: ${JSON.stringify(record['obligation'])}`);
  }
}

/** Validate a non-empty obligation list (packages without obligations are rejected). */
export function assertValidAssuranceObligations(value: unknown): asserts value is AssuranceObligation[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PackageError(
      'at least one assurance obligation is required — package reuse may never bypass assurance ' +
        '(spec/architecture-lock.md)',
    );
  }
  for (const obligation of value) {
    assertValidAssuranceObligation(obligation);
  }
}
