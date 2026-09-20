/**
 * View assembly — the deterministic bridge from the demo world (domain
 * artifacts) to the W11 view-models (projected by @sos-2/ui-contracts).
 *
 * The server and the tests share this module: the same fixture ALWAYS
 * produces the same view-models, page by page, byte for byte.
 *
 * ZERO domain logic here: reconciliation is delegated to @sos-2/conformance,
 * freshness to @sos-2/evidence (through the projection), and every
 * view-model is built by @sos-2/ui-contracts projection functions.
 */

import type { ImplementationModel } from '@sos-2/semantic-spine';
import { isImplementationModel } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import { reconcile } from '@sos-2/conformance';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import type { DemoWorld } from './demo/build-demo.js';
import {
  buildRationaleChain,
  projectAsk,
  projectAssurance,
  projectCandidateComparison,
  projectEvidenceSet,
  projectExperiment,
  projectHistory,
  projectMetaState,
  projectMission,
  projectPackage,
  projectReconciliation,
  projectRepertoire,
  projectRollback,
  projectSystemState,
} from '@sos-2/ui-contracts';
import type {
  AskVM,
  AssuranceVM,
  CandidateComparisonVM,
  EvidenceVM,
  ExperimentVM,
  HistoryVM,
  MetaStateVM,
  MissionVM,
  PackageVM,
  RationaleChain,
  ReconciliationVM,
  RepertoireVM,
  RollbackVM,
  SystemStateVM,
} from '@sos-2/ui-contracts';

export interface EvidenceQuery {
  subject: string | null;
  truth_states: EvidenceTruthState[] | null;
}

export interface ConsoleViews {
  world: DemoWorld;
  /** The current (ACTIVE) mission view model. */
  mission: MissionVM;
  /** The superseded mission revisions (history context on the mission page). */
  mission_history: MissionVM[];
  /** The current system state view model (with the observed model summary). */
  system_state: SystemStateVM;
  /** The architecture/reality reconciliation view model (recomputed through @sos-2/conformance). */
  reconciliation: ReconciliationVM;
  /** Evidence investigation under a query (freshness evaluated at the world instant). */
  evidence: (query: EvidenceQuery) => EvidenceVM;
  /** The candidate comparison view model. */
  candidates: CandidateComparisonVM;
  /** All assurance cases with their living evaluations. */
  assurance: AssuranceVM[];
  /** The experiment monitoring view model. */
  experiment: ExperimentVM;
  /** The structured ASK view model. */
  ask: AskVM;
  /** The rollback (recovery declaration) view model. */
  rollback: RollbackVM;
  /** The package repertoire view model (diverse candidate set). */
  repertoire: RepertoireVM;
  /** The architecture/history supersede chains. */
  history: HistoryVM;
  /** The read-only self-evolution review view model. */
  meta: MetaStateVM;
  /** The rationale chain of any subject in the link pool (throws for unknown subjects). */
  rationaleOf: (subjectId: string) => RationaleChain;
  /** Reconcile a pasted ImplementationModel against the declared graph (the system import journey). */
  importModel: (model: ImplementationModel) => { system_state: SystemStateVM; reconciliation: ReconciliationVM };
  /** Validate a pasted model without projecting (truthful failure display). */
  isModel: (value: unknown) => value is ImplementationModel;
}

function currentOf<T extends { envelope: { status: string; id: string } }>(artifacts: readonly T[]): T {
  const active = artifacts.find((artifact) => artifact.envelope.status === 'ACTIVE');
  return active ?? (artifacts[artifacts.length - 1] as T);
}

