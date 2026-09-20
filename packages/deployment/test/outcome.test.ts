/**
 * Deployment outcome tests — FAILURES PRESERVE TRUTH STATES: the frozen 6
 * states, the severity-lattice aggregation and the no-conflation pins
 * (a deployment whose status is UNKNOWN is never reported as SUCCESS or
 * FAILURE).
 */

import { describe, expect, it } from 'vitest';
import { assertTruthStateIs, EVIDENCE_TRUTH_STATES } from '@sos-2/semantic-spine';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import { createEvidence } from '@sos-2/evidence';
import {
  AVAILABILITY_SEVERITY_ORDER,
  DeploymentOutcomeError,
  DeploymentStore,
  aggregateAvailability,
  asInterventionEvidenceInput,
  assertValidDeploymentOutcome,
  summarizeDeploymentOutcomes,
  validateDeploymentOutcome,
} from '../src/index.js';
import type { DeploymentOutcome } from '../src/index.js';
import { SUBJECT_ID, T0, T1, makeDeployment, toolProducer } from './helpers.js';

function outcome(overrides: Partial<DeploymentOutcome> = {}): DeploymentOutcome {
  const deployment = makeDeployment();
  return {
    deployment_ref: deployment.envelope.id,
    availability: 'SUCCESS',
    detail: { exitCode: 0 },
    window: { start: T0, end: T1 },
    producer: toolProducer(),
    simulated: false,
    ...overrides,
  };
}

describe('deployment outcome records', () => {
  it('validates well-formed outcomes and rejects malformed ones', () => {
    expect(validateDeploymentOutcome(outcome())).toBe(true);
    expect(() => assertValidDeploymentOutcome(outcome())).not.toThrow();
    expect(validateDeploymentOutcome({ ...outcome(), availability: 'MAYBE' as EvidenceTruthState })).toBe(false);
    expect(validateDeploymentOutcome({ ...outcome(), deployment_ref: 'not-a-spine-id' })).toBe(false);
    expect(validateDeploymentOutcome({ ...outcome(), simulated: 'yes' as unknown as boolean })).toBe(false);
    expect(validateDeploymentOutcome({ ...outcome(), detail: (() => 1) as never })).toBe(false);
    expect(validateDeploymentOutcome(null)).toBe(false);
  });

  it('summarizes honestly: ALL 6 keys are ALWAYS present, zero-filled', () => {
    const summary = summarizeDeploymentOutcomes([
      outcome({ availability: 'SUCCESS' }),
      outcome({ availability: 'SUCCESS' }),
      outcome({ availability: 'UNKNOWN' }),
    ]);
    expect(Object.keys(summary).sort()).toEqual([...EVIDENCE_TRUTH_STATES].sort());
    expect(summary.SUCCESS).toBe(2);
    expect(summary.UNKNOWN).toBe(1);
    expect(summary.FAILURE).toBe(0);
    expect(summary.UNAVAILABLE).toBe(0);
    expect(summary.UNSUPPORTED).toBe(0);
    expect(summary.PARTIAL).toBe(0);
  });
});

describe('the severity lattice (aggregation never increases apparent success)', () => {
  it('SUCCESS is the identity; FAILURE dominates everything', () => {
    expect(aggregateAvailability(['SUCCESS', 'SUCCESS'])).toBe('SUCCESS');
    for (const state of EVIDENCE_TRUTH_STATES) {
      if (state !== 'FAILURE') {
        expect(aggregateAvailability(['FAILURE', state])).toBe('FAILURE');
        expect(aggregateAvailability([state, 'FAILURE'])).toBe('FAILURE');
      }
    }
  });

  it('UNKNOWN survives aggregation with SUCCESS — never becomes SUCCESS or FAILURE', () => {
    const mixed = aggregateAvailability(['SUCCESS', 'UNKNOWN']);
    assertTruthStateIs('UNKNOWN', mixed); // the spine's own conflation guard
    expect(aggregateAvailability(['SUCCESS', 'SUCCESS', 'UNKNOWN'])).toBe('UNKNOWN');
    expect(aggregateAvailability(['UNKNOWN'])).toBe('UNKNOWN');
  });

  it('the full lattice order is exactly as documented', () => {
    for (let i = 0; i < AVAILABILITY_SEVERITY_ORDER.length; i += 1) {
      for (let j = 0; j < AVAILABILITY_SEVERITY_ORDER.length; j += 1) {
        const a = AVAILABILITY_SEVERITY_ORDER[i]!;
        const b = AVAILABILITY_SEVERITY_ORDER[j]!;
        const expected = i >= j ? a : b;
        expect(aggregateAvailability([a, b])).toBe(expected);
      }
    }
  });

  it('rejects empty aggregation (no-data is a gap, handled by statusOf)', () => {
    expect(() => aggregateAvailability([])).toThrow(DeploymentOutcomeError);
    expect(() => aggregateAvailability(['NOPE' as EvidenceTruthState])).toThrow();
  });
});

