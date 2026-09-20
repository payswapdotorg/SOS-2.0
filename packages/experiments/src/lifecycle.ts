/**
 * Experiment lifecycle — the strict, validated phase machine
 * (Work Order W9; spec/architecture.md §5 and docs/implementation/
 * TESTING-AND-EVIDENCE.md layer 6: "replay, simulation, shadow, canary,
 * experiment and rollback").
 *
 *     SHADOW --> CANARY --> CONTROLLED_EXPERIMENT
 *
 * STRICT transitions: no skipping (SHADOW -> CONTROLLED_EXPERIMENT is
 * REJECTED), no going backwards, no re-entering a completed phase. Phase
 * transitions are content-level state (exactly like @sos-2/authority's
 * grant status machine) — the spine envelope lifecycle (DRAFT/ACTIVE/...)
 * remains owned by @sos-2/semantic-spine and is never duplicated here.
 *
 * TYPED STAGED EXPOSURE LEVELS (per phase, documented and enforced):
 *   SHADOW                 exposure_percent is EXACTLY 0 — a shadow mirrors
 *                          the candidate on a copy of live traffic and NEVER
 *                          serves a live request;
 *   CANARY                 exposure_percent is strictly between 0 and 100 AND
 *                          is one of the experiment's declared canary ladder
 *                          steps (a strictly increasing staged exposure
 *                          ladder — canaries advance one declared step at a
 *                          time, never an undeclared jump);
 *   CONTROLLED_EXPERIMENT  exposure_percent is EXACTLY 100 — the full
 *                          population is allocated per the design.
 *
 * Exposure is additionally required to be MONOTONIC non-decreasing across
 * the lifecycle (an exposure rollback is a ROLLBACK, not a phase
 * transition).
 */

import { ExperimentError } from './errors.js';
import type { ExperimentContent } from './artifact.js';

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

export const EXPERIMENT_PHASES = ['SHADOW', 'CANARY', 'CONTROLLED_EXPERIMENT'] as const;

export type ExperimentPhase = (typeof EXPERIMENT_PHASES)[number];

const PHASE_ORDER: Readonly<Record<ExperimentPhase, number>> = {
  SHADOW: 0,
  CANARY: 1,
  CONTROLLED_EXPERIMENT: 2,
};

/** The strict phase transition table (no skips, no backwards moves). */
export const ALLOWED_PHASE_TRANSITIONS: Readonly<Record<ExperimentPhase, readonly ExperimentPhase[]>> = {
  SHADOW: ['CANARY'],
  CANARY: ['CONTROLLED_EXPERIMENT'],
  CONTROLLED_EXPERIMENT: [],
};

export function canTransitionPhase(from: ExperimentPhase, to: ExperimentPhase): boolean {
  return ALLOWED_PHASE_TRANSITIONS[from]?.includes(to) === true;
}

/** Validate a phase transition; throws ExperimentError on any skip or backwards move. */
export function transitionPhase(from: ExperimentPhase, to: ExperimentPhase): ExperimentPhase {
  if (!EXPERIMENT_PHASES.includes(from)) {
    throw new ExperimentError(`unknown experiment phase: ${JSON.stringify(from)}`);
  }
  if (!EXPERIMENT_PHASES.includes(to)) {
    throw new ExperimentError(`unknown experiment phase: ${JSON.stringify(to)}`);
  }
  if (!canTransitionPhase(from, to)) {
    throw new ExperimentError(
      `invalid experiment phase transition: ${from} -> ${to} ` +
        `(lifecycle is strictly SHADOW -> CANARY -> CONTROLLED_EXPERIMENT; skipping or going backwards is rejected)`,
    );
  }
  return to;
}

// ---------------------------------------------------------------------------
// Staged exposure
// ---------------------------------------------------------------------------

/** The current staged exposure of an experiment (typed per phase). */
export interface StageExposure {
  phase: ExperimentPhase;
  /**
   * SHADOW: exactly 0 (mirrors traffic, never serves live). CANARY: strictly
   * between 0 and 100 AND on the declared ladder. CONTROLLED_EXPERIMENT:
   * exactly 100 (full population).
   */
  exposure_percent: number;
}

export const MAX_EXPOSURE_PERCENT = 100;

/** Validate a declared canary ladder (strictly increasing, each step in (0, 100)). */
export function assertValidCanaryLadder(ladder: unknown): asserts ladder is number[] {
  if (!Array.isArray(ladder) || ladder.length === 0) {
    throw new ExperimentError(
      'canary_ladder must be a non-empty array of staged exposure percentages (0 < step < 100, strictly increasing)',
    );
  }
  let previous = 0;
  for (const step of ladder) {
    if (typeof step !== 'number' || !Number.isInteger(step) || step <= 0 || step >= MAX_EXPOSURE_PERCENT) {
      throw new ExperimentError(
        `canary ladder steps must be integers strictly between 0 and ${MAX_EXPOSURE_PERCENT}, received: ${JSON.stringify(step)}`,
      );
    }
    if (step <= previous) {
      throw new ExperimentError(
        `canary ladder must be strictly increasing (staged exposure advances one declared step at a time), received: ${JSON.stringify(ladder)}`,
      );
    }
    previous = step;
  }
}

