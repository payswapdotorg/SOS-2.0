/**
 * Owned-path scopes (Work Order P6).
 *
 * A TaskNode OWNS a set of repository paths — its exclusive write scope.
 * Concurrent assignment is only legal onto DISJOINT scopes: a collision is
 * a typed assignment denial, NEVER a silent overlap (pinned by tests).
 *
 * Scope model (deterministic, provider-neutral):
 *   - a scope entry is a relative path prefix with optional '/*' suffix
 *     ("src/a" owns everything under src/a; "src/a/*" the same);
 *   - two scopes OVERLAP when one is a path-prefix of the other (the tree
 *     discipline — a parent directory owns its children);
 *   - disjointness is pairwise: scopesOverlap(a, b) === false.
 */

import { InvalidTaskNodeError } from './errors.js';

/** Scope entries must be relative, non-empty, whitespace-free path prefixes. */
const SCOPE_ENTRY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/+-]*(\/\*)?$/;

/** Validate one owned-path scope entry (throws InvalidTaskNodeError). */
export function assertValidScopeEntry(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string' || !SCOPE_ENTRY_PATTERN.test(value)) {
    throw new InvalidTaskNodeError(
      `${what} must be a relative path scope matching ${SCOPE_ENTRY_PATTERN.source} (e.g. "packages/app" or "packages/app/*"), received: ${JSON.stringify(value)}`,
    );
  }
  if (value.includes('//')) {
    throw new InvalidTaskNodeError(`${what} must not contain empty segments ("//"): ${JSON.stringify(value)}`);
  }
}

/** Validate a full owned-path scope list (non-empty, duplicate-free). */
export function assertValidOwnedPaths(value: unknown, what: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidTaskNodeError(`${what} must be a non-empty array of owned path scopes — every task owns an exclusive scope`);
  }
  const seen = new Set<string>();
  for (const entry of value) {
    assertValidScopeEntry(entry, what);
    if (seen.has(entry)) {
      throw new InvalidTaskNodeError(`${what} contains the duplicate scope ${JSON.stringify(entry)}`);
    }
    seen.add(entry);
  }
}

/** Normalize a scope entry to its directory-prefix form (drops a '/*' suffix). */
function scopePrefix(entry: string): string {
  return entry.endsWith('/*') ? entry.slice(0, -2) : entry;
}

/** Split a scope prefix into path segments. */
function segments(prefix: string): string[] {
  return prefix.split('/');
}

/**
 * Do two scope entries overlap? (One is a path-prefix of the other —
 * the tree discipline: owning "src" owns everything under "src".)
 */
export function scopesOverlap(a: string, b: string): boolean {
  const sa = segments(scopePrefix(a));
  const sb = segments(scopePrefix(b));
  const shorter = Math.min(sa.length, sb.length);
  for (let index = 0; index < shorter; index += 1) {
    if (sa[index] !== sb[index]) {
      return false;
    }
  }
  return true;
}

/** Do two owned-path scope LISTS overlap anywhere? */
export function scopesCollide(a: readonly string[], b: readonly string[]): boolean {
  return a.some((entryA) => b.some((entryB) => scopesOverlap(entryA, entryB)));
}

/** The first colliding pair, or null (deterministic order — for denial details). */
export function firstCollision(a: readonly string[], b: readonly string[]): { a: string; b: string } | null {
  for (const entryA of a) {
    for (const entryB of b) {
      if (scopesOverlap(entryA, entryB)) {
        return { a: entryA, b: entryB };
      }
    }
  }
  return null;
}

/** Are two owned-path scope lists pairwise disjoint? */
export function scopesDisjoint(a: readonly string[], b: readonly string[]): boolean {
  return !scopesCollide(a, b);
}
