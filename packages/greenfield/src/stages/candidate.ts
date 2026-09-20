/**
 * STAGE 2 — Capability derivation + candidate composition (Work Order W14).
 *
 * The mission's declared semantic capability + its REAL MissionConstraint
 * objects are consumed by the W7 candidate search (hardConstraintsFromMission
 * — the typed integration contract; MissionConstraint satisfies
 * HardConstraintView directly), searched through the ladder engine over the
 * retrieval facade (@sos-2/search + @sos-2/retrieval) — candidate
 * generation STARTS at VALIDATED_COMPOSITION, the highest safe validated
 * abstraction (spec/architecture.md section 10).
 *
 * The diverse survivor set is then Pareto-ranked through @sos-2/optimization
 * (nonDominatedSort over the caller-supplied estimates projected on the
 * frozen section-11 objective axes) — a DOMINATED candidate never becomes
 * the primary reuse candidate while a non-dominated one exists, and the
 * diverse set is never collapsed to a single winner (section 11).
 *
 * The greenfield candidate composition is then COMPOSED through
 * @sos-2/composition from the VALIDATED reusable members (reuse at the
 * highest validated altitude), carrying its OWN evidence obligations
 * (assurance obligations; reuse never bypasses assurance) and its own
 * provisional evidence discipline (DISCOVERED maturity — evidence about
 * the composition itself arrives only after realization; member evidence
 * NEVER substitutes, a locked invariant machine-checked here).
 */

import { createPackageComposition, evaluateOwnEvidence } from '@sos-2/composition';
import type {
  CompositionBinding,
  CompositionMember,
  PackageCompositionArtifact,
} from '@sos-2/composition';
import { nonDominatedSort } from '@sos-2/optimization';
import type {
  CarriedUncertainty,
  ObjectiveDirection,
  ParetoCandidate,
  ParetoResult,
  TypedObjective,
} from '@sos-2/optimization';
import type { AssuranceObligation, ApplicabilityEstimate } from '@sos-2/packages';
import type { RegistryEntry, RetrievalAltitude } from '@sos-2/registry';
import { RetrievalFacade } from '@sos-2/retrieval';
import type { ContextCandidate } from '@sos-2/retrieval';
import { createLadderSearchEngine, hardConstraintsFromMission } from '@sos-2/search';
import type {
  CandidateConstraintReport,
  CandidateSearchEngine,
  ExplorationPolicy,
  HardConstraintSet,
  LadderStep,
  SearchRequest,
  SelectedCandidate,
} from '@sos-2/search';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import {
  createTraceLink,
} from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import type { GreenfieldRunContext, GreenfieldWorld } from '../context.js';
import { GreenfieldError } from '../errors.js';
import type { MissionStageRecord } from './mission.js';

/** The altitudes greenfield composition may reuse members from (validated reuse only). */
export const GREENFIELD_VALIDATED_ALTITUDES: readonly RetrievalAltitude[] = [
  'VALIDATED_COMPOSITION',
  'VALIDATED_PACKAGE',
];

/** A serializable projection of one selected search candidate. */
export interface CandidateSearchEntry {
  id: string;
  kind: 'PACKAGE' | 'COMPOSITION';
  family: string;
  altitude: RetrievalAltitude;
  origin: string;
  rank: number;
  mode: 'EXPLOIT' | 'EXPLORE';
  note: string;
  constraint_report: CandidateConstraintReport;
  uncertainty: { uncertainty_class: string; sample_size: number; calibrated_probability: number | null };
  pareto_rank: number | null;
}

