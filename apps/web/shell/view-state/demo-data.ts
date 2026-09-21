/**
 * View assembly — the deterministic bridge from the DEMO fixture world (via
 * @sos-2/web-contracts) to the product view models the shell renders
 * (mirrors the W11 console's views.ts discipline: the same fixture ALWAYS
 * produces the same view models, page by page; zero domain logic here —
 * every projection comes from @sos-2/web-contracts, which itself imports
 * every vocabulary from the owning @sos-2/* package).
 *
 * The live data plane (Work Order P2) will replace the fixture reads with
 * durable-store reads that fill the SAME view-model shapes.
 */

import {
  allTruthStates,
  authorityModeLabel,
  authorityModeNote,
  buildDemoWebWorld,
  compareDemoLeases,
  compareDemoTasks,
  currentGapOf,
  demoDataSource,
  DEMO_NOTE,
  gateNextAction,
  hasRationaleFor,
  projectActiveTask,
  projectBodyLease,
  projectCurrentChange,
  projectEvidenceQuality,
  projectExperimentStatus,
  projectMissionHero,
  projectNextAllowedAction,
  projectObservationStatus,
  projectPackageReuse,
  projectRecentLearning,
  projectRationaleView,
  projectShortfallOpportunity,
  projectSystemCondition,
  rationaleRoute,
  type ActiveTaskSummaryVM,
  type AuthorityModeView,
  type BodyLeaseSummaryVM,
  type DemoWebWorld,
  type EvidenceQualitySummaryVM,
  type MissionHeroVM,
  type NextAllowedActionVM,
  type ObservationStatusVM,
  type PackageReuseSummaryVM,
  type RecentLearningVM,
  type RationaleViewVM,
  type ShortfallOpportunityVM,
  type SystemConditionVM,
  type CurrentChangeSummaryVM,
  type ExperimentStatusSummaryVM,
} from '@sos-2/web-contracts';
import { buildRationaleChain } from '@sos-2/ui-contracts';
import type { RationaleChain } from '@sos-2/ui-contracts';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';

const world: DemoWebWorld = buildDemoWebWorld();
const source = demoDataSource(world.fixture_revision, DEMO_NOTE);

const mission = world.missions.find((artifact) => artifact.envelope.status === 'ACTIVE') ?? world.missions[world.missions.length - 1]!;
const missionHistory = world.missions.filter((artifact) => artifact.envelope.id !== mission.envelope.id);
const systemState = world.system_states.find((artifact) => artifact.envelope.status === 'ACTIVE') ?? world.system_states[world.system_states.length - 1]!;
const candidateQueue = world.candidates[0]!;
const experiment = world.experiment.artifact;

function chain(subjectId: string, evidenceRefs: readonly string[] = []): RationaleChain {
  return buildRationaleChain({ subject_id: subjectId, links: world.links, evidence_refs: evidenceRefs });
}

/** The authority mode shown across the console (a product view state). */
export const AUTHORITY_MODE: AuthorityModeView = 'AUTONOMOUS_WITH_ASK';

// ---------------------------------------------------------------------------
// Hero + overview
// ---------------------------------------------------------------------------

const hero: MissionHeroVM = projectMissionHero({
  mission,
  gaps: world.gaps,
  rationale: chain(mission.envelope.id, evidenceAbout(mission.envelope.id).map((record) => record.id)),
  data_source: source,
  evidence_refs: evidenceAbout(mission.envelope.id).map((record) => record.id),
  uncertainty: {
    uncertainty_class: 'MODERATE',
    statement: 'The EU latency picture rests on partially available peak-hour telemetry; the exact p95 value is not fully known.',
  },
  authority: {
    mode: AUTHORITY_MODE,
    required_permission: 'REVISE',
    grant_ref: world.grants.mission_revision.envelope.id,
    note: 'Mission revisions are authority-controlled; the active revision grant is held.',
  },
  next_allowed_action: {
    action_id: 'view-mission',
    kind: 'NAVIGATE',
    label: 'Open the Mission',
    description: 'See the purpose, goals, measures and constraints guiding every change.',
    href: '/mission',
    rationale_ref: mission.envelope.id,
    requires_authority: null,
  },
});

function evidenceAbout(...subjectIds: string[]): EvidenceRecordW3[] {
  return world.evidence.filter((record) => subjectIds.includes(record.subject_ref));
}

const currentSystemEvidence = evidenceAbout(systemState.envelope.id, world.observed_model_id);

