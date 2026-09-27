/**
 * THE P19 DOGFOOD RECORDS — the typed, inspectable shapes the harness
 * produces (consumed by the evidence writers in tests/real-dogfood).
 * Every record is DATA: honest outcomes, exact revisions, provider
 * states from REAL probes, env NAMES only (never credential values).
 */

import type { CloudTickRecord, CompletionReport, JourneyState } from '@sos-2/greenfield-runtime';
import type { PipelineAsk } from '@sos-2/implementation-orchestrator';
import type { ActionReceipt } from '@sos-2/action-gateway';

/** The honest provider-state vocabulary (the P17 lane rule, verbatim). */
export type DogfoodProviderStateStatus = 'CONNECTED' | 'UNKNOWN' | 'UNAVAILABLE' | 'DEGRADED';

/** One honest provider-state row (from REAL probes only; never fabricated). */
export interface DogfoodProviderState {
  readonly provider: string;
  readonly state: DogfoodProviderStateStatus;
  readonly probed: boolean;
  readonly detail: string;
  /** The env NAME of the credential the probe used (never the value). */
  readonly credentialEnv: string | null;
  readonly probedAt: string | null;
}

/** The honest store-selection record (the live-data-plane precedent). */
export interface DogfoodStoreSelection {
  /** PRODUCTION_DURABLE only on a CONNECTED canonical probe; every other state degrades to the explicit reference marker. */
  readonly mode: 'PRODUCTION_DURABLE' | 'REFERENCE_FALLBACK';
  /** The explicit store reference (e.g. 'reference:in-memory-live-store'). */
  readonly storeRef: string;
  /** True when the store is the reference in-memory live store (never production durable state). */
  readonly referenceMode: boolean;
  readonly canonical: { readonly provider: 'neon'; readonly state: DogfoodProviderStateStatus; readonly detail: string };
  readonly coordination: { readonly provider: 'upstash'; readonly state: DogfoodProviderStateStatus; readonly detail: string };
  readonly note: string;
}

/** One real model-call record of the dogfood body (provider facts, never credentials). */
export interface DogfoodModelCallRecord {
  readonly taskId: string;
  readonly attempt: number;
  readonly engineAttempt: number;
  readonly ok: boolean;
  readonly model: string | null;
  readonly responseId: string | null;
  readonly usage: { readonly prompt_tokens: number | null; readonly completion_tokens: number | null; readonly total_tokens: number | null } | null;
  readonly filesApplied: readonly string[];
  readonly error: string | null;
}

/** One recorded repair occurrence (honest — whether or not one occurred). */
export interface DogfoodRepairRecord {
  readonly taskId: string;
  readonly attempt: number;
  /** The exact revision the repair produced (null when no repair revision landed). */
  readonly newSourceRevision: string | null;
  readonly detail: string;
}

/** One per-stage journey record: the stage, its instant, its EXACT revision, receipts and transcript references. */
export interface DogfoodStageRecord {
  readonly stage: string;
  readonly at: string;
  /** The EXACT revision the stage acted on/produced (honest — may be the empty-repository marker). */
  readonly revision: string | null;
  readonly detail: string;
  /** Gateway action receipts produced at this stage (actionId + family + status + evidence ids). */
  readonly receipts: readonly DogfoodActionReceiptSummary[];
  /** Transcript references (provider + the recorded request count at this point). */
  readonly transcriptRefs: readonly { readonly provider: string; readonly requests: number }[];
}

/** The evidence-facing summary of one gateway action receipt. */
export interface DogfoodActionReceiptSummary {
  readonly actionId: string;
  readonly family: string;
  readonly status: string;
  readonly sourceRevision: string;
  readonly deploymentRevision: string | null;
  readonly evidenceIds: readonly string[];
  readonly denialReason: string | null;
  readonly failureType: string | null;
}

/** The realized pull-request record (exact evidence refs). */
export interface DogfoodPullRequestRecord {
  readonly number: number;
  readonly url: string;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly headSha: string;
  readonly actionId: string;
}

/** The realized deployment record (exact evidence refs). */
export interface DogfoodDeploymentRecord {
  readonly deploymentId: string;
  readonly url: string;
  readonly readyState: string;
  /** The EXACT git commit sha the deployment was built from (binding proof). */
  readonly commitSha: string | null;
  readonly projectId: string;
  readonly projectName: string;
  readonly target: string;
  readonly actionId: string;
  readonly pollAttempts: number;
  readonly waitedMs: number;
}

