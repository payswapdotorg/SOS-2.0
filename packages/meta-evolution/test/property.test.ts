/**
 * Property tests (W16) — randomized meta-proposal sequences:
 *   - DETERMINISM: arbitrary permutations of the golden change sequence
 *     produce byte-identical canonical results on re-run (fixed seed,
 *     deterministic ids, single instant).
 *   - GUARD SOUNDNESS UNDER ACCUMULATION: arbitrary sequences of applied
 *     (guard-passing) meta-changes interleaved with arbitrary
 *     governance-weakening attempts — every weakening attempt is rejected
 *     at every step, the guard invariant list never changes, and the
 *     parameters stay inside the valid space. The guard cannot be voted
 *     away by accumulated meta-changes.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildGoldenMetaInput } from '../src/golden-scenario.js';
import { runMetaEvolutionLoop, canonicalMetaText } from '../src/loop.js';
import { evaluateGovernanceGuard, GOVERNANCE_GUARD, GOVERNANCE_INVARIANT_IDS } from '../src/guard.js';
import { applyMetaChange, activateRevision, createMetaProcess, MetaProcessStore } from '../src/process.js';
import { createMetaChange } from '../src/change.js';
import { applyParametersPatch, assertValidMetaProcessParameters, cloneParameters, patchKeys } from '../src/parameters.js';
import { mintRandomArtifactId } from '@sos-2/semantic-spine';

const NOW = '2025-07-01T00:00:00.000Z';
const PROVENANCE = ['W16:test:property'];

const BASE_PARAMETERS = {
  strategy: { search_policy: 'GREEDY' as const, exploration_rate: 0.2, max_candidates_per_family: 3 },
  retrieval_weights: {
    VALIDATED_COMPOSITION: 1.0,
    VALIDATED_PACKAGE: 1.0,
    PACKAGE_ADAPTATION: 0.6,
    ARCHITECTURE_PATTERN: 0.4,
    NOVEL_ARCHITECTURE: 0.3,
    LOW_LEVEL_SYNTHESIS: 0.2,
  },
};

const SEARCH_POLICIES = ['GREEDY', 'BALANCED', 'EXPLORATORY'] as const;

/** Random guard-passing (evolvable-only) patch generator. */
const evolvablePatchArbitrary = fc.record(
  {
    strategy: fc.option(
      fc.record({
        search_policy: fc.constantFrom(...SEARCH_POLICIES),
        exploration_rate: fc.double({ min: 0, max: 1, noNaN: true }),
        max_candidates_per_family: fc.integer({ min: 1, max: 12 }),
      }),
      { nil: undefined },
    ),
    retrieval_weights: fc.option(
      fc.record({
        VALIDATED_COMPOSITION: fc.double({ min: 0.05, max: 3, noNaN: true }),
        VALIDATED_PACKAGE: fc.double({ min: 0.05, max: 3, noNaN: true }),
        PACKAGE_ADAPTATION: fc.double({ min: 0, max: 3, noNaN: true }),
        ARCHITECTURE_PATTERN: fc.double({ min: 0, max: 3, noNaN: true }),
        NOVEL_ARCHITECTURE: fc.double({ min: 0, max: 3, noNaN: true }),
        LOW_LEVEL_SYNTHESIS: fc.double({ min: 0, max: 3, noNaN: true }),
      }),
      { nil: undefined },
    ),
  },
  { requiredKeys: [] },
);

/** Random governance-weakening patch generator (every forbidden surface). */
const weakeningPatchArbitrary = fc.oneof(
  fc.record({ governance: fc.record({ authority_gates: fc.constant(false) }) }),
  fc.record({ authority: fc.record({ requires_authority: fc.constant(false) }) }),
  fc.record({ guard: fc.record({ enabled: fc.constant(false), invariants: fc.constant([]) }) }),
  fc.record({ traceability: fc.record({ trace_links: fc.constantFrom('optional', 'none') }) }),
  fc.record({ ask_policy: fc.record({ escalation: fc.constant('disabled') }) }),
  fc.record({ decision_records: fc.record({ required: fc.constant(false) }) }),
  fc.record({ retrieval_weights: fc.record({ VALIDATED_PACKAGE: fc.constant(0) }) }),
  fc.record({ retrieval_weights: fc.record({ VALIDATED_COMPOSITION: fc.constant(0) }) }),
  fc.record({ strategy: fc.record({ max_candidates_per_family: fc.constant(0) }) }),
  fc.record({ autonomy: fc.record({ raise_own_level: fc.constant(true) }) }),
);

function newChange(patch: Record<string, unknown>, targetId: string, targetVersion: number, parameters = BASE_PARAMETERS) {
  return createMetaChange({
    content: {
      target_process_id: targetId,
      target_process_version: targetVersion,
      patch,
      intent: 'property-test change',
      source_package_id: mintRandomArtifactId('Package'),
      predicted_effects: ['property-effect'],
      proposed_against: cloneParameters(parameters),
    },
    provenance: PROVENANCE,
    created_at: NOW,
    status: 'ACTIVE',
  });
}

