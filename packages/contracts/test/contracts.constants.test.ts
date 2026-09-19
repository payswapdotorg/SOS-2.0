import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_STATUSES,
  CONFORMANCE_CLASSES,
  CORE_ARTIFACT_KINDS,
  EVIDENCE_TRUTH_STATES,
  PACKAGE_MATURITIES,
  TRACE_LINK_TYPES,
  assertTruthStateIs,
  createKindRegistry,
  isConformanceClass,
  isCoreArtifactKind,
  isEvidenceTruthState,
  isTraceLinkType,
  isValidArtifactKindFormat,
  listArtifactKinds,
  registerArtifactKind,
} from '../src/index.js';

describe('frozen vocabularies (spec/meta-model.md)', () => {
  it('exposes exactly the 17 frozen trace link types in frozen order', () => {
    expect([...TRACE_LINK_TYPES]).toEqual([
      'SATISFIES',
      'REALIZES',
      'REFINES',
      'CONSTRAINS',
      'IMPLEMENTS',
      'VERIFIES',
      'OBSERVES',
      'SUPPORTS',
      'CONTRADICTS',
      'CAUSED_BY',
      'CAUSED',
      'DERIVED_FROM',
      'COMPATIBLE_WITH',
      'CONFLICTS_WITH',
      'COMPOSES',
      'SPECIALIZES',
      'GENERALIZES',
    ]);
    expect(TRACE_LINK_TYPES).toHaveLength(17);
    expect(new Set(TRACE_LINK_TYPES).size).toBe(17);
  });

  it('accepts every frozen trace link type and rejects anything else', () => {
    for (const type of TRACE_LINK_TYPES) {
      expect(isTraceLinkType(type)).toBe(true);
    }
    for (const bad of ['', 'satisfies', 'SATISFY', 'SATISFIES ', 'UNKNOWN_TYPE', 17, null]) {
      expect(isTraceLinkType(bad)).toBe(false);
    }
  });

  it('exposes exactly the 6 distinct evidence truth states', () => {
    expect([...EVIDENCE_TRUTH_STATES]).toEqual([
      'SUCCESS',
      'FAILURE',
      'UNKNOWN',
      'UNAVAILABLE',
      'UNSUPPORTED',
      'PARTIAL',
    ]);
    expect(EVIDENCE_TRUTH_STATES).toHaveLength(6);
    expect(new Set(EVIDENCE_TRUTH_STATES).size).toBe(6);
  });

  it('pins semantic distinctness of truth states (never conflate unknown/unavailable)', () => {
    // The exact-state contract: two distinct states are never interchangeable.
    expect(() => assertTruthStateIs('UNKNOWN', 'UNKNOWN')).not.toThrow();
    expect(() => assertTruthStateIs('UNAVAILABLE', 'UNAVAILABLE')).not.toThrow();
    expect(() => assertTruthStateIs('UNKNOWN', 'UNAVAILABLE')).toThrow(/conflation/);
    expect(() => assertTruthStateIs('UNAVAILABLE', 'UNKNOWN')).toThrow(/conflation/);
    expect(() => assertTruthStateIs('SUCCESS', 'FAILURE')).toThrow(/conflation/);
    expect(() => assertTruthStateIs('UNSUPPORTED', 'UNKNOWN')).toThrow(/conflation/);
    expect(() => assertTruthStateIs('PARTIAL', 'SUCCESS')).toThrow(/conflation/);
    // Every pairwise conflation of distinct states is rejected.
    for (const a of EVIDENCE_TRUTH_STATES) {
      for (const b of EVIDENCE_TRUTH_STATES) {
        if (a === b) {
          expect(() => assertTruthStateIs(a, b)).not.toThrow();
        } else {
          expect(() => assertTruthStateIs(a, b)).toThrow(/conflation/);
        }
      }
    }
  });

  it('accepts exactly the 6 truth states in guards', () => {
    for (const state of EVIDENCE_TRUTH_STATES) {
      expect(isEvidenceTruthState(state)).toBe(true);
    }
    for (const bad of ['', 'unknown', 'Unknown', 'NOT_AVAILABLE', 'ERROR', 'NONE', 0, undefined]) {
      expect(isEvidenceTruthState(bad)).toBe(false);
    }
  });

  it('exposes exactly the 19 core artifact kinds', () => {
    expect([...CORE_ARTIFACT_KINDS]).toEqual([
      'Constitution',
      'Mission',
      'ValueModel',
      'Context',
      'SystemState',
      'ArchitectureGraph',
      'ImplementationModel',
      'Evidence',
      'CausalHypothesis',
      'CandidateState',
      'AssuranceCase',
      'Experiment',
      'Decision',
      'Package',
      'PackageComposition',
      'ArchitectureMemory',
      'Evaluation',
      'AuthorityGrant',
      'AskRequest',
    ]);
    expect(CORE_ARTIFACT_KINDS).toHaveLength(19);
    expect(new Set(CORE_ARTIFACT_KINDS).size).toBe(19);
    for (const kind of CORE_ARTIFACT_KINDS) {
      expect(isCoreArtifactKind(kind)).toBe(true);
    }
    expect(isCoreArtifactKind('MissionStatement')).toBe(false);
  });

  it('exposes exactly the 7 conformance classes', () => {
    expect([...CONFORMANCE_CLASSES]).toEqual([
      'IMPLEMENTATION_DETAIL',
      'EXPECTED_VARIATION',
      'PRESERVING_REFINEMENT',
      'INTENTIONAL_EVOLUTION',
      'DRIFT',
      'UNKNOWN',
      'CONTRADICTION',
    ]);
    expect(CONFORMANCE_CLASSES).toHaveLength(7);
    for (const cls of CONFORMANCE_CLASSES) {
      expect(isConformanceClass(cls)).toBe(true);
    }
    expect(isConformanceClass('drift')).toBe(false);
    expect(isConformanceClass('MINOR')).toBe(false);
  });

  it('exposes the envelope status vocabulary and package maturities', () => {
    expect([...ARTIFACT_STATUSES]).toEqual(['DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED']);
    expect([...PACKAGE_MATURITIES]).toEqual([
      'DISCOVERED',
      'FORMING',
      'VALIDATED',
      'MATURE',
      'CONTEXTUALIZED',
      'SUPERSEDED',
      'RETIRED',
    ]);
  });
});

