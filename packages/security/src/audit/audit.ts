/**
 * The policy audit trail (Work Order P14).
 *
 * EVERY policy decision — allow / deny / redact / unknown — appends a
 * durable audit record THROUGH THE P7 EVENT DISCIPLINE:
 *
 *   - REPLAY-SAFE: every audit record carries a delivery id; duplicate
 *     append is detected and answered with the typed DUPLICATE outcome
 *     (the P2/P7 replay-protection contract), never double-applied;
 *   - CONTENT-ADDRESSED: the record id is the domain-separated content
 *     address of the decision content (the P9 contentAddress
 *     discipline) — identical decisions are idempotent by content;
 *   - NEVER A SECOND SOURCE OF TRUTH: audit events are pre-semantic
 *     observations ABOUT policy decisions. They reference task/body/
 *     provider identities; they never mint authority, never redefine
 *     decisions, and are rebuilt/derivable views over the observation
 *     store — canonical semantics stay in the authoritative domain
 *     stores (Redis/queues are never semantic authorities, §13).
 *
 * The audit event shape is ALIGNED-BY-CONSTRUCTION with the merged P2
 * ObservationEventInput contract (packages/live-store/src/records/
 * observation-event.ts): the exact field set { id, source, kind,
 * occurred_at, payload, provenance } with an RFC3339 occurred_at, a
 * canonical-JSON payload preserved verbatim, and a non-empty provenance
 * chain. The alignment is pinned by the acceptance suite, which reads
 * the merged P2 contract source and asserts field-set and pattern
 * equality, and feeds audit records through the same validation rules.
 *
 * Determinism: the clock is injected; ids are content addresses; no
 * ambient anything.
 */

import { AuditTrailError } from '../errors.js';
import { canonicalJson, contentAddress, epochMsToRfc3339, isJsonValue, RFC3339_PATTERN } from '../types.js';
import type { Clock, JsonValue } from '../types.js';

/** What a policy decided. */
export const POLICY_DECISION_KINDS = ['ALLOW', 'DENY', 'REDACT', 'UNKNOWN'] as const;
export type PolicyDecisionKind = (typeof POLICY_DECISION_KINDS)[number];

/** The surfaces that produce auditable policy decisions. */
export const AUDITED_SURFACES = [
  'workspace-isolation',
  'secret-isolation',
  'credential-scope',
  'budget',
  'rate-limit',
  'provider-health',
  'dead-letter',
  'abuse-containment',
  'deployment-hardening',
] as const;
export type AuditedSurface = (typeof AUDITED_SURFACES)[number];

/** One policy decision entering the audit trail. */
export interface PolicyDecision {
  readonly decision: PolicyDecisionKind;
  readonly surface: AuditedSurface;
  readonly detail: string;
  /** Trace links (§ diagnostics): the responsible task, when known. */
  readonly taskId: string | null;
  /** The responsible body, when a body was involved. */
  readonly bodyId: string | null;
  /** The responsible provider, when a provider was involved. */
  readonly providerId: string | null;
  /** Digest of the evidence the decision was made over, when any. */
  readonly evidenceDigest: string | null;
  /** Extra typed context (canonical-JSON). */
  readonly context: JsonValue;
}

/** The audit event input — the P7-discipline shape (P2 ObservationEventInput field set). */
export interface AuditEventInput {
  /** REQUIRED delivery-level event id (replay-protection key). */
  readonly id: string;
  /** Stable source identifier, e.g. "security-audit:workspace-isolation". */
  readonly source: string;
  /** Event kind — always 'security.audit.decision' for policy decisions. */
  readonly kind: string;
  /** RFC3339 — when the decision occurred (injected clock). */
  readonly occurred_at: string;
  /** Opaque canonical-JSON payload — the decision content, verbatim. */
  readonly payload: JsonValue;
  /** Provenance entries (at least one non-empty string). */
  readonly provenance: readonly string[];
}

/** The stored audit event (input + the clock-stamped receipt). */
export interface AuditEventRecord extends AuditEventInput {
  /** RFC3339 — when the trail accepted the event (injected clock). */
  readonly received_at: string;
}

/** The exact field set of an audit event input (P2 ObservationEventInput). */
export const AUDIT_EVENT_INPUT_FIELDS = ['id', 'source', 'kind', 'occurred_at', 'payload', 'provenance'] as const;

/** The exact field set of a stored audit event record (adds received_at). */
export const AUDIT_EVENT_RECORD_FIELDS = [...AUDIT_EVENT_INPUT_FIELDS, 'received_at'] as const;

/** The canonical audit event kind for policy decisions. */
export const AUDIT_EVENT_KIND = 'security.audit.decision';

/** The typed append outcome (the P2 APPLIED | DUPLICATE discipline). */
export type AuditAppendOutcome =
  | { readonly kind: 'APPLIED'; readonly event: AuditEventRecord }
  | { readonly kind: 'DUPLICATE'; readonly eventId: string; readonly firstReceivedAt: string; readonly event: AuditEventRecord };

/** The audit trail port. Real deployments wire the P7 ingestion pipeline here. */
export interface AuditTrailPort {
  append(event: AuditEventInput): AuditAppendOutcome;
  history(): readonly AuditEventRecord[];
}

