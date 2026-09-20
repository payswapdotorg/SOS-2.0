import { describe, expect, it } from 'vitest';
import {
  addObjection,
  assertValidCaseRevision,
  createAssuranceCase,
  evaluateAssuranceCase,
  resolveObjection,
} from '../src/index.js';
import { T1, T2, goldenCaseContent, goldenValidInput } from './helpers.js';

function activeCase() {
  return createAssuranceCase({
    content: goldenCaseContent(),
    provenance: ['W8:evolve-test'],
    created_at: T1,
    status: 'ACTIVE',
  });
}

describe('objection lifecycle — addObjection', () => {
  it('appends a new OPEN objection as the next revision (version + 1, supersedes the head)', () => {
    const head = activeCase();
    const next = addObjection(head, {
      objection: {
        id: 'objection-new',
        statement: 'A newly raised objection.',
        raised_at: T2,
        status: 'OPEN',
        resolution: null,
      },
      provenance: ['W8:evolve-test:add-objection'],
      created_at: T2,
    });
    expect(next.envelope.version).toBe(head.envelope.version + 1);
    expect(next.envelope.supersedes).toBe(head.envelope.id);
    expect(next.envelope.id).not.toBe(head.envelope.id);
    expect(next.content.objections.map((objection) => objection.id).sort()).toEqual([
      'objection-corpus-coverage',
      'objection-new',
    ]);
    // The new objection surfaces in the verdict.
    const evaluation = evaluateAssuranceCase(next, {
      ...goldenValidInput(),
    });
    expect(evaluation.verdict).toBe('OBJECTIONED');
    expect(evaluation.open_objections.map((objection) => objection.id)).toEqual([
      'objection-corpus-coverage',
      'objection-new',
    ]);
  });

  it('is deterministic: identical revision input reproduces the identical revision id', () => {
    const head = activeCase();
    const input = {
      objection: {
        id: 'objection-new',
        statement: 'A newly raised objection.',
        raised_at: T2,
        status: 'OPEN' as const,
        resolution: null,
      },
      provenance: ['W8:evolve-test:add-objection'],
      created_at: T2,
    };
    expect(addObjection(head, input)).toEqual(addObjection(head, JSON.parse(JSON.stringify(input))));
  });
});

describe('objection lifecycle — resolveObjection', () => {
  it('transitions OPEN -> RESOLVED with note, instant and provenance', () => {
    const head = activeCase();
    const next = resolveObjection(head, {
      objection_id: 'objection-corpus-coverage',
      note: 'Currency rounding cases were added to the corpus (commit ab12).',
      resolved_at: T2,
      provenance: ['W8:evolve-test:resolve', 'corpus-commit:ab12'],
      created_at: T2,
    });
    expect(next.envelope.version).toBe(2);
    const resolved = next.content.objections.find((objection) => objection.id === 'objection-corpus-coverage');
    expect(resolved?.status).toBe('RESOLVED');
    expect(resolved?.resolution?.note).toBe('Currency rounding cases were added to the corpus (commit ab12).');
    expect(resolved?.resolution?.resolved_at).toBe(T2);
    expect(resolved?.resolution?.provenance).toEqual(['W8:evolve-test:resolve', 'corpus-commit:ab12']);

    // With the only objection resolved, the case evaluates VALID.
    const evaluation = evaluateAssuranceCase(next, goldenValidInput());
    expect(evaluation.verdict).toBe('VALID');
  });

  it('keeps the resolved objection on the record (never dropped)', () => {
    const head = activeCase();
    const next = resolveObjection(head, {
      objection_id: 'objection-corpus-coverage',
      note: 'Resolved.',
      resolved_at: T2,
      provenance: ['W8:evolve-test:resolve'],
      created_at: T2,
    });
    expect(next.content.objections.length).toBe(1);
    expect(assertValidCaseRevision(head, next)).toBeUndefined();
  });

  it('resolutions are terminal: a RESOLVED objection is never re-resolved or re-opened', () => {
    const head = activeCase();
    const resolved = resolveObjection(head, {
      objection_id: 'objection-corpus-coverage',
      note: 'Resolved once.',
      resolved_at: T2,
      provenance: ['W8:evolve-test:resolve'],
      created_at: T2,
    });
    expect(() =>
      resolveObjection(resolved, {
        objection_id: 'objection-corpus-coverage',
        note: 'Resolved again.',
        resolved_at: T2,
        provenance: ['W8:evolve-test:resolve'],
        created_at: T2,
      }),
    ).toThrow(/already RESOLVED/);
    // A direct revision re-opening the objection is rejected by the revision guard.
    const reopenedContent = structuredClone(resolved.content);
    const objection = reopenedContent.objections.find((entry) => entry.id === 'objection-corpus-coverage')!;
    objection.status = 'OPEN';
    objection.resolution = null;
    const reopened = createAssuranceCase({
      content: reopenedContent,
      provenance: ['W8:evolve-test:reopen-attempt'],
      created_at: T2,
      status: 'ACTIVE',
      version: resolved.envelope.version + 1,
      supersedes: resolved.envelope.id,
    });
    expect(() => assertValidCaseRevision(resolved, reopened)).toThrow(/cannot be re-opened/);
  });
});

describe('revision discipline — objections are never dropped', () => {
  it('a direct revision dropping an objection is rejected by assertValidCaseRevision', () => {
    const head = activeCase();
    const droppedContent = structuredClone(head.content);
    droppedContent.objections = [];
    const dropped = createAssuranceCase({
      content: droppedContent,
      provenance: ['W8:evolve-test:drop-attempt'],
      created_at: T2,
      status: 'ACTIVE',
      version: head.envelope.version + 1,
      supersedes: head.envelope.id,
    });
    expect(() => assertValidCaseRevision(head, dropped)).toThrow(/never dropped/);
  });

  it('a direct revision rewriting a resolution is rejected', () => {
    const head = activeCase();
    const resolved = resolveObjection(head, {
      objection_id: 'objection-corpus-coverage',
      note: 'Original resolution.',
      resolved_at: T2,
      provenance: ['W8:evolve-test:resolve'],
      created_at: T2,
    });
    const rewrittenContent = structuredClone(resolved.content);
    const objection = rewrittenContent.objections.find((entry) => entry.id === 'objection-corpus-coverage')!;
    objection.resolution = {
      note: 'Edited resolution.',
      resolved_at: T2,
      provenance: ['W8:evolve-test:edit-attempt'],
    };
    const rewritten = createAssuranceCase({
      content: rewrittenContent,
      provenance: ['W8:evolve-test:rewrite-attempt'],
      created_at: T2,
      status: 'ACTIVE',
      version: resolved.envelope.version + 1,
      supersedes: resolved.envelope.id,
    });
    expect(() => assertValidCaseRevision(resolved, rewritten)).toThrow(/never edited/);
  });

  it('version and supersedes discipline is enforced across revisions', () => {
    const head = activeCase();
    const sameVersion = createAssuranceCase({
      content: head.content,
      provenance: ['W8:evolve-test:bad-revision'],
      created_at: T2,
      status: 'ACTIVE',
      version: head.envelope.version,
      supersedes: head.envelope.id,
    });
    expect(() => assertValidCaseRevision(head, sameVersion)).toThrow(/increment the version exactly once/);
  });
});
