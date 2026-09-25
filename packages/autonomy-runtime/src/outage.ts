/**
 * Provider outages, bounded backoff and ASK exhaustion (Work Order P12).
 *
 * Outage windows are TYPED events with truthful unavailability statuses —
 * never silent retry storms: while a provider's outage window is OPEN,
 * its status is the typed UNAVAILABLE (a fact about the window, not a
 * guess about the provider's internals), and every retry the runtime
 * schedules is a typed, durable-recorded RetryRecord.
 *
 * Recovery follows BOUNDED backoff (a fixed schedule, bounded attempts);
 * when the bounds are exhausted the runtime STOPS retrying and escalates
 * an ASK (the P9 repair-loop discipline: bounded repair, then ASK —
 * never an infinite silent loop).
 */

import { AutonomyRuntimeError } from './errors.js';

export const PROVIDER_AVAILABILITY_STATES = ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'] as const;

export type ProviderAvailabilityState = (typeof PROVIDER_AVAILABILITY_STATES)[number];

/** A typed provider outage window. */
export interface OutageWindow {
  readonly provider: string;
  /** When the window opened (RFC3339). */
  readonly opened_at: string;
  /** When the window closed (RFC3339), or null while OPEN. */
  readonly closed_at: string | null;
  readonly status: 'OPEN' | 'CLOSED';
  /** Honest detail of the window (never fabricated liveness). */
  readonly detail: string;
}

/** The typed availability view of one provider. */
export interface ProviderStatusView {
  readonly provider: string;
  readonly state: ProviderAvailabilityState;
  readonly detail: string;
  /** The open outage window backing an UNAVAILABLE verdict, or null. */
  readonly open_window: OutageWindow | null;
}

/** The outage registry port (provider-neutral; the composition wires the durable surface). */
export interface OutageRegistry {
  /** Open an outage window for a provider (idempotent per provider: an already-open window returns as-is). */
  open(provider: string, at: string, detail: string): OutageWindow;
  /** Close the open outage window of a provider (no-op + null when none is open). */
  close(provider: string, at: string): OutageWindow | null;
  /** The open window of a provider, or null. */
  openWindowOf(provider: string): OutageWindow | null;
}

/** The deterministic in-memory outage registry (reference implementation). */
export class InMemoryOutageRegistry implements OutageRegistry {
  private readonly windows = new Map<string, OutageWindow>();

  open(provider: string, at: string, detail: string): OutageWindow {
    const existing = this.windows.get(provider);
    if (existing !== undefined && existing.status === 'OPEN') return existing;
    const window: OutageWindow = { provider, opened_at: at, closed_at: null, status: 'OPEN', detail };
    this.windows.set(provider, window);
    return window;
  }

  close(provider: string, at: string): OutageWindow | null {
    const existing = this.windows.get(provider);
    if (existing === undefined || existing.status === 'CLOSED') return null;
    const closed: OutageWindow = { ...existing, closed_at: at, status: 'CLOSED' };
    this.windows.set(provider, closed);
    return closed;
  }

  openWindowOf(provider: string): OutageWindow | null {
    const existing = this.windows.get(provider);
    return existing !== undefined && existing.status === 'OPEN' ? existing : null;
  }
}

/** Compute the honest availability view of one provider (pure). */
export function providerStatusOf(registry: OutageRegistry, provider: string): ProviderStatusView {
  const open = registry.openWindowOf(provider);
  if (open !== null) {
    return { provider, state: 'UNAVAILABLE', detail: `outage window open since ${open.opened_at}: ${open.detail}`, open_window: open };
  }
  return { provider, state: 'AVAILABLE', detail: 'no outage window is open (observed fact — internal provider health is never claimed)', open_window: null };
}

/** A typed retry record (every scheduled retry is recorded — never silent). */
export interface RetryRecord {
  readonly attempt: number;
  /** When the retry was scheduled (RFC3339). */
  readonly at: string;
  /** The backoff delay before the retry (ms; from the fixed schedule). */
  readonly delay_ms: number;
  /** The bounded policy state after this retry. */
  readonly exhausted: boolean;
}

/** The bounded retry policy (fixed schedule; fail-closed bounds). */
export interface RetryPolicy {
  /** The fixed backoff schedule (ms) — one entry per permitted attempt. */
  readonly backoffScheduleMs: readonly number[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { backoffScheduleMs: [1_000, 4_000, 16_000, 64_000] };

/** The ASK receipt when retry bounds are exhausted (the P9 discipline). */
export interface ExhaustedAsk {
  readonly ask_id: string;
  readonly subject: string;
  readonly reason: string;
  readonly attempts: number;
}

/** The sink exhausted retries escalate to (ASK is first-class — a success state, never an error swallowed). */
export interface AskSink {
  submitAsk(ask: ExhaustedAsk): { readonly accepted: boolean };
}

/** The in-memory ask sink (reference; the composition wires the real ASK surface). */
export class InMemoryAskSink implements AskSink {
  readonly asks: ExhaustedAsk[] = [];

  submitAsk(ask: ExhaustedAsk): { readonly accepted: boolean } {
    this.asks.push({ ...ask });
    return { accepted: true };
  }
}

export type BackoffDecision =
  | { readonly kind: 'RETRY'; readonly record: RetryRecord }
  | { readonly kind: 'ASK'; readonly ask: ExhaustedAsk };

/**
 * The bounded backoff controller: `next()` decides the next action after
 * a failed attempt — a typed RETRY with a fixed-schedule delay, or the
 * terminal ASK when the schedule is exhausted. NEVER an infinite loop,
 * NEVER an unrecorded retry.
 */
export class BackoffRetryController {
  private attempts = 0;

  constructor(
    private readonly policy: RetryPolicy,
    private readonly subject: string,
    private readonly asks: AskSink,
  ) {
    if (policy.backoffScheduleMs.length === 0) {
      throw new AutonomyRuntimeError('OUTAGE_POLICY', 'the backoff schedule must carry at least one entry (a zero bound is a configuration error)');
    }
  }

  attemptCount(): number {
    return this.attempts;
  }

  /** Decide after a failure: the next scheduled retry, or the ASK. */
  next(at: string): BackoffDecision {
    if (this.attempts >= this.policy.backoffScheduleMs.length) {
      const ask: ExhaustedAsk = {
        ask_id: `backoff-ask:${this.subject}:${this.attempts}`,
        subject: this.subject,
        reason: `retry bounds exhausted after ${this.attempts} attempts (fixed schedule of ${this.policy.backoffScheduleMs.length}) — escalating ASK instead of retrying forever`,
        attempts: this.attempts,
      };
      this.asks.submitAsk(ask);
      return { kind: 'ASK', ask };
    }
    const delay = this.policy.backoffScheduleMs[this.attempts]!;
    this.attempts += 1;
    const record: RetryRecord = {
      attempt: this.attempts,
      at,
      delay_ms: delay,
      exhausted: this.attempts >= this.policy.backoffScheduleMs.length,
    };
    return { kind: 'RETRY', record };
  }
}
