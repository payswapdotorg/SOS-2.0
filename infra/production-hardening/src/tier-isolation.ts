/**
 * Preview/production isolation assertions (Work Order P14).
 *
 * PINNED: PREVIEW CANNOT MUTATE PRODUCTION. This module extends the P3
 * environment isolation discipline (infra/deployment/src/environment/
 * isolation.ts — tier-namespaced resource footprints, zero shared
 * identities, cross-tier typed rejections) to the OPERATIONS surface:
 * every consequential mutation request carries the tier context it
 * executes under, and a mutation targeting a PRODUCTION-owned resource
 * identity under a PREVIEW context is a typed rejection BEFORE any
 * provider client exists.
 *
 * The tier vocabulary and the footprint discipline are ALIGNED with the
 * merged P3 module (document alignment; no import — pinned by the
 * acceptance suite, which imports the merged P3 isolation module and
 * runs the two contracts side by side).
 *
 * Determinism: pure functions over injected requests/footprints.
 */

import { HardeningContractError, isPlainObject, type HardeningTier, type TierResourceIdentity } from './tiers.ts';

/** The operation classes: mutations change state, reads do not. */
export const MUTATION_OPERATIONS = ['write', 'delete', 'deploy', 'rollback', 'migrate', 'configure'] as const;
export type MutationOperation = (typeof MUTATION_OPERATIONS)[number];
export type ReadOperation = 'read' | 'list' | 'status';

/** One consequential request entering the isolation gate. */
export interface TierScopedRequest {
  /** The tier context the request executes under. */
  readonly contextTier: HardeningTier;
  /** The provider resource identity the request targets. */
  readonly target: TierResourceIdentity;
  readonly operation: MutationOperation | ReadOperation;
}

/** The typed isolation decision. */
export type TierIsolationDecision =
  | { readonly kind: 'REQUEST_ALLOWED'; readonly detail: string }
  | { readonly kind: 'PREVIEW_ISOLATION_VIOLATION'; readonly targetIdentity: string; readonly detail: string };

/**
 * The pinned gate: a MUTATION targeting a production-tier resource
 * identity under a preview context is a typed PREVIEW_ISOLATION_VIOLATION
 * — fail-closed, before any provider client exists. Reads across tiers
 * are policy decisions for the composition root (not this gate); local
 * and production contexts are out of scope for the preview gate.
 */
export function assertPreviewCannotMutateProduction(request: TierScopedRequest): TierIsolationDecision {
  if (!isPlainObject(request)) {
    throw new HardeningContractError('tier-scoped request must be an object');
  }
  if (request.contextTier === 'preview' && request.target.tier === 'production' && isMutation(request.operation)) {
    return {
      kind: 'PREVIEW_ISOLATION_VIOLATION',
      targetIdentity: request.target.identity,
      detail: `preview cannot mutate production: a ${request.operation} under preview context targeted the production-owned identity ${request.target.identity} — the request is rejected before any provider client exists`,
    };
  }
  return {
    kind: 'REQUEST_ALLOWED',
    detail: `${request.operation} on ${request.target.identity} under ${request.contextTier} context is not a preview-to-production mutation`,
  };
}

/** The throwing seam. */
export function assertTierIsolationOrThrow(request: TierScopedRequest): void {
  const decision = assertPreviewCannotMutateProduction(request);
  if (decision.kind === 'PREVIEW_ISOLATION_VIOLATION') {
    throw new HardeningContractError(decision.detail);
  }
}

function isMutation(operation: string): boolean {
  return (MUTATION_OPERATIONS as readonly string[]).includes(operation);
}

/**
 * Footprint discipline (the P3 rule, re-stated for the hardening tree):
 * two footprints share NO resource identity. Any collision is a typed
 * rejection naming the colliding identity.
 */
export function assertFootprintsShareNoIdentity(
  preview: readonly TierResourceIdentity[],
  production: readonly TierResourceIdentity[],
): void {
  const productionIdentities = new Set(production.map((identity) => identity.identity));
  const collisions = preview.map((identity) => identity.identity).filter((identity) => productionIdentities.has(identity));
  if (collisions.length > 0) {
    throw new HardeningContractError(
      `preview NEVER mutates production: the preview footprint references production-owned identities (${collisions.join(', ')}) — separate stores per tier are mandatory`,
    );
  }
}
