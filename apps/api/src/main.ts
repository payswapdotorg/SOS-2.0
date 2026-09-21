/**
 * The CLI composition root (Work Order P2) — the ONLY place a real clock
 * and the environment are consulted. The deterministic core (router +
 * server) takes injected clocks/stores/ports; this entry wires the real
 * ones for a plain `node dist/main.js` run.
 *
 * Reference mode: the in-memory live store (the provider-neutral ports
 * with in-memory reference adapters). Production Neon/Upstash/R2 adapters
 * attach to the SAME facade without contract change in later waves.
 */

import { createInMemoryLiveStore } from '@sos-2/live-store';
import type { Clock } from '@sos-2/live-store';
import { DEFAULT_API_PORT, startApiServer } from './server.js';

function main(): void {
  const clock: Clock = {
    now(): string {
      return new Date().toISOString();
    },
  };
  const port = Number(process.env['API_PORT'] ?? DEFAULT_API_PORT);
  const store = createInMemoryLiveStore({ clock });
  const server = startApiServer({ store, clock, port });
  server.ready.then((bound) => {
    process.stdout.write(
      `SOS 2.0 live API (reference mode) listening on 127.0.0.1:${bound}\n` +
        'routes: GET /api/health | GET/PUT /api/{mission,system-state,evidence,task,body-lease} | GET/POST /api/observation/events\n',
    );
  });
}

main();
