import { describe, expect, it } from 'vitest';
import {
  compareHypothesisWithDeclared,
  compareWithDeclared,
  isHypothesisComparison,
  verdictFor,
  VERDICT_LINK_TYPES,
} from '../src/index.js';
import { recoverArchitectureHypotheses } from '../src/index.js';
import { CONFORMANCE_LINK_TYPES } from '@sos-2/conformance';
import { createArchitectureGraph } from '@sos-2/architecture';
import { CREATED_AT, PROJECTS, PROVENANCE, ambiguousModel, createDeclaredGraphArtifact, unambiguousModel } from './helpers.js';

const BASE_INPUT = { projects_system_state: PROJECTS, provenance: PROVENANCE, created_at: CREATED_AT };

describe('verdict derivation', () => {
  it('DRIFT_DETECTED beats AMBIGUOUS beats CONFORMANT', () => {
    expect(verdictFor([])).toBe('CONFORMANT');
    expect(
      verdictFor([{ classification: 'IMPLEMENTATION_DETAIL', subject: 'a', reason: 'r', link: null as never }]),
    ).toBe('CONFORMANT');
    expect(
      verdictFor([{ classification: 'UNKNOWN', subject: 'a', reason: 'r', link: null as never }]),
    ).toBe('AMBIGUOUS');
    expect(
      verdictFor([
        { classification: 'UNKNOWN', subject: 'a', reason: 'r', link: null as never },
        { classification: 'DRIFT', subject: 'b', reason: 'r', link: null as never },
      ]),
    ).toBe('DRIFT_DETECTED');
    expect(
      verdictFor([{ classification: 'CONTRADICTION', subject: 'a', reason: 'r', link: null as never }]),
    ).toBe('DRIFT_DETECTED');
  });

  it('the verdict link-type mapping is frozen', () => {
    expect(VERDICT_LINK_TYPES).toEqual({
      CONFORMANT: 'COMPATIBLE_WITH',
      DRIFT_DETECTED: 'CONFLICTS_WITH',
      AMBIGUOUS: 'DERIVED_FROM',
    });
  });
});

