/**
 * Brownfield stage 1 — INGESTION (W15).
 *
 * An existing-system snapshot (source tree descriptor + dependency graph +
 * runtime observations as golden fixtures) is ingested into:
 *   - the normalized spine ImplementationModel (deterministic, sorted);
 *   - the declared ArchitectureGraph (the "as-documented" legacy view) and
 *     the SystemState binding it to the exact implementation revision;
 *   - runtime telemetry through the merged W12 TelemetryIngestionAdapter
 *     (OTel-shaped traces -> raw observations), with declared-but-unobserved
 *     components recorded as explicit UNAVAILABLE gaps (never silence,
 *     never zero);
 *   - runtime conformance evidence over the declared executable invariants
 *     at the exact SystemState revision (@sos-2/runtime-conformance);
 *   - one ingestion Evidence record binding all of it (exact revisions +
 *     input digest in provenance).
 *
 * Stage handoff links (typed, spine-minted):
 *   ImplementationModel --DERIVED_FROM--> ingestion evidence
 *   ingestion evidence  --OBSERVES-->    SystemState
 *   (runtime conformance records mint their own OBSERVES/VERIFIES links.)
 *
 * The ArchitectureGraph<->SystemState mutual reference uses the sanctioned
 * W2/W4 ANCHOR pattern: the graph projects a deterministic SystemState
 * anchor id (a mutually content-addressed pair is an unconstructible hash
 * fixed point), while the SystemState references the graph's real
 * content-addressed id.
 */

import { createArchitectureGraph } from '@sos-2/architecture';
import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import { createSystemState } from '@sos-2/system-state';
import type { SystemStateArtifact } from '@sos-2/system-state';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { evaluateRuntimeConformance, structuralRuntimeAdapter } from '@sos-2/runtime-conformance';
import type { RuntimeConformanceResult } from '@sos-2/runtime-conformance';
import { InMemoryTelemetryIngestionAdapter } from '@sos-2/adapters';
import type { RawObservation } from '@sos-2/telemetry';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { ImplementationModel } from '@sos-2/semantic-spine';
import { BrownfieldError } from './errors.js';
import type { BrownfieldLoopInput } from './input.js';
import type { IngestionStageRecord } from './stages.js';
import { brownfieldTraceLink } from './trace.js';
import { normalizeSnapshot, observationsDigest, sortObservations } from './snapshot.js';

/** Everything stage 1 produces (pure data; all spine artifacts are JSON). */
export interface IngestionStageOutput {
  record: IngestionStageRecord;
  implementationModel: ImplementationModel;
  declared: ArchitectureGraphArtifact;
  systemState: SystemStateArtifact;
  systemStateAnchor: string;
  ingestionEvidence: EvidenceRecordW3;
  runtimeConformance: RuntimeConformanceResult;
  telemetry: { observations: RawObservation[]; gaps: RawObservation[] };
}

/** The deterministic SystemState anchor id for one legacy system. */
export function systemStateAnchorId(input: BrownfieldLoopInput): string {
  return deriveDeterministicArtifactId('SystemState', {
    note: 'w15 brownfield system-state anchor',
    system_name: input.snapshot.system_name,
    revision: input.snapshot.revision,
  });
}

