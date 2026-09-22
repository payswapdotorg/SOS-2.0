/**
 * THE SIMULATED IDE INTEGRATION TRANSPORT (Work Order P11) — the
 * deterministic LOCAL REFERENCE RUNTIME behind the IDE bridge.
 *
 * NO real IDE plugin ships in this Work Order: this transport serves the
 * SAME command-dispatch shape with a deterministic document model
 * (document ids are sequences; diagnostics derive deterministically from
 * the path). The `simulated: true` honesty marker is carried on the
 * transport so a simulated connection can never render as a real one
 * (the P4/P8 discipline). A real IDE plugin implements IdeBridgeTransport
 * with simulated: false — attaching later without contract change.
 *
 * Determinism: pure state machine — no clock, no randomness, no network.
 */

import { ideBridgeRequestViolation } from './shapes.js';
import type { IdeBridgeCommand, IdeBridgeReply, IdeBridgeTransport } from './transport.js';
import type { IdeDiagnostic } from './transport.js';
import type { JsonValue } from '@sos-2/semantic-spine';

/**
 * The simulated IDE integration: deterministic openFile/diagnostics over
 * a document model. Requests are validated exactly (a smuggled
 * authority key is an ERROR naming the field — never accepted).
 */
export class SimulatedIdeIntegrationTransport implements IdeBridgeTransport {
  readonly simulated = true;

  private readonly documents = new Map<string, string>();
  private sequence = 0;

  dispatch(command: IdeBridgeCommand): IdeBridgeReply {
    const violation = ideBridgeRequestViolation(command.command, command.body);
    if (violation !== null) {
      return { status: 'ERROR', message: violation };
    }
    const body = command.body as Record<string, unknown>;
    switch (command.command) {
      case 'bridge.ide.openFile': {
        this.sequence += 1;
        const path = String(body['path']);
        const documentId = `doc-${String(this.sequence).padStart(4, '0')}`;
        this.documents.set(documentId, path);
        return { status: 'OK', body: { opened: true, document_id: documentId } };
      }
      case 'bridge.ide.diagnostics': {
        const path = String(body['path']);
        const diagnostics: IdeDiagnostic[] = deterministicDiagnostics(path);
        return { status: 'OK', body: { diagnostics } as unknown as JsonValue };
      }
      default:
        return { status: 'UNKNOWN_COMMAND', message: `no IDE-bridge operation maps to command ${JSON.stringify(command.command)}` };
    }
  }

  /** The opened documents (audit/test probe). */
  openDocuments(): readonly { readonly document_id: string; readonly path: string }[] {
    return [...this.documents.entries()].map(([document_id, path]) => ({ document_id, path }));
  }
}

/** Deterministic fixture diagnostics for a path (no analyzer — honest simulation). */
function deterministicDiagnostics(path: string): IdeDiagnostic[] {
  if (path.endsWith('.ts')) {
    return [
      { severity: 'warning', code: 'sim-unused', message: `simulated diagnostic: unused expression in ${path}`, line: 1 },
    ];
  }
  return [];
}
