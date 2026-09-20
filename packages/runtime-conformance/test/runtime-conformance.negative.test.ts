import { describe, expect, it } from 'vitest';
import {
  isRuntimeConformanceRecord,
  isRuntimeConformanceResult,
  evaluateRuntimeConformance,
  RuntimeConformanceError,
  structuralRuntimeAdapter,
  systemStateRevisionToken,
} from '../src/index.js';
import type { RuntimeConformanceRecord } from '../src/index.js';
import { createCalibratedConfidence } from '@sos-2/evidence';
import { createSystemState } from '@sos-2/system-state';
import { createArchitectureGraph } from '@sos-2/architecture';
import type { Invariant } from '@sos-2/conformance';
import {
  EVALUATED_AT,
  PRODUCER,
  createDeclaredArchitecture,
  createSystemStateFor,
  observation,
} from './helpers.js';

const FORBIDDEN: Invariant = { kind: 'FORBIDDEN_DEPENDENCY', fromKind: 'Component', toKind: 'Component' };

function evaluate(overrides: Record<string, unknown> = {}) {
  const declared = createDeclaredArchitecture();
  const systemState = createSystemStateFor(declared);
  return evaluateRuntimeConformance({
    system_state: systemState,
    declared_architecture: declared,
    invariants: [FORBIDDEN],
    observations: [observation('component:ui', 'SUCCESS'), observation('component:payment', 'SUCCESS')],
    adapter: structuralRuntimeAdapter,
    producer: PRODUCER,
    evaluated_at: EVALUATED_AT,
    ...overrides,
  } as never);
}

describe('negative: exact-revision binding', () => {
  it('rejects a declared architecture that does not match the SystemState architecture_ref', () => {
    const declared = createDeclaredArchitecture();
    // a DIFFERENT declared graph (content-addressed identity differs)
    const otherDeclared = createArchitectureGraph({
      projects_system_state: {
        system_state_id: 'sos://SystemState/1111111111111111111111111111111a',
        version: 1,
      },
      nodes: [{ id: 'component:other', kind: 'Component', criticality: 'normal', attributes: {} }],
      edges: [],
      provenance: ['W4:negative:other-declared'],
      created_at: '2025-06-01T00:00:00.000Z',
      status: 'ACTIVE',
    });
    expect(otherDeclared.envelope.id).not.toBe(declared.envelope.id);
    const mismatchedId = createSystemState({
      content: {
        architecture_ref: { artifact_id: otherDeclared.envelope.id, version: 1 },
        implementation: [],
        configuration: [],
        deployment: [],
        policy: [],
        environment_relationships: [],
        active_experiments: [],
        package_realizations: [],
      },
      provenance: ['W4:negative'],
      created_at: '2025-06-01T00:00:00.000Z',
    });
    expect(() =>
      evaluate({ system_state: mismatchedId, declared_architecture: declared }),
    ).toThrow(/does not match the declared architecture id/);
    // a version mismatch
    const mismatchedVersion = createSystemStateFor(declared);
    const bumped = {
      ...mismatchedVersion,
      content: {
        ...mismatchedVersion.content,
        architecture_ref: { artifact_id: declared.envelope.id, version: declared.envelope.version + 1 },
      },
    };
    expect(() => evaluate({ system_state: bumped, declared_architecture: declared })).toThrow(
      /does not match the declared architecture envelope version/,
    );
  });

  it('rejects invalid SystemState and architecture artifacts', () => {
    expect(() => evaluate({ system_state: { envelope: null } })).toThrow(/system_state is invalid/);
    expect(() => evaluate({ declared_architecture: { envelope: null } })).toThrow(/declared_architecture is invalid/);
    expect(() => evaluate({ system_state: null })).toThrow(RuntimeConformanceError);
    expect(() => evaluateRuntimeConformance(null as never)).toThrow(RuntimeConformanceError);
  });
});

describe('negative: evaluation input discipline', () => {
  it('rejects invalid or duplicate invariants', () => {
    expect(() => evaluate({ invariants: [{ kind: 'MUST_BE_FAST' }] })).toThrow(/invariant is invalid/);
    expect(() => evaluate({ invariants: [FORBIDDEN, { ...FORBIDDEN }] })).toThrow(/duplicate invariant/);
    expect(() => evaluate({ invariants: 'nope' })).toThrow(/invariants must be an array/);
  });

  it('rejects invalid producers and LLM producers with calibrated confidence', () => {
    expect(() => evaluate({ producer: { tool: '' } })).toThrow(/producer is invalid/);
    const calibration = createCalibratedConfidence(0.9, 'sos://Evaluation/00000000000000000000000000000000');
    const llmProducer = { ...PRODUCER, model: 'gpt-x', model_version: '1' };
    expect(() => evaluate({ producer: llmProducer, confidence: calibration })).toThrow(
      /LLM self-reported confidence|calibrated/,
    );
    // non-LLM producers may carry calibrated confidence
    expect(() => evaluate({ confidence: calibration })).not.toThrow();
  });

  it('rejects non-RFC3339 evaluation instants', () => {
    expect(() => evaluate({ evaluated_at: '2025-06-02' })).toThrow(/RFC3339/);
    expect(() => evaluate({ evaluated_at: '' })).toThrow(/RFC3339/);
  });

  it('rejects malformed adapters and observations', () => {
    expect(() => evaluate({ adapter: { id: 'x' } })).toThrow(/RuntimeViewAdapter/);
    expect(() => evaluate({ adapter: null })).toThrow(/RuntimeViewAdapter/);
    expect(() => evaluate({ observations: 'nope' })).toThrow(/observations must be an array/);
    expect(() => evaluate({ observations: [{ subject_ref: '' }] })).toThrow(/observation is invalid/);
    expect(() => evaluate({ observations: [null] })).toThrow(/observation is invalid/);
  });
});

