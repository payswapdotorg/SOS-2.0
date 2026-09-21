/**
 * The history workspace view models (Work Order P10) — the revision
 * TIMELINE plus the revision DIFF.
 *
 * spec/productization-work-orders/P10-package-history-evolution.md
 * acceptance: "history is a timeline plus revision diff".
 * docs/ux/user-journey-simulation.md History: "Timeline + revision diff."
 *
 * Chains are built from the envelopes' own `supersedes` pointers (the
 * spine's identity-preserving versioning), grouped by artifact kind,
 * ordered oldest -> newest — the same discipline as the W11 history
 * projection (@sos-2/ui-contracts projectHistory), deepened with the
 * per-revision WHAT CHANGED note, the WHY (provenance), the linked
 * evidence, and a typed revision DIFF between consecutive revisions.
 *
 * The diff is a PRESENTATIONAL projection: it compares the canonical
 * serialization of each top-level content field and reports what changed,
 * including the exact-restore case (a revision whose content is byte-equal
 * to an earlier revision — the meta-evolution rollback story). It contains
 * no domain semantics; the vocabularies (statuses, kinds) are IMPORTED
 * from @sos-2/semantic-spine — never redefined.
 */

import { canonicalSerialize, contentHash, isArtifactId, isArtifactStatus } from '@sos-2/semantic-spine';
import type { ArtifactEnvelope, ArtifactStatus } from '@sos-2/semantic-spine';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type {
  AuthorityView,
  DataSource,
  NextActionView,
  ProductVmCore,
  StateBlock,
  UncertaintyView,
} from '@sos-2/web-contracts';
import { assertValidProductVmCore } from '@sos-2/web-contracts';

/** Any envelope-bearing artifact (the projection reads envelope + content fields presentationally). */
export interface HistoryArtifactBearer {
  envelope: ArtifactEnvelope;
  /** The artifact content (the projection narrows to a record presentationally). */
  content: object;
}

