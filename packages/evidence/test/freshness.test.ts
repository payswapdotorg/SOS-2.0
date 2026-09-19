import { describe, expect, it } from 'vitest';
import { createEvidence, evaluateFreshness, isFreshnessStatus, isStale } from '../src/index.js';
import {
  T0,
  T1,
  T2,
  T3,
  W1,
  sampleEvidenceInput,
} from './helpers.js';

const NOW_INSIDE_W0 = '2025-01-01T12:00:00.000Z';
const NOW_AFTER_W0 = '2025-01-03T00:00:00.000Z';

describe('evaluateFreshness (positive — stale evidence detectable, distinct statuses)', () => {
  it('FRESH: current subject revision, window not closed', () => {
    const record = createEvidence(sampleEvidenceInput()); // window W0, subject_revision r1
    const evaluation = evaluateFreshness(record, { now: NOW_INSIDE_W0, systemStateRevision: 'r1' });
    expect(evaluation.status).toBe('FRESH');
    expect(isStale(evaluation)).toBe(false);
  });

  it('FRESH also without a system state revision (time-only evaluation)', () => {
    const record = createEvidence(sampleEvidenceInput());
    expect(evaluateFreshness(record, { now: NOW_INSIDE_W0 }).status).toBe('FRESH');
    expect(evaluateFreshness(record, { now: NOW_INSIDE_W0, systemStateRevision: null }).status).toBe('FRESH');
  });

  it('EXPIRED_TIME_WINDOW: the observation window closed strictly before now', () => {
    const record = createEvidence(sampleEvidenceInput()); // window ends T1
    const evaluation = evaluateFreshness(record, { now: NOW_AFTER_W0 });
    expect(evaluation.status).toBe('EXPIRED_TIME_WINDOW');
    expect(evaluation.reason).toContain(record.id);
    expect(isStale(evaluation)).toBe(true);
    // exactly at window.end is still fresh (closed strictly before now):
    expect(evaluateFreshness(record, { now: T1 }).status).toBe('FRESH');
  });

  it('SUPERSEDED_SUBJECT_REVISION: the subject moved on', () => {
    const record = createEvidence(sampleEvidenceInput()); // subject_revision r1, window W0
    const evaluation = evaluateFreshness(record, { now: NOW_INSIDE_W0, systemStateRevision: 'r2' });
    expect(evaluation.status).toBe('SUPERSEDED_SUBJECT_REVISION');
    expect(evaluation.reason).toContain('r2');
    expect(isStale(evaluation)).toBe(true);
  });

  it('UNKNOWN_PROVENANCE: bound to neither time nor subject revision', () => {
    const record = createEvidence({ ...sampleEvidenceInput(), window: null, subject_revision: null });
    const evaluation = evaluateFreshness(record, { now: NOW_INSIDE_W0 });
    expect(evaluation.status).toBe('UNKNOWN_PROVENANCE');
    // Distinctly NOT stale: unknown is not silently-stale (§18 distinctness).
    expect(isStale(evaluation)).toBe(false);
  });

  it('UNKNOWN_PROVENANCE: system state revision supplied but the evidence declares none', () => {
    const record = createEvidence({ ...sampleEvidenceInput(), subject_revision: null });
    const evaluation = evaluateFreshness(record, { now: NOW_INSIDE_W0, systemStateRevision: 'r1' });
    expect(evaluation.status).toBe('UNKNOWN_PROVENANCE');
    expect(evaluation.reason).toContain('does not declare the subject revision');
  });

  it('precedence: UNKNOWN_PROVENANCE > SUPERSEDED > EXPIRED > FRESH (documented, deterministic)', () => {
    // Unbound beats everything:
    const unbound = createEvidence({ ...sampleEvidenceInput(), window: null, subject_revision: null });
    expect(evaluateFreshness(unbound, { now: NOW_AFTER_W0, systemStateRevision: 'r2' }).status).toBe(
      'UNKNOWN_PROVENANCE',
    );
    // Superseded beats expired:
    const supersededAndExpired = createEvidence(sampleEvidenceInput()); // r1 + W0
    expect(
      evaluateFreshness(supersededAndExpired, { now: NOW_AFTER_W0, systemStateRevision: 'r2' }).status,
    ).toBe('SUPERSEDED_SUBJECT_REVISION');
    // Superseded beats fresh-window:
    const supersededRecentWindow = createEvidence({ ...sampleEvidenceInput(), window: { start: T2, end: T3 } });
    expect(
      evaluateFreshness(supersededRecentWindow, { now: NOW_INSIDE_W0, systemStateRevision: 'r2' }).status,
    ).toBe('SUPERSEDED_SUBJECT_REVISION');
    // Matching revision but expired window:
    expect(evaluateFreshness(supersededAndExpired, { now: NOW_AFTER_W0, systemStateRevision: 'r1' }).status).toBe(
      'EXPIRED_TIME_WINDOW',
    );
  });

  it('total over every truth state — distinctness never changes the freshness answer', () => {
    const states = ['SUCCESS', 'FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL'] as const;
    for (const availability of states) {
      const record = createEvidence({ ...sampleEvidenceInput(), availability });
      const evaluation = evaluateFreshness(record, { now: NOW_INSIDE_W0, systemStateRevision: 'r1' });
      expect(evaluation.status).toBe('FRESH');
      expect(isFreshnessStatus(evaluation.status)).toBe(true);
    }
  });

  it('freshness is a pure function of (record, input) — deterministic', () => {
    const record = createEvidence(sampleEvidenceInput());
    const input = { now: NOW_AFTER_W0, systemStateRevision: 'r9' };
    expect(evaluateFreshness(record, input)).toEqual(evaluateFreshness(record, input));
  });
});

describe('evidence traceable to System State revisions (freshness integration)', () => {
  it('a full stale-detection scenario across two system state revisions', () => {
    // Evidence captured against r1 over W0:
    const r1Evidence = createEvidence(sampleEvidenceInput());
    // While the system is still at r1 and inside the window: fresh.
    expect(evaluateFreshness(r1Evidence, { now: NOW_INSIDE_W0, systemStateRevision: 'r1' }).status).toBe('FRESH');
    // The system state advances to r2 (the subject revision moved on): superseded.
    expect(evaluateFreshness(r1Evidence, { now: T1, systemStateRevision: 'r2' }).status).toBe(
      'SUPERSEDED_SUBJECT_REVISION',
    );
    // New evidence captured against r2 over W1:
    const r2Evidence = createEvidence({
      ...sampleEvidenceInput(),
      subject_revision: 'r2',
      window: W1,
    });
    expect(evaluateFreshness(r2Evidence, { now: T1, systemStateRevision: 'r2' }).status).toBe('FRESH');
    // ...but it expires once its window closes:
    expect(evaluateFreshness(r2Evidence, { now: T3, systemStateRevision: 'r2' }).status).toBe('EXPIRED_TIME_WINDOW');
    // And evidence with no revisional binding is UNKNOWN when a revision is asked for:
    const unbound = createEvidence({ ...sampleEvidenceInput(), subject_revision: null });
    expect(evaluateFreshness(unbound, { now: T0, systemStateRevision: 'r2' }).status).toBe('UNKNOWN_PROVENANCE');
  });
});
