/**
 * State-block model tests — the six first-class kinds stay distinct, the
 * epistemic trio (UNKNOWN / UNAVAILABLE / PARTIAL) is never conflated,
 * PARTIAL always lists present AND missing parts, and error/unavailable
 * blocks always carry an honest next step.
 */

import { describe, expect, test } from 'vitest';
import {
  allTruthStates,
  assertValidStateBlock,
  buildStateBlock,
  evidenceTruthStateLabel,
  evidenceTruthStateTone,
  isProductCondition,
  isWebStateBlockKind,
  productConditionLabel,
  productConditionTone,
  stateBlockKindOrder,
  stateBlockLabel,
  stateBlockTone,
} from '../src/index.js';

describe('the six state-block kinds', () => {
  test('the kind vocabulary is exactly the six first-class kinds', () => {
    expect(stateBlockKindOrder()).toEqual(['LOADING', 'EMPTY', 'UNKNOWN', 'UNAVAILABLE', 'PARTIAL', 'ERROR']);
    expect(stateBlockKindOrder().every(isWebStateBlockKind)).toBe(true);
    expect(isWebStateBlockKind('loading')).toBe(false);
    expect(isWebStateBlockKind('BROKEN')).toBe(false);
  });

  test('each kind has a distinct label and a tone from the design system', () => {
    const kinds = stateBlockKindOrder();
    expect(new Set(kinds.map((kind) => stateBlockLabel(kind))).size).toBe(6);
    expect(kinds.every((kind) => ['POSITIVE', 'CAUTION', 'NEGATIVE', 'NEUTRAL', 'EPISTEMIC'].includes(stateBlockTone(kind)))).toBe(true);
    // The epistemic trio shares the separate treatment; LOADING/EMPTY are neutral; ERROR is negative.
    expect(stateBlockTone('UNKNOWN')).toBe('EPISTEMIC');
    expect(stateBlockTone('UNAVAILABLE')).toBe('EPISTEMIC');
    expect(stateBlockTone('ERROR')).toBe('NEGATIVE');
    expect(stateBlockTone('EMPTY')).toBe('NEUTRAL');
  });
});

describe('state-block construction discipline', () => {
  test('a well-formed block validates', () => {
    const block = buildStateBlock({
      kind: 'UNAVAILABLE',
      surface: 'live-signals',
      statement: 'Live deployment signals are not connected yet.',
      action: 'This surface will light up when the live data plane is connected.',
    });
    expect(() => assertValidStateBlock(block)).not.toThrow();
  });

  test('an empty statement is rejected — a state block never renders a blank hole', () => {
    expect(() =>
      buildStateBlock({ kind: 'EMPTY', surface: 's', statement: '', action: null }),
    ).toThrow();
  });

  test('PARTIAL without present/missing lists is rejected; with them, both are sorted/unique', () => {
    expect(() =>
      buildStateBlock({ kind: 'PARTIAL', surface: 's', statement: 'Partial.', action: null }),
    ).toThrow(/present/);
    expect(() =>
      buildStateBlock({ kind: 'PARTIAL', surface: 's', statement: 'Partial.', present: ['a'], missing: [], action: null }),
    ).toThrow(/missing/);
    const block = buildStateBlock({
      kind: 'PARTIAL',
      surface: 's',
      statement: 'Partial.',
      present: ['b', 'a', 'b'],
      missing: ['d', 'c'],
      action: null,
    });
    expect(block.present).toEqual(['a', 'b']);
    expect(block.missing).toEqual(['c', 'd']);
  });

  test('non-PARTIAL blocks never carry present/missing lists', () => {
    const block = buildStateBlock({ kind: 'UNKNOWN', surface: 's', statement: 'Not known yet.', action: null });
    expect(block.present).toBeNull();
    expect(block.missing).toBeNull();
    expect(() =>
      assertValidStateBlock({ ...block, present: ['x'] }),
    ).toThrow();
  });

  test('ERROR and UNAVAILABLE blocks must carry an honest next step', () => {
    expect(() =>
      buildStateBlock({ kind: 'ERROR', surface: 's', statement: 'It broke.', action: null }),
    ).toThrow(/action/);
    expect(() =>
      buildStateBlock({ kind: 'UNAVAILABLE', surface: 's', statement: 'Unreachable.', action: null }),
    ).toThrow(/action/);
  });
});

describe('truth-state tone mapping preserves distinctness', () => {
  test('all six frozen truth states have distinct labels', () => {
    const states = allTruthStates();
    expect(states).toEqual(['SUCCESS', 'FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL']);
    expect(new Set(states.map((state) => evidenceTruthStateLabel(state))).size).toBe(6);
  });

  test('the epistemic states keep the separate treatment; failure/success/partial map to their tones', () => {
    expect(evidenceTruthStateTone('SUCCESS')).toBe('POSITIVE');
    expect(evidenceTruthStateTone('FAILURE')).toBe('NEGATIVE');
    expect(evidenceTruthStateTone('PARTIAL')).toBe('CAUTION');
    expect(evidenceTruthStateTone('UNKNOWN')).toBe('EPISTEMIC');
    expect(evidenceTruthStateTone('UNAVAILABLE')).toBe('EPISTEMIC');
    expect(evidenceTruthStateTone('UNSUPPORTED')).toBe('EPISTEMIC');
  });
});

describe('product conditions', () => {
  test('the condition vocabulary is closed with distinct labels', () => {
    for (const condition of ['HEALTHY', 'DEGRADED', 'BLOCKED', 'INACTIVE', 'UNKNOWN', 'UNAVAILABLE'] as const) {
      expect(isProductCondition(condition)).toBe(true);
    }
    expect(isProductCondition('FINE')).toBe(false);
    const conditions = ['HEALTHY', 'DEGRADED', 'BLOCKED', 'INACTIVE', 'UNKNOWN', 'UNAVAILABLE'] as const;
    expect(new Set(conditions.map((condition) => productConditionLabel(condition))).size).toBe(6);
  });

  test('conditions map to the design-system tones with the epistemic separation', () => {
    expect(productConditionTone('HEALTHY')).toBe('POSITIVE');
    expect(productConditionTone('DEGRADED')).toBe('CAUTION');
    expect(productConditionTone('BLOCKED')).toBe('NEGATIVE');
    expect(productConditionTone('INACTIVE')).toBe('NEUTRAL');
    expect(productConditionTone('UNKNOWN')).toBe('EPISTEMIC');
    expect(productConditionTone('UNAVAILABLE')).toBe('EPISTEMIC');
  });
});
