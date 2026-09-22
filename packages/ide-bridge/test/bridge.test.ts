/**
 * IDE-bridge contract tests (Work Order P11): typed ports over injectable
 * transports, exact-shape validation (the anti-smuggling rule), honest
 * NOT_YET_CONNECTED, and truthful FAILED on malformed replies.
 */

import { describe, expect, it } from 'vitest';
import { IdeBridgeAdapter, SimulatedIdeIntegrationTransport } from '../src/index.js';
import { ideBridgeRequestViolation, ideBridgeReplyValueViolation } from '../src/index.js';
import type { IdeBridgeTransport } from '../src/index.js';

function simulatedBridge(): IdeBridgeAdapter {
  return new IdeBridgeAdapter({
    bridgeId: 'ide-bridge-reference',
    provider: { name: 'reference-ide-integration', version: '1.0.0' },
    transport: new SimulatedIdeIntegrationTransport(),
  });
}

describe('IDE bridge: typed ports over the injectable transport', () => {
  it('serves openFile and diagnostics through the simulated integration (deterministic document ids)', () => {
    const bridge = simulatedBridge();
    const open = bridge.openFile({ task_ref: 'task-ide-0001', path: 'acme/src/main.ts' });
    expect(open.status).toBe('OK');
    if (open.status === 'OK') {
      expect(open.value.opened).toBe(true);
      expect(open.value.document_id).toBe('doc-0001');
    }
    const diagnostics = bridge.diagnostics({ task_ref: 'task-ide-0001', path: 'acme/src/main.ts' });
    expect(diagnostics.status).toBe('OK');
    if (diagnostics.status === 'OK') {
      expect(diagnostics.value.diagnostics.length).toBe(1);
      expect(diagnostics.value.diagnostics[0]?.severity).toBe('warning');
    }
  });

  it('a malformed transport reply is a truthful FAILED — never a silent success', () => {
    const malformed: IdeBridgeTransport = {
      simulated: true,
      dispatch: () => ({ status: 'OK', body: { opened: true } }), // missing document_id
    };
    const bridge = new IdeBridgeAdapter({
      bridgeId: 'ide-bridge-malformed',
      provider: { name: 'malformed-transport', version: '1.0.0' },
      transport: malformed,
    });
    const open = bridge.openFile({ task_ref: 'task-ide-0002', path: 'acme/src/main.ts' });
    expect(open.status).toBe('FAILED');
    if (open.status === 'FAILED') {
      expect(open.error).toContain('malformed transport reply');
      expect(open.error).toContain('never a silent success');
    }
  });
});

describe('IDE bridge: the seam carries NO authority', () => {
  it('a smuggled grant key in the request is a typed violation NAMING the field', () => {
    const violation = ideBridgeRequestViolation('bridge.ide.openFile', { task_ref: 'task-x', path: 'a.ts', grant: 'sos://AuthorityGrant/xyz' });
    expect(violation).toContain('"grant"');
    expect(violation).toContain('NO AUTHORITY');
    expect(violation).toContain('never an SOS authority');
  });

  it('a smuggled permission key fails the adapter dispatch truthfully', () => {
    const bridge = simulatedBridge();
    const smuggled = { task_ref: 'task-ide-0003', path: 'acme/src/main.ts', permission: 'WRITE' };
    const open = bridge.openFile(smuggled);
    expect(open.status).toBe('FAILED');
    if (open.status === 'FAILED') {
      expect(open.error).toContain('"permission"');
      expect(open.error).toContain('NO AUTHORITY');
    }
  });

  it('a smuggled authority key in a REPLY is a typed violation naming the field', () => {
    const violation = ideBridgeReplyValueViolation('bridge.ide.diagnostics', { diagnostics: [], authority: 'grant-everything' });
    expect(violation).toContain('"authority"');
    expect(violation).toContain('NO AUTHORITY');
  });

  it('the transport itself refuses smuggled commands (the simulated integration validates too)', () => {
    const transport = new SimulatedIdeIntegrationTransport();
    const reply = transport.dispatch({ command: 'bridge.ide.openFile', body: { task_ref: 't', path: 'a.ts', grant: 'x' } });
    expect(reply.status).toBe('ERROR');
    if (reply.status === 'ERROR') {
      expect(reply.message).toContain('"grant"');
    }
  });
});

describe('IDE bridge: honest statuses are never fabricated', () => {
  it('NOT_YET_CONNECTED while no real IDE integration exists (null transport); operations fail truthfully', () => {
    const bridge = new IdeBridgeAdapter({
      bridgeId: 'ide-bridge-absent',
      provider: { name: 'no-integration', version: '1.0.0' },
      transport: null,
    });
    const descriptor = bridge.descriptor();
    expect(descriptor.tier).toBe('extension');
    expect(descriptor.connection.status).toBe('NOT_YET_CONNECTED');
    expect(descriptor.connection.simulated).toBe(false);
    const open = bridge.openFile({ task_ref: 'task-ide-0004', path: 'acme/src/main.ts' });
    expect(open.status).toBe('FAILED');
    if (open.status === 'FAILED') {
      expect(open.error).toContain('NOT_YET_CONNECTED');
      expect(open.error).toContain('never fabricated');
    }
  });

  it('the simulated reference transport carries the explicit simulated marker', () => {
    const bridge = simulatedBridge();
    const connection = bridge.connection();
    expect(connection.status).toBe('CONNECTED');
    expect(connection.simulated).toBe(true);
    expect(connection.note).toContain('SIMULATED');
  });
});