const systemCondition: SystemConditionVM = projectSystemCondition({
  system_state: systemState,
  current_evidence: currentSystemEvidence,
  coverage: {
    present: ['checkout uptime telemetry', 'EU latency telemetry', 'legacy-adapter telemetry'],
    missing: ['implementation-model telemetry (collector outage)'],
  },
  rationale: chain(systemState.envelope.id, currentSystemEvidence.map((record) => record.id)),
  data_source: source,
  uncertainty: {
    uncertainty_class: 'MODERATE',
    statement: 'Latency telemetry for the peak window is only partially available; the model collector is unreachable.',
  },
  authority: {
    mode: AUTHORITY_MODE,
    required_permission: 'REVISE',
    grant_ref: world.grants.mission_revision.envelope.id,
    note: 'System State transitions require revision authority; the active grant is held.',
  },
  next_allowed_action: {
    action_id: 'view-system',
    kind: 'NAVIGATE',
    label: 'Open the System',
    description: 'See the exact implementation, deployment, configuration and policy revisions.',
    href: '/system',
    rationale_ref: systemState.envelope.id,
    requires_authority: null,
  },
});

const currentGapRecord = currentGapOf(world.gaps);
const shortfall: ShortfallOpportunityVM | null = currentGapRecord
  ? projectShortfallOpportunity({
      gap: currentGapRecord,
      mission,
      rationale: chain(mission.envelope.id, currentGapRecord.evidence_refs),
      data_source: source,
      authority: {
        mode: AUTHORITY_MODE,
        required_permission: null,
        grant_ref: null,
        note: 'The gap is defined by the mission measure; closing it is gated by evidence and authority, not by this view.',
      },
      next_allowed_action: {
        action_id: 'view-gap-experiment',
        kind: 'NAVIGATE',
        label: 'See the change addressing it',
        description: 'A canary experiment is testing the durable-queue change against this gap.',
        href: '/experiments',
        rationale_ref: experiment.envelope.id,
        requires_authority: null,
      },
    })
  : null;

/**
 * The hero's NEXT ALLOWED ACTION (shell view-state rule): a pending ASK
 * outranks every autonomous next step — a question SOS cannot answer with
 * evidence is the first thing the user should see.
 */
const askPendingAction = {
  action_id: 'answer-open-question',
  kind: 'DECIDE' as const,
  label: 'Answer the open question',
  description: 'One question only a human can answer is waiting: should the legacy SOAP payment adapter be retired?',
  href: '/ask',
  rationale_ref: world.ask.request.envelope.id,
  requires_authority: null,
};

const nextAction: NextAllowedActionVM = projectNextAllowedAction({
  subject_id: world.ask.request.envelope.id,
  action: askPendingAction,
  availability: gateNextAction({ action: askPendingAction, data_source: source, pending_ask_ref: world.ask.request.envelope.id }),
  priority_reason: 'A question SOS cannot answer with evidence outranks every autonomous next step.',
  rationale: chain(world.ask.request.envelope.id, world.ask.decision.content.evidence_refs),
  data_source: source,
  evidence_refs: world.ask.decision.content.evidence_refs,
  uncertainty: {
    uncertainty_class: 'UNQUANTIFIED',
    statement: 'Whether any off-platform EU partner still integrates the legacy SOAP interface is irreducible — observation cannot answer it.',
  },
  authority: {
    mode: AUTHORITY_MODE,
    required_permission: 'RETIRE',
    grant_ref: world.grants.retirement.envelope.id,
    note: 'Retirement authority is held, but the human answer to the open question is required before acting.',
  },
});

// ---------------------------------------------------------------------------
// Below-hero cards
// ---------------------------------------------------------------------------

const currentChange: CurrentChangeSummaryVM = projectCurrentChange({
  candidate: candidateQueue,
  title: 'Durable-queue checkout buffering',
  experiment_ref: experiment.envelope.id,
  rollback_evidence: world.evidence.filter((record) => record.kind === 'rollback-rehearsal'),
  rationale: chain(candidateQueue.envelope.id, evidenceAbout(candidateQueue.envelope.id).map((record) => record.id)),
  data_source: source,
  evidence_refs: evidenceAbout(candidateQueue.envelope.id).map((record) => record.id),
  uncertainty: {
    uncertainty_class: 'MODERATE',
    statement: 'Canary evidence covers 10% of EU peak traffic; full-exposure behavior is unproven.',
  },
  authority: {
    mode: AUTHORITY_MODE,
    required_permission: 'PROMOTE',
    grant_ref: world.grants.promotion.envelope.id,
    note: 'Promotion authority over the candidate is held; advancing is still evidence-gated.',
  },
  next_allowed_action: {
    action_id: 'view-change',
    kind: 'REVIEW',
    label: 'Open Changes',
    description: 'See the full change story with its protections.',
    href: '/changes',
    rationale_ref: candidateQueue.envelope.id,
    requires_authority: 'PROMOTE',
  },
});

