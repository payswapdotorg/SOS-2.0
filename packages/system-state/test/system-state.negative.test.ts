import { describe, expect, it } from 'vitest';
import {
  assertValidSystemStateContent,
  createSystemState,
  SystemStateError,
  SystemStateStore,
  validateSystemStateContent,
} from '../src/index.js';
import type { SystemStateContent } from '../src/index.js';
import {
  ARCHITECTURE_ID,
  CREATED_AT,
  IMPLEMENTATION_ID,
  PACKAGE_ID,
  EXPERIMENT_ID,
  PROVENANCE,
  hex32,
  validContent,
  emptySectionsContent,
} from './helpers.js';

function expectInvalidContent(mutation: (content: SystemStateContent) => unknown, message: RegExp): void {
  expect(() => assertValidSystemStateContent(mutation(validContent()))).toThrow(message);
  expect(validateSystemStateContent(mutation(validContent()))).toBe(false);
}

describe('negative: exact revisions are mandatory', () => {
  it('rejects an implementation reference without a revision', () => {
    expectInvalidContent(
      (c) => ({ ...c, implementation: [{ artifact_id: IMPLEMENTATION_ID }] as unknown }),
      /implementation entry must have the exact field set/,
    );
  });

  it('rejects an implementation reference with an empty revision value', () => {
    expectInvalidContent(
      (c) => ({ ...c, implementation: [{ artifact_id: IMPLEMENTATION_ID, revision: { kind: 'git-sha', value: '' } }] }),
      /revision value must be a non-empty string/,
    );
  });

  it('rejects a revision with an unknown kind', () => {
    expectInvalidContent(
      (c) => ({ ...c, implementation: [{ artifact_id: IMPLEMENTATION_ID, revision: { kind: 'sha', value: 'abc' } }] }),
      /revision kind must be one of git-sha, deployment-id, config-version/,
    );
  });

  it('rejects an implementation revision of the wrong kind (typed mapping enforced)', () => {
    expectInvalidContent(
      (c) => ({ ...c, implementation: [{ artifact_id: IMPLEMENTATION_ID, revision: { kind: 'config-version', value: 'v1' } }] }),
      /implementation revision must be of kind "git-sha"/,
    );
  });

  it('rejects a deployment reference without an exact revision', () => {
    expectInvalidContent(
      (c) => ({ ...c, deployment: [{ deployment_id: 'deploy-1', environment: 'production' }] as unknown }),
      /deployment entry must have the exact field set/,
    );
  });

  it('rejects a deployment revision of the wrong kind', () => {
    expectInvalidContent(
      (c) => ({
        ...c,
        deployment: [
          { deployment_id: 'deploy-1', environment: 'production', revision: { kind: 'git-sha', value: 'abc' } },
        ],
      }),
      /deployment revision must be of kind "deployment-id"/,
    );
  });

  it('rejects a configuration reference without an exact revision', () => {
    expectInvalidContent(
      (c) => ({ ...c, configuration: [{ config_id: 'checkout-config' }] as unknown }),
      /configuration entry must have the exact field set/,
    );
  });

  it('rejects a configuration revision of the wrong kind', () => {
    expectInvalidContent(
      (c) => ({ ...c, configuration: [{ config_id: 'checkout-config', revision: { kind: 'deployment-id', value: 'd1' } }] }),
      /configuration revision must be of kind "config-version"/,
    );
  });

  it('rejects a revision object with extra fields', () => {
    expectInvalidContent(
      (c) => ({
        ...c,
        implementation: [
          { artifact_id: IMPLEMENTATION_ID, revision: { kind: 'git-sha', value: 'abc', note: 'x' } },
        ],
      }),
      /exact field set/,
    );
  });
});

