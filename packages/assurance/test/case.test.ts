import { describe, expect, it } from 'vitest';
import {
  assertValidAssuranceCase,
  assuranceCaseArtifactId,
  createAssuranceCase,
  validateAssuranceCase,
} from '../src/index.js';
import { isArtifactId, parseArtifactId } from '@sos-2/semantic-spine';
import {
  T1,
  goldenCase,
  goldenCaseContent,
  goldenValidInput,
  makeEvidence,
} from './helpers.js';
import { evaluateAssuranceCase } from '../src/index.js';

describe('assurance case creation', () => {
  it('creates a valid ACTIVE case with a deterministic content-addressed id', () => {
    const artifact = createAssuranceCase({
      content: goldenCaseContent(),
      provenance: ['W8:golden-fixture:assurance-case'],
      created_at: T1,
      status: 'ACTIVE',
    });
    expect(validateAssuranceCase(artifact)).toBe(true);
    expect(artifact.envelope.kind).toBe('AssuranceCase');
    expect(artifact.envelope.status).toBe('ACTIVE');
    expect(artifact.envelope.version).toBe(1);
    expect(isArtifactId(artifact.envelope.id)).toBe(true);
    expect(parseArtifactId(artifact.envelope.id).kind).toBe('AssuranceCase');
    expect(artifact.envelope.id).toBe('sos://AssuranceCase/cfd0c4d34161d82b443866725f7fc63e');
  });

  it('reproduces the identical id for identical creation input (determinism)', () => {
    const input = {
      content: goldenCaseContent(),
      provenance: ['W8:golden-fixture:assurance-case'],
      created_at: T1,
      status: 'ACTIVE' as const,
    };
    const a = createAssuranceCase(input);
    const b = createAssuranceCase(JSON.parse(JSON.stringify(input)));
    expect(a).toEqual(b);
    expect(assuranceCaseArtifactId(input)).toBe(a.envelope.id);
  });

  it('different content yields a different id (content sensitivity)', () => {
    const base = {
      provenance: ['W8:test'],
      created_at: T1,
    };
    const a = createAssuranceCase({ ...base, content: goldenCaseContent() });
    const changedContent = goldenCaseContent();
    changedContent.claims = [
      ...changedContent.claims,
      { id: 'claim-extra', statement: 'An additional claim.' },
    ];
    const b = createAssuranceCase({ ...base, content: changedContent });
    expect(a.envelope.id).not.toBe(b.envelope.id);
  });

  it('the golden fixture round-trips: parsed fixture is a valid case and re-derives bit-exactly', () => {
    const fixture = goldenCase();
    expect(validateAssuranceCase(fixture)).toBe(true);
    const round = JSON.parse(JSON.stringify(fixture));
    expect(round).toEqual(fixture);
    const reproduced = createAssuranceCase({
      content: fixture.content,
      provenance: fixture.envelope.provenance,
      created_at: fixture.envelope.created_at,
      status: fixture.envelope.status,
    });
    expect(reproduced.envelope.id).toBe(fixture.envelope.id);
  });

  it('carries the eight content sections verbatim', () => {
    const artifact = goldenCase();
    expect(Object.keys(artifact.content).sort()).toEqual(
      [
        'arguments',
        'assumptions',
        'claims',
        'controls',
        'evidence',
        'hazards',
        'objections',
        'validity_conditions',
      ].sort(),
    );
    expect(artifact.content.claims.length).toBe(3);
    expect(artifact.content.arguments.length).toBe(1);
    expect(artifact.content.assumptions.length).toBe(1);
    expect(artifact.content.hazards.length).toBe(1);
    expect(artifact.content.controls.length).toBe(1);
    expect(artifact.content.evidence.length).toBe(2);
    expect(artifact.content.validity_conditions.length).toBe(2);
    expect(artifact.content.objections.length).toBe(1);
  });
});

describe('assurance case validation', () => {
  it('assertValidAssuranceCase accepts the golden case', () => {
    expect(() => assertValidAssuranceCase(goldenCase())).not.toThrow();
  });

  it('the golden evidence pool binds to the referenced evidence ids', () => {
    const pool = [makeEvidence(), makeEvidence({ kind: 'runtime-conformance' })];
    const refs = goldenCase().content.evidence.map((ref) => ref.evidence_id);
    expect(pool.map((record) => record.id).sort()).toEqual([...refs].sort());
  });

  it('the golden case evaluates OBJECTIONED under its valid input (its OPEN objection surfaces)', () => {
    const evaluation = evaluateAssuranceCase(goldenCase(), goldenValidInput());
    expect(evaluation.verdict).toBe('OBJECTIONED');
    expect(evaluation.invalidations).toEqual([]);
    expect(evaluation.open_objections.map((objection) => objection.id)).toEqual([
      'objection-corpus-coverage',
    ]);
  });
});