/** The typed stage record of candidate composition (plain JSON, spine-traceable). */
export interface CandidateStageRecord {
  stage: 'CANDIDATE_COMPOSITION';
  /** The capability search key (derived from the formalized mission). */
  capability: string;
  /** The typed hard-constraint set consumed from the mission (W7 contract). */
  constraints: HardConstraintSet;
  /** The search summary (serializable projection; the resolver never leaks). */
  search: {
    engine: string;
    request: { capability: string; policy: ExplorationPolicy; constraints_source: string };
    final_altitude: RetrievalAltitude | null;
    ladder: LadderStep[];
    families_present: string[];
    total_rejected: number;
    candidates: CandidateSearchEntry[];
    pareto: { applied: boolean; axes: string[]; fronts: { rank: number; ids: string[] }[] };
  };
  /** Which validated reusable entry(ies) the members were selected from. */
  selection: { source: 'VALIDATED_COMPOSITION' | 'VALIDATED_PACKAGES'; selected_ids: string[] };
  /** The composed members (roles + bound contracts). */
  members: CompositionMember[];
  /** The exact registry envelope versions of the composed members (R30). */
  member_versions: { package_id: string; version: string }[];
  /** The composed bindings (the reused/derived wiring). */
  bindings: CompositionBinding[];
  /** The greenfield candidate composition (DISCOVERED, own evidence obligations). */
  candidate: PackageCompositionArtifact;
  /** The candidate's OWN evidence obligations (non-empty — machine-checked). */
  own_evidence_obligations: AssuranceObligation[];
  /** The reuse evidence resolved for the decision stage (honest; may be empty). */
  evidence: EvidenceRecordW3[];
  /** The applicability estimate carried onto the candidate (uncertainty preserved). */
  applicability: ApplicabilityEstimate;
  /** The stage's trace links: candidate SATISFIES mission; candidate COMPOSES members. */
  links: TraceLink[];
}

export interface CandidateStageInput {
  mission_stage: MissionStageRecord;
  world: GreenfieldWorld;
  run: GreenfieldRunContext;
  /** The EXPLICIT exploration/exploitation policy (required — never implicit). */
  policy: ExplorationPolicy;
  /**
   * Predicted measures per candidate id (axis -> estimate), merged into the
   * candidates BEFORE constraint filtering (predictions, not evaluation
   * results). Estimates on the frozen section-11 objective axes additionally
   * feed the Pareto ranking of the survivor set.
   */
  estimates_by_id?: Record<string, Record<string, number>>;
}

// ---------------------------------------------------------------------------
// Deterministic role derivation
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  return slug.length > 0 ? slug : 'member';
}

/**
 * Derive unique member roles from the member packages' semantic
 * capabilities (deterministic: allocation order = member order; collisions
 * append -2, -3, ... so two instances of one package stay distinct).
 */
export function deriveMemberRoles(members: readonly { package_id: string; capability: string }[]): string[] {
  const used = new Set<string>();
  return members.map((member) => {
    const base = slugify(member.capability);
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let suffix = 2;
    while (used.has(`${base}-${suffix}`)) {
      suffix += 1;
    }
    const role = `${base}-${suffix}`;
    used.add(role);
    return role;
  });
}

// ---------------------------------------------------------------------------
// The own-evidence discipline (exported for the negative tests)
// ---------------------------------------------------------------------------

/**
 * Assert the candidate's own-evidence discipline:
 *  1. the candidate declares OWN evidence obligations (non-empty
 *     assurance obligations — reuse never bypasses assurance);
 *  2. every CITED evidence ref is OWN evidence — evidence about the
 *     composition itself (its chain), never member evidence (member success
 *     never implies composition success — the locked invariant,
 *     machine-checked through @sos-2/composition's evaluateOwnEvidence).
 */