const evidenceQuality: EvidenceQualitySummaryVM = projectEvidenceQuality({
  records: world.evidence,
  coverage: {
    present: ['runtime telemetry', 'CI test runs', 'load tests', 'rehearsals', 'incident reports'],
    missing: ['implementation-model telemetry (collector outage)'],
  },
  rationale: chain(systemState.envelope.id, currentSystemEvidence.map((record) => record.id)),
  data_source: source,
  uncertainty: {
    uncertainty_class: 'MODERATE',
    statement: 'Most sources are fresh for the June window; one source is unreachable and stays explicitly unavailable.',
  },
  authority: {
    mode: AUTHORITY_MODE,
    required_permission: null,
    grant_ref: null,
    note: 'Reviewing evidence requires no authority; producing it is provenance-controlled.',
  },
  next_allowed_action: {
    action_id: 'view-evidence',
    kind: 'NAVIGATE',
    label: 'Open Evidence',
    description: 'See every record with its truth state, provenance and producer.',
    href: '/evidence',
    rationale_ref: systemState.envelope.id,
    requires_authority: null,
  },
});

const experimentStatus: ExperimentStatusSummaryVM = projectExperimentStatus({
  experiment,
  title: 'Durable-queue canary',
  result: {
    simulated: world.experiment.result.simulated,
    simulator: { version: world.experiment.result.simulator!.version, seed: world.experiment.result.simulator!.seed },
  },
  evaluation_summary: `Overall availability of the SIMULATED run: ${world.experiment.evaluation.overall_availability}. The simulated run is evaluation infrastructure — it is never intervention evidence.`,
  rationale: chain(experiment.envelope.id, evidenceAbout(experiment.envelope.id).map((record) => record.id)),
  data_source: source,
  evidence_refs: evidenceAbout(experiment.envelope.id).map((record) => record.id),
  uncertainty: {
    uncertainty_class: 'MODERATE',
    statement: 'The evaluated run is simulated with a fixed seed; the live canary evidence covers 10% exposure so far.',
  },
  authority: {
    mode: AUTHORITY_MODE,
    required_permission: 'PROMOTE',
    grant_ref: world.grants.promotion.envelope.id,
    note: 'Advancing the canary ladder requires promotion-grade evidence under the held grant.',
  },
  next_allowed_action: {
    action_id: 'advance-canary',
    kind: 'EXECUTE',
    label: 'Advance the canary to 25% exposure',
    description: 'Raises the treatment arm exposure along the wired ladder [5, 10, 25, 50].',
    href: null,
    rationale_ref: experiment.envelope.id,
    requires_authority: 'PROMOTE',
  },
});

const packageReuse: PackageReuseSummaryVM = projectPackageReuse({
  packages: world.packages,
  composition_count: 0,
  composition_note: 'No compositions are formed in this dataset yet; the composition workspace grows with package reuse.',
  rationale: chain(mission.envelope.id),
  data_source: source,
  uncertainty: {
    uncertainty_class: 'MODERATE',
    statement: 'Applicability is context-conditioned; each package carries its own qualitative uncertainty class.',
  },
  authority: {
    mode: AUTHORITY_MODE,
    required_permission: null,
    grant_ref: null,
    note: 'Reusing a package is gated by its own assurance obligations, not by this view.',
  },
  next_allowed_action: {
    action_id: 'view-packages',
    kind: 'NAVIGATE',
    label: 'Open Packages',
    description: 'See the validated capabilities with their retained limitations.',
    href: '/packages',
    rationale_ref: null,
    requires_authority: null,
  },
});

