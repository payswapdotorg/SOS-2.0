/**
 * Browser-bridge contract tests (Work Order P11): typed ports over
 * injectable transports, exact-shape validation (the anti-smuggling
 * rule), honest NOT_YET_CONNECTED, and truthful FAILED on malformed
 * replies.
 */

import { describe, expect, it } from 'vitest';
import { BrowserBridgeAdapter } from '../src/index.js';
import { SimulatedBrowserExtensionTransport } from '../src/index.js';
import { browserBridgeRequestViolation, browserBridgeReplyValueViolation } from '../src/index.js';
import type { BrowserBridgeTransport } from '../src/index.js';
import type { BrowserInteractRequest, BrowserOpenRequest } from '@sos-2/harness';

function simulatedBridge(): BrowserBridgeAdapter {
  return new BrowserBridgeAdapter({
    bridgeId: 'browser-bridge-reference',
    provider: { name: 'reference-browser-extension', version: '1.0.0' },
    transport: new SimulatedBrowserExtensionTransport(),
  });
}

describe('browser bridge: typed ports over the injectable transport', () => {
  it('serves browser.open and browser.interact through the simulated extension (deterministic page ids)', () => {
    const bridge = simulatedBridge();
    const open = bridge.open({ task_ref: 'task-browser-0001', url: 'https://example.com/docs' } satisfies BrowserOpenRequest);
    expect(open.status).toBe('OK');
    if (open.status === 'OK') {
      expect(open.value.page_id).toBe('page-0001');
      expect(open.value.url).toBe('https://example.com/docs');
      expect(open.value.title).toBe('simulated page: example.com');
    }
    const interact = bridge.interact({
      task_ref: 'task-browser-0001',
      page_id: 'page-0001',
      action: 'read',
      target: 'body',
      value: null,
    } satisfies BrowserInteractRequest);
    expect(interact.status).toBe('OK');
    if (interact.status === 'OK') {
      expect(interact.value.result).toEqual({ text: 'simulated fixture content for https://example.com/docs' });
    }
  });

  it('a malformed transport reply is a truthful FAILED — never a silent success', () => {
    const malformed: BrowserBridgeTransport = {
      simulated: true,
      dispatch: () => ({ status: 'OK', body: { page_id: 'page-0001' } }), // missing url + title
    };
    const bridge = new BrowserBridgeAdapter({
      bridgeId: 'browser-bridge-malformed',
      provider: { name: 'malformed-transport', version: '1.0.0' },
      transport: malformed,
    });
    const open = bridge.open({ task_ref: 'task-browser-0002', url: 'https://example.com' } satisfies BrowserOpenRequest);
    expect(open.status).toBe('FAILED');
    if (open.status === 'FAILED') {
      expect(open.error).toContain('malformed transport reply');
      expect(open.error).toContain('never a silent success');
    }
  });
});

describe('browser bridge: the seam carries NO authority', () => {
  it('a smuggled grant key in the request is a typed violation NAMING the field', () => {
    const violation = browserBridgeRequestViolation('bridge.browser.open', { task_ref: 'task-x', url: 'https://example.com', grant: 'sos://AuthorityGrant/xyz' });
    expect(violation).toContain('"grant"');
    expect(violation).toContain('NO AUTHORITY');
    expect(violation).toContain('never an SOS authority');
  });

  it('a smuggled permission key fails the adapter dispatch truthfully', () => {
    const bridge = simulatedBridge();
    const smuggled = { task_ref: 'task-browser-0003', url: 'https://example.com', permission: 'WRITE' } as unknown as BrowserOpenRequest;
    const open = bridge.open(smuggled);
    expect(open.status).toBe('FAILED');
    if (open.status === 'FAILED') {
      expect(open.error).toContain('"permission"');
      expect(open.error).toContain('NO AUTHORITY');
    }
  });

  it('a smuggled authority key in a REPLY is a typed violation naming the field', () => {
    const violation = browserBridgeReplyValueViolation('bridge.browser.interact', { result: null, authority: 'grant-everything' });
    expect(violation).toContain('"authority"');
    expect(violation).toContain('NO AUTHORITY');
  });

  it('the transport itself refuses smuggled commands (the simulated extension validates too)', () => {
    const transport = new SimulatedBrowserExtensionTransport();
    const reply = transport.dispatch({ command: 'bridge.browser.open', body: { task_ref: 't', url: 'https://example.com', grant: 'x' } });
    expect(reply.status).toBe('ERROR');
    if (reply.status === 'ERROR') {
      expect(reply.message).toContain('"grant"');
    }
  });
});

describe('browser bridge: honest statuses are never fabricated', () => {
  it('NOT_YET_CONNECTED while no real extension exists (null transport); operations fail truthfully', () => {
    const bridge = new BrowserBridgeAdapter({
      bridgeId: 'browser-bridge-absent',
      provider: { name: 'no-extension', version: '1.0.0' },
      transport: null,
    });
    const descriptor = bridge.descriptor();
    expect(descriptor.tier).toBe('extension');
    expect(descriptor.connection.status).toBe('NOT_YET_CONNECTED');
    expect(descriptor.connection.simulated).toBe(false);
    const open = bridge.open({ task_ref: 'task-browser-0004', url: 'https://example.com' } satisfies BrowserOpenRequest);
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
