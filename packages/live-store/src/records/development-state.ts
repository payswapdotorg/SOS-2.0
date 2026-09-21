/**
 * Development state records (Work Order P2).
 *
 * The productization program's own machine state (the
 * spec/productization-state/implementation-state.json family) is OPERATIONAL
 * state, not frozen W0-W18 semantics: the store persists it as an opaque
 * canonical-JSON snapshot under an explicit state id and revision,
 * preserving bytes verbatim (optimistic concurrency applies). The store
 * never interprets development-state content.
 */

import { canonicalSerialize } from '@sos-2/semantic-spine';
import { InvalidRecordError } from '../errors.js';
import type { JsonValue } from '@sos-2/semantic-spine';

export const DEVELOPMENT_STATE_NAMESPACE = 'development-state';

const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/** A revisioned, opaque development-state snapshot. */
export interface DevelopmentStateRecord {
  /** State identity (e.g. "productization-implementation-state"). */
  state_id: string;
  /** Optimistic-concurrency revision (integer >= 1). */
  revision: number;
  /** Human description, or null. */
  description: string | null;
  /** The opaque canonical-JSON state snapshot, stored verbatim. */
  state: JsonValue;
  /** Last update instant, RFC3339. */
  updated_at: string;
}

const DEVELOPMENT_STATE_KEYS = ['state_id', 'revision', 'description', 'state', 'updated_at'] as const;

/** Full validation of a development-state record (throws InvalidRecordError). */
export function assertValidDevelopmentStateRecord(value: unknown): asserts value is DevelopmentStateRecord {
  if (!isPlainObject(value)) {
    throw new InvalidRecordError(DEVELOPMENT_STATE_NAMESPACE, 'development state record must be an object');
  }
  if (!hasExactKeys(value, DEVELOPMENT_STATE_KEYS)) {
    throw new InvalidRecordError(
      DEVELOPMENT_STATE_NAMESPACE,
      `development state record must have the exact field set { ${DEVELOPMENT_STATE_KEYS.join(', ')} }`,
    );
  }
  if (typeof value['state_id'] !== 'string' || value['state_id'].length === 0) {
    throw new InvalidRecordError(DEVELOPMENT_STATE_NAMESPACE, `state_id must be a non-empty string, received: ${JSON.stringify(value['state_id'])}`);
  }
  if (typeof value['revision'] !== 'number' || !Number.isInteger(value['revision']) || value['revision'] < 1) {
    throw new InvalidRecordError(DEVELOPMENT_STATE_NAMESPACE, `revision must be an integer >= 1, received: ${JSON.stringify(value['revision'])}`);
  }
  if (value['description'] !== null && (typeof value['description'] !== 'string' || value['description'].length === 0)) {
    throw new InvalidRecordError(DEVELOPMENT_STATE_NAMESPACE, `description must be null or a non-empty string, received: ${JSON.stringify(value['description'])}`);
  }
  try {
    canonicalSerialize(value['state']);
  } catch {
    throw new InvalidRecordError(DEVELOPMENT_STATE_NAMESPACE, 'state must be a canonical-JSON value');
  }
  if (typeof value['updated_at'] !== 'string' || !RFC3339_PATTERN.test(value['updated_at'])) {
    throw new InvalidRecordError(DEVELOPMENT_STATE_NAMESPACE, `updated_at must be RFC3339, received: ${JSON.stringify(value['updated_at'])}`);
  }
}
