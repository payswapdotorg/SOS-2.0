/**
 * Sandbox/resource limit declarations (Work Order P14).
 *
 * Declarative hardening contracts extending the P3 deployment contract
 * conventions and the P8 sandbox policy discipline
 * (packages/sandbox/src/policy.ts — SandboxBudgetEnvelope +
 * resourceEnvelope as INJECTED DATA). This module declares the
 * per-tier LIMIT FLOOR: what every sandboxed body must be bounded by
 * in each environment tier.
 *
 * PINNED RULES:
 *   - production bodies are FULLY BOUNDED (every budget counter has a
 *     finite limit; unbounded production budgets are unrepresentable);
 *   - preview bodies are bounded (the preview is where untrusted
 *     autonomous work runs unreviewed);
 *   - local bodies declare relaxed budgets explicitly (developer
 *     ergonomics) — never implicitly unbounded defaults;
 *   - resource envelopes (duration/memory) are declared per tier and
 *   bounded.
 *
 * These are CONTRACTS, not enforcement: the real platform sandbox
 * (container/VM limits) attaches later as an adapter realizing the same
 * declarations. Status: NOT_YET_CONNECTED for real enforcement
 * endpoints; the declarations are verified OFFLINE.
 *
 * Determinism: pure functions over injected declarations.
 */

import { HardeningContractError, isPlainObject, isPositiveInteger } from './tiers.ts';

/** The budget counters (P8 sandbox vocabulary, document-aligned). */
export const SANDBOX_LIMIT_COUNTERS = ['fileWrites', 'fileBytes', 'shellCommands', 'networkCalls', 'secretReveals'] as const;
export type SandboxLimitCounter = (typeof SANDBOX_LIMIT_COUNTERS)[number];

/** One tier's sandbox limit declaration. */
export interface SandboxLimitDeclaration {
  readonly tier: 'local' | 'preview' | 'production';
  /** Deterministic operation budgets (finite positive integers, or null = unbounded — unrepresentable for preview/production). */
  readonly budgets: Readonly<Record<SandboxLimitCounter, number | null>>;
  /** Provider-facing resource envelope. */
  readonly resourceEnvelope: { readonly maxDurationMs: number; readonly maxMemoryMb: number | null };
}

/** The repo-standard declarations (deterministic, tier-graded). */
export const DEFAULT_SANDBOX_LIMITS: readonly SandboxLimitDeclaration[] = [
  {
    tier: 'local',
    budgets: { fileWrites: null, fileBytes: null, shellCommands: null, networkCalls: 500, secretReveals: 20 },
    resourceEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: null },
  },
  {
    tier: 'preview',
    budgets: { fileWrites: 2_000, fileBytes: 52_428_800, shellCommands: 500, networkCalls: 300, secretReveals: 10 },
    resourceEnvelope: { maxDurationMs: 1_800_000, maxMemoryMb: 512 },
  },
  {
    tier: 'production',
    budgets: { fileWrites: 5_000, fileBytes: 209_715_200, shellCommands: 2_000, networkCalls: 1_000, secretReveals: 10 },
    resourceEnvelope: { maxDurationMs: 900_000, maxMemoryMb: 1_024 },
  },
] as const;

/**
 * Validate one sandbox limit declaration.
 *
 *   - budgets must carry the exact five-counter field set;
 *   - preview/production budgets must be FULLY BOUNDED (null is a
 *     typed violation — unbounded autonomous execution in preview or
 *     production is unrepresentable);
 *   - resource envelopes must be positive and bounded.
 */
export function assertValidSandboxLimitDeclaration(declaration: SandboxLimitDeclaration): void {
  if (!isPlainObject(declaration)) {
    throw new HardeningContractError('sandbox limit declaration must be an object');
  }
  if (declaration.tier !== 'local' && declaration.tier !== 'preview' && declaration.tier !== 'production') {
    throw new HardeningContractError(`sandbox limit declaration tier must be local | preview | production, received: ${JSON.stringify(declaration.tier)}`);
  }
  const budgets = declaration.budgets;
  if (!isPlainObject(budgets)) {
    throw new HardeningContractError('sandbox limit declaration budgets must be an object');
  }
  const counterKeys = Object.keys(budgets);
  if (counterKeys.length !== SANDBOX_LIMIT_COUNTERS.length || !SANDBOX_LIMIT_COUNTERS.every((counter) => counter in budgets)) {
    throw new HardeningContractError(
      `sandbox limit budgets must carry the exact field set { ${SANDBOX_LIMIT_COUNTERS.join(', ')} }, received: ${JSON.stringify(counterKeys)}`,
    );
  }
  for (const counter of SANDBOX_LIMIT_COUNTERS) {
    const value = budgets[counter];
    if (value === null) {
      if (declaration.tier !== 'local') {
        throw new HardeningContractError(
          `unbounded budget counter "${counter}" in tier "${declaration.tier}" — preview/production bodies must be FULLY BOUNDED`,
        );
      }
      continue; // local may relax explicitly
    }
    if (!isPositiveInteger(value)) {
      throw new HardeningContractError(
        `budget counter "${counter}" must be a positive integer or null (local only), received: ${JSON.stringify(value)}`,
      );
    }
  }
  const envelope = declaration.resourceEnvelope;
  if (!isPlainObject(envelope)) {
    throw new HardeningContractError('sandbox limit declaration resourceEnvelope must be an object');
  }
  if (!isPositiveInteger(envelope.maxDurationMs)) {
    throw new HardeningContractError(`resourceEnvelope.maxDurationMs must be a positive integer, received: ${JSON.stringify(envelope.maxDurationMs)}`);
  }
  if (envelope.maxMemoryMb !== null && (typeof envelope.maxMemoryMb !== 'number' || !Number.isFinite(envelope.maxMemoryMb) || envelope.maxMemoryMb <= 0)) {
    throw new HardeningContractError(`resourceEnvelope.maxMemoryMb must be a positive number or null (local only), received: ${JSON.stringify(envelope.maxMemoryMb)}`);
  }
  if (declaration.tier !== 'local' && envelope.maxMemoryMb === null) {
    throw new HardeningContractError(`unbounded memory in tier "${declaration.tier}" — preview/production envelopes must be bounded`);
  }
}

/** Validate a complete set of tier declarations (exactly one per tier). */
export function assertValidSandboxLimitSet(declarations: readonly SandboxLimitDeclaration[]): void {
  const tiers = new Set(declarations.map((declaration) => declaration.tier));
  if (tiers.size !== declarations.length) {
    throw new HardeningContractError('duplicate sandbox limit declarations for the same tier');
  }
  for (const expected of ['local', 'preview', 'production'] as const) {
    if (!tiers.has(expected)) {
      throw new HardeningContractError(`missing sandbox limit declaration for tier "${expected}"`);
    }
  }
  for (const declaration of declarations) {
    assertValidSandboxLimitDeclaration(declaration);
  }
}
