import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import {
  createPromotionDecision,
  promotionDecisionId,
  validatePromotionDecision,
} from '../src/index.js';
import type { CreatePromotionDecisionInput, PromotionDecisionContent } from '../src/index.js';
import {
  healthyResult,
  PROVENANCE,
  rollbackTriggersOf,
  sampleCandidate,
  sampleExperimentFor,
  T1,
  validRecovery,
} from './helpers.js';

function actContent(): PromotionDecisionContent {
  const candidate = sampleCandidate();
  const experiment = sampleExperimentFor(candidate);
  const triggers = rollbackTriggersOf(experiment, healthyResult(experiment));
  return {
    action: 'ACT',
    candidate_ref: candidate.envelope.id,
    authority_grant_ref: 'sos://AuthorityGrant/' + 'a'.repeat(32),
    assurance_case_ref: 'sos://AssuranceCase/' + 'b'.repeat(32),
    evidence_refs: ['sos://Evidence/' + 'd'.repeat(32)],
    reasons: ['all promotion gates passed'],
    recovery: validRecovery(experiment, triggers),
    system_state_revision: 'system-state:r1',
    live_trigger_rule_ids: [],
  };
}

describe('promotion decision records (Decision-kind spine artifacts)', () => {
  it('mints deterministic Decision-kind ids and validates through the full contract', () => {
    const input: CreatePromotionDecisionInput = {
      content: actContent(),
      provenance: PROVENANCE,
      created_at: T1,
    };
    const record = createPromotionDecision(input);
    expect(record.envelope.kind).toBe('Decision');
    expect(record.envelope.id).toMatch(/^sos:\/\/Decision\/[0-9a-f]{32}$/);
    expect(validatePromotionDecision(record)).toBe(true);
    expect(createPromotionDecision(input).envelope.id).toBe(record.envelope.id);
    expect(promotionDecisionId(input, input.content)).toBe(record.envelope.id);
  });

  it('an ACT decision REQUIRES a bounded recovery declaration', () => {
    const content = actContent();
    content.recovery = null;
    expect(() => createPromotionDecision({ content, provenance: PROVENANCE, created_at: T1 })).toThrow(
      /an ACT decision REQUIRES a bounded recovery declaration/,
    );
  });

  it('a non-ACT decision carries NO recovery declaration', () => {
    const content = actContent();
    content.action = 'EXPERIMENT';
    expect(() => createPromotionDecision({ content, provenance: PROVENANCE, created_at: T1 })).toThrow(
      /carries no recovery declaration/,
    );
  });

  it('an invalid recovery declaration rejects the record', () => {
    const content = actContent();
    (content.recovery as { max_recovery_seconds: number }).max_recovery_seconds = 0;
    expect(() => createPromotionDecision({ content, provenance: PROVENANCE, created_at: T1 })).toThrow(
      /positive integer/,
    );
  });

  it('decision actions outside the frozen six are rejected', () => {
    const content = actContent();
    (content as { action: string }).action = 'MAYBE';
    expect(() => createPromotionDecision({ content, provenance: PROVENANCE, created_at: T1 })).toThrow(
      /frozen six/,
    );
  });

  it('reasons must be non-empty (every decision is auditable)', () => {
    const content = actContent();
    content.reasons = [];
    expect(() => createPromotionDecision({ content, provenance: PROVENANCE, created_at: T1 })).toThrow(
      /non-empty array/,
    );
  });

  it('canonical serialization round trips deterministically', () => {
    const input: CreatePromotionDecisionInput = {
      content: actContent(),
      provenance: PROVENANCE,
      created_at: T1,
    };
    const record = createPromotionDecision(input);
    const text = canonicalSerialize(record);
    expect(canonicalSerialize(JSON.parse(text))).toBe(text);
    expect(text).toBe(canonicalSerialize(createPromotionDecision(input)));
  });
});
