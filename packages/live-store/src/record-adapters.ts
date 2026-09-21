/**
 * Record adapters (Work Order P2): the per-repository mapping from stored
 * records to (id, revision, guard).
 *
 * EVERY adapter consumes the OWNING frozen domain package's guard VERBATIM
 * (imported, never re-implemented, never weakened): a record that the
 * owning package rejects is rejected here, loudly. The spine remains the
 * ONLY identity authority — `idOf` EXTRACTS the id the record already
 * carries (the spine-minted envelope id, or the record's own
 * content-addressed id); the store never mints ids.
 *
 * REVISION SEMANTICS per record family:
 *
 *   - Spine-envelope artifacts (Mission, Context, SystemState,
 *     ArchitectureGraph, CandidateState, AssuranceCase, Experiment,
 *     Decision, AuthorityGrant, Package, ArchitectureMemory,
 *     CausalHypothesis): the exact revision IS envelope.version — preserved
 *     verbatim (never rewritten). Forward writes (higher version) are
 *     accepted; lifecycle status flips flow through the dedicated
 *     setStatus operation (the W12 RepositoryAdapter precedent) because
 *     they are same-revision SANCTIONED divergences validated by the
 *     spine's withStatus.
 *
 *   - Immutable content-addressed records (Evidence, ProvenanceRecord):
 *     the id is derived by the owning package from the exact content, so
 *     revision is 1 for every record; an identical replay is an idempotent
 *     no-op and a same-id divergent write is a typed conflict (a forged
 *     collision — the store never rewrites content).
 *
 *   - P2-owned mutable state (TaskRecord, BodyLeaseRecord,
 *     DevelopmentStateRecord): the caller-owned explicit `revision` field
 *     (optimistic concurrency); every mutation is a forward whole-record
 *     write.
 */

import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import { withStatus } from '@sos-2/semantic-spine';
import { assertValidMission, type MissionArtifact } from '@sos-2/mission';
import { assertValidContext, type ContextArtifact } from '@sos-2/context';
import { assertValidSystemStateArtifact, type SystemStateArtifact } from '@sos-2/system-state';
import { assertValidEvidenceRecord, type EvidenceRecordW3 } from '@sos-2/evidence';
import { assertValidArchitectureGraphArtifact, type ArchitectureGraphArtifact } from '@sos-2/architecture';
import { assertValidCandidateState, type CandidateStateFixture } from '@sos-2/experiments';
import { assertValidAssuranceCase, type AssuranceCaseArtifact } from '@sos-2/assurance';
import { assertValidExperiment, type ExperimentArtifact } from '@sos-2/experiments';
import { assertValidDecisionRecord, type DecisionRecord } from '@sos-2/decision';
import { assertValidGrant, type AuthorityGrantArtifact } from '@sos-2/authority';
import { assertValidPackageArtifact, type PackageArtifact } from '@sos-2/packages';
import { assertValidArchitectureMemory, type ArchitectureMemoryArtifact } from '@sos-2/memory';
import { assertValidCausalHypothesis, type CausalHypothesisArtifact } from '@sos-2/causal';
import { assertValidProvenanceRecord, type ProvenanceRecord } from '@sos-2/provenance';
import {
  assertValidBodyLeaseRecord,
  assertValidDevelopmentStateRecord,
  assertValidTaskRecord,
  type BodyLeaseRecord,
  type DevelopmentStateRecord,
  type TaskRecord,
} from './state-records.js';

/**
 * The per-repository record adapter. `assertValid` MUST be the owning
 * package's guard (consumed verbatim); `table` is the durable table name
 * (a provider-neutral storage concern, never semantic vocabulary).
 */
export interface RecordAdapter<R> {
  /** Repository kind (semantic vocabulary of the owning package, e.g. "Mission"). */
  readonly kind: string;
  /** Durable table name (storage concern, e.g. "mission"). */
  readonly table: string;
  idOf(record: R): string;
  revisionOf(record: R): number;
  assertValid(record: unknown): asserts record is R;
}

/**
 * Adapter for spine-envelope artifacts: adds the SANCTIONED lifecycle
 * transition (spine withStatus — identity preserved, invalid transitions
 * throw), used by the dedicated setStatus repository operation.
 */
export interface EnvelopedRecordAdapter<R> extends RecordAdapter<R> {
  withStatus(record: R, next: ArtifactStatus): R;
}

/** Structural bound for spine-envelope artifacts (the envelope IS the identity + revision carrier). */
interface EnvelopedRecord {
  envelope: ArtifactEnvelope;
}

function envelopedAdapter<R extends EnvelopedRecord>(args: {
  kind: string;
  table: string;
  assertValid(record: unknown): asserts record is R;
}): EnvelopedRecordAdapter<R> {
  return {
    kind: args.kind,
    table: args.table,
    idOf: (record) => record.envelope.id,
    revisionOf: (record) => record.envelope.version,
    assertValid: args.assertValid,
    withStatus: (record, next) => ({ ...record, envelope: withStatus(record.envelope, next) }),
  };
}