const recentLearning: RecentLearningVM = projectRecentLearning({
  entries: world.learning,
  as_of: world.now,
  rationale: chain(mission.envelope.id),
  data_source: source,
  uncertainty: {
    uncertainty_class: 'UNQUANTIFIED',
    statement: 'Learning entries are qualitative; no score hides their context.',
  },
  authority: {
    mode: AUTHORITY_MODE,
    required_permission: null,
    grant_ref: null,
    note: 'Learning review requires no authority.',
  },
  next_allowed_action: {
    action_id: 'view-history',
    kind: 'NAVIGATE',
    label: 'Open History',
    description: 'See the revision timeline behind what SOS learned.',
    href: '/history',
    rationale_ref: null,
    requires_authority: null,
  },
});

// ---------------------------------------------------------------------------
// Active autonomous work
// ---------------------------------------------------------------------------

function taskAuthority() {
  return {
    mode: AUTHORITY_MODE,
    required_permission: null,
    grant_ref: null,
    note: 'Task work runs within the granted mission scope; bodies cannot widen authority.',
  } as const;
}

const tasks: ActiveTaskSummaryVM[] = [...world.tasks].sort(compareDemoTasks).map((task) =>
  projectActiveTask({
    task,
    leases: world.leases,
    rationale: chain(task.mission_ref, task.evidence_refs),
    data_source: source,
    uncertainty: {
      uncertainty_class: task.status === 'PAUSED' ? 'WEAK' : 'MODERATE',
      statement:
        task.status === 'PAUSED'
          ? 'Resume behavior on a replacement body is unproven; the checkpoint is retained.'
          : 'Progress is tracked through evidence, not through agent transcripts.',
    },
    authority: taskAuthority(),
    next_allowed_action: {
      action_id: `view-${task.task_id}`,
      kind: 'REVIEW',
      label: 'Review this task',
      description: 'See the summary, checkpoint and evidence links.',
      href: task.ask_ref ? '/ask' : '/',
      rationale_ref: task.ask_ref ?? task.mission_ref,
      requires_authority: null,
    },
  }),
);

const leases: BodyLeaseSummaryVM[] = [...world.leases].sort(compareDemoLeases).map((lease) =>
  projectBodyLease({
    lease,
    mission_ref: mission.envelope.id,
    rationale: chain(mission.envelope.id),
    data_source: source,
    uncertainty: {
      uncertainty_class: 'UNQUANTIFIED',
      statement: 'A lease may be suspended, replaced or released at any time without losing the task.',
    },
    authority: {
      mode: AUTHORITY_MODE,
      required_permission: null,
      grant_ref: null,
      note: 'Bodies are replaceable execution mechanisms; they hold no semantic authority.',
    },
    next_allowed_action: {
      action_id: 'view-leases',
      kind: 'REVIEW',
      label: 'Review execution resources',
      description: 'See what each body can do and how it is isolated.',
      href: '/',
      rationale_ref: null,
      requires_authority: null,
    },
  }),
);

const anyBodyWorking = leases.some((lease) => lease.status === 'ACTIVE');

const observation: ObservationStatusVM = projectObservationStatus({
  observation: world.observation,
  system_state_ref: systemState.envelope.id,
  any_body_working: anyBodyWorking,
  rationale: chain(systemState.envelope.id, currentSystemEvidence.map((record) => record.id)),
  data_source: source,
  uncertainty: {
    uncertainty_class: 'MODERATE',
    statement: 'Observation is continuous; one telemetry source is currently unreachable and stays explicitly unavailable.',
  },
  authority: {
    mode: 'READ_ONLY',
    required_permission: null,
    grant_ref: null,
    note: 'Observation requires no action authority and no body.',
  },
  next_allowed_action: {
    action_id: 'view-evidence-from-observation',
    kind: 'NAVIGATE',
    label: 'See what observation produced',
    description: 'Observation feeds the evidence pool and the system state.',
    href: '/evidence',
    rationale_ref: systemState.envelope.id,
    requires_authority: null,
  },
});

// ---------------------------------------------------------------------------
// Per-page data
// ---------------------------------------------------------------------------

/** Evidence grouped by the frozen truth-state order (all six groups always rendered). */
const evidenceGroups: { state: EvidenceTruthState; records: EvidenceRecordW3[] }[] = allTruthStates().map((state) => ({
  state,
  records: world.evidence.filter((record) => record.availability === state),
}));

