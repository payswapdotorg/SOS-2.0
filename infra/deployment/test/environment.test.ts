/**
 * Environment schema + fail-closed loading tests (Work Order P3).
 * Per-tier requirements, typed failures naming variables, local fixture
 * gating, secret classification, and the never-serialized secret values.
 */

import {
  ENVIRONMENT_VARIABLE_REGISTRY,
  requiredVariablesFor,
  requiredSecretNamesFor,
  secretVariables,
  variableSpec,
  looksSecretShapedByName,
} from '../src/environment/schema.ts';
import {
  EnvironmentValidationError,
  loadEnvironment,
  serializeEnvironment,
  validateValueShape,
} from '../src/environment/load.ts';
import {
  fullPreviewSource,
  fullProductionSource,
  localSource,
  SYNTHETIC_GITHUB_TOKEN,
} from './fixtures.ts';

describe('environment schema registry', () => {
  it('covers every provider of the free-tier topology plus app scope', () => {
    const providers = new Set(ENVIRONMENT_VARIABLE_REGISTRY.map((spec) => spec.provider));
    expect(providers.has('vercel')).toBe(true);
    expect(providers.has('neon')).toBe(true);
    expect(providers.has('upstash')).toBe(true);
    expect(providers.has('r2')).toBe(true);
    expect(providers.has('github')).toBe(true);
    expect(providers.has('execution-body-provider')).toBe(true);
    expect(providers.has('app')).toBe(true);
  });

  it('classifies every credential-carrying variable as secret', () => {
    const secretNames = secretVariables().map((spec) => spec.name);
    for (const name of [
      'VERCEL_TOKEN',
      'DATABASE_URL',
      'NEON_API_KEY',
      'UPSTASH_REDIS_REST_TOKEN',
      'UPSTASH_REDIS_CONNECTION_URL',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'GITHUB_ACCESS_TOKEN',
      'GITHUB_WEBHOOK_SECRET',
      'BODY_PROVIDER_API_KEY',
    ]) {
      expect(secretNames).toContain(name);
    }
    // Public config variables stay public.
    for (const name of ['VERCEL_PROJECT_ID', 'NEON_DATABASE_NAME', 'R2_BUCKET_NAME', 'APP_BASE_URL']) {
      expect(secretNames).not.toContain(name);
    }
  });

  it('requires more for preview/production than the registry leaves optional', () => {
    const previewRequired = requiredVariablesFor('preview').map((s) => s.name);
    const productionRequired = requiredVariablesFor('production').map((s) => s.name);
    expect(previewRequired.length).toBeGreaterThan(10);
    expect(productionRequired).toEqual(previewRequired); // same product surface per plan
    expect(requiredVariablesFor('local').length).toBe(0); // local requires NOTHING
  });

  it('derives required secret names per tier (names only)', () => {
    const names = requiredSecretNamesFor('production');
    expect(names).toContain('VERCEL_TOKEN');
    expect(names).toContain('GITHUB_WEBHOOK_SECRET');
    expect(names.every((name) => variableSpec(name)?.secret === true)).toBe(true);
  });

  it('conservatively classifies unknown secret-shaped NAMES as secrets', () => {
    expect(looksSecretShapedByName('MY_PROVIDER_TOKEN')).toBe(true);
    expect(looksSecretShapedByName('SOMETHING_SECRET')).toBe(true);
    expect(looksSecretShapedByName('API_KEY')).toBe(true);
    expect(looksSecretShapedByName('PLAIN_CONFIG')).toBe(false);
    expect(looksSecretShapedByName('BASE_URL')).toBe(false);
  });
});

