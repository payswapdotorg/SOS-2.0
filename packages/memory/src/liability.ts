/**
 * Technical liabilities — first-class records (Work Order W5;
 * spec/architecture.md §5: Architecture Memory carries "failures,
 * liabilities"; requirement R19: architecture and liability memory).
 *
 * A TECHNICAL LIABILITY is recorded with:
 *   - a SEVERITY from the frozen vocabulary (CRITICAL/HIGH/MEDIUM/LOW),
 *   - an OWNER-KIND from the frozen vocabulary (HUMAN/TEAM/SERVICE/
 *     GOVERNANCE — every liability is owned; an unowned liability is
 *     exactly what first-class records prevent), and
 *   - a RESOLUTION with a validated state machine:
 *
 *       OPEN -> ACKNOWLEDGED -> MITIGATED -> RESOLVED   (terminal)
 *            \                \            \-> ACCEPTED (terminal)
 *             \                \-> ACCEPTED
 *              \-> MITIGATED / RESOLVED / ACCEPTED
 *
 *     MITIGATED and RESOLVED REQUIRE resolution evidence (a mitigation or
 *     resolution claim without evidence is an assertion, and evidence
 *     outranks assertion — spec/architecture.md §18); RESOLVED additionally
 *     requires a resolution timestamp.
 *
 * Mutation discipline (enforced by the store's evolution rule, see
 * store.ts): a liability entry may NEVER be deleted and may change ONLY in
 * its resolution (with valid state transitions). Re-assessments of
 * statement, severity or owner-kind require a NEW liability entry; the old
 * record stays in the append-only history.
 */

import { RFC3339_PATTERN, isArtifactId, parseArtifactId } from '@sos-2/semantic-spine';
import { EVIDENCE_ARTIFACT_KIND } from '@sos-2/evidence';
import { MemoryError } from './errors.js';

/** The frozen severity vocabulary for technical liabilities. */
export const LIABILITY_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

export type LiabilitySeverity = (typeof LIABILITY_SEVERITIES)[number];

/** The frozen owner-kind vocabulary (a liability is always owned). */
export const LIABILITY_OWNER_KINDS = ['HUMAN', 'TEAM', 'SERVICE', 'GOVERNANCE'] as const;

export type LiabilityOwnerKind = (typeof LIABILITY_OWNER_KINDS)[number];

/** The frozen resolution state vocabulary. */
export const LIABILITY_RESOLUTION_STATES = ['OPEN', 'ACKNOWLEDGED', 'MITIGATED', 'RESOLVED', 'ACCEPTED'] as const;

export type LiabilityResolutionState = (typeof LIABILITY_RESOLUTION_STATES)[number];

/** The validated resolution state transitions (RESOLVED/ACCEPTED are terminal). */
export const ALLOWED_RESOLUTION_TRANSITIONS: Readonly<
  Record<LiabilityResolutionState, readonly LiabilityResolutionState[]>
> = {
  OPEN: ['ACKNOWLEDGED', 'MITIGATED', 'RESOLVED', 'ACCEPTED'],
  ACKNOWLEDGED: ['MITIGATED', 'RESOLVED', 'ACCEPTED'],
  MITIGATED: ['RESOLVED', 'ACCEPTED'],
  RESOLVED: [],
  ACCEPTED: [],
};

/** Whether a resolution state change is allowed (same-state is a no-op). */
export function canResolve(from: LiabilityResolutionState, to: LiabilityResolutionState): boolean {
  if (from === to) {
    return true;
  }
  return ALLOWED_RESOLUTION_TRANSITIONS[from].includes(to);
}

/** Validate a resolution state change; throws MemoryError when invalid. */
export function assertResolutionTransition(
  from: LiabilityResolutionState,
  to: LiabilityResolutionState,
): void {
  if (!canResolve(from, to)) {
    throw new MemoryError(
      `invalid liability resolution transition: ${from} -> ${to} ` +
        `(allowed from ${from}: ${ALLOWED_RESOLUTION_TRANSITIONS[from].join(', ') || 'nothing (terminal)'})`,
    );
  }
}

/** The resolution record of a technical liability. */
export interface LiabilityResolution {
  /** Current resolution state. */
  state: LiabilityResolutionState;
  /** Free-form resolution note, or null. */
  note: string | null;
  /** RFC3339 timestamp of the resolution (required for RESOLVED), or null. */
  resolved_at: string | null;
  /** Evidence references backing the resolution (required for MITIGATED/RESOLVED). */
  resolution_evidence_refs: string[];
}

