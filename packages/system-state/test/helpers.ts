import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ArchitectureReference,
  ConfigurationReference,
  DeploymentReference,
  ImplementationReference,
  PolicyReference,
  SystemStateArtifact,
  SystemStateContent,
} from '../src/index.js';

/** Deterministic test fixture ids (hex segments derived from fixture names). */
export function hex32(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

export const ARCHITECTURE_ID = `sos://ArchitectureGraph/${hex32('w2-fixture-architecture')}`;
export const IMPLEMENTATION_ID = `sos://ImplementationModel/${hex32('w2-fixture-implementation')}`;
export const IMPLEMENTATION_ID_2 = `sos://ImplementationModel/${hex32('w2-fixture-implementation-2')}`;
export const EXPERIMENT_ID = `sos://Experiment/${hex32('w2-fixture-experiment')}`;
export const PACKAGE_ID = `sos://Package/${hex32('w2-fixture-package')}`;
export const AUTHORITY_ID = `sos://Constitution/${hex32('w2-fixture-constitution')}`;

export function validContent(): SystemStateContent {
  return {
    architecture_ref: { artifact_id: ARCHITECTURE_ID, version: 3 },
    implementation: [
      { artifact_id: IMPLEMENTATION_ID, revision: { kind: 'git-sha', value: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' } },
    ],
    configuration: [
      { config_id: 'checkout-config', revision: { kind: 'config-version', value: 'v42' } },
    ],
    deployment: [
      {
        deployment_id: 'deploy-prod-2025-06-01',
        environment: 'production',
        revision: { kind: 'deployment-id', value: 'dpl_7f3e2a1b9c' },
      },
    ],
    policy: [{ policy_id: 'deployment-policy', version: 2 }],
    environment_relationships: [
      { source: 'staging', target: 'production', kind: 'promotes-to' },
      { source: 'production', target: 'analytics', kind: 'depends-on' },
    ],
    active_experiments: [{ experiment_id: EXPERIMENT_ID, environment: 'production' }],
    package_realizations: [
      { package_id: PACKAGE_ID, version: '1.4.0', realized_by: ['checkout-component'] },
    ],
  };
}

export function emptySectionsContent(): SystemStateContent {
  return {
    architecture_ref: { artifact_id: ARCHITECTURE_ID, version: 1 },
    implementation: [],
    configuration: [],
    deployment: [],
    policy: [],
    environment_relationships: [],
    active_experiments: [],
    package_realizations: [],
  };
}

/** Mutate a content section in a controlled way (returns a fresh object). */
export function withImplementation(content: SystemStateContent, impl: ImplementationReference[]): SystemStateContent {
  return { ...content, implementation: impl };
}

export function withConfiguration(content: SystemStateContent, config: ConfigurationReference[]): SystemStateContent {
  return { ...content, configuration: config };
}

export function withDeployment(content: SystemStateContent, deployment: DeploymentReference[]): SystemStateContent {
  return { ...content, deployment };
}

export function withArchitectureRef(content: SystemStateContent, ref: ArchitectureReference): SystemStateContent {
  return { ...content, architecture_ref: ref };
}

export function withPolicy(content: SystemStateContent, policy: PolicyReference[]): SystemStateContent {
  return { ...content, policy };
}

export type { SystemStateArtifact };

export const CREATED_AT = '2025-06-01T00:00:00.000Z';
export const PROVENANCE = ['W2:system-state-fixture'];