describe('fail-closed environment loading', () => {
  it('loads a complete preview environment and keeps secrets out of every enumerable surface', () => {
    const record = loadEnvironment('preview', fullPreviewSource());
    expect(record.tier).toBe('preview');
    expect(record.missing).toEqual([]);
    expect(record.secretNames).toContain('VERCEL_TOKEN');
    // Secret values are reachable ONLY through the accessor:
    expect(record.getSecretValue('GITHUB_ACCESS_TOKEN')).toBe(SYNTHETIC_GITHUB_TOKEN);
    // ...and never appear in the serialized view:
    const serialized = serializeEnvironment(record);
    expect(serialized).not.toContain(SYNTHETIC_GITHUB_TOKEN);
    expect(serialized).toContain('[REDACTED]');
    expect(JSON.parse(serialized).secrets).toEqual([
      { name: 'VERCEL_TOKEN', value: '[REDACTED]' },
      { name: 'DATABASE_URL', value: '[REDACTED]' },
      { name: 'NEON_API_KEY', value: '[REDACTED]' },
      { name: 'UPSTASH_REDIS_REST_TOKEN', value: '[REDACTED]' },
      { name: 'R2_ACCESS_KEY_ID', value: '[REDACTED]' },
      { name: 'R2_SECRET_ACCESS_KEY', value: '[REDACTED]' },
      { name: 'GITHUB_ACCESS_TOKEN', value: '[REDACTED]' },
      { name: 'GITHUB_WEBHOOK_SECRET', value: '[REDACTED]' },
    ]);
  });

  it('fails closed naming EVERY missing required variable (never a silent default)', () => {
    const source = fullPreviewSource();
    const holes = { ...source };
    delete holes['VERCEL_TOKEN'];
    delete holes['DATABASE_URL'];
    delete holes['GITHUB_WEBHOOK_SECRET'];
    expect(() => loadEnvironment('preview', holes)).toThrow(EnvironmentValidationError);
    try {
      loadEnvironment('preview', holes);
      expect.unreachable('loadEnvironment must fail closed');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('VERCEL_TOKEN');
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('GITHUB_WEBHOOK_SECRET');
      expect(message).toContain("tier 'preview'");
      expect(message).toContain('fail-closed');
    }
  });

  it('rejects empty-string values for required variables (empty is missing)', () => {
    const source = { ...fullPreviewSource(), VERCEL_TOKEN: '' };
    expect(() => loadEnvironment('preview', source)).toThrow(/VERCEL_TOKEN/);
  });

  it('validates shapes with typed errors that never embed the value', () => {
    expect(() => validateValueShape('APP_BASE_URL', 'https-url', 'http://not-https.example')).toThrow(
      /APP_BASE_URL.*https/,
    );
    expect(() => validateValueShape('DATABASE_URL', 'postgres-url', 'https://example.com/db')).toThrow(
      /DATABASE_URL.*postgres/,
    );
    expect(() => validateValueShape('VERCEL_TOKEN', 'token', 'short')).toThrow(/VERCEL_TOKEN.*too short/);
    expect(() => validateValueShape('VERCEL_APP_ROOT', 'relative-path', '/abs/path')).toThrow(
      /VERCEL_APP_ROOT.*relative/,
    );
    expect(() => validateValueShape('VERCEL_APP_ROOT', 'relative-path', 'apps/../etc')).toThrow(
      /VERCEL_APP_ROOT.*traverse/,
    );
    expect(() => validateValueShape('R2_BUCKET_NAME', 'lowercase-identifier', 'Bad-Bucket')).toThrow(
      /R2_BUCKET_NAME.*lowercase/,
    );
    expect(() => loadEnvironment('preview', { ...fullPreviewSource(), APP_BASE_URL: 'ftp://bad' })).toThrow(
      EnvironmentValidationError,
    );
  });

  it('rejects non-string values without coercion', () => {
    const bad = { ...fullPreviewSource(), R2_BUCKET_NAME: 42 as unknown as string };
    expect(() => loadEnvironment('preview', bad)).toThrow(/R2_BUCKET_NAME.*must be a string/);
  });

  it('applies documented LOCAL fixture defaults ONLY for the local tier', () => {
    const record = loadEnvironment('local', localSource());
    expect(record.tier).toBe('local');
    expect(record.missing).toEqual([]);
    expect(record.fixtureNames).toContain('APP_BASE_URL');
    expect(record.fixtureNames).toContain('VERCEL_APP_ROOT');
    expect(record.fixtureNames).toContain('DATABASE_URL');
    expect(record.fixtureNames).toContain('NEON_DATABASE_NAME');
    expect(record.fixtureNames).toContain('R2_BUCKET_NAME');
    const publicVar = record.vars.find((v) => v.name === 'APP_BASE_URL');
    expect(publicVar?.source).toBe('local-fixture');
    // The fixture is visibly marked in the serialized view.
    expect(serializeEnvironment(record)).toContain('local-fixture');
  });

  it('never leaks fixture defaults into preview/production (loader tier gate)', () => {
    // NEON_DATABASE_NAME is fixture-default for local but REQUIRED for preview:
    // a preview source missing it fails even though a fixture value exists.
    const missingNeon = { ...fullPreviewSource() };
    delete missingNeon['NEON_DATABASE_NAME'];
    expect(() => loadEnvironment('preview', missingNeon)).toThrow(/NEON_DATABASE_NAME/);
    const missingNeonProd = { ...fullProductionSource() };
    delete missingNeonProd['NEON_DATABASE_NAME'];
    expect(() => loadEnvironment('production', missingNeonProd)).toThrow(/NEON_DATABASE_NAME/);
  });

  it('records unknown variables as extras and captures secret-shaped extras as secrets', () => {
    const source = {
      ...fullPreviewSource(),
      EXTRA_PUBLIC_NOTE: 'not-secret',
      NEW_PROVIDER_TOKEN: 'synthetic-extra-token-000000000001',
    };
    const record = loadEnvironment('preview', source);
    expect(record.extraNames).toContain('EXTRA_PUBLIC_NOTE');
    expect(record.secretNames).toContain('NEW_PROVIDER_TOKEN');
    expect(serializeEnvironment(record)).not.toContain('synthetic-extra-token-000000000001');
    expect(record.getSecretValue('NEW_PROVIDER_TOKEN')).toBe('synthetic-extra-token-000000000001');
  });

  it('keeps tier-inapplicable variables out of the record (recorded as extras, not consumed)', () => {
    const source = { ...fullPreviewSource(), BODY_PROVIDER_API_KEY: 'synthetic-body-key-00000000001' };
    const record = loadEnvironment('preview', source); // optional for preview — consumed
    expect(record.secretNames).toContain('BODY_PROVIDER_API_KEY');
    const local = loadEnvironment('local', { NEON_API_KEY: 'synthetic-neon-key-000000000001' });
    expect(local.extraNames).not.toContain('NEON_API_KEY'); // captured as SECRET extra, not public extra
    expect(local.secretNames).toContain('NEON_API_KEY');
  });
});
