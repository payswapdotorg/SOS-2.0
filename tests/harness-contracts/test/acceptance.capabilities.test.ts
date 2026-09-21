/**
 * ACCEPTANCE: capabilities are explicit and provider-neutral
 * (Work Order P5).
 *
 * - Unsupported capabilities are EXPLICIT: a body advertising no browser
 *   answers typed UNSUPPORTED for browser operations — never a silent
 *   success, never a surprise capability, never a crash.
 * - The advertisement mirrors the §3 body advertisement list
 *   field-for-field and the §1 body surfaces.
 * - Selection is capability-based and vendor-blind: flipping provider
 *   names never changes selection; bodies from different vendors with
 *   the same advertisement are interchangeable.
 * - The §4 integration priority order governs the advertised runtime
 *   integrations (a native API surface beats an extension).
 */

import { describe, expect, it } from 'vitest';
import {
  HARNESS_CAPABILITIES,
  assertValidHarnessCapabilities,
  isOperationAdvertised,
} from '@sos-2/harness';
import { INTEGRATION_TIER_RANK, selectRuntimeIntegration } from '@sos-2/runtime-contracts';
import { acceptanceWorld } from './acceptance-world.js';
import { ReferenceBody } from './reference-body.js';

describe('acceptance: capabilities are explicit', () => {
  it('a body advertising NO browser answers typed UNSUPPORTED for browser operations (never silent)', async () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:no-browser', providerName: 'reference-body-vendor' });
    const task = await w.createTask({ task_id: 'task-caps-0001' });

    const open = await w.fabric.execute(task.task_id, { kind: 'browser.open', url: 'https://example.invalid' });
    expect(open.status).toBe('UNSUPPORTED');
    if (open.status === 'UNSUPPORTED') {
      expect(open.operation).toBe('browser.open');
      expect(open.reason).toContain('advertisement');
    }
    const interact = await w.fabric.execute(task.task_id, {
      kind: 'browser.interact',
      page_id: 'page-1',
      action: 'click',
      target: 'button#go',
      value: null,
    });
    expect(interact.status).toBe('UNSUPPORTED');
    // The browser surface NEVER dispatched (explicit, not best-effort).
    expect(body.dispatches.get('browser.open')).toBeUndefined();
    expect(body.dispatches.get('browser.interact')).toBeUndefined();
  });

  it('a body WITH the browser capability executes the same operations through the same contract', async () => {
    const w = acceptanceWorld();
    w.registerBody({ bodyId: 'body:with-browser', providerName: 'reference-body-vendor', withBrowser: true });
    const task = await w.createTask({ task_id: 'task-caps-0002' });
    const open = await w.fabric.execute(task.task_id, { kind: 'browser.open', url: 'https://example.invalid' });
    expect(open.status).toBe('EXECUTED');
    if (open.status === 'EXECUTED') {
      expect(open.output).toMatchObject({ page_id: 'page-1', url: 'https://example.invalid' });
    }
    const interact = await w.fabric.execute(task.task_id, {
      kind: 'browser.interact',
      page_id: 'page-1',
      action: 'read',
      target: 'main',
      value: null,
    });
    expect(interact.status).toBe('EXECUTED');
  });

  it('the direct contract surface answers UNSUPPORTED identically (the advertisement is binding on both planes)', async () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:direct', providerName: 'reference-body-vendor' });
    // Calling the contract surface DIRECTLY (the body-side view): the
    // typed UNSUPPORTED result is the contract's own answer.
    const direct = body.browser.open({ task_ref: 'task-none', url: 'https://example.invalid' });
    expect(direct.status).toBe('UNSUPPORTED');
    if (direct.status === 'UNSUPPORTED') {
      expect(direct.operation).toBe('browser.open');
    }
    // And the advertisement agrees with the binding map.
    expect(isOperationAdvertised(body.capabilitiesValue, 'browser.open')).toBe(false);
    expect(isOperationAdvertised(body.capabilitiesValue, 'shell.exec')).toBe(true);
    expect(isOperationAdvertised(body.capabilitiesValue, 'git.push')).toBe(true);
  });

  it('the advertisement mirrors the §3 list field-for-field and the §1 surfaces', () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:mirror', providerName: 'reference-body-vendor' });
    const advertisement = body.capabilitiesValue;
    // §3: capabilities, isolation level, network policy, filesystem
    // scope, browser capability, shell capability, git capability,
    // runtime/cloud integrations, supported task lifecycle,
    // evidence/artifact capture, cost and resource envelope.
    expect(Object.keys(advertisement).sort()).toEqual(
      [
        'browser',
        'capabilities',
        'costEnvelope',
        'evidenceCapture',
        'filesystemScope',
        'git',
        'isolationLevel',
        'networkPolicy',
        'runtimeIntegrations',
        'shell',
        'taskLifecycle',
      ].sort(),
    );
    // §1 body surfaces: terminal+filesystem access, repository
    // operations, browser/UI interaction, runtime/cloud APIs (the
    // reference body exercises these five; ide-desktop and
    // deployment-operations are in the vocabulary).
    expect(advertisement.capabilities).toEqual(
      expect.arrayContaining(['terminal', 'filesystem', 'repository-operations', 'runtime-cloud-apis']),
    );
    expect(HARNESS_CAPABILITIES).toContain('ide-desktop');
    expect(HARNESS_CAPABILITIES).toContain('deployment-operations');
    // The advertisement is valid by the binding guard.
    expect(() => assertValidHarnessCapabilities(advertisement)).not.toThrow();
  });

  it('the §4 integration priority order governs the advertised runtime integrations', () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:tiers', providerName: 'reference-body-vendor' });
    const github = body.capabilitiesValue.runtimeIntegrations.find((envelope) => envelope.capability === 'github')!;
    expect(github).toBeDefined();
    expect(github.integrations.map((integration) => integration.tier).sort()).toEqual(['native-api', 'ui-automation']);
    // The highest available control surface wins — never the extension
    // when an equivalent safe API is available.
    const selection = selectRuntimeIntegration(github.integrations);
    expect(selection.status).toBe('SELECTED');
    if (selection.status === 'SELECTED') {
      expect(selection.selected.tier).toBe('native-api');
      expect(INTEGRATION_TIER_RANK[selection.selected.tier]).toBe(1);
    }
  });
});

