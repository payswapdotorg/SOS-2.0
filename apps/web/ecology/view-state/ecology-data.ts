/**
 * The P10 view assembly — the deterministic bridge from the DEMO ecology
 * fixture world (via @sos-2/web-contracts/ecology) through the LIVE-STORE
 * repositories to the deep product view models the P10 surfaces render
 * (mirrors the P1 shell's demo-data discipline: the same fixture + the same
 * seeded store ALWAYS produce the same view models, page by page; zero
 * domain logic here — every projection comes from @sos-2/web-contracts).
 *
 * The live data plane: the world is seeded ONCE into the in-memory
 * reference live store through the repositories' own validated writes, and
 * every surface then READS through @sos-2/live-store repositories
 * (readEcologyLiveState) — the same ports a real provider-backed store
 * satisfies in a later wave. The dataset is DEMO-labelled end to end: this
 * build has no live provider wired, and the surfaces say so.
 *
 * Determinism: no Date.now, no Math.random, no fetch, no fs — the build
 * output is byte-stable for the pinned fixture revision.
 */

import {
  actionAvailabilityLabel,
  demoDataSource,
  DEMO_NOTE,
  gateNextAction,
  projectExperimentStatus,
  projectRationaleView,
} from '@sos-2/web-contracts';
import type { ExperimentStatusSummaryVM, RationaleViewVM } from '@sos-2/web-contracts';
import {
  buildDemoEcologyWorld,
  createDemoEcologyLiveStore,
  DEMO_ECOLOGY_STORE_REF,
  ECOLOGY_DEMO_NOW,
  projectComposition,
  projectEvolution,
  projectHistoryWorkspace,
  projectPackageEcology,
  projectPackagesWorkspace,
  projectRevisionChains,
  projectRevisionDiff,
  readEcologyLiveState,
  revisionHrefOf,
} from '@sos-2/web-contracts/ecology';
import type {
  CompositionVM,
  DemoEcologyWorld,
  EcologyLiveReadResult,
  EvolutionVM,
  HistoryArtifactBearer,
  HistoryWorkspaceVM,
  PackageEcologyVM,
  PackagesWorkspaceVM,
  RevisionChainVM,
  RevisionDiffVM,
} from '@sos-2/web-contracts/ecology';
import { buildRationaleChain } from '@sos-2/ui-contracts';
import type { RationaleChain } from '@sos-2/ui-contracts';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { TraceLink } from '@sos-2/semantic-spine';

/** The authority mode shown across the P10 surfaces (a product view state). */
const AUTHORITY_MODE = 'AUTONOMOUS_WITH_ASK' as const;

/** The assembled P10 views (built once, deterministically). */
export interface EcologyViews {
  world: DemoEcologyWorld;
  read: EcologyLiveReadResult;
  packagesWorkspace: PackagesWorkspaceVM;
  historyWorkspace: HistoryWorkspaceVM;
  evolution: EvolutionVM;
  experimentStatus: ExperimentStatusSummaryVM;
  /** The composition detail by id segment, or null when unknown. */
  compositionDetail: (segment: string) => CompositionVM | null;
  /** The revision chain by kind + segment, or null when unknown. */
  revisionChain: (kind: string, segment: string) => RevisionChainVM | null;
  /** The consecutive-revision diffs of one chain (oldest -> newest). */
  revisionDiffs: (chain: RevisionChainVM) => RevisionDiffVM[];
  /** The rationale view of any subject in the combined link web, or null. */
  rationaleOf: (subjectId: string) => RationaleViewVM | null;
  /** The rationale deep-link route (P1 subjects resolve on /rationale). */
  rationaleHref: (subjectId: string) => string;
}

function evidenceAbout(read: EcologyLiveReadResult, ...subjectIds: string[]): EvidenceRecordW3[] {
  return read.evidence.filter((record) => subjectIds.includes(record.subject_ref));
}

