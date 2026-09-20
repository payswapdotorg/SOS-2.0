/**
 * Property tests: the ask workflow — determinism, dedup invariants, and
 * the ASK-is-a-success-state discipline under randomized inputs.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createAskRequest } from '@sos-2/authority';
import { evaluate } from '@sos-2/decision';
import { AskQueue, assembleEscalationContext, composeAskContent } from '../src/index.js';
import { decisionMeta, escalatingRequest } from './helpers.js';
import type { DecisionRequest } from '@sos-2/decision';

const riskArb = fc.constantFrom<'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE'>('LOW', 'MODERATE', 'HIGH', 'SEVERE');
const reversibilityArb = fc.constantFrom<'REVERSIBLE' | 'PARTIALLY_REVERSIBLE' | 'IRREVERSIBLE'>(
  'REVERSIBLE',
  'PARTIALLY_REVERSIBLE',
  'IRREVERSIBLE',
);
const uncertaintyArb = fc.constantFrom<'LOW' | 'MODERATE' | 'HIGH' | 'IRREDUCIBLE'>(
  'LOW',
  'MODERATE',
  'HIGH',
  'IRREDUCIBLE',
);

const requestArb = fc
  .record({
    risk: riskArb,
    reversibility: reversibilityArb,
    uncertainty_class: uncertaintyArb,
    with_grant: fc.boolean(),
  })
  .map((flags) => {
    const request: DecisionRequest = {
      ...escalatingRequest(),
      risk: flags.risk,
      reversibility: flags.reversibility,
      uncertainty: { uncertainty_class: flags.uncertainty_class, basis: 'property-test basis' },
      grants: flags.with_grant
        ? [
            {
              envelope: {
                id: 'sos://AuthorityGrant/1234567890abcdef1234567890abcdef',
                kind: 'AuthorityGrant',
                version: 1,
                status: 'ACTIVE',
                authority_ref: null,
                provenance: ['property-test'],
                created_at: '2025-01-01T00:00:00.000Z',
                supersedes: null,
              },
              content: {
                grantee: 'property-actor',
                scope: { kind: 'KIND', artifact_kind: 'Mission' },
                permissions: ['REVISE'],
                expiry: { kind: 'TIME', at: '2025-01-05T00:00:00.000Z' },
                revoked_at: null,
                revocation_provenance: [],
              },
            },
          ]
        : [],
    };
    return { request, flags };
  });

describe('property: the ask workflow is deterministic', () => {
  it('composing + minting the ask for the same ASK record is byte-identical', () => {
    fc.assert(
      fc.property(requestArb, ({ request }) => {
        const evaluation = evaluate(request, decisionMeta());
        if (evaluation.action !== 'ASK') {
          return true; // non-escalating inputs are not part of this property
        }
        const askA = createAskRequest({
          content: composeAskContent({ decision: evaluation.record }),
          provenance: ['W10:ask-property'],
          created_at: '2025-01-02T00:00:00.000Z',
        });
        const askB = createAskRequest({
          content: composeAskContent({ decision: structuredClone(evaluation.record) }),
          provenance: ['W10:ask-property'],
          created_at: '2025-01-02T00:00:00.000Z',
        });
        expect(JSON.stringify(askB)).toBe(JSON.stringify(askA));
        return true;
      }),
      { numRuns: 80 },
    );
  });

  it('the escalation context assembly is deterministic for the same inputs', () => {
    fc.assert(
      fc.property(requestArb, ({ request }) => {
        const evaluation = evaluate(request, decisionMeta());
        if (evaluation.action !== 'ASK') {
          return true;
        }
        const ask = createAskRequest({
          content: composeAskContent({ decision: evaluation.record }),
          provenance: ['W10:ask-property'],
          created_at: '2025-01-02T00:00:00.000Z',
        });
        const contextA = assembleEscalationContext({ ask, decision: evaluation.record, now: '2025-01-02T00:00:00.000Z' });
        const contextB = assembleEscalationContext({
          ask: structuredClone(ask),
          decision: structuredClone(evaluation.record),
          now: '2025-01-02T00:00:00.000Z',
        });
        expect(contextB).toEqual(contextA);
        return true;
      }),
      { numRuns: 80 },
    );
  });
});

describe('property: queue dedup invariants', () => {
  it('the queue NEVER holds two entries with the same input digest', () => {
    fc.assert(
      fc.property(fc.array(requestArb, { minLength: 0, maxLength: 6 }), (cases) => {
        const queue = new AskQueue();
        for (const { request } of cases) {
          const evaluation = evaluate(request, decisionMeta());
          if (evaluation.action !== 'ASK') {
            continue;
          }
          const ask = createAskRequest({
            content: composeAskContent({ decision: evaluation.record }),
            provenance: ['W10:ask-property'],
            created_at: '2025-01-02T00:00:00.000Z',
          });
          queue.enqueue({ ask, origin_decision: evaluation.record, enqueued_at: '2025-01-02T00:00:00.000Z' });
        }
        const digests = queue.list().map((entry) => entry.origin_input_digest);
        expect(new Set(digests).size).toBe(digests.length);
        // And the queue order is deterministic: severity desc, then id.
        const sorted = [...queue.list()].sort((a, b) => {
          const rank = { LOW: 0, MODERATE: 1, HIGH: 2, SEVERE: 3 } as const;
          const bySeverity = rank[b.priority] - rank[a.priority];
          return bySeverity !== 0 ? bySeverity : a.id < b.id ? -1 : 1;
        });
        expect(queue.list().map((entry) => entry.id)).toEqual(sorted.map((entry) => entry.id));
      }),
      { numRuns: 60 },
    );
  });
});

describe('property: ASK is a success state under randomized escalation inputs', () => {
  it('every randomized ASK evaluation flows through compose -> mint -> enqueue without ever throwing', () => {
    fc.assert(
      fc.property(requestArb, ({ request }) => {
        const evaluation = evaluate(request, decisionMeta());
        if (evaluation.action !== 'ASK') {
          return true;
        }
        // ASK is a SUCCESS state: the full ask workflow never throws.
        const content = composeAskContent({ decision: evaluation.record });
        const ask = createAskRequest({
          content,
          provenance: ['W10:ask-property'],
          created_at: '2025-01-02T00:00:00.000Z',
        });
        const queue = new AskQueue();
        const entry = queue.enqueue({ ask, origin_decision: evaluation.record, enqueued_at: '2025-01-02T00:00:00.000Z' });
        expect(entry.status).toBe('PENDING');
        const context = assembleEscalationContext({ ask, decision: evaluation.record, now: '2025-01-02T00:00:00.000Z' });
        expect(context.authority_insufficiency.length).toBeGreaterThan(0);
        return true;
      }),
      { numRuns: 80 },
    );
  });
});
