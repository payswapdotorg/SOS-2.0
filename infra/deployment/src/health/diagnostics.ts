/**
 * Provider health diagnostics (Work Order P3).
 *
 * Per-provider health contract with the four honest statuses:
 *
 *   UNKNOWN     no observation yet — the default state; a provider with
 *               credentials pending (the current NOT_YET_DEPLOYED reality)
 *               is UNKNOWN, never HEALTHY;
 *   UNAVAILABLE the provider is reachable-checked and not usable;
 *   DEGRADED    usable with impairments (latency, partial capability loss);
 *   HEALTHY     probes observed it working — and HEALTHY is ONLY ever the
 *               aggregate when at least one probe ran and EVERY probe is
 *               HEALTHY. A fabricated HEALTHY is a contract violation.
 *
 * The probe runner is fully injectable: probes are caller-supplied
 * functions returning probe outcomes; the offline tests use fake
 * providers, and real probes (network calls) arrive with real credentials
 * in later waves. No probe function ever runs inside this module.
 *
 * Deterministic: clocks are injected; no Date.now, no fetch, no entropy.
 */

import { ProviderHealthError, isInfraProviderId, type InfraProviderId } from '../core/types.ts';

/** The four honest health statuses (frozen vocabulary). */
export const PROVIDER_HEALTH_STATUSES = ['UNKNOWN', 'UNAVAILABLE', 'DEGRADED', 'HEALTHY'] as const;
export type ProviderHealthStatus = (typeof PROVIDER_HEALTH_STATUSES)[number];

export function isProviderHealthStatus(value: unknown): value is ProviderHealthStatus {
  return typeof value === 'string' && (PROVIDER_HEALTH_STATUSES as readonly string[]).includes(value);
}

/** One probe outcome (returned by an injected probe function). */
export interface ProbeOutcome {
  readonly status: ProviderHealthStatus;
  readonly detail?: string;
}

/** A health probe: id + injectable run function. Probes never run here. */
export interface HealthProbe {
  readonly probeId: string;
  readonly run: () => ProbeOutcome;
}

/** One probe report (result of running a probe at an injected instant). */
export interface ProbeReport {
  readonly probeId: string;
  readonly status: ProviderHealthStatus;
  readonly detail?: string;
  readonly checkedAtMs: number;
}

/** Aggregate provider health. */
export interface ProviderHealth {
  readonly provider: InfraProviderId;
  readonly status: ProviderHealthStatus;
  readonly reports: readonly ProbeReport[];
  readonly note: string;
}

/** The honest-status note for the current (pre-credential) reality. */
export const NOT_YET_DEPLOYED_HEALTH_NOTE =
  'validation account pending (NOT_YET_DEPLOYED): no real provider probe has run; the honest status is UNKNOWN';

/**
 * Aggregate rule (deterministic, fail-closed against fabricated HEALTHY):
 *   - any UNAVAILABLE probe => UNAVAILABLE;
 *   - else any DEGRADED probe => DEGRADED;
 *   - else ALL probes HEALTHY and at least one probe => HEALTHY;
 *   - no probes at all, or any UNKNOWN probe => UNKNOWN.
 * HEALTHY can therefore never appear without complete, positive evidence.
 */
export function aggregateProviderHealth(reports: readonly ProbeReport[]): ProviderHealthStatus {
  if (reports.length === 0) return 'UNKNOWN';
  const statuses = reports.map((report) => report.status);
  if (statuses.includes('UNKNOWN')) return 'UNKNOWN';
  if (statuses.includes('UNAVAILABLE')) return 'UNAVAILABLE';
  if (statuses.includes('DEGRADED')) return 'DEGRADED';
  return 'HEALTHY';
}

/** The un-probed health of a provider (always UNKNOWN — never fabricated). */
export function unprobedProviderHealth(provider: InfraProviderId): ProviderHealth {
  return {
    provider,
    status: 'UNKNOWN',
    reports: [],
    note: NOT_YET_DEPLOYED_HEALTH_NOTE,
  };
}

/**
 * Runs a provider health check: executes the INJECTED probes, stamps each
 * report with the INJECTED clock, aggregates honestly. Probes run in the
 * order supplied; the runner adds no observations of its own.
 */
