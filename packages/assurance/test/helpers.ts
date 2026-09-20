/**
 * Shared test fixtures for @sos-2/assurance tests.
 *
 * All ids are minted deterministically through the spine's exported minters
 * (never invented by hand). The golden case fixture is checked in at
 * fixtures/assurance-case.json and its ids are pinned by tests (W0.5/W3
 * fixture discipline).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { createEvidence } from '@sos-2/evidence';
import type { CreateEvidenceInput, EvidenceRecordW3 } from '@sos-2/evidence';
import type { Producer, TimeWindow } from '@sos-2/provenance';
import type { AssuranceCaseArtifact } from '../src/index.js';
import type { AssuranceCaseContent } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-01-02T00:00:00.000Z';
export const T2 = '2025-01-03T00:00:00.000Z';
export const T3 = '2025-01-10T00:00:00.000Z';

export const W_EARLY: TimeWindow = { start: T0, end: T1 };
export const W_LATE: TimeWindow = { start: T1, end: T2 };

/** Deterministic subject ids for evidence records (SystemState subjects). */
export const SYSTEM_STATE_ID = deriveDeterministicArtifactId('SystemState', {
  note: 'w8 assurance test subject',
  revision: 'r1',
});

export function toolProducer(): Producer {
  return {
    tool: 'w8-assurance-test',
    tool_version: '1.0.0',
    model: null,
    model_version: null,
    command: 'pnpm -r test',
    environment: 'ci:test',
  };
}

/** Build a valid evidence creation input (overridable). */
export function evidenceInput(overrides: Partial<CreateEvidenceInput> = {}): CreateEvidenceInput {
  return {
    kind: 'test-run',
    subject_ref: SYSTEM_STATE_ID,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'test-run:exit-code',
    provenance: ['W8:test-fixture'],
    source_revision: 'rev-0001',
    deployment_revision: 'dpl-0001',
    window: W_EARLY,
    subject_revision: `${SYSTEM_STATE_ID}@v1`,
    producer: toolProducer(),
    ...overrides,
  };
}

export function makeEvidence(overrides: Partial<CreateEvidenceInput> = {}): EvidenceRecordW3 {
  return createEvidence(evidenceInput(overrides));
}

/** The canonical content of the golden case fixture (evidence refs are content-addressed, hence deterministic). */
export function goldenCaseContent(): AssuranceCaseContent {
  const supportingEvidence = makeEvidence();
  const runtimeEvidence = makeEvidence({ kind: 'runtime-conformance' });
  return {
    claims: [
      {
        id: 'claim-payments-safe',
        statement: 'The payment flow is safe to operate in production.',
      },
      {
        id: 'claim-payments-correct',
        statement: 'Payment totals are computed correctly for every checkout.',
      },
      {
        id: 'claim-payments-recoverable',
        statement: 'Any in-flight payment can be recovered without data loss.',
      },
    ],
    arguments: [
      {
        id: 'argument-safety',
        strategy: 'Correctness plus recoverability jointly establish operational safety.',
        conclusion: 'claim-payments-safe',
        premises: ['claim-payments-correct', 'claim-payments-recoverable'],
      },
    ],
    assumptions: [
      {
        id: 'assumption-corpus-representative',
        statement: 'The test corpus is representative of production traffic.',
      },
    ],
    hazards: [
      {
        id: 'hazard-double-charge',
        description: 'A retried payment charges the customer twice.',
      },
    ],
    controls: [
      {
        id: 'control-idempotency-key',
        mechanism: 'Idempotency keys on every payment request.',
        addresses: ['hazard-double-charge'],
      },
    ],
    evidence: [
      {
        evidence_id: supportingEvidence.id,
        role: 'SUPPORTS',
        claim_ref: 'claim-payments-correct',
      },
      {
        evidence_id: runtimeEvidence.id,
        role: 'VERIFIES',
        claim_ref: 'claim-payments-correct',
      },
    ],
    validity_conditions: [
      {
        kind: 'IMPLEMENTATION',
        subject: 'payments-service',
        valid_revisions: ['rev-0001', 'rev-0002'],
      },
      {
        kind: 'ENVIRONMENT',
        subject: 'prod-eu',
        valid_revisions: ['env-2025-01'],
      },
    ],
    objections: [
      {
        id: 'objection-corpus-coverage',
        statement: 'The corpus does not cover currency-conversion rounding.',
        raised_at: T1,
        status: 'OPEN',
        resolution: null,
      },
    ],
  };
}

/** The golden case fixture (lazy read — the fixture is generated from goldenCaseContent()). */
export function goldenCase(): AssuranceCaseArtifact {
  return JSON.parse(
    readFileSync(join(here, '../fixtures', 'assurance-case.json'), 'utf8'),
  ) as AssuranceCaseArtifact;
}

/** The evidence pool that satisfies the golden case (fresh SUCCESS records). */
export function goldenEvidencePool(): EvidenceRecordW3[] {
  return [makeEvidence(), makeEvidence({ kind: 'runtime-conformance' })];
}

/** The evaluation input under which the golden case is OBJECTIONED (its objection stands). */
export function goldenValidInput() {
  return {
    now: T1,
    systemStateRevision: `${SYSTEM_STATE_ID}@v1`,
    implementation_revisions: { 'payments-service': 'rev-0001' },
    dependency_revisions: {},
    environment_revisions: { 'prod-eu': 'env-2025-01' },
    evidence: goldenEvidencePool(),
    assumption_checks: { 'assumption-corpus-representative': true },
  };
}
