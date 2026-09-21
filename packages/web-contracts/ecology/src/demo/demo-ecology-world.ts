/**
 * The P10 demo ecology world — a scripted, fully deterministic fixture that
 * EXTENDS the P1 demo world (packages revisited with composition
 * participation, a first-class composition with its OWN evidence, the
 * self-evolution story with a rolled-back meta change, and a causal
 * hypothesis), constructed EXCLUSIVELY through the frozen domain packages'
 * own builders. No hand-written domain JSON, no invented spine identifiers:
 * every id is minted by the Semantic Spine's deterministic content
 * addressing over fixed inputs, so the same fixture always produces the
 * same world and byte-identical rendered output.
 *
 * THE DEMO HONESTY CONTRACT: this dataset is DEMO — SIMULATED DATA. Every
 * surface rendered from it carries the visible demo badge and the
 * revision-pinned fixture provenance; it must never render as live state.
 * All timestamps are static literals; there is no hidden clock and no
 * randomness.
 *
 * The story (extending the P1 checkout-platform world): the two validated
 * packages (durable queue buffering, edge-cached rendering) compose into a
 * first-class composition — formed first, then validated with its OWN
 * composed-system evidence (member evidence never substitutes); the member
 * packages publish v2 revisions declaring their composition participation.
 * On the self-evolution plane, a meta-strategy package proposed raising the
 * exploration rate; the wired effectiveness guardrail fired during the
 * trial, the change was ROLLED BACK with an EXACT parameter restore, the
 * failure memory was retained (FAILURE + ROLLBACK + LIABILITY +
 * LEARNED_RULE), and a later governance-weakening attempt (zeroing a
 * validated retrieval altitude) was REJECTED by the non-disableable guard
 * with a retained typed rejection.
 */

import { buildDemoWebWorld, DEMO_WINDOW } from '@sos-2/web-contracts';
import type { DemoWebWorld } from '@sos-2/web-contracts';
import { createTraceLink, withStatus } from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import { createEvidence } from '@sos-2/evidence';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { createPackageArtifact } from '@sos-2/packages';
import type { PackageArtifact } from '@sos-2/packages';
import { createPackageComposition } from '@sos-2/composition';
import type { PackageCompositionArtifact } from '@sos-2/composition';
import { createArchitectureMemory } from '@sos-2/memory';
import type { ArchitectureMemoryArtifact } from '@sos-2/memory';
import { openResolution } from '@sos-2/memory';
import { createMetaChange, createMetaProcess, evaluateGovernanceGuard } from '@sos-2/meta-evolution';
import type { GuardRejection, MetaChangeArtifact, MetaProcessArtifact, MetaProcessParameters } from '@sos-2/meta-evolution';
import { createCausalHypothesis } from '@sos-2/causal';
import type { CausalHypothesisArtifact } from '@sos-2/causal';
import type { DevelopmentStateRecord } from '@sos-2/live-store';

// ---------------------------------------------------------------------------
// Fixed instants and revision pins (no hidden clocks anywhere in the demo)
// ---------------------------------------------------------------------------

/** The P10 base head this fixture dataset is pinned to (static literal). */
export const ECOLOGY_DEMO_FIXTURE_REVISION = 'c9baa42a72d76246a19144bf1679b8687d5a2d62';
export const ECOLOGY_DEMO_PROVENANCE = 'P10:package-history-evolution:demo-fixture';
/** The fixed presentation instant (same as the P1 world). */
export const ECOLOGY_DEMO_NOW = '2025-06-15T12:00:00Z';
const T_COMPOSITION_FORMED = '2025-06-05T09:00:00Z';
const T_COMPOSITION_EVIDENCE = '2025-06-08T09:00:00Z';
const T_COMPOSITION_VALIDATED = '2025-06-08T09:30:00Z';
const T_PROCESS_BASELINE = '2025-06-09T10:00:00Z';
const T_META_CHANGE = '2025-06-10T09:00:00Z';
const T_META_TRIAL = '2025-06-10T10:00:00Z';
const T_META_ROLLBACK = '2025-06-11T09:00:00Z';
const T_GUARD_REJECTION = '2025-06-11T10:00:00Z';

const TOOL_PRODUCER = {
  tool: 'otel-collector',
  tool_version: '1.2.0',
  model: null,
  model_version: null,
  command: null,
  environment: 'production',
} as const;

const TEST_PRODUCER = {
  tool: 'vitest',
  tool_version: '3.0.0',
  model: null,
  model_version: null,
  command: 'pnpm -r test',
  environment: 'ci:github-actions:ubuntu-24.04',
} as const;

