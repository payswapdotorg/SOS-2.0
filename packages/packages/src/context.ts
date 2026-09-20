/**
 * Context conditions — the context side of context-conditioned applicability
 * (spec/architecture.md §12: "Package/candidate performance is
 * context-conditioned"; R26).
 *
 * A ContextCondition is a flat record of non-empty string keys to non-empty
 * string values describing the operative context (platform, region, scale,
 * workload class, deployment tier, ...). Values are strings (not numbers) by
 * design: conditions are MATCH KEYS, not measurements; two contexts match
 * exactly when their key/value pairs agree. Canonical serialization of the
 * spine makes record ordering irrelevant.
 *
 * UNIVERSAL-SCORE RULE (machine-enforced): an EMPTY context condition is
 * rejected wherever a context-conditioned estimate is required. An estimate
 * that applies to every context is a universal score — exactly what
 * spec/architecture.md §12 and docs/package-ecology.md forbid ("Do not use a
 * universal score").
 *
 * Matching semantics (documented, deterministic):
 *   matchesCondition(estimate, query)  — the estimate's condition is a
 *   SUB-MAP of the query's condition: every key the estimate conditions on
 *   must appear in the query with the same value. A more specific estimate
 *   (more keys) matches fewer queries; specificity is measurable
 *   (contextSpecificity) and is used for deterministic best-estimate
 *   selection in retrieval.
 */

import { canonicalSerialize } from '@sos-2/semantic-spine';
import { PackageError } from './errors.js';

/** A flat context condition: non-empty string keys -> non-empty string values. */
export type ContextCondition = Record<string, string>;

/** Validate a context condition: a non-empty record of non-empty strings. */
export function assertValidContextCondition(value: unknown, field: string): asserts value is ContextCondition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PackageError(`${field} must be a non-empty object of context keys to string values`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) {
    throw new PackageError(
      `${field} must condition on at least one context key — an empty context condition is a universal score, ` +
        'which spec/architecture.md §12 forbids for package applicability',
    );
  }
  for (const key of keys) {
    if (key.length === 0) {
      throw new PackageError(`${field} context keys must be non-empty strings`);
    }
    const entry = record[key];
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new PackageError(
        `${field}[${JSON.stringify(key)}] must be a non-empty string, received: ${JSON.stringify(entry)}`,
      );
    }
  }
}

/** Predicate form of assertValidContextCondition. */
export function isValidContextCondition(value: unknown): value is ContextCondition {
  try {
    assertValidContextCondition(value, 'context');
    return true;
  } catch {
    return false;
  }
}

/** Does the estimate condition (subset) match the query context (superset)? */
export function matchesCondition(condition: ContextCondition, query: ContextCondition): boolean {
  for (const [key, value] of Object.entries(condition)) {
    if (query[key] !== value) {
      return false;
    }
  }
  return true;
}

/** Number of keys a condition conditions on (specificity; higher = more specific). */
export function contextSpecificity(condition: ContextCondition): number {
  return Object.keys(condition).length;
}

/** Canonical text of a condition (spine canonical serialization; key order irrelevant). */
export function canonicalConditionText(condition: ContextCondition): string {
  return canonicalSerialize(condition);
}

/** Two conditions are EQUAL as maps (order-insensitive, value-exact). */
export function sameCondition(a: ContextCondition, b: ContextCondition): boolean {
  return canonicalConditionText(a) === canonicalConditionText(b);
}