describe('artifact kind registry', () => {
  it('seeds the default registry with the 19 canonical kinds', () => {
    const listed = listArtifactKinds();
    expect(listed).toHaveLength(19);
    expect(listed).toContain('Mission');
    expect(listed).toContain('AskRequest');
    // sorted deterministically
    expect(listed).toEqual([...listed].sort());
  });

  it('registers an extension kind through the explicit API', () => {
    registerArtifactKind('MissionStatement');
    expect(listArtifactKinds()).toContain('MissionStatement');
    expect(listArtifactKinds()).toHaveLength(20);
  });

  it('rejects duplicate registration (never silently re-registers)', () => {
    registerArtifactKind('TemporaryFixtureKind');
    expect(() => registerArtifactKind('TemporaryFixtureKind')).toThrow(/already registered/);
    expect(() => registerArtifactKind('Mission')).toThrow(/already registered/);
  });

  it('rejects invalid kind formats', () => {
    for (const bad of ['', 'mission', 'Mission Statement', 'mission-statement', '9Mission', 'Sub_Kind']) {
      expect(() => registerArtifactKind(bad)).toThrow(/format/);
    }
    expect(isValidArtifactKindFormat('Constitution')).toBe(true);
    expect(isValidArtifactKindFormat('subsystem')).toBe(false);
  });

  it('supports isolated registries with a custom seed', () => {
    const registry = createKindRegistry(['Mission', 'Evidence']);
    expect(registry.list()).toEqual(['Evidence', 'Mission']);
    registry.register('IsolatedKind');
    expect(registry.list()).toEqual(['Evidence', 'IsolatedKind', 'Mission']);
    expect(() => registry.register('Mission')).toThrow(/already registered/);
    // isolated from the default registry (IsolatedKind is not a core kind)
    expect(listArtifactKinds()).not.toContain('IsolatedKind');
  });
});
