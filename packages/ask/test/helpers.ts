/**
 * Shared test fixtures for @sos-2/ask tests.
 *
 * Decisions are minted through @sos-2/decision's engine; asks through
 * @sos-2/authority's createAskRequest (via this package's composeAskContent);
 * evidence through @sos-2/evidence's createEvidence.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createAskRequest, createGrant } from '@sos-2/authority';
import type { AskRequestArtifact, AuthorityGrantArtifact } from '@sos-2/authority';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { evaluate } from '@sos-2/decision';
import type { DecisionRecord } from '@sos-2/decision';
import { composeAskContent } from '../src/index.js';
import type { DecisionRequest } from '@sos-2/decision';

const here = dirname(fileURLToPath(import.meta.url));

/** Constitution anchor id from the W0.5 golden fixture artifact-envelope.json. */
export const CONSTITUTION_ANCHOR_ID: string = (
  JSON.parse(readFileSync(join(here, '../../semantic-spine/fixtures/artifact-envelope.json'), 'utf8')) as {
    authority_ref: string;
  }
).authority_ref;

export const PROVENANCE = ['W10:ask-test'];
export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-01-02T00:00:00.000Z';
export const T2 = '2025-01-05T00:00:00.000Z';

export function toolProducer() {
  return {
    tool: 'sos-ask-test',
    tool_version: '0.1.0',
    model: null,
    model_version: null,
    command: 'pnpm test',
    environment: 'ci:local',
  };
}

/** A fresh interventional SUCCESS evidence record about the default target. */
export function evidenceRecord(): EvidenceRecordW3 {
  return createEvidence({
    kind: 'test-run',
    subject_ref: 'sos://Mission/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    availability: 'SUCCESS',
    evidence_class: 'INTERVENTIONAL',
    method: 'test-run:exit-code',
    provenance: ['test-run:sha256:' + '9'.repeat(64)],
    window: { start: T0, end: T2 },
    subject_revision: 'system-state:r1',
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' },
    producer: toolProducer(),
  });
}

/** The escalating decision-request baseline (no grant -> AUTHORITY_INSUFFICIENT ASK). */
export function escalatingRequest(): DecisionRequest {
  return {
    action_kind: 'REVISE',
    action_description: 'Revise the checkout mission document with the revised latency budget.',
    target: { kind: 'KIND', artifact_kind: 'Mission' },
    blast_radius: 'SERVICE',
    impact: 'MODERATE',
    risk: 'LOW',
    reversibility: 'REVERSIBLE',
    causal_claim: false,
    uncertainty: {
      uncertainty_class: 'LOW',
      basis: 'the revision is fully specified and reviewed by two engineers',
    },
    rollback_signals: [],
    evidence: [],
    grants: [],
    evaluation_point: { kind: 'TIME', now: T1 },
    explicit_authority_decision_ref: null,
    confidence: null,
  };
}

/** A valid, covering, permissive grant minted through @sos-2/authority. */
export function validGrant(): AuthorityGrantArtifact {
  return createGrant({
    grantee: 'ask-test-actor',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['READ', 'REVISE', 'PROMOTE'],
    expiry: { kind: 'TIME', at: T2 },
    provenance: PROVENANCE,
    created_at: T0,
    status: 'ACTIVE',
  });
}

/** The escalating decision REQUEST in the matrix corner (risk HIGH x irreversible). */
export function cornerRequest(): DecisionRequest {
  return {
    ...escalatingRequest(),
    grants: [validGrant()],
    risk: 'HIGH',
    reversibility: 'IRREVERSIBLE',
  };
}

export function decisionMeta() {
  return {
    provenance: PROVENANCE,
    created_at: T1,
    authority_ref: CONSTITUTION_ANCHOR_ID,
  };
}

/** Evaluate an ASK decision + compose + mint its AskRequest (the golden workflow). */
export function askFixture(
  request: DecisionRequest = escalatingRequest(),
  version = 1,
): { ask: AskRequestArtifact; origin: DecisionRecord } {
  const evaluation = evaluate(request, decisionMeta());
  if (evaluation.action !== 'ASK') {
    throw new Error(`fixture expects an ASK decision, received ${evaluation.action}`);
  }
  const ask = createAskRequest({
    content: composeAskContent({ decision: evaluation.record }),
    provenance: ['W10:ask-test:ask'],
    created_at: T1,
    version,
  });
  return { ask, origin: evaluation.record };
}
