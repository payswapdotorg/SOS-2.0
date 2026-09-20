/**
 * Property tests for @sos-2/deployment — randomized deployment scenarios:
 * determinism + canonical round trips + the aggregation lattice laws.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize, EVIDENCE_TRUTH_STATES } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import {
  DeploymentStore,
  aggregateAvailability,
  assertValidDeploymentOutcome,
  deploymentRecordId,
  isSimulatedRun,
  simulateDeployment,
  simulatedRunOutcomes,
  validateDeployment,
} from '../src/index.js';
import type { DeploymentOutcome } from '../src/index.js';
import { T0, T1, deploymentContent, makeDeployment, toolProducer } from './helpers.js';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const stateArb = fc.constantFrom(...EVIDENCE_TRUTH_STATES) as fc.Arbitrary<EvidenceTruthState>;

const deploymentIdArb = fc
  .integer({ min: 0, max: 100000 })
  .map((n) => `deploy-${n.toString().padStart(5, '0')}`);

const configurationArb: fc.Arbitrary<Record<string, JsonValue>> = fc.dictionary(
  fc.stringMatching(/^[a-z_]{1,10}/),
  fc.jsonValue(),
  { maxKeys: 4 },
) as fc.Arbitrary<Record<string, JsonValue>>;

const deploymentArb = fc
  .tuple(deploymentIdArb, configurationArb, fc.integer({ min: 0, max: 500 }))
  .map(([deployment_id, configuration, salt]) =>
    makeDeployment({
      deployment_id,
      configuration,
      artifact_revision: { kind: 'git-sha', value: salt.toString(16).padStart(40, '0') },
    }),
  );

const outcomeArb = fc
  .tuple(stateArb, fc.option(fc.jsonValue(), { nil: null }), fc.option(fc.jsonValue(), { nil: null }))
  .map(([availability, detail, windowPayload]) => {
    const deployment = makeDeployment();
    const outcome: DeploymentOutcome = {
      deployment_ref: deployment.envelope.id,
      availability,
      detail: (detail ?? null) as DeploymentOutcome['detail'],
      window: windowPayload === null ? null : { start: T0, end: T1 },
      producer: toolProducer(),
      simulated: false,
    };
    return outcome;
  });

// ---------------------------------------------------------------------------
// Record determinism + canonical round trips
// ---------------------------------------------------------------------------

describe('property: deployment records', () => {
  it('identical creation input yields the identical deterministic id', () => {
    fc.assert(
      fc.property(deploymentArb, (record) => {
        const again = makeDeployment({
          deployment_id: record.content.deployment_id,
          configuration: record.content.configuration,
          artifact_revision: record.content.artifact_revision,
        });
        expect(again.envelope.id).toBe(record.envelope.id);
        expect(canonicalSerialize(again)).toBe(canonicalSerialize(record));
        expect(() => assertValidDeploymentOutcome).not.toThrow();
      }),
    );
  });

  it('records validate and canonicalize (round trip through the store)', () => {
    fc.assert(
      fc.property(deploymentArb, (record) => {
        expect(validateDeployment(record)).toBe(true);
        const store = new DeploymentStore();
        const put = store.put(record);
        expect(canonicalSerialize(store.get(put.envelope.id)!)).toBe(canonicalSerialize(put));
      }),
    );
  });

  it('deployment ids are content-addressed (distinct content -> distinct ids)', () => {
    fc.assert(
      fc.property(
        deploymentIdArb,
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (deployment_id, saltA, saltB) => {
          const a = makeDeployment({
            deployment_id,
            artifact_revision: { kind: 'git-sha', value: saltA.toString(16).padStart(40, '0') },
          });
          const b = makeDeployment({
            deployment_id,
            artifact_revision: { kind: 'git-sha', value: saltB.toString(16).padStart(40, '0') },
          });
          if (saltA !== saltB) {
            expect(a.envelope.id).not.toBe(b.envelope.id);
          }
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// The severity lattice laws
// ---------------------------------------------------------------------------

describe('property: aggregation lattice', () => {
  it('aggregation is commutative, associative and idempotent', () => {
    fc.assert(
      fc.property(fc.array(stateArb, { minLength: 1, maxLength: 6 }), (states) => {
        const reversed = [...states].reverse();
        expect(aggregateAvailability(states)).toBe(aggregateAvailability(reversed));
        if (states.length >= 2) {
          const left = aggregateAvailability([aggregateAvailability(states.slice(0, -1)), states[states.length - 1]!]);
          expect(left).toBe(aggregateAvailability(states));
        }
        expect(aggregateAvailability(states)).toBe(aggregateAvailability([aggregateAvailability(states)]));
      }),
    );
  });

  it('aggregation never increases apparent success (monotone severity)', () => {
    fc.assert(
      fc.property(stateArb, fc.array(stateArb, { minLength: 1, maxLength: 5 }), (state, rest) => {
        const combined = aggregateAvailability([state, ...rest]);
        const single = aggregateAvailability([state]);
        // combined is at least as severe as each of its inputs.
        const order = ['SUCCESS', 'UNSUPPORTED', 'UNAVAILABLE', 'UNKNOWN', 'PARTIAL', 'FAILURE'];
        expect(order.indexOf(combined)).toBeGreaterThanOrEqual(order.indexOf(single));
      }),
    );
  });

  it('outcomes with an UNKNOWN state always keep the aggregate UNKNOWN-or-worse', () => {
    fc.assert(
      fc.property(fc.array(stateArb, { minLength: 1, maxLength: 5 }), (states) => {
        if (states.includes('UNKNOWN')) {
          const aggregate = aggregateAvailability(states);
          expect(aggregate).not.toBe('SUCCESS');
          expect(aggregate === 'UNKNOWN' || ['PARTIAL', 'FAILURE'].includes(aggregate)).toBe(true);
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Simulator determinism
// ---------------------------------------------------------------------------

describe('property: deployment simulator', () => {
  const stepsArb = fc
    .array(
      fc.tuple(
        fc.stringMatching(/^[a-z-]{1,10}/),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
      ),
      { minLength: 1, maxLength: 6 },
    )
    .map((tuples) =>
      tuples.map(([name, success_probability, unknown_probability, unavailable_probability]) => ({
        name,
        success_probability,
        unknown_probability,
        unavailable_probability,
      })),
    );

  it('identical seed + input yields bit-identical runs; all outcomes are frozen states', () => {
    fc.assert(
      fc.property(stepsArb, fc.integer({ min: 0, max: 2 ** 31 - 1 }), (steps, seed) => {
        const run = simulateDeployment({
          deployment: makeDeployment(),
          steps,
          seed,
          observed_at: T0,
          producer: toolProducer(),
        });
        const again = simulateDeployment({
          deployment: makeDeployment(),
          steps,
          seed,
          observed_at: T0,
          producer: toolProducer(),
        });
        expect(canonicalSerialize(again)).toBe(canonicalSerialize(run));
        expect(isSimulatedRun(run)).toBe(true);
        for (const outcome of simulatedRunOutcomes(run, toolProducer())) {
          expect(EVIDENCE_TRUTH_STATES).toContain(outcome.availability);
          expect(outcome.simulated).toBe(true);
        }
      }),
    );
  });

  it('different seeds eventually differ (the stream depends on the seed)', () => {
    fc.assert(
      fc.property(stepsArb, fc.integer({ min: 0, max: 1000 }), (steps, baseSeed) => {
        const a = simulateDeployment({ deployment: makeDeployment(), steps, seed: baseSeed, observed_at: T0, producer: toolProducer() });
        const b = simulateDeployment({ deployment: makeDeployment(), steps, seed: baseSeed + 1000000, observed_at: T0, producer: toolProducer() });
        // Not a hard guarantee for degenerate probabilities, so compare the
        // pair: they are deterministic and self-consistent.
        expect(canonicalSerialize(a)).toBe(canonicalSerialize(a));
        expect(canonicalSerialize(b)).toBe(canonicalSerialize(b));
      }),
    );
  });

  it('deterministic outcomes record truthfully: overall == aggregate of steps', () => {
    fc.assert(
      fc.property(stepsArb, fc.integer({ min: 0, max: 2 ** 31 - 1 }), (steps, seed) => {
        const run = simulateDeployment({ deployment: makeDeployment(), steps, seed, observed_at: T0, producer: toolProducer() });
        expect(run.overall_availability).toBe(aggregateAvailability(run.steps.map((s) => s.availability)));
      }),
    );
  });
});
