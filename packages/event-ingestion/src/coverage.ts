/**
 * The coverage ledger — where event/telemetry coverage is sufficient and
 * where it is not.
 *
 * Coverage answers ONE question honestly: for a subject and an input
 * family, do we have ORGANIC (non-probe) events, and how fresh are they?
 * A subject with only probe coverage is reported as probe-covered (the
 * honest fallback), never as organically covered. Staleness is measured
 * against the injected clock with a caller-chosen freshness window.
 *
 * Subject wiring follows the SubjectQuery discipline: the composition
 * declares which event sources observe which subject (never guessed);
 * events additionally match when their payload carries an explicit
 * subject_ref equal to the subject (probe results and telemetry captures
 * do). Probe events count toward the queried family's PROBE coverage
 * (which family a probe fills is scheduler knowledge — the probe
 * definition declares it; the ledger reports the fallback honestly).
 */

import type { Clock, ObservationEventRecord, ObservationEventRepository } from '@sos-2/live-store';
import type { ObservationEventFamily } from './sources.js';

export type CoverageState = 'COVERED_FRESH' | 'COVERED_STALE' | 'PROBE_ONLY' | 'NOT_COVERED';

export interface SubjectFamilyCoverage {
  readonly subject: string;
  readonly family: ObservationEventFamily;
  readonly state: CoverageState;
  readonly organicEventCount: number;
  readonly probeEventCount: number;
  readonly lastOrganicEventAt: string | null;
}

/** Which sources observe which subject (composition wiring — never guessed). */
export interface CoverageSubjectWiring {
  readonly subject: string;
  readonly sources: readonly string[];
}

export interface CoverageLedgerDeps {
  readonly observationEvents: ObservationEventRepository;
  readonly clock: Clock;
  /** Freshness window in milliseconds (organic events older than this are STALE). */
  readonly freshAfterMs: number;
  /** The subject wiring (same discipline as the observation SubjectQuery). */
  readonly subjects: readonly CoverageSubjectWiring[];
}

export class CoverageLedger {
  private readonly observationEvents: ObservationEventRepository;
  private readonly clock: Clock;
  private readonly freshAfterMs: number;
  private readonly subjects: readonly CoverageSubjectWiring[];

  constructor(deps: CoverageLedgerDeps) {
    this.observationEvents = deps.observationEvents;
    this.clock = deps.clock;
    this.freshAfterMs = deps.freshAfterMs;
    this.subjects = deps.subjects;
  }

  /** Coverage for one (subject, family) pair. */
  async coverageFor(subject: string, family: ObservationEventFamily): Promise<SubjectFamilyCoverage> {
    const events = await this.eventsForSubject(subject);
    const nowMs = this.clock.nowEpochMs();
    let organicEventCount = 0;
    let probeEventCount = 0;
    let lastOrganicEventAt: string | null = null;
    for (const event of events) {
      if (isProbeEvent(event)) {
        probeEventCount += 1;
        continue;
      }
      if (!matchesFamily(event, family)) {
        continue;
      }
      organicEventCount += 1;
      if (lastOrganicEventAt === null || event.occurred_at > lastOrganicEventAt) {
        lastOrganicEventAt = event.occurred_at;
      }
    }
    if (organicEventCount === 0) {
      const state: CoverageState = probeEventCount > 0 ? 'PROBE_ONLY' : 'NOT_COVERED';
      return { subject, family, state, organicEventCount, probeEventCount, lastOrganicEventAt };
    }
    const ageMs = nowMs - Date.parse(lastOrganicEventAt as string);
    const state: CoverageState = ageMs <= this.freshAfterMs ? 'COVERED_FRESH' : 'COVERED_STALE';
    return { subject, family, state, organicEventCount, probeEventCount, lastOrganicEventAt };
  }

  /** True when the (subject, family) pair has fresh organic coverage — the probe stand-down condition. */
  async isCovered(subject: string, family: ObservationEventFamily): Promise<boolean> {
    const coverage = await this.coverageFor(subject, family);
    return coverage.state === 'COVERED_FRESH';
  }

  private async eventsForSubject(subject: string): Promise<readonly ObservationEventRecord[]> {
    const wiring = this.subjects.find((entry) => entry.subject === subject);
    const wiredSources = wiring !== undefined ? new Set(wiring.sources) : null;
    const result = await this.observationEvents.list({ limit: 1000 });
    return result.items.filter((event) => {
      if (wiredSources !== null && wiredSources.has(event.source)) {
        return true;
      }
      const payload = event.payload;
      if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
        const record = payload as Record<string, unknown>;
        const subjectRef = record['subject_ref'];
        if (typeof subjectRef === 'string' && subjectRef === subject) {
          return true;
        }
      }
      return false;
    });
  }
}

function isProbeEvent(event: ObservationEventRecord): boolean {
  return event.source.startsWith('scheduled-probe:') || event.kind === 'scheduled-probe.result';
}

/** Map a durable organic event to an input family by its kind or source prefix. */
function matchesFamily(event: ObservationEventRecord, family: ObservationEventFamily): boolean {
  const byKind: Record<string, ObservationEventFamily> = {
    'github.push': 'github',
    'github.pull_request': 'github',
    'ci.run': 'ci',
    'deployment.change': 'deployment',
    'telemetry.observation': 'telemetry',
    'incident.report': 'incident',
    'provider-health.signal': 'provider-health',
    'user.observation': 'user-observation',
  };
  if (byKind[event.kind] === family) {
    return true;
  }
  return event.source.startsWith(`${family}:`);
}
