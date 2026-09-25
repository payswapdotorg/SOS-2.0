/**
 * The worker heartbeat contract (Work Order P12).
 *
 * Worker heartbeats are an INJECTABLE seam: the runtime never observes
 * liveness directly (no network, no process probing) — a BeatSource
 * answers "when did this body last beat?" with an epoch-ms instant (or
 * null when the body has never beaten). The reference implementation is
 * a deterministic manual source the tests drive; real providers attach
 * later as adapters behind the same port without contract change.
 *
 * Truthfulness rule: a MISSING beat is NOT evidence of death. The
 * supervisor uses beats only to compute freshness; the transition to
 * LOST requires a VERIFIED failure observation (see verification.ts).
 */

/** The heartbeat source port (epoch milliseconds; null = never beat). */
export interface BeatSource {
  lastBeatAt(bodyId: string): number | null;
}

/**
 * The deterministic manual beat source: beats are caller-recorded at
 * caller-supplied instants (the injected-clock discipline — the source
 * never reads time on its own).
 */
export class ManualBeatSource implements BeatSource {
  private readonly beats = new Map<string, number>();

  /** Record a beat for a body at an instant (idempotent — the LATEST instant wins). */
  beat(bodyId: string, atEpochMs: number): void {
    if (typeof bodyId !== 'string' || bodyId.length === 0) {
      throw new TypeError(`beat bodyId must be a non-empty string, received: ${JSON.stringify(bodyId)}`);
    }
    if (!Number.isFinite(atEpochMs)) {
      throw new TypeError(`beat instant must be finite, received: ${JSON.stringify(atEpochMs)}`);
    }
    const prior = this.beats.get(bodyId);
    this.beats.set(bodyId, prior === undefined ? Math.trunc(atEpochMs) : Math.max(prior, Math.trunc(atEpochMs)));
  }

  /** ForgetBody wipes the recorded beats for one body (the simulation hook for "body gone"). */
  forgetBody(bodyId: string): void {
    this.beats.delete(bodyId);
  }

  lastBeatAt(bodyId: string): number | null {
    return this.beats.get(bodyId) ?? null;
  }
}
