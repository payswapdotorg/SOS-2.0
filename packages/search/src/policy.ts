/**
 * The EXPLICIT exploration/exploitation policy (Work Order W7:
 * "Exploration/exploitation is EXPLICIT: a typed policy knob
 * (epsilon-greedy/UCB-shaped bandit over the repertoire with uncertainty
 * from applicability estimates); never implicit"; spec/architecture.md §9
 * "deliberate exploration/exploitation"; docs/probabilistic-learning.md
 * "Exploration and exploitation are balanced using prior quality,
 * uncertainty, information value, risk and reversibility").
 *
 * THE POLICY IS A REQUIRED, TYPED KNOB — there is no implicit default:
 * a search request without a policy is rejected (negative-tested).
 *
 * THE POLICY SHAPES ATTENTION ORDER — IT NEVER DROPS CANDIDATES: the
 * diverse candidate set is preserved (§11; the lock forbids a universal
 * winner); the policy orders the survivors and annotates each with why it
 * was selected (EXPLOIT or EXPLORE). This keeps downstream Pareto/QD
 * evaluation free to see the WHOLE set.
 *
 * THE THREE POLICIES (deterministic; the bandit uses the applicability
 * estimates' uncertainty — calibrated probabilities, sample sizes and
 * qualitative classes — never invented numbers):
 *   - GREEDY: pure exploitation. Order: calibrated probability desc, then
 *     uncertainty class (STRONG > MODERATE > WEAK > UNQUANTIFIED), then
 *     sample size desc, then id asc. All picks annotated EXPLOIT.
 *   - EPSILON_GREEDY { epsilon, seed }: a seeded deterministic RNG (mulberry32)
 *     draws before each pick: with probability epsilon the next pick is an
 *     EXPLORATION draw (uniform over the remaining candidates), otherwise
 *     the greedy best remaining (EXPLOIT). epsilon in [0,1]; the seed makes
 *     every run reproducible.
 *   - UCB { exploration_constant }: an optimistic bandit ordering. Arms
 *     WITH calibrated estimates score p + c·sqrt(ln N / n) (N = total
 *     calibrated sample size, n = the arm's sample size) — exploitation
 *     plus an uncertainty bonus that shrinks as evidence accumulates
 *     (annotated EXPLOIT with the score in the note). Arms WITHOUT
 *     calibrated estimates are UNQUANTIFIED arms: their value is unknown,
 *     so exploring them carries the highest information value — they head
 *     the order (annotated EXPLORE), sorted by class (UNQUANTIFIED first),
 *     then ascending sample size, then id.
 */

import { SearchError } from './errors.js';
import type { SearchCandidate } from './candidate.js';
import { assertValidSearchCandidate } from './candidate.js';
import type { UncertaintyClass } from '@sos-2/evidence';

/** The typed exploration/exploitation policy knob (required — never implicit). */
export type ExplorationPolicy =
  | { kind: 'GREEDY' }
  | { kind: 'EPSILON_GREEDY'; epsilon: number; seed: number }
  | { kind: 'UCB'; exploration_constant: number };

/** Why a candidate received its position in the ordering. */
export interface SelectionAnnotation {
  /** 1-based position in the policy ordering. */
  rank: number;
  /** EXPLOIT: chosen by exploitation value. EXPLORE: chosen for information value. */
  mode: 'EXPLOIT' | 'EXPLORE';
  /** Human-readable justification of the pick (deterministic content). */
  note: string;
}

/** The result of applying a policy: the ordered, annotated candidate list. */
export interface PolicyOrdering {
  policy: ExplorationPolicy;
  ordered: { candidate: SearchCandidate; annotation: SelectionAnnotation }[];
}

