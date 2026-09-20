/**
 * The GOLDEN self-evolution scenario (W16) — SOS-process fixtures: the
 * object-system snapshot is the W15 golden brownfield scenario
 * ("merch-catalog-legacy", imported verbatim — the OBJECT loop's golden
 * fixtures), and the META side is declared here as pure, deterministic
 * JSON: the self-improvement mission, the initial MetaProcess parameters
 * (strategy + retrieval weights over the §10 altitudes), four
 * meta-strategy package families (R24: the meta loop consumes the same
 * package mechanism), and FOUR meta-change specifications exercising BOTH
 * paths:
 *
 *   1. `weakening-fast-lane` (ADVERSARIAL) — a governance-weakening
 *      proposal (authority gates off, traceability optional, ASK
 *      escalation disabled, decision records bypassed, guard removal
 *      attempted) — REJECTED by the non-disableable guard with a typed
 *      rejection BEFORE any measurement or decision.
 *   2. `regressive-pruning` (ADVERSARIAL) — governance-preserving but
 *      effectiveness-NEGATIVE (the RESILIENCE guardrail breaches on the
 *      §11 axes) — ROLLBACK decision + bounded recovery declaration +
 *      EXACT process restore + retained failure memory (R19).
 *   3. `org-wide-rollout` (ASK) — governance-preserving, positive
 *      effectiveness, but ORGANIZATION blast radius requires SUPERVISED
 *      authority the loop does not hold — the first-class ASK path
 *      (R15/R16): the AskRequest is composed and enqueued.
 *   4. `healthy-tuning` (HEALTHY) — governance-preserving, positive
 *      effectiveness, prior interventional evidence — ACT decision + ACT
 *      promotion -> the applied MetaChange produces the new MetaProcess
 *      revision.
 *
 * The scenario is fixture-ordered (weakening -> regressive -> org-wide ->
 * healthy) so the process revision chain advances through a rollback
 * restore before the healthy application: P1 -> [retired trial] -> restore
 * (exact) -> [pending ASK trial] -> applied healthy revision.
 */

import { GOLDEN_BROWNFIELD_SCENARIO, buildBrownfieldLoopInput, runBrownfieldLoop } from '@sos-2/brownfield';
import type { BrownfieldLoopResult, BrownfieldVariant } from '@sos-2/brownfield';
import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { MetaScenarioJson } from './fixture.js';
import { buildMetaEvolutionInput } from './fixture.js';
import type { BuiltMetaEvolutionInput } from './fixture.js';

// The object-loop result type, re-exported for harness consumers (the
// harness depends on @sos-2/meta-evolution ONLY).
export type { BrownfieldLoopResult, BrownfieldVariant } from '@sos-2/brownfield';

/** The single loop instant (no hidden clocks). */
export const GOLDEN_META_NOW = '2025-07-01T00:00:00.000Z';
/** The deterministic governance anchor for the golden meta scenario. */
export const GOLDEN_META_AUTHORITY_ANCHOR = deriveDeterministicArtifactId('Constitution', {
  note: 'w16 meta-evolution golden scenario governance anchor',
  scenario: 'sos-self-evolution-golden',
});

const GOLDEN_PRODUCER = {
  tool: 'w16-self-evolution-harness',
  tool_version: '1.0.0',
  model: null,
  model_version: null,
  command: 'node apps/self-evolution-harness/dist/main.js',
  environment: 'meta-evolution:golden-scenario',
};

const GOLDEN_PROVENANCE = ['W16:meta-evolution-golden-scenario'];