/** Presentational narrowing of a bearer's content (never a domain interpretation). */
function contentRecord(artifact: HistoryArtifactBearer): Record<string, unknown> {
  return artifact.content as Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The per-revision "what changed" note (PRESENTATIONAL field selection over
 * the owning packages' content shapes): the version note when the artifact
 * kind carries one (Package/PackageComposition/MetaProcess `changes`,
 * MetaProcess `notes`), the purpose for missions, the deployment summary
 * for system states — else the honest generic statement.
 */
export function revisionNoteOf(artifact: HistoryArtifactBearer): string {
  const content = contentRecord(artifact);
  if (isNonEmptyString(content['changes'])) {
    return content['changes'];
  }
  if (isNonEmptyString(content['notes'])) {
    return content['notes'];
  }
  if (isNonEmptyString(content['purpose'])) {
    return content['purpose'];
  }
  if (Array.isArray(content['deployment'])) {
    const ids = (content['deployment'] as Array<Record<string, unknown>>)
      .map((entry) => (isNonEmptyString(entry['deployment_id']) ? entry['deployment_id'] : null))
      .filter((entry): entry is string => entry !== null);
    if (ids.length > 0) {
      return `Observed deployment: ${ids.join(', ')}`;
    }
  }
  return `A ${artifact.envelope.kind} revision stored at version ${String(artifact.envelope.version)}.`;
}

/** One versioned entry on the timeline. */
export interface RevisionEntryVM {
  artifact_id: string;
  kind: string;
  version: number;
  status: ArtifactStatus;
  created_at: string;
  supersedes: string | null;
  /** What changed in this revision (the version note). */
  what_changed: string;
  /** Why SOS believes this — the revision's provenance entries (verbatim). */
  why: string[];
  /** Evidence records whose subject is this revision (sorted by id). */
  evidence_refs: string[];
  /** The deep-link route to the revision detail (timeline -> diff). */
  href: string;
}

/** One chain (a single linear supersede lineage of one artifact kind). */
export interface RevisionChainVM {
  kind: string;
  /** The chain root id (siblings of one kind form separate lineages). */
  lineage_root: string;
  entries: RevisionEntryVM[];
  current_head: string | null;
  /** The source of this chain's records (live-store family or fixture). */
  data_source: DataSource;
}

/** The history workspace view model: every chain, by kind, oldest first. */
export interface HistoryWorkspaceVM {
  core: ProductVmCore;
  chains: RevisionChainVM[];
  kinds_present: string[];
  state_blocks: StateBlock[];
}

/** The deep-link route for one spine artifact (path-safe decomposition). */
export function revisionRoute(kind: string, segment: string): string {
  return `/history/revision/${encodeURIComponent(kind)}/${encodeURIComponent(segment)}`;
}

/** The deep-link route of one artifact id (convenience over revisionRoute). */
export function revisionHrefOf(artifactId: string): string {
  const withoutScheme = artifactId.slice('sos://'.length);
  const separator = withoutScheme.lastIndexOf('/');
  return revisionRoute(withoutScheme.slice(0, separator), withoutScheme.slice(separator + 1));
}

function entryOf(artifact: HistoryArtifactBearer, evidence: readonly EvidenceRecordW3[]): RevisionEntryVM {
  const envelope = artifact.envelope;
  if (!isArtifactId(envelope.id)) {
    throw new Error(`history entry id must be a well-formed spine artifact id, received: ${JSON.stringify(envelope.id)}`);
  }
  return {
    artifact_id: envelope.id,
    kind: envelope.kind,
    version: envelope.version,
    status: envelope.status,
    created_at: envelope.created_at,
    supersedes: envelope.supersedes,
    what_changed: revisionNoteOf(artifact),
    why: [...envelope.provenance],
    evidence_refs: sortedUnique(evidence.filter((record) => record.subject_ref === envelope.id).map((record) => record.id)),
    href: revisionHrefOf(envelope.id),
  };
}

/**
 * Project envelope-bearing artifacts onto their supersede chains. Each
 * ROOT starts its own LINEAGE (siblings of one kind form separate chains,
 * identified by kind + lineage root). Deterministic: chains sorted by
 * (kind, lineage root); entries ordered by the supersedes pointers from
 * the root, version then id as the tiebreak; dangling entries are
 * appended (still shown — history is never dropped).
 */
export function projectRevisionChains(input: {
  artifacts: readonly HistoryArtifactBearer[];
  evidence: readonly EvidenceRecordW3[];
  data_source: DataSource;
}): RevisionChainVM[] {
  const byKind = new Map<string, HistoryArtifactBearer[]>();
  for (const artifact of input.artifacts) {
    if (!isPlainObject(artifact) || !isPlainObject(artifact.envelope)) {
      throw new Error('history artifacts must carry a spine envelope');
    }
    const list = byKind.get(artifact.envelope.kind) ?? [];
    list.push(artifact);
    byKind.set(artifact.envelope.kind, list);
  }
  const chains: RevisionChainVM[] = [];
  for (const kind of [...byKind.keys()].sort()) {
    const artifacts = byKind.get(kind)!;
    const byId = new Map(artifacts.map((artifact) => [artifact.envelope.id, artifact]));
    const roots = artifacts
      .filter((artifact) => artifact.envelope.supersedes === null)
      .sort((a, b) =>
        a.envelope.version < b.envelope.version ? -1 : a.envelope.version > b.envelope.version ? 1 : a.envelope.id < b.envelope.id ? -1 : 1,
      );
    const seen = new Set<string>();
    const emitChain = (ordered: HistoryArtifactBearer[]): void => {
      if (ordered.length === 0) {
        return;
      }
      const entries = ordered.map((artifact) => entryOf(artifact, input.evidence));
      chains.push({
        kind,
        lineage_root: ordered[0]!.envelope.id,
        entries,
        current_head: (entries[entries.length - 1] as RevisionEntryVM).artifact_id,
        data_source: input.data_source,
      });
    };
    for (const root of roots) {
      const ordered: HistoryArtifactBearer[] = [];
      let current: HistoryArtifactBearer | undefined = root;
      while (current !== undefined && !seen.has(current.envelope.id)) {
        seen.add(current.envelope.id);
        ordered.push(current);
        const nextId = artifacts.find((candidate) => candidate.envelope.supersedes === current!.envelope.id)?.envelope.id;
        current = nextId === undefined ? undefined : byId.get(nextId);
      }
      emitChain(ordered);
    }
    // Entries not reachable from a root (dangling supersedes pointers are a
    // store-level invariant violation) are still shown, each as its own
    // lineage (history is never dropped).
    for (const artifact of artifacts.sort((a, b) =>
      a.envelope.version < b.envelope.version ? -1 : a.envelope.version > b.envelope.version ? 1 : a.envelope.id < b.envelope.id ? -1 : 1,
    )) {
      if (!seen.has(artifact.envelope.id)) {
        seen.add(artifact.envelope.id);
        emitChain([artifact]);
      }
    }
  }
  return chains.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.lineage_root < b.lineage_root ? -1 : 1));
}