/** Validate an exploration policy (throws SearchError). */
export function assertValidExplorationPolicy(value: unknown): asserts value is ExplorationPolicy {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SearchError(
      `exploration policy must be an explicit typed object — { kind: 'GREEDY' } | { kind: 'EPSILON_GREEDY', epsilon, seed } | { kind: 'UCB', exploration_constant }; never implicit`,
    );
  }
  const record = value as Record<string, unknown>;
  switch (record['kind']) {
    case 'GREEDY': {
      if (Object.keys(record).length !== 1) {
        throw new SearchError("GREEDY policy must have the exact field set { kind: 'GREEDY' }");
      }
      return;
    }
    case 'EPSILON_GREEDY': {
      if (Object.keys(record).length !== 3) {
        throw new SearchError("EPSILON_GREEDY policy must have the exact field set { kind, epsilon, seed }");
      }
      const epsilon = record['epsilon'];
      if (typeof epsilon !== 'number' || !Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1) {
        throw new SearchError(
          `EPSILON_GREEDY epsilon must be a finite number in [0, 1], received: ${JSON.stringify(epsilon)}`,
        );
      }
      const seed = record['seed'];
      if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
        throw new SearchError(
          `EPSILON_GREEDY seed must be an integer in [0, 2^32-1] (the deterministic RNG is seeded), received: ${JSON.stringify(seed)}`,
        );
      }
      return;
    }
    case 'UCB': {
      if (Object.keys(record).length !== 2) {
        throw new SearchError("UCB policy must have the exact field set { kind, exploration_constant }");
      }
      const constant = record['exploration_constant'];
      if (typeof constant !== 'number' || !Number.isFinite(constant) || constant < 0) {
        throw new SearchError(
          `UCB exploration_constant must be a finite number >= 0, received: ${JSON.stringify(constant)}`,
        );
      }
      return;
    }
    default:
      throw new SearchError(
        `exploration policy kind must be GREEDY, EPSILON_GREEDY or UCB, received: ${JSON.stringify(record['kind'])}`,
      );
  }
}

/** Deterministic seeded RNG (mulberry32) — reproducible exploration draws. */
export function mulberry32(seed: number): () => number {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new SearchError(`mulberry32 requires an integer seed in [0, 2^32-1], received: ${JSON.stringify(seed)}`);
  }
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CLASS_RANK: Record<UncertaintyClass, number> = { STRONG: 0, MODERATE: 1, WEAK: 2, UNQUANTIFIED: 3 };

