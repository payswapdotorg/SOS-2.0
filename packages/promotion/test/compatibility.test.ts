/**
 * INTEGRATION COMPATIBILITY — the W9 parallelization contract: the
 * candidate/assurance/evidence INPUT SHAPES match the frozen contracts
 * (CandidateState / AssuranceCase / Evidence kinds + the spine's golden
 * fixtures) so W7 (candidate generation) and W8 (assurance cases) integrate
 * later WITHOUT contract changes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  assertValidEnvelope,
  CORE_ARTIFACT_KINDS,
  isArtifactId,
  isEvidenceRecord,
  isRegisteredArtifactKind,
  isTraceLink,
  parseArtifactId,
  validateTraceLink,
} from '@sos-2/semantic-spine';
import type { ArtifactEnvelope } from '@sos-2/semantic-spine';
import { assertValidEvidenceRecord, validateEvidenceRecord } from '@sos-2/evidence';
import { DECISION_ACTIONS } from '@sos-2/authority';
import { candidateStateFromLocalCandidate } from '@sos-2/experiments';
import type { LocalCandidate } from '@sos-2/architecture';
import { evaluatePromotion, validateAssuranceCase, validateBoundedRecovery, validatePromotionDecision } from '../src/index.js';
import {
  healthyResult,
  interventionalEvidence,
  PROVENANCE,
  rollbackTriggersOf,
  sampleCandidate,
  sampleExperimentFor,
  T0,
  T1,
  validAssuranceCase,
  validGrant,
  validRecovery,
} from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const spineFixtures = join(here, '../../semantic-spine/fixtures');

describe('the frozen contracts are consumed, never redefined', () => {
  it('CandidateState, AssuranceCase, Experiment and Decision are frozen core kinds (registered, untouched)', () => {
    for (const kind of ['CandidateState', 'AssuranceCase', 'Experiment', 'Decision', 'Evaluation', 'AuthorityGrant']) {
      expect(isRegisteredArtifactKind(kind)).toBe(true);
      expect((CORE_ARTIFACT_KINDS as readonly string[]).includes(kind)).toBe(true);
    }
  });

  it('the candidate input shape is a spine envelope of the frozen CandidateState kind', () => {
    const candidate = sampleCandidate();
    expect(() => assertValidEnvelope(candidate.envelope as unknown)).not.toThrow();
    expect(candidate.envelope.kind).toBe('CandidateState');
    expect(isArtifactId(candidate.envelope.id)).toBe(true);
    expect(parseArtifactId(candidate.envelope.id).kind).toBe('CandidateState');
  });

  it('the evidence input shape satisfies the normative EvidenceRecord contract AND the W3 realization', () => {
    const candidate = sampleCandidate();
    const record = interventionalEvidence(candidate);
    expect(isEvidenceRecord(record)).toBe(true);
    expect(validateEvidenceRecord(record)).toBe(true);
    expect(() => assertValidEvidenceRecord(record)).not.toThrow();
  });

  it('the assurance input shape is a well-formed AssuranceCase-kind spine id + claims/verdict/validity', () => {
    const assurance = validAssuranceCase();
    expect(validateAssuranceCase(assurance)).toBe(true);
    expect(isArtifactId(assurance.id)).toBe(true);
    expect(parseArtifactId(assurance.id).kind).toBe('AssuranceCase');
    expect(assurance.claims.length).toBeGreaterThan(0);
  });

  it('the decision output shape is a spine envelope of the frozen Decision kind', () => {
    const candidate = sampleCandidate();
    const evaluation = evaluatePromotion(candidate, {
      authority: { grant: validGrant(candidate), now: T0 },
      assurance: validAssuranceCase({ expiresAt: T1 }),
      evidence: [],
      provenance: PROVENANCE,
      created_at: T1,
    });
    expect(validatePromotionDecision(evaluation.record)).toBe(true);
    expect((DECISION_ACTIONS as readonly string[]).includes(evaluation.decision)).toBe(true);
  });

  it('the promotion decision vocabulary IS @sos-2/authority\'s frozen six (never invented)', () => {
    expect(DECISION_ACTIONS).toEqual(['ACT', 'EXPERIMENT', 'GATHER_EVIDENCE', 'ASK', 'REJECT', 'ROLLBACK']);
  });
});

describe('the spine golden fixtures are consumed (W0.5 discipline)', () => {
  it('artifact-envelope.json is a valid spine envelope whose Constitution anchor authorizes the golden candidate', () => {
    const fixture = JSON.parse(readFileSync(join(spineFixtures, 'artifact-envelope.json'), 'utf8'));
    expect(() => assertValidEnvelope(fixture)).not.toThrow();
    const candidate = sampleCandidate();
    expect(candidate.envelope.authority_ref).toBe((fixture as ArtifactEnvelope).authority_ref);
  });

  it('evidence.json (the contracts-layer golden evidence) satisfies the normative contract', () => {
    const fixture = JSON.parse(readFileSync(join(spineFixtures, 'evidence.json'), 'utf8'));
    expect(isEvidenceRecord(fixture)).toBe(true);
  });

  it('trace-link.json validates through the spine layer', () => {
    const fixture = JSON.parse(readFileSync(join(spineFixtures, 'trace-link.json'), 'utf8'));
    expect(isTraceLink(fixture)).toBe(true);
    expect(validateTraceLink(fixture)).toBe(true);
  });
});

describe('W2 integration: merged LocalCandidate -> CandidateState fixture bridge', () => {
  it('a W2 LocalCandidate adapts into the promotion-gate candidate shape without contract changes', () => {
    const local: LocalCandidate = {
      baseGraphRef: {
        graph_id: 'sos://ArchitectureGraph/' + '1'.repeat(32),
        version: 2,
      },
      boundedSubgraph: { nodes: ['cache-layer'], edges: [] },
      replacement: [
        {
          op: 'ADD_COMPONENT',
          node: { id: 'write-through-cache', kind: 'Component', criticality: 'critical', attributes: {} },
        },
      ],
      invariants: ['p99 read latency stays below 500ms'],
      predictedEffects: ['p99 read latency drops below 200ms'],
    };
    const candidate = candidateStateFromLocalCandidate(local, {
      provenance: PROVENANCE,
      created_at: T0,
    });
    expect(() => assertValidEnvelope(candidate.envelope as unknown)).not.toThrow();
    expect(candidate.content.bounded_subgraph_ref).toEqual({
      graph_id: local.baseGraphRef.graph_id,
      version: local.baseGraphRef.version,
    });
    expect(candidate.envelope.id).toMatch(/^sos:\/\/CandidateState\/[0-9a-f]{32}$/);
  });
});

describe('W9-experiments integration: recovery wiring consumes real trigger records', () => {
  it('a bounded recovery declaration wires REAL guardrail trigger records from evaluateExperimentResult', () => {
    const candidate = sampleCandidate();
    const experiment = sampleExperimentFor(candidate);
    const result = healthyResult(experiment);
    const triggers = rollbackTriggersOf(experiment, result);
    const recovery = validRecovery(experiment, triggers);
    expect(validateBoundedRecovery(recovery)).toBe(true);
    expect(recovery.rollback_triggers[0]!.trigger.rule_id).toBe('error-budget');
  });
});
