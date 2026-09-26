/**
 * The shared deterministic runner of the live data-plane suites (Work
 * Order P18-A): composes the REAL data plane (apps/web/live-data — the
 * same module the app seam calls) over the scripted world, with the
 * ManualClock and the injectable seams. Deterministic: offline, fixed
 * seed, run-to-run identical.
 */

import { ManualClock } from '@sos-2/live-store';
import { runLiveDataPlane } from '@live-data/data-plane';
import type { LiveDataPlaneResult } from '@live-data/data-plane';
import { defaultKnobs, scriptedSource, scriptedWorld, instantSleep } from './world';
import type { ScriptedKnobs, ScriptedWorld } from './world';

export interface ScriptedRun {
  readonly result: LiveDataPlaneResult;
  readonly world: ScriptedWorld;
  readonly clock: ManualClock;
}

/** The drain instant of the scripted scenarios (2026-09-25T12:00:00.000Z). */
export function worldNow(): number {
  return Date.parse('2026-09-25T12:00:00Z');
}

/** Run one bounded data-plane pass over a fresh scripted world. */
export async function runPlane(knobs: Partial<ScriptedKnobs> = {}, options?: { readonly freshAfterMs?: number }): Promise<ScriptedRun> {
  const world = scriptedWorld({ ...defaultKnobs(), ...knobs });
  const clock = new ManualClock(worldNow());
  const result = await runLiveDataPlane({
    source: scriptedSource(),
    clock,
    fetch: world.fetch,
    sleep: instantSleep,
    ...(options?.freshAfterMs !== undefined ? { freshAfterMs: options.freshAfterMs } : {}),
  });
  return { result, world, clock };
}

/**
 * Re-run the data plane over the SAME world + clock (the replay
 * discipline: same instants, same events, same durable row state). The
 * knobs argument flips the world's scenario between runs (the advanced
 * reconciliation run serves a new head).
 */
export async function rerunPlane(run: ScriptedRun, knobs?: Partial<ScriptedKnobs>, options?: { readonly freshAfterMs?: number }): Promise<ScriptedRun> {
  if (knobs !== undefined) {
    run.world.knobs = { ...run.world.knobs, ...knobs };
  }
  const result = await runLiveDataPlane({
    source: scriptedSource(),
    clock: run.clock,
    fetch: run.world.fetch,
    sleep: instantSleep,
    ...(options?.freshAfterMs !== undefined ? { freshAfterMs: options.freshAfterMs } : {}),
  });
  return { result, world: run.world, clock: run.clock };
}
