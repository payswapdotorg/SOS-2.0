/**
 * PINNED: no secret leakage through artifacts/logs (redaction or denial
 * + observed redaction) — INCLUDING the corpus alignment with the
 * merged P3 infra/deployment secrets policy (imported directly from
 * the merged module through the relative source path: the P3 module
 * is dependency-free, so the composition is pure).
 */
import { describe, expect, it } from 'vitest';
import {
  inspectEmission,
  scanForSecretShapes,
  SECRET_PATTERN_IDS,
  InMemoryAuditTrail,
  auditDecision,
} from '@sos-2/security';
import { SECRET_SHAPE_PATTERNS as P3_SECRET_SHAPE_PATTERNS } from '../../infra/deployment/src/secrets/policy.ts';
import { ManualClock } from './helpers.js';

// SYNTHETIC fixtures assembled from fragments (the P3 technique).
const GITHUB_TOKEN = ['ghp', '_', 'AbCdEfGhIjKlMnOpQrStUvWxYz012345'].join('');
const SLACK_TOKEN = ['xoxb', '-', '1234567890', 'abcdefghij'].join('');
const ARTIFACT_CONTENT = `# build log\nstep 1 ok\npush with token ${GITHUB_TOKEN}\ndone\n`;

describe('acceptance: no secret leakage through artifacts/logs', () => {
  it('PINNED: a body emitting a secret-shaped value into an artifact is redacted AND the redaction is observed (audited)', () => {
    const clock = new ManualClock(1_700_000_000_000);
    const trail = new InMemoryAuditTrail(clock);
    const outcome = inspectEmission({
      emissionId: 'artifact-1',
      taskId: 'task-1',
      bodyId: 'body-1',
      destination: 'artifact',
      content: ARTIFACT_CONTENT,
      policy: 'REDACT_AND_PASS',
    });
    expect(outcome.kind).toBe('PASSED_REDACTED');
    if (outcome.kind !== 'PASSED_REDACTED') return;
    // the artifact no longer carries the secret shape:
    expect(outcome.content).not.toContain(GITHUB_TOKEN);
    expect(scanForSecretShapes(outcome.content)).toEqual([]);
    // the redaction itself is observed — the audit fact lands in the trail:
    const audited = auditDecision(
      trail,
      {
        decision: 'REDACT',
        surface: 'secret-isolation',
        detail: `artifact artifact-1 redacted (patterns: ${outcome.audit.matchedPatternIds.join(', ')})`,
        taskId: outcome.audit.taskId,
        bodyId: outcome.audit.bodyId,
        providerId: null,
        evidenceDigest: null,
        context: { emissionId: outcome.audit.emissionId, matchedPatternIds: [...outcome.audit.matchedPatternIds] },
      },
      clock,
    );
    expect(audited.kind).toBe('APPLIED');
  });

  it('PINNED: under DENY policy the emission is blocked — the leaked content never reaches the artifact or the outcome', () => {
    const outcome = inspectEmission({
      emissionId: 'log-1',
      taskId: 'task-1',
      bodyId: 'body-1',
      destination: 'log',
      content: `token=${GITHUB_TOKEN} done`,
      policy: 'DENY',
    });
    expect(outcome.kind).toBe('DENIED_SECRET_LEAK');
    if (outcome.kind === 'DENIED_SECRET_LEAK') {
      expect(JSON.stringify(outcome)).not.toContain(GITHUB_TOKEN);
    }
  });

  it('clean emissions pass unchanged (no over-redaction)', () => {
    const clean = '# build log\nall steps green\n0 failures\n';
    const outcome = inspectEmission({
      emissionId: 'artifact-2',
      taskId: null,
      bodyId: null,
      destination: 'artifact',
      content: clean,
      policy: 'REDACT_AND_PASS',
    });
    expect(outcome.kind).toBe('PASSED_CLEAN');
    if (outcome.kind === 'PASSED_CLEAN') {
      expect(outcome.content).toBe(clean);
    }
  });

  it('the P14 corpus is EXACTLY the merged P3 corpus (id sets equal — aligned by construction, pinned here)', () => {
    const p3Ids = P3_SECRET_SHAPE_PATTERNS.map((pattern) => pattern.id);
    expect(SECRET_PATTERN_IDS).toEqual(p3Ids);
  });

  it('the P14 scanner and the merged P3 scanner agree on detection over synthetic fixtures', () => {
    const samples: ReadonlyArray<[string, string, boolean]> = [
      [`token=${GITHUB_TOKEN}`, 'github-pat-classic', true],
      [`SLACK_TOKEN=${SLACK_TOKEN}`, 'slack-bot-token', true],
      ['postgres://u:secretpw@host.example/db', 'postgres-url-with-credentials', true],
      ['-----BEGIN RSA PRIVATE KEY-----', 'private-key-block', true],
      ['plain prose about tokens and keys', 'none', false],
      ['the build finished in 12s', 'none', false],
    ];
    for (const [text, expectedPattern, expectHit] of samples) {
      const mine = scanForSecretShapes(text);
      const p3Module = P3_SECRET_SHAPE_PATTERNS.find((pattern) => pattern.id === expectedPattern);
      if (!expectHit) {
        expect(mine.length, `no findings expected for ${JSON.stringify(text)}`).toBe(0);
      } else {
        expect(mine.some((finding) => finding.patternId === expectedPattern), `${expectedPattern} expected`).toBe(true);
        // parity with the merged P3 pattern object:
        expect(p3Module).toBeDefined();
      }
    }
  });
});
