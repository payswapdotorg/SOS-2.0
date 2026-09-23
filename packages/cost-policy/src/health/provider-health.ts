/**
 * Provider health (Work Order P14): typed health records with honest
 * UNKNOWN during outage windows — the P7 truthful-stale discipline and
 * the P3 four-status vocabulary (UNKNOWN | UNAVAILABLE | DEGRADED |
 * HEALTHY), as an INDEPENDENT typed vocabulary aligned by documentation
 * and PINNED by the acceptance suite (which runs the merged P3
 * aggregate over the same probe sets and asserts identical verdicts).
 *
 * NO FABRICATED HEALTH:
 *   - an unprobed provider is UNKNOWN (the honest default);
 *   - HEALTHY is only ever the aggregate with at least one probe and
 *     every probe HEALTHY;
 *   - during an outage window with no observations, the status is
 *     UNKNOWN — never a fabricated HEALTHY and never a guessed
 *     UNAVAILABLE (a provider is UNAVAILABLE only when an observation
 *     SAYS so);
 *   - statuses change ONLY through observed probe reports.
 *
 * Determinism: statuses derive purely from injected reports; the
 * tracker stamps receipt times with the injected clock.
 */

import type { Timestamp } from '../types.js';

/** The four honest health statuses (aligned with P3/P7; pinned by tests). */
export const PROVIDER_HEALTH_STATUSES = ['UNKNOWN', 'UNAVAILABLE', 'DEGRADED', 'HEALTHY'] as const;
export type ProviderHealthStatus = (typeof PROVIDER_HEALTH_STATUSES)[number];

/** One probe outcome (returned by an injected probe function). */
export interface HealthProbeOutcome {
  readonly status: ProviderHealthStatus;
  readonly detail: string | null;
}

/** One probe report (an observed outcome at an injected instant). */
export interface ProbeReport {
  readonly probeId: string;
  readonly status: ProviderHealthStatus;
  readonly detail: string | null;
  readonly checkedAt: Timestamp;
}

/** The per-provider health record (typed, durable). */
export interface ProviderHealthRecord {
  readonly providerId: string;
  readonly status: ProviderHealthStatus;
  readonly reports: readonly ProbeReport[];
  readonly lastProbeAt: Timestamp | null;
  readonly note: string;
}

/** The honest note for a provider with no observations yet. */
export const UNPROBED_PROVIDER_NOTE =
  'no probe has been observed for this provider; the honest status is UNKNOWN — never a fabricated HEALTHY, never a guessed UNAVAILABLE';

/**
 * Aggregate rule (deterministic, fail-closed against fabricated HEALTHY
 * — aligned with the merged P3 diagnostics aggregate):
 *   - no probes at all, or any UNKNOWN probe => UNKNOWN;
 *   - any UNAVAILABLE probe => UNAVAILABLE;
 *   - any DEGRADED probe => DEGRADED;
 *   - else ALL probes HEALTHY and at least one probe => HEALTHY.
 * HEALTHY can therefore never appear without complete positive evidence.
 */
export function aggregateProviderHealth(reports: readonly ProbeReport[]): ProviderHealthStatus {
  if (reports.length === 0) return 'UNKNOWN';
  const statuses = reports.map((report) => report.status);
  if (statuses.includes('UNKNOWN')) return 'UNKNOWN';
  if (statuses.includes('UNAVAILABLE')) return 'UNAVAILABLE';
  if (statuses.includes('DEGRADED')) return 'DEGRADED';
  return 'HEALTHY';
}

/** The un-probed provider health (always UNKNOWN — never fabricated). */
export function unprobedProviderHealth(providerId: string): ProviderHealthRecord {
  return {
    providerId,
    status: 'UNKNOWN',
    reports: [],
    lastProbeAt: null,
    note: UNPROBED_PROVIDER_NOTE,
  };
}

/**
 * The provider health tracker: statuses change ONLY through observed
 * probe reports (never through wishes, timeouts that prove nothing, or
 * defaults). The CURRENT aggregate is over the LATEST report of each
 * probe (a later observation of the same probe replaces its previous
 * report — recovery is OBSERVED, never assumed, and never fabricated
 * from silence); receipt times are stamped with the INJECTED clock.
 */
export class ProviderHealthTracker {
  private readonly providers: Map<string, { latest: Map<string, ProbeReport>; lastProbeAt: Timestamp }> = new Map();
  private readonly clock: { now(): Timestamp };

  constructor(clock: { now(): Timestamp }) {
    this.clock = clock;
  }

  /** Record an observed probe report for a provider. */
  reportProbe(providerId: string, probeId: string, outcome: HealthProbeOutcome): ProviderHealthRecord {
    if (typeof providerId !== 'string' || providerId.length === 0) {
      throw new Error('[provider-health] providerId must be a non-empty string');
    }
    if (typeof probeId !== 'string' || probeId.length === 0) {
      throw new Error('[provider-health] probeId must be a non-empty string');
    }
    if (!(PROVIDER_HEALTH_STATUSES as readonly string[]).includes(outcome.status)) {
      throw new Error(`[provider-health] unknown probe status ${JSON.stringify(outcome.status)}`);
    }
    const now = this.clock.now();
    const report: ProbeReport = {
      probeId,
      status: outcome.status,
      detail: outcome.detail,
      checkedAt: now,
    };
    let entry = this.providers.get(providerId);
    if (entry === undefined) {
      entry = { latest: new Map(), lastProbeAt: now };
      this.providers.set(providerId, entry);
    }
    entry.latest.set(probeId, report); // the LATEST observation per probe
    entry.lastProbeAt = now;
    const reports = [...entry.latest.values()].sort((a, b) => (a.probeId < b.probeId ? -1 : a.probeId > b.probeId ? 1 : 0));
    return {
      providerId,
      status: aggregateProviderHealth(reports),
      reports,
      lastProbeAt: entry.lastProbeAt,
      note: `status aggregated from the latest observed report of each of ${reports.length} probe(s) — statuses change only through observed reports`,
    };
  }

  /** The current health record (UNKNOWN for unprobed providers — honest). */
  current(providerId: string): ProviderHealthRecord {
    const entry = this.providers.get(providerId);
    if (entry === undefined) return unprobedProviderHealth(providerId);
    const reports = [...entry.latest.values()].sort((a, b) => (a.probeId < b.probeId ? -1 : a.probeId > b.probeId ? 1 : 0));
    return {
      providerId,
      status: aggregateProviderHealth(reports),
      reports,
      lastProbeAt: entry.lastProbeAt,
      note: `status aggregated from the latest observed report of each of ${reports.length} probe(s) — statuses change only through observed reports`,
    };
  }
}
