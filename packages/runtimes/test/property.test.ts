/**
 * Property tests for @sos-2/runtimes — randomized runtime scenarios:
 * determinism, observation id stability, denial correspondence and
 * canonical round trips (the W12 property-test requirement).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize, EVIDENCE_TRUTH_STATES } from '@sos-2/semantic-spine';
import { evaluateGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import {
  InMemoryRuntimeHost,
  assertValidRuntimeObservation,
  canonicalObservationText,
  runtimeObservationHash,
  runtimeObservationId,
  toRawObservation,
} from '../src/index.js';
import type { ExecutionRequest, RuntimeDescriptor } from '../src/index.js';
import { PAST_EXPIRY, SUBJECT_ID, SYSTEM_STATE_ID, T0, T1, grantFixture, runtimeFixture, toolProducer } from './helpers.js';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const runtimeIdArb = fc.integer({ min: 0, max: 1000 }).map((n) => `runtime:sandbox-${n}`);

const descriptorArb: fc.Arbitrary<RuntimeDescriptor> = fc
  .tuple(runtimeIdArb, fc.integer({ min: 0, max: 1000 }))
  .map(([id, salt]) =>
    runtimeFixture({
      id,
      version: `1.${salt}.0`,
      capabilities: ['op'],
      constraints: [],
    }),
  );

/** Grant cases: (grant, expected evaluation status at the fixed instant). */
const grantCaseArb = fc
  .boolean()
  .chain((expired) =>
    fc.constant({
      expired,
      revoked: false,
    }),
  )
  .map((base) => ({ ...base, revokedLabel: base.revoked }));

const inputArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc.string({ maxLength: 20 }),
  fc.jsonValue(),
);

function requestFor(runtimeId: string, grantRef: string, input: unknown): ExecutionRequest {
  return {
    runtime_id: runtimeId,
    operation: 'op',
    input: (input ?? null) as never,
    grant_ref: grantRef,
    at: { kind: 'TIME', now: T0 },
    window: { start: T0, end: T1 },
    producer: toolProducer(),
    subject_ref: SUBJECT_ID,
    observed_system_state: SYSTEM_STATE_ID,
  };
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('property: runtime host determinism', () => {
  it('identical execution inputs yield bit-identical observations (same id, same canonical text)', () => {
    fc.assert(
      fc.property(descriptorArb, inputArb, (descriptor, input) => {
        const valid = grantFixture();
        const run = () => {
          const host = new InMemoryRuntimeHost(() => valid);
          host.registerRuntime(descriptor, { op: () => ({ echo: input ?? null }) as never });
          const result = host.execute(requestFor(descriptor.id, valid.envelope.id, input));
          if (result.status !== 'EXECUTED') {
            throw new Error('expected EXECUTED');
          }
          return result.observation;
        };
        const a = run();
        const b = run();
        expect(canonicalObservationText(a)).toBe(canonicalObservationText(b));
        expect(a.id).toBe(b.id);
        expect(runtimeObservationHash(a)).toBe(runtimeObservationHash(b));
      }),
    );
  });

  it('observation ids are stable content hashes (same content -> same id)', () => {
    fc.assert(
      fc.property(descriptorArb, inputArb, (descriptor, input) => {
        const valid = grantFixture();
        const host = new InMemoryRuntimeHost(() => valid);
        host.registerRuntime(descriptor, { op: () => null });
        const first = host.execute(requestFor(descriptor.id, valid.envelope.id, input));
        const second = host.execute(requestFor(descriptor.id, valid.envelope.id, input));
        if (first.status !== 'EXECUTED' || second.status !== 'EXECUTED') {
          throw new Error('expected EXECUTED');
        }
        expect(first.observation.id).toBe(second.observation.id);
        expect(() => assertValidRuntimeObservation(first.observation)).not.toThrow();
        // And the id derives from the content (minus the id).
        const { id, ...content } = first.observation;
        expect(runtimeObservationId(content as never)).toBe(id);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Authority correspondence + truthful availability
// ---------------------------------------------------------------------------

describe('property: execution denial correspondence', () => {
  it('execution happens iff the resolved grant is VALID at the evaluation point', () => {
    fc.assert(
      fc.property(grantCaseArb, inputArb, (grantCase, input) => {
        const expired = grantCase.expired;
        const grant: AuthorityGrantArtifact = grantFixture({
          expiryAt: expired ? PAST_EXPIRY : '2030-01-01T00:00:00.000Z',
        });
        const expected = evaluateGrant(grant, { kind: 'TIME', now: T0 });
        let ran = false;
        const host = new InMemoryRuntimeHost((grantRef) => (grantRef === grant.envelope.id ? grant : undefined));
        const descriptor = runtimeFixture({ capabilities: ['op'], constraints: [] });
        host.registerRuntime(descriptor, {
          op: () => {
            ran = true;
            return null;
          },
        });
        const result = host.execute(requestFor(descriptor.id, grant.envelope.id, input));
        if (expected === 'VALID') {
          expect(result.status).toBe('EXECUTED');
          expect(ran).toBe(true);
        } else {
          expect(result.status).toBe('EXECUTION_DENIED');
          expect(ran).toBe(false);
          if (result.status === 'EXECUTION_DENIED') {
            expect(result.denial.code).toBe(expected === 'EXPIRED' ? 'GRANT_EXPIRED' : 'GRANT_REVOKED');
          }
        }
      }),
    );
  });

  it('executed observations always carry SUCCESS or FAILURE (truthful, never conflated)', () => {
    fc.assert(
      fc.property(descriptorArb, inputArb, fc.option(fc.string({ minLength: 1 }), { nil: undefined }), (descriptor, input, failWith) => {
        const valid = grantFixture();
        const host = new InMemoryRuntimeHost(() => valid);
        host.registerRuntime(descriptor, {
          op: () => {
            if (failWith !== undefined) {
              throw new Error(failWith);
            }
            return (input ?? null) as never;
          },
        });
        const result = host.execute(requestFor(descriptor.id, valid.envelope.id, input));
        if (result.status === 'EXECUTED') {
          expect(['SUCCESS', 'FAILURE']).toContain(result.observation.availability);
          if (failWith !== undefined) {
            expect(result.observation.availability).toBe('FAILURE');
            expect(result.observation.error).toContain(failWith);
          } else {
            expect(result.observation.availability).toBe('SUCCESS');
            expect(result.observation.error).toBeNull();
          }
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Canonical round trips through the evidence bridge
// ---------------------------------------------------------------------------

describe('property: observation round trips', () => {
  it('every valid observation bridges to a valid raw observation with verbatim availability', () => {
    fc.assert(
      fc.property(descriptorArb, inputArb, fc.constantFrom(...EVIDENCE_TRUTH_STATES), (descriptor, input, state) => {
        const valid = grantFixture();
        const host = new InMemoryRuntimeHost(() => valid);
        host.registerRuntime(descriptor, { op: () => (input ?? null) as never });
        const result = host.execute(requestFor(descriptor.id, valid.envelope.id, input));
        if (result.status !== 'EXECUTED') {
          throw new Error('expected EXECUTED');
        }
        const varied = { ...structuredClone(result.observation), availability: state };
        const raw = toRawObservation(varied);
        expect(raw.availability).toBe(state);
        // The bridge payload is canonical JSON (round-trippable).
        expect(() => canonicalSerialize(raw)).not.toThrow();
      }),
    );
  });
});