/** The baseline (v1) SOS process parameters — the pre-change state. */
const BASELINE_PARAMETERS: MetaProcessParameters = {
  strategy: {
    search_policy: 'BALANCED',
    exploration_rate: 0.25,
    max_candidates_per_family: 3,
  },
  retrieval_weights: {
    VALIDATED_COMPOSITION: 1.0,
    VALIDATED_PACKAGE: 1.0,
    PACKAGE_ADAPTATION: 0.8,
    ARCHITECTURE_PATTERN: 0.5,
    NOVEL_ARCHITECTURE: 0.3,
    LOW_LEVEL_SYNTHESIS: 0.2,
  },
};

/** The trial (v2) parameters — the failed change (higher exploration rate). */
const TRIAL_PARAMETERS: MetaProcessParameters = {
  strategy: {
    search_policy: 'EXPLORATORY',
    exploration_rate: 0.4,
    max_candidates_per_family: 3,
  },
  retrieval_weights: { ...BASELINE_PARAMETERS.retrieval_weights },
};

// ---------------------------------------------------------------------------
// The demo ecology world
// ---------------------------------------------------------------------------

/** The complete, deterministic P10 demo ecology world. */
export interface DemoEcologyWorld {
  /** The P1 demo world this world extends (missions, system states, evidence, experiment, packages v1, ...). */
  base: DemoWebWorld;
  /** The exact repository revision this fixture dataset is pinned to. */
  fixture_revision: string;
  now: string;
  /** The package repertoire with revision chains: queue v1 SUPERSEDED -> v2 ACTIVE, cache v1 SUPERSEDED -> v2 ACTIVE. */
  packages: PackageArtifact[];
  /** The meta-strategy package (the source of the failed self-change proposal). */
  meta_strategy_package: PackageArtifact;
  /** The composition chain: v1 FORMING (SUPERSEDED) -> v2 VALIDATED with OWN evidence. */
  compositions: PackageCompositionArtifact[];
  /** The composition's OWN evidence (composed-system shadow observation about the composition chain). */
  composition_evidence: EvidenceRecordW3[];
  /** The meta-process revision chain: v1 baseline (SUPERSEDED) -> v2 trial (RETIRED) -> v3 exact restore (ACTIVE). */
  process_revisions: MetaProcessArtifact[];
  /** The failed meta change proposal (rolled back). */
  meta_change: MetaChangeArtifact;
  /** The retained typed guard rejection of the governance-weakening attempt. */
  guard_rejection: GuardRejection;
  /** The retained failure memory (FAILURE + ROLLBACK + LIABILITY + LEARNED_RULE). */
  failure_memory: ArchitectureMemoryArtifact;
  /** The outcome evidence about the failed change and the restore. */
  evolution_evidence: EvidenceRecordW3[];
  /** The causal hypothesis (the queue -> latency mechanism, correlational). */
  hypothesis: CausalHypothesisArtifact;
  /** The machine-state snapshot (the development-state live-store family). */
  development_state: DevelopmentStateRecord;
  /** The additional typed trace links of this world. */
  links: TraceLink[];
}

function link(source: string, target: string, type: TraceLink['type']): TraceLink {
  return createTraceLink({ source, target, type, provenance: [ECOLOGY_DEMO_PROVENANCE] });
}

function evidence(input: {
  seed: string;
  subject: string;
  availability: 'SUCCESS' | 'FAILURE' | 'UNKNOWN' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'PARTIAL';
  evidenceClass: 'OBSERVATIONAL' | 'INTERVENTIONAL';
  kind: string;
  method: string;
  confidence: 'STRONG' | 'MODERATE' | 'WEAK' | 'UNQUANTIFIED';
  producer: typeof TOOL_PRODUCER | typeof TEST_PRODUCER;
  window?: { start: string; end: string };
}): EvidenceRecordW3 {
  return createEvidence({
    kind: input.kind,
    subject_ref: input.subject,
    availability: input.availability,
    evidence_class: input.evidenceClass,
    method: input.method,
    provenance: [ECOLOGY_DEMO_PROVENANCE, `evidence:${input.seed}`],
    window: input.window ?? { ...DEMO_WINDOW },
    source_revision: ECOLOGY_DEMO_FIXTURE_REVISION,
    deployment_revision: 'deploy:checkout-prod-2025-06-01',
    confidence: { kind: 'QUALITATIVE', uncertainty_class: input.confidence },
    producer: { ...input.producer },
  });
}

