/**
 * @sos-2/api — the SOS 2.0 Live API service (Work Order P2).
 *
 * A plain Node process (repo-standard ESM + tsc build, no vendor
 * framework) implementing @sos-2/api-contracts over @sos-2/live-store:
 *
 *   GET  /health                       typed per-provider availability
 *   GET  /mission                      list (seek pagination)
 *   GET  /mission/:id                  read (revision headers)
 *   PUT  /mission                      write (idempotent, CAS, typed conflicts)
 *   ... same for /system-state, /evidence, /task, /body-lease, /observation
 *   POST /events                       event ingestion (replay protection)
 *
 * The request handler is transport-agnostic (plain ApiRequest ->
 * ApiResponse) so a later Vercel-functions or external-worker host adapts
 * its own transport onto the same contract WITHOUT change. No
 * long-running work inside the request lifetime.
 *
 * Composition root (the only impure boundary, mirroring apps/console):
 * SystemClock + port are injected here; everything deeper is deterministic.
 */

export * from './handler.js';
export * from './service.js';
export * from './system-clock.js';

import { fileURLToPath } from 'node:url';
import { createApiService } from './service.js';

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const port = Number(process.env['API_PORT'] ?? 8788);
  const service = createApiService({ port });
  service.ready.then((bound) => {
    console.log(`SOS 2.0 Live API (P2) listening on http://localhost:${bound}`);
    console.log('In-memory reference backend (durable provider adapters attach in later waves without contract change).');
    console.log('Routes: GET /health | GET|PUT /mission /system-state /evidence /task /body-lease /observation | GET /<resource>/:id | POST /events');
  });
}