/**
 * Validate a staged exposure against its phase rules (throws
 * ExperimentError). Shadow mirrors (0), canary follows the declared ladder,
 * controlled experiments cover the full population.
 */
export function assertValidStageExposure(
  stage: StageExposure,
  canaryLadder: readonly number[],
): void {
  if (typeof stage !== 'object' || stage === null || Array.isArray(stage)) {
    throw new ExperimentError('stage exposure must be an object { phase, exposure_percent }');
  }
  if (Object.keys(stage).length !== 2) {
    throw new ExperimentError('stage exposure must have the exact field set { phase, exposure_percent }');
  }
  if (!EXPERIMENT_PHASES.includes(stage.phase)) {
    throw new ExperimentError(
      `experiment phase must be one of ${EXPERIMENT_PHASES.join(', ')}, received: ${JSON.stringify(stage.phase)}`,
    );
  }
  const exposure = stage.exposure_percent;
  if (typeof exposure !== 'number' || !Number.isInteger(exposure) || exposure < 0 || exposure > MAX_EXPOSURE_PERCENT) {
    throw new ExperimentError(
      `exposure_percent must be an integer in [0, ${MAX_EXPOSURE_PERCENT}], received: ${JSON.stringify(exposure)}`,
    );
  }
  if (stage.phase === 'SHADOW' && exposure !== 0) {
    throw new ExperimentError(
      `a SHADOW mirrors the candidate on copied traffic and never serves a live request: exposure_percent must be 0, received: ${String(exposure)}`,
    );
  }
  if (stage.phase === 'CANARY') {
    if (exposure <= 0 || exposure >= MAX_EXPOSURE_PERCENT) {
      throw new ExperimentError(
        `a CANARY exposes strictly between 0 and ${MAX_EXPOSURE_PERCENT} percent of the population, received: ${String(exposure)}`,
      );
    }
    if (!canaryLadder.includes(exposure)) {
      throw new ExperimentError(
        `canary exposure ${String(exposure)}% is not a declared canary ladder step ` +
          `(ladder: ${JSON.stringify([...canaryLadder])}) — canaries advance one declared step at a time, never an undeclared jump`,
      );
    }
  }
  if (stage.phase === 'CONTROLLED_EXPERIMENT' && exposure !== MAX_EXPOSURE_PERCENT) {
    throw new ExperimentError(
      `a CONTROLLED_EXPERIMENT allocates the full population: exposure_percent must be ${MAX_EXPOSURE_PERCENT}, received: ${String(exposure)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Phase transitions on experiment content
// ---------------------------------------------------------------------------

export interface AdvanceStageInput {
  /** The target phase. */
  phase: ExperimentPhase;
  /**
   * The target exposure. Required for CANARY (a declared ladder step); must
   * be 0 for SHADOW and 100 for CONTROLLED_EXPERIMENT.
   */
  exposure_percent?: number;
}

/**
 * Advance an experiment to its next lifecycle stage.
 *
 * Validated in order:
 *   1. the phase transition itself is legal (strict, no skips);
 *   2. the target exposure satisfies the target phase's typed rules;
 *   3. exposure is monotonic non-decreasing (an exposure decrease is a
 *      ROLLBACK, not a phase transition);
 *   4. the arm allocation ratios are UNCHANGED (a stage advance is an
 *      exposure change, not a redesign — changing the design is a new
 *      experiment revision).
 *
 * Returns the new experiment content with the same identity semantics (the
 * caller records it as a revision; identity lives in the spine envelope).
 */
export function advanceExperimentStage(
  content: ExperimentContent,
  input: AdvanceStageInput,
): ExperimentContent {
  if (typeof content !== 'object' || content === null) {
    throw new ExperimentError('experiment content must be an object');
  }
  if (typeof input !== 'object' || input === null) {
    throw new ExperimentError('advance stage input must be an object { phase, exposure_percent? }');
  }
  if (input.phase === content.stage.phase) {
    throw new ExperimentError(
      `cannot "advance" to the phase already active (${input.phase}); a same-phase exposure change is recorded as a content revision, not a phase transition`,
    );
  }
  transitionPhase(content.stage.phase, input.phase);

  const targetExposure = input.exposure_percent ?? (input.phase === 'CONTROLLED_EXPERIMENT' ? MAX_EXPOSURE_PERCENT : 0);
  const target: StageExposure = { phase: input.phase, exposure_percent: targetExposure };
  assertValidStageExposure(target, content.canary_ladder);

  if (target.exposure_percent < content.stage.exposure_percent) {
    throw new ExperimentError(
      `exposure may never decrease across a stage advance (${content.stage.exposure_percent}% -> ${target.exposure_percent}%) — ` +
        'reducing exposure of a live change is a ROLLBACK, not a phase transition',
    );
  }
  if (content.stage.phase === 'CANARY' && input.phase === 'CANARY') {
    // same-phase ladder advance is not a lifecycle transition — rejected here
    throw new ExperimentError(
      'cannot "advance" to the phase already active; a same-phase exposure change is recorded as a content revision, not a phase transition',
    );
  }

  return { ...content, stage: target };
}

/** Rank helper for phase ordering (SHADOW < CANARY < CONTROLLED_EXPERIMENT). */
export function phaseRank(phase: ExperimentPhase): number {
  return PHASE_ORDER[phase];
}
