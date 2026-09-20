/**
 * RUNTIME FEEDS EVIDENCE — the bridge from runtime observations to the
 * merged evidence layer (ingestObservation), with verbatim availability.
 */

import { describe, expect, it } from 'vitest';
import { ingestObservation } from '@sos-2/evidence';
import { isNonAuthoritativeEvidence } from '@sos-2/evidence';
import { assertValidRuntimeObservation, toRawObservation, validateRuntimeObservation } from '../src/index.js';
import { InMemoryRuntimeHost } from '../src/index.js';
import { assertValidRawObservation, validateRawObservation } from '@sos-2/telemetry';
import { EVIDENCE_TRUTH_STATES } from '@sos-2/semantic-spine';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import { SUBJECT_ID, SYSTEM_STATE_ID, T0, T1, grantFixture, runtimeFixture, toolProducer } from './helpers.js';
import type { ExecutionRequest } from '../src/index.js';
import type { RuntimeObservation } from '../src/index.js';

function executedObservation(): RuntimeObservation {
  const valid = grantFixture();
  const host = new InMemoryRuntimeHost(() => valid);
  host.registerRuntime(runtimeFixture(), {
    'evaluate-candidate': () => ({ ok: true }),
    'run-checks': () => null,
  });
  const request: ExecutionRequest = {
    runtime_id: 'runtime:checkout-sandbox',
    operation: 'evaluate-candidate',
    input: null,
    grant_ref: valid.envelope.id,
    at: { kind: 'TIME', now: T0 },
    window: { start: T0, end: T1 },
    producer: toolProducer(),
    subject_ref: SUBJECT_ID,
    observed_system_state: SYSTEM_STATE_ID,
  };
  const result = host.execute(request);
  if (result.status !== 'EXECUTED') {
    throw new Error('expected EXECUTED');
  }
  return result.observation;
}

describe('runtime observation -> raw observation -> evidence', () => {
  it('bridges into a valid RawObservation (telemetry contract)', () => {
    const observation = executedObservation();
    const raw = toRawObservation(observation);
    expect(() => assertValidRawObservation(raw)).not.toThrow();
    expect(validateRawObservation(raw)).toBe(true);
    expect(raw.subject_ref).toBe(SUBJECT_ID);
    expect(raw.availability).toBe(observation.availability);
    expect(raw.attributes).toMatchObject({
      runtime_id: 'runtime:checkout-sandbox',
      operation: 'evaluate-candidate',
      grant_ref: observation.grant_ref,
      observed_system_state: SYSTEM_STATE_ID,
    });
  });

  it('falls back to a source-native subject label when the observation has no subject', () => {
    const observation = { ...executedObservation(), subject_ref: null };
    expect(toRawObservation(observation).subject_ref).toBe('runtime:runtime:checkout-sandbox');
  });

  it('mints evidence through the merged evidence layer with VERBATIM availability (all 6 states)', () => {
    const observation = executedObservation();
    for (const state of EVIDENCE_TRUTH_STATES) {
      const varied: RuntimeObservation = { ...structuredClone(observation), availability: state };
      expect(validateRuntimeObservation(varied)).toBe(true);
      const raw = toRawObservation(varied);
      const record = ingestObservation({ observation: raw, subject: SUBJECT_ID });
      // VERBATIM: the truth state is preserved exactly, never reinterpreted.
      expect(record.availability).toBe(state);
      expect(record.evidence_class).toBe('OBSERVATIONAL');
      expect(isNonAuthoritativeEvidence(record)).toBe(false);
    }
  });

  it('records the observation hash and window in the evidence provenance', () => {
    const observation = executedObservation();
    const record = ingestObservation({ observation: toRawObservation(observation), subject: SUBJECT_ID });
    expect(record.window).toEqual({ start: T0, end: T1 });
    expect(record.provenance.some((entry) => entry.startsWith('observation:sha256:'))).toBe(true);
  });
});

describe('runtime observation validation (negative)', () => {
  const observation = executedObservation();

  it('rejects conflation attempts: availability must be one of the frozen six', () => {
    expect(() =>
      assertValidRuntimeObservation({ ...structuredClone(observation), availability: 'MAYBE' as EvidenceTruthState }),
    ).toThrow();
    expect(
      validateRuntimeObservation({ ...structuredClone(observation), availability: 'MAYBE' as EvidenceTruthState }),
    ).toBe(false);
  });

  it('rejects malformed observation shapes', () => {
    expect(validateRuntimeObservation(null)).toBe(false);
    expect(validateRuntimeObservation({})).toBe(false);
    expect(
      validateRuntimeObservation({ ...structuredClone(observation), grant_ref: 'not-a-spine-id' }),
    ).toBe(false);
    expect(validateRuntimeObservation({ ...structuredClone(observation), id: 'zz' })).toBe(false);
    expect(
      validateRuntimeObservation({ ...structuredClone(observation), observed_system_state: 'not-a-spine-id' }),
    ).toBe(false);
  });

  it('rejects non-OBSERVES/VERIFIES trace links on observations', () => {
    const forged = {
      ...structuredClone(observation),
      trace_links: [
        { source: SUBJECT_ID, target: SYSTEM_STATE_ID, type: 'CAUSED', provenance: ['x'] },
      ],
    };
    expect(validateRuntimeObservation(forged)).toBe(false);
  });
});
