/**
 * Unit tests: the ladder trace builder and the §10 vocabulary import.
 */

import { describe, expect, it } from 'vitest';
import { RETRIEVAL_ALTITUDES } from '@sos-2/retrieval';
import { SEARCH_LADDER, buildLadderTrace, descentJustification } from '../src/index.js';
import type { LadderStep } from '../src/index.js';

describe('the §10 ladder vocabulary (imported, never redefined)', () => {
  it('SEARCH_LADDER is exactly the imported §10 retrieval-altitude ladder', () => {
    expect(SEARCH_LADDER).toEqual(RETRIEVAL_ALTITUDES);
    expect(SEARCH_LADDER).toEqual([
      'VALIDATED_COMPOSITION',
      'VALIDATED_PACKAGE',
      'PACKAGE_ADAPTATION',
      'ARCHITECTURE_PATTERN',
      'NOVEL_ARCHITECTURE',
      'LOW_LEVEL_SYNTHESIS',
    ]);
  });
});

describe('buildLadderTrace (the only trace constructor)', () => {
  it('accepts a satisfied-at-the-top trace (a single step)', () => {
    const trace = buildLadderTrace([
      { altitude: 'VALIDATED_COMPOSITION', outcome: 'SATISFIED', candidates_considered: 3, candidates_surviving: 2, rejected_ids: ['x'] },
    ]);
    expect(trace).toHaveLength(1);
    expect(trace[0]!.altitude).toBe('VALIDATED_COMPOSITION');
  });

  it('accepts a fully-descended empty trace (six steps, last without descent)', () => {
    const steps: LadderStep[] = RETRIEVAL_ALTITUDES.map((altitude, index) => ({
      altitude,
      outcome: 'NO_CANDIDATES' as const,
      candidates_considered: 0,
      candidates_surviving: 0,
      rejected_ids: [],
      descent:
        index < RETRIEVAL_ALTITUDES.length - 1
          ? { to: RETRIEVAL_ALTITUDES[index + 1]!, justification: descentJustification(altitude, RETRIEVAL_ALTITUDES[index + 1]!, 'NO_CANDIDATES', 0, [], 'cap') }
          : undefined,
    }));
    const trace = buildLadderTrace(steps);
    expect(trace).toHaveLength(6);
    expect(trace[5]!.descent).toBeUndefined();
  });

  it('accepts a constrained descent with a custom starting altitude (alternative engines)', () => {
    const trace = buildLadderTrace(
      [
        { altitude: 'NOVEL_ARCHITECTURE', outcome: 'ALL_REJECTED_BY_CONSTRAINTS', candidates_considered: 2, candidates_surviving: 0, rejected_ids: ['a', 'b'], descent: { to: 'LOW_LEVEL_SYNTHESIS', justification: 'both novel candidates violate the cost ceiling' } },
        { altitude: 'LOW_LEVEL_SYNTHESIS', outcome: 'SATISFIED', candidates_considered: 1, candidates_surviving: 1, rejected_ids: [] },
      ],
      { startingAltitude: 'NOVEL_ARCHITECTURE' },
    );
    expect(trace).toHaveLength(2);
  });

  it('rejects an empty trace (an honest trace is never empty)', () => {
    expect(() => buildLadderTrace([])).toThrow(/at least one step/);
  });
});

describe('descentJustification (deterministic, self-describing)', () => {
  it('documents empty rungs and constraint rejections distinctly', () => {
    const empty = descentJustification('VALIDATED_PACKAGE', 'PACKAGE_ADAPTATION', 'NO_CANDIDATES', 0, [], 'resize');
    expect(empty).toMatch(/yielded 0 candidates/);
    expect(empty).toMatch(/descending to PACKAGE_ADAPTATION/);
    const rejected = descentJustification('VALIDATED_PACKAGE', 'PACKAGE_ADAPTATION', 'ALL_REJECTED_BY_CONSTRAINTS', 2, ['a', 'b'], 'resize');
    expect(rejected).toMatch(/yielded 2 candidate/);
    expect(rejected).toMatch(/\[a, b\]/);
    expect(rejected).toMatch(/rejected by hard constraints/);
  });
});
