/**
 * Operational diagnostics (Work Order P14).
 *
 * The acceptance bullet: "operational diagnostics identify the
 * responsible task/body/provider." This module turns the audit trail
 * (and any P7-discipline observation records) into typed attribution:
 * given a symptom query, it maps the evidence to the responsible task,
 * body and provider through the TRACE LINKS every policy decision
 * carries — nothing is inferred from prose, nothing is fabricated.
 *
 * A diagnosis that cannot be made from the available records says so
 * (INSUFFICIENT_EVIDENCE — the honest-UNKNOWN discipline); it never
 * guesses a responsible party.
 *
 * Determinism: pure functions over injected records; no ambient anything.
 */

import type { AuditEventRecord, PolicyDecisionKind } from '../audit/audit.js';
import { AUDIT_EVENT_KIND } from '../audit/audit.js';

/** What the operator is looking for. */
export interface DiagnosisQuery {
  readonly taskId?: string;
  readonly bodyId?: string;
  readonly providerId?: string;
  /** Restrict to decisions at or after this RFC3339 instant. */
  readonly since?: string;
}

/** A symptom surface an operator can start from. */
export type SymptomSurface =
  | 'denied-actions'
  | 'secret-redactions'
  | 'budget-exhaustion'
  | 'rate-limiting'
  | 'provider-degradation'
  | 'dead-lettered-work'
  | 'abuse-suspensions';

/** Which audit surfaces a symptom surface maps onto. */
const SYMPTOM_SURFACES: Readonly<Record<SymptomSurface, readonly string[]>> = {
  'denied-actions': ['credential-scope', 'workspace-isolation'],
  'secret-redactions': ['secret-isolation'],
  'budget-exhaustion': ['budget'],
  'rate-limiting': ['rate-limit'],
  'provider-degradation': ['provider-health'],
  'dead-lettered-work': ['dead-letter'],
  'abuse-suspensions': ['abuse-containment'],
};

/** The decision kinds that constitute the symptom for each surface. */
const SYMPTOM_KINDS: readonly PolicyDecisionKind[] = ['DENY', 'REDACT', 'UNKNOWN'];

/**
 * The typed responsibility attribution: WHO the evidence points at.
 * Absent links stay null — an attribution never invents a task/body/
 * provider that the records do not name.
 */
export interface ResponsibilityAttribution {
  readonly taskId: string | null;
  readonly bodyId: string | null;
  readonly providerId: string | null;
  readonly decisionCount: number;
  readonly denials: number;
  readonly redactions: number;
  readonly unknowns: number;
  readonly surfaces: readonly string[];
  readonly firstOccurredAt: string | null;
  readonly lastOccurredAt: string | null;
}

/** The typed diagnosis result. */
export interface DiagnosisResult {
  readonly query: DiagnosisQuery;
  readonly attributions: readonly ResponsibilityAttribution[];
  readonly matchedEvents: readonly AuditEventRecord[];
  readonly verdict: 'ATTRIBUTED' | 'INSUFFICIENT_EVIDENCE';
}

interface DecisionPayloadShape {
  readonly decision: PolicyDecisionKind;
  readonly surface: string;
  readonly taskId: string | null;
  readonly bodyId: string | null;
  readonly providerId: string | null;
}

function payloadOf(event: AuditEventRecord): DecisionPayloadShape | null {
  if (event.kind !== AUDIT_EVENT_KIND) return null;
  const payload = event.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record['decision'] !== 'string' || typeof record['surface'] !== 'string') return null;
  return {
    decision: record['decision'] as PolicyDecisionKind,
    surface: record['surface'] as string,
    taskId: typeof record['taskId'] === 'string' ? record['taskId'] : null,
    bodyId: typeof record['bodyId'] === 'string' ? record['bodyId'] : null,
    providerId: typeof record['providerId'] === 'string' ? record['providerId'] : null,
  };
}

/**
 * Diagnose a symptom: collect the audit records that match the query
 * and the symptom surfaces, then group them into responsibility
 * attributions by their trace links. When nothing matches, the verdict
 * is INSUFFICIENT_EVIDENCE — honestly.
 */
export function diagnose(
  events: readonly AuditEventRecord[],
  symptom: SymptomSurface,
  query: DiagnosisQuery = {},
): DiagnosisResult {
  const surfaces = SYMPTOM_SURFACES[symptom];
  const matched = events.filter((event) => {
    const payload = payloadOf(event);
    if (payload === null) return false;
    if (!surfaces.includes(payload.surface)) return false;
    if (!isSymptomKind(payload)) return false;
    if (query.taskId !== undefined && payload.taskId !== query.taskId) return false;
    if (query.bodyId !== undefined && payload.bodyId !== query.bodyId) return false;
    if (query.providerId !== undefined && payload.providerId !== query.providerId) return false;
    if (query.since !== undefined && event.occurred_at < query.since) return false;
    return true;
  });

  const groups = new Map<string, ResponsibilityAttribution>();
  for (const event of matched) {
    const payload = payloadOf(event);
    if (payload === null) continue;
    const key = `${payload.taskId ?? '(no-task)'}|${payload.bodyId ?? '(no-body)'}|${payload.providerId ?? '(no-provider)'}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        taskId: payload.taskId,
        bodyId: payload.bodyId,
        providerId: payload.providerId,
        decisionCount: 1,
        denials: payload.decision === 'DENY' ? 1 : 0,
        redactions: payload.decision === 'REDACT' ? 1 : 0,
        unknowns: payload.decision === 'UNKNOWN' ? 1 : 0,
        surfaces: [payload.surface],
        firstOccurredAt: event.occurred_at,
        lastOccurredAt: event.occurred_at,
      });
      continue;
    }
    const updated: ResponsibilityAttribution = {
      taskId: existing.taskId,
      bodyId: existing.bodyId,
      providerId: existing.providerId,
      decisionCount: existing.decisionCount + 1,
      denials: existing.denials + (payload.decision === 'DENY' ? 1 : 0),
      redactions: existing.redactions + (payload.decision === 'REDACT' ? 1 : 0),
      unknowns: existing.unknowns + (payload.decision === 'UNKNOWN' ? 1 : 0),
      surfaces: existing.surfaces.includes(payload.surface) ? existing.surfaces : [...existing.surfaces, payload.surface],
      firstOccurredAt: earlierOf(existing.firstOccurredAt, event.occurred_at),
      lastOccurredAt: laterOf(existing.lastOccurredAt, event.occurred_at),
    };
    groups.set(key, updated);
  }

  const attributions = [...groups.values()].sort(compareAttributions);
  return {
    query,
    attributions,
    matchedEvents: matched,
    verdict: attributions.length > 0 ? 'ATTRIBUTED' : 'INSUFFICIENT_EVIDENCE',
  };
}

function isSymptomKind(payload: DecisionPayloadShape): boolean {
  return SYMPTOM_KINDS.includes(payload.decision);
}

function earlierOf(a: string | null, b: string): string {
  if (a === null) return b;
  return a < b ? a : b;
}

function laterOf(a: string | null, b: string): string {
  if (a === null) return b;
  return a > b ? a : b;
}

function compareAttributions(a: ResponsibilityAttribution, b: ResponsibilityAttribution): number {
  return (
    b.decisionCount - a.decisionCount ||
    compareNullable(a.taskId, b.taskId) ||
    compareNullable(a.bodyId, b.bodyId) ||
    compareNullable(a.providerId, b.providerId)
  );
}

function compareNullable(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}
