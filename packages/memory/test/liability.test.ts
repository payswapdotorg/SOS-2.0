import { describe, expect, it } from 'vitest';
import {
  assertValidLiabilityResolution,
  assertResolutionTransition,
  canResolve,
  isLiabilityOwnerKind,
  isLiabilityResolutionState,
  isLiabilitySeverity,
  validateLiabilityResolution,
} from '../src/index.js';
import { evidenceRecord, sampleEntries, T1, T2 } from './helpers.js';

describe('liability vocabulary and state machine', () => {
  it('structural checks recognize the frozen vocabularies', () => {
    expect(isLiabilitySeverity('CRITICAL')).toBe(true);
    expect(isLiabilitySeverity('URGENT')).toBe(false);
    expect(isLiabilityOwnerKind('TEAM')).toBe(true);
    expect(isLiabilityOwnerKind('NOBODY')).toBe(false);
    expect(isLiabilityResolutionState('MITIGATED')).toBe(true);
    expect(isLiabilityResolutionState('DONE')).toBe(false);
  });

  it('valid transitions are allowed and invalid ones rejected', () => {
    expect(canResolve('OPEN', 'ACKNOWLEDGED')).toBe(true);
    expect(canResolve('OPEN', 'RESOLVED')).toBe(true);
    expect(canResolve('ACKNOWLEDGED', 'MITIGATED')).toBe(true);
    expect(canResolve('MITIGATED', 'RESOLVED')).toBe(true);
    expect(canResolve('MITIGATED', 'ACCEPTED')).toBe(true);
    expect(canResolve('OPEN', 'OPEN')).toBe(true); // no-op
    expect(canResolve('RESOLVED', 'OPEN')).toBe(false); // terminal
    expect(canResolve('ACCEPTED', 'ACKNOWLEDGED')).toBe(false); // terminal
    expect(canResolve('ACKNOWLEDGED', 'OPEN')).toBe(false); // no backwards
    expect(() => assertResolutionTransition('RESOLVED', 'OPEN')).toThrow(/invalid liability resolution transition/);
  });

  it('validates resolutions: evidence for MITIGATED/RESOLVED, timestamp for RESOLVED', () => {
    const evidence = [evidenceRecord('resolution-1').id];
    expect(() =>
      assertValidLiabilityResolution({ state: 'OPEN', note: null, resolved_at: null, resolution_evidence_refs: [] }),
    ).not.toThrow();
    expect(() =>
      assertValidLiabilityResolution({ state: 'ACKNOWLEDGED', note: 'tracked in LIAB-7', resolved_at: null, resolution_evidence_refs: [] }),
    ).not.toThrow();
    expect(() =>
      assertValidLiabilityResolution({ state: 'MITIGATED', note: null, resolved_at: null, resolution_evidence_refs: evidence }),
    ).not.toThrow();
    expect(() =>
      assertValidLiabilityResolution({ state: 'RESOLVED', note: null, resolved_at: T2, resolution_evidence_refs: evidence }),
    ).not.toThrow();
    // MITIGATED without evidence:
    expect(() =>
      assertValidLiabilityResolution({ state: 'MITIGATED', note: null, resolved_at: null, resolution_evidence_refs: [] }),
    ).toThrow(/at least one resolution evidence reference/);
    // RESOLVED without evidence and without timestamp:
    expect(() =>
      assertValidLiabilityResolution({ state: 'RESOLVED', note: null, resolved_at: null, resolution_evidence_refs: [] }),
    ).toThrow(/at least one resolution evidence reference|resolved_at/);
    expect(() =>
      assertValidLiabilityResolution({ state: 'RESOLVED', note: null, resolved_at: null, resolution_evidence_refs: evidence }),
    ).toThrow(/resolved_at/);
    expect(
      validateLiabilityResolution({ state: 'RESOLVED', note: null, resolved_at: T2, resolution_evidence_refs: evidence }),
    ).toBe(true);
  });

  it('the sample liability entry is valid', () => {
    const { liability } = sampleEntries();
    expect(() => assertValidLiabilityResolution(liability.resolution)).not.toThrow();
    expect(liability.severity).toBe('HIGH');
    expect(liability.owner_kind).toBe('TEAM');
    expect(liability.resolution.state).toBe('OPEN');
  });

  it('resolution timestamps must be RFC3339', () => {
    expect(() =>
      assertValidLiabilityResolution({
        state: 'RESOLVED',
        note: null,
        resolved_at: 'yesterday',
        resolution_evidence_refs: [evidenceRecord('resolution-2').id],
      }),
    ).toThrow(/RFC3339/);
  });
});
