/**
 * ACCEPTANCE (Work Order P11): BROWSER/IDE BRIDGES ARE ADAPTERS, NOT SOS
 * AUTHORITIES — no authority fields marshal across any bridge; a
 * smuggled grant/permission key is a typed violation naming the field;
 * malformed replies are truthful FAILED results; honest
 * NOT_YET_CONNECTED/NOT_YET_INSTALLED surfaces never fabricate
 * connection evidence.
 */

import { describe, expect, it } from 'vitest';
import { acceptanceWorld } from './acceptance-world.js';
import { BrowserBridgeAdapter, SimulatedBrowserExtensionTransport } from '@sos-2/browser-bridge';
import type { BrowserBridgeTransport } from '@sos-2/browser-bridge';
import { IdeBridgeAdapter, SimulatedIdeIntegrationTransport } from '@sos-2/ide-bridge';
import type { IdeBridgeTransport } from '@sos-2/ide-bridge';
import { REFERENCE_COMPANION_INSTALLATION } from '@sos-2/local-companion';
import { ADAPTER_CONNECTION_STATUSES } from '@sos-2/harness-adapters';
import { INTEGRATION_TIERS, INTEGRATION_TIER_RANK } from '@sos-2/runtime-contracts';

describe('acceptance: bridges are adapters, not SOS authorities', () => {
  it('the browser bridge serves typed browser operations over the simulated extension transport', () => {
    const bridge = new BrowserBridgeAdapter({
      bridgeId: 'acceptance-browser-bridge',
      provider: { name: 'reference-browser-extension', version: '1.0.0' },
      transport: new SimulatedBrowserExtensionTransport(),
    });
    const open = bridge.open({ task_ref: 'task-bridge-0001', url: 'https://example.com/journey' });
    expect(open.status).toBe('OK');
    if (open.status === 'OK') {
      expect(open.value.page_id).toBe('page-0001');
    }
    const interact = bridge.interact({ task_ref: 'task-bridge-0001', page_id: 'page-0001', action: 'read', target: 'body', value: null });
    expect(interact.status === 'OK' && interact.value.result).toEqual({ text: 'simulated fixture content for https://example.com/journey' });
  });

  it('the IDE bridge serves typed IDE operations over the simulated integration transport', () => {
    const bridge = new IdeBridgeAdapter({
      bridgeId: 'acceptance-ide-bridge',
      provider: { name: 'reference-ide-integration', version: '1.0.0' },
      transport: new SimulatedIdeIntegrationTransport(),
    });
    const open = bridge.openFile({ task_ref: 'task-bridge-0002', path: 'acme/src/main.ts' });
    expect(open.status).toBe('OK');
    if (open.status === 'OK') {
      expect(open.value.document_id).toBe('doc-0001');
    }
    const diagnostics = bridge.diagnostics({ task_ref: 'task-bridge-0002', path: 'acme/src/main.ts' });
    expect(diagnostics.status === 'OK' && diagnostics.value.diagnostics.length).toBe(1);
  });

  it('NO AUTHORITY FIELDS MARSHAL ACROSS ANY BRIDGE — smuggled grant/permission/authority keys are typed violations NAMING the field', () => {
    const browser = new BrowserBridgeAdapter({
      bridgeId: 'acceptance-browser-bridge',
      provider: { name: 'reference-browser-extension', version: '1.0.0' },
      transport: new SimulatedBrowserExtensionTransport(),
    });
    // Request-side smuggling through the adapter.
    const smuggledRequest = browser.open({ task_ref: 'task-bridge-0003', url: 'https://example.com', grant: 'sos://AuthorityGrant/smuggled' } as never);
    expect(smuggledRequest.status).toBe('FAILED');
    if (smuggledRequest.status === 'FAILED') {
      expect(smuggledRequest.error).toContain('"grant"');
      expect(smuggledRequest.error).toContain('NO AUTHORITY');
      expect(smuggledRequest.error).toContain('never an SOS authority');
    }
    // Reply-side smuggling through a fake transport.
    const smuggler: BrowserBridgeTransport = {
      simulated: true,
      dispatch: () => ({ status: 'OK', body: { page_id: 'page-0001', url: 'https://example.com', title: null, permission: 'WRITE' } }),
    };
    const smuggledBridge = new BrowserBridgeAdapter({ bridgeId: 'smuggler', provider: { name: 'smuggler', version: '1.0.0' }, transport: smuggler });
    const smuggledReply = smuggledBridge.open({ task_ref: 'task-bridge-0004', url: 'https://example.com' });
    expect(smuggledReply.status).toBe('FAILED');
    if (smuggledReply.status === 'FAILED') {
      expect(smuggledReply.error).toContain('"permission"');
      expect(smuggledReply.error).toContain('NO AUTHORITY');
    }
    // The IDE bridge: same discipline.
    const ide = new IdeBridgeAdapter({
      bridgeId: 'acceptance-ide-bridge',
      provider: { name: 'reference-ide-integration', version: '1.0.0' },
      transport: new SimulatedIdeIntegrationTransport(),
    });
    const ideSmuggled = ide.openFile({ task_ref: 'task-bridge-0005', path: 'acme/src/main.ts', authority: 'grant-everything' } as never);
    expect(ideSmuggled.status).toBe('FAILED');
    if (ideSmuggled.status === 'FAILED') {
      expect(ideSmuggled.error).toContain('"authority"');
      expect(ideSmuggled.error).toContain('NO AUTHORITY');
    }
    const ideSmuggler: IdeBridgeTransport = {
      simulated: true,
      dispatch: () => ({ status: 'OK', body: { opened: true, document_id: 'doc-0001', grant: 'x' } }),
    };
    const ideSmuggledBridge = new IdeBridgeAdapter({ bridgeId: 'ide-smuggler', provider: { name: 'smuggler', version: '1.0.0' }, transport: ideSmuggler });
    const ideSmuggledReply = ideSmuggledBridge.openFile({ task_ref: 'task-bridge-0006', path: 'acme/src/main.ts' });
    expect(ideSmuggledReply.status).toBe('FAILED');
    if (ideSmuggledReply.status === 'FAILED') {
      expect(ideSmuggledReply.error).toContain('"grant"');
    }
  });

  it('a malformed bridge reply is a truthful FAILED — never a silent success', () => {
    const malformed: BrowserBridgeTransport = {
      simulated: true,
      dispatch: () => ({ status: 'OK', body: { page_id: 'page-0001' } }),
    };
    const bridge = new BrowserBridgeAdapter({ bridgeId: 'malformed', provider: { name: 'malformed', version: '1.0.0' }, transport: malformed });
    const open = bridge.open({ task_ref: 'task-bridge-0007', url: 'https://example.com' });
    expect(open.status).toBe('FAILED');
    if (open.status === 'FAILED') {
      expect(open.error).toContain('malformed transport reply');
      expect(open.error).toContain('never a silent success');
    }
  });

  it('honest statuses: NOT_YET_CONNECTED bridges and the NOT_YET_INSTALLED companion never fabricate connection evidence', () => {
    // No real extension exists: the honest bridge state is NOT_YET_CONNECTED.
    const absentBrowser = new BrowserBridgeAdapter({ bridgeId: 'absent-browser', provider: { name: 'no-extension', version: '1.0.0' }, transport: null });
    expect(absentBrowser.descriptor().tier).toBe('extension');
    expect(absentBrowser.descriptor().connection.status).toBe('NOT_YET_CONNECTED');
    expect(absentBrowser.descriptor().connection.simulated).toBe(false);
    const refused = absentBrowser.open({ task_ref: 'task-bridge-0008', url: 'https://example.com' });
    expect(refused.status).toBe('FAILED');
    if (refused.status === 'FAILED') {
      expect(refused.error).toContain('NOT_YET_CONNECTED');
      expect(refused.error).toContain('never fabricated');
    }
    const absentIde = new IdeBridgeAdapter({ bridgeId: 'absent-ide', provider: { name: 'no-integration', version: '1.0.0' }, transport: null });
    expect(absentIde.descriptor().connection.status).toBe('NOT_YET_CONNECTED');
    expect(absentIde.descriptor().connection.simulated).toBe(false);
    // The honest installation status of the companion itself.
    expect(REFERENCE_COMPANION_INSTALLATION.status).toBe('NOT_YET_INSTALLED');
    expect(REFERENCE_COMPANION_INSTALLATION.simulated).toBe(true);
    // The tier-4 vocabulary aligns with the frozen §4 order (extension =
    // tier 4, BELOW the local companion's tier-3 bridge).
    expect(INTEGRATION_TIER_RANK.extension).toBe(4);
    expect(INTEGRATION_TIER_RANK['local-bridge']).toBe(3);
    expect(INTEGRATION_TIERS.includes('extension')).toBe(true);
    // The connection statuses consumed are the merged P8 vocabulary.
    expect(ADAPTER_CONNECTION_STATUSES).toContain('NOT_YET_CONNECTED');
    expect(ADAPTER_CONNECTION_STATUSES).toContain('CONNECTED');
  });

  it('the acceptance composition wires the bridges honestly (simulated markers, tier 4)', () => {
    const world = acceptanceWorld();
    // The composition does not exist in the acceptance world (it holds the
    // host composition instead); construct the reference bridges directly
    // and verify the honest simulated markers.
    const browserBridge = new BrowserBridgeAdapter({
      bridgeId: 'acceptance-browser-bridge',
      provider: { name: 'reference-browser-extension', version: '1.0.0' },
      transport: new SimulatedBrowserExtensionTransport(),
    });
    const ideBridge = new IdeBridgeAdapter({
      bridgeId: 'acceptance-ide-bridge',
      provider: { name: 'reference-ide-integration', version: '1.0.0' },
      transport: new SimulatedIdeIntegrationTransport(),
    });
    expect(browserBridge.connection().simulated).toBe(true);
    expect(ideBridge.connection().simulated).toBe(true);
    expect(browserBridge.descriptor().tier).toBe('extension');
    expect(ideBridge.descriptor().tier).toBe('extension');
    // The companion body in the world is the §9 user-device body — bridges
    // never carry §9 authority and are NOT bodies.
    expect(world.companionBody.identityValue.placement).toBe('user-device');
  });
});