describe('negative: content structure', () => {
  it('rejects content with an extra section', () => {
    expectInvalidContent(
      (c) => ({ ...c, extra_section: [] } as unknown),
      /exact field set/,
    );
  });

  it('rejects content with a missing section', () => {
    expectInvalidContent(
      (c) => {
        const clone = { ...c } as Record<string, unknown>;
        delete clone['deployment'];
        return clone;
      },
      /exact field set/,
    );
  });

  it('rejects a non-object content', () => {
    expect(() => assertValidSystemStateContent(null)).toThrow(/must be an object/);
    expect(() => assertValidSystemStateContent([])).toThrow(/must be an object/);
    expect(validateSystemStateContent(null)).toBe(false);
  });

  it('rejects an architecture_ref pointing at the wrong artifact kind', () => {
    expectInvalidContent(
      (c) => ({ ...c, architecture_ref: { artifact_id: `sos://Mission/${hex32('mission')}`, version: 1 } }),
      /must be a sos:\/\/ArchitectureGraph\/ artifact id/,
    );
  });

  it('rejects an architecture_ref with a malformed id', () => {
    expectInvalidContent(
      (c) => ({ ...c, architecture_ref: { artifact_id: 'not-an-id', version: 1 } }),
      /well-formed artifact id/,
    );
  });

  it('rejects an architecture_ref with a non-integer version', () => {
    expectInvalidContent(
      (c) => ({ ...c, architecture_ref: { artifact_id: ARCHITECTURE_ID, version: 0 } }),
      /version must be an integer >= 1/,
    );
  });

  it('rejects an implementation reference pointing at the wrong artifact kind', () => {
    expectInvalidContent(
      (c) => ({
        ...c,
        implementation: [
          { artifact_id: `sos://Evidence/${hex32('evidence')}`, revision: { kind: 'git-sha', value: 'abc' } },
        ],
      }),
      /must be a sos:\/\/ImplementationModel\/ artifact id/,
    );
  });

  it('rejects an active experiment reference pointing at the wrong artifact kind', () => {
    expectInvalidContent(
      (c) => ({ ...c, active_experiments: [{ experiment_id: ARCHITECTURE_ID, environment: 'production' }] }),
      /must be a sos:\/\/Experiment\/ artifact id/,
    );
  });

  it('rejects a package realization pointing at the wrong artifact kind', () => {
    expectInvalidContent(
      (c) => ({ ...c, package_realizations: [{ package_id: EXPERIMENT_ID, version: '1.0.0', realized_by: [] }] }),
      /must be a sos:\/\/Package\/ artifact id/,
    );
  });

  it('rejects duplicate implementation artifact ids', () => {
    expectInvalidContent(
      (c) => ({
        ...c,
        implementation: [
          { artifact_id: IMPLEMENTATION_ID, revision: { kind: 'git-sha', value: 'a' } },
          { artifact_id: IMPLEMENTATION_ID, revision: { kind: 'git-sha', value: 'b' } },
        ],
      }),
      /duplicate implementation artifact_id/,
    );
  });

  it('rejects duplicate configuration ids, deployment ids, policy ids and package ids', () => {
    expectInvalidContent(
      (c) => ({
        ...c,
        configuration: [
          { config_id: 'cfg', revision: { kind: 'config-version', value: '1' } },
          { config_id: 'cfg', revision: { kind: 'config-version', value: '2' } },
        ],
      }),
      /duplicate configuration config_id/,
    );
    expectInvalidContent(
      (c) => ({
        ...c,
        deployment: [
          { deployment_id: 'd', environment: 'a', revision: { kind: 'deployment-id', value: '1' } },
          { deployment_id: 'd', environment: 'b', revision: { kind: 'deployment-id', value: '2' } },
        ],
      }),
      /duplicate deployment deployment_id/,
    );
    expectInvalidContent(
      (c) => ({
        ...c,
        policy: [
          { policy_id: 'p', version: 1 },
          { policy_id: 'p', version: 2 },
        ],
      }),
      /duplicate policy policy_id/,
    );
    expectInvalidContent(
      (c) => ({
        ...c,
        package_realizations: [
          { package_id: PACKAGE_ID, version: '1', realized_by: [] },
          { package_id: PACKAGE_ID, version: '2', realized_by: [] },
        ],
      }),
      /duplicate package_realizations package_id/,
    );
  });

  it('rejects unknown / malformed environment relationship kinds and duplicates', () => {
    expectInvalidContent(
      (c) => ({ ...c, environment_relationships: [{ source: 'a', target: 'b', kind: 'ships-with' }] }),
      /not registered/,
    );
    expectInvalidContent(
      (c) => ({ ...c, environment_relationships: [{ source: 'a', target: 'b', kind: 'Bad Kind' }] }),
      /kebab-case/,
    );
    expectInvalidContent(
      (c) => ({
        ...c,
        environment_relationships: [
          { source: 'a', target: 'b', kind: 'depends-on' },
          { source: 'a', target: 'b', kind: 'depends-on' },
        ],
      }),
      /duplicate environment_relationships/,
    );
  });

  it('rejects a package realization with non-string realized_by entries', () => {
    expectInvalidContent(
      (c) => ({ ...c, package_realizations: [{ package_id: PACKAGE_ID, version: '1', realized_by: ['a', 42] as unknown }] }),
      /realized_by must be an array of non-empty strings/,
    );
  });

  it('rejects a policy with a non-integer version', () => {
    expectInvalidContent(
      (c) => ({ ...c, policy: [{ policy_id: 'p', version: 1.5 }] }),
      /version must be an integer >= 1/,
    );
  });
});

