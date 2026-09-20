/**
 * The MetaProcess PARAMETERS — the EVOLVABLE SURFACE of the SOS process
 * (W16): strategy parameters, retrieval weights and the candidate-generation
 * policy. Frozen vocabulary imported from the merged authorities:
 *   - the six retrieval altitudes come from @sos-2/registry (spec §10);
 *   - the search policy vocabulary mirrors the W15 brownfield loop's
 *     ladder-engine policy axis.
 *
 * THE GOVERNANCE GUARD IS OUTSIDE THIS SURFACE (spec/architecture.md §16:
 * "Meta-adaptation cannot disable the mechanism that judges meta-adaptation"):
 * there is NO parameter that touches authority gates, traceability, ASK
 * escalation, decision records or the guard itself. A MetaChange whose patch
 * carries any key outside the frozen EVOLVABLE_KEYS set is REJECTED by the
 * governance guard (typed rejection) — the keys cannot even be expressed as
 * process state, so no accumulation of legitimate meta-changes can weaken
 * governance.
 */

import { RETRIEVAL_ALTITUDES } from '@sos-2/registry';
import type { RetrievalAltitude } from '@sos-2/registry';
import { MetaEvolutionError } from './errors.js';

export const SEARCH_POLICIES = ['GREEDY', 'BALANCED', 'EXPLORATORY'] as const;
export type SearchPolicy = (typeof SEARCH_POLICIES)[number];

export function isSearchPolicy(value: unknown): value is SearchPolicy {
  return typeof value === 'string' && (SEARCH_POLICIES as readonly string[]).includes(value);
}

/** The typed evolvable process parameters (exact key set). */
export interface MetaProcessParameters {
  /** Candidate-generation strategy knobs. */
  strategy: {
    /** The candidate-generation policy axis (the W15 search-ladder policy). */
    search_policy: SearchPolicy;
    /** Deliberate exploration share in [0, 1] (diversity is intentional — R28). */
    exploration_rate: number;
    /** Maximum candidates retained per family (>= 1 — the diversity floor). */
    max_candidates_per_family: number;
  };
  /**
   * Retrieval weights per §10 altitude (all six altitudes present, finite
   * >= 0). The two VALIDATED altitudes must stay STRICTLY POSITIVE — search
   * must always be able to start at the highest safe validated reasoning
   * altitude (a governance-guard invariant, not a mere validity rule).
   */
  retrieval_weights: Record<RetrievalAltitude, number>;
}

/**
 * THE FROZEN EVOLVABLE KEY SET — the exact dotted paths a MetaChange patch
 * may touch. Anything else is a governance-surface violation.
 */
export const EVOLVABLE_KEYS: readonly string[] = [
  'strategy.search_policy',
  'strategy.exploration_rate',
  'strategy.max_candidates_per_family',
  ...RETRIEVAL_ALTITUDES.map((altitude) => `retrieval_weights.${altitude}`),
];

const EVOLVABLE_KEY_SET: ReadonlySet<string> = new Set(EVOLVABLE_KEYS);

export function isEvolvableKey(key: string): boolean {
  return EVOLVABLE_KEY_SET.has(key);
}

/**
 * A MetaChange patch — an assignment of a SUBSET of the evolvable keys.
 * Structurally open (JSON proposals may carry foreign keys): the GOVERNANCE
 * GUARD rejects any key outside EVOLVABLE_KEYS with a typed rejection before
 * the patch is ever applied; `applyParametersPatch` additionally refuses
 * non-evolvable input loudly.
 */
