import { describe, expect, it } from 'vitest';
import {
  canonicalSerialize,
  contentHash,
  deriveDeterministicArtifactId,
  isArtifactId,
  parseArtifactId,
} from '@sos-2/semantic-spine';
import {
  MISSION_LOCAL_ID_PATTERN,
  assertValidMission,
  createMission,
  missionArtifactId,
  missionCreationAddress,
  validateMission,
} from '../src/index.js';
import { CONSTITUTION_ANCHOR_ID, PROVENANCE, T0, sampleMissionContent } from './helpers.js';

describe('mission creation (unit)', () => {
  it('creates a DRAFT mission envelope of kind Mission with spine identity', () => {
    const mission = createMission({
      content: sampleMissionContent(),
      provenance: PROVENANCE,
      created_at: T0,
      authority_ref: CONSTITUTION_ANCHOR_ID,
    });
    expect(mission.envelope.kind).toBe('Mission');
    expect(mission.envelope.status).toBe('DRAFT');
    expect(mission.envelope.version).toBe(1);
    expect(mission.envelope.supersedes).toBeNull();
    expect(mission.envelope.authority_ref).toBe(CONSTITUTION_ANCHOR_ID);
    expect(isArtifactId(mission.envelope.id)).toBe(true);
    expect(parseArtifactId(mission.envelope.id).kind).toBe('Mission');
  });

  it('mints content-addressed ids deterministically (same input -> same id)', () => {
    const input = {
      content: sampleMissionContent(),
      provenance: PROVENANCE,
      created_at: T0,
      authority_ref: CONSTITUTION_ANCHOR_ID,
    };
    const a = createMission(input);
    const b = createMission(input);
    expect(a.envelope.id).toBe(b.envelope.id);
    // and the id is exactly the spine derivation over the creation address
    expect(a.envelope.id).toBe(missionArtifactId(input));
    expect(a.envelope.id).toBe(
      deriveDeterministicArtifactId('Mission', missionCreationAddress(input)),
    );
  });

  it('different content or metadata -> different ids (no silent collision)', () => {
    const base = { provenance: PROVENANCE, created_at: T0, authority_ref: CONSTITUTION_ANCHOR_ID } as const;
    const a = createMission({ ...base, content: sampleMissionContent() });
    const otherContent = sampleMissionContent();
    otherContent.purpose = 'A different purpose.';
    const b = createMission({ ...base, content: otherContent });
    const c = createMission({ ...base, content: sampleMissionContent(), created_at: '2025-01-02T00:00:00.000Z' });
    expect(new Set([a.envelope.id, b.envelope.id, c.envelope.id]).size).toBe(3);
  });

  it('is invariant under key reordering of the content (canonical identity)', () => {
    const content = sampleMissionContent();
    // same values, opposite top-level key order (canonical serialization sorts keys)
    const reordered = {
      constraints: content.constraints,
      ambiguities: content.ambiguities,
      assumptions: content.assumptions,
      measures: content.measures,
      stakeholders: content.stakeholders,
      outcomes: content.outcomes,
      goals: content.goals,
      purpose: content.purpose,
    };
    const a = createMission({ content, provenance: PROVENANCE, created_at: T0 });
    const b = createMission({ content: reordered, provenance: PROVENANCE, created_at: T0 });
    expect(a.envelope.id).toBe(b.envelope.id);
  });

  it('validates through assertValidMission and round-trips through canonical serialization', () => {
    const mission = createMission({
      content: sampleMissionContent(),
      provenance: PROVENANCE,
      created_at: T0,
    });
    expect(validateMission(mission)).toBe(true);
    assertValidMission(mission);
    const roundTripped = JSON.parse(canonicalSerialize(mission));
    expect(validateMission(roundTripped)).toBe(true);
    expect(canonicalSerialize(roundTripped)).toBe(canonicalSerialize(mission));
    expect(contentHash(mission)).toBe(contentHash(roundTripped));
  });

  it('mission artifacts expose exactly { envelope, content }', () => {
    const mission = createMission({
      content: sampleMissionContent(),
      provenance: PROVENANCE,
      created_at: T0,
    });
    expect(Object.keys(mission).sort()).toEqual(['content', 'envelope']);
  });

  it('local id pattern is the documented slug grammar', () => {
    expect(MISSION_LOCAL_ID_PATTERN.test('reduce-incidents')).toBe(true);
    expect(MISSION_LOCAL_ID_PATTERN.test('x')).toBe(true);
    expect(MISSION_LOCAL_ID_PATTERN.test('Bad')).toBe(false);
    expect(MISSION_LOCAL_ID_PATTERN.test('-nope')).toBe(false);
    expect(MISSION_LOCAL_ID_PATTERN.test('no_dots')).toBe(false);
  });

  it('progressive formalization: an informal mission (purpose only) is valid', () => {
    const informal = createMission({
      content: {
        purpose: 'Something worth doing.',
        goals: [],
        outcomes: [],
        stakeholders: [],
        measures: [],
        assumptions: [],
        ambiguities: [],
        constraints: [],
      },
      provenance: PROVENANCE,
      created_at: T0,
    });
    expect(validateMission(informal)).toBe(true);
  });

  it('a MEASURABLE goal with a measure is the formalized form', () => {
    const content = sampleMissionContent();
    const goal = content.goals.find((g) => g.id === 'reduce-incidents')!;
    expect(goal.status).toBe('MEASURABLE');
    expect(goal.measures).toContain('incident-rate');
  });
});