describe('the store outcome discipline (statusOf never conflates)', () => {
  it('a deployment with NO outcomes reports UNAVAILABLE (a gap, never zero)', () => {
    const store = new DeploymentStore();
    const record = store.put(makeDeployment());
    assertTruthStateIs('UNAVAILABLE', store.statusOf(record.envelope.id));
  });

  it('a deployment whose status is UNKNOWN is reported as EXACTLY UNKNOWN', () => {
    const store = new DeploymentStore();
    const record = store.put(makeDeployment());
    store.recordOutcome(outcome({ deployment_ref: record.envelope.id, availability: 'UNKNOWN' }));
    // The pin: UNKNOWN is never SUCCESS and never FAILURE.
    const status = store.statusOf(record.envelope.id);
    assertTruthStateIs('UNKNOWN', status);
    expect(status).not.toBe('SUCCESS');
    expect(status).not.toBe('FAILURE');
    expect(status).not.toBe('UNAVAILABLE');
  });

  it('UNKNOWN mixed with SUCCESS outcomes still reports UNKNOWN (never SUCCESS)', () => {
    const store = new DeploymentStore();
    const record = store.put(makeDeployment());
    store.recordOutcome(outcome({ deployment_ref: record.envelope.id, availability: 'SUCCESS' }));
    store.recordOutcome(outcome({ deployment_ref: record.envelope.id, availability: 'SUCCESS' }));
    store.recordOutcome(outcome({ deployment_ref: record.envelope.id, availability: 'UNKNOWN' }));
    assertTruthStateIs('UNKNOWN', store.statusOf(record.envelope.id));
  });

  it('a FAILURE outcome dominates and is reported as FAILURE', () => {
    const store = new DeploymentStore();
    const record = store.put(makeDeployment());
    store.recordOutcome(outcome({ deployment_ref: record.envelope.id, availability: 'SUCCESS' }));
    store.recordOutcome(outcome({ deployment_ref: record.envelope.id, availability: 'FAILURE' }));
    assertTruthStateIs('FAILURE', store.statusOf(record.envelope.id));
  });

  it('REJECTS recording simulated outcomes as real deployment status', () => {
    const store = new DeploymentStore();
    const record = store.put(makeDeployment());
    expect(() =>
      store.recordOutcome(outcome({ deployment_ref: record.envelope.id, simulated: true })),
    ).toThrow(/never recorded as real deployment status/);
    // Nothing was recorded: still a gap.
    assertTruthStateIs('UNAVAILABLE', store.statusOf(record.envelope.id));
    expect(store.outcomesOf(record.envelope.id)).toHaveLength(0);
  });

  it('REJECTS outcomes for unknown deployments and malformed outcomes', () => {
    const store = new DeploymentStore();
    expect(() =>
      store.recordOutcome(outcome({ deployment_ref: 'sos://DeploymentRecord/' + '0'.repeat(32) })),
    ).toThrow(/unknown deployment/);
    expect(() => store.recordOutcome(null as never)).toThrow();
  });
});

describe('the intervention-evidence bridge', () => {
  it('mints INTERVENTIONAL evidence inputs from REAL outcomes with VERBATIM availability', () => {
    for (const state of EVIDENCE_TRUTH_STATES) {
      const evidenceInput = asInterventionEvidenceInput(outcome({ availability: state }), {
        subject: SUBJECT_ID,
        artifactRevision: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
        deploymentRevision: 'deploy-prod-2025-06-01',
      });
      expect(evidenceInput.evidence_class).toBe('INTERVENTIONAL');
      expect(evidenceInput.availability).toBe(state); // VERBATIM
      const record = createEvidence({
        ...evidenceInput,
        subject_ref: evidenceInput.subject_ref,
        confidence: { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' },
      });
      expect(record.availability).toBe(state);
      expect(record.intervention).toBe(true);
    }
  });

  it('REJECTS simulated outcomes loudly (never intervention evidence)', () => {
    const simulated = outcome({ simulated: true });
    expect(() =>
      asInterventionEvidenceInput(simulated, { subject: SUBJECT_ID }),
    ).toThrow(/NEVER intervention evidence/);
  });

  it('rejects malformed evidence inputs', () => {
    expect(() => asInterventionEvidenceInput(outcome(), { subject: 'not-a-spine-id' })).toThrow();
  });
});