/** The greedy exploitation comparator (documented total order). */
function greedyComparator(a: SearchCandidate, b: SearchCandidate): number {
  const aProbability = a.uncertainty.calibrated?.probability;
  const bProbability = b.uncertainty.calibrated?.probability;
  if (aProbability !== undefined && bProbability !== undefined && aProbability !== bProbability) {
    return bProbability - aProbability;
  }
  if (aProbability !== undefined && bProbability === undefined) {
    return -1;
  }
  if (aProbability === undefined && bProbability !== undefined) {
    return 1;
  }
  const classDelta = CLASS_RANK[a.uncertainty.uncertainty_class] - CLASS_RANK[b.uncertainty.uncertainty_class];
  if (classDelta !== 0) {
    return classDelta;
  }
  const sampleDelta = b.uncertainty.sample_size - a.uncertainty.sample_size;
  if (sampleDelta !== 0) {
    return sampleDelta;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Apply the exploration/exploitation policy to a candidate set. The set is
 * NEVER reduced — every candidate is ordered and annotated (diversity is
 * preserved; the policy shapes attention, not membership).
 */
export function applyExplorationPolicy(
  candidates: readonly SearchCandidate[],
  policy: ExplorationPolicy,
): PolicyOrdering {
  assertValidExplorationPolicy(policy);
  for (const candidate of candidates) {
    assertValidSearchCandidate(candidate);
  }
  switch (policy.kind) {
    case 'GREEDY':
      return greedyOrdering(candidates);
    case 'EPSILON_GREEDY':
      return epsilonGreedyOrdering(candidates, policy);
    case 'UCB':
      return ucbOrdering(candidates, policy);
  }
}

function greedyOrdering(candidates: readonly SearchCandidate[]): PolicyOrdering {
  const sorted = [...candidates].sort(greedyComparator);
  return {
    policy: { kind: 'GREEDY' },
    ordered: sorted.map((candidate, index) => ({
      candidate,
      annotation: {
        rank: index + 1,
        mode: 'EXPLOIT' as const,
        note: `greedy exploitation pick ${index + 1} (calibrated probability, then uncertainty class, then sample size)`,
      },
    })),
  };
}

function epsilonGreedyOrdering(
  candidates: readonly SearchCandidate[],
  policy: { kind: 'EPSILON_GREEDY'; epsilon: number; seed: number },
): PolicyOrdering {
  const rng = mulberry32(policy.seed);
  const remaining = [...candidates];
  const ordered: PolicyOrdering['ordered'] = [];
  while (remaining.length > 0) {
    const draw = rng();
    let pickIndex: number;
    let mode: 'EXPLOIT' | 'EXPLORE';
    let note: string;
    if (draw < policy.epsilon && remaining.length > 1) {
      const exploreDraw = rng();
      pickIndex = Math.min(remaining.length - 1, Math.floor(exploreDraw * remaining.length));
      mode = 'EXPLORE';
      note = `epsilon draw (epsilon=${policy.epsilon}, seed=${policy.seed}) — exploration pick ${ordered.length + 1}`;
    } else {
      pickIndex = 0;
      for (let i = 1; i < remaining.length; i += 1) {
        if (greedyComparator(remaining[i]!, remaining[pickIndex]!) < 0) {
          pickIndex = i;
        }
      }
      mode = 'EXPLOIT';
      note = `greedy exploitation pick ${ordered.length + 1} (epsilon draw r=${draw.toFixed(4)} did not explore)`;
    }
    const [picked] = remaining.splice(pickIndex, 1);
    ordered.push({ candidate: picked!, annotation: { rank: ordered.length + 1, mode, note } });
  }
  return { policy: { ...policy }, ordered };
}

function ucbOrdering(
  candidates: readonly SearchCandidate[],
  policy: { kind: 'UCB'; exploration_constant: number },
): PolicyOrdering {
  const calibrated = candidates.filter((candidate) => candidate.uncertainty.calibrated !== undefined);
  const unquantified = candidates.filter((candidate) => candidate.uncertainty.calibrated === undefined);
  const totalSample = calibrated.reduce((sum, candidate) => sum + candidate.uncertainty.calibrated!.sample_size, 0);
  const logN = Math.log(Math.max(1, totalSample));

  // Unquantified arms first: their value is unknown — exploring them has the
  // highest information value (docs/probabilistic-learning.md). Least-known
  // first: UNQUANTIFIED class, then fewest samples, then id.
  const exploreSorted = [...unquantified].sort((a, b) => {
    const classDelta = CLASS_RANK[b.uncertainty.uncertainty_class] - CLASS_RANK[a.uncertainty.uncertainty_class];
    if (classDelta !== 0) {
      return classDelta;
    }
    const sampleDelta = a.uncertainty.sample_size - b.uncertainty.sample_size;
    if (sampleDelta !== 0) {
      return sampleDelta;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // Calibrated arms: UCB score = p + c * sqrt(ln N / n) — exploitation plus
  // an uncertainty bonus that shrinks with accumulated evidence.
  const exploitSorted = [...calibrated].sort((a, b) => {
    const scoreA = ucbScore(a, logN, policy.exploration_constant);
    const scoreB = ucbScore(b, logN, policy.exploration_constant);
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const ordered: PolicyOrdering['ordered'] = [];
  for (const candidate of exploreSorted) {
    ordered.push({
      candidate,
      annotation: {
        rank: ordered.length + 1,
        mode: 'EXPLORE',
        note: 'unquantified arm — exploration priority (information value; no calibrated probability exists, none is invented)',
      },
    });
  }
  for (const candidate of exploitSorted) {
    const score = ucbScore(candidate, logN, policy.exploration_constant);
    ordered.push({
      candidate,
      annotation: {
        rank: ordered.length + 1,
        mode: 'EXPLOIT',
        note: `UCB score ${score.toFixed(4)} = p ${candidate.uncertainty.calibrated!.probability.toFixed(4)} + c ${policy.exploration_constant} * sqrt(ln ${Math.max(1, totalSample).toFixed(0)} / ${candidate.uncertainty.calibrated!.sample_size})`,
      },
    });
  }
  return { policy: { ...policy }, ordered };
}

function ucbScore(candidate: SearchCandidate, logN: number, constant: number): number {
  const calibrated = candidate.uncertainty.calibrated!;
  return calibrated.probability + constant * Math.sqrt(logN / Math.max(1, calibrated.sample_size));
}