/** Run the ingestion stage (deterministic, pure). */
export function runIngestionStage(input: BrownfieldLoopInput, inputDigest: string): IngestionStageOutput {
  // 1. Normalize the snapshot into the spine ImplementationModel contract.
  const implementationModel = normalizeSnapshot(input.snapshot);

  // 2. The declared architecture ("as documented") + the anchor-pattern
  //    SystemState binding it to the exact implementation revision.
  const anchor = systemStateAnchorId(input);
  let declared: ArchitectureGraphArtifact;
  try {
    declared = createArchitectureGraph({
      projects_system_state: { system_state_id: anchor, version: 1 },
      nodes: input.declared.nodes,
      edges: input.declared.edges,
      provenance: [...input.provenance, 'brownfield:declared-architecture'],
      created_at: input.declared.created_at,
      authority_ref: input.authority_ref,
      status: 'ACTIVE',
    });
  } catch (cause) {
    throw new BrownfieldError('INVALID_DECLARED_ARCHITECTURE', `declared architecture is invalid: ${(cause as Error).message}`);
  }
  let systemState: SystemStateArtifact;
  try {
    const incumbentId = input.learning.package_ids['incumbent'];
    systemState = createSystemState({
      content: {
        architecture_ref: { artifact_id: declared.envelope.id, version: declared.envelope.version },
        implementation: [{ artifact_id: implementationModel.id, revision: { kind: 'git-sha', value: input.snapshot.revision } }],
        configuration: [{ config_id: `${input.snapshot.system_name}-config`, revision: { kind: 'config-version', value: 'v1' } }],
        deployment: [
          {
            deployment_id: `${input.snapshot.system_name}-deployment`,
            environment: 'production',
            revision: { kind: 'deployment-id', value: `dpl-${input.snapshot.revision.slice(0, 12)}` },
          },
        ],
        policy: [],
        environment_relationships: [],
        active_experiments: [],
        package_realizations:
          incumbentId !== undefined
            ? [{ package_id: incumbentId, version: '1.0.0', realized_by: [input.goal.target_component] }]
            : [],
      },
      provenance: [...input.provenance, 'brownfield:system-state'],
      created_at: input.now,
      authority_ref: input.authority_ref,
      status: 'ACTIVE',
    });
  } catch (cause) {
    throw new BrownfieldError('INGESTION_FAILED', `system state construction failed: ${(cause as Error).message}`);
  }

  // 3. Runtime telemetry ingestion through the merged W12 adapter, with
  //    declared-but-unobserved components recorded as explicit gaps.
  const ingestionAdapter = new InMemoryTelemetryIngestionAdapter();
  const observations = input.snapshot.telemetry_traces;
  let ingested: RawObservation[];
  try {
    ingested = ingestionAdapter.ingest(observations);
  } catch (cause) {
    throw new BrownfieldError('INGESTION_FAILED', `telemetry ingestion failed: ${(cause as Error).message}`);
  }
  const observedSubjects = new Set(input.snapshot.runtime_observations.map((observation) => observation.subject_ref));
  const gaps: RawObservation[] = [];
  for (const node of declared.content.nodes) {
    if ((node.kind !== 'Component' && node.kind !== 'Adapter') || observedSubjects.has(node.id)) {
      continue;
    }
    gaps.push(
      ingestionAdapter.recordGap({
        subject_ref: node.id,
        window: { start: input.snapshot.created_at, end: input.now },
        producer: input.producer,
        detail: { reason: `declared component "${node.id}" has no runtime observation in the snapshot (recorded as UNAVAILABLE — never silence, never zero)` },
      }),
    );
  }
  const telemetryDigest = observationsDigest([...ingested, ...gaps]);

  // 4. Runtime conformance over the declared invariants at the exact
  //    SystemState revision (structural observations + recorded gaps).
  let runtimeConformance: RuntimeConformanceResult;
  try {
    runtimeConformance = evaluateRuntimeConformance({
      system_state: systemState,
      declared_architecture: declared,
      invariants: input.invariants,
      observations: sortObservations([...input.snapshot.runtime_observations, ...gaps]),
      adapter: structuralRuntimeAdapter,
      producer: input.producer,
      evaluated_at: input.now,
    });
  } catch (cause) {
    throw new BrownfieldError('INGESTION_FAILED', `runtime conformance evaluation failed: ${(cause as Error).message}`);
  }

  // 5. The ingestion evidence binding repository + runtime ingestion.
  const ingestionEvidence = createEvidence({
    kind: 'brownfield-ingestion',
    subject_ref: systemState.envelope.id,
    availability: 'SUCCESS',
    evidence_class: 'OBSERVATIONAL',
    method: 'brownfield:repository+runtime-ingestion',
    provenance: [
      ...input.provenance,
      `brownfield:system:${input.snapshot.system_name}`,
      `brownfield:source-revision:${input.snapshot.revision}`,
      `brownfield:input-digest:${inputDigest}`,
      `brownfield:telemetry:${telemetryDigest}`,
      `brownfield:modules:${implementationModel.components.length}`,
    ],
    source_revision: input.snapshot.revision,
    deployment_revision: `dpl-${input.snapshot.revision.slice(0, 12)}`,
    window: { start: input.snapshot.created_at, end: input.now },
    subject_revision: `${systemState.envelope.id}@v${systemState.envelope.version}`,
    producer: input.producer,
  });

  // 6. Stage handoff links.
  const links = [
    brownfieldTraceLink({
      source: implementationModel.id,
      target: ingestionEvidence.id,
      type: 'DERIVED_FROM',
      provenance: [...input.provenance, `brownfield:input-digest:${inputDigest}`],
    }),
    brownfieldTraceLink({
      source: ingestionEvidence.id,
      target: systemState.envelope.id,
      type: 'OBSERVES',
      provenance: [...input.provenance, 'brownfield:stage:ingestion'],
    }),
    ...runtimeConformance.links,
  ];

  const verdicts: Record<'PASS' | 'FAIL' | 'UNKNOWN', number> = { PASS: 0, FAIL: 0, UNKNOWN: 0 };
  for (const recordEntry of runtimeConformance.records) {
    verdicts[recordEntry.verdict] += 1;
  }

  const record: IngestionStageRecord = {
    stage: 'INGESTION',
    input_refs: [],
    output_refs: [implementationModel.id, declared.envelope.id, systemState.envelope.id, ingestionEvidence.id, ...runtimeConformance.records.map((rc) => rc.evidence.id)],
    links,
    system_name: input.snapshot.system_name,
    source_revision: input.snapshot.revision,
    system_state_id: systemState.envelope.id,
    declared_architecture_id: declared.envelope.id,
    implementation_model_id: implementationModel.id,
    ingestion_evidence_id: ingestionEvidence.id,
    module_count: implementationModel.components.length,
    dependency_count: implementationModel.dependencies.length,
    interface_count: implementationModel.interfaces.length,
    runtime_observation_count: input.snapshot.runtime_observations.length,
    telemetry: {
      ingested: ingested.length,
      spans: observations.spans?.length ?? 0,
      metrics: observations.metrics?.length ?? 0,
      logs: observations.logs?.length ?? 0,
      gaps: gaps.length,
      digest: telemetryDigest,
    },
    runtime_conformance: {
      verdicts,
      evidence_ids: runtimeConformance.records.map((rc) => rc.evidence.id),
    },
  };

  return {
    record,
    implementationModel,
    declared,
    systemState,
    systemStateAnchor: anchor,
    ingestionEvidence,
    runtimeConformance,
    telemetry: { observations: ingested, gaps },
  };
}
