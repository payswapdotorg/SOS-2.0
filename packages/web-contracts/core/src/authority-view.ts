/**
 * Authority-mode view states and the authority view carried by every
 * product view model (docs/ux/sharenet-inspired-design.md "Persistent
 * status: ... authority mode").
 *
 * The PERMISSION vocabulary is IMPORTED from @sos-2/authority
 * (GRANT_PERMISSIONS) — never redefined here. The authority MODES are
 * product-shell VIEW states owned by this package: they describe how the
 * console presents SOS's current action latitude, they are not domain
 * semantics and they do not evaluate grants (grant evaluation stays in
 * @sos-2/authority; the action gateway that will consume these view states
 * is Work Order P9).
 */

import { GRANT_PERMISSIONS } from '@sos-2/authority';
import type { GrantPermission } from '@sos-2/authority';
import { isArtifactId } from '@sos-2/semantic-spine';
import { WebContractError } from './errors.js';

/** The product-shell authority modes (view states, not domain semantics). */
export const AUTHORITY_MODE_VIEWS = [
  'AUTONOMOUS_WITH_ASK',
  'SUPERVISED',
  'READ_ONLY',
] as const;

export type AuthorityModeView = (typeof AUTHORITY_MODE_VIEWS)[number];

const AUTHORITY_MODE_SET: ReadonlySet<string> = new Set(AUTHORITY_MODE_VIEWS);

export function isAuthorityModeView(value: unknown): value is AuthorityModeView {
  return typeof value === 'string' && AUTHORITY_MODE_SET.has(value);
}

/** The distinct user-facing label of an authority mode. */
export function authorityModeLabel(mode: AuthorityModeView): string {
  switch (mode) {
    case 'AUTONOMOUS_WITH_ASK':
      return 'Autonomous — asks when uncertain';
    case 'SUPERVISED':
      return 'Supervised — approval required';
    case 'READ_ONLY':
      return 'Observing only';
  }
}

/** The one-line explanation shown under the label (the status strip detail). */
export function authorityModeNote(mode: AuthorityModeView): string {
  switch (mode) {
    case 'AUTONOMOUS_WITH_ASK':
      return 'SOS acts within granted authority and escalates questions it cannot answer with evidence.';
    case 'SUPERVISED':
      return 'Consequential actions wait for human approval before SOS executes them.';
    case 'READ_ONLY':
      return 'SOS observes and explains; no autonomous changes are being made.';
  }
}

/** All frozen grant permissions, in the owning package's order (legends). */
export function allGrantPermissions(): GrantPermission[] {
  return [...GRANT_PERMISSIONS];
}

/**
 * The authority view carried by every consequential product view model:
 * what mode SOS is in for this surface, what permission the subject's next
 * step requires (from the frozen GRANT_PERMISSIONS vocabulary), and the
 * exact spine id of the grant when one is held. `required_permission` may be
 * null for surfaces whose next step needs no permission (pure navigation or
 * review).
 */
export interface AuthorityView {
  mode: AuthorityModeView;
  /** The frozen permission the next step requires, or null when none is required. */
  required_permission: GrantPermission | null;
  /** The spine AuthorityGrant id held for this subject, or null when none is held. */
  grant_ref: string | null;
  /** What authority this surface needs, in one honest sentence. */
  note: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

const PERMISSION_SET: ReadonlySet<string> = new Set(GRANT_PERMISSIONS);

/** Validate an AuthorityView (throws WebContractError). */
export function assertValidAuthorityView(value: unknown): asserts value is AuthorityView {
  if (!isPlainObject(value)) {
    throw new WebContractError(`authority view must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set(['mode', 'required_permission', 'grant_ref', 'note']);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new WebContractError('authority view must have the exact field set { mode, required_permission, grant_ref, note }');
  }
  if (!isAuthorityModeView(record['mode'])) {
    throw new WebContractError(
      `authority view mode must be one of ${AUTHORITY_MODE_VIEWS.join(', ')}, received: ${JSON.stringify(record['mode'])}`,
    );
  }
  if (record['required_permission'] !== null && !PERMISSION_SET.has(record['required_permission'] as string)) {
    throw new WebContractError(
      `authority view required_permission must be a frozen grant permission (${GRANT_PERMISSIONS.join(', ')}) or null, received: ${JSON.stringify(record['required_permission'])}`,
    );
  }
  if (record['grant_ref'] !== null && (!isNonEmptyString(record['grant_ref']) || !isArtifactId(record['grant_ref']))) {
    throw new WebContractError('authority view grant_ref must be null or a well-formed spine artifact id');
  }
  if (!isNonEmptyString(record['note'])) {
    throw new WebContractError('authority view note must be a non-empty string');
  }
}