export function runProviderHealthCheck(
  provider: InfraProviderId,
  probes: readonly HealthProbe[],
  clockMs: number,
): ProviderHealth {
  if (!isInfraProviderId(provider)) {
    throw new ProviderHealthError(`unknown infra provider id '${String(provider)}' cannot have a health contract`);
  }
  if (!Number.isFinite(clockMs)) {
    throw new ProviderHealthError('clockMs must be a finite injected instant (library code never reads a clock)');
  }
  const seenProbeIds = new Set<string>();
  const reports: ProbeReport[] = [];
  for (const probe of probes) {
    if (typeof probe.probeId !== 'string' || probe.probeId.length === 0) {
      throw new ProviderHealthError('every health probe must carry a non-empty probeId');
    }
    if (seenProbeIds.has(probe.probeId)) {
      throw new ProviderHealthError(`duplicate health probe id '${probe.probeId}' for provider '${provider}'`);
    }
    seenProbeIds.add(probe.probeId);
    const outcome = probe.run();
    if (!isProviderHealthStatus(outcome.status)) {
      throw new ProviderHealthError(
        `probe '${probe.probeId}' returned an invalid status '${String(outcome.status)}' (must be one of ${PROVIDER_HEALTH_STATUSES.join('|')})`,
      );
    }
    const report: ProbeReport =
      outcome.detail === undefined
        ? { probeId: probe.probeId, status: outcome.status, checkedAtMs: clockMs }
        : { probeId: probe.probeId, status: outcome.status, detail: outcome.detail, checkedAtMs: clockMs };
    reports.push(report);
  }
  return {
    provider,
    status: aggregateProviderHealth(reports),
    reports,
    note: reports.length === 0 ? NOT_YET_DEPLOYED_HEALTH_NOTE : 'probes executed (injected, offline-testable)',
  };
}

/** A health observation to record into a tracker (already-run evidence). */
export interface HealthObservation {
  readonly provider: InfraProviderId;
  readonly reports: readonly ProbeReport[];
}

/**
 * Tracks health per provider over time. The tracker NEVER invents
 * statuses: a provider absent from observations is UNKNOWN; a fabricated
 * HEALTHY (constructing a ProviderHealth with HEALTHY but no reports) is
 * typed-rejected by validateProviderHealth.
 */
export class ProviderHealthTracker {
  private readonly history = new Map<InfraProviderId, ProviderHealth[]>();

  observe(observation: HealthObservation): ProviderHealth {
    const health: ProviderHealth = {
      provider: observation.provider,
      status: aggregateProviderHealth(observation.reports),
      reports: observation.reports,
      note: 'observed',
    };
    validateProviderHealth(health);
    const existing = this.history.get(observation.provider) ?? [];
    existing.push(health);
    this.history.set(observation.provider, existing);
    return health;
  }

  current(provider: InfraProviderId): ProviderHealth {
    const entries = this.history.get(provider);
    if (entries === undefined || entries.length === 0) {
      return unprobedProviderHealth(provider);
    }
    return entries[entries.length - 1] as ProviderHealth;
  }

  historyOf(provider: InfraProviderId): readonly ProviderHealth[] {
    return this.history.get(provider) ?? [];
  }
}

/**
 * Validates a ProviderHealth against the honesty contract:
 *   - status must be one of the four;
 *   - HEALTHY requires >= 1 report and every report HEALTHY;
 *   - UNKNOWN with reports requires at least one UNKNOWN report;
 *   - reports carry non-empty probe ids and finite injected instants.
 * A fabricated HEALTHY is a typed violation — never a silent pass.
 */
export function validateProviderHealth(health: ProviderHealth): void {
  if (!isInfraProviderId(health.provider)) {
    throw new ProviderHealthError(`provider health carries an unknown provider id '${String(health.provider)}'`);
  }
  if (!isProviderHealthStatus(health.status)) {
    throw new ProviderHealthError(
      `provider health status must be one of ${PROVIDER_HEALTH_STATUSES.join('|')} (got '${String(health.status)}')`,
    );
  }
  for (const report of health.reports) {
    if (typeof report.probeId !== 'string' || report.probeId.length === 0) {
      throw new ProviderHealthError(`provider health report for '${health.provider}' lacks a probeId`);
    }
    if (!Number.isFinite(report.checkedAtMs)) {
      throw new ProviderHealthError(`health report '${report.probeId}' carries a non-finite injected instant`);
    }
  }
  if (health.status === 'HEALTHY') {
    if (health.reports.length === 0) {
      throw new ProviderHealthError(
        `fabricated HEALTHY for provider '${health.provider}': no probe reports exist — HEALTHY requires at least one probe and all probes HEALTHY`,
      );
    }
    if (!health.reports.every((report) => report.status === 'HEALTHY')) {
      throw new ProviderHealthError(
        `fabricated HEALTHY for provider '${health.provider}': exists at least one non-HEALTHY probe report — the aggregate is the honest combination, not the aspiration`,
      );
    }
  }
  if (health.status === 'UNKNOWN' && health.reports.length > 0) {
    if (!health.reports.some((report) => report.status === 'UNKNOWN')) {
      throw new ProviderHealthError(
        `inconsistent UNKNOWN for provider '${health.provider}': reports exist but none is UNKNOWN — the aggregate would not be UNKNOWN`,
      );
    }
  }
}