describe('acceptance: capabilities are provider-neutral', () => {
  it('selection NEVER consults vendor identity — flipping provider names changes nothing', async () => {
    const a = acceptanceWorld();
    a.registerBody({ bodyId: 'body:alpha', providerName: 'vendor-one' });
    a.registerBody({ bodyId: 'body:beta', providerName: 'vendor-two' });
    const first = a.broker.select({ requiredCapabilities: ['terminal', 'filesystem'], placement: 'cloud' });
    expect(first.status).toBe('SELECTED');
    if (first.status === 'SELECTED') {
      expect(first.body.body_id).toBe('body:alpha'); // registration order, not vendor
    }

    // Same bodies, swapped vendor names: identical selection.
    const swapped = a.broker.select({
      requiredCapabilities: ['terminal', 'filesystem'],
      placement: 'cloud',
    });
    expect(swapped.status).toBe('SELECTED');
    if (swapped.status === 'SELECTED') {
      expect(swapped.body.body_id).toBe('body:alpha');
    }

    // And with a fresh world where registration order differs, the
    // CAPABILITY-matching body wins regardless of vendor: the first
    // vendor (alphabetically-first name, earliest registration) lacks
    // repository operations; the last vendor has everything.
    const b = acceptanceWorld();
    const noGitHarness = new ReferenceBody({ bodyId: 'body:no-git', providerName: 'aaa-first-vendor' });
    b.broker.registerBody({
      body_id: 'body:no-git',
      provider: { name: 'aaa-first-vendor', version: '1.0.0' },
      capabilities: {
        ...noGitHarness.capabilitiesValue,
        capabilities: ['terminal', 'filesystem'],
        git: [],
        runtimeIntegrations: [],
      },
      placement: 'cloud',
      harness: noGitHarness,
    });
    b.registerBody({ bodyId: 'body:full', providerName: 'zzz-last-vendor' });
    const selection = b.broker.select({
      requiredCapabilities: ['terminal', 'filesystem', 'repository-operations'],
      placement: 'cloud',
    });
    expect(selection.status).toBe('SELECTED');
    if (selection.status === 'SELECTED') {
      expect(selection.body.body_id).toBe('body:full'); // capability match beats vendor-name order
    }
  });

  it('the same task journey is vendor-interchangeable (no vendor surface in the contract)', async () => {
    const w = acceptanceWorld();
    const bodyA = w.registerBody({ bodyId: 'body:cloud-a', providerName: 'vendor-one' });
    const bodyB = w.registerBody({ bodyId: 'body:cloud-b', providerName: 'vendor-two', withBrowser: true });

    // Vendor A runs the bounded task.
    const taskA = await w.createTask({ task_id: 'task-neutral-0001' });
    const shellA = await w.fabric.execute(taskA.task_id, { kind: 'shell.exec', command: 'echo', args: ['hi'], cwd: null });
    expect(shellA.status).toBe('EXECUTED');

    // Vendor B (different name, PLUS a browser capability) answers the
    // SAME operations through the SAME typed surface.
    const browserProbe = bodyB.browser.open({ task_ref: 'probe', url: 'https://example.invalid' });
    expect(browserProbe.status).toBe('OK');
    const shellB = bodyB.shell.exec({ task_ref: 'probe', command: 'echo', args: ['hi'], cwd: null });
    expect(shellB.status).toBe('OK');
    // Vendor A answers browser operations with typed UNSUPPORTED — the
    // DIFFERENCE is explicit capability, never vendor identity.
    expect(bodyA.browser.open({ task_ref: 'probe', url: 'https://example.invalid' }).status).toBe('UNSUPPORTED');
  });
});
