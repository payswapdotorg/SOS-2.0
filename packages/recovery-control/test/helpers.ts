/**
 * Shared test fixtures for @sos-2/recovery-control tests. Grants come from
 * the merged W1 authority (@sos-2/authority createGrant); evidence records
 * from the merged W3 authority (@sos-2/evidence createEvidence); all other
 * ids are minted deterministically through the spine.
 */

import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import { createGrant } from '@sos-2/authority';
import type { AuthorityGrantArtifact, GrantScope } from '@sos-2/authority';
import { createEvidence } from '@sos-2/evidence';
import type { CreateEvidenceInput, EvidenceRecordW3 } from '@sos-2/evidence';
import type { Producer } from '@sos-2/provenance';
import type {
  GovernedException,
  RecoveryDeclarationArtifact,
  RecoveryDeclarationContent,
  RecoveryMechanism,
  RecoveryTrigger,
} from '../src/index.js';
import { createRecoveryDeclaration } from '../src/index.js';

export const T0 = '2025-03-01T00:00:00.000Z';
export const T1 = '2025-03-02T00:00:00.000Z';
export const T2 = '2025-03-03T00:00:00.000Z';
export const GRANT_EXPIRY = '2025-12-31T00:00:00.000Z';

/** The live change artifact (a promoted Decision) the declaration is attached to. */
export const CHANGE_REF = deriveDeterministicArtifactId('Decision', {
  note: 'w8 recovery-control test live change',
  change: 'promote-payment-v2',
});

export function toolProducer(): Producer {
  return {
    tool: 'w8-recovery-control-test',
    tool_version: '1.0.0',
    model: null,
    model_version: null,
    command: 'pnpm -r test',
    environment: 'ci:test',
  };
}

export function rehearsalInput(overrides: Partial<CreateEvidenceInput> = {}): CreateEvidenceInput {
  return {
    kind: 'rollback-rehearsal',
    subject_ref: CHANGE_REF,
    availability: 'SUCCESS',
    evidence_class: 'INTERVENTIONAL',
    method: 'rollback-rehearsal:drill-exit-code',
    provenance: ['W8:recovery-control-fixture'],
    source_revision: 'rev-0001',
    deployment_revision: null,
    window: { start: T0, end: T1 },
    subject_revision: 'rev-0001',
    producer: toolProducer(),
    ...overrides,
  };
}

export function rehearsalEvidence(overrides: Partial<CreateEvidenceInput> = {}): EvidenceRecordW3 {
  return createEvidence(rehearsalInput(overrides));
}

export function grantFor(
  scope: GrantScope,
  permissions: string[],
  overrides: { expiryAt?: string; status?: 'DRAFT' | 'ACTIVE' } = {},
): AuthorityGrantArtifact {
  return createGrant({
    grantee: 'w8-release-operators',
    scope,
    permissions,
    expiry: { kind: 'TIME', at: overrides.expiryAt ?? GRANT_EXPIRY },
    provenance: ['W8:recovery-control-fixture:grant'],
    created_at: T0,
    status: overrides.status ?? 'ACTIVE',
  });
}

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

export const GOVERNED_EXCEPTION: GovernedException = {
  authority_ref: deriveDeterministicArtifactId('Decision', {
    note: 'w8 recovery-control test exception authority',
    exception: 'accept-unbounded-for-payments-v2',
  }),
  containment: 'The change is guarded by an out-of-band kill switch operated by the on-call authority.',
  provenance: ['W8:recovery-control-fixture:exception', 'architect-approval:2025-03-01'],
};

export function declarationContent(
  overrides: Partial<RecoveryDeclarationContent> = {},
): RecoveryDeclarationContent {
  return {
    change_ref: CHANGE_REF,
    mechanism: BOUNDED_MECHANISM,
    trigger: BUDGET_TRIGGER,
    authority_ref: grantFor({ kind: 'ARTIFACT', artifact_id: CHANGE_REF }, ['PROMOTE']).envelope.id,
    evidence_ref: rehearsalEvidence().id,
    exception: null,
    ...overrides,
  };
}

export function makeDeclaration(
  overrides: Partial<RecoveryDeclarationContent> = {},
): RecoveryDeclarationArtifact {
  return createRecoveryDeclaration({
    content: declarationContent(overrides),
    provenance: ['W8:recovery-control-fixture:declaration'],
    created_at: T1,
    status: 'ACTIVE',
  });
}
