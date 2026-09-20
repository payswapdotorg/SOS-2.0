/**
 * Shared test fixtures for @sos-2/decision tests.
 *
 * Evidence records are minted through @sos-2/evidence's createEvidence;
 * grants through @sos-2/authority's createGrant/revokeGrant; raises through
 * @sos-2/autonomy's authorizeAutonomyRaise. The simulated-marked record is
 * minted as a W3 record carrying the simulation mark (the same structural
 * mark @sos-2/experiments' simulator stamps).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createGrant, revokeGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact, GrantScope } from '@sos-2/authority';
import { authorizeAutonomyRaise } from '@sos-2/autonomy';
import type { AutonomyRaiseArtifact } from '@sos-2/autonomy';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { createCalibratedConfidence } from '@sos-2/evidence';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { DecisionRequest } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Constitution anchor id from the W0.5 golden fixture artifact-envelope.json. */
export const CONSTITUTION_ANCHOR_ID: string = (
  JSON.parse(readFileSync(join(here, '../../semantic-spine/fixtures/artifact-envelope.json'), 'utf8')) as {
    authority_ref: string;
  }
).authority_ref;

export const PROVENANCE = ['W10:decision-test'];
export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-01-02T00:00:00.000Z'; // the evaluation instant
export const T2 = '2025-01-05T00:00:00.000Z'; // fresh window end / grant expiry (after T1)
export const T_PAST = '2024-12-01T00:00:00.000Z'; // stale window end / expired grants

/** A calibration artifact ref for calibrated confidence marks. */
export const CALIBRATION_REF = deriveDeterministicArtifactId('Evaluation', {
  note: 'w10 decision test calibration',
  brier_score: 0.07,
});

export function highCalibratedConfidence() {
  return createCalibratedConfidence(0.99, CALIBRATION_REF);
}

export function toolProducer() {
  return {
    tool: 'sos-decision-test',
    tool_version: '0.1.0',
    model: null,
    model_version: null,
    command: 'pnpm test',
    environment: 'ci:local',
  };
}