export function assertCandidateOwnEvidence(
  candidate: PackageCompositionArtifact,
  world: GreenfieldWorld,
): void {
  if (candidate.content.assurance_obligations.length === 0) {
    throw new GreenfieldError(
      'the composed candidate declares NO own evidence obligations — reuse never bypasses assurance ' +
        '(spec/architecture-lock.md); a candidate without its own evidence obligations is REJECTED',
    );
  }
  const refs = candidate.content.evidence_refs;
  if (refs.length === 0) {
    return; // DISCOVERED/FORMING: provisional (the sanctioned form-then-promote flow)
  }
  const resolved = refs
    .map((ref) => world.evidenceResolver(ref))
    .filter((record): record is EvidenceRecordW3 => record !== undefined);
  const verdict = evaluateOwnEvidence(refs, resolved, candidate.envelope.id, []);
  if (!verdict.valid) {
    throw new GreenfieldError(
      `the composed candidate's evidence is not OWN evidence (compositions require their own evidence; ` +
        `member evidence never substitutes): ${verdict.reasons.join('; ')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

/** Build the Pareto view of the survivor set (R12: Pareto sets; never a single winner). */
function paretoRankSurvivors(
  survivors: readonly SelectedCandidate[],
  estimatesById: Record<string, Record<string, number>> | undefined,
): { result: ParetoResult | null; rankById: Map<string, number> } {
  if (estimatesById === undefined) {
    return { result: null, rankById: new Map() };
  }
  const paretoCandidates: ParetoCandidate[] = [];
  for (const entry of survivors) {
    const estimates = estimatesById[entry.candidate.id];
    if (estimates === undefined) {
      continue;
    }
    const objectives: TypedObjective[] = [];
    for (const axis of ['COST', 'LATENCY', 'RESILIENCE', 'PRIVACY', 'RESOURCE_FOOTPRINT', 'HUMAN_COMPREHENSIBILITY'] as const) {
      const value = estimates[axis];
      if (value !== undefined && Number.isFinite(value)) {
        const direction: ObjectiveDirection =
          axis === 'COST' || axis === 'LATENCY' || axis === 'RESOURCE_FOOTPRINT' ? 'MINIMIZE' : 'MAXIMIZE';
        objectives.push({ axis, direction, value });
      }
    }
    if (objectives.length === 0) {
      continue;
    }
    const uncertainty: CarriedUncertainty = {
      uncertainty_class: entry.candidate.uncertainty.uncertainty_class,
      sample_size: entry.candidate.uncertainty.sample_size,
    };
    if (entry.candidate.uncertainty.calibrated !== undefined) {
      uncertainty.calibrated_probability = entry.candidate.uncertainty.calibrated.probability;
      uncertainty.calibration_ref = entry.candidate.uncertainty.calibrated.calibration_ref;
    }
    paretoCandidates.push({
      id: entry.candidate.id,
      family: entry.candidate.family,
      objectives,
      uncertainty,
      payload: entry.candidate.id,
    });
  }
  if (paretoCandidates.length === 0) {
    return { result: null, rankById: new Map() };
  }
  const result = nonDominatedSort(paretoCandidates);
  const rankById = new Map<string, number>();
  for (const front of result.fronts) {
    for (const candidate of front.candidates) {
      rankById.set(candidate.id, front.rank);
    }
  }
  return { result, rankById };
}

function carriedUncertaintyOf(candidate: ContextCandidate): {
  uncertainty_class: string;
  sample_size: number;
  calibrated_probability: number | null;
} {
  return {
    uncertainty_class: candidate.uncertainty.uncertainty_class,
    sample_size:
      candidate.uncertainty.probability?.sample_size ??
      candidate.best_estimate?.sample_size ??
      candidate.applicability[0]?.sample_size ??
      0,
    calibrated_probability: candidate.uncertainty.probability?.value ?? null,
  };
}

/** The primary reuse candidate: the first NON-DOMINATED policy-ordered survivor. */
function primaryCandidate(
  survivors: readonly SelectedCandidate[],
  paretoRank: Map<string, number>,
): SelectedCandidate {
  if (paretoRank.size === 0) {
    return survivors[0]!;
  }
  for (const entry of survivors) {
    const rank = paretoRank.get(entry.candidate.id);
    if (rank === undefined || rank === 0) {
      return entry;
    }
  }
  return survivors[0]!;
}

/** Run the candidate composition stage. Deterministic and pure. */
export function runCandidateStage(input: CandidateStageInput): CandidateStageRecord {
  const { mission_stage, world, run, policy } = input;
  const capability = mission_stage.capability;
  const mission = mission_stage.mission;

  // 1. The typed hard-constraint set — consumed from the REAL mission
  //    constraints through the W7 integration contract.
  const constraints = hardConstraintsFromMission({
    artifact_id: mission.envelope.id,
    constraints: mission.content.constraints,
  });

  // 2. Search the package ecology at the highest validated altitude
  //    (the ladder engine enforces the section-10 discipline).
  const engine: CandidateSearchEngine = createLadderSearchEngine({
    facade: new RetrievalFacade(world.registry),
    patternSource: world.patternSource,
    novelSource: world.novelSource,
    synthesisSource: world.synthesisSource,
  });
  const request: SearchRequest = {
    capability,
    constraints,
    policy,
  };
  if (input.estimates_by_id !== undefined) {
    request.estimates_by_id = input.estimates_by_id;
  }
  const result = engine.search(request);

  if (result.candidates.length === 0) {
    throw new GreenfieldError(
      `the candidate search found no survivor for capability ${JSON.stringify(capability)} at any altitude ` +
        `(${result.total_rejected} rejected by the mission's hard constraints) — greenfield composition requires ` +
        'reusable candidates',
    );
  }
  const finalAltitude = result.final_altitude;
  if (finalAltitude === null || !GREENFIELD_VALIDATED_ALTITUDES.includes(finalAltitude)) {
    throw new GreenfieldError(
      `the candidate search descended to altitude ${JSON.stringify(finalAltitude)} for capability ` +
        `${JSON.stringify(capability)} — greenfield composition composes from VALIDATED reusable members ` +
        `(VALIDATED_COMPOSITION or VALIDATED_PACKAGE); descending below the validated altitudes is rejected ` +
        '(the ladder trace records the descent)',
    );
  }

  // 3. Pareto-rank the diverse survivor set (R12 — a dominated candidate is
  //    never the primary while a non-dominated one exists; the set is never
  //    collapsed to a single winner).
  const { result: pareto, rankById } = paretoRankSurvivors(result.candidates, input.estimates_by_id);

  // 4. Select the reusable members.
  const primary = primaryCandidate(result.candidates, rankById);
  const primaryId = primary.candidate.id;
  const primaryEntry = world.registry.get(primaryId);
  if (primaryEntry === undefined) {
    throw new GreenfieldError(
      `the primary candidate ${primaryId} is no longer registered (the registry is the data authority)`,
    );
  }

  let members: CompositionMember[];
  let bindings: CompositionBinding[];
  let selection: CandidateStageRecord['selection'];
  let reusedObligations: AssuranceObligation[] = [];
  let reusedPreconditions: string[] = [];

  if (primary.candidate.retrieval?.kind === 'COMPOSITION') {
    // Reuse at the highest validated altitude: the found composition's
    // members + wiring, re-bound into our mission-shaped roles.
    const found = primary.candidate.retrieval;
    if (found === undefined || found.members === null || found.bindings === null) {
      throw new GreenfieldError(`composition candidate ${primaryId} exposes no members/bindings view`);
    }
    const memberCapabilities = found.members.map((member) => {
      const entry: RegistryEntry | undefined = world.registry.get(member.package_id);
      if (entry === undefined || entry.kind !== 'PACKAGE') {
        throw new GreenfieldError(
          `composition member ${member.package_id} is not a registered package (reuse never bypasses compatibility)`,
        );
      }
      return { package_id: member.package_id, capability: entry.artifact.content.semantic_capability };
    });
    const roles = deriveMemberRoles(memberCapabilities);
    const roleByFoundRole = new Map<string, string>();
    found.members.forEach((member, index) => {
      roleByFoundRole.set(member.role, roles[index]!);
    });
    members = found.members.map((member, index) => ({
      package_id: member.package_id,
      role: roles[index]!,
      bound_contracts: [...member.bound_contracts],
    }));
    bindings = found.bindings
      .map((binding) => ({
        kind: binding.kind,
        source_role: roleByFoundRole.get(binding.source_role) ?? binding.source_role,
        target_role: roleByFoundRole.get(binding.target_role) ?? binding.target_role,
        contract: binding.contract,
        wiring: structuredClone(binding.wiring),
      }))
      .filter(
        (binding) =>
          members.some((member) => member.role === binding.source_role) &&
          members.some((member) => member.role === binding.target_role) &&
          binding.source_role !== binding.target_role,
      );
    if (bindings.length === 0) {
      // Degenerate remap (should not happen for registry-validated
      // compositions): fall back to the canonical first-members wiring.
      bindings = [
        {
          kind: 'DATA_FLOW',
          source_role: roles[1] ?? roles[0]!,
          target_role: roles[0]!,
          contract: mission_stage.contracts[0]!,
          wiring: { flow: 'greenfield-reuse' },
        },
      ];
    }
    selection = { source: 'VALIDATED_COMPOSITION', selected_ids: [primaryId] };
    reusedObligations = found.assurance_obligations.map((obligation) => ({ ...obligation }));
    if (primaryEntry.kind === 'COMPOSITION') {
      reusedPreconditions = [...primaryEntry.artifact.content.preconditions];
    }
  } else {
    // VALIDATED_PACKAGE rung: compose from the top policy-ordered package
    // survivors across DISTINCT families (deterministic; >= 2 members).
    const picked: { id: string; family: string }[] = [];
    const seenFamilies = new Set<string>();
    for (const entry of result.candidates) {
      if (entry.candidate.retrieval?.kind !== 'PACKAGE') {
        continue;
      }
      if (seenFamilies.has(entry.candidate.family)) {
        continue;
      }
      seenFamilies.add(entry.candidate.family);
      picked.push({ id: entry.candidate.id, family: entry.candidate.family });
      if (picked.length === 2) {
        break;
      }
    }
    if (picked.length < 2) {
      throw new GreenfieldError(
        `greenfield composition requires at least 2 validated reusable packages across distinct families for ` +
          `capability ${JSON.stringify(capability)}; found ${picked.length}`,
      );
    }
    const memberCapabilities = picked.map((pick) => {
      const entry: RegistryEntry | undefined = world.registry.get(pick.id);
      if (entry === undefined || entry.kind !== 'PACKAGE') {
        throw new GreenfieldError(`selected package ${pick.id} is not a registered package`);
      }
      return { package_id: pick.id, capability: entry.artifact.content.semantic_capability };
    });
    const roles = deriveMemberRoles(memberCapabilities);
    members = memberCapabilities.map((member, index) => {
      const entry = world.registry.get(member.package_id);
      if (entry === undefined || entry.kind !== 'PACKAGE') {
        throw new GreenfieldError(`selected package ${member.package_id} is not a registered package`);
      }
      return {
        package_id: member.package_id,
        role: roles[index]!,
        bound_contracts: [...entry.artifact.content.contracts],
      };
    });
    bindings = [
      {
        kind: 'DATA_FLOW',
        source_role: roles[1]!,
        target_role: roles[0]!,
        contract: mission_stage.contracts[0]!,
        wiring: { flow: 'greenfield-reuse' },
      },
    ];
    selection = { source: 'VALIDATED_PACKAGES', selected_ids: picked.map((pick) => pick.id) };
  }

  // 5. Compose the greenfield candidate (DISCOVERED — its own evidence
  //    arrives after realization; its OWN evidence obligations are declared
  //    now: reuse never bypasses assurance).
  const primaryUncertainty = primary.candidate.uncertainty;
  const applicability: ApplicabilityEstimate = {
    kind: 'QUALITATIVE',
    uncertainty_class: primaryUncertainty.uncertainty_class,
    context: { stage: 'greenfield', capability },
    sample_size: primaryUncertainty.sample_size,
    window: null,
  };
  const ownObligations: AssuranceObligation[] = [
    {
      kind: 'TEST',
      obligation: `the composed candidate realizes the mission capability ${capability} from validated reusable members`,
    },
    {
      kind: 'REPLAY',
      obligation: 'the realized composition replays the greenfield scenario deterministically from exact revisions',
    },
    ...reusedObligations,
  ];

  let candidate: PackageCompositionArtifact;
  try {
    candidate = createPackageComposition({
      content: {
        semantic_capability: capability,
        contracts: [...mission_stage.contracts],
        members,
        bindings,
        preconditions: [
          `the mission requires the capability ${capability}`,
          `the reusable members are validated at altitude ${finalAltitude}`,
          ...reusedPreconditions,
        ],
        postconditions: [`the composed capability ${capability} is realized from validated reusable members`],
        applicability: [applicability],
        evidence_refs: [],
        failure_refs: [],
        compatibility_refs: [],
        assurance_obligations: ownObligations,
        context: { stage: 'greenfield', capability },
        learned_limitations: [],
        diversity_profile: {
          family: primary.candidate.family,
          dimensions: primary.candidate.dimensions.map((stance) => ({ ...stance })),
        },
        maturity: 'DISCOVERED',
        independence: [],
        changes: `greenfield candidate composed for mission ${mission.envelope.id} at altitude ${finalAltitude}`,
        superseded_by: null,
      },
      provenance: [...run.provenance, 'W14:greenfield:candidate-composition'],
      created_at: run.t_candidate,
      status: 'DRAFT',
      authority_ref: mission.envelope.id,
    });
  } catch (cause) {
    throw new GreenfieldError(`candidate composition failed against the W6 contract: ${(cause as Error).message}`, {
      cause,
    });
  }

  // 6. The own-evidence discipline (machine-checked; negative-testable).
  assertCandidateOwnEvidence(candidate, world);

  // 7. Resolve the reuse evidence (about the found entry + the members —
  //    honest context for the decision stage; it informs, never satisfies).
  const memberVersions = members.map((member) => {
    const entry = world.registry.get(member.package_id);
    if (entry === undefined) {
      throw new GreenfieldError(`composed member ${member.package_id} is not registered (the registry is the data authority)`);
    }
    return { package_id: member.package_id, version: String(entry.artifact.envelope.version) };
  });
  const evidenceIds = new Set<string>();
  for (const ref of primaryEntry.artifact.content.evidence_refs) {
    evidenceIds.add(ref);
  }
  for (const member of members) {
    const entry = world.registry.get(member.package_id);
    if (entry !== undefined) {
      for (const ref of entry.artifact.content.evidence_refs) {
        evidenceIds.add(ref);
      }
    }
  }
  const evidence = [...evidenceIds]
    .sort()
    .map((ref) => world.evidenceResolver(ref))
    .filter((record): record is EvidenceRecordW3 => record !== undefined);

  // 8. The stage's trace links: the candidate SATISFIES the mission and
  //    COMPOSES its members (spine-minted, provenance-carrying).
  const stageProvenance = [...run.provenance, 'W14:greenfield:candidate-composition'];
  const links: TraceLink[] = [
    createTraceLink({
      source: candidate.envelope.id,
      target: mission.envelope.id,
      type: 'SATISFIES',
      provenance: [...stageProvenance],
    }),
    ...members.map((member) =>
      createTraceLink({
        source: candidate.envelope.id,
        target: member.package_id,
        type: 'COMPOSES',
        provenance: [...stageProvenance],
      }),
    ),
  ];

  const searchEntries: CandidateSearchEntry[] = result.candidates.map((entry) => ({
    id: entry.candidate.id,
    kind: entry.candidate.retrieval?.kind ?? 'PACKAGE',
    family: entry.candidate.family,
    altitude: entry.candidate.altitude,
    origin: entry.candidate.origin,
    rank: entry.annotation.rank,
    mode: entry.annotation.mode,
    note: entry.annotation.note,
    constraint_report: entry.constraint_report,
    uncertainty: entry.candidate.retrieval
      ? carriedUncertaintyOf(entry.candidate.retrieval)
      : {
          uncertainty_class: entry.candidate.uncertainty.uncertainty_class,
          sample_size: entry.candidate.uncertainty.sample_size,
          calibrated_probability: entry.candidate.uncertainty.calibrated?.probability ?? null,
        },
    pareto_rank: rankById.get(entry.candidate.id) ?? null,
  }));

  return {
    stage: 'CANDIDATE_COMPOSITION',
    capability,
    constraints,
    search: {
      engine: result.engine,
      request: { capability, policy, constraints_source: constraints.source },
      final_altitude: finalAltitude,
      ladder: result.ladder.map((step) => structuredClone(step)),
      families_present: [...result.families_present],
      total_rejected: result.total_rejected,
      candidates: searchEntries,
      pareto: {
        applied: pareto !== null,
        axes: pareto?.axes ?? [],
        fronts: (pareto?.fronts ?? []).map((front) => ({
          rank: front.rank,
          ids: front.candidates.map((candidateEntry) => candidateEntry.id),
        })),
      },
    },
    selection,
    members,
    member_versions: memberVersions,
    bindings,
    candidate,
    own_evidence_obligations: ownObligations.map((obligation) => ({ ...obligation })),
    evidence,
    applicability,
    links,
  };
}