/** The revision timeline (missions + system states, oldest first). */
const historyEntries = [
  ...world.missions.map((artifact) => ({
    what: 'Mission revision',
    id: artifact.envelope.id,
    version: artifact.envelope.version,
    status: artifact.envelope.status,
    at: artifact.envelope.created_at,
    detail: artifact.content.purpose,
  })),
  ...world.system_states.map((artifact) => ({
    what: 'System state revision',
    id: artifact.envelope.id,
    version: artifact.envelope.version,
    status: artifact.envelope.status,
    at: artifact.envelope.created_at,
    detail: `Observed deployment: ${artifact.content.deployment.map((entry) => entry.deployment_id).join(', ')}`,
  })),
].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));

/** The pending ASK with everything a decider needs to see. */
const askView = {
  request: world.ask.request,
  context: world.ask.context,
  decision: world.ask.decision,
  queue_size: world.ask.queue_size,
};

/** Data-source status for the More page: what is DEMO, what is not connected. */
const dataSourceStatus = {
  demo: source,
  live: {
    mission_and_system_state: 'not connected yet',
    evidence_pool: 'not connected yet',
    task_and_lease_state: 'not connected yet',
    observation_events: 'not connected yet',
  },
};

// ---------------------------------------------------------------------------
// Rationale deep-links
// ---------------------------------------------------------------------------

function subjectLabel(subjectId: string): string {
  if (subjectId === mission.envelope.id) return 'Mission';
  if (world.missions.some((artifact) => artifact.envelope.id === subjectId)) return 'Mission (earlier revision)';
  if (subjectId === systemState.envelope.id) return 'Current System State';
  if (world.system_states.some((artifact) => artifact.envelope.id === subjectId)) return 'System State (earlier revision)';
  if (subjectId === candidateQueue.envelope.id) return 'Current change candidate';
  if (world.candidates.some((artifact) => artifact.envelope.id === subjectId)) return 'Change candidate';
  if (subjectId === experiment.envelope.id) return 'Canary experiment';
  if (subjectId === world.ask.request.envelope.id) return 'Open question (ASK)';
  if (subjectId === world.ask.decision.envelope.id) return 'ASK decision record';
  if (world.packages.some((artifact) => artifact.envelope.id === subjectId)) return 'Package';
  if (world.evidence.some((record) => record.id === subjectId)) return 'Evidence record';
  if (Object.values(world.grants).some((grant) => grant.envelope.id === subjectId)) return 'Authority grant';
  if (subjectId === world.observed_model_id) return 'Observed implementation model';
  if (Object.values(world.graph_ids).includes(subjectId)) return 'Architecture graph';
  if (subjectId.startsWith('sos://CausalHypothesis/')) return 'Causal hypothesis';
  if (subjectId.startsWith('sos://ExperimentResult/')) return 'Experiment result';
  return 'SOS artifact';
}