export interface MetaProcessPatch {
  strategy?: {
    search_policy?: SearchPolicy;
    exploration_rate?: number;
    max_candidates_per_family?: number;
    [key: string]: unknown;
  };
  retrieval_weights?: {
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Flatten a patch to its dotted key set (deterministic, sorted; undefined-valued keys are absent). */
export function patchKeys(patch: MetaProcessPatch): string[] {
  const keys: string[] = [];
  for (const [topKey, rawValue] of Object.entries(patch)) {
    if (rawValue === undefined) {
      continue;
    }
    if (rawValue !== null && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      for (const [subKey, subValue] of Object.entries(rawValue as Record<string, unknown>)) {
        if (subValue === undefined) {
          continue;
        }
        keys.push(`${topKey}.${subKey}`);
      }
    } else {
      keys.push(topKey);
    }
  }
  return keys.sort();
}

/** Non-evolvable keys carried by a patch (sorted; empty for guard-passing patches). */
export function nonEvolvableKeys(patch: MetaProcessPatch): string[] {
  return patchKeys(patch).filter((key) => !isEvolvableKey(key));
}

/** Full validation of process parameters (throws MetaEvolutionError). */
export function assertValidMetaProcessParameters(value: unknown): asserts value is MetaProcessParameters {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MetaEvolutionError('INVALID_PROCESS_PARAMETERS', 'process parameters must be an object');
  }
  const parameters = value as Record<string, unknown>;
  const strategy = parameters['strategy'];
  if (typeof strategy !== 'object' || strategy === null || Array.isArray(strategy)) {
    throw new MetaEvolutionError('INVALID_PROCESS_PARAMETERS', 'parameters.strategy must be an object');
  }
  const strategyRecord = strategy as Record<string, unknown>;
  if (!isSearchPolicy(strategyRecord['search_policy'])) {
    throw new MetaEvolutionError(
      'INVALID_PROCESS_PARAMETERS',
      `parameters.strategy.search_policy must be one of ${SEARCH_POLICIES.join('|')}, received: ${JSON.stringify(strategyRecord['search_policy'])}`,
    );
  }
  const explorationRate = strategyRecord['exploration_rate'];
  if (typeof explorationRate !== 'number' || !Number.isFinite(explorationRate) || explorationRate < 0 || explorationRate > 1) {
    throw new MetaEvolutionError(
      'INVALID_PROCESS_PARAMETERS',
      `parameters.strategy.exploration_rate must be a finite number in [0, 1], received: ${JSON.stringify(explorationRate)}`,
    );
  }
  const maxPerFamily = strategyRecord['max_candidates_per_family'];
  if (typeof maxPerFamily !== 'number' || !Number.isInteger(maxPerFamily) || maxPerFamily < 1) {
    throw new MetaEvolutionError(
      'INVALID_PROCESS_PARAMETERS',
      `parameters.strategy.max_candidates_per_family must be an integer >= 1 (the diversity floor), received: ${JSON.stringify(maxPerFamily)}`,
    );
  }
  const weights = parameters['retrieval_weights'];
  if (typeof weights !== 'object' || weights === null || Array.isArray(weights)) {
    throw new MetaEvolutionError('INVALID_PROCESS_PARAMETERS', 'parameters.retrieval_weights must be an object');
  }
  const weightsRecord = weights as Record<string, unknown>;
  const presentAltitudes = Object.keys(weightsRecord).sort();
  const expectedAltitudes = [...RETRIEVAL_ALTITUDES].sort();
  if (presentAltitudes.length !== expectedAltitudes.length || !presentAltitudes.every((key, index) => key === expectedAltitudes[index])) {
    throw new MetaEvolutionError(
      'INVALID_PROCESS_PARAMETERS',
      `parameters.retrieval_weights must carry exactly the six §10 altitudes ${expectedAltitudes.join(', ')}, received: ${presentAltitudes.join(', ')}`,
    );
  }
  for (const altitude of RETRIEVAL_ALTITUDES) {
    const weight = weightsRecord[altitude];
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      throw new MetaEvolutionError(
        'INVALID_PROCESS_PARAMETERS',
        `parameters.retrieval_weights.${altitude} must be a finite number >= 0, received: ${JSON.stringify(weight)}`,
      );
    }
  }
  if ((weightsRecord['VALIDATED_COMPOSITION'] as number) <= 0 || (weightsRecord['VALIDATED_PACKAGE'] as number) <= 0) {
    throw new MetaEvolutionError(
      'INVALID_PROCESS_PARAMETERS',
      'parameters.retrieval_weights.VALIDATED_COMPOSITION and VALIDATED_PACKAGE must be strictly positive — search starts at the highest safe validated reasoning altitude (spec/architecture.md §10)',
    );
  }
}

export function isValidMetaProcessParameters(value: unknown): value is MetaProcessParameters {
  try {
    assertValidMetaProcessParameters(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply a guard-passing patch to a parameter set (pure, deterministic).
 * Refuses non-evolvable keys LOUDLY — this is the second, structural half of
 * the non-disableable guard: even a caller that bypasses the guard verdict
 * cannot smuggle a governance key through the apply path.
 */
export function applyParametersPatch(base: MetaProcessParameters, patch: MetaProcessPatch): MetaProcessParameters {
  const foreign = nonEvolvableKeys(patch);
  if (foreign.length > 0) {
    throw new MetaEvolutionError(
      'GUARD_BYPASS_ATTEMPT',
      `patch carries non-evolvable keys ${foreign.join(', ')} — the governance guard is outside the evolvable surface and cannot be applied around`,
    );
  }
  const next: MetaProcessParameters = {
    strategy: {
      search_policy: patch.strategy?.search_policy ?? base.strategy.search_policy,
      exploration_rate:
        typeof patch.strategy?.exploration_rate === 'number' ? patch.strategy.exploration_rate : base.strategy.exploration_rate,
      max_candidates_per_family:
        typeof patch.strategy?.max_candidates_per_family === 'number'
          ? patch.strategy.max_candidates_per_family
          : base.strategy.max_candidates_per_family,
    },
    retrieval_weights: { ...base.retrieval_weights },
  };
  if (patch.retrieval_weights !== undefined) {
    for (const altitude of RETRIEVAL_ALTITUDES) {
      const weight = patch.retrieval_weights[altitude];
      if (typeof weight === 'number') {
        next.retrieval_weights[altitude] = weight;
      }
    }
  }
  assertValidMetaProcessParameters(next);
  return next;
}

/** Defensive deep copy (parameters are plain JSON). */
export function cloneParameters(parameters: MetaProcessParameters): MetaProcessParameters {
  return {
    strategy: { ...parameters.strategy },
    retrieval_weights: { ...parameters.retrieval_weights },
  };
}

/** Canonical equality of two parameter sets (order-independent, byte-stable). */
export function parametersEqual(a: MetaProcessParameters, b: MetaProcessParameters): boolean {
  return (
    a.strategy.search_policy === b.strategy.search_policy &&
    a.strategy.exploration_rate === b.strategy.exploration_rate &&
    a.strategy.max_candidates_per_family === b.strategy.max_candidates_per_family &&
    RETRIEVAL_ALTITUDES.every((altitude) => a.retrieval_weights[altitude] === b.retrieval_weights[altitude])
  );
}
