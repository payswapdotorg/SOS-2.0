import { describe, expect, it } from 'vitest';
import { isArtifactId, parseArtifactId } from '@sos-2/semantic-spine';
import {
  MissionStore,
  createMission,
  isAuthorityGrantRef,
  reviseMission,
} from '../src/index.js';
import { CONSTITUTION_ANCHOR_ID, PROVENANCE, T0, T1, T2, sampleMissionContent } from './helpers.js';

const GRANT = `sos://AuthorityGrant/${'a'.repeat(32)}`;

function activeMissionStore(): { store: MissionStore; id: string } {
  const store = new MissionStore();
  const mission = store.put(
    createMission({
      content: sampleMissionContent(),
      provenance: PROVENANCE,
      created_at: T0,
      authority_ref: CONSTITUTION_ANCHOR_ID,
      status: 'ACTIVE',
    }),
  );
  return { store, id: mission.envelope.id };
}

describe('mission revision workflow (unit)', () => {
  it('isAuthorityGrantRef accepts only well-formed AuthorityGrant ids', () => {
    expect(isAuthorityGrantRef(GRANT)).toBe(true);
    expect(isAuthorityGrantRef('sos://Mission/' + 'a'.repeat(32))).toBe(false);
    expect(isAuthorityGrantRef('not-an-id')).toBe(false);
    expect(isAuthorityGrantRef(42)).toBe(false);
    expect(isAuthorityGrantRef(null)).toBe(false);
  });

  it('revising an ACTIVE mission produces the next version with a supersedes chain', () => {
    const { store, id } = activeMissionStore();
    const nextContent = sampleMissionContent();
    nextContent.purpose = 'A sharpened purpose.';
    const result = store.revise(id, {
      content: nextContent,
      authority_grant: GRANT,
      provenance: ['W1:test:revision-1'],
      created_at: T1,
    });

    expect(result.revised.envelope.version).toBe(2);
    expect(result.revised.envelope.supersedes).toBe(id);
    expect(result.revised.envelope.status).toBe('ACTIVE');
    expect(result.revised.envelope.authority_ref).toBe(GRANT);
    expect(result.revised.envelope.kind).toBe('Mission');
    expect(result.revised.envelope.id).not.toBe(id);
    // the previous revision is now SUPERSEDED (terminal)
    expect(result.previous.envelope.status).toBe('SUPERSEDED');
    expect(store.get(id)!.envelope.status).toBe('SUPERSEDED');
    // exactly one ACTIVE mission remains
    expect(store.active()).toHaveLength(1);
    expect(store.active()[0]!.envelope.id).toBe(result.revised.envelope.id);
  });

  it('records a DERIVED_FROM revision link with provenance', () => {
    const { store, id } = activeMissionStore();
    const result = store.revise(id, {
      content: sampleMissionContent(),
      authority_grant: GRANT,
      provenance: ['W1:test:revision-2'],
      created_at: T1,
    });
    const links = store.revisionLinks();
    expect(links).toHaveLength(1);
    expect(links[0]!.type).toBe('DERIVED_FROM');
    expect(links[0]!.source).toBe(result.revised.envelope.id);
    expect(links[0]!.target).toBe(id);
    expect(links[0]!.provenance).toEqual(['W1:test:revision-2']);
  });

  it('history() returns the complete, ordered, contiguous chain', () => {
    const { store, id } = activeMissionStore();
    let current = id;
    const timestamps = [T1, T2];
    for (let i = 0; i < timestamps.length; i += 1) {
      const content = sampleMissionContent();
      content.purpose = `Purpose v${i + 2}.`;
      current = store.revise(current, {
        content,
        authority_grant: GRANT,
        provenance: [`W1:test:revision-${i + 1}`],
        created_at: timestamps[i]!,
      }).revised.envelope.id;
    }
    const history = store.history(current);
    expect(history).toHaveLength(3);
    expect(history.map((m) => m.envelope.version)).toEqual([1, 2, 3]);
    expect(history[0]!.envelope.supersedes).toBeNull();
    expect(history[1]!.envelope.supersedes).toBe(history[0]!.envelope.id);
    expect(history[2]!.envelope.supersedes).toBe(history[1]!.envelope.id);
    expect(history.map((m) => m.envelope.status)).toEqual(['SUPERSEDED', 'SUPERSEDED', 'ACTIVE']);
    // history is queryable from ANY revision in the chain
    expect(store.history(history[1]!.envelope.id)).toHaveLength(2);
  });

  it('revising a DRAFT mission is rejected (activate first)', () => {
    const store = new MissionStore();
    const draft = store.put(
      createMission({ content: sampleMissionContent(), provenance: PROVENANCE, created_at: T0 }),
    );
    expect(() =>
      reviseMission(draft, {
        content: sampleMissionContent(),
        authority_grant: GRANT,
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/only ACTIVE missions can be revised/);
  });

  it('revising a SUPERSEDED mission is rejected (no branching)', () => {
    const { store, id } = activeMissionStore();
    const result = store.revise(id, {
      content: sampleMissionContent(),
      authority_grant: GRANT,
      provenance: PROVENANCE,
      created_at: T1,
    });
    const superseded = store.get(id)!;
    expect(() =>
      reviseMission(superseded, {
        content: sampleMissionContent(),
        authority_grant: GRANT,
        provenance: PROVENANCE,
        created_at: T2,
      }),
    ).toThrow(/only ACTIVE missions can be revised/);
    // and via the store: revising the old head again fails loudly
    expect(() =>
      store.revise(id, { content: sampleMissionContent(), authority_grant: GRANT, provenance: PROVENANCE, created_at: T2 }),
    ).toThrow(/only ACTIVE missions can be revised/);
    expect(result.revised.envelope.version).toBe(2);
  });

  it('a revision without an AuthorityGrant reference is rejected', () => {
    const { store, id } = activeMissionStore();
    for (const bad of [null, undefined, '', 'sos://Mission/' + 'a'.repeat(32), 'garbage']) {
      expect(() =>
        store.revise(id, {
          content: sampleMissionContent(),
          authority_grant: bad as string,
          provenance: PROVENANCE,
          created_at: T1,
        }),
      ).toThrow(/AuthorityGrant/);
    }
  });

  it('a revision with invalid content is rejected', () => {
    const { store, id } = activeMissionStore();
    const badContent = sampleMissionContent();
    badContent.goals[0]!.measures = ['ghost'];
    expect(() =>
      store.revise(id, {
        content: badContent,
        authority_grant: GRANT,
        provenance: PROVENANCE,
        created_at: T1,
      }),
    ).toThrow(/unknown measure/);
  });

  it('put() enforces contiguous +1 versions and complete history', () => {
    const { store, id } = activeMissionStore();
    const current = store.get(id)!;
    // version jump
    const jumped = createMission({
      content: sampleMissionContent(),
      provenance: PROVENANCE,
      created_at: T1,
      version: current.envelope.version + 2,
      status: 'ACTIVE',
      supersedes: id,
    });
    expect(() => store.put(jumped)).toThrow(/exactly previous.version \+ 1/);
    // dangling supersedes target
    const dangling = createMission({
      content: sampleMissionContent(),
      provenance: PROVENANCE,
      created_at: T1,
      version: 2,
      status: 'ACTIVE',
      supersedes: `sos://Mission/${'b'.repeat(32)}`,
    });
    expect(() => store.put(dangling)).toThrow(/supersedes unknown artifact/);
  });

  it('put() rejects duplicate artifact ids', () => {
    const { store, id } = activeMissionStore();
    const duplicate = store.get(id)!;
    expect(() => store.put(duplicate)).toThrow(/already registered/);
  });

  it('history() of an unknown id fails loudly', () => {
    const store = new MissionStore();
    expect(() => store.history(`sos://Mission/${'c'.repeat(32)}`)).toThrow(/unknown mission id/);
  });

  it('revision ids are deterministic: replaying the same chain reproduces identical ids', () => {
    const build = (): string[] => {
      const { store, id } = activeMissionStore();
      const ids = [id];
      let current = id;
      const contents = [T1, T2].map((t, i) => {
        const c = sampleMissionContent();
        c.purpose = `Deterministic purpose v${i + 2} at ${t}.`;
        return c;
      });
      for (let i = 0; i < contents.length; i += 1) {
        current = store.revise(current, {
          content: contents[i]!,
          authority_grant: GRANT,
          provenance: [PROVENANCE[0]!, `rev-${i + 1}`],
          created_at: [T1, T2][i]!,
        }).revised.envelope.id;
        ids.push(current);
      }
      return ids;
    };
    expect(build()).toEqual(build());
  });

  it('the revision grant reference must parse with kind AuthorityGrant', () => {
    const { store, id } = activeMissionStore();
    const result = store.revise(id, {
      content: sampleMissionContent(),
      authority_grant: GRANT,
      provenance: PROVENANCE,
      created_at: T1,
    });
    expect(isArtifactId(result.revised.envelope.authority_ref!)).toBe(true);
    expect(parseArtifactId(result.revised.envelope.authority_ref!).kind).toBe('AuthorityGrant');
  });
});