function isNullOrNonEmptyString(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0);
}

/** Structural check: one of the liability severities? */
export function isLiabilitySeverity(value: unknown): value is LiabilitySeverity {
  return typeof value === 'string' && (LIABILITY_SEVERITIES as readonly string[]).includes(value);
}

/** Structural check: one of the liability owner kinds? */
export function isLiabilityOwnerKind(value: unknown): value is LiabilityOwnerKind {
  return typeof value === 'string' && (LIABILITY_OWNER_KINDS as readonly string[]).includes(value);
}

/** Structural check: one of the resolution states? */
export function isLiabilityResolutionState(value: unknown): value is LiabilityResolutionState {
  return typeof value === 'string' && (LIABILITY_RESOLUTION_STATES as readonly string[]).includes(value);
}

/** Validate a list of Evidence-kind artifact ids (the only sanctioned evidence references). */
export function assertValidEvidenceRefs(values: unknown, field: string): asserts values is string[] {
  if (!Array.isArray(values)) {
    throw new MemoryError(`${field} must be an array of Evidence artifact ids`);
  }
  for (const ref of values) {
    if (!isArtifactId(ref)) {
      throw new MemoryError(
        `${field} entries must be well-formed spine artifact ids, received: ${JSON.stringify(ref)}`,
      );
    }
    const parsed = parseArtifactId(ref);
    if (parsed.kind !== EVIDENCE_ARTIFACT_KIND) {
      throw new MemoryError(
        `${field} entries must reference Evidence artifacts (sos://Evidence/<32 hex>), received: ${JSON.stringify(ref)} (kind ${parsed.kind})`,
      );
    }
  }
}

/** Full validation of a liability resolution (throws MemoryError). */
export function assertValidLiabilityResolution(value: unknown): asserts value is LiabilityResolution {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MemoryError('liability resolution must be an object with exact fields { state, note, resolved_at, resolution_evidence_refs }');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = ['state', 'note', 'resolved_at', 'resolution_evidence_refs'];
  if (keys.length !== 4 || !expected.every((key) => keys.includes(key))) {
    throw new MemoryError(
      'liability resolution must be an object with exact fields { state, note, resolved_at, resolution_evidence_refs }',
    );
  }
  if (!isLiabilityResolutionState(record['state'])) {
    throw new MemoryError(
      `resolution state must be one of ${LIABILITY_RESOLUTION_STATES.join(', ')}, received: ${JSON.stringify(record['state'])}`,
    );
  }
  if (!isNullOrNonEmptyString(record['note'])) {
    throw new MemoryError(`resolution note must be null or a non-empty string, received: ${JSON.stringify(record['note'])}`);
  }
  if (record['resolved_at'] !== null) {
    if (typeof record['resolved_at'] !== 'string' || !RFC3339_PATTERN.test(record['resolved_at'])) {
      throw new MemoryError(
        `resolution resolved_at must be null or an RFC3339 timestamp, received: ${JSON.stringify(record['resolved_at'])}`,
      );
    }
  }
  assertValidEvidenceRefs(record['resolution_evidence_refs'], 'resolution_evidence_refs');
  const state = record['state'];
  const evidenceRefs = record['resolution_evidence_refs'];
  if ((state === 'MITIGATED' || state === 'RESOLVED') && evidenceRefs.length < 1) {
    throw new MemoryError(
      `a ${state} liability requires at least one resolution evidence reference — ` +
        'evidence outranks assertion about system reality (spec/architecture.md §18)',
    );
  }
  if (state === 'RESOLVED' && record['resolved_at'] === null) {
    throw new MemoryError('a RESOLVED liability requires a resolved_at timestamp');
  }
}

/** Predicate form of assertValidLiabilityResolution. */
export function validateLiabilityResolution(value: unknown): value is LiabilityResolution {
  try {
    assertValidLiabilityResolution(value);
    return true;
  } catch {
    return false;
  }
}

/** A fresh OPEN resolution (the creation default for a new liability). */
export function openResolution(): LiabilityResolution {
  return { state: 'OPEN', note: null, resolved_at: null, resolution_evidence_refs: [] };
}
