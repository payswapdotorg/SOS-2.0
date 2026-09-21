/**
 * The self-evolution view models (Work Order P10) — SOS applying the same
 * evolution loop to itself, as a READ-ONLY product surface.
 *
 * spec/productization-work-orders/P10-package-history-evolution.md
 * acceptance: "self-evolution reads canonical live state";
 * "machine/demo state is explicitly labelled".
 * docs/ux/user-journey-simulation.md Self-evolution: "Canonical live state
 * only; fixture clearly marked DEMO."
 * spec/architecture.md section 16: "Meta-adaptation cannot disable the
 * mechanism that judges meta-adaptation" — the console can OBSERVE SOS
 * self-evolution but never steer it (there is no mutation path in any P10
 * projection).
 *
 * The projections carry: the MetaProcess revision chain (parameters
 * verbatim, with the EXACT-RESTORE case visible), the NON-DISABLEABLE
 * governance guard state (invariants + evolvable keys verbatim from
 * @sos-2/meta-evolution, plus retained typed rejections), the retained
 * failure memory (@sos-2/memory ArchitectureMemory entries — FAILURE,
 * ROLLBACK, LIABILITY and LEARNED_RULE are retained, never deleted), the
 * learned rules, and the machine-state snapshot from the live-store
 * development-state repository.
 *
 * All vocabularies (entry kinds, severities, owner kinds, resolution
 * states, invariant ids, rejection codes, parameter shapes) are IMPORTED
 * from the owning @sos-2/* packages — never redefined. Zero domain logic:
 * the guard state is the owning package's own frozen constants; the
 * rejection records are produced by the owning package's pure evaluator.
 */

import { contentHash, isArtifactId } from '@sos-2/semantic-spine';
import type { GuardRejection, GuardRejectionCode, GovernanceInvariantId, MetaProcessArtifact, MetaProcessParameters } from '@sos-2/meta-evolution';
import { EVOLVABLE_KEYS, GOVERNANCE_INVARIANT_IDS } from '@sos-2/meta-evolution';
import type { ArchitectureMemoryArtifact, MemoryEntry } from '@sos-2/memory';
import { MEMORY_ENTRY_KINDS } from '@sos-2/memory';
import type { LiabilityOwnerKind, LiabilityResolution, LiabilitySeverity } from '@sos-2/memory';
import type { UncertaintyClass } from '@sos-2/evidence';
import type {
  AuthorityView,
  DataSource,
  NextActionView,
  ProductVmCore,
  StateBlock,
  UncertaintyView,
} from '@sos-2/web-contracts';
import { assertValidProductVmCore } from '@sos-2/web-contracts';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The read-only self-evolution statement (part of the P10 contract, pinned by tests). */
export const EVOLUTION_READ_ONLY_NOTE =
  'SOS applies the same evolution loop to itself (spec/architecture.md section 16): process revisions are ' +
  'versioned, guard-checked and evidence-bound, failed self-changes are rolled back with an exact restore and ' +
  'retained as failure memory, and this surface is a READ-ONLY projection — the console can observe SOS ' +
  'self-evolution but never steer it (meta-adaptation cannot disable the mechanism that judges meta-adaptation).';

/** One revision of the SOS process (the evolvable parameters, verbatim). */
export interface ProcessRevisionEntryVM {
  process_id: string;
  version: number;
  status: string;
  created_at: string;
  supersedes: string | null;
  /** The evolvable process parameters, VERBATIM (never summarized). */
  parameters: MetaProcessParameters;
  /** The content digest — makes the exact-restore case checkable in the UI. */
  parameters_digest: string;
  notes: string;
  mission_ref: string | null;
}

/** The guard's retained typed rejection of a governance-weakening attempt. */
export interface GuardRejectionView {
  change_id: string;
  invariant: GovernanceInvariantId;
  code: GuardRejectionCode;
  reason: string;
  attempted_keys: string[];
}

/** The non-disableable governance guard state (read-only). */
export interface GuardStatusVM {
  /** The frozen invariant list, VERBATIM from @sos-2/meta-evolution. */
  invariants: GovernanceInvariantId[];
  /** The frozen evolvable key set, VERBATIM (the guard is outside it). */
  evolvable_keys: string[];
  /** The section 16 statement (why the guard can never be switched off). */
  note: string;
  /** Retained typed rejections (governance-weakening attempts, never dropped). */
  rejections: GuardRejectionView[];
}

