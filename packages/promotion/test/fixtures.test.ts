import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluatePromotion, validatePromotionDecision } from '../src/index.js';
import {
  healthyResult,
  interventionalEvidence,
  PROVENANCE,
  rollbackTriggersOf,
  sampleCandidate,
  sampleExperimentFor,
  validAssuranceCase,
  validGrant,
  validRecovery,
  T1,
} from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '../fixtures');

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));
}

/** The golden happy path (identical to scripts/make-fixtures.mjs). */
function goldenEvaluation() {
  const candidate = sampleCandidate();
  const experiment = sampleExperimentFor(candidate);
  const result = healthyResult(experiment);
  const triggers = rollbackTriggersOf(experiment, result);
  return evaluatePromotion(candidate, {
    authority: { grant: validGrant(candidate), now: T1 },
    assurance: validAssuranceCase(),
    evidence: [interventionalEvidence(candidate)],
    liveTriggers: triggers,
    systemState: { revision: 'system-state:r1' },
    recovery: validRecovery(experiment, triggers),
    provenance: PROVENANCE,
    created_at: T1,
  });
}

describe('golden fixtures (W9 promotion contract test data)', () => {
  it('promotion-decision.json reproduces bit-exactly from the documented golden path (ACT)', () => {
    const fixture = readFixture('promotion-decision.json');
    const evaluation = goldenEvaluation();
    expect(evaluation.decision).toBe('ACT');
    expect(evaluation.record).toEqual(fixture);
    expect(evaluation.record.envelope.id).toBe(
      (fixture as { envelope: { id: string } }).envelope.id,
    );
    expect(validatePromotionDecision(fixture)).toBe(true);
  });

  it('the golden decision is an ACT with a bounded recovery declaration wired to guardrail triggers', () => {
    const fixture = readFixture('promotion-decision.json') as {
      envelope: { kind: string; id: string };
      content: { action: string; recovery: { max_recovery_seconds: number; rollback_triggers: unknown[] } };
    };
    expect(fixture.envelope.kind).toBe('Decision');
    expect(fixture.content.action).toBe('ACT');
    expect(fixture.content.recovery.max_recovery_seconds).toBe(30);
    expect(fixture.content.recovery.rollback_triggers).toHaveLength(1);
  });

  it('the golden path is deterministic: repeated evaluation yields the identical record id', () => {
    const first = goldenEvaluation();
    const second = goldenEvaluation();
    expect(first.record.envelope.id).toBe(second.record.envelope.id);
    expect(first.reasons).toEqual(second.reasons);
  });
});
