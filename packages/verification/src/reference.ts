/**
 * The in-memory reference monitor engine (Work Order W8: "Include one
 * in-memory reference implementation; real engines are adapters, not
 * authority").
 *
 * Supported property kinds: ALWAYS and RESPONSE. A structurally valid
 * property of any OTHER kind (e.g. CUSTOM) is answered truthfully with
 * verdict INCONCLUSIVE / availability UNSUPPORTED — the reference engine
 * cannot evaluate it, and UNSUPPORTED is never folded into UNKNOWN or
 * treated as satisfaction (spec/architecture.md section 18: "Unknown,
 * failed, unavailable and unsupported remain distinct").
 *
 * ALWAYS semantics (finite-trace, witness discipline):
 *   - any event witnessing the predicate NOT holding -> VIOLATED / FAILURE
 *     (a positively witnessed violation; the earliest witness is cited);
 *   - >= 1 event, all witnessing it holding -> SATISFIED / SUCCESS
 *     ("no violation witnessed across the observed trace");
 *   - no event for the predicate at all -> INCONCLUSIVE / UNAVAILABLE
 *     (a gap is data about missing data — never read as satisfied).
 *
 * RESPONSE semantics (trigger/response with optional deadline):
 *   - a trigger whose deadline (within_ms) has passed at `now` without a
 *     response -> VIOLATED / FAILURE (witnessed deadline miss);
 *   - triggers observed, every one answered (within the bound when set) ->
 *     SATISFIED / SUCCESS;
 *   - triggers observed, none answered yet and every deadline still open ->
 *     INCONCLUSIVE / UNKNOWN (the answer is genuinely undetermined on a
 *     finite trace);
 *   - some answered, some still open -> INCONCLUSIVE / PARTIAL;
 *   - NO trigger observed at all -> INCONCLUSIVE / UNKNOWN with an explicit
 *     "never exercised" reason — VACUOUS SATISFACTION IS NEVER REPORTED
 *     (a response property that never fired says nothing about the system).
 *
 * Everything is deterministic: events are processed in a stable order
 * (by instant, then input position) and reasons cite the earliest witness.
 */

import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import { MonitorEngineError } from './errors.js';
import type {
  AlwaysProperty,
  MonitorDefinition,
  MonitorEvent,
  MonitorProperty,
  ResponseProperty,
} from './monitor.js';
import type {
  MonitorEvaluationContext,
  MonitorEvaluationResult,
  RuntimeMonitorEngine,
} from './engine.js';
import {
  MONITOR_VERDICT_AVAILABILITY,
  mintMonitorEvidence,
  monitorObservesLink,
} from './engine.js';

/** The reference engine id (also the method provenance segment). */
export const REFERENCE_ENGINE_ID = 'runtime-verification:in-memory-reference';

function epochMillis(timestamp: string): number {
  const millis = Date.parse(timestamp);
  if (Number.isNaN(millis)) {
    throw new MonitorEngineError(`unparseable RFC3339 timestamp: ${JSON.stringify(timestamp)}`);
  }
  return millis;
}

/** Stable order: by instant, then by input position. */
function stableEvents(events: readonly MonitorEvent[]): { event: MonitorEvent; index: number }[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const delta = epochMillis(a.event.at) - epochMillis(b.event.at);
      return delta !== 0 ? delta : a.index - b.index;
    });
}

interface Decision {
  verdict: 'SATISFIED' | 'VIOLATED' | 'INCONCLUSIVE';
  availability: EvidenceTruthState;
  reason: string;
}

function evaluateAlways(property: AlwaysProperty, events: readonly MonitorEvent[], now: string): Decision {
  const relevant = stableEvents(events).filter((entry) => entry.event.predicate === property.predicate);
  if (relevant.length === 0) {
    return {
      verdict: 'INCONCLUSIVE',
      availability: 'UNAVAILABLE',
      reason:
        `no observations of predicate ${JSON.stringify(property.predicate)} exist in the monitored trace — ` +
        'a gap is data about missing data and is never read as satisfaction',
    };
  }
  const violation = relevant.find((entry) => entry.event.holds === false);
  if (violation !== undefined) {
    return {
      verdict: 'VIOLATED',
      availability: 'FAILURE',
      reason:
        `predicate ${JSON.stringify(property.predicate)} was witnessed NOT to hold at ${violation.event.at} ` +
        `(earliest of ${relevant.filter((entry) => entry.event.holds === false).length} witnessed violation(s))`,
    };
  }
  return {
    verdict: 'SATISFIED',
    availability: 'SUCCESS',
    reason:
      `predicate ${JSON.stringify(property.predicate)} was witnessed to hold at all ${relevant.length} observed point(s) ` +
      `(no violation witnessed as of ${now})`,
  };
}