async function buildEcologyViews(): Promise<EcologyViews> {
  const world = buildDemoEcologyWorld();
  const source = demoDataSource(world.fixture_revision, DEMO_NOTE);
  const store = await createDemoEcologyLiveStore(world);
  const read = await readEcologyLiveState(store, { store_ref: DEMO_ECOLOGY_STORE_REF, as_of: ECOLOGY_DEMO_NOW });

  const missionV2 = read.missions[read.missions.length - 1]!;
  const links: TraceLink[] = [...world.base.links, ...world.links];
  const chain = (subjectId: string, evidenceRefs: readonly string[] = []): RationaleChain =>
    buildRationaleChain({ subject_id: subjectId, links, evidence_refs: evidenceRefs });

  // ---------------------------------------------------------------------------
  // The Packages workspace (discovery as a composition surface)
  // ---------------------------------------------------------------------------

  const packages: PackageEcologyVM[] = read.packages.map((artifact) =>
    projectPackageEcology({
      artifact,
      rationale: chain(artifact.envelope.id, evidenceAbout(read, artifact.envelope.id).map((record) => record.id)),
      data_source: source,
      uncertainty: {
        uncertainty_class: 'MODERATE',
        statement: 'Applicability is context-conditioned; every estimate carries its own uncertainty class and the retained failure context stays visible.',
      },
      authority: {
        mode: AUTHORITY_MODE,
        required_permission: null,
        grant_ref: null,
        note: 'Reusing a package is gated by its own assurance obligations, never by this view.',
      },
      next_allowed_action: {
        action_id: `review-package-${artifact.envelope.id.slice(-6)}`,
        kind: 'REVIEW',
        label: 'Review this package revision',
        description: 'See the capability, its context-conditioned applicability, retained failures and assurance obligations.',
        href: revisionHrefOf(artifact.envelope.id),
        rationale_ref: artifact.envelope.id,
        requires_authority: null,
      },
    }),
  );

  const compositions: CompositionVM[] = world.compositions.map((artifact) =>
    projectComposition({
      artifact,
      chain_ids: world.compositions.filter((candidate) => candidate.envelope.id !== artifact.envelope.id).map((candidate) => candidate.envelope.id),
      evidence: read.evidence,
      rationale: chain(artifact.envelope.id, evidenceAbout(read, artifact.envelope.id).map((record) => record.id)),
      data_source: source,
      uncertainty: {
        uncertainty_class: 'MODERATE',
        statement: 'The composed-system evidence covers one shadow window; composed cold-start behavior after a simultaneous invalidation and queue drain is unproven.',
      },
      authority: {
        mode: AUTHORITY_MODE,
        required_permission: 'PROMOTE',
        grant_ref: world.base.grants.promotion.envelope.id,
        note: 'Advancing a composition is gated by its own evidence and assurance obligations under the held promotion grant.',
      },
      next_allowed_action: {
        action_id: `open-composition-${artifact.envelope.id.slice(-6)}`,
        kind: 'REVIEW',
        label: 'Open the composition detail',
        description: 'See the members, the typed wiring, the independence justification and the composition OWN evidence.',
        href: `/packages/composition/${artifact.envelope.id.slice('sos://PackageComposition/'.length)}`,
        rationale_ref: artifact.envelope.id,
        requires_authority: null,
      },
    }),
  );

  const packagesWorkspace = projectPackagesWorkspace({
    packages,
    compositions,
    state_blocks: [
      {
        kind: 'UNAVAILABLE',
        surface: 'composition-live-store-family',
        statement:
          'PackageComposition records are not yet a live-store repository family (the P2 support list) — this composition surface reads the clearly-labelled DEMO fixture until that family is persisted.',
        present: null,
        missing: null,
        action: 'Treat every composition record here as DEMO; the package records themselves are read through the live-store repositories.',
      },
    ],
    rationale: chain(missionV2.envelope.id),
    data_source: source,
    evidence_refs: [],
    uncertainty: {
      uncertainty_class: 'MODERATE',
      statement: 'Applicability is context-conditioned across the repertoire; each estimate carries its own uncertainty class.',
    },
    authority: {
      mode: AUTHORITY_MODE,
      required_permission: null,
      grant_ref: null,
      note: 'Composing packages is gated by the members\' assurance obligations and the composition\'s own evidence, not by this view.',
    },
    next_allowed_action: {
      action_id: 'compose-new-composition',
      kind: 'EXECUTE',
      label: 'Compose packages into a new composition',
      description: 'Bind two or more packages into roles with typed wiring; the composition must then earn its OWN evidence before it can be validated.',
      href: null,
      rationale_ref: null,
      requires_authority: 'PROMOTE',
    },
  });

  // ---------------------------------------------------------------------------
  // The History workspace (timeline + revision diff)
  // ---------------------------------------------------------------------------

  const historyArtifacts: HistoryArtifactBearer[] = [
    ...read.missions,
    ...read.contexts,
    ...read.system_states,
    ...read.architecture,
    ...read.candidates,
    ...read.assurance,
    ...read.experiments,
    ...read.decisions,
    ...read.authority_grants,
    ...read.packages,
    ...read.memories,
    ...read.hypotheses,
    ...world.compositions,
    ...world.process_revisions,
  ];

  const historyWorkspace = projectHistoryWorkspace({
    artifacts: historyArtifacts,
    evidence: read.evidence,
    state_blocks: [
      {
        kind: 'UNAVAILABLE',
        surface: 'history-non-store-kinds',
        statement:
          'PackageComposition and MetaProcess revisions are not live-store families yet — their chains render from the clearly-labelled DEMO fixture (marked per chain below).',
        present: null,
        missing: null,
        action: 'Every other kind on this timeline was read through the live-store repositories.',
      },
    ],
    data_source: source,
    rationale: chain(missionV2.envelope.id),
    evidence_refs: [],
    uncertainty: {
      uncertainty_class: 'UNQUANTIFIED',
      statement: 'The timeline is a complete projection of the stored revision chains; chains stop honestly at a missing link.',
    },
    authority: {
      mode: 'READ_ONLY',
      required_permission: null,
      grant_ref: null,
      note: 'History is a read-only projection of the durable revision chains.',
    },
    next_allowed_action: {
      action_id: 'open-revision-detail',
      kind: 'REVIEW',
      label: 'Open a revision diff',
      description: 'Every timeline entry links to its revision detail: what changed, why, and the field-level diff.',
      href: '/history',
      rationale_ref: null,
      requires_authority: null,
    },
  });

  // ---------------------------------------------------------------------------
  // The Evolution surface (self-evolution, reading canonical live state)
  // ---------------------------------------------------------------------------

  const developmentState = read.development_state[0];
  const machineStateRaw =
    developmentState === undefined
      ? null
      : (developmentState.state as Record<string, unknown>);

  const evolution = projectEvolution({
    process_revisions: world.process_revisions,
    guard_rejections: [world.guard_rejection],
    memories: read.memories,
    machine_state:
      machineStateRaw === null
        ? null
        : {
            state_id: developmentState!.state_id,
            revision: developmentState!.revision,
            description: developmentState!.description,
            updated_at: developmentState!.updated_at,
            frontier: (machineStateRaw['currentFrontier'] as string[] | undefined) ?? [],
            program: (machineStateRaw['program'] as string | undefined) ?? '',
            status: (machineStateRaw['status'] as string | undefined) ?? '',
            current_task: (machineStateRaw['currentTask'] as string | undefined) ?? '',
          },
    live_read: {
      store_ref: read.store_ref,
      families_read: read.families_read.map((family) => family.family),
      as_of: read.as_of,
    },
    state_blocks: [
      {
        kind: 'UNAVAILABLE',
        surface: 'meta-process-live-store-family',
        statement:
          'MetaProcess and MetaChange are not yet live-store repository families (the P2 support list) — the process revision chain and the guard rejections render from the clearly-labelled DEMO fixture.',
        present: null,
        missing: null,
        action: 'The retained failure memory and the machine state above were read through the live-store repositories.',
      },
    ],
    rationale: chain(
      world.process_revisions[world.process_revisions.length - 1]!.envelope.id,
      world.evolution_evidence.map((record) => record.id),
    ),
    data_source: source,
    evidence_refs: world.evolution_evidence.map((record) => record.id),
    uncertainty: {
      uncertainty_class: 'MODERATE',
      statement: 'The effectiveness picture rests on one trial window; the restore is exact but the exploration-cost coupling stays uncertain.',
    },
    authority: {
      mode: 'READ_ONLY',
      required_permission: null,
      grant_ref: null,
      note: 'Self-evolution is observed, never steered from the console (meta-adaptation cannot disable the mechanism that judges meta-adaptation).',
    },
    next_allowed_action: {
      action_id: 'open-process-revision-detail',
      kind: 'REVIEW',
      label: 'Open the process revision diff',
      description: 'See the exact parameter restore in the field-level diff of the process chain.',
      href: revisionHrefOf(world.process_revisions[world.process_revisions.length - 1]!.envelope.id),
      rationale_ref: world.process_revisions[world.process_revisions.length - 1]!.envelope.id,
      requires_authority: null,
    },
  });

  // ---------------------------------------------------------------------------
  // The controlled experiment (the /experiments section, from the live read)
  // ---------------------------------------------------------------------------

  const experimentArtifact = read.experiments[read.experiments.length - 1]!;
  const experimentEvidence = evidenceAbout(read, experimentArtifact.envelope.id);
  const experimentStatus = projectExperimentStatus({
    experiment: experimentArtifact,
    title: 'Durable-queue canary',
    result: {
      simulated: world.base.experiment.result.simulated,
      simulator: {
        version: world.base.experiment.result.simulator!.version,
        seed: world.base.experiment.result.simulator!.seed,
      },
    },
    evaluation_summary: `Overall availability of the SIMULATED run: ${world.base.experiment.evaluation.overall_availability}. The simulated run is evaluation infrastructure — it is never intervention evidence.`,
    rationale: chain(experimentArtifact.envelope.id, experimentEvidence.map((record) => record.id)),
    data_source: source,
    evidence_refs: experimentEvidence.map((record) => record.id),
    uncertainty: {
      uncertainty_class: 'MODERATE',
      statement: 'The evaluated run is simulated with a fixed seed; the live canary evidence covers 10% exposure so far.',
    },
    authority: {
      mode: AUTHORITY_MODE,
      required_permission: 'PROMOTE',
      grant_ref: world.base.grants.promotion.envelope.id,
      note: 'Advancing the canary ladder requires promotion-grade evidence under the held grant.',
    },
    next_allowed_action: {
      action_id: 'advance-canary',
      kind: 'EXECUTE',
      label: 'Advance the canary to 25% exposure',
      description: 'Raises the treatment arm exposure along the wired ladder [5, 10, 25, 50].',
      href: null,
      rationale_ref: experimentArtifact.envelope.id,
      requires_authority: 'PROMOTE',
    },
  });

  // ---------------------------------------------------------------------------
  // Deep views + rationale
  // ---------------------------------------------------------------------------

  const compositionBySegment = new Map(
    compositions.map((composition) => [composition.composition_id.slice('sos://PackageComposition/'.length), composition]),
  );

  // Every revision of a chain resolves to its chain (deep links may point at
  // the chain head, the root or any stored revision).
  const revisionChainsByKindSegment = new Map<string, RevisionChainVM>();
  for (const revisionChain of projectRevisionChains({ artifacts: historyArtifacts, evidence: read.evidence, data_source: source })) {
    for (const entry of revisionChain.entries) {
      const segment = entry.artifact_id.slice(`sos://${revisionChain.kind}/`.length);
      revisionChainsByKindSegment.set(`${revisionChain.kind}#${segment}`, revisionChain);
    }
  }
  const artifactsById = new Map(historyArtifacts.map((artifact) => [artifact.envelope.id, artifact]));

  function revisionDiffs(revisionChain: RevisionChainVM): RevisionDiffVM[] {
    const artifacts = revisionChain.entries.map((entry) => artifactsById.get(entry.artifact_id)!);
    const diffs: RevisionDiffVM[] = [];
    for (let index = 1; index < artifacts.length; index += 1) {
      const from = artifacts[index - 1]!;
      const to = artifacts[index]!;
      diffs.push(
        projectRevisionDiff({
          from,
          to,
          chain: artifacts,
          rationale: chain(to.envelope.id),
          data_source: source,
          uncertainty: {
            uncertainty_class: 'UNQUANTIFIED',
            statement: 'The diff is a presentational comparison of the stored revisions; it contains no domain judgment.',
          },
          authority: {
            mode: 'READ_ONLY',
            required_permission: null,
            grant_ref: null,
            note: 'The revision diff is read-only.',
          },
          next_allowed_action: {
            action_id: 'back-to-history',
            kind: 'NAVIGATE',
            label: 'Back to the timeline',
            description: 'Return to the revision timeline.',
            href: '/history',
            rationale_ref: null,
            requires_authority: null,
          },
        }),
      );
    }
    return diffs;
  }

  function subjectLabel(subjectId: string): string {
    if (revisionChainsByKindSegment.size > 0 && world.compositions.some((artifact) => artifact.envelope.id === subjectId)) {
      return 'Package composition';
    }
    if (world.process_revisions.some((artifact) => artifact.envelope.id === subjectId)) {
      return 'SOS process revision';
    }
    if (subjectId === world.meta_change.envelope.id) {
      return 'Failed meta change (rolled back)';
    }
    if (subjectId === world.failure_memory.envelope.id) {
      return 'Retained failure memory';
    }
    if (read.packages.some((artifact) => artifact.envelope.id === subjectId)) {
      return 'Package revision';
    }
    if (read.memories.some((artifact) => artifact.envelope.id === subjectId)) {
      return 'Architecture memory';
    }
    if (read.hypotheses.some((artifact) => artifact.envelope.id === subjectId)) {
      return 'Causal hypothesis';
    }
    if (read.evidence.some((record) => record.id === subjectId)) {
      return 'Evidence record';
    }
    if (read.missions.some((artifact) => artifact.envelope.id === subjectId)) {
      return 'Mission revision';
    }
    if (read.system_states.some((artifact) => artifact.envelope.id === subjectId)) {
      return 'System state revision';
    }
    return 'SOS artifact';
  }

  function rationaleAnswers(subjectId: string): RationaleViewVM['answers'] {
    const record = read.evidence.find((entry) => entry.id === subjectId);
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
    if (world.compositions.some((artifact) => artifact.envelope.id === subjectId)) {
      return {
        WHAT_IS_HAPPENING: 'A first-class package composition: two validated packages bound into roles with typed wiring, validated by its OWN composed-system evidence.',
        WHY_DOES_SOS_BELIEVE_THIS: 'The composition derives from its member packages and satisfies the mission; its own-evidence verdict is evaluated by the owning composition authority over the evidence pool.',
        WHAT_EVIDENCE_SUPPORTS_IT: 'A composed-system shadow observation about the composition itself (member evidence never substitutes — independence is a locked invariant).',
        WHAT_UNCERTAINTY_REMAINS: 'Composed-system evidence covers one shadow window; composed cold-start behavior is unproven.',
        WHAT_AUTHORITY_IS_REQUIRED: 'Advancing the composition is gated by its own evidence and assurance obligations under the held promotion grant.',
        WHAT_CAN_HAPPEN_NEXT: 'Open the composition detail to see the members, wiring, independence justification and own-evidence verdict.',
      };
    }
    if (world.process_revisions.some((artifact) => artifact.envelope.id === subjectId)) {
      return {
        WHAT_IS_HAPPENING: 'One revision of the SOS process itself — the evolvable strategy parameters and retrieval weights, versioned on the spine.',
        WHY_DOES_SOS_BELIEVE_THIS: 'The revision derives from the mission and the meta-evolution loop; every parameter change passed the non-disableable governance guard.',
        WHAT_EVIDENCE_SUPPORTS_IT: 'The outcome evidence of the meta-evolution trial window and the restore observation, each with its truth state.',
        WHAT_UNCERTAINTY_REMAINS: 'The exploration-cost coupling stays uncertain; the restore is exact but the trial window was short.',
        WHAT_AUTHORITY_IS_REQUIRED: 'Process revisions are guard-checked and authority-gated in the meta loop; the console only observes them (read-only).',
        WHAT_CAN_HAPPEN_NEXT: 'Open the process revision diff to see the exact parameter restore after the rolled-back trial.',
      };
    }
    if (read.packages.some((artifact) => artifact.envelope.id === subjectId)) {
      const pkg = read.packages.find((artifact) => artifact.envelope.id === subjectId)!;
      return {
        WHAT_IS_HAPPENING: `A package revision: ${pkg.content.semantic_capability}.`,
        WHY_DOES_SOS_BELIEVE_THIS: 'The package realizes a capability, carries its own evidence, preconditions and learned limitations, and declares its composition participation.',
        WHAT_EVIDENCE_SUPPORTS_IT: `${pkg.content.evidence_refs.length} supporting evidence refs${pkg.content.failure_refs.length > 0 ? ` and ${pkg.content.failure_refs.length} retained failure refs` : ''}.`,
        WHAT_UNCERTAINTY_REMAINS: `Applicability is context-conditioned (${pkg.content.applicability.map((estimate) => (estimate.kind === 'QUALITATIVE' ? estimate.uncertainty_class : 'calibrated')).join(', ')}).`,
        WHAT_AUTHORITY_IS_REQUIRED: 'Adoption is gated by the package\'s own assurance obligations, not by direct authority.',
        WHAT_CAN_HAPPEN_NEXT: 'Open Packages to see the capability, its family and its limitations.',
      };
    }
    return {
      WHAT_IS_HAPPENING: `${subjectLabel(subjectId)} is part of the typed trace-link web behind the current picture.`,
      WHY_DOES_SOS_BELIEVE_THIS: 'It is connected to the current mission, system state and change story through typed spine trace links.',
      WHAT_EVIDENCE_SUPPORTS_IT: 'Supporting evidence records are listed below with their exact truth states.',
      WHAT_UNCERTAINTY_REMAINS: 'No view model in this console wave summarizes the remaining uncertainty for this subject.',
      WHAT_AUTHORITY_IS_REQUIRED: 'No authority requirement is recorded for this subject in this console wave.',
      WHAT_CAN_HAPPEN_NEXT: 'Return to the workspaces to see the surfaces that carry authority and next actions.',
    };
  }

  function rationaleOf(subjectId: string): RationaleViewVM | null {
    const mentioned = links.some((link) => link.source === subjectId || link.target === subjectId);
    if (!mentioned) {
      return null;
    }
    return projectRationaleView({
      subject_id: subjectId,
      subject_label: subjectLabel(subjectId),
      answers: rationaleAnswers(subjectId),
      links,
      evidence_refs: evidenceAbout(read, subjectId).map((record) => record.id),
      evidence: read.evidence,
    });
  }

  return {
    world,
    read,
    packagesWorkspace,
    historyWorkspace,
    evolution,
    experimentStatus,
    compositionDetail: (segment) => compositionBySegment.get(decodeURIComponent(segment)) ?? null,
    revisionChain: (kind, segment) =>
      revisionChainsByKindSegment.get(`${decodeURIComponent(kind)}#${decodeURIComponent(segment)}`) ?? null,
    revisionDiffs,
    rationaleOf,
    rationaleHref: (subjectId) => {
      const withoutScheme = subjectId.slice('sos://'.length);
      const separator = withoutScheme.lastIndexOf('/');
      return `/rationale/${encodeURIComponent(withoutScheme.slice(0, separator))}/${encodeURIComponent(withoutScheme.slice(separator + 1))}`;
    },
  };
}

let cached: Promise<EcologyViews> | null = null;

/** The assembled P10 views (memoized — the world, the seeded store and the live read are built once). */
export function ecologyViews(): Promise<EcologyViews> {
  cached ??= buildEcologyViews();
  return cached;
}

/** Re-exported for the surfaces: the gated action label helper. */
export { actionAvailabilityLabel, gateNextAction };