export function llmProducer() {
  return {
    tool: 'decision-assistant',
    tool_version: null,
    model: 'glm-4.5',
    model_version: '2025.1',
    command: null,
    environment: null,
  };
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

export interface GrantOptions {
  scope?: GrantScope;
  permissions?: string[];
  expiry?: { kind: 'TIME'; at: string };
}

export function validGrant(options: GrantOptions = {}): AuthorityGrantArtifact {
  return createGrant({
    grantee: 'w10-decision-test-actor',
    scope: options.scope ?? { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: options.permissions ?? ['READ', 'REVISE', 'PROMOTE'],
    expiry: options.expiry ?? { kind: 'TIME', at: T2 },
    provenance: PROVENANCE,
    created_at: T0,
    status: 'ACTIVE',
  });
}

export function expiredGrant(options: GrantOptions = {}): AuthorityGrantArtifact {
  return validGrant({ ...options, expiry: { kind: 'TIME', at: T_PAST } });
}

export function revokedGrant(options: GrantOptions = {}): AuthorityGrantArtifact {
  const head = validGrant(options);
  return revokeGrant(head, {
    at: { kind: 'TIME', now: T1 },
    provenance: ['W10:decision-test:revocation'],
    created_at: T1,
  });
}

/** A governed raise covering REVISE @ ORGANIZATION (SUPERVISED -> BOUNDED). */
export function sampleRaise(grant: AuthorityGrantArtifact = validGrant()): AutonomyRaiseArtifact {
  return authorizeAutonomyRaise({
    action_kind: 'REVISE',
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    blast_radius: 'ORGANIZATION',
    to_level: 'BOUNDED',
    rationale: 'Organization-wide revision authority demonstrated by six incident-free months.',
    grant,
    at: { kind: 'TIME', now: T1 },
    provenance: PROVENANCE,
    created_at: T1,
    status: 'ACTIVE',
  });
}

// ---------------------------------------------------------------------------
// Evidence records
// ---------------------------------------------------------------------------

export interface EvidenceOptions {
  evidenceClass?: 'OBSERVATIONAL' | 'INTERVENTIONAL';
  availability?: 'SUCCESS' | 'FAILURE' | 'UNKNOWN' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'PARTIAL';
  window?: { start: string; end: string } | null;
  producer?: ReturnType<typeof toolProducer> | ReturnType<typeof llmProducer>;
  subject?: string;
  simulated?: boolean;
}

/**
 * A fresh, interventional, SUCCESS evidence record about the default
 * target kind. The optional `simulated` flag stamps the W3 record with the
 * simulation mark (the structural mark the experiments simulator uses).
 */
export function evidenceRecord(options: EvidenceOptions = {}): EvidenceRecordW3 {
  const record = createEvidence({
    kind: 'test-run',
    subject_ref: options.subject ?? 'sos://Mission/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    availability: options.availability ?? 'SUCCESS',
    evidence_class: options.evidenceClass ?? 'INTERVENTIONAL',
    method: 'test-run:exit-code',
    provenance: ['test-run:sha256:' + '9'.repeat(64)],
    source_revision: 'git:f2f20663d84b55da7dcd7ac34125b2b7ce896e34',
    deployment_revision: null,
    window: options.window ?? { start: T0, end: T2 },
    subject_revision: 'system-state:r1',
    confidence: { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' },
    producer: options.producer ?? toolProducer(),
  });
  if (options.simulated === true) {
    // The simulation mark (layer-6 semantics): a record that carries it is
    // evaluation infrastructure, never evidence.
    return { ...record, simulated: true } as EvidenceRecordW3;
  }
  return record;
}

// ---------------------------------------------------------------------------
// Decision requests
// ---------------------------------------------------------------------------

export interface RequestOptions {
  action_kind?: DecisionRequest['action_kind'];
  action_description?: string;
  blast_radius?: DecisionRequest['blast_radius'];
  impact?: DecisionRequest['impact'];
  risk?: DecisionRequest['risk'];
  reversibility?: DecisionRequest['reversibility'];
  causal_claim?: boolean;
  uncertainty?: DecisionRequest['uncertainty'];
  rollback_signals?: string[];
  evidence?: EvidenceRecordW3[];
  grants?: AuthorityGrantArtifact[];
  raises?: AutonomyRaiseArtifact[];
  explicit_authority_decision_ref?: string | null;
  confidence?: DecisionRequest['confidence'];
  now?: string;
  evaluation_point?: DecisionRequest['evaluation_point'];
}

/** The golden baseline request: REVISE @ SERVICE, clean gates, ACT. */
export function decisionRequest(options: RequestOptions = {}): DecisionRequest {
  return {
    action_kind: options.action_kind ?? 'REVISE',
    action_description:
      options.action_description ?? 'Revise the checkout mission document with the revised latency budget.',
    target: { kind: 'KIND', artifact_kind: 'Mission' },
    blast_radius: options.blast_radius ?? 'SERVICE',
    impact: options.impact ?? 'MODERATE',
    risk: options.risk ?? 'LOW',
    reversibility: options.reversibility ?? 'REVERSIBLE',
    causal_claim: options.causal_claim ?? false,
    uncertainty: options.uncertainty ?? {
      uncertainty_class: 'LOW',
      basis: 'the revision is fully specified and reviewed by two engineers',
    },
    rollback_signals: options.rollback_signals ?? [],
    evidence: options.evidence ?? [],
    grants: options.grants ?? [validGrant()],
    raises: options.raises,
    evaluation_point: options.evaluation_point ?? { kind: 'TIME', now: options.now ?? T1 },
    explicit_authority_decision_ref: options.explicit_authority_decision_ref ?? null,
    confidence: options.confidence ?? null,
  };
}

/** Standard decision meta for tests. */
export function decisionMeta() {
  return {
    provenance: PROVENANCE,
    created_at: T1,
    authority_ref: CONSTITUTION_ANCHOR_ID,
  };
}
