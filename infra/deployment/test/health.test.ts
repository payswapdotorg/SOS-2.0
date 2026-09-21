/**
 * Provider health diagnostics tests (Work Order P3): the four honest
 * statuses, injectable offline probes, honest aggregation (never a
 * fabricated HEALTHY), and tracker transitions.
 */

import {
  NOT_YET_DEPLOYED_HEALTH_NOTE,
  PROVIDER_HEALTH_STATUSES,
  ProviderHealthTracker,
  aggregateProviderHealth,
  runProviderHealthCheck,
  unprobedProviderHealth,
  validateProviderHealth,
} from '../src/health/diagnostics.ts';
import { ProviderHealthError } from '../src/core/types.ts';
import { CLOCK_T0_MS, CLOCK_T1_MS, CLOCK_T2_MS } from './fixtures.ts';

/** Fake healthy probe (offline, injectable — no network by design). */
const healthyProbe = (probeId: string) => ({ probeId, run: () => ({ status: 'HEALTHY' as const }) });
const degradedProbe = (probeId: string) => ({
  probeId,
  run: () => ({ status: 'DEGRADED' as const, detail: 'elevated latency (injected fixture)' }),
});
const unavailableProbe = (probeId: string) => ({ probeId, run: () => ({ status: 'UNAVAILABLE' as const }) });
const unknownProbe = (probeId: string) => ({ probeId, run: () => ({ status: 'UNKNOWN' as const }) });

describe('honest health statuses', () => {
  it('the four frozen statuses exist and nothing else', () => {
    expect(PROVIDER_HEALTH_STATUSES).toEqual(['UNKNOWN', 'UNAVAILABLE', 'DEGRADED', 'HEALTHY']);
  });

  it('an un-probed provider is UNKNOWN — never HEALTHY, never UNAVAILABLE', () => {
    const health = unprobedProviderHealth('vercel');
    expect(health.status).toBe('UNKNOWN');
    expect(health.reports).toEqual([]);
    expect(health.note).toBe(NOT_YET_DEPLOYED_HEALTH_NOTE);
    expect(NOT_YET_DEPLOYED_HEALTH_NOTE).toContain('NOT_YET_DEPLOYED');
    expect(() => validateProviderHealth(health)).not.toThrow();
  });
});

describe('honest aggregation (never a fabricated HEALTHY)', () => {
  it('no probes => UNKNOWN', () => {
    expect(aggregateProviderHealth([])).toBe('UNKNOWN');
  });

  it('any UNKNOWN probe keeps the aggregate UNKNOWN even alongside HEALTHY', () => {
    expect(
      aggregateProviderHealth([
        { probeId: 'a', status: 'HEALTHY', checkedAtMs: CLOCK_T0_MS },
        { probeId: 'b', status: 'UNKNOWN', checkedAtMs: CLOCK_T0_MS },
      ]),
    ).toBe('UNKNOWN');
  });

  it('any UNAVAILABLE probe dominates; then DEGRADED; else HEALTHY', () => {
    expect(
      aggregateProviderHealth([
        { probeId: 'a', status: 'HEALTHY', checkedAtMs: CLOCK_T0_MS },
        { probeId: 'b', status: 'DEGRADED', checkedAtMs: CLOCK_T0_MS },
      ]),
    ).toBe('DEGRADED');
    expect(
      aggregateProviderHealth([
        { probeId: 'a', status: 'DEGRADED', checkedAtMs: CLOCK_T0_MS },
        { probeId: 'b', status: 'UNAVAILABLE', checkedAtMs: CLOCK_T0_MS },
      ]),
    ).toBe('UNAVAILABLE');
    expect(
      aggregateProviderHealth([
        { probeId: 'a', status: 'HEALTHY', checkedAtMs: CLOCK_T0_MS },
        { probeId: 'b', status: 'HEALTHY', checkedAtMs: CLOCK_T1_MS },
      ]),
    ).toBe('HEALTHY');
  });
});

describe('probe runner (offline, injectable)', () => {
  it('executes injected probes with the injected clock and aggregates honestly', () => {
    const health = runProviderHealthCheck(
      'upstash',
      [healthyProbe('rest-ping'), degradedProbe('quota-check')],
      CLOCK_T1_MS,
    );
    expect(health.provider).toBe('upstash');
    expect(health.status).toBe('DEGRADED');
    expect(health.reports.length).toBe(2);
    expect(health.reports[0]?.checkedAtMs).toBe(CLOCK_T1_MS);
    expect(health.reports[1]?.detail).toContain('injected fixture');
  });

  it('an all-healthy probe set yields HEALTHY with complete evidence', () => {
    const health = runProviderHealthCheck('neon', [healthyProbe('tcp'), healthyProbe('query')], CLOCK_T2_MS);
    expect(health.status).toBe('HEALTHY');
    expect(health.reports.every((report) => report.status === 'HEALTHY')).toBe(true);
  });

  it('no probes => UNKNOWN with the NOT_YET_DEPLOYED note', () => {
    const health = runProviderHealthCheck('r2', [], CLOCK_T0_MS);
    expect(health.status).toBe('UNKNOWN');
    expect(health.note).toContain('NOT_YET_DEPLOYED');
  });

  it('type-rejects invalid providers, invalid statuses and duplicate probe ids', () => {
    expect(() => runProviderHealthCheck('not-a-provider', [], CLOCK_T0_MS)).toThrow(ProviderHealthError);
    expect(() =>
      runProviderHealthCheck('vercel', [{ probeId: 'bad', run: () => ({ status: 'FINE' as never }) }], CLOCK_T0_MS),
    ).toThrow(/invalid status/);
    expect(() =>
      runProviderHealthCheck('vercel', [healthyProbe('dup'), healthyProbe('dup')], CLOCK_T0_MS),
    ).toThrow(/duplicate health probe id/);
    expect(() => runProviderHealthCheck('vercel', [healthyProbe('x')], Number.NaN)).toThrow(/finite injected instant/);
  });
});

