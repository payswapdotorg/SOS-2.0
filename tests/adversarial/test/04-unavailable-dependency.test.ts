/**
 * ADVERSARIAL CLASS 4 — UNAVAILABLE DEPENDENCY (R21: truthful
 * unavailability state).
 *
 * The fault: an execution/authority dependency is unavailable (an expired or
 * revoked grant behind the execution adapter) and package evidence refs
 * cannot be resolved. The system must return TRUTHFUL unavailability states
 * — typed EXECUTION_DENIED denials and honest unresolved-evidence contexts —
 * never fabricated successes — and the trace chain stays queryable.
 */

import { describe, expect, test } from 'vitest';
import { InMemoryExecutionAdapter } from '@sos-2/adapters';
import { createGrant, revokeGrant } from '@sos-2/authority';
import { createPackageArtifact } from '@sos-2/packages';
import { PackageRegistry } from '@sos-2/registry';
import { createTraceLink } from '@sos-2/semantic-spine';
import { makeEvidence, subjectId } from './helpers.js';
import { ADVERSARIAL_PROVENANCE, T0, T1, assertTraceQueryable, promoteGrant } from './helpers.js';

describe('adversarial class 4: unavailable dependency', () => {
  test('an expired grant yields a typed EXECUTION_DENIED (GRANT_EXPIRED) — never a fabricated success', () => {
    const adapter = new InMemoryExecutionAdapter({
      'run-candidate': (input) => ({ ran: true, input }),
    });
    const expired = createGrant({
      grantee: 'w17-adversarial-runner',
      scope: { kind: 'KIND', artifact_kind: 'Decision' },
      permissions: ['READ'],
      expiry: { kind: 'TIME', at: T0 },
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:4:expired-grant'],
      created_at: T0,
      status: 'ACTIVE',
    });
    const result = adapter.execute({
      operation: 'run-candidate',
      input: { candidate: 'c-1' },
      grant: expired,
      at: { kind: 'TIME', now: T1 },
    });
    // DETECTED + CONTAINED: a typed denial record, not a throw, not a fake run.
    expect(result.status).toBe('EXECUTION_DENIED');
    if (result.status === 'EXECUTION_DENIED') {
      expect(result.denial.code).toBe('GRANT_EXPIRED');
      expect(result.denial.grant_ref).toBe(expired.envelope.id);
      expect(result.denial.reason.length).toBeGreaterThan(0);
    }
  });

  test('a revoked grant yields EXECUTION_DENIED (GRANT_REVOKED) with the revocation retained', () => {
    const adapter = new InMemoryExecutionAdapter({
      'run-candidate': () => ({ ran: true }),
    });
    const grant = promoteGrant('Decision');
    const revoked = revokeGrant(grant, {
      at: { kind: 'TIME', now: T0 },
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:4:revocation'],
      created_at: T0,
    });
    expect(revoked.content.revoked_at).toBe(T0);
    const result = adapter.execute({
      operation: 'run-candidate',
      input: null,
      grant: revoked,
      at: { kind: 'TIME', now: T1 },
    });
    expect(result.status).toBe('EXECUTION_DENIED');
    if (result.status === 'EXECUTION_DENIED') {
      expect(result.denial.code).toBe('GRANT_REVOKED');
    }
  });

  test('unresolvable package evidence refs stay honestly unresolved in retrieval', () => {
    const subject = subjectId('SystemState', 'adversarial-4-evaluation-subject');
    const evidence = [makeEvidence(subject), makeEvidence(subject, { provenance: ['observation:sha256:' + 'b'.repeat(64)] })];
    const pkg = createPackageArtifact({
      content: {
        semantic_capability: 'adversarial-4-capability',
        contracts: ['contract:adversarial-4/v1'],
        preconditions: [],
        postconditions: [],
        realizations: [],
        applicability: [
          { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED', context: { environment: 'production' }, sample_size: 2, window: null },
        ],
        evidence_refs: evidence.map((record) => record.id),
        failure_refs: [],
        compatibility_refs: [],
        composition_refs: [],
        assurance_obligations: [{ kind: 'TEST', obligation: 'the package tests pass' }],
        context: { environment: 'production' },
        learned_limitations: [],
        diversity_profile: { family: 'adversarial-4-family', dimensions: [{ dimension: 'COST', stance: 'low' }] },
        maturity: 'DISCOVERED',
        changes: 'initial discovery',
        superseded_by: null,
      },
      provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:4:package'],
      created_at: T0,
      status: 'ACTIVE',
    });
    const registry = new PackageRegistry();
    registry.putPackage(pkg, evidence);

    // The evidence resolver is UNAVAILABLE for every ref (the dependency is
    // down): retrieval must stay honest about it.
    const result = registry.retrieve({
      capability: 'adversarial-4-capability',
      evidenceResolver: () => undefined,
    });
    expect(result.candidates.length).toBe(1);
    const candidate = result.candidates[0]!;
    expect(candidate.evidence_context.total_refs).toBe(2);
    expect(candidate.evidence_context.resolved).toBe(0);
    expect(candidate.evidence_context.unresolved).toBe(2);
    // No availability or success is fabricated for unresolved refs (every
    // truth-state count stays zero).
    expect(Object.keys(candidate.evidence_context.availability).length).toBe(6);
    expect(Object.values(candidate.evidence_context.availability).every((count) => count === 0)).toBe(true);
    expect(candidate.evidence_context.successes).toBe(0);
    expect(candidate.evidence_context.failures).toBe(0);
    // The uncertainty is carried honestly (no invented probability).
    expect(candidate.uncertainty.probability).toBeUndefined();
  });

  test('the trace chain stays queryable after the unavailability', () => {
    const decisionId = subjectId('Decision', 'adversarial-4-decision');
    const grantId = subjectId('AuthorityGrant', 'adversarial-4-grant');
    const links = [
      createTraceLink({
        source: decisionId,
        target: grantId,
        type: 'DERIVED_FROM',
        provenance: [...ADVERSARIAL_PROVENANCE, 'adversarial:4:decision-derived-from-grant'],
      }),
    ];
    const { queryFrom, queryTo } = assertTraceQueryable(links);
    expect(queryFrom(decisionId).length).toBe(1);
    expect(queryTo(grantId).length).toBe(1);
  });
});
