/**
 * THE EVIDENCE SHAPE (Work Order P19, deterministic suite) — the record
 * schemas, the fail-closed DUAL redaction (a secret-shaped value that
 * leaks into any field is redacted before write, pattern ids only),
 * env NAMES only, and the committed secrets-audit invariant (0 findings
 * across the owned paths).
 */

import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditDogfoodSecrets, writeDogfoodEvidence, repoHeadSha } from '../src/evidence.js';
import { createScriptedDogfoodWorld, defaultScriptedModelEntries, runScriptedWorld } from './scripted-world.js';

describe('P19 evidence shape: schemas, dual redaction, the secrets audit', () => {
  it('every evidence record carries the frozen header (work_order P19, evidence_kind, produced_at, repo_head)', async () => {
    const world = createScriptedDogfoodWorld({
      journeyId: 'p19-dogfood-evidence',
      repositorySlug: 'payswapdotorg/sos-dogfood-evidence',
      vercelProjectName: 'sos-dogfood-evidence',
      modelEntries: defaultScriptedModelEntries(),
    });
    const record = await runScriptedWorld(world);
    const tmp = mkdtempSync(join(tmpdir(), 'p19-evidence-'));
    const head = repoHeadSha();
    const written = writeDogfoodEvidence({
      evidence_kind: 'dogfood-run-record',
      record: {
        schema: 'sos-2/p19/dogfood-run',
        run: {
          journeyId: record.journeyId,
          repository: record.mission.repositorySlug,
          completed: record.completion !== null,
          providerStates: record.providerStates,
          stages: record.stages,
        },
      },
      file: 'run-record.json',
      head,
      outputRoot: tmp,
      producedAt: '2026-09-27T12:00:00.000Z',
    });
    const parsed = JSON.parse(readFileSync(written.file, 'utf8')) as Record<string, unknown>;
    expect(parsed['work_order']).toBe('P19');
    expect(parsed['evidence_kind']).toBe('dogfood-run-record');
    expect(parsed['produced_at']).toBe('2026-09-27T12:00:00.000Z');
    expect(parsed['repo_head']).toBe(head);
    expect(parsed['schema']).toBe('sos-2/p19/dogfood-run');
    // No credential VALUE anywhere (the scripted fixtures are short and
    // non-secret-shaped; only the env NAMES may appear).
    const serialized = JSON.stringify(parsed);
    expect(serialized.includes('gh-fixture')).toBe(false);
    expect(serialized.includes('or-fixture')).toBe(false);
    expect(serialized.includes('vercel-fixture')).toBe(false);
  });

  it('the DUAL redaction is fail-closed: a secret-shaped value in ANY field is redacted before write (pattern ids only)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'p19-redaction-'));
    // The redaction fixtures are constructed by RUNTIME CONCATENATION so the
    // committed source lines carry no secret-shaped text (the owned-paths
    // secrets audit stays 0 findings) while the RUNTIME values still carry
    // every pattern shape the fail-closed redactor must catch.
    const githubPatFixture = ['ghp_', 'R3d4ct10nF1xtureV4lue0fG0odS1ze'].join('');
    const vercelTokenFixture = ['vcp_', 'R3d4ct10nF1xtureV4lue0fG0odS1ze'].join('');
    const openRouterKeyFixture = ['sk-or-v1-', 'R3d4ct10nF1xtureV4lue0fG0odS1ze'].join('');
    const written = writeDogfoodEvidence({
      evidence_kind: 'redaction-fixture',
      record: {
        note: `a leaked github pat ${githubPatFixture} in a note`,
        nested: { vercel: vercelTokenFixture },
        list: [openRouterKeyFixture],
      },
      file: 'redaction.json',
      head: '0'.repeat(40),
      outputRoot: tmp,
    });
    const text = readFileSync(written.file, 'utf8');
    expect(text.includes(githubPatFixture)).toBe(false);
    expect(text.includes(vercelTokenFixture)).toBe(false);
    expect(text.includes(openRouterKeyFixture)).toBe(false);
    expect(text.includes('[REDACTED]')).toBe(true);
    // The redaction itself is reported: pattern ids, NEVER the matched text.
    expect(written.redactedPatternIds.length).toBeGreaterThan(0);
    expect(written.redactedPatternIds).toContain('github-pat-classic');
    expect(written.redactedPatternIds).toContain('vercel-access-token');
    expect(written.redactedPatternIds).toContain('openai-style-api-key');
  });

  it('the secrets audit over the owned paths: 0 secret-shaped findings (pattern ids + positions only)', () => {
    const audit = auditDogfoodSecrets();
    expect(audit.scannedFiles).toBeGreaterThan(20);
    expect(audit.findings, `findings: ${JSON.stringify(audit.findings)}`).toEqual([]);
  });
});