function rationaleAnswers(subjectId: string): RationaleViewVM['answers'] {
  const record = world.evidence.find((entry) => entry.id === subjectId);
  if (record) {
    return {
      WHAT_IS_HAPPENING: `An evidence record of kind "${record.kind}" reports availability ${record.availability} about ${subjectLabel(record.subject_ref)}.`,
      WHY_DOES_SOS_BELIEVE_THIS: `The truth state was assigned by the explicit method "${record.method}", with provenance ${record.provenance.join('; ')}.`,
      WHAT_EVIDENCE_SUPPORTS_IT: `This IS the evidence: ${record.id}. ${record.llm_output ? 'It is model output — retained as analysis, never authoritative by contract.' : 'It is tool-produced observation or intervention evidence.'}`,
      WHAT_UNCERTAINTY_REMAINS: `Confidence is ${record.confidence.kind === 'QUALITATIVE' ? record.confidence.uncertainty_class : 'calibrated'}; the observation window is ${record.window ? `${record.window.start} to ${record.window.end}` : 'not declared'}.`,
      WHAT_AUTHORITY_IS_REQUIRED: record.intervention ? 'Intervention evidence required authority to act; the record retains what was authorized.' : 'Observational evidence requires no action authority.',
      WHAT_CAN_HAPPEN_NEXT: `Open the subject this record is about to see how it feeds the current picture.`,
    };
  }
  if (subjectId === mission.envelope.id) {
    return {
      WHAT_IS_HAPPENING: `The active mission guides every change: ${mission.content.purpose}`,
      WHY_DOES_SOS_BELIEVE_THIS: `This revision derives from mission v1 under an explicit revision grant, and from the constitution.`,
      WHAT_EVIDENCE_SUPPORTS_IT: `The mission is anchored by its purpose and formalized through ${mission.content.goals.length} goals and ${mission.content.measures.length} measures; system evidence links through the current system state.`,
      WHAT_UNCERTAINTY_REMAINS: hero.core.uncertainty.statement,
      WHAT_AUTHORITY_IS_REQUIRED: `Mission revision requires the REVISE permission; the active grant is held.`,
      WHAT_CAN_HAPPEN_NEXT: `Answer the open question, then keep closing the latency shortfall under evidence.`,
    };
  }
  if (subjectId === systemState.envelope.id) {
    return {
      WHAT_IS_HAPPENING: `The current system state observes the production checkout at exact revisions.`,
      WHY_DOES_SOS_BELIEVE_THIS: `It derives from the declared architecture graph and the observed implementation model, and satisfies the mission.`,
      WHAT_EVIDENCE_SUPPORTS_IT: `${currentSystemEvidence.length} evidence records observe the current state and its implementation, each with an explicit truth state.`,
      WHAT_UNCERTAINTY_REMAINS: systemCondition.core.uncertainty.statement,
      WHAT_AUTHORITY_IS_REQUIRED: `System State transitions require the REVISE permission; the active grant is held.`,
      WHAT_CAN_HAPPEN_NEXT: `Open the System page to see the exact implementation, deployment, configuration and policy revisions.`,
    };
  }
  if (subjectId === candidateQueue.envelope.id) {
    return {
      WHAT_IS_HAPPENING: `The current change buffers checkout writes through a durable queue, verified by a canary at 10% exposure.`,
      WHY_DOES_SOS_BELIEVE_THIS: `The candidate derives from the architecture graph and satisfies the mission's latency goal; a causal hypothesis links the mechanism to the predicted effect.`,
      WHAT_EVIDENCE_SUPPORTS_IT: `An interventional canary observation (SUCCESS) and a timed rollback rehearsal (SUCCESS) verify the candidate.`,
      WHAT_UNCERTAINTY_REMAINS: currentChange.core.uncertainty.statement,
      WHAT_AUTHORITY_IS_REQUIRED: `Promotion requires the PROMOTE permission; the grant is held and advancing remains evidence-gated.`,
      WHAT_CAN_HAPPEN_NEXT: `Advance the canary along the wired ladder once the evidence threshold holds.`,
    };
  }
  if (subjectId === experiment.envelope.id) {
    return {
      WHAT_IS_HAPPENING: `A treatment-control canary compares the durable-queue change against control at 10% exposure with two wired guardrails.`,
      WHY_DOES_SOS_BELIEVE_THIS: `The experiment verifies the candidate and derives from its causal hypothesis; the staged exposure ladder is explicit.`,
      WHAT_EVIDENCE_SUPPORTS_IT: `The evaluated run is SIMULATED (fixed seed 424242) — evaluation infrastructure, never intervention evidence; live guardrail telemetry is not yet supported and stays UNSUPPORTED.`,
      WHAT_UNCERTAINTY_REMAINS: experimentStatus.core.uncertainty.statement,
      WHAT_AUTHORITY_IS_REQUIRED: `Advancing the ladder requires promotion-grade evidence under the held PROMOTE grant.`,
      WHAT_CAN_HAPPEN_NEXT: `Advance the canary to 25% when the evidence threshold holds, or roll back when a guardrail trips.`,
    };
  }
  if (subjectId === world.ask.request.envelope.id || subjectId === world.ask.decision.envelope.id) {
    return {
      WHAT_IS_HAPPENING: `A question is waiting for a human decision: ${world.ask.request.content.decision}`,
      WHY_DOES_SOS_BELIEVE_THIS: `The decision engine escalated: every checkable condition is green, but the deciding uncertainty is irreducible by observation.`,
      WHAT_EVIDENCE_SUPPORTS_IT: `Legacy-adapter telemetry (SUCCESS) shows zero traffic through the adapter in the current window.`,
      WHAT_UNCERTAINTY_REMAINS: nextAction.core.uncertainty.statement,
      WHAT_AUTHORITY_IS_REQUIRED: `Retirement authority is held, but only a human answer can decide the off-platform partner question.`,
      WHAT_CAN_HAPPEN_NEXT: `Open ASK and choose one of the presented alternatives.`,
    };
  }
  if (world.packages.some((artifact) => artifact.envelope.id === subjectId)) {
    const pkg = world.packages.find((artifact) => artifact.envelope.id === subjectId)!;
    return {
      WHAT_IS_HAPPENING: `A validated, reusable package: ${pkg.content.semantic_capability}.`,
      WHY_DOES_SOS_BELIEVE_THIS: `The package realizes a candidate change and carries its own evidence, preconditions and learned limitations.`,
      WHAT_EVIDENCE_SUPPORTS_IT: `${pkg.content.evidence_refs.length} supporting evidence refs${pkg.content.failure_refs.length > 0 ? ` and ${pkg.content.failure_refs.length} retained failure refs` : ''}.`,
      WHAT_UNCERTAINTY_REMAINS: `Applicability is context-conditioned (${pkg.content.applicability.map((entry) => (entry.kind === 'QUALITATIVE' ? entry.uncertainty_class : 'calibrated')).join(', ')}).`,
      WHAT_AUTHORITY_IS_REQUIRED: `Adoption is gated by the package's own assurance obligations, not by direct authority.`,
      WHAT_CAN_HAPPEN_NEXT: `Open Packages to see the capability, its family and its limitations.`,
    };
  }
  // The honest generic answer set for subjects that are part of the graph
  // but have no dedicated product surface in this wave.
  return {
    WHAT_IS_HAPPENING: `${subjectLabel(subjectId)} is part of the typed trace-link web behind the current picture.`,
    WHY_DOES_SOS_BELIEVE_THIS: 'It is connected to the current mission, system state and change story through typed spine trace links.',
    WHAT_EVIDENCE_SUPPORTS_IT: 'Supporting evidence records are listed below with their exact truth states.',
    WHAT_UNCERTAINTY_REMAINS: 'No view model in this console wave summarizes the remaining uncertainty for this subject.',
    WHAT_AUTHORITY_IS_REQUIRED: 'No authority requirement is recorded for this subject in this console wave.',
    WHAT_CAN_HAPPEN_NEXT: 'Return to the Overview to see the surfaces that carry authority and next actions.',
  };
}

