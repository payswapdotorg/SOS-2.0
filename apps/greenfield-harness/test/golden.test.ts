/**
 * The golden fixture discipline: rebuilding the golden scenario reproduces
 * the committed fixture BYTE-FOR-BYTE (string equality — the full pipeline
 * result including the trace graph, canonically serialized), and the run
 * satisfies the W14 acceptance end to end.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runGoldenScenario } from '../src/run.js';
import { canonicalSnapshot } from '../src/snapshot.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '..', 'fixtures', 'golden-run.json');

describe('golden fixture discipline', () => {
  it('rebuilding the golden scenario reproduces the committed fixture byte-for-byte', () => {
    const committed = readFileSync(fixturePath, 'utf8');
    const rebuilt = canonicalSnapshot(runGoldenScenario());
    expect(rebuilt).toBe(committed);
  });

  it('the golden run satisfies the W14 acceptance end to end', () => {
    const result = runGoldenScenario();
    // mission formalization: 2 MEASURABLE + 1 PROPOSED goals
    expect(result.summary.goals).toEqual({ total: 3, measurable: 2, proposed: 1 });
    // candidate composition at the highest validated altitude from 2 members
    expect(result.summary.candidate_altitude).toBe('VALIDATED_COMPOSITION');
    expect(result.summary.members).toBe(2);
    expect(result.summary.own_evidence_obligations).toBeGreaterThanOrEqual(3);
    // human decision flow: ACT under the covering grant
    expect(result.summary.decision.action).toBe('ACT');
    expect(result.summary.decision.approved).toBe(true);
    // traceable realization: a SystemState revision + declared architecture
    expect(result.summary.realization.revision_chain_length).toBe(1);
    expect(result.summary.realization.revision).toMatch(/^[0-9a-f]{40}$/);
    // architecture reconciliation: clean, one implementation detail
    expect(result.summary.reconciliation.clean).toBe(true);
    expect(result.summary.reconciliation.records).toBe(5);
    // evidence ingestion: truthful states
    expect(result.summary.evidence.records).toBe(3);
    expect(result.summary.evidence.availability.SUCCESS).toBe(2);
    expect(result.summary.evidence.availability.UNAVAILABLE).toBe(1);
    // the trace chain: complete and queryable
    expect(result.trace_chain.ok).toBe(true);
    expect(result.trace.path_state_to_mission).toHaveLength(3);
    expect(result.ok).toBe(true);
  });
});
