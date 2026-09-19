import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fc from 'fast-check';
import {
  SystemStateStore,
  canonicalSystemStateText,
  createSystemState,
  systemStateArtifactId,
  systemStateHash,
  validateSystemStateArtifact,
} from '../src/index.js';
import type { SystemStateContent } from '../src/index.js';
import { isCanonicalText } from '@sos-2/semantic-spine';

/**
 * Property tests — deterministic: fast-check is seeded globally (424242) in
 * test/setup.ts, so repeated runs generate identical sequences and yield
 * identical results (the W0.5/W1 determinism proof).
 */

const slugArb = fc.stringMatching(/^[a-z][a-z0-9-]{1,9}$/);
const shaArb = fc.hexaString({ minLength: 40, maxLength: 40 }).noShrink();
const createdAtArb = fc
  .date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2099-12-31T23:59:59Z') })
  .map((d) => d.toISOString());
const provenanceArb = fc.array(fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9 .:-]{0,40}/), {
  minLength: 1,
  maxLength: 4,
});
const envKindArb = fc.constantFrom('depends-on', 'promotes-to', 'mirrors', 'isolated-from');
const environmentArb = fc.constantFrom('production', 'staging', 'analytics', 'canary');

function artifactIdOf(kind: string, seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return `sos://${kind}/${hex}`;
}

interface ContentSeed {
  archVersion: number;
  implSeeds: string[];
  implShas: string[];
  configSeeds: string[];
  configVersions: string[];
  deploySeeds: string[];
  deployValues: string[];
  policySeeds: string[];
  policyVersions: number[];
  relSources: string[];
  relTargets: string[];
  relKinds: string[];
  expSeeds: string[];
  expEnvironments: string[];
  pkgSeeds: string[];
  pkgVersions: string[];
  pkgRealizers: string[];
}

function buildContent(seed: ContentSeed): SystemStateContent {
  return {
    architecture_ref: { artifact_id: artifactIdOf('ArchitectureGraph', 'arch'), version: seed.archVersion },
    implementation: seed.implSeeds.map((s, i) => ({
      artifact_id: artifactIdOf('ImplementationModel', s),
      revision: { kind: 'git-sha' as const, value: seed.implShas[i % Math.max(seed.implShas.length, 1)] ?? '0'.repeat(40) },
    })),
    configuration: seed.configSeeds.map((s, i) => ({
      config_id: s,
      revision: { kind: 'config-version' as const, value: seed.configVersions[i % Math.max(seed.configVersions.length, 1)] ?? 'v1' },
    })),
    deployment: seed.deploySeeds.map((s, i) => ({
      deployment_id: s,
      environment: 'production',
      revision: { kind: 'deployment-id' as const, value: seed.deployValues[i % Math.max(seed.deployValues.length, 1)] ?? 'd1' },
    })),
    policy: seed.policySeeds.map((s, i) => ({
      policy_id: s,
      version: seed.policyVersions[i % Math.max(seed.policyVersions.length, 1)] ?? 1,
    })),
    environment_relationships: seed.relSources.map((s, i) => ({
      source: s,
      target: seed.relTargets[i % Math.max(seed.relTargets.length, 1)] ?? 'production',
      kind: seed.relKinds[i % Math.max(seed.relKinds.length, 1)] ?? 'depends-on',
    })),
    active_experiments: seed.expSeeds.map((s, i) => ({
      experiment_id: artifactIdOf('Experiment', s),
      environment: seed.expEnvironments[i % Math.max(seed.expEnvironments.length, 1)] ?? 'production',
    })),
    package_realizations: seed.pkgSeeds.map((s, i) => ({
      package_id: artifactIdOf('Package', s),
      version: seed.pkgVersions[i % Math.max(seed.pkgVersions.length, 1)] ?? '1.0.0',
      realized_by: [seed.pkgRealizers[i % Math.max(seed.pkgRealizers.length, 1)] ?? 'component'],
    })),
  };
}