/** The guard section-16 statement (pinned by tests). */
export const GUARD_NON_DISABLEABLE_NOTE =
  'The governance guard is OUTSIDE the evolvable surface: no MetaProcess parameter touches authority gates, ' +
  'traceability, ASK escalation, decision records or the guard itself, so no accumulation of legitimate ' +
  'meta-changes can weaken it (spec/architecture.md section 16). Every rejection is a retained typed record.';

/** One retained failure-memory entry (verbatim fields, presentationally grouped). */
export interface MemoryEntryView {
  entry_kind: MemoryEntry['entry_kind'];
  id: string;
  recorded_at: string;
  statement: string;
  evidence_refs: string[];
  /** The retained context facts (failures keep their context, never dropped). */
  context_facts: string[];
  severity: LiabilitySeverity | null;
  owner_kind: LiabilityOwnerKind | null;
  resolution: LiabilityResolution | null;
}

/** One ArchitectureMemory artifact with its retained entries. */
export interface FailureMemoryArtifactVM {
  memory_id: string;
  version: number;
  status: string;
  created_at: string;
  /** WHO/WHAT produced this memory update. */
  producer_kind: string;
  entries: MemoryEntryView[];
  entry_kinds_present: string[];
}

/** The retained failure memory section. */
export interface FailureMemoryVM {
  memories: FailureMemoryArtifactVM[];
  entry_kinds_present: string[];
  /** The retention statement (R19: failures are retained, never deleted). */
  note: string;
}

/** The failure-memory retention statement (pinned by tests). */
export const FAILURE_MEMORY_RETENTION_NOTE =
  'Failed self-changes are RETAINED as failure memory — never deleted: FAILURE, ROLLBACK, LIABILITY and ' +
  'LEARNED_RULE entries stay in the append-only Architecture Memory, and failed proposals reduce the source ' +
  "package's future proposal probability (R19; the store has no removal path).";

/** One learned rule, surfaced first-class. */
export interface LearnedRuleVM {
  id: string;
  recorded_at: string;
  statement: string;
  /** The applicability context (a silent universal rule is rejected by the owner). */
  applicability: Record<string, unknown>;
  uncertainty_class: UncertaintyClass;
  evidence_refs: string[];
  memory_id: string;
}

/** The machine-state snapshot section (from the live-store development-state repository). */
export interface MachineStateViewVM {
  state_id: string;
  revision: number;
  description: string | null;
  updated_at: string;
  /** The frontier work orders (from the canonical machine-state snapshot). */
  frontier: string[];
  /** The program status, verbatim from the snapshot. */
  program: string;
  status: string;
  /** The current task, verbatim. */
  current_task: string;
}

/** The provenance of the live read behind the evolution surface. */
export interface EvolutionLiveReadProvenanceVM {
  /** The durable-store reference the records were read from (never a queue). */
  store_ref: string;
  /** The live-store repository families that were read. */
  families_read: string[];
  /** The read instant/revision token (caller-supplied; never a hidden clock). */
  as_of: string;
}

/**
 * The self-evolution surface view model — process revisions, guard state,
 * retained failure memory, learned rules and the machine state, READ-ONLY.
 */
export interface EvolutionVM {
  core: ProductVmCore;
  process_chain: { entries: ProcessRevisionEntryVM[]; current_head: string | null };
  guard: GuardStatusVM;
  failure_memory: FailureMemoryVM;
  learned_rules: LearnedRuleVM[];
  machine_state: MachineStateViewVM | null;
  /** The live-read provenance (which repositories the records came from). */
  live_read: EvolutionLiveReadProvenanceVM;
  /** Honest state blocks for absent live-state families. */
  state_blocks: StateBlock[];
  read_only_note: string;
}

function processEntryOf(artifact: MetaProcessArtifact): ProcessRevisionEntryVM {
  return {
    process_id: artifact.envelope.id,
    version: artifact.envelope.version,
    status: artifact.envelope.status,
    created_at: artifact.envelope.created_at,
    supersedes: artifact.envelope.supersedes,
    parameters: structuredClone(artifact.content.parameters),
    parameters_digest: contentHash(artifact.content.parameters),
    notes: artifact.content.notes,
    mission_ref: artifact.content.mission_ref,
  };
}