describe('fabricated HEALTHY is a typed violation', () => {
  it('rejects HEALTHY with zero reports', () => {
    const fabricated = {
      provider: 'vercel',
      status: 'HEALTHY',
      reports: [],
      note: 'aspirational',
    };
    expect(() => validateProviderHealth(fabricated)).toThrow(ProviderHealthError);
    expect(() => validateProviderHealth(fabricated)).toThrow(/fabricated HEALTHY/);
  });

  it('rejects HEALTHY with a non-healthy report present', () => {
    const fabricated = {
      provider: 'neon',
      status: 'HEALTHY',
      reports: [
        { probeId: 'q', status: 'DEGRADED', checkedAtMs: CLOCK_T0_MS },
      ],
      note: 'hopeful',
    };
    expect(() => validateProviderHealth(fabricated)).toThrow(/non-HEALTHY probe report/);
  });

  it('rejects UNKNOWN with reports but no UNKNOWN report', () => {
    const inconsistent = {
      provider: 'r2',
      status: 'UNKNOWN',
      reports: [{ probeId: 'q', status: 'HEALTHY', checkedAtMs: CLOCK_T0_MS }],
      note: 'x',
    };
    expect(() => validateProviderHealth(inconsistent)).toThrow(/inconsistent UNKNOWN/);
  });
});

describe('health tracker transitions', () => {
  it('tracks UNKNOWN -> UNAVAILABLE -> DEGRADED -> HEALTHY transitions with injected instants', () => {
    const tracker = new ProviderHealthTracker();
    // Before any observation: UNKNOWN (never fabricated).
    expect(tracker.current('github').status).toBe('UNKNOWN');
    // First observation: unavailable.
    const first = tracker.observe({
      provider: 'github',
      reports: [{ probeId: 'api', status: 'UNAVAILABLE', checkedAtMs: CLOCK_T0_MS }],
    });
    expect(first.status).toBe('UNAVAILABLE');
    // Recovery: degraded.
    const second = tracker.observe({
      provider: 'github',
      reports: [{ probeId: 'api', status: 'DEGRADED', checkedAtMs: CLOCK_T1_MS }],
    });
    expect(second.status).toBe('DEGRADED');
    // Full recovery: healthy (complete evidence).
    const third = tracker.observe({
      provider: 'github',
      reports: [
        { probeId: 'api', status: 'HEALTHY', checkedAtMs: CLOCK_T2_MS },
        { probeId: 'webhook', status: 'HEALTHY', checkedAtMs: CLOCK_T2_MS },
      ],
    });
    expect(third.status).toBe('HEALTHY');
    expect(tracker.current('github').status).toBe('HEALTHY');
    expect(tracker.historyOf('github').length).toBe(3);
    expect(tracker.historyOf('github').map((entry) => entry.status)).toEqual([
      'UNAVAILABLE',
      'DEGRADED',
      'HEALTHY',
    ]);
  });

  it('a partial-evidence recovery stays honest (UNKNOWN keeps UNKNOWN)', () => {
    const tracker = new ProviderHealthTracker();
    tracker.observe({
      provider: 'upstash',
      reports: [
        { probeId: 'rest', status: 'HEALTHY', checkedAtMs: CLOCK_T0_MS },
        { probeId: 'quota', status: 'UNKNOWN', checkedAtMs: CLOCK_T0_MS },
      ],
    });
    expect(tracker.current('upstash').status).toBe('UNKNOWN');
  });

  it('providers without observations remain UNKNOWN and keep independent histories', () => {
    const tracker = new ProviderHealthTracker();
    tracker.observe({
      provider: 'vercel',
      reports: [{ probeId: 'deploy', status: 'HEALTHY', checkedAtMs: CLOCK_T0_MS }],
    });
    expect(tracker.current('vercel').status).toBe('HEALTHY');
    expect(tracker.current('neon').status).toBe('UNKNOWN');
    expect(tracker.historyOf('neon')).toEqual([]);
  });
});