/** Build the demo ecology world (deterministic, total, no I/O, no clocks). */
export function buildDemoEcologyWorld(): DemoEcologyWorld {
  const base = buildDemoWebWorld();
  const missionV2 = base.missions[base.missions.length - 1]!;
  const packageQueueV1 = base.packages[0]!;
  const packageCacheV1 = base.packages[1]!;

  // --- The composition (formed first, then validated with OWN evidence) ---
  const compositionV1 = createPackageComposition({
    content: {
      semantic_capability: 'Resilient low-latency checkout delivery (durable write buffering composed with edge-cached rendering)',
      contracts: ['sos://schema/durable-queue', 'sos://schema/render-cache'],
      members: [
        { package_id: packageQueueV1.envelope.id, role: 'write-buffer', bound_contracts: ['sos://schema/durable-queue'] },
        { package_id: packageCacheV1.envelope.id, role: 'render-edge', bound_contracts: ['sos://schema/render-cache'] },
      ],
      bindings: [
        {
          kind: 'DATA_FLOW',
          source_role: 'write-buffer',
          target_role: 'render-edge',
          contract: 'sos://schema/durable-queue',
          wiring: { flow: 'buffered writes become edge-renderable after the queue drains', ordering: 'at-least-once' },
        },
        {
          kind: 'CONFIGURES',
          source_role: 'render-edge',
          target_role: 'write-buffer',
          contract: 'sos://schema/render-cache',
          wiring: { invalidation: 'cache invalidation re-arms the write buffer depth window' },
        },
      ],
      preconditions: ['A message bus with at-least-once delivery is deployed', 'A CDN with regional edge presence is deployed'],
      postconditions: ['Checkout writes are durably buffered and renders are served from the regional edge'],
      applicability: [
        { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE', context: { environment: 'production', region: 'eu', workload: 'peak-hour' }, sample_size: 9, window: { ...DEMO_WINDOW } },
      ],
      evidence_refs: [],
      failure_refs: [],
      compatibility_refs: [],
      assurance_obligations: [
        { kind: 'SHADOW', obligation: 'Shadow the composed system for one full peak window before serving live traffic' },
        { kind: 'CANARY', obligation: 'Canary the composition ladder [5, 10, 25, 50] with both member guardrails wired' },
      ],
      context: { environment: 'production', region: 'eu' },
      learned_limitations: ['Composed cold-start behavior after a simultaneous invalidation + queue drain is unproven'],
      diversity_profile: {
        family: 'resilient-delivery',
        dimensions: [
          { dimension: 'LATENCY', stance: 'edge rendering keeps p99 render latency low in-region' },
          { dimension: 'RESILIENCE', stance: 'the durable buffer absorbs upstream outages while the edge serves' },
          { dimension: 'COST', stance: 'accepts CDN cost plus one stateful queue component' },
        ],
      },
      maturity: 'FORMING',
      independence: [],
      changes: 'Formed from the two validated member packages; own evidence is intentionally empty until the composed system is observed',
      superseded_by: null,
    },
    provenance: [ECOLOGY_DEMO_PROVENANCE, 'composition:resilient-checkout-delivery-formation'],
    created_at: T_COMPOSITION_FORMED,
    authority_ref: missionV2.envelope.id,
    version: 1,
    status: 'ACTIVE',
  });

  // The composition's OWN evidence: a composed-system shadow observation
  // ABOUT THE COMPOSITION ITSELF (subject = the composition's own chain id)
  // — never evidence about the member packages.
  const evCompositionShadow = evidence({
    seed: 'composition-shadow-observation',
    subject: compositionV1.envelope.id,
    availability: 'SUCCESS',
    evidenceClass: 'OBSERVATIONAL',
    kind: 'shadow-observation',
    method: 'shadow:composed-system-threshold-check',
    confidence: 'MODERATE',
    producer: TOOL_PRODUCER,
    window: { start: '2025-06-05T09:00:00Z', end: '2025-06-08T09:00:00Z' },
  });
  const evCompositionLatency = evidence({
    seed: 'composition-latency-telemetry',
    subject: compositionV1.envelope.id,
    availability: 'PARTIAL',
    evidenceClass: 'OBSERVATIONAL',
    kind: 'telemetry',
    method: 'telemetry:capture-availability',
    confidence: 'MODERATE',
    producer: TOOL_PRODUCER,
    window: { start: '2025-06-05T09:00:00Z', end: '2025-06-08T09:00:00Z' },
  });

  const compositionV2 = createPackageComposition({
    content: {
      semantic_capability: 'Resilient low-latency checkout delivery (durable write buffering composed with edge-cached rendering)',
      contracts: ['sos://schema/durable-queue', 'sos://schema/render-cache'],
      members: [
        { package_id: packageQueueV1.envelope.id, role: 'write-buffer', bound_contracts: ['sos://schema/durable-queue'] },
        { package_id: packageCacheV1.envelope.id, role: 'render-edge', bound_contracts: ['sos://schema/render-cache'] },
      ],
      bindings: [
        {
          kind: 'DATA_FLOW',
          source_role: 'write-buffer',
          target_role: 'render-edge',
          contract: 'sos://schema/durable-queue',
          wiring: { flow: 'buffered writes become edge-renderable after the queue drains', ordering: 'at-least-once' },
        },
        {
          kind: 'CONFIGURES',
          source_role: 'render-edge',
          target_role: 'write-buffer',
          contract: 'sos://schema/render-cache',
          wiring: { invalidation: 'cache invalidation re-arms the write buffer depth window' },
        },
      ],
      preconditions: ['A message bus with at-least-once delivery is deployed', 'A CDN with regional edge presence is deployed'],
      postconditions: ['Checkout writes are durably buffered and renders are served from the regional edge'],
      applicability: [
        { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE', context: { environment: 'production', region: 'eu', workload: 'peak-hour' }, sample_size: 9, window: { ...DEMO_WINDOW } },
      ],
      evidence_refs: [evCompositionShadow.id, evCompositionLatency.id],
      failure_refs: [],
      compatibility_refs: [],
      assurance_obligations: [
        { kind: 'SHADOW', obligation: 'Shadow the composed system for one full peak window before serving live traffic' },
        { kind: 'CANARY', obligation: 'Canary the composition ladder [5, 10, 25, 50] with both member guardrails wired' },
      ],
      context: { environment: 'production', region: 'eu' },
      learned_limitations: ['Composed cold-start behavior after a simultaneous invalidation + queue drain is unproven'],
      diversity_profile: {
        family: 'resilient-delivery',
        dimensions: [
          { dimension: 'LATENCY', stance: 'edge rendering keeps p99 render latency low in-region' },
          { dimension: 'RESILIENCE', stance: 'the durable buffer absorbs upstream outages while the edge serves' },
          { dimension: 'COST', stance: 'accepts CDN cost plus one stateful queue component' },
        ],
      },
      maturity: 'VALIDATED',
      independence: [
        {
          value: 0.72,
          method: 'INDEPENDENCE_JUSTIFIED_PRODUCT',
          justification: {
            basis: 'DESIGNED_ISOLATION',
            justification: 'The write buffer and the render edge are separate failure domains by design: the queue absorbs upstream outages while the edge serves renders, and neither component shares a failure mode with the other.',
            evidence_ref: evCompositionShadow.id,
          },
          members: [
            { package_id: packageQueueV1.envelope.id, probability: 0.9 },
            { package_id: packageCacheV1.envelope.id, probability: 0.8 },
          ],
        },
      ],
      changes: 'Validated with the composition OWN evidence: a composed-system shadow observation about this composition (member evidence never substitutes)',
      superseded_by: null,
    },
    provenance: [ECOLOGY_DEMO_PROVENANCE, 'composition:resilient-checkout-delivery-validation'],
    created_at: T_COMPOSITION_VALIDATED,
    authority_ref: missionV2.envelope.id,
    version: 2,
    status: 'ACTIVE',
    supersedes: compositionV1.envelope.id,
  });
  const compositionV1Superseded: PackageCompositionArtifact = {
    envelope: withStatus(compositionV1.envelope, 'SUPERSEDED'),
    content: compositionV1.content,
  };

  // --- Package v2 revisions (declaring composition participation) --------
  const packageQueueV2 = createPackageArtifact({
    content: {
      ...packageQueueV1.content,
      composition_refs: [compositionV2.envelope.id],
      changes: 'Revision 2 declares participation in the resilient-delivery composition (write-buffer role); capability, applicability and limitations unchanged',
    },
    provenance: [ECOLOGY_DEMO_PROVENANCE, 'package:durable-queue-composition-participation'],
    created_at: T_COMPOSITION_VALIDATED,
    authority_ref: missionV2.envelope.id,
    version: 2,
    status: 'ACTIVE',
    supersedes: packageQueueV1.envelope.id,
  });
  const packageCacheV2 = createPackageArtifact({
    content: {
      ...packageCacheV1.content,
      composition_refs: [compositionV2.envelope.id],
      changes: 'Revision 2 declares participation in the resilient-delivery composition (render-edge role); the retained cold-start failure context stays attached',
    },
    provenance: [ECOLOGY_DEMO_PROVENANCE, 'package:edge-cache-composition-participation'],
    created_at: T_COMPOSITION_VALIDATED,
    authority_ref: missionV2.envelope.id,
    version: 2,
    status: 'ACTIVE',
    supersedes: packageCacheV1.envelope.id,
  });
  const packageQueueV1Superseded: PackageArtifact = {
    envelope: withStatus(packageQueueV1.envelope, 'SUPERSEDED'),
    content: packageQueueV1.content,
  };
  const packageCacheV1Superseded: PackageArtifact = {
    envelope: withStatus(packageCacheV1.envelope, 'SUPERSEDED'),
    content: packageCacheV1.content,
  };

  // --- The meta-strategy package (source of the failed self-change) ------
  // The meta-strategy package evidence is about its own realization subject
  // (packages require evidence; the realization is a real spine id from the
  // base world).
  const metaRealizationSubject = packageQueueV1.content.realizations[0]!.ref;
  const evMetaStrategy = evidence({
    seed: 'meta-strategy-realization-review',
    subject: metaRealizationSubject,
    availability: 'SUCCESS',
    evidenceClass: 'OBSERVATIONAL',
    kind: 'meta-evaluation',
    method: 'meta:proposal-fitness-review',
    confidence: 'MODERATE',
    producer: TEST_PRODUCER,
  });
  const metaStrategyPackage = createPackageArtifact({
    content: {
      semantic_capability: 'SOS process exploration tuning (meta-strategy)',
      contracts: ['sos://schema/meta-strategy'],
      preconditions: ['The meta-evolution loop is active with wired effectiveness guardrails'],
      postconditions: ['Process parameter proposals carry predicted effects and a rollback path'],
      realizations: [{ ref: metaRealizationSubject, revision: 'r1', note: 'Exploration-tuning meta strategy over the SOS process parameters' }],
      applicability: [
        { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE', context: { domain: 'sos-meta', phase: 'proposal' }, sample_size: 6, window: { ...DEMO_WINDOW } },
      ],
      evidence_refs: [evMetaStrategy.id],
      failure_refs: [],
      compatibility_refs: [],
      composition_refs: [],
      assurance_obligations: [{ kind: 'CANARY', obligation: 'Every meta change runs as a bounded trial with wired rollback triggers before activation' }],
      context: { domain: 'sos-meta', phase: 'proposal' },
      learned_limitations: ['One exploration-rate increase has been rolled back after the effectiveness guardrail fired (retained as failure memory)'],
      diversity_profile: {
        family: 'exploration-tuning',
        dimensions: [
          { dimension: 'OPERATIONAL_COMPLEXITY', stance: 'proposes parameter-level changes only (never governance surfaces)' },
          { dimension: 'RESILIENCE', stance: 'every proposal carries a bounded recovery declaration' },
        ],
      },
      maturity: 'FORMING',
      changes: 'Initial forming realization; its first trial proposal was rolled back and is retained as liability memory',
      superseded_by: null,
    },
    provenance: [ECOLOGY_DEMO_PROVENANCE, 'package:meta-exploration-tuning'],
    created_at: T_PROCESS_BASELINE,
    authority_ref: missionV2.envelope.id,
    status: 'ACTIVE',
  });

  // --- The meta-process revision chain (baseline -> trial -> restore) ----
  const processV1 = createMetaProcess({
    content: {
      parameters: BASELINE_PARAMETERS,
      mission_ref: missionV2.envelope.id,
      notes: 'Baseline process revision: balanced search, moderate exploration, all six retrieval altitudes weighted',
    },
    provenance: [ECOLOGY_DEMO_PROVENANCE, 'meta-process:baseline'],
    created_at: T_PROCESS_BASELINE,
    authority_ref: missionV2.envelope.id,
    version: 1,
    status: 'ACTIVE',
  });
  const processV1Superseded: MetaProcessArtifact = {
    envelope: withStatus(processV1.envelope, 'SUPERSEDED'),
    content: processV1.content,
  };

  const metaChange = createMetaChange({
    content: {
      target_process_id: processV1.envelope.id,
      target_process_version: 1,
      patch: {
        strategy: { search_policy: 'EXPLORATORY', exploration_rate: 0.4 },
      },
      intent: 'Raise the deliberate exploration share so the repertoire explores more solution families per cycle',
      source_package_id: metaStrategyPackage.envelope.id,
      predicted_effects: [
        'More distinct candidate families per retrieval cycle',
        'Higher per-cycle evaluation cost from the additional candidates',
      ],
      proposed_against: BASELINE_PARAMETERS,
    },
    provenance: [ECOLOGY_DEMO_PROVENANCE, 'meta-change:exploration-rate-trial'],
    created_at: T_META_CHANGE,
    authority_ref: missionV2.envelope.id,
    version: 1,
    status: 'ACTIVE',
  });

  // The trial revision was never activated: it is minted as a DRAFT trial
  // and retired through the spine's id-preserving status transition (the
  // W16 retireRevision discipline — envelopes are never created terminal).
  const processV2TrialDraft = createMetaProcess({
    content: {
      parameters: TRIAL_PARAMETERS,
      mission_ref: missionV2.envelope.id,
      notes: `Trial revision for the meta change ${metaChange.envelope.id}: exploratory policy with a 0.4 exploration rate; retired after the wired effectiveness guardrail fired`,
    },
    provenance: [ECOLOGY_DEMO_PROVENANCE, 'meta-process:exploration-trial', `meta-change:${metaChange.envelope.id}`],
    created_at: T_META_TRIAL,
    authority_ref: missionV2.envelope.id,
    version: 2,
    status: 'DRAFT',
    supersedes: processV1.envelope.id,
  });
  const processV2Trial: MetaProcessArtifact = {
    envelope: withStatus(processV2TrialDraft.envelope, 'RETIRED'),
    content: processV2TrialDraft.content,
  };

  const processV3Restore = createMetaProcess({
    content: {
      parameters: BASELINE_PARAMETERS,
      mission_ref: missionV2.envelope.id,
      notes: `Exact restore after the failed meta change ${metaChange.envelope.id}: the process parameters are restored byte-equal to the pre-change baseline`,
    },
    provenance: [ECOLOGY_DEMO_PROVENANCE, 'meta-process:rollback-restore', `meta-change:${metaChange.envelope.id}`],
    created_at: T_META_ROLLBACK,
    authority_ref: missionV2.envelope.id,
    version: 3,
    status: 'ACTIVE',
    supersedes: processV2Trial.envelope.id,
  });

  // --- The governance guard rejection (the non-disableable guard) --------
  const guardAttackChange = createMetaChange({
    content: {
      target_process_id: processV3Restore.envelope.id,
      target_process_version: 3,
      patch: {
        retrieval_weights: { VALIDATED_PACKAGE: 0 },
      },
      intent: 'Deprioritize validated-package retrieval entirely to speed up the search loop',
      source_package_id: metaStrategyPackage.envelope.id,
      predicted_effects: ['Faster retrieval cycles'],
      proposed_against: BASELINE_PARAMETERS,
    },
    provenance: [ECOLOGY_DEMO_PROVENANCE, 'meta-change:guard-attack-fixture'],
    created_at: T_GUARD_REJECTION,
    authority_ref: missionV2.envelope.id,
    version: 1,
    status: 'DRAFT',
  });
  const guardVerdict = evaluateGovernanceGuard(guardAttackChange, BASELINE_PARAMETERS);
  if (guardVerdict.passed || guardVerdict.rejection === null) {
    throw new Error('demo fixture invariant broken: the governance-weakening attempt must be rejected by the guard');
  }
  const guardRejection = guardVerdict.rejection;

  // --- The retained failure memory (R19) ----------------------------------
  const evMetaOutcome = evidence({
    seed: 'meta-change-outcome-failure',
    subject: metaChange.envelope.id,
    availability: 'FAILURE',
    evidenceClass: 'OBSERVATIONAL',
    kind: 'meta-evolution-outcome',
    method: 'meta:effectiveness-guardrail',
    confidence: 'STRONG',
    producer: TEST_PRODUCER,
    window: { start: T_META_TRIAL, end: T_META_ROLLBACK },
  });
  const evRestoreObserved = evidence({
    seed: 'meta-restore-observed',
    subject: processV3Restore.envelope.id,
    availability: 'SUCCESS',
    evidenceClass: 'OBSERVATIONAL',
    kind: 'meta-restore-observation',
    method: 'meta:restore-verification',
    confidence: 'STRONG',
    producer: TEST_PRODUCER,
    window: { start: T_META_ROLLBACK, end: T_META_ROLLBACK },
  });

  const failureMemory = createArchitectureMemory({
    content: {
      entries: [
        {
          entry_kind: 'FAILURE',
          id: 'failure-exploration-trial',
          recorded_at: T_META_ROLLBACK,
          statement: `The meta change "${'raise the exploration rate to 0.4'}" from package ${metaStrategyPackage.envelope.id} failed adaptation effectiveness: the per-cycle evaluation cost guardrail fired during the trial window.`,
          evidence_refs: [evMetaOutcome.id],
          context: { domain: 'sos-meta', change: metaChange.envelope.id, lane: 'META', decision: 'ROLLBACK' },
        },
        {
          entry_kind: 'ROLLBACK',
          id: 'rollback-exploration-trial',
          recorded_at: T_META_ROLLBACK,
          statement: 'The exploration-rate trial was rolled back within the declared recovery bound; the process revision restored the exact pre-change parameters.',
          from_revision: `${processV2Trial.envelope.id}@v${String(processV2Trial.envelope.version)}`,
          to_revision: `${processV3Restore.envelope.id}@v${String(processV3Restore.envelope.version)}`,
          reason: 'The wired effectiveness guardrail fired — safety outranks process optimization (spec/architecture.md section 18).',
          evidence_refs: [evMetaOutcome.id],
          context: { domain: 'sos-meta', mechanism: 'exact parameter restore superseding the trial head' },
        },
        {
          entry_kind: 'LIABILITY',
          id: 'liability-exploration-strategy',
          recorded_at: T_META_ROLLBACK,
          statement: `The meta-strategy package ${metaStrategyPackage.envelope.id} produced a failed self-change; its proposals carry reduced probability until re-validated.`,
          severity: 'HIGH',
          owner_kind: 'GOVERNANCE',
          resolution: openResolution(),
          context: { domain: 'sos-meta', package: metaStrategyPackage.envelope.id },
        },
        {
          entry_kind: 'LEARNED_RULE',
          id: 'rule-exploration-budget',
          recorded_at: T_META_ROLLBACK,
          statement: 'Do not raise the exploration rate above the per-cycle evaluation budget without first widening the budget; the guardrail fires within one trial window.',
          applicability: { domain: 'sos-meta', lesson: 'exploration-cost-coupling' },
          evidence_refs: [evMetaOutcome.id],
          uncertainty: { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' },
        },
      ],
      update: { producer: { ...TEST_PRODUCER }, evidence_refs: [evMetaOutcome.id, evRestoreObserved.id] },
    },
    provenance: [ECOLOGY_DEMO_PROVENANCE, 'meta-evolution:liability-memory', `meta-change:${metaChange.envelope.id}`],
    created_at: T_META_ROLLBACK,
    authority_ref: missionV2.envelope.id,
    status: 'ACTIVE',
  });

  // --- The causal hypothesis (the queue -> latency mechanism) ------------
  const evQueueTelemetryBase = base.evidence.find((record) => record.kind === 'telemetry' && record.subject_ref === packageQueueV1.content.realizations[0]!.ref);
  const hypothesis = createCausalHypothesis({
    content: {
      statement: 'Buffering checkout writes through a durable queue reduces EU peak-hour p95 latency',
      claim_strength: 'CORRELATIONAL',
      intervention: {
        description: 'Route checkout writes through a durable queue with at-least-once delivery before acknowledgment',
        target_ref: null,
      },
      mechanism: 'Decoupling the write path from synchronous downstream processing removes the tail latency of slow dependents from the shopper-facing write acknowledgment.',
      predicted_outcomes: [
        { id: 'predicted-p95', description: 'EU peak-hour checkout p95 latency falls below the 250 ms mission target', metric: 'checkout_p95_ms', direction: 'DECREASE' },
      ],
      assumptions: [
        { id: 'assume-bus', statement: 'A message bus with at-least-once delivery is deployed and healthy' },
        { id: 'assume-drain', statement: 'The queue drains within the depth window during peak hours' },
      ],
      context: { environment: 'production', region: 'eu', workload: 'peak-hour' },
      alternatives: [
        { id: 'alt-cdn', explanation: 'A simultaneous CDN change may have improved render latency instead' },
        { id: 'alt-traffic', explanation: 'Peak-hour traffic shape may have been lighter in the observation window' },
      ],
      refutations: [
        { id: 'refute-p95', description: 'EU peak-hour p95 stays above 250 ms after full exposure with the queue in place' },
      ],
      graph: {
        factors: [
          { id: 'factor-queue', description: 'Durable write buffering in the checkout path' },
          { id: 'factor-latency', description: 'EU peak-hour checkout p95 latency' },
          { id: 'factor-traffic', description: 'Peak-hour traffic shape (confounder)' },
        ],
        edges: [
          { type: 'CONTRIBUTES_TO', cause: 'factor-queue', effect: 'factor-latency' },
          { type: 'CONFOUNDS', confounder: 'factor-traffic', cause: 'factor-queue', effect: 'factor-latency' },
        ],
      },
      observational_evidence: [
        ...(evQueueTelemetryBase
          ? [
              {
                evidence_class: 'OBSERVATIONAL' as const,
                evidence_id: evQueueTelemetryBase.id,
                subject_ref: evQueueTelemetryBase.subject_ref,
                availability: evQueueTelemetryBase.availability,
                source_revision: evQueueTelemetryBase.source_revision,
                subject_revision: evQueueTelemetryBase.subject_revision,
                window: evQueueTelemetryBase.window,
              },
            ]
          : []),
        {
          evidence_class: 'OBSERVATIONAL' as const,
          evidence_id: evCompositionShadow.id,
          subject_ref: evCompositionShadow.subject_ref,
          availability: evCompositionShadow.availability,
          source_revision: evCompositionShadow.source_revision,
          subject_revision: evCompositionShadow.subject_revision,
          window: evCompositionShadow.window,
        },
      ],
      interventional_evidence: [],
      uncertainty: { kind: 'QUALITATIVE', uncertainty_class: 'MODERATE' },
      producer: { ...TEST_PRODUCER },
      correlation_origin: null,
    },
    provenance: [ECOLOGY_DEMO_PROVENANCE, 'hypothesis:queue-latency-mechanism'],
    created_at: T_COMPOSITION_EVIDENCE,
    authority_ref: missionV2.envelope.id,
    version: 1,
    status: 'ACTIVE',
  });

  // --- The machine-state snapshot (development-state family) -------------
  const developmentState: DevelopmentStateRecord = {
    state_id: 'productization-implementation-state',
    revision: 4,
    description: 'The productization program machine state at the P10 base head (DEMO fixture snapshot)',
    state: {
      schemaVersion: '2',
      program: 'SOS 2.0 Productization',
      status: 'IN_PROGRESS',
      currentFrontier: ['P4', 'P5', 'P7', 'P10'],
      currentTask: 'P10',
      tasks: {
        P1: { status: 'COMPLETE', dependencies: ['P0'], mergedAs: 'dac150bd6411911020fc61f4931a7adfe7cd1c14' },
        P2: { status: 'COMPLETE', dependencies: ['P0'], mergedAs: '22e934226a1e762206194489a4e29b5a9a0a7bc9' },
        P3: { status: 'COMPLETE', dependencies: ['P0'], mergedAs: '29c7406ba5f0a0a1e9d6a006a8db71117e9b5d8a' },
        P4: { status: 'READY', dependencies: ['P1', 'P2'], mergedAs: null },
        P5: { status: 'READY', dependencies: ['P1', 'P2'], mergedAs: null },
        P7: { status: 'READY', dependencies: ['P2', 'P6'], mergedAs: null },
        P10: { status: 'READY', dependencies: ['P1', 'P2'], mergedAs: null },
      },
    },
    updated_at: ECOLOGY_DEMO_NOW,
  };

  // --- The rationale web additions ----------------------------------------
  const links: TraceLink[] = [
    link(compositionV2.envelope.id, packageQueueV2.envelope.id, 'COMPOSES'),
    link(compositionV2.envelope.id, packageCacheV2.envelope.id, 'COMPOSES'),
    link(compositionV2.envelope.id, compositionV1.envelope.id, 'DERIVED_FROM'),
    link(compositionV2.envelope.id, missionV2.envelope.id, 'SATISFIES'),
    link(evCompositionShadow.id, compositionV1.envelope.id, 'VERIFIES'),
    link(evCompositionLatency.id, compositionV1.envelope.id, 'OBSERVES'),
    link(packageQueueV2.envelope.id, packageQueueV1.envelope.id, 'DERIVED_FROM'),
    link(packageCacheV2.envelope.id, packageCacheV1.envelope.id, 'DERIVED_FROM'),
    link(packageQueueV2.envelope.id, compositionV2.envelope.id, 'REALIZES'),
    link(packageCacheV2.envelope.id, compositionV2.envelope.id, 'REALIZES'),
    link(processV1.envelope.id, missionV2.envelope.id, 'DERIVED_FROM'),
    link(processV2Trial.envelope.id, processV1.envelope.id, 'DERIVED_FROM'),
    link(processV3Restore.envelope.id, processV2Trial.envelope.id, 'DERIVED_FROM'),
    link(metaChange.envelope.id, metaStrategyPackage.envelope.id, 'DERIVED_FROM'),
    link(metaChange.envelope.id, processV1.envelope.id, 'DERIVED_FROM'),
    link(evMetaOutcome.id, metaChange.envelope.id, 'OBSERVES'),
    link(failureMemory.envelope.id, metaChange.envelope.id, 'DERIVED_FROM'),
    link(evRestoreObserved.id, processV3Restore.envelope.id, 'OBSERVES'),
    link(hypothesis.envelope.id, missionV2.envelope.id, 'DERIVED_FROM'),
  ];

  return {
    base,
    fixture_revision: ECOLOGY_DEMO_FIXTURE_REVISION,
    now: ECOLOGY_DEMO_NOW,
    packages: [packageQueueV1Superseded, packageQueueV2, packageCacheV1Superseded, packageCacheV2],
    meta_strategy_package: metaStrategyPackage,
    compositions: [compositionV1Superseded, compositionV2],
    composition_evidence: [evCompositionShadow, evCompositionLatency],
    process_revisions: [processV1Superseded, processV2Trial, processV3Restore],
    meta_change: metaChange,
    guard_rejection: guardRejection,
    failure_memory: failureMemory,
    evolution_evidence: [evMetaOutcome, evRestoreObserved, evMetaStrategy],
    hypothesis,
    development_state: developmentState,
    links,
  };
}
