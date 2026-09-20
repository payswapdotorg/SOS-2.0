import { describe, expect, it } from 'vitest';
import {
  combineMemberProbabilities,
  INDEPENDENCE_BASES,
  isIndependenceBasis,
  assertValidIndependenceAssessment,
} from '../src/index.js';
import type { IndependenceJustification, MemberProbability } from '../src/index.js';
import { DURABLE_STORE_PACKAGE, GOLDEN_PACKAGE, GOLDEN_COMPOSITION } from './helpers.js';

const justification: IndependenceJustification = {
  basis: 'DESIGNED_ISOLATION',
  justification: 'members run in separate failure domains with disjoint codepaths (design review 2025-01)',
};

const members: MemberProbability[] = [
  { package_id: GOLDEN_PACKAGE.envelope.id, probability: 0.9 },
  { package_id: DURABLE_STORE_PACKAGE.envelope.id, probability: 0.8 },
];

describe('independence discipline (never P(A+B)=P(A)P(B) by default)', () => {
  it('REJECTS combining member probabilities WITHOUT a justification (the locked forbidden shortcut)', () => {
    expect(() => combineMemberProbabilities(members)).toThrow(/unjustified probability multiplication rejected/);
    expect(() => combineMemberProbabilities(members, undefined)).toThrow(
      /unjustified probability multiplication rejected/,
    );
    expect(() => combineMemberProbabilities(members, null as never)).toThrow(
      /unjustified probability multiplication rejected/,
    );
    // The error message names the rule explicitly.
    expect(() => combineMemberProbabilities(members)).toThrow(/P\(A\+B\)=P\(A\)P\(B\) by default/);
  });

  it('combines WITH an explicit justification: product value + method mark + carried justification', () => {
    const combined = combineMemberProbabilities(members, justification);
    expect(combined.value).toBeCloseTo(0.72, 15);
    expect(combined.method).toBe('INDEPENDENCE_JUSTIFIED_PRODUCT');
    expect(combined.justification).toEqual(justification);
    expect(combined.members).toEqual(members);
  });

  it('a justification is required to be a real, non-empty statement on a frozen basis', () => {
    expect(() =>
      combineMemberProbabilities(members, { basis: 'WISHFUL_THINKING' as never, justification: 'x' }),
    ).toThrow(/basis must be one of/);
    expect(() =>
      combineMemberProbabilities(members, { basis: 'DESIGNED_ISOLATION', justification: '' }),
    ).toThrow(/justification statement must be a non-empty string/);
    expect(() =>
      combineMemberProbabilities(members, { basis: 'DESIGNED_ISOLATION', justification: 'x', evidence_ref: 'junk' }),
    ).toThrow(/well-formed spine artifact id/);
    expect(INDEPENDENCE_BASES).toEqual([
      'DESIGNED_ISOLATION',
      'MEASURED_NON_CORRELATION',
      'DISJOINT_FAILURE_MODES',
      'ARCHITECTURAL_PARTITION',
    ]);
    expect(isIndependenceBasis('DESIGNED_ISOLATION')).toBe(true);
    expect(isIndependenceBasis('NO')).toBe(false);
  });

  it('member probabilities are validated: at least 2, in [0,1], well-formed package ids', () => {
    expect(() => combineMemberProbabilities([], justification)).toThrow(/at least 2 member probabilities/);
    expect(() => combineMemberProbabilities([members[0]!], justification)).toThrow(/at least 2/);
    expect(() =>
      combineMemberProbabilities([{ package_id: 'junk', probability: 0.5 } as never, members[1]!], justification),
    ).toThrow(/well-formed spine artifact id/);
    expect(() =>
      combineMemberProbabilities(
        [{ package_id: members[0]!.package_id, probability: 1.5 }, members[1]!],
        justification,
      ),
    ).toThrow(/\[0, 1\]/);
    expect(() =>
      combineMemberProbabilities(
        [{ package_id: members[0]!.package_id, probability: Number.NaN }, members[1]!],
        justification,
      ),
    ).toThrow(/\[0, 1\]/);
  });

  it('recorded assessments must reference THIS composition\'s members and hold the exact product', () => {
    const combined = combineMemberProbabilities(members, justification);
    const memberIds = GOLDEN_COMPOSITION.content.members.map((member) => member.package_id);
    expect(() => assertValidIndependenceAssessment(combined, memberIds)).not.toThrow();
    // A member outside the composition is rejected.
    const foreign = {
      ...combined,
      members: [...combined.members, { package_id: 'sos://Package/' + '7'.repeat(32), probability: 0.5 }],
    };
    expect(() => assertValidIndependenceAssessment(foreign, memberIds)).toThrow(/NOT a member of this composition/);
    // A wrong product value is rejected.
    const wrongValue = { ...combined, value: 0.5 };
    expect(() => assertValidIndependenceAssessment(wrongValue, memberIds)).toThrow(/product of its member/);
    // An unjustified method mark is rejected.
    const unjustified = { ...combined, method: 'SILENT_PRODUCT' as never };
    expect(() => assertValidIndependenceAssessment(unjustified, memberIds)).toThrow(/INDEPENDENCE_JUSTIFIED_PRODUCT/);
  });
});