/** The history workspace projection over every chain (kinds sorted; state blocks honest). */
export function projectHistoryWorkspace(input: {
  artifacts: readonly HistoryArtifactBearer[];
  evidence: readonly EvidenceRecordW3[];
  state_blocks?: readonly StateBlock[];
  data_source: DataSource;
  rationale: ProductVmCore['rationale'];
  evidence_refs: string[];
  uncertainty: UncertaintyView;
  authority: AuthorityView;
  next_allowed_action: NextActionView;
}): HistoryWorkspaceVM {
  const chains = projectRevisionChains({ artifacts: input.artifacts, evidence: input.evidence, data_source: input.data_source });
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
  const vm: HistoryWorkspaceVM = {
    core,
    chains,
    kinds_present: sortedUnique(chains.map((chain) => chain.kind)),
    state_blocks: [...(input.state_blocks ?? [])],
  };
  assertValidHistoryWorkspaceVM(vm);
  return vm;
}

/** Validate a HistoryWorkspaceVM (throws). */
export function assertValidHistoryWorkspaceVM(value: unknown): asserts value is HistoryWorkspaceVM {
  if (!isPlainObject(value)) {
    throw new Error('history workspace view model must be an object');
  }
  const record = value as Record<string, unknown>;
  const expected = new Set(['core', 'chains', 'kinds_present', 'state_blocks']);
  const keys = Object.keys(record);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new Error('history workspace view model must have the exact P10 field set');
  }
  if (!Array.isArray(record['chains'])) {
    throw new Error('history workspace chains must be an array');
  }
  const kinds = new Set<string>();
  const lineages = new Set<string>();
  for (const chain of record['chains'] as RevisionChainVM[]) {
    if (!isPlainObject(chain) || !isNonEmptyString(chain.kind)) {
      throw new Error('history chains must carry a non-empty kind');
    }
    const lineageKey = `${chain.kind}#${chain.lineage_root}`;
    if (lineages.has(lineageKey)) {
      throw new Error(`duplicate history lineage: ${JSON.stringify(lineageKey)} (siblings form separate chains)`);
    }
    lineages.add(lineageKey);
    kinds.add(chain.kind);
    if (!Array.isArray(chain.entries)) {
      throw new Error('history chain entries must be an array');
    }
    const entries = chain.entries;
    if (entries.length > 0) {
      if (chain.lineage_root !== (entries[0] as RevisionEntryVM).artifact_id) {
        throw new Error('history chain lineage_root must be its first entry (chains start at the root)');
      }
      const head = entries[entries.length - 1] as RevisionEntryVM;
      if (chain.current_head !== head.artifact_id) {
        throw new Error('history chain current_head must be the newest entry (chains are ordered oldest -> newest)');
      }
      if ((entries[0] as RevisionEntryVM).supersedes !== null) {
        throw new Error('history chains start at a root (supersedes === null)');
      }
      for (let index = 1; index < entries.length; index += 1) {
        const previous = entries[index - 1] as RevisionEntryVM;
        const current = entries[index] as RevisionEntryVM;
        if (current.supersedes !== previous.artifact_id) {
          throw new Error(
            `history chain ${JSON.stringify(chain.kind)} is not contiguous: entry ${current.artifact_id} supersedes ${JSON.stringify(current.supersedes)}, expected ${previous.artifact_id}`,
          );
        }
      }
      for (const entry of entries) {
        if (!isArtifactId(entry.artifact_id)) {
          throw new Error('history entry ids must be well-formed spine artifact ids');
        }
        if (!isArtifactStatus(entry.status)) {
          throw new Error('history entry status must be from the frozen envelope vocabulary');
        }
        if (!isNonEmptyString(entry.what_changed)) {
          throw new Error('history entries must carry their what-changed note');
        }
      }
    }
  }
  if (JSON.stringify(record['kinds_present']) !== JSON.stringify(sortedUnique([...kinds]))) {
    throw new Error('history workspace kinds_present must mirror the chain kinds (determinism discipline)');
  }
  if (!Array.isArray(record['state_blocks'])) {
    throw new Error('history workspace view model must carry its state blocks');
  }
}

