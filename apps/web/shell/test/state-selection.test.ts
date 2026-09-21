/**
 * State-block selection tests — every load outcome maps to exactly one
 * named block kind; PARTIAL always lists present AND missing parts;
 * UNAVAILABLE/ERROR always carry an honest next step; a surface can never
 * render a blank hole.
 */

import { describe, expect, test } from 'vitest';
import { assertValidStateBlock } from '@sos-2/web-contracts';
import { emptySectionBlock, notConnectedBlock, selectStateBlock } from '../view-state/state-selection';

describe('selectStateBlock', () => {
  test('READY passes the data through untouched', () => {
    const data = { meaning: 42 };
    const selected = selectStateBlock({ status: 'READY', data });
    expect(selected.ready).toBe(true);
    if (selected.ready) {
      expect(selected.data).toBe(data);
    }
  });

  test('LOADING names what is loading', () => {
    const selected = selectStateBlock({ status: 'LOADING', surface: 's', what: 'The evidence pool' });
    expect(selected.ready).toBe(false);
    if (!selected.ready) {
      expect(selected.block.kind).toBe('LOADING');
      expect(selected.block.statement).toContain('evidence pool');
      expect(() => assertValidStateBlock(selected.block)).not.toThrow();
    }
  });

  test('EMPTY says what is absent without inventing content', () => {
    const selected = selectStateBlock({ status: 'EMPTY', surface: 's', what: 'Compositions', action: null });
    expect(selected.ready).toBe(false);
    if (!selected.ready) {
      expect(selected.block.kind).toBe('EMPTY');
      expect(selected.block.statement).toContain('nothing exists here yet');
    }
  });

  test('UNKNOWN refuses to guess', () => {
    const selected = selectStateBlock({ status: 'UNKNOWN', surface: 's', what: 'The p95 value', action: null });
    expect(selected.ready).toBe(false);
    if (!selected.ready) {
      expect(selected.block.kind).toBe('UNKNOWN');
      expect(selected.block.statement).toContain('no value is guessed');
    }
  });

  test('UNAVAILABLE always carries an honest next step', () => {
    const selected = selectStateBlock({
      status: 'UNAVAILABLE',
      surface: 'live-signals',
      what: 'Live deployment signals',
      action: 'Lights up when the live data plane connects.',
    });
    expect(selected.ready).toBe(false);
    if (!selected.ready) {
      expect(selected.block.kind).toBe('UNAVAILABLE');
      expect(selected.block.action).not.toBeNull();
    }
  });

  test('PARTIAL lists present and missing parts (never silently drops)', () => {
    const selected = selectStateBlock({
      status: 'PARTIAL',
      surface: 'coverage',
      what: 'Evidence coverage',
      present: ['telemetry', 'tests'],
      missing: ['model collector'],
    });
    expect(selected.ready).toBe(false);
    if (!selected.ready) {
      expect(selected.block.kind).toBe('PARTIAL');
      expect(selected.block.present).toEqual(['telemetry', 'tests']);
      expect(selected.block.missing).toEqual(['model collector']);
    }
  });

  test('ERROR carries the failure and a next step', () => {
    const selected = selectStateBlock({
      status: 'ERROR',
      surface: 's',
      what: 'The evidence read',
      action: 'Retry the read; the last known state stays visible.',
    });
    expect(selected.ready).toBe(false);
    if (!selected.ready) {
      expect(selected.block.kind).toBe('ERROR');
      expect(selected.block.action).toContain('Retry');
    }
  });

  test('the six kinds map one-to-one (distinctness preserved)', () => {
    const kinds = (
      [
        { status: 'LOADING', surface: 'a', what: 'x' },
        { status: 'EMPTY', surface: 'b', what: 'x', action: null },
        { status: 'UNKNOWN', surface: 'c', what: 'x', action: null },
        { status: 'UNAVAILABLE', surface: 'd', what: 'x', action: 'y' },
        { status: 'PARTIAL', surface: 'e', what: 'x', present: ['p'], missing: ['m'] },
        { status: 'ERROR', surface: 'f', what: 'x', action: 'y' },
      ] as const
    ).map((load) => selectStateBlock(load as never));
    const blockKinds = kinds.map((selected) => (selected.ready ? 'READY' : selected.block.kind));
    expect(new Set(blockKinds).size).toBe(6);
  });
});

describe('the standard honest blocks', () => {
  test('notConnectedBlock is UNAVAILABLE with a live-plane explanation', () => {
    const block = notConnectedBlock('live-signals', 'Live deployment signals');
    expect(block.kind).toBe('UNAVAILABLE');
    expect(block.action).toContain('live data plane');
    expect(() => assertValidStateBlock(block)).not.toThrow();
  });

  test('emptySectionBlock is EMPTY and names its section', () => {
    const block = emptySectionBlock('compositions', 'Package compositions');
    expect(block.kind).toBe('EMPTY');
    expect(block.statement).toContain('Package compositions');
    expect(() => assertValidStateBlock(block)).not.toThrow();
  });
});