/** The rationale view of a spine subject, or null when the subject has no trace links (rendered as an honest state block). */
export function rationaleOf(subjectId: string): RationaleViewVM | null {
  if (!hasRationaleFor(subjectId, world.links)) {
    return null;
  }
  return projectRationaleView({
    subject_id: subjectId,
    subject_label: subjectLabel(subjectId),
    answers: rationaleAnswers(subjectId),
    links: world.links,
    evidence_refs: evidenceRefsOf(subjectId),
    evidence: world.evidence,
  });
}

function evidenceRefsOf(subjectId: string): string[] {
  const direct = world.evidence.filter((record) => record.subject_ref === subjectId).map((record) => record.id);
  if (subjectId === mission.envelope.id) return hero.core.evidence_refs;
  if (subjectId === systemState.envelope.id) return systemCondition.core.evidence_refs;
  if (subjectId === candidateQueue.envelope.id) return currentChange.core.evidence_refs;
  if (subjectId === experiment.envelope.id) return experimentStatus.core.evidence_refs;
  if (subjectId === world.ask.request.envelope.id || subjectId === world.ask.decision.envelope.id) {
    return world.ask.decision.content.evidence_refs;
  }
  return direct;
}

/** The deep-link route for a spine subject (path-safe decomposition). */
export function rationaleHref(subjectId: string): string {
  const withoutScheme = subjectId.slice('sos://'.length);
  const separator = withoutScheme.lastIndexOf('/');
  return rationaleRoute(withoutScheme.slice(0, separator), withoutScheme.slice(separator + 1));
}

// ---------------------------------------------------------------------------
// The assembled views (the single source every page renders from)
// ---------------------------------------------------------------------------

export const views = {
  world,
  source,
  authorityMode: {
    mode: AUTHORITY_MODE,
    label: authorityModeLabel(AUTHORITY_MODE),
    note: authorityModeNote(AUTHORITY_MODE),
  },
  hero,
  systemCondition,
  shortfall,
  nextAction,
  currentChange,
  evidenceQuality,
  experimentStatus,
  packageReuse,
  recentLearning,
  tasks,
  leases,
  observation,
  anyBodyWorking,
  mission,
  missionHistory,
  systemState,
  packages: world.packages,
  candidates: world.candidates,
  evidenceGroups,
  historyEntries,
  askView,
  dataSourceStatus,
  rationaleOf,
  rationaleHref,
} as const;

export type Views = typeof views;
