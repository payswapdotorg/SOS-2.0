import { describe, expect, it } from 'vitest';
import {
  addObjection,
  adoptConformanceEvidence,
  assertValidAssuranceCase,
  assertValidCaseRevision,
  createAssuranceCase,
  evaluateAssuranceCase,
  resolveObjection,
} from '../src/index.js';
import type { AssuranceCaseContent } from '../src/index.js';
import { T1, T2, goldenCaseContent, goldenValidInput, makeEvidence } from './helpers.js';

/**
 * Negative tests for @sos-2/assurance: invalid case transitions, objection
 * discipline, conformance adoption honesty, and evaluation input strictness.
 * Every refusal is loud (AssuranceError family with a specific message).
 */

function contentWith(overrides: Partial<AssuranceCaseContent> = {}): AssuranceCaseContent {
  return { ...goldenCaseContent(), ...overrides };
}

function activeCase() {
  return createAssuranceCase({
    content: goldenCaseContent(),
    provenance: ['W8:negative-test'],
    created_at: T1,
    status: 'ACTIVE',
  });
}

describe('case construction rejects invalid content (loudly)', () => {
  it('rejects a case with no claims', () => {
    expect(() => createAssuranceCase({ content: contentWith({ claims: [] }), provenance: ['x'], created_at: T1 })).toThrow(
      /at least one claim/,
    );
  });

  it('rejects duplicate ids within every section', () => {
    expect(() =>
      createAssuranceCase({
        content: contentWith({
          claims: [
            { id: 'claim-a', statement: 'One.' },
            { id: 'claim-a', statement: 'Duplicate.' },
          ],
        }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/duplicate claim ids/);
    expect(() =>
      createAssuranceCase({
        content: contentWith({
          assumptions: [
            { id: 'assumption-a', statement: 'One.' },
            { id: 'assumption-a', statement: 'Duplicate.' },
          ],
        }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/duplicate assumption ids/);
    expect(() =>
      createAssuranceCase({
        content: contentWith({
          hazards: [
            { id: 'hazard-a', description: 'One.' },
            { id: 'hazard-a', description: 'Duplicate.' },
          ],
        }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/duplicate hazard ids/);
  });

  it('rejects arguments with unknown claims, circularity, or empty premises', () => {
    expect(() =>
      createAssuranceCase({
        content: contentWith({
          arguments: [{ id: 'arg', strategy: 's', conclusion: 'claim-unknown', premises: ['claim-payments-safe'] }],
        }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/unknown claim/);
    expect(() =>
      createAssuranceCase({
        content: contentWith({
          arguments: [
            {
              id: 'arg',
              strategy: 's',
              conclusion: 'claim-payments-safe',
              premises: ['claim-payments-safe', 'claim-payments-correct'],
            },
          ],
        }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/circular/);
    expect(() =>
      createAssuranceCase({
        content: contentWith({
          arguments: [{ id: 'arg', strategy: 's', conclusion: 'claim-payments-safe', premises: [] }],
        }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/premises/);
  });

  it('rejects controls addressing unknown hazards and evidence refs to unknown claims', () => {
    expect(() =>
      createAssuranceCase({
        content: contentWith({
          controls: [{ id: 'control', mechanism: 'm', addresses: ['hazard-unknown'] }],
        }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/unknown hazard/);
    expect(() =>
      createAssuranceCase({
        content: contentWith({
          evidence: [{ evidence_id: makeEvidence().id, role: 'SUPPORTS', claim_ref: 'claim-unknown' }],
        }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/unknown claim/);
  });

  it('rejects malformed evidence references (non-Evidence ids, bad roles, duplicate pairs)', () => {
    expect(() =>
      createAssuranceCase({
        content: contentWith({
          evidence: [{ evidence_id: 'sos://Mission/abcdef0123456789abcdef0123456789', role: 'SUPPORTS', claim_ref: 'claim-payments-safe' }],
        }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/kind Evidence/);
    expect(() =>
      createAssuranceCase({
        content: contentWith({
          evidence: [{ evidence_id: makeEvidence().id, role: 'INVALIDATES', claim_ref: 'claim-payments-safe' }],
        }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/SUPPORTS \/ VERIFIES \/ CONTRADICTS/);
    const record = makeEvidence();
    expect(() =>
      createAssuranceCase({
        content: contentWith({
          evidence: [
            { evidence_id: record.id, role: 'SUPPORTS', claim_ref: 'claim-payments-safe' },
            { evidence_id: record.id, role: 'CONTRADICTS', claim_ref: 'claim-payments-safe' },
          ],
        }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/cannot both support and contradict/);
  });

  it('rejects malformed validity conditions and objections', () => {
    expect(() =>
      createAssuranceCase({
        content: contentWith({
          validity_conditions: [{ kind: 'TEMPORAL', subject: 's', valid_revisions: ['r1'] }],
        }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/IMPLEMENTATION, DEPENDENCY or ENVIRONMENT/);
    expect(() =>
      createAssuranceCase({
        content: contentWith({
          validity_conditions: [{ kind: 'IMPLEMENTATION', subject: 's', valid_revisions: [] }],
        }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/valid_revisions/);
    expect(() =>
      createAssuranceCase({
        content: contentWith({
          objections: [{ id: 'obj', statement: 's', raised_at: 'not-a-time', status: 'OPEN', resolution: null }],
        }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/RFC3339/);
  });

  it('rejects RESOLVED objections without a resolution and resolutions predating the objection', () => {
    expect(() =>
      createAssuranceCase({
        content: contentWith({
          objections: [{ id: 'obj', statement: 's', raised_at: T2, status: 'RESOLVED', resolution: null }],
        }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/carries no resolution/);
    expect(() =>
      createAssuranceCase({
        content: contentWith({
          objections: [
            {
              id: 'obj',
              statement: 's',
              raised_at: T2,
              status: 'RESOLVED',
              resolution: { note: 'n', resolved_at: T1, provenance: ['p'] },
            },
          ],
        }),
        provenance: ['x'],
        created_at: T1,
      }),
    ).toThrow(/resolved before it was raised/);
  });

  it('rejects non-object inputs and wrong envelope kinds at full validation', () => {
    expect(() => assertValidAssuranceCase(null)).toThrow();
    expect(() => assertValidAssuranceCase('case')).toThrow();
    expect(() =>
      assertValidAssuranceCase({ envelope: { kind: 'Mission' }, content: goldenCaseContent() }),
    ).toThrow();
  });
});

describe('invalid case transitions are rejected (loudly)', () => {
  it('addObjection rejects duplicate ids, pre-resolved objections, and bad input', () => {
    const head = activeCase();
    expect(() =>
      addObjection(head, {
        objection: {
          id: 'objection-corpus-coverage',
          statement: 'Duplicate id.',
          raised_at: T2,
          status: 'OPEN',
          resolution: null,
        },
        provenance: ['x'],
        created_at: T2,
      }),
    ).toThrow(/already exists/);
    expect(() =>
      addObjection(head, {
        objection: {
          id: 'objection-pre-resolved',
          statement: 'Born resolved.',
          raised_at: T2,
          status: 'RESOLVED',
          resolution: { note: 'n', resolved_at: T2, provenance: ['p'] },
        },
        provenance: ['x'],
        created_at: T2,
      }),
    ).toThrow(/born OPEN/);
    expect(() =>
      addObjection(head, {
        objection: { id: 'obj', statement: 's', raised_at: T2, status: 'OPEN', resolution: null },
        provenance: [],
        created_at: T2,
      }),
    ).toThrow(/provenance/);
  });

  it('resolveObjection rejects unknown ids, already-resolved objections, and anonymous resolutions', () => {
    const head = activeCase();
    expect(() =>
      resolveObjection(head, {
        objection_id: 'objection-unknown',
        note: 'n',
        resolved_at: T2,
        provenance: ['p'],
        created_at: T2,
      }),
    ).toThrow(/does not exist/);
    expect(() =>
      resolveObjection(head, {
        objection_id: 'objection-corpus-coverage',
        note: '',
        resolved_at: T2,
        provenance: ['p'],
        created_at: T2,
      }),
    ).toThrow(/note/);
    expect(() =>
      resolveObjection(head, {
        objection_id: 'objection-corpus-coverage',
        note: 'n',
        resolved_at: T2,
        provenance: [],
        created_at: T2,
      }),
    ).toThrow(/provenance/);
  });

  it('revision validation rejects dropped objections and regressions (the core objection discipline)', () => {
    const head = activeCase();
    const dropped = createAssuranceCase({
      content: contentWith({ objections: [] }),
      provenance: ['x'],
      created_at: T2,
      status: 'ACTIVE',
      version: head.envelope.version + 1,
      supersedes: head.envelope.id,
    });
    expect(() => assertValidCaseRevision(head, dropped)).toThrow(/never dropped/);
    const wrongChain = createAssuranceCase({
      content: head.content,
      provenance: ['x'],
      created_at: T2,
      status: 'ACTIVE',
      version: head.envelope.version + 2,
      supersedes: head.envelope.id,
    });
    expect(() => assertValidCaseRevision(head, wrongChain)).toThrow(/exactly once/);
  });
});

describe('conformance adoption rejects dishonest bindings', () => {
  it('rejects non-conformance evidence kinds', () => {
    const head = activeCase();
    const record = makeEvidence({ kind: 'telemetry' });
    expect(() =>
      adoptConformanceEvidence(head, {
        evidence: record,
        role: 'SUPPORTS',
        claim_ref: 'claim-payments-safe',
        provenance: ['x'],
        created_at: T2,
      }),
    ).toThrow(/not a conformance evidence kind/);
  });

  it('rejects drift records under supporting roles', () => {
    const head = activeCase();
    const drift = makeEvidence({ kind: 'architecture-contradiction' });
    expect(() =>
      adoptConformanceEvidence(head, {
        evidence: drift,
        role: 'VERIFIES',
        claim_ref: 'claim-payments-safe',
        provenance: ['x'],
        created_at: T2,
      }),
    ).toThrow(/only be adopted with the CONTRADICTS role/);
  });

  it('rejects non-conclusive records under every role (neither support nor contradiction)', () => {
    const head = activeCase();
    for (const availability of ['UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL'] as const) {
      const record = makeEvidence({ kind: 'runtime-conformance', availability });
      expect(() =>
        adoptConformanceEvidence(head, {
          evidence: record,
          role: 'SUPPORTS',
          claim_ref: 'claim-payments-safe',
          provenance: ['x'],
          created_at: T2,
        }),
      ).toThrow(/neither supports nor contradicts/);
    }
  });

  it('rejects availability/role mismatches, unknown claims and duplicate bindings', () => {
    const head = activeCase();
    const failing = makeEvidence({ kind: 'runtime-conformance', availability: 'FAILURE' });
    expect(() =>
      adoptConformanceEvidence(head, {
        evidence: failing,
        role: 'SUPPORTS',
        claim_ref: 'claim-payments-safe',
        provenance: ['x'],
        created_at: T2,
      }),
    ).toThrow(/requires availability SUCCESS/);
    const passing = makeEvidence({ kind: 'runtime-conformance' });
    expect(() =>
      adoptConformanceEvidence(head, {
        evidence: passing,
        role: 'CONTRADICTS',
        claim_ref: 'claim-payments-safe',
        provenance: ['x'],
        created_at: T2,
      }),
    ).toThrow(/requires availability FAILURE/);
    expect(() =>
      adoptConformanceEvidence(head, {
        evidence: passing,
        role: 'SUPPORTS',
        claim_ref: 'claim-unknown',
        provenance: ['x'],
        created_at: T2,
      }),
    ).toThrow(/does not exist/);
    const { case: next } = adoptConformanceEvidence(head, {
      evidence: passing,
      role: 'SUPPORTS',
      claim_ref: 'claim-payments-safe',
      provenance: ['x'],
      created_at: T2,
    });
    expect(() =>
      adoptConformanceEvidence(next, {
        evidence: passing,
        role: 'VERIFIES',
        claim_ref: 'claim-payments-safe',
        provenance: ['x'],
        created_at: T2,
      }),
    ).toThrow(/cannot be bound to the same claim twice/);
  });
});

describe('evaluation rejects invalid input and terminal cases (loudly)', () => {
  it('rejects non-RFC3339 now, bad revision maps, and malformed assumption checks', () => {
    const head = activeCase();
    expect(() => evaluateAssuranceCase(head, { ...goldenValidInput(), now: 'yesterday' })).toThrow(/RFC3339/);
    expect(() =>
      evaluateAssuranceCase(head, { ...goldenValidInput(), implementation_revisions: { 'payments-service': '' } }),
    ).toThrow(/non-empty revision string/);
    expect(() =>
      evaluateAssuranceCase(head, { ...goldenValidInput(), assumption_checks: { 'assumption-unknown': true } }),
    ).toThrow(/unknown assumption/);
    expect(() =>
      evaluateAssuranceCase(head, { ...goldenValidInput(), assumption_checks: { 'assumption-corpus-representative': 'yes' } }),
    ).toThrow(/boolean/);
  });

  it('rejects an evidence pool with duplicate ids under different content', () => {
    const head = activeCase();
    const a = makeEvidence();
    const b = makeEvidence({ provenance: ['different'] });
    expect(a.id === b.id).toBe(false);
    const forged = { ...structuredClone(b), id: a.id };
    expect(() =>
      evaluateAssuranceCase(head, { ...goldenValidInput(), evidence: [a, forged] }),
    ).toThrow(/same id/);
  });

  it('rejects evaluation of SUPERSEDED and RETIRED cases (stale verdicts are never re-issued)', () => {
    const head = activeCase();
    // Envelopes cannot be CREATED in a terminal status (spine discipline); a
    // superseded head is constructed the way the spine lifecycle produces
    // one — same identity chain, terminal status recorded on the envelope.
    const superseded = {
      envelope: {
        ...head.envelope,
        version: head.envelope.version + 1,
        status: 'SUPERSEDED' as const,
        supersedes: head.envelope.id,
      },
      content: head.content,
    };
    expect(() => evaluateAssuranceCase(superseded, goldenValidInput())).toThrow(/never yield verdicts/);
    const retired = {
      envelope: { ...head.envelope, status: 'RETIRED' as const },
      content: head.content,
    };
    expect(() => evaluateAssuranceCase(retired, goldenValidInput())).toThrow(/never yield verdicts/);
  });

  it('expired evidence keeping a case VALID is impossible (fail-safe direction pinned)', () => {
    const head = activeCase();
    const stale = evaluateAssuranceCase(head, { ...goldenValidInput(), now: T2, evidence: [] });
    // With an empty pool the records are MISSING — and with the pool present
    // but expired they are EXPIRED. Neither can keep the case VALID.
    expect(stale.verdict).toBe('INVALID');
    const expired = evaluateAssuranceCase(head, { ...goldenValidInput(), now: T2 });
    expect(expired.verdict).toBe('INVALID');
    expect(expired.invalidations.map((entry) => entry.reason)).toContain('EVIDENCE_EXPIRED');
  });
});
