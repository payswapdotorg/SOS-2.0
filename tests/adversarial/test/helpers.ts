/**
 * Shared W17 adversarial fixtures — deterministic, pure (fixed instants,
 * content-addressed identities, no I/O, no hidden clocks).
 */

import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { createEvidence } from '@sos-2/evidence';
import type { CreateEvidenceInput, EvidenceRecordW3 } from '@sos-2/evidence';
import { expect } from 'vitest';
import { TraceLinkStore, deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import type { Producer, TimeWindow } from '@sos-2/provenance';

export const T0 = '2025-06-01T00:00:00.000Z';
export const T1 = '2025-06-02T00:00:00.000Z';
export const T2 = '2025-06-03T00:00:00.000Z';
export const T_FAR = '2025-12-31T00:00:00.000Z';

export const ADVERSARIAL_PROVENANCE = ['W17:adversarial'];

/** A deterministic governance anchor for the adversarial suites. */
export const ADVERSARIAL_ANCHOR = deriveDeterministicArtifactId('Constitution', {
  note: 'w17 adversarial verification governance anchor',
  scenario: 'w17-adversarial',
});

/** A spine id of any kind (for test subjects that are not full artifacts). */
export function subjectId(kind: string, note: string): string {
  return deriveDeterministicArtifactId(kind, { note, scenario: 'w17-adversarial' });
}

export function toolProducer(): Producer {
  return {
    tool: 'w17-adversarial-harness',
    tool_version: '1.0.0',
    model: null,
    model_version: null,
    command: 'vitest run tests/adversarial',
    environment: 'ci:local',
  };
}

export function llmProducer(): Producer {
  return {
    tool: 'reasoning-provider',
    tool_version: '1.0.0',
    model: 'some-llm',
    model_version: '1.0.0',
    command: null,
    environment: 'ci:local',
  };
}

export const WINDOW: TimeWindow = { start: T0, end: T_FAR };

export function makeEvidence(subject: string, overrides: Partial<CreateEvidenceInput> = {}): EvidenceRecordW3 {
  return createEvidence({
    kind: 'telemetry',
    subject_ref: subject,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'telemetry:capture-availability',
    provenance: ['observation:sha256:' + 'a'.repeat(64)],
    window: WINDOW,
    subject_revision: null,
    producer: toolProducer(),
    ...overrides,
  });
}

/** A valid PROMOTE grant over a kind (TIME-bound, expiring after T2). */
export function promoteGrant(artifactKind: string, grantee = 'w17-adversarial-runner'): AuthorityGrantArtifact {
  return createGrant({
    grantee,
    scope: { kind: 'KIND', artifact_kind: artifactKind },
    permissions: ['READ', 'PROMOTE'],
    expiry: { kind: 'TIME', at: T_FAR },
    provenance: [...ADVERSARIAL_PROVENANCE, 'authority:promote-grant'],
    created_at: T0,
    status: 'ACTIVE',
  });
}

/**
 * THE TRACE-CHAIN-STAYS-QUERYABLE check shared by every adversarial suite:
 * after the fault was constructed and contained, mint the artifact's links
 * into a spine TraceLinkStore and verify from/to/typed queries still answer.
 */
export function assertTraceQueryable(links: readonly TraceLink[]): {
  store: TraceLinkStore;
  queryFrom: (source: string) => TraceLink[];
  queryTo: (target: string) => TraceLink[];
} {
  const store = new TraceLinkStore();
  for (const link of links) {
    if (!store.has(link.source, link.target, link.type)) {
      store.add(link);
    }
  }
  for (const link of links) {
    expect(store.has(link.source, link.target, link.type)).toBe(true);
  }
  const queryFrom = (source: string) => store.from(source);
  const queryTo = (target: string) => store.to(target);
  return { store, queryFrom, queryTo };
}