/** Assemble every view-model from a demo world (deterministic, total). */
export function assembleViews(world: DemoWorld): ConsoleViews {
  const links: TraceLink[] = world.links;
  const rationaleOf = (subjectId: string): RationaleChain =>
    buildRationaleChain({ subject_id: subjectId, links });

  const missionV2 = currentOf(world.missions);
  const graphV2 = currentOf(world.graphs);
  const systemStateV2 = currentOf(world.system_states);
  const candidateQueue = world.candidates[0]!;
  const candidateCache = world.candidates[1]!;
  const experimentEvidence = world.evidence.filter((record) => record.subject_ref === world.experiment.artifact.envelope.id);

  const mission = projectMission(missionV2, rationaleOf(missionV2.envelope.id));
  const missionHistory = world.missions
    .filter((artifact) => artifact.envelope.id !== missionV2.envelope.id)
    .map((artifact) => projectMission(artifact, rationaleOf(artifact.envelope.id)));

  const systemState = projectSystemState(
    systemStateV2,
    world.observed_model,
    rationaleOf(systemStateV2.envelope.id),
  );

  const reconciliation = projectReconciliation({
    result: reconcile(world.observed_model, graphV2),
    declared: graphV2,
    observed: world.observed_model,
    rationale: rationaleOf(world.observed_model.id),
  });

  const evidence = (query: EvidenceQuery): EvidenceVM =>
    projectEvidenceSet({
      records: world.evidence,
      query: { subject: query.subject, truth_states: query.truth_states },
      now: world.now,
      rationale: buildRationaleChain({
        subject_id: systemStateV2.envelope.id,
        links,
        evidence_refs: world.evidence
          .filter((record) => record.subject_ref === systemStateV2.envelope.id || record.subject_ref === world.system_states[world.system_states.length - 2]!.envelope.id)
          .map((record) => record.id),
      }),
    });

  const candidates = projectCandidateComparison({
    candidates: world.candidates,
    base: { graph_id: graphV2.envelope.id, version: graphV2.envelope.version },
    evidence: world.evidence,
    rationale: buildRationaleChain({
      subject_id: candidateQueue.envelope.id,
      links,
      evidence_refs: world.evidence
        .filter((record) => record.subject_ref === candidateQueue.envelope.id)
        .map((record) => record.id),
    }),
  });

  const assurance = world.assurance_cases.map((entry) =>
    projectAssurance({
      case: entry.artifact,
      evaluation: entry.evaluation,
      rationale: buildRationaleChain({
        subject_id: entry.artifact.envelope.id,
        links,
        evidence_refs: entry.artifact.content.evidence.map((ref) => ref.evidence_id),
      }),
    }),
  );

  const experiment = projectExperiment({
    experiment: world.experiment.artifact,
    result: world.experiment.result,
    evaluation: world.experiment.evaluation,
    rationale: buildRationaleChain({
      subject_id: world.experiment.artifact.envelope.id,
      links,
      evidence_refs: experimentEvidence.map((record) => record.id),
    }),
  });

  const ask = projectAsk({
    ask: world.ask.request,
    context: world.ask.context,
    decision: world.ask.decision,
    rationale: buildRationaleChain({
      subject_id: world.ask.request.envelope.id,
      links,
      evidence_refs: world.ask.decision.content.evidence_refs,
    }),
  });

  const rollback = projectRollback({
    declaration: world.recovery_declaration,
    promotionDecision: world.promotion.record,
    rationale: buildRationaleChain({
      subject_id: world.recovery_declaration.envelope.id,
      links,
      evidence_refs: [world.recovery_declaration.content.evidence_ref],
    }),
  });

  const packageEvidence = world.package_evidence;
  const repertoire = projectRepertoire(
    world.repertoire,
    new Map(
      world.repertoire.candidates.map((candidate) => {
        const refs = packageEvidence[candidate.id] ?? [];
        return [
          candidate.id,
          buildRationaleChain({
            subject_id: candidate.id,
            links,
            evidence_refs: refs,
          }),
        ];
      }),
    ),
  );

  const history = projectHistory(
    [...world.missions, ...world.graphs, ...world.system_states],
    buildRationaleChain({
      subject_id: graphV2.envelope.id,
      links,
      evidence_refs: [],
    }),
  );

  const meta = projectMetaState(
    world.machine_state,
    buildRationaleChain({
      subject_id: systemStateV2.envelope.id,
      links,
      evidence_refs: world.evidence
        .filter((record) => record.subject_ref === systemStateV2.envelope.id)
        .map((record) => record.id),
    }),
  );

  const importModel = (model: ImplementationModel) => ({
    system_state: projectSystemState(systemStateV2, model, rationaleOf(systemStateV2.envelope.id)),
    reconciliation: projectReconciliation({
      result: reconcile(model, graphV2),
      declared: graphV2,
      observed: model,
      rationale: rationaleOf(model.id),
    }),
  });

  return {
    world,
    mission,
    mission_history: missionHistory,
    system_state: systemState,
    reconciliation,
    evidence,
    candidates,
    assurance,
    experiment,
    ask,
    rollback,
    repertoire,
    history,
    meta,
    rationaleOf,
    importModel,
    isModel: (value: unknown): value is ImplementationModel => isImplementationModel(value),
  };
}

export { projectPackage };
export type { PackageVM };