describe('property: determinism over randomized meta-proposal sequences', () => {
  it('any permutation of the golden change sequence reproduces byte-identically', () => {
    const buildPermuted = (permutation: number[]): ReturnType<typeof buildGoldenMetaInput> => {
      const built = buildGoldenMetaInput();
      built.input.changes = permutation.map((index) => built.input.changes[index]!).map((spec) => ({ ...spec }));
      return built;
    };
    fc.assert(
      fc.property(fc.nat(50), (seedShift) => {
        // deterministic pseudo-random permutation derived from the shift:
        const indices = [0, 1, 2, 3];
        let state = seedShift + 1;
        const next = (): number => {
          state = (state * 1103515245 + 12345) % 2147483648;
          return state;
        };
        for (let i = indices.length - 1; i > 0; i -= 1) {
          const j = next() % (i + 1);
          const tmp = indices[i]!;
          indices[i] = indices[j]!;
          indices[j] = tmp;
        }
        const first = runMetaEvolutionLoop(buildPermuted(indices).input);
        const second = runMetaEvolutionLoop(buildPermuted(indices).input);
        expect(canonicalMetaText(second)).toBe(canonicalMetaText(first));
        // the chain invariant holds for every permutation:
        expect(second.chain.complete).toBe(true);
      }),
      { numRuns: 5 },
    );
  });

  it('guard verdicts are pure functions (identical inputs -> identical rejections)', () => {
    fc.assert(
      fc.property(weakeningPatchArbitrary, (patch) => {
        const process = createMetaProcess({
          content: { parameters: cloneParameters(BASE_PARAMETERS), mission_ref: null, notes: 'property' },
          provenance: PROVENANCE,
          created_at: NOW,
          status: 'ACTIVE',
        });
        const change = newChange(patch, process.envelope.id, process.envelope.version);
        const first = evaluateGovernanceGuard(change, BASE_PARAMETERS);
        const second = evaluateGovernanceGuard(change, BASE_PARAMETERS);
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
        expect(first.passed).toBe(false);
      }),
      { numRuns: 40 },
    );
  });
});

describe('property: guard soundness under accumulation', () => {
  it('accumulated applied meta-changes never legitimize a weakening attempt', () => {
    fc.assert(
      fc.property(fc.array(evolvablePatchArbitrary, { minLength: 0, maxLength: 12 }), fc.array(weakeningPatchArbitrary, { minLength: 1, maxLength: 12 }), (appliedPatches, weakeningPatches) => {
        const invariantsBefore = [...GOVERNANCE_INVARIANT_IDS];
        let head = createMetaProcess({
          content: { parameters: cloneParameters(BASE_PARAMETERS), mission_ref: null, notes: 'accumulation' },
          provenance: PROVENANCE,
          created_at: NOW,
          status: 'ACTIVE',
        });
        const store = new MetaProcessStore();
        store.put(head);

        const weakeningAttemptCount = Math.max(1, Math.min(appliedPatches.length, weakeningPatches.length));
        for (let step = 0; step < weakeningAttemptCount; step += 1) {
          // 1. apply a legitimate change (guard-passing); a generated patch
          //    with no assigned keys falls back to a canonical valid patch:
          const appliedPatch = patchKeys((appliedPatches[step] ?? {}) as Record<string, unknown>).length > 0
            ? (appliedPatches[step] as Record<string, unknown>)
            : { strategy: { exploration_rate: 0.5 } };
          const change = newChange(appliedPatch, head.envelope.id, head.envelope.version, head.content.parameters);
          const verdict = evaluateGovernanceGuard(change, head.content.parameters);
          if (verdict.passed) {
            const { trial } = applyMetaChange(head, change, GOVERNANCE_GUARD, { provenance: PROVENANCE, created_at: NOW });
            store.put(trial);
            const { activated, superseded } = activateRevision(trial, head);
            store.replace(head, superseded);
            store.replace(trial, activated);
            head = activated;
            assertValidMetaProcessParameters(head.content.parameters);
          }

          // 2. interleave a governance-weakening attempt — REJECTED at EVERY step:
          const weakening = weakeningPatches[step] ?? { guard: { enabled: false } };
          const weakeningChange = newChange(weakening, head.envelope.id, head.envelope.version, head.content.parameters);
          const weakeningVerdict = evaluateGovernanceGuard(weakeningChange, head.content.parameters);
          expect(weakeningVerdict.passed, JSON.stringify(weakening)).toBe(false);
          expect(() => applyMetaChange(head, weakeningChange, GOVERNANCE_GUARD, { provenance: PROVENANCE, created_at: NOW })).toThrow();

          // 3. the guard invariant list is UNCHANGED (not voted away, not extended):
          expect([...GOVERNANCE_INVARIANT_IDS]).toEqual(invariantsBefore);
        }

        // 4. the guard still rejects the ORIGINAL golden weakening shapes at the end state:
        const finalWeakening = newChange({ governance: { authority_gates: false } }, head.envelope.id, head.envelope.version, head.content.parameters);
        expect(evaluateGovernanceGuard(finalWeakening, head.content.parameters).passed).toBe(false);
      }),
      { numRuns: 25 },
    );
  });

  it('applyParametersPatch keeps parameters valid for arbitrary evolvable patches', () => {
    fc.assert(
      fc.property(evolvablePatchArbitrary, (patch) => {
        const next = applyParametersPatch(BASE_PARAMETERS, patch as Record<string, unknown>);
        expect(() => assertValidMetaProcessParameters(next)).not.toThrow();
        expect(next.retrieval_weights['VALIDATED_COMPOSITION']).toBeGreaterThan(0);
        expect(next.retrieval_weights['VALIDATED_PACKAGE']).toBeGreaterThan(0);
        expect(next.strategy.max_candidates_per_family).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 60 },
    );
  });
});
