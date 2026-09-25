/**
 * P17-C deterministic reference-mode acceptance suite (5/6): the
 * redaction-corpus alignment — the P17-C redaction patterns (imported
 * through the test-time alias, the tests/accessibility precedent) align
 * with the merged @sos-2/security SECRET_SHAPE_PATTERNS corpus: the
 * twelve shared ids exist in both corpora with equivalent detection
 * verdicts; the two P17-C lane additions (vercel-access-token,
 * bearer-token-value) cover the providers this lane talks to.
 *
 * All token-shaped strings below are SYNTHETIC (fragment-assembled,
 * never real credentials — the W17 synthetic-secret discipline).
 */

import { describe, expect, it } from 'vitest';
import { SECRET_SHAPE_PATTERNS, redactSecretShapes } from '@sos-2/security';
import { OBSERVATION_REDACTION_PATTERNS, LANE_ADDITION_PATTERNS, redactObservationSecrets } from '@sos-2/real-observation';

const SAMPLES = [
  `github classic pat ghp_${'a'.repeat(36)}`,
  `fine grained github_pat_${'b'.repeat(36)}`,
  `app secret ghs_${'c'.repeat(36)}`,
  'slack xoxb-1234567890abcdefghij',
  'aws AKIAIOSFODNN7EXAMPLE',
  '-----BEGIN RSA PRIVATE KEY-----',
  'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  'postgres://user:pass@host:5432/db',
  'redis://user:pass@host:6379',
  'https://user:pass@example.com/path',
  'API_TOKEN=abcdefghijklmnopqrstuvwx',
  `sk-proj-${'d'.repeat(24)}`,
] as const;

describe('the redaction corpus alignment with the merged security corpus', () => {
  it('carries every merged pattern id (the twelve shared shapes)', () => {
    const mergedIds = SECRET_SHAPE_PATTERNS.map((pattern) => pattern.id);
    const laneIds = OBSERVATION_REDACTION_PATTERNS.map((pattern) => pattern.id);
    for (const id of mergedIds) {
      expect(laneIds).toContain(id);
    }
  });

  it('adds exactly the two lane additions for the P17-C providers', () => {
    expect(LANE_ADDITION_PATTERNS.map((pattern) => pattern.id).sort()).toEqual(['bearer-token-value', 'vercel-access-token']);
  });

  it('redacts every merged sample at least as strongly as the merged corpus (equivalent verdicts)', () => {
    for (const sample of SAMPLES) {
      const merged = redactSecretShapes(sample);
      const lane = redactObservationSecrets(sample);
      // every shape the merged corpus redacts, the lane corpus redacts too
      const mergedIds = merged.redactions.map((finding) => finding.patternId);
      const laneIds = lane.findings.map((finding) => finding.patternId);
      for (const id of mergedIds) {
        expect(laneIds).toContain(id);
      }
      // and the redacted text carries no residue of the sample's secret
      expect(lane.redacted).not.toContain(sample.split(' ').pop() ?? 'unreachable');
    }
  });

  it('redacts the P17-C lane token shapes the merged corpus does not know (vcp_…, Bearer …)', () => {
    const vercelToken = `vcp_${'e'.repeat(36)}`;
    const bearerValue = `Bearer ${'fQAAAAAAA'.repeat(6)}`;
    const text = `token ${vercelToken} and ${bearerValue}`;
    const merged = redactSecretShapes(text);
    expect(merged.redactions.length).toBe(0); // the merged corpus does not know these shapes
    const lane = redactObservationSecrets(text);
    expect(lane.findings.map((finding) => finding.patternId).sort()).toEqual(['bearer-token-value', 'vercel-access-token']);
    expect(lane.redacted).not.toContain(vercelToken);
    expect(lane.redacted).not.toContain(bearerValue);
  });

  it('leaves ordinary prose untouched (anchored patterns, no over-redaction)', () => {
    const text = 'the deployment dpl_abc123 for production answered HTTP 200 with github.v3';
    const lane = redactObservationSecrets(text);
    expect(lane.findings).toEqual([]);
    expect(lane.redacted).toBe(text);
  });
});
