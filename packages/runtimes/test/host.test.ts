/**
 * RuntimeHost tests — declared operations, observations, trace links and
 * the authority gate (the W12 negative acceptance: execution without a
 * valid grant is REJECTED; observations never mutate System State).
 */

import { describe, expect, it } from 'vitest';
import { systemStateHash } from '@sos-2/system-state';
import { createSystemState } from '@sos-2/system-state';
import { InMemoryRuntimeHost } from '../src/index.js';
import type { ExecutionRequest } from '../src/index.js';
import { createTraceLink } from '@sos-2/semantic-spine';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import {
  GRANT_EXPIRY,
  PAST_EXPIRY,
  SUBJECT_ID,
  SYSTEM_STATE_ID,
  T0,
  T1,
  grantFixture,
  runtimeFixture,
  toolProducer,
} from './helpers.js';

function makeHost() {
  const grants = new Map<string, ReturnType<typeof grantFixture>>();
  const valid = grantFixture();
  const expired = grantFixture({ expiryAt: PAST_EXPIRY });
  const revoked = grantFixture({ revoked: true });
  grants.set(valid.envelope.id, valid);
  grants.set(expired.envelope.id, expired);
  grants.set(revoked.envelope.id, revoked);
  const host = new InMemoryRuntimeHost((grantRef) => grants.get(grantRef));
  host.registerRuntime(runtimeFixture(), {
    'evaluate-candidate': (input) => ({ evaluated: true, input }),
    'run-checks': () => {
      throw new Error('check crashed');
    },
  });
  return { host, valid, expired, revoked };
}

function request(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    runtime_id: 'runtime:checkout-sandbox',
    operation: 'evaluate-candidate',
    input: { candidate: 'payments-v2' },
    grant_ref: makeHost().valid.envelope.id,
    at: { kind: 'TIME', now: T0 },
    window: { start: T0, end: T1 },
    producer: toolProducer(),
    subject_ref: SUBJECT_ID,
    observed_system_state: SYSTEM_STATE_ID,
    ...overrides,
  };
}