/**
 * Validate an audit event input against the P7-discipline rules (the
 * P2 validation contract, same semantics):
 *   - exact field set (no extra fields, none missing);
 *   - id/source/kind non-empty strings;
 *   - occurred_at RFC3339;
 *   - payload a canonical-JSON value;
 *   - provenance a non-empty array of non-empty strings.
 */
export function assertValidAuditEventInput(value: unknown): asserts value is AuditEventInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuditTrailError('audit event must be an object');
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  const expected = AUDIT_EVENT_INPUT_FIELDS as readonly string[];
  if (actual.length !== expected.length || !expected.every((key) => key in record)) {
    throw new AuditTrailError(
      `audit event must have the exact field set { ${expected.join(', ')} } (the P7 observation-event discipline)`,
    );
  }
  if (typeof record['id'] !== 'string' || (record['id'] as string).length === 0) {
    throw new AuditTrailError('audit event id must be a non-empty string');
  }
  if (typeof record['source'] !== 'string' || (record['source'] as string).length === 0) {
    throw new AuditTrailError('audit event source must be a non-empty string');
  }
  if (typeof record['kind'] !== 'string' || (record['kind'] as string).length === 0) {
    throw new AuditTrailError('audit event kind must be a non-empty string');
  }
  if (typeof record['occurred_at'] !== 'string' || !RFC3339_PATTERN.test(record['occurred_at'] as string)) {
    throw new AuditTrailError('audit event occurred_at must be an RFC3339 timestamp');
  }
  if (!isJsonValue(record['payload'])) {
    throw new AuditTrailError('audit event payload must be a canonical-JSON value');
  }
  const provenance = record['provenance'];
  if (
    !Array.isArray(provenance) ||
    provenance.length === 0 ||
    !provenance.every((entry) => typeof entry === 'string' && entry.length > 0)
  ) {
    throw new AuditTrailError('audit event provenance must be a non-empty array of non-empty strings');
  }
}

/**
 * Build the audit event for a policy decision: the id is the
 * CONTENT ADDRESS of the decision content (idempotent by content — the
 * same decision appended twice is the typed DUPLICATE, never a second
 * record), the payload carries the decision verbatim, occurred_at is
 * the injected clock, and provenance names the surface + the contract.
 */
export function auditEventFor(decision: PolicyDecision, clock: Clock): AuditEventInput {
  if (!isJsonValue(decision.context)) {
    throw new AuditTrailError('policy decision context must be a canonical-JSON value');
  }
  if (typeof decision.detail !== 'string') {
    throw new AuditTrailError('policy decision detail must be a string');
  }
  const payload: JsonValue = {
    decision: decision.decision,
    surface: decision.surface,
    detail: decision.detail,
    taskId: decision.taskId,
    bodyId: decision.bodyId,
    providerId: decision.providerId,
    evidenceDigest: decision.evidenceDigest,
    context: decision.context,
  };
  const id = contentAddress(payload, 'security-audit');
  return {
    id,
    source: `security-audit:${decision.surface}`,
    kind: AUDIT_EVENT_KIND,
    occurred_at: epochMsToRfc3339(clock.now()),
    payload,
    provenance: [
      'sos-2/security:audit-trail',
      `policy-surface:${decision.surface}`,
      'discipline:P7-observation-event',
    ],
  };
}

/**
 * The deterministic in-memory reference audit trail. Replay protection
 * is DURABLE within the trail: the FIRST append of an id is APPLIED;
 * every later append of the same id answers the typed DUPLICATE with
 * the first receipt time — never double-applied. Real deployments wire
 * the same semantics onto the P7 ingestion pipeline (the port above).
 */
export class InMemoryAuditTrail implements AuditTrailPort {
  private readonly clock: Clock;
  private readonly events: AuditEventRecord[] = [];
  private readonly firstReceivedAt: Map<string, string> = new Map();

  constructor(clock: Clock) {
    this.clock = clock;
  }

  append(event: AuditEventInput): AuditAppendOutcome {
    assertValidAuditEventInput(event);
    const existing = this.firstReceivedAt.get(event.id);
    if (existing !== undefined) {
      const stored = this.events.find((candidate) => candidate.id === event.id);
      if (stored === undefined) {
        throw new AuditTrailError(`audit trail index inconsistent for ${event.id}`);
      }
      return { kind: 'DUPLICATE', eventId: event.id, firstReceivedAt: existing, event: stored };
    }
    const record: AuditEventRecord = { ...event, received_at: epochMsToRfc3339(this.clock.now()) };
    this.events.push(record);
    this.firstReceivedAt.set(event.id, record.received_at);
    return { kind: 'APPLIED', event: record };
  }

  history(): readonly AuditEventRecord[] {
    return [...this.events];
  }
}

/**
 * Convenience: append the audit event for a policy decision (content-
 * addressed id, replay-protected append). Returns the typed outcome.
 */
export function auditDecision(trail: AuditTrailPort, decision: PolicyDecision, clock: Clock): AuditAppendOutcome {
  return trail.append(auditEventFor(decision, clock));
}

/** Canonical JSON for a payload (exposed for wiring diagnostics). */
export function auditCanonicalJson(value: JsonValue): string {
  return canonicalJson(value);
}
