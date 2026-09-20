/**
 * Shared test fixtures for @sos-2/deployment tests. Deployment records are
 * minted through this package; the rollback declarations reuse the merged
 * W8 recovery-control vocabulary; evidence through the merged W3 package.
 */

import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { Producer } from '@sos-2/provenance';
import type { RecoveryMechanism, RecoveryTrigger } from '@sos-2/recovery-control';
import { createDeployment } from '../src/index.js';
import type { DeploymentContent, DeploymentRecord } from '../src/index.js';

export const T0 = '2025-03-01T00:00:00.000Z';
export const T1 = '2025-03-02T00:00:00.000Z';
export const T2 = '2025-03-03T00:00:00.000Z';

export const BOUNDED_MECHANISM: RecoveryMechanism = {
  kind: 'ROLLBACK_DEPLOYMENT',
  to_deployment_id: 'deploy-prod-2025-02-28',
};

export const BUDGET_TRIGGER: RecoveryTrigger = {
  kind: 'BUDGET',
  metric: 'payments.error_rate',
  threshold: '0.01',
  window_ms: 300_000,
};

/** A rollback-authority grant spine id (deterministically minted). */
export const ROLLBACK_AUTHORITY = deriveDeterministicArtifactId('AuthorityGrant', {
  note: 'w12 deployment test rollback authority',
});

export const SUBJECT_ID = deriveDeterministicArtifactId('Decision', {
  note: 'w12 deployment test subject',
});

export function toolProducer(): Producer {
  return {
    tool: 'w12-deployment-test',
    tool_version: '1.0.0',
    model: null,
    model_version: null,
    command: 'pnpm -r test',
    environment: 'ci:test',
  };
}

export function deploymentContent(overrides: Partial<DeploymentContent> = {}): DeploymentContent {
  return {
    deployment_id: 'deploy-prod-2025-06-01',
    environment: 'production',
    artifact_revision: { kind: 'git-sha', value: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' },
    target_runtime: { runtime_id: 'runtime:prod-cluster', runtime_kind: 'container', runtime_version: '1.4.0' },
    configuration: { replicas: 3, feature_flags: { newCheckout: true } },
    rollback: {
      mechanism: BOUNDED_MECHANISM,
      trigger: BUDGET_TRIGGER,
      authority_ref: ROLLBACK_AUTHORITY,
      exception: null,
    },
    ...overrides,
  };
}

export function makeDeployment(overrides: Partial<DeploymentContent> = {}): DeploymentRecord {
  return createDeployment({
    content: deploymentContent(overrides),
    provenance: ['w12:deployment-test:record'],
    created_at: T0,
    status: 'DRAFT',
  });
}
