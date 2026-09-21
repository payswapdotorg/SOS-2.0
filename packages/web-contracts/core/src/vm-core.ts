/**
 * The shared core of every consequential product view model (P1 task
 * packet: "Every view model carries: what, why (rationale chain), evidence
 * refs, uncertainty, authority, next allowed action").
 *
 * The rationale chain type is IMPORTED from @sos-2/ui-contracts (the W11
 * view-model layer — typed spine trace links over the 17 frozen types, with
 * the documented direction typology); the uncertainty classes are IMPORTED
 * from @sos-2/evidence. Nothing is redefined here.
 */

import { isArtifactId } from '@sos-2/semantic-spine';
import type { UncertaintyClass } from '@sos-2/evidence';
import { isUncertaintyClass } from '@sos-2/evidence';
import type { RationaleChain } from '@sos-2/ui-contracts';
import { assertValidRationaleChain } from '@sos-2/ui-contracts';
import type { AuthorityView } from './authority-view.js';
import { assertValidAuthorityView } from './authority-view.js';
import type { DataSource } from './data-source.js';
import { assertValidDataSource } from './data-source.js';
import { WebContractError } from './errors.js';
import type { NextActionView } from './next-action.js';
import { assertValidNextActionView } from './next-action.js';

/**
 * The uncertainty view: the frozen qualitative uncertainty class (imported
 * from @sos-2/evidence) plus the honest statement of what remains
 * uncertain. "No score hides uncertainty" (productization requirements) —
 * the class is a vocabulary word, never a fabricated number.
 */
export interface UncertaintyView {
  uncertainty_class: UncertaintyClass;
  /** What remains uncertain, in one honest sentence. */
  statement: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validate an UncertaintyView (throws WebContractError). */
export function assertValidUncertaintyView(value: unknown): asserts value is UncertaintyView {
  if (!isPlainObject(value)) {
    throw new WebContractError(`uncertainty view must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set(['uncertainty_class', 'statement']);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new WebContractError('uncertainty view must have the exact field set { uncertainty_class, statement }');
  }
  if (!isUncertaintyClass(record['uncertainty_class'])) {
    throw new WebContractError(
      `uncertainty view class must be a frozen uncertainty class (STRONG, MODERATE, WEAK, UNQUANTIFIED), received: ${JSON.stringify(record['uncertainty_class'])}`,
    );
  }
  if (!isNonEmptyString(record['statement'])) {
    throw new WebContractError('uncertainty view statement must be a non-empty string');
  }
}

/**
 * The fields every consequential product view model carries. `subject_id`
 * is the spine artifact this view model is ABOUT (the rationale chain binds
 * it); for view-level surfaces without their own spine artifact yet (active
 * tasks, body leases, observation status — the execution-fabric Work
 * Orders P6/P7/P12 own those contracts), the rationale chain binds the
 * spine subject the surface SERVES and that subject's id is carried here.
 */
export interface ProductVmCore {
  /** The spine artifact id this view model explains (rationale subject). */
  subject_id: string;
  /** DEMO vs LIVE provenance — the demo marker is structural (never dropped). */
  data_source: DataSource;
  /** The why: typed spine trace links (upstream/downstream) + evidence refs. */
  rationale: RationaleChain;
  /** The exact spine Evidence ids supporting this view model (sorted, unique). */
  evidence_refs: string[];
  /** What remains uncertain. */
  uncertainty: UncertaintyView;
  /** What authority this surface needs. */
  authority: AuthorityView;
  /** What can happen next. */
  next_allowed_action: NextActionView;
}

/**
 * Validate the shared core (throws WebContractError): well-formed spine
 * subject, valid data source (with the demo marker intact when DEMO), a
 * valid rationale chain that BINDS the subject, sorted-unique spine
 * evidence refs, and valid uncertainty/authority/next-action views.
 */
export function assertValidProductVmCore(value: unknown): asserts value is ProductVmCore {
  if (!isPlainObject(value)) {
    throw new WebContractError(`product view-model core must be an object, received: ${JSON.stringify(value)}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set([
    'subject_id',
    'data_source',
    'rationale',
    'evidence_refs',
    'uncertainty',
    'authority',
    'next_allowed_action',
  ]);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new WebContractError(
      'product view-model core must have the exact field set { subject_id, data_source, rationale, evidence_refs, uncertainty, authority, next_allowed_action }',
    );
  }
  if (!isNonEmptyString(record['subject_id']) || !isArtifactId(record['subject_id'])) {
    throw new WebContractError(
      `product view-model subject_id must be a well-formed spine artifact id, received: ${JSON.stringify(record['subject_id'])}`,
    );
  }
  assertValidDataSource(record['data_source']);
  try {
    assertValidRationaleChain(record['rationale']);
  } catch (cause) {
    throw new WebContractError(`product view-model rationale is invalid: ${(cause as Error).message}`);
  }
  if ((record['rationale'] as RationaleChain).subject_id !== record['subject_id']) {
    throw new WebContractError('product view-model rationale must bind the view model subject');
  }
  if (!Array.isArray(record['evidence_refs'])) {
    throw new WebContractError('product view-model evidence_refs must be an array of spine Evidence ids');
  }
  const refs = record['evidence_refs'] as string[];
  for (const ref of refs) {
    if (!isNonEmptyString(ref) || !isArtifactId(ref)) {
      throw new WebContractError(
        `product view-model evidence_refs entries must be well-formed spine artifact ids, received: ${JSON.stringify(ref)}`,
      );
    }
  }
  const sorted = [...refs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (JSON.stringify(sorted) !== JSON.stringify([...new Set(sorted)]) || JSON.stringify(refs) !== JSON.stringify(sorted)) {
    throw new WebContractError('product view-model evidence_refs must be sorted and unique (determinism discipline)');
  }
  try {
    assertValidUncertaintyView(record['uncertainty']);
  } catch (cause) {
    throw new WebContractError(`product view-model uncertainty is invalid: ${(cause as Error).message}`);
  }
  try {
    assertValidAuthorityView(record['authority']);
  } catch (cause) {
    throw new WebContractError(`product view-model authority is invalid: ${(cause as Error).message}`);
  }
  try {
    assertValidNextActionView(record['next_allowed_action']);
  } catch (cause) {
    throw new WebContractError(`product view-model next action is invalid: ${(cause as Error).message}`);
  }
}
