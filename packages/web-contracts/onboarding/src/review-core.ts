/**
 * The onboarding view-model contracts (Work Order P4) — the shared core
 * every onboarding view model carries: the six product review questions
 * (what, why, evidence refs, uncertainty, authority, next allowed
 * action) in their PRE-ARTIFACT form.
 *
 * DISCIPLINE (mirrors the P1 core/ contract exactly): pure types + pure
 * functions, ZERO domain logic, ZERO DOM. Every vocabulary (uncertainty
 * classes, grant permissions, artifact ids, truth states) is IMPORTED
 * from the owning @sos-2/* packages through @sos-2/web-contracts' own
 * dependency surface — never redefined.
 *
 * Why a pre-artifact core: an onboarding journey STARTS before any spine
 * artifact exists (the user types a purpose before a Mission artifact
 * can). The P1 ProductVmCore binds a well-formed spine subject with a
 * typed rationale chain — the right contract for surfaces that are
 * ABOUT existing artifacts. In-progress journey stages are about the
 * JOURNEY itself, so their view models carry the six review fields over
 * a stable view subject id ('onboarding:<journey>:<subject>') with an
 * honest typed explanation instead of a fabricated spine chain. The
 * moment the journey formalizes its artifacts, the terminal view models
 * switch to the full P1 ProductVmCore (spine subject + rationale chain
 * + spine evidence refs) — see greenfield.ts. This mirrors how P1
 * treated not-yet-frozen runtime subjects (view-level records with
 * plain ids, never invented spine identities).
 */

import type { GrantPermission } from '@sos-2/authority';
import type { DataSource } from '@sos-2/web-contracts';
import { assertValidDataSource } from '@sos-2/web-contracts';
import type { AuthorityView, NextActionView, UncertaintyView } from '@sos-2/web-contracts';
import { assertValidAuthorityView, assertValidNextActionView, assertValidUncertaintyView } from '@sos-2/web-contracts';

/**
 * The pre-artifact explanation of WHY this stage exists and what it is
 * based on — typed, honest, never a fabricated spine chain. `basis`
 * names the journey rule that requires this stage; `basis_refs` may
 * reference spine artifacts when they exist (e.g. the constitution
 * anchor) and is empty otherwise.
 */
export interface OnboardingRationaleView {
  /** The journey rule this stage implements (one honest sentence). */
  basis: string;
  /** Spine artifact ids this explanation references (may be empty — never fabricated). */
  basis_refs: string[];
}

/** The onboarding review core: the six product review questions. */
export interface OnboardingVmCore {
  /** The stable view subject id, e.g. 'onboarding:greenfield:purpose'. */
  subject_id: string;
  /** DEMO vs LIVE provenance — the structural marker (never dropped). */
  data_source: DataSource;
  /** What is happening (one honest sentence). */
  what: string;
  /** Why SOS believes this / why this stage exists (typed explanation). */
  why: OnboardingRationaleView;
  /** Spine Evidence ids supporting this view (empty is honest pre-artifact; sorted + unique). */
  evidence_refs: string[];
  /** What remains uncertain. */
  uncertainty: UncertaintyView;
  /** What authority this surface needs. */
  authority: AuthorityView;
  /** What can happen next. */
  next_allowed_action: NextActionView;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

const ONBOARDING_SUBJECT_PATTERN = /^onboarding:(greenfield|brownfield|advanced):[a-z][a-z0-9-]*$/;

/** Is this a well-formed onboarding view subject id? */
export function isOnboardingSubjectId(value: unknown): value is string {
  return typeof value === 'string' && ONBOARDING_SUBJECT_PATTERN.test(value);
}

/** Validate an OnboardingVmCore (throws WebContractError from the P1 core). */
export function assertValidOnboardingVmCore(value: unknown): asserts value is OnboardingVmCore {
  if (!isPlainObject(value)) {
    throw new Error(`onboarding view-model core must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set([
    'subject_id',
    'data_source',
    'what',
    'why',
    'evidence_refs',
    'uncertainty',
    'authority',
    'next_allowed_action',
  ]);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new Error(
      'onboarding view-model core must have the exact field set { subject_id, data_source, what, why, evidence_refs, uncertainty, authority, next_allowed_action }',
    );
  }
  if (!isOnboardingSubjectId(record['subject_id'])) {
    throw new Error(
      `onboarding view-model subject_id must match onboarding:(greenfield|brownfield|advanced):<segment>, received: ${JSON.stringify(record['subject_id'])}`,
    );
  }
  assertValidDataSource(record['data_source']);
  if (!isNonEmptyString(record['what'])) {
    throw new Error('onboarding view-model what must be a non-empty sentence');
  }
  const why = record['why'];
  if (!isPlainObject(why) || !isNonEmptyString(why['basis']) || !Array.isArray(why['basis_refs'])) {
    throw new Error('onboarding view-model why must be { basis, basis_refs }');
  }
  if (!Array.isArray(record['evidence_refs'])) {
    throw new Error('onboarding view-model evidence_refs must be an array of spine Evidence ids (possibly empty)');
  }
  const refs = record['evidence_refs'] as string[];
  const sorted = [...refs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (JSON.stringify(refs) !== JSON.stringify([...new Set(sorted)])) {
    throw new Error('onboarding view-model evidence_refs must be sorted and unique (determinism discipline)');
  }
  assertValidUncertaintyView(record['uncertainty']);
  assertValidAuthorityView(record['authority']);
  assertValidNextActionView(record['next_allowed_action']);
}

/**
 * The permission the onboarding confirmation gates require. The frozen
 * GRANT_PERMISSIONS vocabulary owns the words: formalizing a mission and
 * importing repository state are durable semantic writes — REVISE-class
 * authority. The gate never evaluates grants (that is @sos-2/authority's
 * job); it presents the requirement honestly.
 */
export const ONBOARDING_CONFIRMATION_PERMISSION: GrantPermission = 'REVISE';

/** The a11y/keyboard contract: the minimum touch target (mirrors the P1 shell constant). */
export const ONBOARDING_MIN_TOUCH_TARGET_PX = 44;