function evaluateResponse(property: ResponseProperty, events: readonly MonitorEvent[], now: string): Decision {
  const ordered = stableEvents(events);
  const triggers = ordered.filter((entry) => entry.event.predicate === property.trigger && entry.event.holds === true);
  if (triggers.length === 0) {
    return {
      verdict: 'INCONCLUSIVE',
      availability: 'UNKNOWN',
      reason:
        `the response property (trigger ${JSON.stringify(property.trigger)} -> response ${JSON.stringify(property.response)}) ` +
        'was never exercised by the observed trace — VACUOUS SATISFACTION IS NEVER REPORTED',
    };
  }
  const responses = ordered.filter((entry) => entry.event.predicate === property.response && entry.event.holds === true);
  const nowEpoch = epochMillis(now);

  let missed = 0;
  let answered = 0;
  let open = 0;
  let firstMiss: { at: string; deadline: number } | null = null;
  for (const trigger of triggers) {
    const triggeredAt = epochMillis(trigger.event.at);
    const deadline = property.within_ms === null ? null : triggeredAt + property.within_ms;
    const answeredBy = responses.some((response) => {
      const responseAt = epochMillis(response.event.at);
      if (responseAt < triggeredAt) {
        return false;
      }
      return deadline === null || responseAt <= deadline;
    });
    if (answeredBy) {
      answered += 1;
      continue;
    }
    if (deadline !== null && nowEpoch > deadline) {
      missed += 1;
      if (firstMiss === null || trigger.event.at < firstMiss.at) {
        firstMiss = { at: trigger.event.at, deadline };
      }
    } else {
      open += 1;
    }
  }

  if (missed > 0 && firstMiss !== null) {
    return {
      verdict: 'VIOLATED',
      availability: 'FAILURE',
      reason:
        `trigger ${JSON.stringify(property.trigger)} at ${firstMiss.at} missed its response deadline ` +
        `(earliest of ${missed} witnessed deadline miss(es); response ${JSON.stringify(property.response)} never arrived in bound)`,
    };
  }
  if (open > 0 && answered > 0) {
    return {
      verdict: 'INCONCLUSIVE',
      availability: 'PARTIAL',
      reason:
        `${answered} of ${triggers.length} trigger(s) answered; ${open} still awaiting response ` +
        `${property.within_ms === null ? '(no deadline — eventual response)' : `(deadlines still open as of ${now})`}`,
    };
  }
  if (open > 0) {
    return {
      verdict: 'INCONCLUSIVE',
      availability: 'UNKNOWN',
      reason:
        `all ${open} observed trigger(s) are still awaiting response ` +
        `${property.within_ms === null ? '(no deadline — eventual response)' : `(deadlines still open as of ${now})`}`,
    };
  }
  return {
    verdict: 'SATISFIED',
    availability: 'SUCCESS',
    reason:
      `every observed trigger (${triggers.length}) was answered by ${JSON.stringify(property.response)} ` +
      `${property.within_ms === null ? '(eventually)' : `(within ${property.within_ms} ms)`}`,
  };
}

function decide(property: MonitorProperty, events: readonly MonitorEvent[], now: string): Decision {
  switch (property.kind) {
    case 'ALWAYS':
      return evaluateAlways(property, events, now);
    case 'RESPONSE':
      return evaluateResponse(property, events, now);
    case 'CUSTOM':
      return {
        verdict: 'INCONCLUSIVE',
        availability: 'UNSUPPORTED',
        reason:
          `the in-memory reference engine does not support CUSTOM properties (engine ${JSON.stringify(property.engine)}) — ` +
          'UNSUPPORTED is never folded into UNKNOWN and never read as satisfaction',
      };
  }
}

/**
 * Create the in-memory reference engine. Pure and deterministic: identical
 * (monitor, events, context) triples reproduce identical results and
 * identical evidence ids.
 */
export function createInMemoryReferenceEngine(): RuntimeMonitorEngine {
  return {
    id: REFERENCE_ENGINE_ID,
    supportedProperties: ['ALWAYS', 'RESPONSE'],
    evaluate(
      monitor: MonitorDefinition,
      events: readonly MonitorEvent[],
      context: MonitorEvaluationContext,
    ): MonitorEvaluationResult {
      const decision = decide(monitor.property, events, context.now);
      if (!MONITOR_VERDICT_AVAILABILITY[decision.verdict].includes(decision.availability)) {
        // Structurally impossible for this engine; kept as a self-check that
        // the reference adapter obeys its own contract.
        throw new MonitorEngineError(
          `reference engine produced a verdict/availability pair outside the frozen mapping: ${decision.verdict}/${decision.availability}`,
        );
      }
      const evidence = mintMonitorEvidence({
        engineId: REFERENCE_ENGINE_ID,
        monitor,
        events,
        context,
        verdict: decision.verdict,
        availability: decision.availability,
        reason: decision.reason,
      });
      return {
        monitor_id: monitor.id,
        verdict: decision.verdict,
        availability: decision.availability,
        reason: decision.reason,
        evidence,
        links: [monitorObservesLink(evidence, context)],
      };
    },
  };
}
