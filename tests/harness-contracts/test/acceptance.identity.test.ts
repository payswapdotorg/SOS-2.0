/**
 * ACCEPTANCE: provider/vendor identity NEVER becomes SOS semantic
 * identity (Work Order P5).
 *
 * The typed separation, enforced and pinned from every direction:
 *
 *   - body ids and harness ids are runtime identifiers — spine-shaped
 *     (sos://) values are rejected loudly by their guards;
 *   - a body id is never accepted where a semantic ref belongs
 *     (mission_ref, grant_refs — validated by the SPINE's own guard);
 *   - task ids are execution-fabric ids; the durable TaskRecord carries
 *     spine refs ONLY in mission_ref/grant_refs fields;
 *   - vendor/provider names appear as provenance metadata only — never
 *     in an identity position, never a selection key;
 *   - observation sources attribute bodies with a body: prefix — a
 *     distinct, non-semantic namespace.
 */

import { describe, expect, it } from 'vitest';
import { isArtifactId } from '@sos-2/semantic-spine';
import { isValidBodyId } from '@sos-2/body-broker';
import { assertValidHarnessIdentity } from '@sos-2/harness';
import { acceptanceWorld } from './acceptance-world.js';

describe('acceptance: vendor identity never becomes SOS semantic identity', () => {
  it('body ids are NEVER spine ids (the guard rejects sos:// shapes loudly)', () => {
    expect(isValidBodyId('body:acme-runner-1')).toBe(true);
    expect(isValidBodyId('sos://Mission/aaaa')).toBe(false); // short but spine-shaped prefix? — pattern needs 32 hex
    expect(isValidBodyId(`sos://Mission/${'a'.repeat(32)}`)).toBe(false);
    expect(isValidBodyId(`sos://AuthorityGrant/${'0'.repeat(32)}`)).toBe(false);
    // A body id embedding a sos:// reference anywhere is rejected too.
    expect(isValidBodyId('bridge:over:sos://Mission/xyz')).toBe(false);
  });

  it('harness ids are NEVER spine ids (the same discipline on the contract plane)', () => {
    expect(() =>
      assertValidHarnessIdentity({
        harness_id: 'harness:cloud-runner-1',
        provider: { name: 'vendor', version: '1.0.0' },
        placement: 'cloud',
      }),
    ).not.toThrow();
    expect(() =>
      assertValidHarnessIdentity({
        harness_id: `sos://Mission/${'b'.repeat(32)}`,
        provider: { name: 'vendor', version: '1.0.0' },
        placement: 'cloud',
      }),
    ).toThrow(/never a SOS semantic identity/);
  });

  it('a body id is never accepted where a semantic ref belongs (the spine guard refuses it)', async () => {
    const w = acceptanceWorld();
    w.registerBody({ bodyId: 'body:semantic-lookalike', providerName: 'vendor' });
    await w.store.authorityGrants.put(w.grant);

    // A body id as mission_ref: typed INVALID (vendor identity is never semantic identity).
    const created = await w.fabric.createBoundedTask({
      task_id: 'task-identity-0001',
      mission_ref: 'body:semantic-lookalike',
      plan: {},
      grant_refs: [w.grant.envelope.id],
      requirements: { requiredCapabilities: ['terminal'], placement: 'cloud' },
      holder: 'spirit:persistent',
      expires_at: null,
    });
    expect(created.status).toBe('DENIED');
    if (created.status === 'DENIED') {
      expect(created.denial.code).toBe('INVALID_TASK_INPUT');
      expect(created.denial.reason).toContain('NEVER a semantic identity');
    }

    // A body id as a grant ref: the spine's own guard refuses it before
    // the authority gate even resolves.
    const created2 = await w.fabric.createBoundedTask({
      task_id: 'task-identity-0002',
      mission_ref: null,
      plan: {},
      grant_refs: ['body:semantic-lookalike'],
      requirements: { requiredCapabilities: ['terminal'], placement: 'cloud' },
      holder: 'spirit:persistent',
      expires_at: null,
    });
    expect(created2.status).toBe('DENIED');
    if (created2.status === 'DENIED') {
      expect(created2.status === 'DENIED').toBe(true);
      expect(created2.denial.code).toBe('INVALID_TASK_INPUT');
    }
  });

  it('the durable TaskRecord keeps the vocabularies in their own fields (fabric ids vs spine refs)', async () => {
    const w = acceptanceWorld();
    w.registerBody({ bodyId: 'body:fields', providerName: 'vendor-one' });
    const missionRef = `sos://Mission/${'c0ffee00'.repeat(4)}`;
    await w.store.authorityGrants.put(w.grant);
    const created = await w.fabric.createBoundedTask({
      task_id: 'task-identity-0003',
      mission_ref: missionRef,
      plan: { steps: ['x'] },
      grant_refs: [w.grant.envelope.id],
      requirements: { requiredCapabilities: ['terminal'], placement: 'cloud' },
      holder: 'spirit:persistent',
      expires_at: null,
    });
    expect(created.status).toBe('CREATED');
    if (created.status === 'CREATED') {
      // Execution-fabric vocabulary: the task id and the lease ref.
      expect(created.task.task_id).toBe('task-identity-0003');
      expect(isArtifactId(created.task.task_id)).toBe(false);
      expect(created.task.body_lease_ref).toBe('lease:task-identity-0003:0001');
      expect(isArtifactId(created.task.body_lease_ref)).toBe(false);
      // Semantic vocabulary: the mission and grant references — SPINE ids.
      expect(created.task.mission_ref).toBe(missionRef);
      expect(isArtifactId(created.task.mission_ref!)).toBe(true);
      for (const grantRef of created.task.authority_context.grant_refs) {
        expect(isArtifactId(grantRef)).toBe(true);
      }
    }
  });

  it('vendor names appear ONLY as provenance metadata — never in identity position', async () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:provenance-only', providerName: 'famous-vendor' });
    const task = await w.createTask({ task_id: 'task-identity-0004' });
    await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'echo', args: ['x'], cwd: null });

    // The task record and the lease carry NO vendor name.
    const record = await w.store.tasks.get(task.task_id);
    expect(JSON.stringify(record)).not.toContain('famous-vendor');
    const lease = await w.store.bodyLeases.get(task.body_lease_ref!);
    expect(JSON.stringify(lease)).not.toContain('famous-vendor');

    // The vendor name lives ONLY in the broker registration (provenance)
    // and the observation PROVENANCE/source fields attribute the BODY id.
    expect(w.broker.body('body:provenance-only')?.provider.name).toBe('famous-vendor');
    const creation = await w.store.observationEvents.get(record!.observations[0]!);
    expect(creation?.source).toBe('execution-fabric');
    expect(creation?.provenance).toContain('body:body:provenance-only');
    expect(JSON.stringify(creation?.provenance)).not.toContain('famous-vendor');

    // The harness identity's provider block is metadata, and the
    // harness_id itself is a runtime identifier.
    expect(body.identityValue.provider.name).toBe('famous-vendor');
    expect(isArtifactId(body.identityValue.harness_id)).toBe(false);
  });

  it('observation sources attribute bodies in a distinct non-semantic namespace', async () => {
    const w = acceptanceWorld();
    w.registerBody({ bodyId: 'body:namespace', providerName: 'vendor' });
    const task = await w.createTask({ task_id: 'task-identity-0005' });
    await w.fabric.execute(task.task_id, {
      kind: 'observations.emit',
      observation_kind: 'body.note',
      payload: { hello: true },
    });
    const record = await w.store.tasks.get(task.task_id);
    const bodyEvent = await w.store.observationEvents.get(record!.observations[1]!);
    expect(bodyEvent?.source).toBe('body:body:namespace');
    // The source is NOT a spine id — distinct namespaces, typed separation.
    expect(isArtifactId(bodyEvent!.source)).toBe(false);
  });
});