/** The golden self-evolution scenario fixture (pure JSON, deterministic). */
export const GOLDEN_META_SCENARIO: MetaScenarioJson = {
  now: GOLDEN_META_NOW,
  producer: GOLDEN_PRODUCER,
  provenance: GOLDEN_PROVENANCE,
  authority_ref: GOLDEN_META_AUTHORITY_ANCHOR,

  mission: {
    content: {
      purpose:
        'SOS continuously improves its own evolutionary process — strategy, retrieval and candidate generation — while preserving governance: authority gates, traceability, first-class ASK and decision records are never weakened by meta-adaptation.',
      goals: [
        {
          id: 'goal-self-improvement',
          statement: 'Improve the SOS process objective profile on the frozen section-11 axes without governance regression.',
          status: 'MEASURABLE',
          measures: ['measure-axis-profile'],
        },
      ],
      outcomes: [
        {
          id: 'outcome-governance-preserving-adaptation',
          description: 'Applied meta-changes improve measured process objectives with the governance guard intact.',
          goal_refs: ['goal-self-improvement'],
        },
      ],
      stakeholders: [
        { id: 'stakeholder-architect', name: 'SOS Architect', interest: 'Governance is preserved while the process adapts.' },
      ],
      measures: [
        { id: 'measure-axis-profile', description: 'Before/after objective values on the frozen section-11 axes.', target: 'improvement without guardrail breach', unit: 'axis-value' },
      ],
      assumptions: [
        { id: 'assumption-simulator-representative', statement: 'The fixed-seed simulator produces representative relative outcomes for meta-change measurement (marked simulated — never intervention evidence).' },
      ],
      ambiguities: [
        { id: 'ambiguity-objective-tradeoffs', statement: 'Section-11 axes trade off against each other; the Pareto front, not a single score, is authoritative.', resolution: 'Retained as ambiguity: quality-diversity ranking keeps multiple families.' },
      ],
      constraints: [
        { id: 'constraint-governance-frozen', statement: 'Meta-adaptation cannot disable the mechanism that judges meta-adaptation (authority gates, traceability, ASK, decision records, the guard).', hard: true, bound: null },
      ],
    },
  },

  process: {
    parameters: {
      strategy: {
        search_policy: 'GREEDY',
        exploration_rate: 0.2,
        max_candidates_per_family: 3,
      },
      retrieval_weights: {
        VALIDATED_COMPOSITION: 1.0,
        VALIDATED_PACKAGE: 1.0,
        PACKAGE_ADAPTATION: 0.6,
        ARCHITECTURE_PATTERN: 0.4,
        NOVEL_ARCHITECTURE: 0.3,
        LOW_LEVEL_SYNTHESIS: 0.2,
      },
    },
    notes: 'initial golden SOS process revision (W15-aligned search policy and §10 retrieval weights)',
  },

  object: { variant: 'nominal' },

  meta_context: { domain: 'sos-meta', deployment: 'internal' },

  packages: [
    {
      key: 'validated-tuning',
      content: {
        semantic_capability: 'sos-process-strategy',
        contracts: ['contract:meta-process-tuning/v1'],
        preconditions: ['a measured baseline of the process objectives on the section-11 axes'],
        postconditions: ['process parameters tuned within the evolvable surface', 'governance invariants preserved'],
        applicability: [
          {
            kind: 'QUALITATIVE',
            uncertainty_class: 'STRONG',
            context: { domain: 'sos-meta', deployment: 'internal' },
            sample_size: 11,
            window: null,
          },
        ],
        assurance_obligations: [
          { kind: 'TEST', obligation: 'meta-process tuning regression suite passes' },
          { kind: 'PROPERTY_CHECK', obligation: 'governance guard soundness under accumulated changes' },
        ],
        context: { domain: 'sos-meta', family: 'validated-tuning' },
        learned_limitations: ['tuning gains are context-conditioned; re-measure after object-loop changes'],
        diversity_profile: {
          family: 'validated-tuning',
          dimensions: [
            { dimension: 'HUMAN_COMPREHENSIBILITY', stance: 'high — small, explainable parameter steps' },
            { dimension: 'RESILIENCE', stance: 'high — validated altitude floors preserved' },
          ],
        },
        changes: 'initial discovery of the validated-tuning meta-strategy family',
      },
      evidence: [
        { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W16:golden-scenario:validated-tuning-evidence-1'] },
        { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W16:golden-scenario:validated-tuning-evidence-2'] },
        { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'INTERVENTIONAL', method: 'evaluation:meta-process-controlled-rollout', provenance: ['W16:golden-scenario:validated-tuning-evidence-3'] },
      ],
      target_maturity: 'VALIDATED',
    },
    {
      key: 'aggressive-pruning',
      content: {
        semantic_capability: 'sos-process-strategy',
        contracts: ['contract:meta-process-pruning/v1'],
        preconditions: ['a large candidate repertoire with many families'],
        postconditions: ['repertoire pruned toward cheap low-altitude synthesis'],
        applicability: [
          {
            kind: 'QUALITATIVE',
            uncertainty_class: 'MODERATE',
            context: { domain: 'sos-meta', deployment: 'internal' },
            sample_size: 7,
            window: null,
          },
        ],
        assurance_obligations: [
          { kind: 'TEST', obligation: 'pruning keeps at least one candidate per family (diversity floor)' },
          { kind: 'SIMULATION', obligation: 'pruned process passes the resilience guardrail in simulation' },
        ],
        context: { domain: 'sos-meta', family: 'aggressive-pruning' },
        learned_limitations: ['pruning trades resilience for cost; guardrail-prone'],
        diversity_profile: {
          family: 'aggressive-pruning',
          dimensions: [
            { dimension: 'COST', stance: 'very low — fewer candidates evaluated' },
            { dimension: 'RESILIENCE', stance: 'low — narrow repertoire loses failover families' },
          ],
        },
        changes: 'initial discovery of the aggressive-pruning meta-strategy family',
      },
      evidence: [
        { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W16:golden-scenario:aggressive-pruning-evidence-1'] },
        { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W16:golden-scenario:aggressive-pruning-evidence-2'] },
        { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'INTERVENTIONAL', method: 'evaluation:meta-process-controlled-rollout', provenance: ['W16:golden-scenario:aggressive-pruning-evidence-3'] },
      ],
      target_maturity: 'VALIDATED',
    },
    {
      key: 'org-rollout',
      content: {
        semantic_capability: 'sos-process-strategy',
        contracts: ['contract:meta-process-org-rollout/v1'],
        preconditions: ['organization-wide agreement on process policy changes'],
        postconditions: ['process policy rolled out across every SOS deployment'],
        applicability: [
          {
            kind: 'QUALITATIVE',
            uncertainty_class: 'MODERATE',
            context: { domain: 'sos-meta', deployment: 'internal' },
            sample_size: 5,
            window: null,
          },
        ],
        assurance_obligations: [
          { kind: 'TEST', obligation: 'org rollout dry-run passes on the reference deployment' },
          { kind: 'SHADOW', obligation: 'org-wide policy shadowed for one full meta cycle' },
        ],
        context: { domain: 'sos-meta', family: 'org-rollout' },
        learned_limitations: ['organization-blast-radius changes require supervised authority'],
        diversity_profile: {
          family: 'org-rollout',
          dimensions: [
            { dimension: 'OPERATIONAL_COMPLEXITY', stance: 'high — every deployment must adopt the policy' },
            { dimension: 'CUSTOMIZATION', stance: 'low — one policy for all deployments' },
          ],
        },
        changes: 'initial discovery of the org-rollout meta-strategy family',
      },
      evidence: [
        { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W16:golden-scenario:org-rollout-evidence-1'] },
        { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W16:golden-scenario:org-rollout-evidence-2'] },
        { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'INTERVENTIONAL', method: 'evaluation:meta-process-controlled-rollout', provenance: ['W16:golden-scenario:org-rollout-evidence-3'] },
      ],
      target_maturity: 'VALIDATED',
    },
    {
      key: 'fast-lane',
      content: {
        semantic_capability: 'sos-process-strategy',
        contracts: ['contract:meta-process-fast-lane/v1'],
        preconditions: ['a functioning meta-evolution loop'],
        postconditions: ['unreviewed meta-changes apply without gates'],
        applicability: [
          {
            kind: 'QUALITATIVE',
            uncertainty_class: 'WEAK',
            context: { domain: 'sos-meta', deployment: 'internal' },
            sample_size: 2,
            window: null,
          },
        ],
        assurance_obligations: [
          { kind: 'TEST', obligation: 'fast-lane proposals are rejected by the governance guard' },
        ],
        context: { domain: 'sos-meta', family: 'fast-lane' },
        learned_limitations: ['governance-weakening proposals are structurally unappliable'],
        diversity_profile: {
          family: 'fast-lane',
          dimensions: [
            { dimension: 'LATENCY', stance: 'very low — no gates, no records' },
            { dimension: 'RESILIENCE', stance: 'very low — governance removed' },
          ],
        },
        changes: 'initial discovery of the fast-lane meta-strategy family (the adversarial control)',
      },
      evidence: [
        { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W16:golden-scenario:fast-lane-evidence-1'] },
        { kind: 'package-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W16:golden-scenario:fast-lane-evidence-2'] },
      ],
      target_maturity: 'FORMING',
    },
  ],

  changes: [
    {
      key: 'weakening-fast-lane',
      package_key: 'fast-lane',
      patch: {
        governance: { authority_gates: false, decision_records: false },
        traceability: { trace_links: 'optional' },
        ask_policy: { escalation: 'disabled' },
        guard: { enabled: false },
      },
      intent: 'Remove the governance gates, traceability obligations, ASK escalation and the guard itself so unreviewed meta-changes apply without friction.',
      predicted_effects: ['meta-change cycle latency falls dramatically (governance removed)'],
      hypothesis_statement: 'Removing governance from the meta loop makes self-evolution faster.',
      blast_radius: 'SERVICE',
      impact: 'HIGH',
      risk: 'HIGH',
      reversibility: 'REVERSIBLE',
      uncertainty: { uncertainty_class: 'LOW', basis: 'the guard rejects this structurally — the effect is never observed' },
      predicted_estimates: { COST: 70, LATENCY: 60, RESILIENCE: 30, HUMAN_COMPREHENSIBILITY: 40 },
      behavior: { RESILIENCE: 30, HUMAN_COMPREHENSIBILITY: 40 },
      fitness: 0.5,
      decision_evidence: [],
      promotion_evidence: [],
      effects: [],
    },
    {
      key: 'regressive-pruning',
      package_key: 'aggressive-pruning',
      patch: {
        strategy: { max_candidates_per_family: 1, exploration_rate: 0.05 },
        retrieval_weights: { PACKAGE_ADAPTATION: 0.9, ARCHITECTURE_PATTERN: 0.7, NOVEL_ARCHITECTURE: 0.5, LOW_LEVEL_SYNTHESIS: 0.4 },
      },
      intent: 'Aggressively prune the candidate repertoire and bias retrieval toward cheap low-altitude synthesis to cut evaluation cost.',
      predicted_effects: [
        'process evaluation cost falls',
        'the narrow repertoire degrades the process resilience profile below the guardrail floor',
      ],
      hypothesis_statement: 'Pruning the repertoire and biasing retrieval toward low altitudes reduces process cost without harming resilience.',
      blast_radius: 'SERVICE',
      impact: 'MODERATE',
      risk: 'MODERATE',
      reversibility: 'REVERSIBLE',
      uncertainty: { uncertainty_class: 'MODERATE', basis: 'prior rollouts showed resilience sensitivity to repertoire narrowing' },
      predicted_estimates: { COST: 96, LATENCY: 78, RESILIENCE: 28, HUMAN_COMPREHENSIBILITY: 58 },
      behavior: { RESILIENCE: 28, HUMAN_COMPREHENSIBILITY: 58 },
      fitness: 0.7,
      decision_evidence: [],
      promotion_evidence: [],
      effects: [
        { arm_id: 'control', metric_id: 'COST', true_mean: 100, noise_std: 4 },
        { arm_id: 'treatment', metric_id: 'COST', true_mean: 96, noise_std: 4 },
        { arm_id: 'control', metric_id: 'LATENCY', true_mean: 80, noise_std: 3 },
        { arm_id: 'treatment', metric_id: 'LATENCY', true_mean: 78, noise_std: 3 },
        { arm_id: 'control', metric_id: 'RESILIENCE', true_mean: 50, noise_std: 2 },
        { arm_id: 'treatment', metric_id: 'RESILIENCE', true_mean: 28, noise_std: 2 },
        { arm_id: 'control', metric_id: 'HUMAN_COMPREHENSIBILITY', true_mean: 60, noise_std: 2 },
        { arm_id: 'treatment', metric_id: 'HUMAN_COMPREHENSIBILITY', true_mean: 58, noise_std: 2 },
      ],
    },
    {
      key: 'org-wide-rollout',
      package_key: 'org-rollout',
      patch: {
        strategy: { search_policy: 'EXPLORATORY', exploration_rate: 0.4 },
        retrieval_weights: { VALIDATED_PACKAGE: 1.2 },
      },
      intent: 'Roll out an exploratory process policy across every SOS deployment (organization-wide blast radius).',
      predicted_effects: [
        'process exploration improves the diversity of retrieved candidates',
        'organization-wide adoption requires supervised authority',
      ],
      hypothesis_statement: 'An exploratory process policy improves candidate diversity across all deployments.',
      blast_radius: 'ORGANIZATION',
      impact: 'HIGH',
      risk: 'MODERATE',
      reversibility: 'PARTIALLY_REVERSIBLE',
      uncertainty: { uncertainty_class: 'MODERATE', basis: 'org-wide effects are observed only after adoption' },
      predicted_estimates: { COST: 92, LATENCY: 74, RESILIENCE: 52, HUMAN_COMPREHENSIBILITY: 61 },
      behavior: { RESILIENCE: 52, HUMAN_COMPREHENSIBILITY: 61 },
      fitness: 0.6,
      decision_evidence: [],
      promotion_evidence: [],
      effects: [
        { arm_id: 'control', metric_id: 'COST', true_mean: 100, noise_std: 4 },
        { arm_id: 'treatment', metric_id: 'COST', true_mean: 92, noise_std: 4 },
        { arm_id: 'control', metric_id: 'LATENCY', true_mean: 80, noise_std: 3 },
        { arm_id: 'treatment', metric_id: 'LATENCY', true_mean: 74, noise_std: 3 },
        { arm_id: 'control', metric_id: 'RESILIENCE', true_mean: 50, noise_std: 2 },
        { arm_id: 'treatment', metric_id: 'RESILIENCE', true_mean: 52, noise_std: 2 },
        { arm_id: 'control', metric_id: 'HUMAN_COMPREHENSIBILITY', true_mean: 60, noise_std: 2 },
        { arm_id: 'treatment', metric_id: 'HUMAN_COMPREHENSIBILITY', true_mean: 61, noise_std: 2 },
      ],
    },
    {
      key: 'healthy-tuning',
      package_key: 'validated-tuning',
      patch: {
        strategy: { search_policy: 'BALANCED', exploration_rate: 0.3, max_candidates_per_family: 4 },
        retrieval_weights: { VALIDATED_COMPOSITION: 1.2, VALIDATED_PACKAGE: 1.1 },
      },
      intent: 'Tune the process toward a balanced search policy with slightly stronger validated-altitude retrieval weights and a wider per-family candidate budget.',
      predicted_effects: [
        'process cost and latency improve on the section-11 axes',
        'the resilience guardrail stays satisfied',
        'human comprehensibility improves (small explainable steps)',
      ],
      hypothesis_statement: 'Balanced search with stronger validated-altitude weights improves the process objective profile without governance change.',
      blast_radius: 'SERVICE',
      impact: 'MODERATE',
      risk: 'LOW',
      reversibility: 'REVERSIBLE',
      uncertainty: { uncertainty_class: 'LOW', basis: 'the family carries prior interventional rollouts with current SUCCESS evidence' },
      predicted_estimates: { COST: 88, LATENCY: 70, RESILIENCE: 54, HUMAN_COMPREHENSIBILITY: 63 },
      behavior: { RESILIENCE: 54, HUMAN_COMPREHENSIBILITY: 63 },
      fitness: 0.9,
      decision_evidence: [
        { kind: 'meta-process-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W16:golden-scenario:healthy-tuning-decision-evidence-1'] },
        { kind: 'meta-process-evaluation', availability: 'SUCCESS', evidence_class: 'INTERVENTIONAL', method: 'evaluation:meta-process-controlled-rollout', provenance: ['W16:golden-scenario:healthy-tuning-decision-evidence-2'] },
      ],
      promotion_evidence: [
        { kind: 'meta-process-evaluation', availability: 'SUCCESS', evidence_class: 'OBSERVATIONAL', method: 'evaluation:meta-process-observation', provenance: ['W16:golden-scenario:healthy-tuning-promotion-evidence-1'] },
        { kind: 'meta-process-evaluation', availability: 'SUCCESS', evidence_class: 'INTERVENTIONAL', method: 'evaluation:meta-process-controlled-rollout', provenance: ['W16:golden-scenario:healthy-tuning-promotion-evidence-2'] },
      ],
      effects: [
        { arm_id: 'control', metric_id: 'COST', true_mean: 100, noise_std: 4 },
        { arm_id: 'treatment', metric_id: 'COST', true_mean: 88, noise_std: 4 },
        { arm_id: 'control', metric_id: 'LATENCY', true_mean: 80, noise_std: 3 },
        { arm_id: 'treatment', metric_id: 'LATENCY', true_mean: 70, noise_std: 3 },
        { arm_id: 'control', metric_id: 'RESILIENCE', true_mean: 50, noise_std: 2 },
        { arm_id: 'treatment', metric_id: 'RESILIENCE', true_mean: 54, noise_std: 2 },
        { arm_id: 'control', metric_id: 'HUMAN_COMPREHENSIBILITY', true_mean: 60, noise_std: 2 },
        { arm_id: 'treatment', metric_id: 'HUMAN_COMPREHENSIBILITY', true_mean: 63, noise_std: 2 },
      ],
    },
  ],

  effectiveness: {
    population_description: 'The SOS evolutionary process operating over the golden object system (merch-catalog-legacy).',
    unit: 'REQUEST',
    canary_ladder: [1, 5, 25, 50],
    canary_exposure_percent: 5,
    metrics: [
      { id: 'COST', role: 'PRIMARY', description: 'Process evaluation cost on the COST axis (lower is better).', direction: 'DECREASE' },
      { id: 'LATENCY', role: 'PRIMARY', description: 'Process cycle latency on the LATENCY axis (lower is better).', direction: 'DECREASE' },
      { id: 'RESILIENCE', role: 'GUARDRAIL', description: 'Process resilience profile on the RESILIENCE axis (higher is better; floor wired to rollback).', direction: 'INCREASE', guardrail_threshold: 40 },
      { id: 'HUMAN_COMPREHENSIBILITY', role: 'SECONDARY', description: 'Human comprehensibility of the process policy (higher is better).', direction: 'INCREASE' },
    ],
    stopping_criteria: [{ kind: 'MAX_SAMPLES', max_samples: 2000 }],
    rollback_criteria: [
      {
        id: 'rollback-resilience-floor',
        guardrail_metric_ids: ['RESILIENCE'],
        description: 'Roll back when the RESILIENCE guardrail is breached or cannot be established (fail-closed).',
      },
    ],
    seed: 20250701,
    samples_per_arm: 400,
    objective_axes: [
      { axis: 'COST', direction: 'MINIMIZE' },
      { axis: 'LATENCY', direction: 'MINIMIZE' },
      { axis: 'RESILIENCE', direction: 'MAXIMIZE' },
      { axis: 'HUMAN_COMPREHENSIBILITY', direction: 'MAXIMIZE' },
    ],
    repertoire_edges: {
      RESILIENCE: [30, 50, 60],
      HUMAN_COMPREHENSIBILITY: [50, 65, 80],
    },
  },

  authority: {
    decision: { grantee: 'agent:w16-meta-evolution-loop', permissions: ['REVISE'], expires_at: '2025-08-01T00:00:00.000Z' },
    promotion: { grantee: 'agent:w16-meta-evolution-loop', permissions: ['PROMOTE'], expires_at: '2025-08-01T00:00:00.000Z' },
  },

  learning: {
    transfer_target_context: { domain: 'sos-meta', deployment: 'internal' },
    decay_signal: {
      kind: 'FAILURE_RATE_GROWTH',
      note: 'The aggressive-pruning family produced a failed self-change (resilience guardrail breach); its maturity review is queued.',
    },
    failure_rule:
      'For SOS self-evolution, meta-strategy packages with recorded transfer failures carry reduced proposal probability (weight = fitness / (1 + failures)); re-validate a family through interventional evidence before restoring its weight.',
    rollback_rule:
      'For process-parameter changes, wire the RESILIENCE guardrail before any exposure: the regressive world breached it and the loop rolled back with an exact parameter restore within the declared recovery bound.',
  },
};

/** Build the golden meta-evolution loop input (fresh registry + stores per call). */
export function buildGoldenMetaInput(): BuiltMetaEvolutionInput {
  return buildMetaEvolutionInput(GOLDEN_META_SCENARIO, GOLDEN_BROWNFIELD_SCENARIO);
}

/**
 * Run the golden OBJECT loop (the W15 brownfield golden scenario) over one
 * variant — the object lane the meta loop's separation stage probes and the
 * harness's second object world. Deterministic, pure.
 */
export function runGoldenObjectLoop(variant: BrownfieldVariant): BrownfieldLoopResult {
  return runBrownfieldLoop(buildBrownfieldLoopInput(GOLDEN_BROWNFIELD_SCENARIO, variant).input);
}
