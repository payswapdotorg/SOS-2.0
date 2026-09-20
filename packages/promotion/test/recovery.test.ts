import { describe, expect, it } from 'vitest';
import { assertValidBoundedRecovery, validateBoundedRecovery } from '../src/index.js';
import type { BoundedRecoveryDeclaration } from '../src/index.js';
import { healthyResult, rollbackTriggersOf, sampleCandidate, sampleExperimentFor, validRecovery } from './helpers.js';

describe('bounded recovery validation (the W8 recovery-control structural mirror)', () => {
  const candidate = sampleCandidate();
  const experiment = sampleExperimentFor(candidate);
  const triggers = rollbackTriggersOf(experiment, healthyResult(experiment));

  it('accepts a valid bounded declaration (mechanism + bound + wired triggers)', () => {
    const recovery = validRecovery(experiment, triggers);
    expect(() => assertValidBoundedRecovery(recovery)).not.toThrow();
    expect(validateBoundedRecovery(recovery)).toBe(true);
    expect(recovery.rollback_triggers[0]!.experiment_id).toBe(experiment.envelope.id);
    expect(recovery.rollback_triggers[0]!.trigger.kind).toBe('ROLLBACK');
  });

  it('accepts a governed containment exception INSTEAD of a bounded time', () => {
    const recovery: BoundedRecoveryDeclaration = {
      mechanism: 'Immutable blue/green deployment: the previous fleet stays warm for instant traffic revert.',
      max_recovery_seconds: null,
      containment_exception: {
        authority_ref: 'sos://AuthorityGrant/' + 'e'.repeat(32),
        note: 'Governed exception: containment by parallel deployment (spec/architecture.md §13).',
      },
      rollback_triggers: triggers.map((trigger) => ({ experiment_id: experiment.envelope.id, trigger })),
      authority_ref: null,
    };
    expect(validateBoundedRecovery(recovery)).toBe(true);
  });

  it('REJECTS neither-bounded-nor-exception (live changes require bounded recovery)', () => {
    const recovery = validRecovery(experiment, triggers);
    const neither = { ...recovery, max_recovery_seconds: null, containment_exception: null };
    expect(() => assertValidBoundedRecovery(neither)).toThrow(/never neither/);
  });

  it('REJECTS both bounded time AND exception (exactly one path)', () => {
    const recovery = validRecovery(experiment, triggers);
    const both = {
      ...recovery,
      containment_exception: { authority_ref: 'sos://AuthorityGrant/' + 'e'.repeat(32), note: 'both' },
    };
    expect(() => assertValidBoundedRecovery(both)).toThrow(/never both/);
  });

  it('REJECTS an ungoverned containment exception (missing authority ref)', () => {
    const recovery = validRecovery(experiment, triggers);
    const ungoverned = {
      ...recovery,
      max_recovery_seconds: null,
      containment_exception: { authority_ref: 'not-an-id', note: 'ungoverned' },
    };
    expect(() => assertValidBoundedRecovery(ungoverned)).toThrow(/GOVERNED/);
  });

  it('REJECTS a declaration without wired rollback triggers', () => {
    const recovery = validRecovery(experiment, triggers);
    const unwired = { ...recovery, rollback_triggers: [] };
    expect(() => assertValidBoundedRecovery(unwired)).toThrow(/WIRED/);
  });

  it('REJECTS wiring a STOPPING trigger (rollback wiring requires ROLLBACK triggers)', () => {
    const recovery = validRecovery(experiment, triggers);
    const wrongKind = {
      ...recovery,
      rollback_triggers: [
        {
          experiment_id: experiment.envelope.id,
          trigger: { ...triggers[0]!, kind: 'STOPPING' },
        },
      ],
    };
    expect(() => assertValidBoundedRecovery(wrongKind)).toThrow(/kind must be ROLLBACK/);
  });

  it('REJECTS non-positive recovery bounds', () => {
    const recovery = validRecovery(experiment, triggers);
    expect(() => assertValidBoundedRecovery({ ...recovery, max_recovery_seconds: 0 })).toThrow(/positive integer/);
    expect(() => assertValidBoundedRecovery({ ...recovery, max_recovery_seconds: -5 })).toThrow(/positive integer/);
  });

  it('REJECTS wiring to a non-experiment id', () => {
    const recovery = validRecovery(experiment, triggers);
    const badWiring = {
      ...recovery,
      rollback_triggers: [
        { experiment_id: 'sos://Mission/' + 'f'.repeat(32), trigger: triggers[0]! },
      ],
    };
    expect(() => assertValidBoundedRecovery(badWiring)).toThrow(/sos:\/\/Experiment\//);
  });
});
