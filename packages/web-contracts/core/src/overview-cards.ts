/**
 * The below-hero overview cards (docs/ux/sharenet-inspired-design.md
 * "Overview / Below"): current change, evidence quality, experiment status,
 * package reuse, recent learning.
 *
 * All vocabularies are imported from the owning packages: truth states and
 * availability summaries from @sos-2/semantic-spine / @sos-2/evidence,
 * experiment phases from @sos-2/experiments (with the simulated-run honesty
 * markers), package maturity from @sos-2/semantic-spine (re-exported by
 * @sos-2/packages). Count maps carry ALL keys so no truth state can be
 * silently dropped.
 */

import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { summarizeAvailability } from '@sos-2/evidence';
import type { Confidence, UncertaintyClass } from '@sos-2/evidence';
import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import type { PackageMaturity } from '@sos-2/semantic-spine';
import type { RationaleChain } from '@sos-2/ui-contracts';
import type { DataSource } from './data-source.js';
import { WebContractError } from './errors.js';
import type { NextActionView } from './next-action.js';
import type { StateBlock } from './state-block.js';
import { buildStateBlock } from './state-block.js';
import type { ProductVmCore } from './vm-core.js';

// ---------------------------------------------------------------------------
// Current change
// ---------------------------------------------------------------------------

/** The current change view model (candidate + experiment + rollback readiness). */
export interface CurrentChangeSummaryVM {
  core: ProductVmCore;
  candidate_id: string;
  title: string;
  /** What the change is predicted to do (from the candidate). */
  predicted_effects: string[];
  /** What must keep holding (from the candidate). */
  invariants: string[];
  confidence_class: UncertaintyClass;
  /** The experiment id verifying the change, or null. */
  experiment_ref: string | null;
  /** Whether a rollback rehearsal exists with SUCCESS evidence. */
  rollback_rehearsed: boolean;
  rollback_evidence_refs: string[];
}

