/**
 * The authority gate (Work Order P5) — consumed, never re-implemented.
 *
 * EVERY CONSEQUENTIAL OPERATION re-evaluates the CURRENT authority grant:
 *
 *   1. each grant reference of the task's authority context resolves over
 *      the DURABLE AuthorityGrantRepository (P2) to its CURRENT HEAD
 *      revision — the supersedes chain is walked FORWARD to the latest
 *      stored revision, so a revocation recorded as a successor revision
 *      is what gets evaluated (never a stale pre-revocation artifact);
 *   2. the head is evaluated through @sos-2/authority's evaluateGrant at
 *      the injected-clock instant — the W12 ExecutionAdapter pattern;
 *   3. EXPIRED and REVOKED never authorize (typed denial, the operation
 *      never runs); a MISSING reference denies too — a grant that is not
 *      in the durable store does not exist, whatever a payload claims;
 *   4. a malformed/indeterminate stored grant fails loudly as a typed
 *      AUTHORITY_GRANT_INVALID denial (indeterminacy is never VALID).
 *
 * GRANTS COME FROM THE STORE ONLY: the fabric exposes no API through
 * which a body, a broker or a caller can supply a grant artifact — a
 * body can neither mint nor widen authority (pinned by negative tests).
 */

import { evaluateGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import type { AuthorityGrantRepository } from '@sos-2/live-store';
import { formatRfc3339 } from '@sos-2/live-store';
import { fabricDenial } from './denials.js';
import type { FabricDenial } from './denials.js';

/** The outcome of the authority gate. */
export type AuthorityGateOutcome =
  | { readonly status: 'VALID'; readonly grants: readonly AuthorityGrantArtifact[] }
  | { readonly status: 'DENIED'; readonly denial: FabricDenial };

/**
 * Resolve the CURRENT head revision of a grant chain: start at the
 * referenced artifact and follow supersedes links FORWARD over the stored
 * rows to the latest revision. (The P2 repository's history() walks
 * BACKWARD from a reference — it cannot see successors — so the fabric
 * resolves forward over list(), deterministically.) Returns undefined
 * when the reference resolves to nothing in the durable store.
 */
export async function resolveCurrentGrantHead(
  authorityGrants: AuthorityGrantRepository,
  grantRef: string,
): Promise<AuthorityGrantArtifact | undefined> {
  let current = await authorityGrants.get(grantRef);
  if (current === undefined) {
    return undefined;
  }
  const visited = new Set<string>([current.envelope.id]);
  for (;;) {
    const all = await authorityGrants.list({ limit: null });
    const successor = all.items.find((candidate) => candidate.envelope.supersedes === current!.envelope.id);
    if (successor === undefined) {
      return current;
    }
    if (visited.has(successor.envelope.id)) {
      return current; // cycle guard — evaluate the furthest resolved head
    }
    visited.add(successor.envelope.id);
    current = successor;
  }
}

/**
 * The authority gate for a task's grant references at an instant: every
 * reference must resolve to a current head that is VALID at the injected
 * time. Any failure denies with the typed code — never silent, never
 * VALID-by-accident.
 */
export async function evaluateTaskAuthority(
  authorityGrants: AuthorityGrantRepository,
  grantRefs: readonly string[],
  nowEpochMs: number,
  taskId: string,
): Promise<AuthorityGateOutcome> {
  if (grantRefs.length === 0) {
    return {
      status: 'DENIED',
      denial: fabricDenial(
        'AUTHORITY_GRANT_ABSENT',
        `task ${JSON.stringify(taskId)} carries no authority grant references — consequential operations require authority (fail closed)`,
        { task_id: taskId },
      ),
    };
  }
  const now = formatRfc3339(nowEpochMs);
  const grants: AuthorityGrantArtifact[] = [];
  for (const grantRef of grantRefs) {
    const head = await resolveCurrentGrantHead(authorityGrants, grantRef);
    if (head === undefined) {
      return {
        status: 'DENIED',
        denial: fabricDenial(
          'AUTHORITY_GRANT_MISSING',
          `grant ${JSON.stringify(grantRef)} is not in the durable authority store — grants resolve from the store ONLY; a minted or forged grant reference authorizes nothing`,
          { task_id: taskId, grant_ref: grantRef },
        ),
      };
    }
    let status: ReturnType<typeof evaluateGrant>;
    try {
      // The W12 pattern: evaluateGrant consumed verbatim.
      status = evaluateGrant(head, { kind: 'TIME', now });
    } catch (cause) {
      return {
        status: 'DENIED',
        denial: fabricDenial(
          'AUTHORITY_GRANT_INVALID',
          `grant ${JSON.stringify(grantRef)} (head ${JSON.stringify(head.envelope.id)}) failed authority evaluation: ${(cause as Error).message}`,
          { task_id: taskId, grant_ref: grantRef },
        ),
      };
    }
    if (status === 'EXPIRED') {
      return {
        status: 'DENIED',
        denial: fabricDenial(
          'AUTHORITY_GRANT_EXPIRED',
          `grant ${JSON.stringify(grantRef)} (head ${JSON.stringify(head.envelope.id)}) is EXPIRED at ${JSON.stringify(now)} — expired grants never authorize`,
          { task_id: taskId, grant_ref: grantRef },
        ),
      };
    }
    if (status === 'REVOKED') {
      return {
        status: 'DENIED',
        denial: fabricDenial(
          'AUTHORITY_GRANT_REVOKED',
          `grant ${JSON.stringify(grantRef)} (head ${JSON.stringify(head.envelope.id)}) is REVOKED — revoked grants never authorize`,
          { task_id: taskId, grant_ref: grantRef },
        ),
      };
    }
    grants.push(head);
  }
  return { status: 'VALID', grants };
}