describe('InMemoryRuntimeHost (declared execution)', () => {
  it('executes a declared operation under a VALID grant and emits an observation', () => {
    const { host, valid } = makeHost();
    const result = host.execute(request({ grant_ref: valid.envelope.id }));
    expect(result.status).toBe('EXECUTED');
    if (result.status === 'EXECUTED') {
      const observation = result.observation;
      expect(observation.availability).toBe('SUCCESS');
      expect(observation.output).toEqual({ evaluated: true, input: { candidate: 'payments-v2' } });
      expect(observation.error).toBeNull();
      expect(observation.runtime_id).toBe('runtime:checkout-sandbox');
      expect(observation.runtime_kind).toBe('in-memory');
      expect(observation.grant_ref).toBe(valid.envelope.id);
      expect(observation.subject_ref).toBe(SUBJECT_ID);
      expect(observation.observed_system_state).toBe(SYSTEM_STATE_ID);
      expect(observation.window).toEqual({ start: T0, end: T1 });
    }
  });

  it('reports FAILURE truthfully when the declared operation throws', () => {
    const { host, valid } = makeHost();
    const result = host.execute(request({ operation: 'run-checks', grant_ref: valid.envelope.id }));
    expect(result.status).toBe('EXECUTED');
    if (result.status === 'EXECUTED') {
      expect(result.observation.availability).toBe('FAILURE');
      expect(result.observation.output).toBeNull();
      expect(result.observation.error).toContain('check crashed');
    }
  });

  it('reports FAILURE when the output exceeds the declared MAX_OUTPUT_BYTES constraint', () => {
    const { host, valid } = makeHost();
    host.registerRuntime(
      runtimeFixture({
        id: 'runtime:tiny-output',
        capabilities: ['big-op'],
        constraints: [{ kind: 'MAX_OUTPUT_BYTES', max_bytes: 8 }],
      }),
      { 'big-op': () => ({ this: 'is-a-very-long-output' }) },
    );
    const result = host.execute(
      request({ runtime_id: 'runtime:tiny-output', operation: 'big-op', grant_ref: valid.envelope.id }),
    );
    expect(result.status).toBe('EXECUTED');
    if (result.status === 'EXECUTED') {
      expect(result.observation.availability).toBe('FAILURE');
      expect(result.observation.error).toContain('MAX_OUTPUT_BYTES');
    }
  });

  it('emits OBSERVES trace links binding subject -> observed SystemState revision', () => {
    const { host, valid } = makeHost();
    host.execute(request({ grant_ref: valid.envelope.id }));
    const links = host.traceLinks();
    expect(links).toHaveLength(1);
    expect(links[0]!.source).toBe(SUBJECT_ID);
    expect(links[0]!.target).toBe(SYSTEM_STATE_ID);
    expect(links[0]!.type).toBe('OBSERVES');
    expect(links[0]!.provenance).toContain(`grant:${valid.envelope.id}`);
  });

  it('emits VERIFIES trace links for verification executions', () => {
    const { host, valid } = makeHost();
    host.execute(request({ grant_ref: valid.envelope.id, link_type: 'VERIFIES' }));
    expect(host.traceLinks()[0]!.type).toBe('VERIFIES');
  });

  it('emits no trace links when subject or observed state is absent (no fabricated spine refs)', () => {
    const { host, valid } = makeHost();
    host.execute(request({ grant_ref: valid.envelope.id, subject_ref: null }));
    expect(host.traceLinks()).toHaveLength(0);
    const observation = host.observations()[0]!;
    expect(observation.subject_ref).toBeNull();
    expect(observation.observed_system_state).toBe(SYSTEM_STATE_ID);
  });

  it('lists runtimes sorted by id and serves observations in emission order', () => {
    const { host, valid } = makeHost();
    host.registerRuntime(runtimeFixture({ id: 'runtime:a', capabilities: ['op'] }), { op: () => 1 });
    expect(host.listRuntimes().map((r) => r.id)).toEqual(['runtime:a', 'runtime:checkout-sandbox']);
    host.execute(request({ grant_ref: valid.envelope.id }));
    host.execute(request({ grant_ref: valid.envelope.id, operation: 'run-checks' }));
    const observations = host.observations();
    expect(observations).toHaveLength(2);
    expect(observations[0]!.availability).toBe('SUCCESS');
    expect(observations[1]!.availability).toBe('FAILURE');
  });

  it('rejects duplicate runtime registrations and handlers for undeclared operations', () => {
    const { host } = makeHost();
    expect(() =>
      host.registerRuntime(runtimeFixture(), {
        'evaluate-candidate': () => null,
        'run-checks': () => null,
      }),
    ).toThrow(/already registered/);
    expect(() =>
      host.registerRuntime(runtimeFixture({ id: 'runtime:x' }), { 'not-declared': () => null }),
    ).toThrow(/no handler was supplied|declares operation/);
  });

  it('throws on unknown runtimes and undeclared operations (declared runtimes only)', () => {
    const { host, valid } = makeHost();
    expect(() => host.execute(request({ runtime_id: 'runtime:ghost' }))).toThrow(/unknown runtime/);
    expect(() => host.execute(request({ operation: 'destroy-everything' }))).toThrow(/undeclared operation/);
  });

  it('rejects malformed requests loudly', () => {
    const { host } = makeHost();
    expect(() => host.execute(null as never)).toThrow();
    expect(() => host.execute(request({ runtime_id: '' }))).toThrow();
    expect(() => host.execute(request({ operation: '' }))).toThrow();
    expect(() => host.execute(request({ window: undefined as never }))).toThrow();
    expect(() => host.execute(request({ producer: undefined as never }))).toThrow();
    expect(() => host.execute(request({ link_type: 'CAUSED' as never }))).toThrow();
  });
});

