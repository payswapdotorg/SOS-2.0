/**
 * LANE C, NEGATIVE CASE 14 — SECRET LEAKAGE ATTEMPT (the P14
 * secrets-by-reference discipline: secrets never appear in
 * evidence/records; leakage attempts are detected and contained).
 *
 * The fault: a body emits secret-shaped VALUES into an artifact/log.
 * The observation boundary CONTAINS it: under REDACT_AND_PASS the
 * secret is redacted AND the redaction itself is observed (audited);
 * under DENY the emission is blocked and the leaked content never
 * reaches the artifact OR the outcome record. At the product surface,
 * the secrets-by-reference discipline holds across a whole flagship
 * journey: the sandbox policy references secrets BY NAME only, and a
 * scan over EVERY produced evidence record, action event, observation
 * event and the completion report finds ZERO secret-shaped values.
 * Never a silent pass (an unredacted leak), never a crash.
 */

import { describe, expect, test } from 'vitest';
import { InMemoryAuditTrail, auditDecision, inspectEmission, scanForSecretShapes } from '@sos-2/security';
import {
  LEAKY_ARTIFACT,
  SYNTHETIC_GITHUB_TOKEN,
  SYNTHETIC_SLACK_TOKEN,
  assertProductGraphQueryableAndTruthful,
  createProductWorld,
  driveOnCloudTicks,
  startFlagshipJourney,
  PolicyManualClock,
} from './helpers.js';

const NOW = 1_700_000_000_000;

/** Scan every serialized record of a pool for BOTH synthetic secret shapes (+ the shape scanner). */
function scanPool(pool: readonly unknown[], label: string): number {
  let findings = 0;
  for (const entry of pool) {
    const serialized = JSON.stringify(entry) ?? '';
    if (serialized.includes(SYNTHETIC_GITHUB_TOKEN) || serialized.includes(SYNTHETIC_SLACK_TOKEN)) {
      findings += 1;
      continue;
    }
    const shapes = scanForSecretShapes(serialized);
    if (shapes.length > 0) {
      expect(shapes, `${label}: an unexpected secret shape leaked (${shapes.map((shape) => shape.patternId).join(', ')})`).toHaveLength(0);
      findings += shapes.length;
    }
  }
  return findings;
}

describe('P15 lane C negative case: secret leakage attempt', () => {
  test('CONTAINED (REDACT_AND_PASS): a secret-shaped emission is redacted AND the redaction is observed (audited)', () => {
    const clock = new PolicyManualClock(NOW);
    const trail = new InMemoryAuditTrail(clock);
    const outcome = inspectEmission({
      emissionId: 'artifact-p15c-14-1',
      taskId: 'task-p15c-14',
      bodyId: 'body-p15c-14',
      destination: 'artifact',
      content: LEAKY_ARTIFACT,
      policy: 'REDACT_AND_PASS',
    });
    expect(outcome.kind).toBe('PASSED_REDACTED');
    if (outcome.kind !== 'PASSED_REDACTED') throw new Error('unreachable: the leaky artifact is redacted');
    // The artifact no longer carries the secret shape:
    expect(outcome.content).not.toContain(SYNTHETIC_GITHUB_TOKEN);
    expect(scanForSecretShapes(outcome.content)).toEqual([]);
    // The redaction itself is observed — the audit fact lands in the trail:
    const audited = auditDecision(
      trail,
      {
        decision: 'REDACT',
        surface: 'secret-isolation',
        detail: `artifact artifact-p15c-14-1 redacted (patterns: ${outcome.audit.matchedPatternIds.join(', ')})`,
        taskId: outcome.audit.taskId,
        bodyId: outcome.audit.bodyId,
        providerId: null,
        evidenceDigest: null,
        context: { emissionId: outcome.audit.emissionId, matchedPatternIds: [...outcome.audit.matchedPatternIds] },
      },
      clock,
    );
    expect(audited.kind).toBe('APPLIED');
    const auditedRecord = trail.history()[0]!;
    expect((auditedRecord.payload as Record<string, unknown>)['decision']).toBe('REDACT');
    expect(auditedRecord.source).toContain('secret-isolation');
  });

  test('CONTAINED (DENY): the leaked content never reaches the artifact OR the outcome record', () => {
    const outcome = inspectEmission({
      emissionId: 'log-p15c-14-1',
      taskId: 'task-p15c-14',
      bodyId: 'body-p15c-14',
      destination: 'log',
      content: `token=${SYNTHETIC_GITHUB_TOKEN} done`,
      policy: 'DENY',
    });
    expect(outcome.kind).toBe('DENIED_SECRET_LEAK');
    if (outcome.kind === 'DENIED_SECRET_LEAK') {
      // The outcome record itself never echoes the secret value.
      expect(JSON.stringify(outcome)).not.toContain(SYNTHETIC_GITHUB_TOKEN);
      expect(JSON.stringify(outcome)).not.toContain(SYNTHETIC_SLACK_TOKEN);
    }
  });

  test('DETECTED: the scanner recognizes the synthetic secret shapes (the detection itself is exercised)', () => {
    const githubFindings = scanForSecretShapes(`push with token ${SYNTHETIC_GITHUB_TOKEN}`);
    expect(githubFindings.length).toBeGreaterThan(0);
    const slackFindings = scanForSecretShapes(`SLACK_TOKEN=${SYNTHETIC_SLACK_TOKEN}`);
    expect(slackFindings.length).toBeGreaterThan(0);
    // Clean prose stays clean (no over-redaction).
    expect(scanForSecretShapes('plain prose about tokens and keys — the build finished in 12s')).toEqual([]);
  });

  test('SECRETS-BY-REFERENCE (product surface): a full flagship journey produces ZERO secret-shaped values in every record a user can see', async () => {
    const world = createProductWorld();
    await startFlagshipJourney(world);
    await driveOnCloudTicks(world);
    expect(world.journey.state().stage).toBe('COMPLETED');

    // The journey's bodies carried secrets BY REFERENCE ONLY (the sandbox
    // policy names 'github-token'; no value ever existed in the world).
    // Scan EVERY produced surface:
    expect(scanPool(world.evidence.all(), 'gateway evidence')).toBe(0);
    expect(scanPool(world.actionEvents.entries(), 'action events')).toBe(0);
    const observations = await world.store.observationEvents.list({ limit: null });
    expect(observations.items.length).toBeGreaterThan(0);
    expect(scanPool(observations.items, 'observation events')).toBe(0);
    expect(scanPool([world.journey.completionReport()!], 'completion report')).toBe(0);
    const tasks = await world.store.tasks.list({ limit: null });
    expect(scanPool(tasks.items, 'durable task records')).toBe(0);

    // The evidence graph stays queryable and truthful after the scans.
    await assertProductGraphQueryableAndTruthful(world);
  });
});
