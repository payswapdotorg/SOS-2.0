import { describe, expect, it } from 'vitest';
import { createEnvelope } from '@sos-2/semantic-spine';
import {
  createMission,
  validateMission,
  validateMissionContent,
} from '../src/index.js';
import type { MissionContent } from '../src/index.js';
import { CONSTITUTION_ANCHOR_ID, PROVENANCE, T0, sampleMissionContent } from './helpers.js';

function contentMutation(mutate: (content: MissionContent) => void): MissionContent {
  const content = sampleMissionContent();
  mutate(content);
  return content;
}

describe('mission content validation (negative)', () => {
  it('rejects a non-object content', () => {
    expect(() => validateMissionContent(null)).toThrow(/mission content must be an object/);
    expect(() => validateMissionContent('mission')).toThrow(/mission content must be an object/);
  });

  it('rejects missing or extra content fields (exact field set)', () => {
    expect(() =>
      validateMissionContent(contentMutation((c) => { delete (c as Partial<MissionContent>).goals; })),
    ).toThrow(/exact field set/);
    expect(() =>
      validateMissionContent({ ...sampleMissionContent(), extra: true } as unknown as MissionContent),
    ).toThrow(/exact field set/);
  });

  it('rejects an empty purpose (purpose is the mandatory anchor)', () => {
    expect(() => validateMissionContent(contentMutation((c) => { c.purpose = ''; }))).toThrow(/purpose/);
    expect(() => validateMissionContent(contentMutation((c) => { c.purpose = 42 as unknown as string; }))).toThrow(/purpose/);
  });

  it('rejects non-array collections', () => {
    expect(() =>
      validateMissionContent(contentMutation((c) => { c.goals = 'nope' as unknown as MissionContent['goals']; })),
    ).toThrow(/goals must be an array/);
  });

  it('rejects malformed local ids', () => {
    expect(() =>
      validateMissionContent(contentMutation((c) => { c.measures[0]!.id = 'NOT-A-SLUG'; })),
    ).toThrow(/id must match/);
    expect(() =>
      validateMissionContent(contentMutation((c) => { c.goals[0]!.id = ''; })),
    ).toThrow(/id must match/);
  });

  it('rejects duplicate local ids across the whole content (flat namespace)', () => {
    expect(() =>
      validateMissionContent(contentMutation((c) => { c.constraints[0]!.id = 'reduce-incidents'; })),
    ).toThrow(/duplicate local id/);
  });

  it('rejects goals with unknown status', () => {
    expect(() =>
      validateMissionContent(contentMutation((c) => { c.goals[0]!.status = 'DONE' as never; })),
    ).toThrow(/status/);
  });

  it('rejects a MEASURABLE goal without measures (progressive formalization invariant)', () => {
    expect(() =>
      validateMissionContent(contentMutation((c) => { c.goals[0]!.measures = []; })),
    ).toThrow(/must reference at least one existing measure/);
    expect(() =>
      validateMissionContent(contentMutation((c) => { c.goals[0]!.status = 'ACHIEVED'; c.goals[0]!.measures = []; })),
    ).toThrow(/must reference at least one existing measure/);
  });

  it('rejects goal measure references to unknown measures', () => {
    expect(() =>
      validateMissionContent(contentMutation((c) => { c.goals[0]!.measures = ['ghost-measure']; })),
    ).toThrow(/unknown measure/);
  });

  it('rejects outcome references to unknown goals', () => {
    expect(() =>
      validateMissionContent(contentMutation((c) => { c.outcomes[0]!.goal_refs = ['ghost-goal']; })),
    ).toThrow(/unknown goal/);
  });

  it('rejects malformed constraints and bounds', () => {
    expect(() =>
      validateMissionContent(contentMutation((c) => { c.constraints[0]!.hard = 'yes' as unknown as boolean; })),
    ).toThrow(/hard must be a boolean/);
    expect(() =>
      validateMissionContent(contentMutation((c) => { c.constraints[0]!.statement = ''; })),
    ).toThrow(/statement must be a non-empty string/);
    expect(() =>
      validateMissionContent(
        contentMutation((c) => { c.constraints[0]!.bound = { axis: 'UPPER', direction: 'MAX', limit: 1 }; }),
      ),
    ).toThrow(/axis must match/);
    expect(() =>
      validateMissionContent(
        contentMutation((c) => { c.constraints[0]!.bound = { axis: 'cost', direction: 'AT_MOST' as never, limit: 1 }; }),
      ),
    ).toThrow(/direction must be MAX or MIN/);
    expect(() =>
      validateMissionContent(
        contentMutation((c) => { c.constraints[0]!.bound = { axis: 'cost', direction: 'MAX', limit: Number.POSITIVE_INFINITY }; }),
      ),
    ).toThrow(/limit must be a finite number/);
    expect(() =>
      validateMissionContent(
        contentMutation((c) => { c.constraints[0]!.bound = { axis: 'cost', direction: 'MAX' } as never; }),
      ),
    ).toThrow(/exact fields/);
  });

  it('rejects malformed stakeholders, assumptions and ambiguities', () => {
    expect(() =>
      validateMissionContent(contentMutation((c) => { c.stakeholders[0]!.name = ''; })),
    ).toThrow(/name must be a non-empty string/);
    expect(() =>
      validateMissionContent(contentMutation((c) => { c.stakeholders[0]!.interest = 5 as unknown as string; })),
    ).toThrow(/interest must be a string or null/);
    expect(() =>
      validateMissionContent(contentMutation((c) => { c.assumptions[0]!.statement = ''; })),
    ).toThrow(/statement must be a non-empty string/);
    expect(() =>
      validateMissionContent(contentMutation((c) => { c.ambiguities[0]!.resolution = 1 as unknown as string; })),
    ).toThrow(/resolution must be a string or null/);
  });
});