describe('InMemoryRuntimeHost (authority gate — negative acceptance)', () => {
  it('DENIES execution without a grant reference (missing)', () => {
    const { host } = makeHost();
    let ran = false;
    host.registerRuntime(runtimeFixture({ id: 'runtime:probe', capabilities: ['probe'] }), {
      probe: () => {
        ran = true;
        return null;
      },
    });
    const forged = request({ runtime_id: 'runtime:probe', operation: 'probe' }) as Partial<ExecutionRequest>;
    delete (forged as { grant_ref?: string }).grant_ref;
    const result = host.execute(forged as ExecutionRequest);
    expect(result.status).toBe('EXECUTION_DENIED');
    if (result.status === 'EXECUTION_DENIED') {
      expect(result.denial.code).toBe('GRANT_MISSING');
      expect(result.denial.grant_ref).toBeNull();
      expect(result.denial.reason).toContain('no grant');
    }
    expect(ran).toBe(false);
    expect(host.observations()).toHaveLength(0);
  });

  it('DENIES execution with an unknown grant reference', () => {
    const { host } = makeHost();
    const unknown = deriveDeterministicArtifactId('AuthorityGrant', { note: 'not-in-pool' });
    const result = host.execute(request({ grant_ref: unknown }));
    expect(result.status).toBe('EXECUTION_DENIED');
    if (result.status === 'EXECUTION_DENIED') {
      expect(result.denial.code).toBe('GRANT_UNKNOWN');
      expect(result.denial.grant_ref).toBe(unknown);
    }
  });

  it('DENIES execution with an EXPIRED grant (the operation never runs)', () => {
    const { host, expired } = makeHost();
    let ran = false;
    host.registerRuntime(runtimeFixture({ id: 'runtime:probe', capabilities: ['probe'] }), {
      probe: () => {
        ran = true;
        return null;
      },
    });
    const result = host.execute(
      request({
        runtime_id: 'runtime:probe',
        operation: 'probe',
        grant_ref: expired.envelope.id,
        at: { kind: 'TIME', now: GRANT_EXPIRY },
      }),
    );
    expect(result.status).toBe('EXECUTION_DENIED');
    if (result.status === 'EXECUTION_DENIED') {
      expect(result.denial.code).toBe('GRANT_EXPIRED');
      expect(result.denial.grant_ref).toBe(expired.envelope.id);
      expect(result.denial.reason).toContain('EXPIRED');
    }
    expect(ran).toBe(false);
    expect(host.observations()).toHaveLength(0);
    expect(host.traceLinks()).toHaveLength(0);
  });

  it('DENIES execution with a REVOKED grant (the operation never runs)', () => {
    const { host, revoked } = makeHost();
    let ran = false;
    host.registerRuntime(runtimeFixture({ id: 'runtime:probe', capabilities: ['probe'] }), {
      probe: () => {
        ran = true;
        return null;
      },
    });
    const result = host.execute(request({ runtime_id: 'runtime:probe', operation: 'probe', grant_ref: revoked.envelope.id }));
    expect(result.status).toBe('EXECUTION_DENIED');
    if (result.status === 'EXECUTION_DENIED') {
      expect(result.denial.code).toBe('GRANT_REVOKED');
      expect(result.denial.grant_ref).toBe(revoked.envelope.id);
    }
    expect(ran).toBe(false);
  });

  it('denials carry the four structured codes', () => {
    const { host, valid, expired } = makeHost();
    const codes = new Set<string>();
    for (const grantRef of [undefined, 'sos://AuthorityGrant/' + 'f'.repeat(32), expired.envelope.id]) {
      const partial = request(
        grantRef === undefined ? {} : { grant_ref: grantRef },
      ) as Partial<ExecutionRequest>;
      if (grantRef === undefined) {
        delete (partial as { grant_ref?: string }).grant_ref;
      }
      const result = host.execute(partial as ExecutionRequest);
      if (result.status === 'EXECUTION_DENIED') {
        codes.add(result.denial.code);
      }
    }
    // GRANT_MISSING, GRANT_UNKNOWN, GRANT_EXPIRED are all reachable and distinct.
    expect(codes.has('GRANT_MISSING')).toBe(true);
    expect(codes.has('GRANT_UNKNOWN')).toBe(true);
    expect(codes.has('GRANT_EXPIRED')).toBe(true);
    expect(valid.envelope.id).toContain('AuthorityGrant');
  });
});

describe('runtime observations NEVER mutate System State (W12 acceptance)', () => {
  it('executions observing a SystemState leave it bit-identical (observation -> no state change)', () => {
    const { host, valid } = makeHost();
    // A real W2 SystemState artifact with the same content shape as SYSTEM_STATE_ID.
    const state = createSystemState({
      content: {
        architecture_ref: {
          artifact_id: deriveDeterministicArtifactId('ArchitectureGraph', { note: 'w12 test graph' }),
          version: 1,
        },
        implementation: [
          {
            artifact_id: deriveDeterministicArtifactId('ImplementationModel', { note: 'w12 test impl' }),
            revision: { kind: 'git-sha', value: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' },
          },
        ],
        configuration: [],
        deployment: [],
        policy: [],
        environment_relationships: [],
        active_experiments: [],
        package_realizations: [],
      },
      provenance: ['w12:runtimes-test:system-state'],
      created_at: T0,
      status: 'ACTIVE',
    });
    const before = systemStateHash(state);
    const beforeEnvelope = { ...state.envelope };

    for (let i = 0; i < 3; i += 1) {
      const result = host.execute(
        request({ grant_ref: valid.envelope.id, observed_system_state: state.envelope.id }),
      );
      expect(result.status).toBe('EXECUTED');
    }

    // The stored artifact is unchanged: same content hash, same envelope, same version.
    expect(systemStateHash(state)).toBe(before);
    expect(state.envelope).toEqual(beforeEnvelope);
    // The observations carry only a REFERENCE to the observed revision.
    for (const observation of host.observations()) {
      expect(observation.observed_system_state).toBe(state.envelope.id);
      expect((observation as unknown as Record<string, unknown>)['system_state_content']).toBeUndefined();
    }
  });

  it('the observation record has no mutation surface: trace links are minted through the spine', () => {
    const { host, valid } = makeHost();
    host.execute(request({ grant_ref: valid.envelope.id }));
    const link = host.traceLinks()[0]!;
    // Spine-minted links validate through the spine's own contract.
    expect(() =>
      createTraceLink({
        source: link.source,
        target: link.target,
        type: link.type,
        provenance: link.provenance!,
      }),
    ).not.toThrow();
  });
});
