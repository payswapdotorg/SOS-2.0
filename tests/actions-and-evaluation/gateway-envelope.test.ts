import { describe, expect, it } from 'vitest';
import { validateRequest } from '@sos-2/action-gateway';
import { buildFixture, commitRequest, expectExecuted } from './helpers.js';

describe('P9 envelope guard: the gateway carries no authority fields of its own', () => {
  it('rejects a smuggled top-level authority field, naming it', () => {
    const outcome = validateRequest({ ...commitRequest(), authority: { grantId: 'g-9' } });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejection.code).toBe('AUTHORITY_FIELD_SMUGGLED');
    expect(outcome.rejection.field).toBe('authority');
  });

  it('rejects a smuggled nested key, naming the full path', () => {
    const base = commitRequest();
    if (base.payload.family !== 'commit') throw new Error('expected commit request fixture');
    const outcome = validateRequest({
      ...base,
      payload: { family: 'commit', commit: { ...base.payload.commit, grantToken: 'x' } },
    });
    if (outcome.ok) throw new Error('expected rejection');
    expect(outcome.rejection.code).toBe('AUTHORITY_FIELD_SMUGGLED');
    expect(outcome.rejection.field).toBe('payload.commit.grantToken');
  });

  it('catches case variants', () => {
    const outcome = validateRequest({ ...commitRequest(), Permissions: [] });
    if (outcome.ok) throw new Error('expected rejection');
    expect(outcome.rejection.code).toBe('AUTHORITY_FIELD_SMUGGLED');
    expect(outcome.rejection.field).toBe('Permissions');
  });

  it('rejects envelope/payload family mismatch and unknown families', () => {
    expect(validateRequest({ ...commitRequest(), family: 'deployment' }).ok).toBe(false);
    expect(validateRequest({ ...commitRequest(), family: 'deploy' }).ok).toBe(false);
  });

  it('a successful receipt never contains authority-shaped fields', () => {
    const fx = buildFixture();
    fx.authority.grant('body-1', 'commit', 'workspace', {});
    const receipt = expectExecuted(fx.gateway.execute(commitRequest()));
    const serialized = JSON.stringify(receipt);
    for (const banned of ['"authority"', '"grant', '"permission', '"token', '"credential']) {
      expect(serialized.includes(banned)).toBe(false);
    }
  });
});
