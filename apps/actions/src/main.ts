// ---------------------------------------------------------------------------
// COMPOSITION BOUNDARY (apps/actions only): the ambient tick source lives
// here and nowhere else. The host itself runs on whatever tick/callback
// source the embedder injects.
// ---------------------------------------------------------------------------

import { buildHost } from './composition.js';
import { SystemClock } from './clock.js';

export function startTicker(intervalMilliseconds: number, onTick: () => void): () => void {
  const handle = setInterval(onTick, intervalMilliseconds);
  return () => {
    clearInterval(handle);
  };
}

export function main(): void {
  const host = buildHost(new SystemClock());
  const stopTicker = startTicker(1_000, () => host.onTick());
  for (const status of host.providerStatus()) {
    console.log(`${status.provider}: ${status.status} — ${status.detail}`);
  }
  console.log('actions host ready: authority-gated gateway + independent evaluation online (reference mode)');
  console.log(`ticks delivered so far: ${host.tickCount()}`);
  void stopTicker;
}

main();