/** One changed field of a revision diff (a presentational comparison). */
export interface FieldChangeVM {
  /** The top-level content (or envelope) field that changed. */
  field: string;
  /** The canonical-JSON summary of the previous value (truncated for display). */
  from_summary: string;
  /** The canonical-JSON summary of the new value (truncated for display). */
  to_summary: string;
  /** True when the field was added by the newer revision. */
  added: boolean;
  /** True when the field was removed by the newer revision. */
  removed: boolean;
  /**
   * When the new value equals an EARLIER revision's value for this field
   * (the restore/revert case — e.g. parameters restored byte-equal after a
   * rolled-back meta change), the revision it was restored to; else null.
   */
  restored_from: { artifact_id: string; version: number } | null;
}

/** The endpoints of one revision diff. */
export interface RevisionEndpointVM {
  artifact_id: string;
  version: number;
  status: ArtifactStatus;
  created_at: string;
}

/** The revision diff view model — what changed between two revisions, and why. */
export interface RevisionDiffVM {
  core: ProductVmCore;
  from: RevisionEndpointVM;
  to: RevisionEndpointVM;
  /** The typed revision range (from -> to, both endpoints inclusive). */
  revision_range: { from: string; to: string };
  /** The changed fields (deterministic order: sorted by field name). */
  field_changes: FieldChangeVM[];
  /** Envelope lifecycle change, when any. */
  status_change: { from: ArtifactStatus; to: ArtifactStatus } | null;
  /** The newer revision's version note (what changed, in the owner's words). */
  what_changed: string;
  /** The newer revision's provenance (why). */
  why: string[];
  /** True when the newer content is byte-equal to some EARLIER revision's content (the exact-restore case). */
  exact_restore_of: { artifact_id: string; version: number } | null;
}

/** The maximum length of a field-change summary (presentational truncation, deterministic). */
export const REVISION_FIELD_SUMMARY_MAX = 160;

function fieldSummary(value: unknown): string {
  let text: string;
  try {
    text = canonicalSerialize(value);
  } catch {
    text = JSON.stringify(value) ?? String(value);
  }
  return text.length > REVISION_FIELD_SUMMARY_MAX ? `${text.slice(0, REVISION_FIELD_SUMMARY_MAX)}…` : text;
}

/**
 * Project the diff between two revisions of one artifact chain. PURE and
 * presentational: it compares the canonical serialization of each
 * top-level content field and reports the changes; a field whose new value
 * equals an EARLIER revision's value is marked restored_from (the exact
 * restore/revert case — e.g. the meta-evolution rollback restoring the
 * pre-change parameters byte-equal — shown, not asserted), and a revision
 * whose ENTIRE content equals an earlier revision's content is an
 * exact_restore_of that revision.
 */