function immutableAdapter<R extends { id: string }>(args: {
  kind: string;
  table: string;
  assertValid(record: unknown): asserts record is R;
}): RecordAdapter<R> {
  return {
    kind: args.kind,
    table: args.table,
    idOf: (record) => record.id,
    revisionOf: () => 1,
    assertValid: args.assertValid,
  };
}

// ---------------------------------------------------------------------------
// The repository adapters (one per supported record family)
// ---------------------------------------------------------------------------

export const missionAdapter: EnvelopedRecordAdapter<MissionArtifact> = envelopedAdapter<MissionArtifact>({
  kind: 'Mission',
  table: 'mission',
  assertValid: assertValidMission,
});

export const contextAdapter: EnvelopedRecordAdapter<ContextArtifact> = envelopedAdapter<ContextArtifact>({
  kind: 'Context',
  table: 'context',
  assertValid: assertValidContext,
});

export const systemStateAdapter: EnvelopedRecordAdapter<SystemStateArtifact> = envelopedAdapter<SystemStateArtifact>({
  kind: 'SystemState',
  table: 'system_state',
  assertValid: assertValidSystemStateArtifact,
});

export const evidenceAdapter: RecordAdapter<EvidenceRecordW3> = immutableAdapter<EvidenceRecordW3>({
  kind: 'Evidence',
  table: 'evidence',
  assertValid: assertValidEvidenceRecord,
});

export const architectureAdapter: EnvelopedRecordAdapter<ArchitectureGraphArtifact> = envelopedAdapter<ArchitectureGraphArtifact>({
  kind: 'ArchitectureGraph',
  table: 'architecture_graph',
  assertValid: assertValidArchitectureGraphArtifact,
});

export const candidateAdapter: EnvelopedRecordAdapter<CandidateStateFixture> = envelopedAdapter<CandidateStateFixture>({
  kind: 'CandidateState',
  table: 'candidate_state',
  assertValid: assertValidCandidateState,
});

export const assuranceAdapter: EnvelopedRecordAdapter<AssuranceCaseArtifact> = envelopedAdapter<AssuranceCaseArtifact>({
  kind: 'AssuranceCase',
  table: 'assurance_case',
  assertValid: assertValidAssuranceCase,
});

export const experimentAdapter: EnvelopedRecordAdapter<ExperimentArtifact> = envelopedAdapter<ExperimentArtifact>({
  kind: 'Experiment',
  table: 'experiment',
  assertValid: assertValidExperiment,
});

export const decisionAdapter: EnvelopedRecordAdapter<DecisionRecord> = envelopedAdapter<DecisionRecord>({
  kind: 'Decision',
  table: 'decision',
  assertValid: assertValidDecisionRecord,
});

export const authorityGrantAdapter: EnvelopedRecordAdapter<AuthorityGrantArtifact> = envelopedAdapter<AuthorityGrantArtifact>({
  kind: 'AuthorityGrant',
  table: 'authority_grant',
  assertValid: assertValidGrant,
});

export const packageAdapter: EnvelopedRecordAdapter<PackageArtifact> = envelopedAdapter<PackageArtifact>({
  kind: 'Package',
  table: 'package',
  assertValid: assertValidPackageArtifact,
});

export const architectureMemoryAdapter: EnvelopedRecordAdapter<ArchitectureMemoryArtifact> = envelopedAdapter<ArchitectureMemoryArtifact>({
  kind: 'ArchitectureMemory',
  table: 'architecture_memory',
  assertValid: assertValidArchitectureMemory,
});

export const causalHypothesisAdapter: EnvelopedRecordAdapter<CausalHypothesisArtifact> = envelopedAdapter<CausalHypothesisArtifact>({
  kind: 'CausalHypothesis',
  table: 'causal_hypothesis',
  assertValid: assertValidCausalHypothesis,
});

export const provenanceRecordAdapter: RecordAdapter<ProvenanceRecord> = immutableAdapter<ProvenanceRecord>({
  kind: 'ProvenanceRecord',
  table: 'provenance_record',
  assertValid: assertValidProvenanceRecord,
});

export const developmentStateAdapter: RecordAdapter<DevelopmentStateRecord> = {
  kind: 'DevelopmentState',
  table: 'development_state',
  idOf: (record) => record.state_id,
  revisionOf: (record) => record.revision,
  assertValid: assertValidDevelopmentStateRecord,
};

export const taskAdapter: RecordAdapter<TaskRecord> = {
  kind: 'Task',
  table: 'task',
  idOf: (record) => record.task_id,
  revisionOf: (record) => record.revision,
  assertValid: assertValidTaskRecord,
};

export const bodyLeaseAdapter: RecordAdapter<BodyLeaseRecord> = {
  kind: 'BodyLease',
  table: 'body_lease',
  idOf: (record) => record.lease_id,
  revisionOf: (record) => record.revision,
  assertValid: assertValidBodyLeaseRecord,
};