describe('comparison against the declared architecture', () => {
  it('compares every retained hypothesis and delegates classification to @sos-2/conformance', () => {
    const recovery = recoverArchitectureHypotheses({ model: ambiguousModel(), ...BASE_INPUT });
    const declared = createDeclaredGraphArtifact();
    const comparisons = compareWithDeclared(recovery, declared);
    expect(comparisons).toHaveLength(recovery.hypotheses.length);
    for (const comparison of comparisons) {
      expect(isHypothesisComparison(comparison)).toBe(true);
      const hypothesis = recovery.hypotheses.find(
        (entry) => entry.artifact.envelope.id === comparison.hypothesis_id,
      )!;
      expect(comparison.hypothesis_strategy).toBe(hypothesis.strategy);
      expect(comparison.declared_id).toBe(declared.envelope.id);
      // records are the W2 typed reconciliation records
      for (const record of comparison.records) {
        expect(typeof record.classification).toBe('string');
        expect(typeof record.subject).toBe('string');
        expect(typeof record.reason).toBe('string');
        expect(record.link.source).toBe(ambiguousModel().id);
        expect(record.link.target).toBe(declared.envelope.id);
        expect(record.link.type).toBe(CONFORMANCE_LINK_TYPES[record.classification]);
      }
    }
  });

  it('the DIRECT reading classifies grouped realizations as PRESERVING_REFINEMENT', () => {
    const recovery = recoverArchitectureHypotheses({ model: ambiguousModel(), ...BASE_INPUT });
    const declared = createDeclaredGraphArtifact();
    const direct = recovery.hypotheses.find((hypothesis) => hypothesis.strategy === 'DIRECT')!;
    const comparison = compareHypothesisWithDeclared(direct, declared);
    const bySubject = new Map(comparison.records.map((record) => [record.subject, record]));
    expect(bySubject.get('store:billing-records')!.classification).toBe('PRESERVING_REFINEMENT');
    expect(bySubject.get('store:billing-records')!.reason).toContain('component:billing-store-shard-a');
    // shards are undeclared implementation details under the direct reading
    expect(bySubject.get('component:billing-store-shard-a')!.classification).toBe('IMPLEMENTATION_DETAIL');
    // the declared critical audit store is missing -> CONTRADICTION
    expect(bySubject.get('store:audit-log')!.classification).toBe('CONTRADICTION');
    // declared legacy-exports is missing -> DRIFT
    expect(bySubject.get('component:legacy-exports')!.classification).toBe('DRIFT');
    // the interface projection lets the declared Interface node be classified
    // instead of silently drifting: the observed interface matches the
    // declared node (same id, same kind after projection)
    expect(bySubject.has('iface:billing-api')).toBe(false);
    // verdict: drift and contradiction present
    expect(comparison.verdict).toBe('DRIFT_DETECTED');
    expect(comparison.verdictLink.type).toBe('CONFLICTS_WITH');
  });

  it('the MERGED reading creates a kind conflict the classifier reports as UNKNOWN', () => {
    const recovery = recoverArchitectureHypotheses({ model: ambiguousModel(), ...BASE_INPUT });
    const declared = createDeclaredGraphArtifact();
    const merged = recovery.hypotheses.find((hypothesis) => hypothesis.strategy === 'MERGED_REALIZATIONS')!;
    const comparison = compareHypothesisWithDeclared(merged, declared);
    const bySubject = new Map(comparison.records.map((record) => [record.subject, record]));
    // merged node id matches the declared DataStore id, but the merged kind is
    // Component -> correspondence ambiguous -> UNKNOWN (never resolved)
    const storeFinding = bySubject.get('store:billing-records');
    expect(storeFinding).toBeDefined();
    expect(storeFinding!.classification).toBe('UNKNOWN');
    expect(storeFinding!.reason).toContain('ambiguous');
  });

  it('a fully conformant model yields the CONFORMANT verdict and a COMPATIBLE_WITH link', () => {
    const model = unambiguousModel();
    const recovery = recoverArchitectureHypotheses({ model, ...BASE_INPUT });
    const declared = createDeclaredGraphArtifact();
    const comparison = compareWithDeclared(recovery, declared)[0]!;
    // billing and mailer match, but the rest of the declared graph is missing
    expect(comparison.verdict).toBe('DRIFT_DETECTED');
    // Now the conformant scenario: declare exactly what the model observes
    const conformantDeclared = createArchitectureGraph({
      projects_system_state: PROJECTS,
      nodes: [
        { id: 'component:billing', kind: 'Component', criticality: 'normal', attributes: {} },
        { id: 'component:mailer', kind: 'Component', criticality: 'normal', attributes: {} },
      ],
      edges: [
        { source: 'component:billing', target: 'component:mailer', kind: 'Dependency', criticality: 'normal', attributes: {} },
      ],
      provenance: ['W4:recovery-fixture:conformant'],
      created_at: CREATED_AT,
      status: 'ACTIVE',
    });
    const conformantComparison = compareWithDeclared(
      recoverArchitectureHypotheses({ model, ...BASE_INPUT }),
      conformantDeclared,
    )[0]!;
    expect(conformantComparison.records).toEqual([]);
    expect(conformantComparison.verdict).toBe('CONFORMANT');
    expect(conformantComparison.verdictLink.type).toBe('COMPATIBLE_WITH');
    expect(conformantComparison.verdictLink.source).toBe(conformantComparison.hypothesis_id);
    expect(conformantComparison.verdictLink.target).toBe(conformantDeclared.envelope.id);
    expect(conformantComparison.verdictLink.provenance).toContain('verdict:CONFORMANT');
  });

  it('drift evidence flows through from the W2 reconciliation', () => {
    const recovery = recoverArchitectureHypotheses({ model: ambiguousModel(), ...BASE_INPUT });
    const declared = createDeclaredGraphArtifact();
    const direct = recovery.hypotheses.find((hypothesis) => hypothesis.strategy === 'DIRECT')!;
    const comparison = compareHypothesisWithDeclared(direct, declared);
    expect(comparison.drift.length).toBeGreaterThan(0);
    for (const record of comparison.drift) {
      expect(record.id.startsWith('sos://Evidence/')).toBe(true);
      expect(['DRIFT', 'CONTRADICTION']).toContain(record.classification);
    }
    // normalized model exposed for auditability
    expect(comparison.normalizedModel.id).toBe(ambiguousModel().id);
  });
});
