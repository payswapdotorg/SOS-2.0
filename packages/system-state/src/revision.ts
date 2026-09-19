/**
 * Exact revisions — the W2 strengthening of spec/architecture.md §5
 * ("System State: architecture, implementation, configuration, deployment,
 * policy, environment relationships, active experiments and package
 * realizations") and spec/architecture.md §18 ("Every promoted change is
 * reproducible from exact revisions and evidence"):
 *
 *     every referenced implementation / deployment / configuration carries
 *     an EXACT revision. A SystemState without exact revisions is invalid.
 *
 * Revision kinds map 1:1 to the reference types they qualify:
 *   - implementation references  -> git-sha       (exact source revision)
 *   - deployment references      -> deployment-id (exact deployment identity)
 *   - configuration references   -> config-version (exact configuration version)
 *
 * The mapping is ENFORCED (a configuration reference carrying a "git-sha"
 * revision is a type error, not a silent pass). The three-kind vocabulary is
 * frozen; it is deliberately small and closed.
 */

import { SystemStateError } from './errors.js';

export const REVISION_KINDS = ['git-sha', 'deployment-id', 'config-version'] as const;

export type RevisionKind = (typeof REVISION_KINDS)[number];

const REVISION_KIND_SET: ReadonlySet<string> = new Set(REVISION_KINDS);

export function isRevisionKind(value: unknown): value is RevisionKind {
  return typeof value === 'string' && REVISION_KIND_SET.has(value);
}

/** The revision kind required for implementation references. */
export const IMPLEMENTATION_REVISION_KIND: RevisionKind = 'git-sha';

/** The revision kind required for deployment references. */
export const DEPLOYMENT_REVISION_KIND: RevisionKind = 'deployment-id';

/** The revision kind required for configuration references. */
export const CONFIGURATION_REVISION_KIND: RevisionKind = 'config-version';

export interface ExactRevision {
  /** One of the three frozen revision kinds. */
  kind: RevisionKind;
  /** Exact, non-empty revision value (sha / deployment id / config version). */
  value: string;
}

const REVISION_KEYS = ['kind', 'value'] as const;

export function isExactRevision(value: unknown): value is ExactRevision {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== REVISION_KEYS.length) {
    return false;
  }
  if (!REVISION_KEYS.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return false;
  }
  if (!isRevisionKind(record.kind)) {
    return false;
  }
  if (typeof record.value !== 'string' || record.value.length === 0) {
    return false;
  }
  return true;
}

/** Full semantic validation with a specific error message (throws SystemStateError). */
export function assertExactRevision(value: unknown, field: string): asserts value is ExactRevision {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SystemStateError(`${field} revision must be an ExactRevision object { kind, value }`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) {
    throw new SystemStateError(`${field} revision must have the exact field set { kind, value }`);
  }
  if (!isRevisionKind(record.kind)) {
    throw new SystemStateError(
      `${field} revision kind must be one of ${REVISION_KINDS.join(', ')}, received: ${JSON.stringify(record.kind)}`,
    );
  }
  if (typeof record.value !== 'string' || record.value.length === 0) {
    throw new SystemStateError(`${field} revision value must be a non-empty string (exact revisions only)`);
  }
}

/** Assert a revision is of the required kind for its reference type. */
export function assertRevisionKind(revision: ExactRevision, field: string, required: RevisionKind): void {
  if (revision.kind !== required) {
    throw new SystemStateError(
      `${field} revision must be of kind "${required}" (received "${revision.kind}"); ` +
        `typed reference/revision mapping is enforced: git-sha for implementation, ` +
        `deployment-id for deployment, config-version for configuration`,
    );
  }
}

export function validateExactRevision(value: unknown, field: string): value is ExactRevision {
  try {
    assertExactRevision(value, field);
    return true;
  } catch {
    return false;
  }
}
