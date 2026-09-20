/**
 * ExecutionAdapter tests — the authority-gated contract for running
 * candidate code. Expired/revoked/missing grants never run anything.
 */

import { describe, expect, it } from 'vitest';
import { InMemoryExecutionAdapter } from '../src/index.js';
import type { AdapterExecutionRequest } from '../src/index.js';
import { evaluateGrant } from '@sos-2/authority';
import { grantFixture, GRANT_EXPIRY, PAST_EXPIRY, T0 } from './helpers.js';

function request(overrides: Partial<AdapterExecutionRequest> = {}): AdapterExecutionRequest {
  return {
    operation: 'run-candidate',
    input: { candidate: 'payments-v2' },
    grant: grantFixture(),
    at: { kind: 'TIME', now: T0 },
    ...overrides,
  };
}

describe('InMemoryExecutionAdapter (authority gate)', () => {
  it('executes declared operations under a VALID grant and returns the JSON output', () => {
    const adapter = new InMemoryExecutionAdapter({
      'run-candidate': (input) => ({ ran: true, input }),
    });
    const result = adapter.execute(request());
    expect(result.status).toBe('EXECUTED');
    if (result.status === 'EXECUTED') {
      expect(result.availability).toBe('SUCCESS');
      expect(result.output).toEqual({ ran: true, input: { candidate: 'payments-v2' } });
      expect(result.error).toBeNull();
      expect(result.grant_ref).toBe(request().grant.envelope.id);
    }
  });

  it('reports FAILURE truthfully when the operation throws (with a reason)', () => {
    const adapter = new InMemoryExecutionAdapter({
      'run-candidate': () => {
        throw new Error('candidate crashed');
      },
    });
    const result = adapter.execute(request());
    expect(result.status).toBe('EXECUTED');
    if (result.status === 'EXECUTED') {
      expect(result.availability).toBe('FAILURE');
      expect(result.output).toBeNull();
      expect(result.error).toContain('candidate crashed');
    }
  });

  it('reports FAILURE when the operation returns a non-JSON payload', () => {
    const adapter = new InMemoryExecutionAdapter({
      'run-candidate': () => ({ fn: () => 1 } as never),
    });
    const result = adapter.execute(request());
    expect(result.status).toBe('EXECUTED');
    if (result.status === 'EXECUTED') {
      expect(result.availability).toBe('FAILURE');
      expect(result.error).toContain('non-JSON');
    }
  });

  it('DENIES execution for an EXPIRED grant with a structured reason (the operation never runs)', () => {
    let ran = false;
    const adapter = new InMemoryExecutionAdapter({
      'run-candidate': () => {
        ran = true;
        return null;
      },
    });
    const expiredGrant = grantFixture({ expiryAt: PAST_EXPIRY });
    const result = adapter.execute(request({ grant: expiredGrant, at: { kind: 'TIME', now: GRANT_EXPIRY } }));
    expect(result.status).toBe('EXECUTION_DENIED');
    if (result.status === 'EXECUTION_DENIED') {
      expect(result.denial.code).toBe('GRANT_EXPIRED');
      expect(result.denial.grant_ref).toBe(expiredGrant.envelope.id);
      expect(result.denial.reason).toContain('EXPIRED');
    }
    expect(ran).toBe(false);
  });

  it('DENIES execution for a REVOKED grant with a structured reason (the operation never runs)', () => {
    let ran = false;
    const adapter = new InMemoryExecutionAdapter({
      'run-candidate': () => {
        ran = true;
        return null;
      },
    });
    const revokedGrant = grantFixture({ revoked: true });
    expect(evaluateGrant(revokedGrant, { kind: 'TIME', now: T0 })).toBe('REVOKED');
    const result = adapter.execute(request({ grant: revokedGrant }));
    expect(result.status).toBe('EXECUTION_DENIED');
    if (result.status === 'EXECUTION_DENIED') {
      expect(result.denial.code).toBe('GRANT_REVOKED');
      expect(result.denial.grant_ref).toBe(revokedGrant.envelope.id);
    }
    expect(ran).toBe(false);
  });

  it('REJECTS a request with a MISSING grant loudly (never runs)', () => {
    const adapter = new InMemoryExecutionAdapter({
      'run-candidate': () => ({ ran: true }),
    });
    const forged = { operation: 'run-candidate', input: null, at: { kind: 'TIME', now: T0 } } as never;
    expect(() => adapter.execute(forged)).toThrow(/no grant/i);
  });

  it('REJECTS malformed grants (validation happens before evaluation)', () => {
    const adapter = new InMemoryExecutionAdapter({ 'run-candidate': () => null });
    expect(() => adapter.execute(request({ grant: { envelope: null, content: null } as never }))).toThrow(
      /grant evaluation failed|malformed/,
    );
  });

  it('throws on UNDECLARED operations (declared operations only)', () => {
    const adapter = new InMemoryExecutionAdapter({ 'run-candidate': () => null });
    expect(() => adapter.execute(request({ operation: 'destroy-everything' }))).toThrow(/undeclared operation/);
    expect(adapter.operations()).toEqual(['run-candidate']);
  });

  it('rejects malformed requests and inputs', () => {
    const adapter = new InMemoryExecutionAdapter({ 'run-candidate': () => null });
    expect(() => adapter.execute(null as never)).toThrow();
    expect(() => adapter.execute(request({ operation: '' }))).toThrow();
    expect(() => adapter.execute(request({ input: { bad: () => 1 } as never }))).toThrow();
  });

  it('exposes its contract descriptor for the semantic guard', () => {
    const adapter = new InMemoryExecutionAdapter();
    expect(adapter.descriptor.contract).toBe('ExecutionAdapter');
    expect(adapter.descriptor.outputs).toEqual({
      availability: 'EvidenceTruthState',
      output: 'JsonValue',
      grant_ref: 'ArtifactId',
    });
  });
});