const contentSeedArb: fc.Arbitrary<ContentSeed> = fc.record({
  archVersion: fc.integer({ min: 1, max: 50 }),
  implSeeds: fc.uniqueArray(slugArb, { maxLength: 4 }),
  implShas: fc.array(shaArb, { minLength: 1, maxLength: 3 }),
  configSeeds: fc.uniqueArray(slugArb, { maxLength: 3 }),
  configVersions: fc.array(fc.stringMatching(/^v[0-9]{1,3}$/), { minLength: 1, maxLength: 3 }),
  deploySeeds: fc.uniqueArray(slugArb, { maxLength: 3 }),
  deployValues: fc.array(fc.stringMatching(/^dpl_[0-9a-f]{6}$/), { minLength: 1, maxLength: 3 }),
  policySeeds: fc.uniqueArray(slugArb, { maxLength: 3 }),
  policyVersions: fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 1, maxLength: 3 }),
  relSources: fc.array(environmentArb, { maxLength: 3 }),
  relTargets: fc.array(environmentArb, { maxLength: 3 }),
  relKinds: fc.array(envKindArb, { minLength: 1, maxLength: 3 }),
  expSeeds: fc.uniqueArray(slugArb, { maxLength: 3 }),
  expEnvironments: fc.array(environmentArb, { minLength: 1, maxLength: 3 }),
  pkgSeeds: fc.uniqueArray(slugArb, { maxLength: 3 }),
  pkgVersions: fc.array(fc.stringMatching(/^1\.[0-9]\.[0-9]$/), { minLength: 1, maxLength: 3 }),
  pkgRealizers: fc.array(slugArb, { minLength: 1, maxLength: 3 }),
});

// note: relationship duplicates must be avoided; buildContent may produce
// duplicate (source,target,kind) triples. Filter them deterministically.
function dedupeRelationships(content: SystemStateContent): SystemStateContent {
  const seen = new Set<string>();
  const relationships = content.environment_relationships.filter((rel) => {
    const key = `${rel.source}->${rel.target}->${rel.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ...content, environment_relationships: relationships };
}

const contentArb = contentSeedArb.map((seed) => dedupeRelationships(buildContent(seed)));

describe('property: system state identity and serialization', () => {
  it('creation is deterministic: identical input reproduces the identical id', () => {
    fc.assert(
      fc.property(contentArb, provenanceArb, createdAtArb, (content, provenance, created_at) => {
        const input = { content, provenance, created_at };
        const a = createSystemState(input);
        const b = createSystemState({ ...input, content: JSON.parse(JSON.stringify(content)) });
        return a.envelope.id === b.envelope.id && a.envelope.id === systemStateArtifactId(input);
      }),
      { numRuns: 200 },
    );
  });

  it('artifacts round trip through canonical JSON and stay valid', () => {
    fc.assert(
      fc.property(contentArb, provenanceArb, createdAtArb, (content, provenance, created_at) => {
        const artifact = createSystemState({ content, provenance, created_at });
        const text = canonicalSystemStateText(artifact);
        if (!isCanonicalText(text)) return false;
        const parsed = JSON.parse(text);
        return (
          parsed.envelope.id === artifact.envelope.id &&
          systemStateHash(artifact) === systemStateHash(artifact) &&
          validateSystemStateArtifact(parsed)
        );
      }),
      { numRuns: 200 },
    );
  });

  it('different content yields different ids (randomized pair probe)', () => {
    fc.assert(
      fc.property(
        contentArb,
        fc.integer({ min: 1, max: 999 }),
        (content, bump) => {
          const other: SystemStateContent = {
            ...content,
            architecture_ref: { ...content.architecture_ref, version: content.architecture_ref.version + bump },
          };
          return (
            JSON.stringify(content) === JSON.stringify(other) ||
            systemStateArtifactId({ content, provenance: ['p'], created_at: '2025-01-01T00:00:00Z' }) !==
              systemStateArtifactId({ content: other, provenance: ['p'], created_at: '2025-01-01T00:00:00Z' })
          );
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe('property: revision chains', () => {
  it('supersede chains stay complete, ordered and contiguous', () => {
    fc.assert(
      fc.property(
        contentArb,
        provenanceArb,
        createdAtArb,
        fc.integer({ min: 1, max: 5 }),
        (content, provenance, created_at, steps) => {
          const store = new SystemStateStore();
          const root = createSystemState({ content, provenance, created_at, status: 'ACTIVE' });
          store.put(root);
          let currentId = root.envelope.id;
          for (let i = 1; i <= steps; i += 1) {
            const bumped: SystemStateContent = {
              ...content,
              policy: [...content.policy, { policy_id: `p-${i}`, version: i }],
            };
            const result = store.supersede(currentId, {
              content: bumped,
              provenance: [`W2:property-step-${i}`],
              created_at,
            });
            currentId = result.supersededBy.envelope.id;
          }
          const chain = store.history(root.envelope.id);
          if (chain.length !== steps + 1) return false;
          if (chain[0]!.envelope.id !== root.envelope.id) return false;
          if (store.latest(root.envelope.id).envelope.id !== currentId) return false;
          for (let i = 0; i < chain.length; i += 1) {
            if (chain[i]!.envelope.version !== i + 1) return false;
            if (i > 0 && chain[i]!.envelope.supersedes !== chain[i - 1]!.envelope.id) return false;
          }
          return store.isLatest(currentId) && !store.isLatest(root.envelope.id);
        },
      ),
      { numRuns: 100 },
    );
  });
});