/** The real runtime-verification facts (HTTP GETs of the deployed URL). */
export interface DogfoodRuntimeVerificationRecord {
  readonly rootStatus: number | null;
  readonly rootBodyExcerpt: string | null;
  readonly readmeStatus: number | null;
  /** True when the served README body is byte-identical to the repository content at the exact deployed revision. */
  readonly readmeByteExact: boolean;
  readonly deployedRevision: string;
  readonly fetchedAt: string;
}

/** The post-journey package-learning record (data-only learned artifacts). */
export interface DogfoodLearningRecord {
  readonly packageIds: readonly string[];
  readonly compositionId: string | null;
  readonly evidenceIds: readonly string[];
  readonly ecologyAssertion: { readonly source: string; readonly target: string; readonly kind: string } | null;
  readonly realEvidenceRefs: {
    readonly pullRequestUrl: string | null;
    readonly pullRequestHeadSha: string | null;
    readonly deploymentUrl: string | null;
    readonly deploymentCommitSha: string | null;
    readonly evaluatorVerdictRefs: readonly string[];
  };
  readonly note: string;
}

/** The full record of ONE dogfood run (run 1 or run 2). */
export interface DogfoodRunRecord {
  readonly runId: string;
  readonly journeyId: string;
  readonly mission: { readonly statement: string; readonly repositorySlug: string; readonly source: string };
  readonly repository: { readonly owner: string; readonly name: string; readonly createdThisRun: boolean; readonly htmlUrl: string | null };
  readonly implementationBranch: string;
  readonly providerStates: readonly DogfoodProviderState[];
  readonly storeSelection: DogfoodStoreSelection;
  readonly modelCalls: readonly DogfoodModelCallRecord[];
  readonly repairs: readonly DogfoodRepairRecord[];
  readonly asks: readonly { readonly askId: string; readonly stage: string; readonly reasonCode: string; readonly detail: string }[];
  readonly stages: readonly DogfoodStageRecord[];
  readonly ticks: readonly CloudTickRecord[];
  readonly pullRequest: DogfoodPullRequestRecord | null;
  readonly deployment: DogfoodDeploymentRecord | null;
  readonly runtimeVerification: DogfoodRuntimeVerificationRecord | null;
  readonly learning: DogfoodLearningRecord | null;
  readonly completion: CompletionReport | null;
  readonly finalState: JourneyState | null;
  readonly pendingAsk: PipelineAsk | null;
  readonly honestNotes: readonly string[];
}

/** The outcome classes of one run — the reproducibility equivalence basis. */
export interface DogfoodRunOutcomeClasses {
  readonly finalStage: string;
  readonly finalStatus: string;
  readonly stageSequence: readonly string[];
  readonly completed: boolean;
  readonly evaluationVerdicts: readonly string[];
  readonly repairOccurred: boolean;
  readonly askOccurred: boolean;
  readonly storeMode: string;
}

/** The run-2 reproducibility record: outcome-class equivalence + HONEST differences (never fabricated equality). */
export interface DogfoodReproducibilityRecord {
  readonly run1: { readonly runId: string; readonly repositorySlug: string };
  readonly run2: { readonly runId: string; readonly repositorySlug: string };
  readonly sameStageSequence: boolean;
  readonly sameOutcomeClasses: boolean;
  readonly outcomeClassesRun1: DogfoodRunOutcomeClasses;
  readonly outcomeClassesRun2: DogfoodRunOutcomeClasses;
  /** Honest differences — timestamps/shas/model output differ; recorded, never fabricated into equality. */
  readonly honestDifferences: readonly string[];
  readonly note: string;
}

/** Extract the outcome classes of a run (the equivalence basis; §4 run-2). */
export function outcomeClassesOf(record: DogfoodRunRecord): DogfoodRunOutcomeClasses {
  return {
    finalStage: record.finalState?.stage ?? 'NONE',
    finalStatus: record.finalState?.status ?? 'NONE',
    stageSequence: record.finalState?.transitions.map((transition) => transition.to) ?? [],
    completed: record.completion !== null,
    evaluationVerdicts: record.completion?.evaluation.verdictRefs.map((verdict) => verdict.type) ?? [],
    repairOccurred: record.repairs.length > 0,
    askOccurred: record.asks.length > 0,
    storeMode: record.storeSelection.mode,
  };
}

/** Summarize one gateway action receipt for evidence. */
export function summarizeReceipt(receipt: ActionReceipt): DogfoodActionReceiptSummary {
  return {
    actionId: receipt.actionId,
    family: receipt.family,
    status: receipt.status,
    sourceRevision: receipt.sourceRevision,
    deploymentRevision: receipt.deploymentRevision,
    evidenceIds: [...receipt.evidenceIds],
    denialReason: receipt.denial === null ? null : receipt.denial.reason,
    failureType: receipt.failure === null ? null : receipt.failure.errorType,
  };
}