describe('negative: creation and envelope discipline (delegated to the spine)', () => {
  it('rejects empty provenance', () => {
    expect(() =>
      createSystemState({ content: validContent(), provenance: [], created_at: CREATED_AT }),
    ).toThrow(/provenance must be a non-empty array/);
  });

  it('rejects an invalid RFC3339 timestamp', () => {
    expect(() =>
      createSystemState({ content: validContent(), provenance: PROVENANCE, created_at: '2025-06-01' }),
    ).toThrow(/RFC3339/);
  });

  it('rejects invalid content at creation', () => {
    expect(() =>
      createSystemState({
        content: { ...validContent(), implementation: [], configuration: null } as unknown as SystemStateContent,
        provenance: PROVENANCE,
        created_at: CREATED_AT,
      }),
    ).toThrow(SystemStateError);
  });
});

describe('negative: store chain discipline', () => {
  const rootInput = { content: emptySectionsContent(), provenance: PROVENANCE, created_at: CREATED_AT, status: 'ACTIVE' as const };

  it('rejects a supersedes target that is not registered', () => {
    const store = new SystemStateStore();
    const orphan = createSystemState({
      ...rootInput,
      supersedes: `sos://SystemState/${hex32('not-registered')}`,
      version: 2,
    });
    expect(() => store.put(orphan)).toThrow(/supersedes target is not registered/);
  });

  it('rejects a self-supersede', () => {
    const store = new SystemStateStore();
    const artifact = createSystemState(rootInput);
    expect(() =>
      store.put({ ...artifact, envelope: { ...artifact.envelope, supersedes: artifact.envelope.id } }),
    ).toThrow(/cannot supersede itself/);
  });

  it('rejects a version gap (non-contiguous chain)', () => {
    const store = new SystemStateStore();
    const root = createSystemState(rootInput);
    store.put(root);
    const skipped = createSystemState({
      ...rootInput,
      content: validContent(),
      version: 3,
      supersedes: root.envelope.id,
      created_at: '2025-06-02T00:00:00.000Z',
    });
    expect(() => store.put(skipped)).toThrow(/non-contiguous revision/);
  });

  it('rejects a branching chain (two superseders of the same revision)', () => {
    const store = new SystemStateStore();
    const root = createSystemState(rootInput);
    store.put(root);
    const first = store.supersede(root.envelope.id, {
      content: validContent(),
      provenance: ['W2:first'],
      created_at: '2025-06-02T00:00:00.000Z',
    });
    const branch = createSystemState({
      ...rootInput,
      content: validContent(),
      version: 2,
      supersedes: root.envelope.id,
      provenance: ['W2:branch'],
      created_at: '2025-06-03T00:00:00.000Z',
    });
    expect(() => store.put(branch)).toThrow(/branching revision chain rejected/);
    expect(store.latest(root.envelope.id).envelope.id).toBe(first.supersededBy.envelope.id);
  });

  it('rejects duplicate registration of the same id', () => {
    const store = new SystemStateStore();
    const root = createSystemState(rootInput);
    store.put(root);
    expect(() => store.put(root)).toThrow(/already registered/);
  });

  it('rejects superseding a non-ACTIVE revision', () => {
    const store = new SystemStateStore();
    const root = createSystemState({ content: emptySectionsContent(), provenance: PROVENANCE, created_at: CREATED_AT });
    store.put(root);
    expect(() =>
      store.supersede(root.envelope.id, {
        content: validContent(),
        provenance: ['W2:x'],
        created_at: '2025-06-02T00:00:00.000Z',
      }),
    ).toThrow(/only ACTIVE revisions can be superseded/);
  });
});
