/**
 * Secret policy tests (Work Order P3): detection of secret-shaped values,
 * redaction, names-only presence validation, and the never-echoed rule.
 */

import {
  SECRET_SHAPE_PATTERNS,
  assertNoSecretsInTexts,
  assertRequiredSecretsPresent,
  isSecretClassified,
  redactRawSource,
  redactSecrets,
  scanTextForSecrets,
} from '../src/secrets/policy.ts';
import { SecretPolicyError } from '../src/core/types.ts';
import {
  SYNTHETIC_AWS_KEY,
  SYNTHETIC_GITHUB_TOKEN,
  SYNTHETIC_POSTGRES_URL,
  fullProductionSource,
  fullPreviewSource,
} from './fixtures.ts';

describe('secret-shape detection', () => {
  it('detects the synthetic corpus across pattern families', () => {
    const findings = scanTextForSecrets('fixture-file.env', [
      `GITHUB_TOKEN=${SYNTHETIC_GITHUB_TOKEN}`,
      `AWS_KEY=${SYNTHETIC_AWS_KEY}`,
      `DATABASE_URL=${SYNTHETIC_POSTGRES_URL}`,
      '-----BEGIN RSA PRIVATE KEY-----',
      'normal line with no secrets',
    ].join('\n'));
    const ids = findings.map((f) => f.patternId);
    expect(ids).toContain('github-pat-classic');
    expect(ids).toContain('aws-access-key-id');
    expect(ids).toContain('postgres-url-with-credentials');
    expect(ids).toContain('private-key-block');
    // Findings carry positions, never values.
    for (const finding of findings) {
      expect(JSON.stringify(finding)).not.toContain('sup3rs3cretpw');
      expect(JSON.stringify(finding)).not.toContain(SYNTHETIC_GITHUB_TOKEN);
    }
  });

  it('detects generic secret assignments, JWTs and provider keys', () => {
    const findings = scanTextForSecrets('x', [
      'MY_SECRET_VALUE="abcdefghij1234567890abcd"',
      'AUTH=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92KmatuhQjNK',
      'OPENAI_KEY=sk-abcdefghijklmnopqrstuvwx',
    ].join('\n'));
    const ids = findings.map((f) => f.patternId);
    expect(ids).toContain('generic-secret-assignment');
    expect(ids).toContain('jwt');
    expect(ids).toContain('openai-style-api-key');
  });

  it('does not flag ordinary prose or config', () => {
    const clean = [
      '# Free-tier deployment foundation',
      'APP_BASE_URL=https://sos.example.org',
      'VERCEL_APP_ROOT=apps/web',
      'The quick brown fox jumps over the lazy dog.',
    ].join('\n');
    expect(scanTextForSecrets('README.md', clean)).toEqual([]);
  });

  it('reports findings in deterministic (line, column, pattern) order', () => {
    const text = [`A=${SYNTHETIC_AWS_KEY}`, `B=${SYNTHETIC_GITHUB_TOKEN}`].join('\n');
    const first = scanTextForSecrets('t', text);
    const second = scanTextForSecrets('t', text);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThanOrEqual(2);
    const orderedLines = first.map((f) => f.line);
    expect([...orderedLines].sort((a, b) => a - b)).toEqual(orderedLines);
  });
});

describe('secret redaction', () => {
  it('redacts matched values to pattern-id markers carrying no value material', () => {
    const redacted = redactSecrets(`token=${SYNTHETIC_GITHUB_TOKEN} and key=${SYNTHETIC_AWS_KEY}`);
    expect(redacted).not.toContain(SYNTHETIC_GITHUB_TOKEN);
    expect(redacted).not.toContain(SYNTHETIC_AWS_KEY);
    expect(redacted).toContain('[REDACTED:github-pat-classic]');
    expect(redacted).toContain('[REDACTED:aws-access-key-id]');
  });

  it('produces a log-safe view of a raw source (registry + shape classification)', () => {
    const view = redactRawSource(fullPreviewSource());
    expect(view['VERCEL_PROJECT_ID']).toBe('prj_preview_0123456789'); // public passes through
    expect(view['VERCEL_TOKEN']).toBe('[REDACTED]');
    expect(view['GITHUB_ACCESS_TOKEN']).toBe('[REDACTED]');
    expect(JSON.stringify(view)).not.toContain('whsec-synthetic');
    expect(isSecretClassified('GITHUB_WEBHOOK_SECRET')).toBe(true);
    expect(isSecretClassified('NEW_UNSET_TOKEN')).toBe(true);
  });
});

describe('names-only presence validation', () => {
  it('passes when every required secret is present, without echoing values', () => {
    expect(() => assertRequiredSecretsPresent('production', fullProductionSource())).not.toThrow();
  });

  it('fails closed naming ONLY the missing secret variables', () => {
    const holes = { ...fullProductionSource() };
    delete holes['R2_SECRET_ACCESS_KEY'];
    delete holes['GITHUB_ACCESS_TOKEN'];
    try {
      assertRequiredSecretsPresent('production', holes);
      expect.unreachable('must fail closed');
    } catch (error) {
      expect(error).toBeInstanceOf(SecretPolicyError);
      const message = (error as Error).message;
      expect(message).toContain('R2_SECRET_ACCESS_KEY');
      expect(message).toContain('GITHUB_ACCESS_TOKEN');
      expect(message).toContain('names only');
      expect(message).not.toContain(SYNTHETIC_GITHUB_TOKEN);
    }
  });
});

describe('assertNoSecretsInTexts (the CI gate semantics)', () => {
  it('passes for clean deliverable texts', () => {
    expect(() =>
      assertNoSecretsInTexts({
        'infra/deployment/README.md': '# deployment contracts\nno secrets here',
        '.github/workflows/deploy-contract.yml': 'name: deploy\nrun: pnpm install',
      }),
    ).not.toThrow();
  });

  it('fails with labels + pattern ids + positions and NEVER the values', () => {
    try {
      assertNoSecretsInTexts({
        'infra/deployment/config.env': `PROD_TOKEN=${SYNTHETIC_GITHUB_TOKEN}`,
      });
      expect.unreachable('must fail');
    } catch (error) {
      expect(error).toBeInstanceOf(SecretPolicyError);
      const message = (error as Error).message;
      expect(message).toContain('infra/deployment/config.env');
      expect(message).toContain('github-pat-classic');
      expect(message).not.toContain(SYNTHETIC_GITHUB_TOKEN);
    }
  });

  it('the pattern corpus stays deterministic (no dynamic regex flags)', () => {
    for (const pattern of SECRET_SHAPE_PATTERNS) {
      expect(pattern.pattern.global).toBe(true);
      expect(pattern.id.length).toBeGreaterThan(0);
    }
  });
});
