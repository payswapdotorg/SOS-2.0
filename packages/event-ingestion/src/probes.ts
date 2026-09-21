/**
 * Scheduled probes — the honest fallback of the Observation Plane.
 *
 * Work-order rule: "Use scheduled probes only where event/telemetry
 * coverage is insufficient." A probe is therefore SECOND-CLASS by
 * contract: each ProbeDefinition declares WHY it exists (the coverage
 * gap it fills), the scheduler only runs a probe when the coverage
 * ledger reports the gap still open, and every probe-produced event
 * carries the 'scheduled-probe' family so downstream consumers can
 * always distinguish probe evidence from organic event/telemetry
 * coverage. Probes never masquerade as organic signals.
 *
 * The scheduler is tick-driven: the host calls runDue(now) on its own
 * injected cadence; there are NO ambient timers here.
 */

import type { Clock } from '@sos-2/live-store';
import type { ExternalEventEnvelope, ObservationEventFamily } from './sources.js';

/** Why a probe exists (required — the coverage gap it fills). */
export interface ProbeDefinition {
  readonly probeId: string;
  /**
   * The subject the probe covers, e.g. "github:repo:payswapdotorg/SOS-2.0".
   * Coverage is keyed by (subject, family).
   */
  readonly subject: string;
  /** The organic family whose insufficient coverage justifies this probe. */
  readonly fillsFamily: ObservationEventFamily;
  /** Minimum seconds between two runs of this probe. */
  readonly minIntervalSec: number;
  /** Human-readable justification (why organic coverage is insufficient). */
  readonly purpose: string;
}

/** A probe's execution port (the reference implementation is deterministic). */
export interface ProbePort {
  readonly definition: ProbeDefinition;
  /** Execute the probe once; return the probe's event envelope (or null when the probe found nothing to report). */
  run(): Promise<ExternalEventEnvelope | null>;
}

/** Per-probe runtime state (deterministic, injected clock). */
export interface ProbeRunRecord {
  readonly probeId: string;
  readonly lastRunAt: string | null;
  readonly runCount: number;
  readonly lastOutcome: 'RAN' | 'SKIPPED_COVERED' | 'SKIPPED_INTERVAL' | 'NO_RESULT' | 'FAILED';
}

export interface ProbeRunOutcome {
  readonly probeId: string;
  readonly kind: ProbeRunRecord['lastOutcome'];
  readonly envelope: ExternalEventEnvelope | null;
}

export interface ProbeSchedulerDeps {
  readonly clock: Clock;
  /** Reports whether (subject, family) currently has sufficient organic coverage (async — reads the durable store). */
  readonly isCovered: (subject: string, family: ObservationEventFamily) => Promise<boolean>;
  readonly probes: readonly ProbePort[];
}

/**
 * The probe scheduler. runDue() considers each probe in definition order
 * and runs it only when BOTH: the organic coverage gap is still open,
 * AND the minimum interval has elapsed. Honest outcomes:
 *   RAN                — the probe produced an envelope (organic gap open)
 *   SKIPPED_COVERED    — organic coverage now suffices (the probe stood down)
 *   SKIPPED_INTERVAL   — gap open but the interval has not elapsed
 *   NO_RESULT          — the probe ran and honestly found nothing
 *   FAILED             — the probe failed (typed reason, never a throw)
 */
export class ProbeScheduler {
  private readonly clock: Clock;
  private readonly isCovered: (subject: string, family: ObservationEventFamily) => Promise<boolean>;
  private readonly probes: readonly ProbePort[];
  private readonly runs: Map<string, ProbeRunRecord>;

  constructor(deps: ProbeSchedulerDeps) {
    this.clock = deps.clock;
    this.isCovered = deps.isCovered;
    this.probes = deps.probes;
    this.runs = new Map<string, ProbeRunRecord>();
  }

  async runDue(): Promise<readonly ProbeRunOutcome[]> {
    const outcomes: ProbeRunOutcome[] = [];
    const nowMs = this.clock.nowEpochMs();
    for (const probe of this.probes) {
      const record = this.runs.get(probe.definition.probeId) ?? {
        probeId: probe.definition.probeId,
        lastRunAt: null,
        runCount: 0,
        lastOutcome: 'SKIPPED_COVERED' as const,
      };
      if (await this.isCovered(probe.definition.subject, probe.definition.fillsFamily)) {
        this.runs.set(probe.definition.probeId, { ...record, lastOutcome: 'SKIPPED_COVERED' });
        outcomes.push({ probeId: probe.definition.probeId, kind: 'SKIPPED_COVERED', envelope: null });
        continue;
      }
      if (record.lastRunAt !== null) {
        const elapsedSec = (nowMs - Date.parse(record.lastRunAt)) / 1000;
        if (elapsedSec < probe.definition.minIntervalSec) {
          this.runs.set(probe.definition.probeId, { ...record, lastOutcome: 'SKIPPED_INTERVAL' });
          outcomes.push({ probeId: probe.definition.probeId, kind: 'SKIPPED_INTERVAL', envelope: null });
          continue;
        }
      }
      let envelope: ExternalEventEnvelope | null = null;
      let outcome: ProbeRunRecord['lastOutcome'] = 'RAN';
      try {
        envelope = await probe.run();
        if (envelope === null) {
          outcome = 'NO_RESULT';
        }
      } catch (error) {
        outcome = 'FAILED';
        void (error as Error).message;
      }
      this.runs.set(probe.definition.probeId, {
        probeId: probe.definition.probeId,
        lastRunAt: new Date(nowMs).toISOString(),
        runCount: record.runCount + 1,
        lastOutcome: outcome,
      });
      outcomes.push({ probeId: probe.definition.probeId, kind: outcome, envelope });
    }
    return outcomes;
  }

  runSnapshot(): readonly ProbeRunRecord[] {
    return this.probes.map((probe) => this.runs.get(probe.definition.probeId) ?? {
      probeId: probe.definition.probeId,
      lastRunAt: null,
      runCount: 0,
      lastOutcome: 'SKIPPED_COVERED',
    });
  }
}
