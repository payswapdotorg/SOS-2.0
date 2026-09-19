/**
 * Grant permissions — the vocabulary of what an AuthorityGrant can permit.
 *
 * W1 realization (frozen vocabulary; extension is a semantic change and goes
 * through the Architecture Change Process):
 *
 *   READ     — read access to the scoped artifacts
 *   REVISE   — create new revisions (e.g. the mission revision workflow)
 *   RETIRE   — retire the scoped artifacts (lifecycle transition)
 *   PROMOTE  — promote/activate scoped artifacts past a gate
 *   DELEGATE — mint strictly-narrower sub-grants (see delegate.ts)
 */

export const GRANT_PERMISSIONS = ['READ', 'REVISE', 'RETIRE', 'PROMOTE', 'DELEGATE'] as const;

export type GrantPermission = (typeof GRANT_PERMISSIONS)[number];

const GRANT_PERMISSION_SET: ReadonlySet<string> = new Set(GRANT_PERMISSIONS);

export function isGrantPermission(value: unknown): value is GrantPermission {
  return typeof value === 'string' && GRANT_PERMISSION_SET.has(value);
}