export function projectRevisionDiff(input: {
  from: HistoryArtifactBearer;
  to: HistoryArtifactBearer;
  /** Earlier revisions of the same chain, for exact-restore detection. */
  chain?: readonly HistoryArtifactBearer[];
  rationale: ProductVmCore['rationale'];
  data_source: DataSource;
  uncertainty: UncertaintyView;
  authority: AuthorityView;
  next_allowed_action: NextActionView;
  evidence_refs?: string[];
}): RevisionDiffVM {
  const { from, to } = input;
  const fromContent = contentRecord(from);
  const toContent = contentRecord(to);
  if (from.envelope.id === to.envelope.id) {
    throw new Error('a revision diff needs two distinct revisions (the spine preserves identity across revisions)');
  }
  if (to.envelope.supersedes !== from.envelope.id) {
    throw new Error(
      `revision diffs are between consecutive revisions: ${to.envelope.id} supersedes ${JSON.stringify(to.envelope.supersedes)}, expected ${from.envelope.id}`,
    );
  }
  const changes: FieldChangeVM[] = [];
  const fields = sortedUnique([...Object.keys(fromContent), ...Object.keys(toContent)]);
  // The chain, excluding the two diff endpoints, ordered oldest -> newest
  // (version, then id) so "restored to the latest earlier revision with the
  // same value" is deterministic regardless of caller order.
  const earlierRevisions = (input.chain ?? [])
    .filter((candidate) => candidate.envelope.id !== from.envelope.id && candidate.envelope.id !== to.envelope.id)
    .sort((a, b) =>
      a.envelope.version < b.envelope.version ? -1 : a.envelope.version > b.envelope.version ? 1 : a.envelope.id < b.envelope.id ? -1 : 1,
    );
  for (const field of fields) {
    const inFrom = field in fromContent;
    const inTo = field in toContent;
    if (inFrom && !inTo) {
      changes.push({ field, from_summary: fieldSummary(fromContent[field]), to_summary: '', added: false, removed: true, restored_from: null });
      continue;
    }
    if (!inFrom && inTo) {
      changes.push({ field, from_summary: '', to_summary: fieldSummary(toContent[field]), added: true, removed: false, restored_from: null });
      continue;
    }
    const fromText = canonicalSerialize(fromContent[field]);
    const toText = canonicalSerialize(toContent[field]);
    if (fromText !== toText) {
      let restoredFrom: { artifact_id: string; version: number } | null = null;
      for (const earlier of earlierRevisions) {
        const earlierContent = contentRecord(earlier);
        if (field in earlierContent && canonicalSerialize(earlierContent[field]) === toText) {
          restoredFrom = { artifact_id: earlier.envelope.id, version: earlier.envelope.version };
        }
      }
      changes.push({ field, from_summary: fieldSummary(fromContent[field]), to_summary: fieldSummary(toContent[field]), added: false, removed: false, restored_from: restoredFrom });
    }
  }
  const statusChange =
    from.envelope.status === to.envelope.status
      ? null
      : { from: from.envelope.status, to: to.envelope.status };

  let exactRestoreOf: { artifact_id: string; version: number } | null = null;
  const toDigest = contentHash(toContent);
  for (const earlier of input.chain ?? []) {
    if (earlier.envelope.id !== to.envelope.id && contentHash(contentRecord(earlier)) === toDigest) {
      exactRestoreOf = { artifact_id: earlier.envelope.id, version: earlier.envelope.version };
      break;
    }
  }

  const core: ProductVmCore = {
    subject_id: to.envelope.id,
    data_source: input.data_source,
    rationale: input.rationale,
    evidence_refs: sortedUnique(input.evidence_refs ?? []),
    uncertainty: input.uncertainty,
    authority: input.authority,
    next_allowed_action: input.next_allowed_action,
  };
  assertValidProductVmCore(core);
  const vm: RevisionDiffVM = {
    core,
    from: {
      artifact_id: from.envelope.id,
      version: from.envelope.version,
      status: from.envelope.status,
      created_at: from.envelope.created_at,
    },
    to: {
      artifact_id: to.envelope.id,
      version: to.envelope.version,
      status: to.envelope.status,
      created_at: to.envelope.created_at,
    },
    revision_range: { from: `${from.envelope.id}@v${String(from.envelope.version)}`, to: `${to.envelope.id}@v${String(to.envelope.version)}` },
    field_changes: changes,
    status_change: statusChange,
    what_changed: revisionNoteOf(to),
    why: [...to.envelope.provenance],
    exact_restore_of: exactRestoreOf,
  };
  assertValidRevisionDiffVM(vm);
  return vm;
}

/** Validate a RevisionDiffVM (throws). */
export function assertValidRevisionDiffVM(value: unknown): asserts value is RevisionDiffVM {
  if (!isPlainObject(value)) {
    throw new Error('revision diff view model must be an object');
  }
  const record = value as Record<string, unknown>;
  const expected = new Set([
    'core',
    'from',
    'to',
    'revision_range',
    'field_changes',
    'status_change',
    'what_changed',
    'why',
    'exact_restore_of',
  ]);
  const keys = Object.keys(record);
  if (keys.length !== expected.size || !keys.every((key) => expected.has(key))) {
    throw new Error('revision diff view model must have the exact P10 field set');
  }
  if (!Array.isArray(record['field_changes'])) {
    throw new Error('revision diff field changes must be an array');
  }
  const fieldNames = (record['field_changes'] as FieldChangeVM[]).map((change) => change.field);
  if (JSON.stringify(fieldNames) !== JSON.stringify(sortedUnique(fieldNames))) {
    throw new Error('revision diff field changes must be sorted by field name (determinism discipline)');
  }
  if (!isNonEmptyString(record['what_changed'])) {
    throw new Error('revision diff must carry its what-changed note');
  }
  const exactRestore = record['exact_restore_of'];
  if (exactRestore !== null && (!isPlainObject(exactRestore) || !isNonEmptyString((exactRestore as Record<string, unknown>)['artifact_id']))) {
    throw new Error('revision diff exact_restore_of must be null or { artifact_id, version }');
  }
}