function memoryEntryViewOf(entry: MemoryEntry): MemoryEntryView {
  const context = 'context' in entry ? entry.context : 'applicability' in entry ? entry.applicability : null;
  const contextFacts =
    context === null
      ? []
      : Object.entries(context).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return {
    entry_kind: entry.entry_kind,
    id: entry.id,
    recorded_at: entry.recorded_at,
    statement: entry.statement,
    evidence_refs: [...('evidence_refs' in entry ? entry.evidence_refs : [])],
    context_facts: contextFacts,
    severity: 'severity' in entry ? entry.severity : null,
    owner_kind: 'owner_kind' in entry ? entry.owner_kind : null,
    resolution: 'resolution' in entry ? entry.resolution : null,
  };
}

function isMemoryArtifact(value: unknown): value is ArchitectureMemoryArtifact {
  return isPlainObject(value) && isPlainObject(value['envelope']) && isPlainObject(value['content']);
}

/**
 * Project the self-evolution state (pure; every input record was read
 * through the live-store repositories by the caller — see live-read.ts).
 * The guard state is the owning package's frozen constants plus the
 * retained rejection records; the failure memory entries are copied
 * verbatim; the learned rules are surfaced first-class.
 */
export function projectEvolution(input: {
  process_revisions: readonly MetaProcessArtifact[];
  guard_rejections?: readonly GuardRejection[];
  memories: readonly ArchitectureMemoryArtifact[];
  machine_state?: MachineStateViewVM | null;
  live_read: EvolutionLiveReadProvenanceVM;
  state_blocks?: readonly StateBlock[];
  rationale: ProductVmCore['rationale'];
  data_source: DataSource;
  evidence_refs: string[];
  uncertainty: UncertaintyView;
  authority: AuthorityView;
  next_allowed_action: NextActionView;
}): EvolutionVM {
  const chain = [...input.process_revisions].sort((a, b) =>
    a.envelope.created_at < b.envelope.created_at
      ? -1
      : a.envelope.created_at > b.envelope.created_at
        ? 1
        : a.envelope.id < b.envelope.id
          ? -1
          : 1,
  );
  const core: ProductVmCore = {
    subject_id: input.rationale.subject_id,
    data_source: input.data_source,
    rationale: input.rationale,
    evidence_refs: sortedUnique(input.evidence_refs),
    uncertainty: input.uncertainty,
    authority: input.authority,
    next_allowed_action: input.next_allowed_action,
  };
  assertValidProductVmCore(core);

  const memories: FailureMemoryArtifactVM[] = chain.length === 0 ? [] : input.memories
    .filter(isMemoryArtifact)
    .map((memory) => ({
      memory_id: memory.envelope.id,
      version: memory.envelope.version,
      status: memory.envelope.status,
      created_at: memory.envelope.created_at,
      producer_kind: memory.content.update.producer.tool,
      entries: memory.content.entries.map(memoryEntryViewOf),
      entry_kinds_present: sortedUnique(memory.content.entries.map((entry) => entry.entry_kind)),
    }))
    .sort((a, b) => (a.memory_id < b.memory_id ? -1 : a.memory_id > b.memory_id ? 1 : 0));

  const learnedRules: LearnedRuleVM[] = input.memories
    .filter(isMemoryArtifact)
    .flatMap((memory) =>
      memory.content.entries
        .filter((entry): entry is Extract<MemoryEntry, { entry_kind: 'LEARNED_RULE' }> => entry.entry_kind === 'LEARNED_RULE')
        .map((entry) => ({
          id: entry.id,
          recorded_at: entry.recorded_at,
          statement: entry.statement,
          applicability: { ...entry.applicability },
          uncertainty_class: entry.uncertainty.kind === 'QUALITATIVE' ? entry.uncertainty.uncertainty_class : 'UNQUANTIFIED',
          evidence_refs: [...entry.evidence_refs],
          memory_id: memory.envelope.id,
        })),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const vm: EvolutionVM = {
    core,
    process_chain: {
      entries: chain.map(processEntryOf),
      current_head: chain.length === 0 ? null : (chain[chain.length - 1] as MetaProcessArtifact).envelope.id,
    },
    guard: {
      invariants: [...GOVERNANCE_INVARIANT_IDS],
      evolvable_keys: [...EVOLVABLE_KEYS],
      note: GUARD_NON_DISABLEABLE_NOTE,
      rejections: [...(input.guard_rejections ?? [])].map((rejection) => ({
        change_id: rejection.change_id,
        invariant: rejection.invariant,
        code: rejection.code,
        reason: rejection.reason,
        attempted_keys: [...rejection.attempted_keys],
      })),
    },
    failure_memory: {
      memories,
      entry_kinds_present: sortedUnique(memories.flatMap((memory) => memory.entry_kinds_present)),
      note: FAILURE_MEMORY_RETENTION_NOTE,
    },
    learned_rules: learnedRules,
    machine_state: input.machine_state ?? null,
    live_read: {
      store_ref: input.live_read.store_ref,
      families_read: sortedUnique(input.live_read.families_read),
      as_of: input.live_read.as_of,
    },
    state_blocks: [...(input.state_blocks ?? [])],
    read_only_note: EVOLUTION_READ_ONLY_NOTE,
  };
  assertValidEvolutionVM(vm);
  return vm;
}

/** Validate an EvolutionVM (throws — the honesty rules are structural). */
export function assertValidEvolutionVM(value: unknown): asserts value is EvolutionVM {
  if (!isPlainObject(value)) {
    throw new Error('evolution view model must be an object');
  }
  const record = value as Record<string, unknown>;
  const expected = new Set([
    'core',
    'process_chain',
    'guard',
    'failure_memory',
    'learned_rules',
    'machine_state',
    'live_read',
    'state_blocks',
    'read_only_note',
  ]);
  const keys = Object.keys(record);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new Error('evolution view model must have the exact P10 field set');
  }
  const guard = record['guard'];
  if (!isPlainObject(guard)) {
    throw new Error('evolution view model must carry its guard status');
  }
  const guardRecord = guard as Record<string, unknown>;
  if (JSON.stringify(guardRecord['invariants']) !== JSON.stringify([...GOVERNANCE_INVARIANT_IDS])) {
    throw new Error('evolution guard status must carry the frozen invariant list verbatim (never redefined)');
  }
  if (!Array.isArray(guardRecord['evolvable_keys'])) {
    throw new Error('evolution guard status must carry the evolvable key set');
  }
  const processChain = record['process_chain'];
  if (!isPlainObject(processChain) || !Array.isArray((processChain as Record<string, unknown>)['entries'])) {
    throw new Error('evolution view model must carry its process revision chain');
  }
  const entries = (processChain as Record<string, unknown>)['entries'] as ProcessRevisionEntryVM[];
  for (const entry of entries) {
    if (!isArtifactId(entry.process_id)) {
      throw new Error('process revision ids must be well-formed spine artifact ids');
    }
    if (typeof entry.parameters_digest !== 'string' || entry.parameters_digest.length === 0) {
      throw new Error('process revisions must carry their parameters digest (the exact-restore check)');
    }
  }
  const failureMemory = record['failure_memory'];
  if (!isPlainObject(failureMemory)) {
    throw new Error('evolution view model must carry its failure memory');
  }
  const entryKinds = (failureMemory as Record<string, unknown>)['entry_kinds_present'];
  if (!Array.isArray(entryKinds) || entryKinds.some((kind) => !(MEMORY_ENTRY_KINDS as readonly string[]).includes(kind as string))) {
    throw new Error('failure memory entry kinds must come from the frozen seven-kind vocabulary');
  }
  const liveRead = record['live_read'];
  if (!isPlainObject(liveRead)) {
    throw new Error('evolution view model must carry its live-read provenance');
  }
  const liveReadRecord = liveRead as Record<string, unknown>;
  if (!isNonEmptyString(liveReadRecord['store_ref']) || !isNonEmptyString(liveReadRecord['as_of'])) {
    throw new Error('evolution live-read provenance must carry the store reference and the read instant');
  }
  if (!Array.isArray(liveReadRecord['families_read']) || (liveReadRecord['families_read'] as unknown[]).length === 0) {
    throw new Error('evolution live-read provenance must list the repository families that were read');
  }
  if (!Array.isArray(record['state_blocks'])) {
    throw new Error('evolution view model must carry its state blocks');
  }
  if (!isNonEmptyString(record['read_only_note'])) {
    throw new Error('evolution view model must carry the read-only self-evolution note');
  }
}
