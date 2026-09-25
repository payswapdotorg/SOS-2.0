// No vitest import: the borrowed toolchain runs with `globals: true`
// (the P3 infra-deployment precedent for zero-dependency packages).
//
// SYNTHETIC FIXTURES: every secret-shaped value below is ASSEMBLED from
// fragments (the P3 test-corpus technique) so that no real-shaped secret
// literal ever appears in this file's content — the fixtures are
// synthetic detection-corpus proofs, never credentials.
import {
  scanForSecretShapes,
  redactSecretShapes,
  inspectEmission,
  assertNoSecretLeak,
  SECRET_PATTERN_IDS,
  SecretLeakError,
} from '../src/index.js';

const GITHUB_TOKEN = ['ghp', '_', 'AbCdEfGhIjKlMnOpQrStUvWxYz012345'].join('');
const SLACK_TOKEN = ['xoxb', '-', '1234567890', 'abcdefghij'].join('');
const GITHUB_TOKEN_LINE = `token=${GITHUB_TOKEN} done`;
const SLACK_LINE = `SLACK_TOKEN=${SLACK_TOKEN}`;
const POSTGRES_URL = ['postgres', '://', 'user', ':', 'hunter2secret', '@host', '/db'].join('');
const CLEAN_LINE = 'the build finished in 12s with 0 failures';

describe('secrets isolation (pinned: no secret leakage through artifacts/logs)', () => {
  it('scans clean text with zero findings', () => {
    expect(scanForSecretShapes(CLEAN_LINE)).toEqual([]);
  });

  it('detects secret-shaped values and reports positions + pattern ids, never matched text', () => {
    const findings = scanForSecretShapes(GITHUB_TOKEN_LINE);
    expect(findings.length).toBe(1);
    const finding = findings[0];
    expect(finding?.patternId).toBe('github-pat-classic');
    expect(finding?.line).toBe(1);
    expect(finding?.column).toBe(7);
    expect(JSON.stringify(findings)).not.toContain(GITHUB_TOKEN);
  });

  it('detects multiple findings across lines, sorted deterministically (overlapping patterns both reported)', () => {
    const text = `${CLEAN_LINE}\n${GITHUB_TOKEN_LINE}\n${SLACK_LINE}\n${CLEAN_LINE}`;
    const findings = scanForSecretShapes(text);
    // SLACK_TOKEN=xoxb-… matches BOTH generic-secret-assignment and
    // slack-bot-token — the scanner reports every matching shape.
    expect(findings.map((f) => f.patternId)).toEqual([
      'github-pat-classic',
      'generic-secret-assignment',
      'slack-bot-token',
    ]);
    expect(findings.map((f) => f.line)).toEqual([2, 3, 3]);
  });

  it('the corpus is the twelve-pattern P3-aligned vocabulary', () => {
    expect(SECRET_PATTERN_IDS).toEqual([
      'github-pat-classic',
      'github-pat-fine-grained',
      'github-oauth-app-secret',
      'slack-bot-token',
      'aws-access-key-id',
      'private-key-block',
      'jwt',
      'postgres-url-with-credentials',
      'redis-url-with-credentials',
      'url-with-basic-auth',
      'generic-secret-assignment',
      'openai-style-api-key',
    ]);
  });

  it('PINNED: a body emitting a secret-shaped value into an artifact is REDACTED (policy REDACT_AND_PASS) and the redaction is observed', () => {
    const outcome = inspectEmission({
      emissionId: 'artifact-1',
      taskId: 'task-1',
      bodyId: 'body-1',
      destination: 'artifact',
      content: `build log header\n${GITHUB_TOKEN_LINE}\nfooter`,
      policy: 'REDACT_AND_PASS',
    });
    expect(outcome.kind).toBe('PASSED_REDACTED');
    if (outcome.kind === 'PASSED_REDACTED') {
      expect(outcome.content).toContain('[REDACTED:github-pat-classic]');
      expect(outcome.content).not.toContain(GITHUB_TOKEN);
      expect(outcome.redactions.length).toBe(1);
      // the redaction itself is observed:
      expect(outcome.audit.surface).toBe('secret-isolation');
      expect(outcome.audit.emissionId).toBe('artifact-1');
      expect(outcome.audit.taskId).toBe('task-1');
      expect(outcome.audit.bodyId).toBe('body-1');
      expect(outcome.audit.destination).toBe('artifact');
      expect(outcome.audit.matchedPatternIds).toEqual(['github-pat-classic']);
    }
  });

  it('PINNED: a secret-shaped emission under DENY policy is blocked and never copies the leaked content into the outcome', () => {
    const outcome = inspectEmission({
      emissionId: 'log-1',
      taskId: 'task-1',
      bodyId: 'body-1',
      destination: 'log',
      content: GITHUB_TOKEN_LINE,
      policy: 'DENY',
    });
    expect(outcome.kind).toBe('DENIED_SECRET_LEAK');
    if (outcome.kind === 'DENIED_SECRET_LEAK') {
      expect(outcome.patternIds).toEqual(['github-pat-classic']);
      expect(JSON.stringify(outcome)).not.toContain(GITHUB_TOKEN);
      expect(outcome.audit.destination).toBe('log');
    }
    expect(() =>
      assertNoSecretLeak({
        emissionId: 'log-1',
        taskId: null,
        bodyId: null,
        destination: 'log',
        content: GITHUB_TOKEN_LINE,
        policy: 'DENY',
      }),
    ).toThrow(SecretLeakError);
  });

  it('redaction removes every secret shape (double-scan is clean; overlapping spans redact once, most specific pattern named)', () => {
    const text = `${GITHUB_TOKEN_LINE}\n${SLACK_LINE}\n${POSTGRES_URL}`;
    const { redacted, redactions } = redactSecretShapes(text);
    expect(redactions.map((r) => r.patternId)).toEqual([
      'github-pat-classic',
      'slack-bot-token',
      'postgres-url-with-credentials',
    ]);
    expect(scanForSecretShapes(redacted)).toEqual([]);
    expect(redacted).toContain('token=[REDACTED:github-pat-classic]');
    expect(redacted).toContain('SLACK_TOKEN=[REDACTED:slack-bot-token]');
    expect(redacted).toContain('[REDACTED:postgres-url-with-credentials]');
  });

  it('multiple secret shapes on ONE line are all redacted with correct positions', () => {
    const line = `prefix ${GITHUB_TOKEN} middle ${SLACK_TOKEN} suffix`;
    const { redacted, redactions } = redactSecretShapes(line);
    expect(redactions.map((r) => r.patternId)).toEqual(['github-pat-classic', 'slack-bot-token']);
    expect(redacted).toBe(`prefix [REDACTED:github-pat-classic] middle [REDACTED:slack-bot-token] suffix`);
  });

  it('a malformed inspection input is rejected (never passed)', () => {
    expect(() =>
      inspectEmission({
        emissionId: '',
        taskId: null,
        bodyId: null,
        destination: 'log',
        content: 'x',
        policy: 'REDACT_AND_PASS',
      }),
    ).toThrow(SecretLeakError);
  });
});
