/**
 * Property tests: randomized requests — decision determinism (same input ->
 * byte-identical record), escalation-matrix coverage through the engine,
 * canonical round trips, and outcome totality.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DECISION_ACTIONS } from '@sos-2/authority';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import { evaluate, validateDecisionRecord } from '../src/index.js';
import { createGrant } from '@sos-2/authority';
import { createEvidence } from '@sos-2/evidence';
import { decisionMeta, toolProducer } from './helpers.js';
import type { DecisionRequest } from '../src/index.js';

const actionKindArb = fc.constantFrom<'READ' | 'REVISE' | 'RETIRE' | 'PROMOTE' | 'DELEGATE'>(
  'READ',
  'REVISE',
  'RETIRE',
  'PROMOTE',
  'DELEGATE',
);
const blastArb = fc.constantFrom<'COMPONENT' | 'SERVICE' | 'SYSTEM' | 'ORGANIZATION'>(
  'COMPONENT',
  'SERVICE',
  'SYSTEM',
  'ORGANIZATION',
);
const riskArb = fc.constantFrom<'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE'>('LOW', 'MODERATE', 'HIGH', 'SEVERE');
const reversibilityArb = fc.constantFrom<'REVERSIBLE' | 'PARTIALLY_REVERSIBLE' | 'IRREVERSIBLE'>(
  'REVERSIBLE',
  'PARTIALLY_REVERSIBLE',
  'IRREVERSIBLE',
);
const impactArb = fc.constantFrom<'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL'>('LOW', 'MODERATE', 'HIGH', 'CRITICAL');
const uncertaintyArb = fc.constantFrom<'LOW' | 'MODERATE' | 'HIGH' | 'IRREDUCIBLE'>('LOW', 'MODERATE', 'HIGH', 'IRREDUCIBLE');
const permissionSubsetArb = fc.uniqueArray(fc.constantFrom('READ', 'REVISE', 'RETIRE', 'PROMOTE', 'DELEGATE'), {
  minLength: 1,
  maxLength: 5,
});

const requestArb = fc
  .record({
    action_kind: actionKindArb,
    blast_radius: blastArb,
    risk: riskArb,
    reversibility: reversibilityArb,
    impact: impactArb,
    uncertainty_class: uncertaintyArb,
    causal_claim: fc.boolean(),
    with_grant: fc.boolean(),
    grant_permissions: permissionSubsetArb,
    with_rollback_signal: fc.boolean(),
    with_explicit_decision: fc.boolean(),
    with_fresh_evidence: fc.boolean(),
    evidence_class: fc.constantFrom<'OBSERVATIONAL' | 'INTERVENTIONAL'>('OBSERVATIONAL', 'INTERVENTIONAL'),
  })
  .map((flags) => {
    const request: DecisionRequest = {
      action_kind: flags.action_kind,
      action_description: 'Randomized property-test proposal for the checkout mission revision.',
      target: { kind: 'KIND', artifact_kind: 'Mission' },
      blast_radius: flags.blast_radius,
      impact: flags.impact,
      risk: flags.risk,
      reversibility: flags.reversibility,
      causal_claim: flags.causal_claim,
      uncertainty: {
        uncertainty_class: flags.uncertainty_class,
        basis: 'property-test randomized basis statement',
      },
      rollback_signals: flags.with_rollback_signal ? ['property-test rollback signal fired'] : [],
      evidence: flags.with_fresh_evidence
        ? [
            createEvidence({
              kind: 'test-run',
              subject_ref: 'sos://Mission/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              availability: 'SUCCESS',
              evidence_class: flags.evidence_class,
              method: 'test-run:exit-code',
              provenance: ['property-test:evidence'],
              window: { start: '2025-01-01T00:00:00.000Z', end: '2025-01-05T00:00:00.000Z' },
              subject_revision: 'system-state:r1',
              confidence: { kind: 'QUALITATIVE', uncertainty_class: 'UNQUANTIFIED' },
              producer: toolProducer(),
            }),
          ]
        : [],
      grants: flags.with_grant
        ? [
            createGrant({
              grantee: 'property-actor',
              scope: { kind: 'KIND', artifact_kind: 'Mission' },
              permissions: flags.grant_permissions,
              expiry: { kind: 'TIME', at: '2025-01-05T00:00:00.000Z' },
              provenance: ['property-test:grant'],
              created_at: '2025-01-01T00:00:00.000Z',
              status: 'ACTIVE',
            }),
          ]
        : [],
      evaluation_point: { kind: 'TIME', now: '2025-01-02T00:00:00.000Z' },
      explicit_authority_decision_ref: flags.with_explicit_decision
        ? 'sos://Decision/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        : null,
      confidence: null,
    };
    return { request, flags };
  });

describe('property: decision determinism', () => {
  it('the same canonical input produces the byte-identical record (repeated evaluation)', () => {
    fc.assert(
      fc.property(requestArb, ({ request }) => {
        const first = evaluate(request, decisionMeta());
        const second = evaluate(structuredClone(request), decisionMeta());
        expect(JSON.stringify(second.record)).toBe(JSON.stringify(first.record));
        expect(second.action).toBe(first.action);
        expect(second.input_digest).toBe(first.input_digest);
      }),
      { numRuns: 100 },
    );
  });

  it('every randomized evaluation produces exactly one of the frozen six and a valid record', () => {
    fc.assert(
      fc.property(requestArb, ({ request }) => {
        const result = evaluate(request, decisionMeta());
        expect(DECISION_ACTIONS).toContain(result.action);
        expect(validateDecisionRecord(result.record)).toBe(true);
        expect(result.record.content.rule_trace.length).toBeGreaterThan(0);
        expect(result.input_digest).toMatch(/^[0-9a-f]{64}$/);
      }),
      { numRuns: 100 },
    );
  });

  it('a mutated input never reproduces the same digest', () => {
    fc.assert(
      fc.property(
        requestArb,
        fc.constantFrom('risk', 'impact', 'reversibility', 'blast_radius', 'action_kind'),
        (ctx, field) => {
          const mutated: DecisionRequest = { ...ctx.request };
          (mutated as Record<string, unknown>)[field] = 'MUTATED-FOR-TEST';
          const a = evaluate(ctx.request, decisionMeta());
          // The mutated request is shape-invalid (foreign vocabulary) -> REJECT,
          // but still gets a DIFFERENT digest (the digest binds the exact input).
          const b = evaluate(mutated, decisionMeta());
          expect(b.input_digest).not.toBe(a.input_digest);
          expect(b.action).toBe('REJECT');
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('property: escalation matrix coverage through the engine', () => {
  it('every matrix-escalating (risk, reversibility) cell yields ASK for a fully-permitted request', () => {
    fc.assert(
      fc.property(riskArb, reversibilityArb, (risk, reversibility) => {
        const escalates =
          risk === 'SEVERE' ||
          (risk === 'HIGH' && reversibility !== 'REVERSIBLE') ||
          (risk === 'MODERATE' && reversibility === 'IRREVERSIBLE');
        // BOUNDED cell (REVISE @ SERVICE), valid grant, no rollback signals,
        // no causal claim, LOW uncertainty: only the matrix can escalate.
        const request: DecisionRequest = {
          action_kind: 'REVISE',
          action_description: 'Matrix coverage request.',
          target: { kind: 'KIND', artifact_kind: 'Mission' },
          blast_radius: 'SERVICE',
          impact: 'MODERATE',
          risk,
          reversibility,
          causal_claim: false,
          uncertainty: { uncertainty_class: 'LOW', basis: 'coverage' },
          rollback_signals: [],
          evidence: [],
          grants: [
            createGrant({
              grantee: 'coverage-actor',
              scope: { kind: 'KIND', artifact_kind: 'Mission' },
              permissions: ['READ', 'REVISE', 'PROMOTE'],
              expiry: { kind: 'TIME', at: '2025-01-05T00:00:00.000Z' },
              provenance: ['property-test:grant'],
              created_at: '2025-01-01T00:00:00.000Z',
              status: 'ACTIVE',
            }),
          ],
          evaluation_point: { kind: 'TIME', now: '2025-01-02T00:00:00.000Z' },
          explicit_authority_decision_ref: null,
          confidence: null,
        };
        const result = evaluate(request, decisionMeta());
        if (escalates) {
          expect(result.action).toBe('ASK');
          expect(result.record.content.escalation!.code).toBe('RISK_IRREVERSIBILITY_ESCALATION');
        } else {
          expect(result.action).toBe('ACT');
        }
      }),
      { numRuns: 48 }, // 4x3 grid exhaustively + repeats
    );
  });
});

describe('property: canonical round trips', () => {
  it('record -> canonical text -> parse -> serialize is byte-identical', () => {
    fc.assert(
      fc.property(requestArb, ({ request }) => {
        const { record } = evaluate(request, decisionMeta());
        const text = canonicalSerialize(record);
        expect(canonicalSerialize(JSON.parse(text))).toBe(text);
      }),
      { numRuns: 100 },
    );
  });

  it('the request view round trips canonically (same input, same digest)', () => {
    fc.assert(
      fc.property(requestArb, ({ request }) => {
        const a = evaluate(request, decisionMeta());
        const parsed = JSON.parse(JSON.stringify(request)) as DecisionRequest;
        const b = evaluate(parsed, decisionMeta());
        expect(b.input_digest).toBe(a.input_digest);
      }),
      { numRuns: 100 },
    );
  });
});
