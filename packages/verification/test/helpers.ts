/**
 * Shared test fixtures for @sos-2/verification tests. All ids are minted
 * deterministically through the spine's exported minters.
 */

import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { Producer } from '@sos-2/provenance';
import type { MonitorEvaluationContext } from '../src/index.js';

export const T0 = '2025-06-01T00:00:00.000Z';
export const T1 = '2025-06-01T00:01:00.000Z';
export const T2 = '2025-06-01T00:02:00.000Z';
export const T3 = '2025-06-01T00:03:00.000Z';
export const T10 = '2025-06-01T00:10:00.000Z';
export const NOW = T10;

/** Deterministic SystemState subject id (the monitored system). */
export const SYSTEM_STATE_ID = deriveDeterministicArtifactId('SystemState', {
  note: 'w8 verification test system',
  revision: 'r1',
});

export const SUBJECT_REVISION = `${SYSTEM_STATE_ID}@v1`;
export const IMPLEMENTATION_REVISION = 'c0ffee1234567890c0ffee1234567890c0ffee12';
export const DEPLOYMENT_REVISION = 'dpl-w8-0001';

export function toolProducer(): Producer {
  return {
    tool: 'w8-verification-test',
    tool_version: '1.0.0',
    model: null,
    model_version: null,
    command: 'pnpm -r test',
    environment: 'ci:test',
  };
}

export function context(overrides: Partial<MonitorEvaluationContext> = {}): MonitorEvaluationContext {
  return {
    now: NOW,
    system_state_id: SYSTEM_STATE_ID,
    system_state_version: 1,
    subject_revision: SUBJECT_REVISION,
    implementation_revision: IMPLEMENTATION_REVISION,
    deployment_revision: DEPLOYMENT_REVISION,
    producer: toolProducer(),
    ...overrides,
  };
}