/** Project the current change from a W11 CandidateStateFixture-shaped record. */
export function projectCurrentChange(input: {
  candidate: {
    envelope: { id: string };
    content: {
      invariants: readonly string[];
      predicted_effects: readonly string[];
      confidence: Confidence | null;
    };
  };
  title: string;
  experiment_ref: string | null;
  rollback_evidence: readonly { id: string; availability: EvidenceTruthState }[];
  rationale: RationaleChain;
  data_source: DataSource;
  evidence_refs: readonly string[];
  uncertainty: { uncertainty_class: UncertaintyClass; statement: string };
  authority: ProductVmCore['authority'];
  next_allowed_action: NextActionView;
}): CurrentChangeSummaryVM {
  if (input.rationale.subject_id !== input.candidate.envelope.id) {
    throw new WebContractError('the current-change rationale must bind the candidate id');
  }
  return {
    core: {
      subject_id: input.candidate.envelope.id,
      data_source: input.data_source,
      rationale: input.rationale,
      evidence_refs: [...new Set(input.evidence_refs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      uncertainty: {
        uncertainty_class: input.uncertainty.uncertainty_class,
        statement: input.uncertainty.statement,
      },
      authority: input.authority,
      next_allowed_action: input.next_allowed_action,
    },
    candidate_id: input.candidate.envelope.id,
    title: input.title,
    predicted_effects: [...input.candidate.content.predicted_effects],
    invariants: [...input.candidate.content.invariants],
    confidence_class: confidenceClassOf(input.candidate.content.confidence),
    experiment_ref: input.experiment_ref,
    rollback_rehearsed: input.rollback_evidence.some((record) => record.availability === 'SUCCESS'),
    rollback_evidence_refs: input.rollback_evidence.map((record) => record.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  };
}

/** The uncertainty class of a candidate confidence: qualitative classes pass through; calibrated/absent confidence is UNQUANTIFIED for display. */
export function confidenceClassOf(confidence: Confidence | null): UncertaintyClass {
  return confidence !== null && confidence.kind === 'QUALITATIVE' ? confidence.uncertainty_class : 'UNQUANTIFIED';
}

// ---------------------------------------------------------------------------
// Evidence quality
// ---------------------------------------------------------------------------

/** The evidence quality summary (counts per DISTINCT truth state — all six keys always present). */
export interface EvidenceQualitySummaryVM {
  core: ProductVmCore;
  /** Counts per truth state. ALL six keys are always present (nothing dropped). */
  counts: Record<EvidenceTruthState, number>;
  total: number;
  /** Analysis records produced by a model (marked non-authoritative by contract). */
  llm_analysis_count: number;
  /** The distinct truth states present in the pool (sorted). */
  present_states: EvidenceTruthState[];
  /** The honest coverage block (PARTIAL when any observation source is unreachable). */
  coverage_block: StateBlock | null;
}

/** Project the evidence quality summary over an evidence pool. */
export function projectEvidenceQuality(input: {
  records: readonly EvidenceRecordW3[];
  coverage: { present: readonly string[]; missing: readonly string[] };
  rationale: RationaleChain;
  data_source: DataSource;
  uncertainty: { uncertainty_class: UncertaintyClass; statement: string };
  authority: ProductVmCore['authority'];
  next_allowed_action: NextActionView;
}): EvidenceQualitySummaryVM {
  const counts = summarizeAvailability(input.records);
  const llm_analysis_count = input.records.filter((record) => record.llm_output).length;
  const present_states = (Object.keys(counts) as EvidenceTruthState[]).filter((state) => counts[state] > 0).sort();
  const coverage_block =
    input.coverage.missing.length > 0 && input.coverage.present.length > 0
      ? buildStateBlock({
          kind: 'PARTIAL',
          surface: 'evidence-coverage',
          statement: 'Evidence collection covers most sources; some sources are not reachable right now.',
          present: input.coverage.present,
          missing: input.coverage.missing,
          action: 'Unreachable sources stay explicitly unavailable — no value is fabricated for them.',
        })
      : null;
  return {
    core: {
      subject_id: input.rationale.subject_id,
      data_source: input.data_source,
      rationale: input.rationale,
      evidence_refs: [...input.records].map((record) => record.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      uncertainty: {
        uncertainty_class: input.uncertainty.uncertainty_class,
        statement: input.uncertainty.statement,
      },
      authority: input.authority,
      next_allowed_action: input.next_allowed_action,
    },
    counts,
    total: input.records.length,
    llm_analysis_count,
    present_states,
    coverage_block,
  };
}

// ---------------------------------------------------------------------------
// Experiment status
// ---------------------------------------------------------------------------

/** One metric with its role (PRIMARY/SECONDARY/GUARDRAIL — imported vocabulary order preserved). */
export interface ExperimentMetricView {
  metric_id: string;
  role: string;
  description: string;
  direction: string;
  guardrail_threshold: number | null;
}

/** The experiment status summary (phases and simulated markers imported from @sos-2/experiments). */
export interface ExperimentStatusSummaryVM {
  core: ProductVmCore;
  experiment_id: string;
  title: string;
  phase: string;
  exposure_percent: number;
  canary_ladder: number[];
  metrics: ExperimentMetricView[];
  rollback_criteria: { id: string; description: string }[];
  stopping_criteria: { description: string }[];
  candidate_ref: string;
  hypothesis_ref: string;
  /** HONESTY: the evaluated run is simulated evaluation infrastructure, never intervention evidence. */
  run_is_simulated: boolean;
  simulator: { version: string; seed: number } | null;
  evaluation_summary: string;
}

/** Project the experiment status from the experiment artifact (+ result/evaluation). */
export function projectExperimentStatus(input: {
  experiment: {
    envelope: { id: string };
    content: {
      design: {
        metrics: readonly { id: string; role: string; description: string; direction: string; guardrail_threshold?: number }[];
        stopping_criteria: readonly { description?: string; [extension: string]: unknown }[];
        rollback_criteria: readonly { id: string; description: string }[];
      };
      stage: { phase: string; exposure_percent: number };
      canary_ladder: readonly number[];
      candidate_ref: string;
      hypothesis_ref: string;
    };
  };
  title: string;
  result: { simulated: boolean; simulator: { version: string; seed: number } | null } | null;
  evaluation_summary: string;
  rationale: RationaleChain;
  data_source: DataSource;
  evidence_refs: readonly string[];
  uncertainty: { uncertainty_class: UncertaintyClass; statement: string };
  authority: ProductVmCore['authority'];
  next_allowed_action: NextActionView;
}): ExperimentStatusSummaryVM {
  if (input.rationale.subject_id !== input.experiment.envelope.id) {
    throw new WebContractError('the experiment-status rationale must bind the experiment id');
  }
  return {
    core: {
      subject_id: input.experiment.envelope.id,
      data_source: input.data_source,
      rationale: input.rationale,
      evidence_refs: [...new Set(input.evidence_refs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      uncertainty: {
        uncertainty_class: input.uncertainty.uncertainty_class,
        statement: input.uncertainty.statement,
      },
      authority: input.authority,
      next_allowed_action: input.next_allowed_action,
    },
    experiment_id: input.experiment.envelope.id,
    title: input.title,
    phase: input.experiment.content.stage.phase,
    exposure_percent: input.experiment.content.stage.exposure_percent,
    canary_ladder: [...input.experiment.content.canary_ladder],
    metrics: input.experiment.content.design.metrics.map((metric) => ({
      metric_id: metric.id,
      role: metric.role,
      description: metric.description,
      direction: metric.direction,
      guardrail_threshold: metric.guardrail_threshold ?? null,
    })),
    rollback_criteria: input.experiment.content.design.rollback_criteria.map((criterion) => ({
      id: criterion.id,
      description: criterion.description,
    })),
    stopping_criteria: input.experiment.content.design.stopping_criteria.map((criterion) => ({
      description:
        criterion.description ?? `Stopping criterion of kind ${JSON.stringify(String(criterion['kind'] ?? 'unknown'))}`,
    })),
    candidate_ref: input.experiment.content.candidate_ref,
    hypothesis_ref: input.experiment.content.hypothesis_ref,
    run_is_simulated: input.result?.simulated ?? false,
    simulator: input.result?.simulated ? input.result.simulator : null,
    evaluation_summary: input.evaluation_summary,
  };
}

// ---------------------------------------------------------------------------
// Package reuse
// ---------------------------------------------------------------------------

/** One package summary row. */
export interface PackageSummaryRow {
  package_id: string;
  capability: string;
  maturity: PackageMaturity;
  family: string;
  evidence_count: number;
  limitations: string[];
}

/** The package reuse summary. */
export interface PackageReuseSummaryVM {
  core: ProductVmCore;
  packages: PackageSummaryRow[];
  package_count: number;
  family_count: number;
  /** Compositions formed in this dataset (the deep composition workspace is a later wave). */
  composition_count: number;
  composition_note: string;
}

/** Project the package reuse summary over package artifacts. */
export function projectPackageReuse(input: {
  packages: readonly {
    envelope: { id: string };
    content: {
      semantic_capability: string;
      maturity: PackageMaturity;
      diversity_profile: { family: string };
      evidence_refs: readonly string[];
      learned_limitations: readonly string[];
    };
  }[];
  composition_count: number;
  composition_note: string;
  rationale: RationaleChain;
  data_source: DataSource;
  uncertainty: { uncertainty_class: UncertaintyClass; statement: string };
  authority: ProductVmCore['authority'];
  next_allowed_action: NextActionView;
}): PackageReuseSummaryVM {
  const rows = input.packages
    .map((pkg) => ({
      package_id: pkg.envelope.id,
      capability: pkg.content.semantic_capability,
      maturity: pkg.content.maturity,
      family: pkg.content.diversity_profile.family,
      evidence_count: pkg.content.evidence_refs.length,
      limitations: [...pkg.content.learned_limitations],
    }))
    .sort((a, b) => (a.package_id < b.package_id ? -1 : a.package_id > b.package_id ? 1 : 0));
  return {
    core: {
      subject_id: input.rationale.subject_id,
      data_source: input.data_source,
      rationale: input.rationale,
      evidence_refs: packageEvidenceRefs(input.packages),
      uncertainty: {
        uncertainty_class: input.uncertainty.uncertainty_class,
        statement: input.uncertainty.statement,
      },
      authority: input.authority,
      next_allowed_action: input.next_allowed_action,
    },
    packages: rows,
    package_count: rows.length,
    family_count: new Set(rows.map((row) => row.family)).size,
    composition_count: input.composition_count,
    composition_note: input.composition_note,
  };
}

function packageEvidenceRefs(
  packages: readonly {
    envelope: { id: string };
    content: { evidence_refs: readonly string[] };
  }[],
): string[] {
  return [...new Set(packages.flatMap((pkg) => [...pkg.content.evidence_refs]))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
}

// ---------------------------------------------------------------------------
// Recent learning
// ---------------------------------------------------------------------------

/** Where a learning entry came from (view-level vocabulary over imported record kinds). */
export const RECENT_LEARNING_KINDS = [
  'AMBIGUITY_RESOLUTION',
  'MISSION_REVISION',
  'OBJECTION_RESOLUTION',
  'PACKAGE_LIMITATION',
] as const;

export type RecentLearningKind = (typeof RECENT_LEARNING_KINDS)[number];

/** One recent learning entry. */
export interface RecentLearningEntry {
  entry_id: string;
  kind: RecentLearningKind;
  statement: string;
  /** Spine ids the entry references (mission, package, evidence, ...). */
  refs: string[];
  /** Static fixture instant. */
  learned_at: string;
}

/** The recent learning summary. */
export interface RecentLearningVM {
  core: ProductVmCore;
  entries: RecentLearningEntry[];
  as_of: string;
}

/** Project the recent learning summary over authored learning entries (deterministic order: learned_at desc, entry_id). */
export function projectRecentLearning(input: {
  entries: readonly RecentLearningEntry[];
  as_of: string;
  rationale: RationaleChain;
  data_source: DataSource;
  uncertainty: { uncertainty_class: UncertaintyClass; statement: string };
  authority: ProductVmCore['authority'];
  next_allowed_action: NextActionView;
}): RecentLearningVM {
  const entries = [...input.entries]
    .sort((a, b) => {
      if (a.learned_at !== b.learned_at) {
        return a.learned_at < b.learned_at ? 1 : -1;
      }
      return a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0;
    })
    .map((entry) => ({
      ...entry,
      refs: [...new Set(entry.refs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    }));
  return {
    core: {
      subject_id: input.rationale.subject_id,
      data_source: input.data_source,
      rationale: input.rationale,
      evidence_refs: [],
      uncertainty: {
        uncertainty_class: input.uncertainty.uncertainty_class,
        statement: input.uncertainty.statement,
      },
      authority: input.authority,
      next_allowed_action: input.next_allowed_action,
    },
    entries,
    as_of: input.as_of,
  };
}
