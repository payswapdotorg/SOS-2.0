/**
 * Unit tests: the frozen ladder, the policy table, and the escalation
 * matrix (total coverage of the 4x3 grid).
 */

import { describe, expect, it } from 'vitest';
import {
  AUTONOMY_LEVELS,
  AUTONOMY_LEVEL_RANKS,
  BLAST_RADII,
  BLAST_RADIUS_RANKS,
  ESCALATION_MATRIX,
  REVERSIBILITY_CLASSES,
  compareAutonomyLevels,
  escalates,
  escalationCells,
  escalationOutcome,
  isAutonomyLevel,
  isBlastRadius,
  isReversibilityClass,
  levelSatisfies,
  requiredLevel,
  REQUIRED_LEVEL_TABLE,
  AUTONOMY_ACTION_KINDS,
} from '../src/index.js';

describe('autonomy level ladder', () => {
  it('exposes exactly the three frozen levels in rank order', () => {
    expect(AUTONOMY_LEVELS).toEqual(['SUPERVISED', 'BOUNDED', 'AUTONOMOUS_LOW_RISK']);
    expect(AUTONOMY_LEVEL_RANKS['SUPERVISED']).toBe(0);
    expect(AUTONOMY_LEVEL_RANKS['BOUNDED']).toBe(1);
    expect(AUTONOMY_LEVEL_RANKS['AUTONOMOUS_LOW_RISK']).toBe(2);
  });

  it('ranks levels totally and symmetrically', () => {
    expect(compareAutonomyLevels('SUPERVISED', 'BOUNDED')).toBeLessThan(0);
    expect(compareAutonomyLevels('BOUNDED', 'AUTONOMOUS_LOW_RISK')).toBeLessThan(0);
    expect(compareAutonomyLevels('AUTONOMOUS_LOW_RISK', 'SUPERVISED')).toBeGreaterThan(0);
    expect(compareAutonomyLevels('BOUNDED', 'BOUNDED')).toBe(0);
    expect(levelSatisfies('AUTONOMOUS_LOW_RISK', 'BOUNDED')).toBe(true);
    expect(levelSatisfies('BOUNDED', 'AUTONOMOUS_LOW_RISK')).toBe(false);
  });

  it('recognizes and rejects level vocabulary members', () => {
    expect(isAutonomyLevel('SUPERVISED')).toBe(true);
    expect(isAutonomyLevel('UNSUPervised')).toBe(false);
    expect(isAutonomyLevel(42)).toBe(false);
  });

  it('orders blast radii and validates the vocabulary', () => {
    expect(BLAST_RADII).toEqual(['COMPONENT', 'SERVICE', 'SYSTEM', 'ORGANIZATION']);
    expect(BLAST_RADIUS_RANKS['COMPONENT']).toBe(0);
    expect(BLAST_RADIUS_RANKS['ORGANIZATION']).toBe(3);
    expect(isBlastRadius('GALAXY')).toBe(false);
    expect(isReversibilityClass('IRREVERSIBLE')).toBe(true);
    expect(isReversibilityClass('MOSTLY_FINE')).toBe(false);
    expect(REVERSIBILITY_CLASSES).toEqual(['REVERSIBLE', 'PARTIALLY_REVERSIBLE', 'IRREVERSIBLE']);
  });
});

describe('policy table', () => {
  it('action kinds are the frozen authority permissions (consumed, never redefined)', () => {
    expect(AUTONOMY_ACTION_KINDS).toEqual(['READ', 'REVISE', 'RETIRE', 'PROMOTE', 'DELEGATE']);
  });

  it('is total over 5 action kinds x 4 blast radii = 20 documented cells', () => {
    for (const action of AUTONOMY_ACTION_KINDS) {
      for (const blast of BLAST_RADII) {
        expect(isAutonomyLevel(requiredLevel(action, blast))).toBe(true);
      }
    }
  });

  it('realizes the documented table', () => {
    expect(REQUIRED_LEVEL_TABLE['READ']).toEqual({
      COMPONENT: 'AUTONOMOUS_LOW_RISK',
      SERVICE: 'AUTONOMOUS_LOW_RISK',
      SYSTEM: 'BOUNDED',
      ORGANIZATION: 'BOUNDED',
    });
    expect(REQUIRED_LEVEL_TABLE['REVISE']!['ORGANIZATION']).toBe('SUPERVISED');
    expect(REQUIRED_LEVEL_TABLE['RETIRE']!['SYSTEM']).toBe('SUPERVISED');
    expect(REQUIRED_LEVEL_TABLE['PROMOTE']!['SERVICE']).toBe('BOUNDED');
    expect(REQUIRED_LEVEL_TABLE['DELEGATE']!['COMPONENT']).toBe('BOUNDED');
  });

  it('throws loudly on out-of-vocabulary input', () => {
    expect(() => requiredLevel('HACK' as never, 'SERVICE')).toThrow(/frozen authority permissions/);
    expect(() => requiredLevel('READ', 'UNIVERSE' as never)).toThrow(/blast radius/);
  });
});

describe('escalation matrix', () => {
  it('is total over the 4x3 = 12 grid and matches the frozen table', () => {
    for (const { risk, reversibility, escalates: cellEscalates } of escalationCells()) {
      expect(cellEscalates).toBe(ESCALATION_MATRIX[risk][reversibility]);
    }
    expect(escalationCells()).toHaveLength(12);
  });

  it('escalates SEVERE risk at every reversibility', () => {
    for (const reversibility of REVERSIBILITY_CLASSES) {
      expect(escalates('SEVERE', reversibility)).toBe(true);
    }
  });

  it('escalates HIGH risk except when fully reversible', () => {
    expect(escalates('HIGH', 'REVERSIBLE')).toBe(false);
    expect(escalates('HIGH', 'PARTIALLY_REVERSIBLE')).toBe(true);
    expect(escalates('HIGH', 'IRREVERSIBLE')).toBe(true);
  });

  it('escalates MODERATE risk only when irreversible', () => {
    expect(escalates('MODERATE', 'REVERSIBLE')).toBe(false);
    expect(escalates('MODERATE', 'PARTIALLY_REVERSIBLE')).toBe(false);
    expect(escalates('MODERATE', 'IRREVERSIBLE')).toBe(true);
  });

  it('never escalates LOW risk by the matrix', () => {
    for (const reversibility of REVERSIBILITY_CLASSES) {
      expect(escalates('LOW', reversibility)).toBe(false);
    }
  });

  it('carries the locked-invariant reminder in every escalating reason', () => {
    const outcome = escalationOutcome('HIGH', 'IRREVERSIBLE');
    expect(outcome.escalates).toBe(true);
    expect(outcome.code).toBe('RISK_IRREVERSIBILITY_ESCALATION');
    expect(outcome.reason).toContain('confidence is not authorization');
  });

  it('non-escalating cells carry a null code and a non-empty reason', () => {
    const outcome = escalationOutcome('LOW', 'REVERSIBLE');
    expect(outcome.escalates).toBe(false);
    expect(outcome.code).toBeNull();
    expect(outcome.reason.length).toBeGreaterThan(0);
  });

  it('throws loudly on out-of-vocabulary risk or reversibility', () => {
    expect(() => escalates('CATASTROPHIC' as never, 'REVERSIBLE')).toThrow(/frozen ASK risk severities/);
    expect(() => escalates('LOW', 'UNDOABLE' as never)).toThrow(/reversibility/);
  });
});