describe('negative: truth-state conflation is rejected, never normalized', () => {
  it('rejects PASS records carrying non-SUCCESS availability', () => {
    const result = evaluate();
    const record = result.records[0]!;
    expect(record.verdict).toBe('UNKNOWN'); // partial coverage in the fixture
    const conflated: RuntimeConformanceRecord = {
      ...record,
      verdict: 'PASS',
    };
    // PASS with a non-SUCCESS availability is a conflation
    expect(isRuntimeConformanceRecord(conflated)).toBe(false);
  });

  it('rejects FAIL records carrying SUCCESS availability (failure hidden as success)', () => {
    const result = evaluate();
    const record = result.records[0]!;
    const conflated: RuntimeConformanceRecord = {
      ...record,
      verdict: 'FAIL',
      evidence: { ...record.evidence, availability: 'SUCCESS' },
    };
    expect(isRuntimeConformanceRecord(conflated)).toBe(false);
  });

  it('rejects UNKNOWN records carrying SUCCESS or FAILURE availability', () => {
    const result = evaluate();
    const record = result.records[0]!;
    const asSuccess: RuntimeConformanceRecord = {
      ...record,
      verdict: 'UNKNOWN',
      evidence: { ...record.evidence, availability: 'SUCCESS' },
    };
    expect(isRuntimeConformanceRecord(asSuccess)).toBe(false);
    const asFailure: RuntimeConformanceRecord = {
      ...record,
      verdict: 'UNKNOWN',
      evidence: { ...record.evidence, availability: 'FAILURE' },
    };
    expect(isRuntimeConformanceRecord(asFailure)).toBe(false);
    // the honest original passes
    expect(isRuntimeConformanceRecord(record)).toBe(true);
  });

  it('rejects records with the wrong evidence kind, method or class', () => {
    const result = evaluate();
    const record = result.records[0]!;
    expect(
      isRuntimeConformanceRecord({
        ...record,
        evidence: { ...record.evidence, kind: 'telemetry' },
      }),
    ).toBe(false);
    expect(
      isRuntimeConformanceRecord({
        ...record,
        evidence: { ...record.evidence, method: 'telemetry:capture-availability' },
      }),
    ).toBe(false);
    expect(
      isRuntimeConformanceRecord({
        ...record,
        evidence: { ...record.evidence, evidence_class: 'INTERVENTIONAL', intervention: true, observational: false },
      }),
    ).toBe(false);
  });

  it('rejects records missing the OBSERVES/VERIFIES traceability links', () => {
    const result = evaluate();
    const record = result.records[0]!;
    expect(isRuntimeConformanceRecord({ ...record, links: record.links.slice(0, 1) })).toBe(false);
    expect(isRuntimeConformanceRecord({ ...record, links: [] })).toBe(false);
    expect(isRuntimeConformanceRecord({ ...record, links: null })).toBe(false);
    expect(isRuntimeConformanceRecord(null)).toBe(false);
    expect(isRuntimeConformanceRecord('PASS')).toBe(false);
  });

  it('rejects malformed coverage entries and verdicts', () => {
    const result = evaluate();
    const record = result.records[0]!;
    expect(
      isRuntimeConformanceRecord({ ...record, coverage: { ...record.coverage, summary: 'KIND_OF' } }),
    ).toBe(false);
    expect(
      isRuntimeConformanceRecord({
        ...record,
        coverage: { ...record.coverage, subjects: [{ subject: 'x', bucket: 'MAYBE' }] },
      }),
    ).toBe(false);
    expect(isRuntimeConformanceRecord({ ...record, verdict: 'NOT_APPLICABLE' })).toBe(false);
    expect(isRuntimeConformanceRecord({ ...record, verdict: 'UNAVAILABLE' })).toBe(false);
    expect(isRuntimeConformanceRecord({ ...record, reason: '' })).toBe(false);
  });

  it('rejects malformed evaluation results', () => {
    const result = evaluate();
    expect(isRuntimeConformanceResult(result)).toBe(true);
    expect(isRuntimeConformanceResult({ ...result, records: 'nope' })).toBe(false);
    expect(isRuntimeConformanceResult({ ...result, records: [{ ...result.records[0]!, verdict: 'PASS' }] })).toBe(
      false,
    );
    expect(isRuntimeConformanceResult({ ...result, system_state_id: 'nope' })).toBe(false);
    expect(isRuntimeConformanceResult(null)).toBe(false);
  });
});

describe('negative: subject-revision tokens', () => {
  it('rejects malformed system state ids and versions', () => {
    expect(() => systemStateRevisionToken('nope', 1)).toThrow(/artifact id/);
    expect(() => systemStateRevisionToken('sos://SystemState/00000000000000000000000000000000', 0)).toThrow(
      /integer >= 1/,
    );
    expect(() => systemStateRevisionToken('sos://SystemState/00000000000000000000000000000000', 1.5)).toThrow(
      /integer >= 1/,
    );
    expect(systemStateRevisionToken('sos://SystemState/00000000000000000000000000000000', 3)).toBe(
      'sos://SystemState/00000000000000000000000000000000@v3',
    );
  });
});