describe('mission artifact creation (negative)', () => {
  it('rejects non-object creation input', () => {
    expect(() => createMission(null as never)).toThrow(/input must be an object/);
  });

  it('delegates envelope discipline to the spine (provenance, timestamps)', () => {
    expect(() =>
      createMission({ content: sampleMissionContent(), provenance: [], created_at: T0 }),
    ).toThrow(/provenance/);
    expect(() =>
      createMission({ content: sampleMissionContent(), provenance: PROVENANCE, created_at: 'yesterday' }),
    ).toThrow(/RFC3339/);
    expect(() =>
      createMission({
        content: sampleMissionContent(),
        provenance: PROVENANCE,
        created_at: T0,
        authority_ref: 'not-an-id',
      }),
    ).toThrow(/authority_ref/);
  });

  it('validateMission rejects structurally invalid artifacts', () => {
    const good = createMission({
      content: sampleMissionContent(),
      provenance: PROVENANCE,
      created_at: T0,
    });
    // extra top-level field
    expect(validateMission({ ...good, extra: 1 })).toBe(false);
    // missing content
    expect(validateMission({ envelope: good.envelope })).toBe(false);
    // envelope of the wrong kind (still a spine-valid envelope)
    const wrongKind = createEnvelope({
      kind: 'ValueModel',
      provenance: PROVENANCE,
      created_at: T0,
    });
    expect(validateMission({ envelope: wrongKind, content: good.content })).toBe(false);
    // invalid content
    const badContent = sampleMissionContent();
    badContent.purpose = '';
    expect(validateMission({ envelope: good.envelope, content: badContent })).toBe(false);
    // non-envelope value
    expect(validateMission({ envelope: 'nope', content: good.content })).toBe(false);
  });

  it('ignores the Constitution anchor only as a reference — it never mints it', () => {
    // sanity: the anchor consumed from the W0.5 fixture is a Constitution id
    expect(CONSTITUTION_ANCHOR_ID.startsWith('sos://Constitution/')).toBe(true);
  });
});
