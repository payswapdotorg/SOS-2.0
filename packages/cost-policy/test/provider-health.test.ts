// No vitest import: the borrowed toolchain runs with `globals: true`.
import {
  ProviderHealthTracker,
  aggregateProviderHealth,
  unprobedProviderHealth,
  PROVIDER_HEALTH_STATUSES,
  type ProbeReport,
} from '../src/index.js';

class ManualClock {
  private current: number;
  constructor(start: number) {
    this.current = start;
  }
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

describe('provider health (honest UNKNOWN; no fabricated health)', () => {
  it('the four honest statuses (P3/P7-aligned vocabulary)', () => {
    expect(PROVIDER_HEALTH_STATUSES).toEqual(['UNKNOWN', 'UNAVAILABLE', 'DEGRADED', 'HEALTHY']);
  });

  it('PINNED: an unprobed provider is UNKNOWN — never HEALTHY, never a guessed UNAVAILABLE', () => {
    const unprobed = unprobedProviderHealth('provider-neon');
    expect(unprobed.status).toBe('UNKNOWN');
    expect(unprobed.lastProbeAt).toBeNull();
    expect(unprobed.note).toContain('never a fabricated HEALTHY');
    expect(unprobed.note).toContain('never a guessed UNAVAILABLE');
  });

  it('aggregate: HEALTHY only with at least one probe and every probe HEALTHY', () => {
    expect(aggregateProviderHealth([])).toBe('UNKNOWN');
    expect(aggregateProviderHealth([probe('p1', 'UNKNOWN', 1)])).toBe('UNKNOWN');
    expect(aggregateProviderHealth([probe('p1', 'HEALTHY', 1)])).toBe('HEALTHY');
    expect(aggregateProviderHealth([probe('p1', 'HEALTHY', 1), probe('p2', 'DEGRADED', 2)])).toBe('DEGRADED');
    expect(aggregateProviderHealth([probe('p1', 'HEALTHY', 1), probe('p2', 'UNAVAILABLE', 2)])).toBe('UNAVAILABLE');
    expect(aggregateProviderHealth([probe('p1', 'UNAVAILABLE', 1), probe('p2', 'DEGRADED', 2)])).toBe('UNAVAILABLE');
    expect(aggregateProviderHealth([probe('p1', 'UNKNOWN', 1), probe('p2', 'UNAVAILABLE', 2)])).toBe('UNKNOWN');
  });

  it('PINNED: during an outage window with no observations, the tracker reports UNKNOWN honestly', () => {
    const clock = new ManualClock(1_000_000);
    const tracker = new ProviderHealthTracker(clock);
    // A provider was healthy, then an outage window begins — no probe
    // observations arrive during the window. The tracker does not
    // fabricate UNAVAILABLE out of silence: the LAST OBSERVED record
    // stands, and a fresh tracker (no observations) is UNKNOWN.
    tracker.reportProbe('provider-github', 'probe-1', { status: 'HEALTHY', detail: 'ok' });
    clock.advance(60_000);
    const current = tracker.current('provider-github');
    expect(current.status).toBe('HEALTHY'); // last observed evidence stands
    expect(current.reports.length).toBe(1);
    // A NEW provider observed never (the outage reality for a fresh
    // integration) is UNKNOWN:
    expect(tracker.current('provider-never-observed').status).toBe('UNKNOWN');
    // When an observation DOES arrive showing unavailability, it says so:
    tracker.reportProbe('provider-github', 'probe-2', { status: 'UNAVAILABLE', detail: 'connection refused' });
    expect(tracker.current('provider-github').status).toBe('UNAVAILABLE');
  });

  it('statuses change ONLY through observed probe reports; recovery requires new observations', () => {
    const clock = new ManualClock(1_000_000);
    const tracker = new ProviderHealthTracker(clock);
    const first = tracker.reportProbe('provider-github', 'probe-1', { status: 'DEGRADED', detail: 'slow' });
    expect(first.status).toBe('DEGRADED');
    expect(first.lastProbeAt).toBe(1_000_000);
    clock.advance(5_000);
    // A LATER observation of the same probe replaces its latest report —
    // the aggregate follows observed evidence (recovery is observed,
    // never assumed, and never fabricated from silence).
    const recovered = tracker.reportProbe('provider-github', 'probe-1', { status: 'HEALTHY', detail: 'recovered' });
    expect(recovered.status).toBe('HEALTHY');
    expect(recovered.reports.length).toBe(1); // latest report per probe
    expect(recovered.lastProbeAt).toBe(1_005_000);
    // A second probe degrading degrades the provider:
    clock.advance(5_000);
    const degraded = tracker.reportProbe('provider-github', 'probe-2', { status: 'DEGRADED', detail: 'partial loss' });
    expect(degraded.status).toBe('DEGRADED');
  });

  it('malformed probe inputs are typed rejections', () => {
    const tracker = new ProviderHealthTracker(new ManualClock(0));
    expect(() => tracker.reportProbe('', 'probe', { status: 'HEALTHY', detail: null })).toThrow();
    expect(() => tracker.reportProbe('p', '', { status: 'HEALTHY', detail: null })).toThrow();
    expect(() => tracker.reportProbe('p', 'probe', { status: 'FABRICATED' as never, detail: null })).toThrow();
  });
});

function probe(probeId: string, status: ProbeReport['status'], checkedAt: number): ProbeReport {
  return { probeId, status, detail: null, checkedAt };
}
