/**
 * The SOS 2.0 Human Console server (Work Order W11).
 *
 * A minimal node:http application rendering semantic HTML from the W11
 * view-models — deterministic (same fixture -> byte-identical pages), zero
 * network, zero hidden state. All domain behavior comes from the
 * @sos-2/* workspace packages; all projections from @sos-2/ui-contracts.
 *
 * Run: pnpm --filter @sos-2/console dev   (default port 8787, override
 * with CONSOLE_PORT).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVIDENCE_TRUTH_STATES } from '@sos-2/semantic-spine';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import type { DemoWorld } from './demo/build-demo.js';
import { assembleViews } from './views.js';
import type { EvidenceQuery } from './views.js';
import { createMissionFromForm } from './journeys.js';
import {
  renderAsk,
  renderAssurance,
  renderCandidates,
  renderEvidence,
  renderEvolution,
  renderHistory,
  renderImport,
  renderMission,
  renderOverview,
  renderPackages,
  renderRationale,
  renderReconciliation,
  renderRollback,
  renderExperiments,
} from './render/pages.js';

const DEFAULT_PORT = 8787;
const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '..', 'fixtures', 'demo.json');

function loadWorld(): DemoWorld {
  const raw = readFileSync(fixturePath, 'utf8');
  return JSON.parse(raw) as DemoWorld;
}

/** Parse an urlencoded form body (the only input format the console accepts). */
function readFormBody(request: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    request.on('error', reject);
  });
}

function html(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  response.end(body);
}

function evidenceQueryOf(params: URLSearchParams): EvidenceQuery {
  const subject = params.get('subject');
  const states = params
    .getAll('truth_state')
    .filter((state): state is EvidenceTruthState =>
      (EVIDENCE_TRUTH_STATES as readonly string[]).includes(state),
    );
  return {
    subject: subject === null || subject === '' ? null : subject,
    truth_states: states.length === 0 ? null : states,
  };
}

export interface ConsoleServer {
  /** The requested port (the actual bound port resolves from `ready`). */
  port: number;
  /** Resolves with the actual bound port once the server listens. */
  ready: Promise<number>;
  close: () => Promise<void>;
}

/** Start the console server (deterministic rendering from the fixture). */
export function startConsole(options?: { port?: number; world?: DemoWorld; listen?: boolean }): ConsoleServer {
  const world = options?.world ?? loadWorld();
  const views = assembleViews(world);
  const port = options?.port ?? Number(process.env['CONSOLE_PORT'] ?? DEFAULT_PORT);

  const knownSubjects = new Set(world.links.flatMap((link) => [link.source, link.target]));

  const server = createServer((request, response) => {
    void handle(request, response).catch((cause: unknown) => {
      html(
        response,
        500,
        `<!DOCTYPE html><html><body><h1>Console error</h1><pre>${String(cause instanceof Error ? cause.message : cause)}</pre></body></html>`,
      );
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://console.local');
    const path = url.pathname;
    const method = request.method ?? 'GET';

    if (method === 'GET' || method === 'HEAD') {
      if (path === '/') {
        return html(response, 200, renderOverview(views));
      }
      if (path === '/mission') {
        return html(response, 200, renderMission(views, null, null));
      }
      if (path === '/import') {
        return html(response, 200, renderImport(views, '', null, null));
      }
      if (path === '/reconciliation') {
        return html(response, 200, renderReconciliation(views));
      }
      if (path === '/evidence') {
        return html(response, 200, renderEvidence(views, evidenceQueryOf(url.searchParams)));
      }
      if (path === '/candidates') {
        return html(response, 200, renderCandidates(views));
      }
      if (path === '/assurance') {
        return html(response, 200, renderAssurance(views));
      }
      if (path === '/experiments') {
        return html(response, 200, renderExperiments(views));
      }
      if (path === '/ask') {
        return html(response, 200, renderAsk(views));
      }
      if (path === '/rollback') {
        return html(response, 200, renderRollback(views));
      }
      if (path === '/packages') {
        return html(response, 200, renderPackages(views));
      }
      if (path === '/history') {
        return html(response, 200, renderHistory(views));
      }
      if (path === '/evolution') {
        return html(response, 200, renderEvolution(views));
      }
      if (path === '/rationale') {
        const id = url.searchParams.get('id') ?? '';
        if (!knownSubjects.has(id)) {
          return html(response, 404, renderRationale(views, id, false));
        }
        return html(response, 200, renderRationale(views, id, true));
      }
      return html(
        response,
        404,
        `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Not found — SOS 2.0 Console</title></head><body><h1>404 — no such journey</h1><p><a href="/">Back to the overview</a></p></body></html>`,
      );
    }

    if (method === 'POST') {
      const form = await readFormBody(request);
      if (path === '/mission') {
        const result = createMissionFromForm(
          {
            purpose: form.get('purpose') ?? '',
            goal: form.get('goal') ?? '',
            measure_description: form.get('measure_description') ?? '',
            measure_target: form.get('measure_target') ?? '',
            constraint: form.get('constraint') ?? '',
            provenance: form.get('provenance') ?? '',
            created_at: form.get('created_at') ?? views.world.now,
          },
          views.world.constitution_id,
        );
        if ('error' in result) {
          return html(response, 200, renderMission(views, null, result.error));
        }
        return html(response, 200, renderMission(views, result.vm, null));
      }
      if (path === '/import') {
        const pasted = form.get('model') ?? '';
        let parsed: unknown;
        try {
          parsed = JSON.parse(pasted);
        } catch (cause) {
          return html(
            response,
            200,
            renderImport(views, pasted, null, `not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`),
          );
        }
        if (!views.isModel(parsed)) {
          return html(
            response,
            200,
            renderImport(views, pasted, null, 'the value does not match the ImplementationModel contract (id, revision, components, source_artifacts, interfaces, dependencies, tests, builds, deployments, runtime_mappings)'),
          );
        }
        return html(response, 200, renderImport(views, pasted, views.importModel(parsed), null));
      }
      return html(
        response,
        404,
        `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Not found — SOS 2.0 Console</title></head><body><h1>404 — no such journey</h1><p><a href="/">Back to the overview</a></p></body></html>`,
      );
    }

    response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('method not allowed');
  }

  const ready =
    options?.listen === false
      ? Promise.resolve(port)
      : new Promise<number>((resolve, reject) => {
          server.once('error', reject);
          server.listen(port, () => {
            const address = server.address();
            resolve(typeof address === 'object' && address !== null ? address.port : port);
          });
        });

  return {
    port,
    ready,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((cause) => (cause === undefined ? resolve() : reject(cause)));
      }),
  };
}

// Entry point (node dist/server.js)
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const console_ = startConsole();
  console_.ready.then((bound) => {
    console.log(`SOS 2.0 Human Console (W11) listening on http://localhost:${bound}`);
    console.log(`Deterministic demo fixture: ${fixturePath}`);
  });
}
