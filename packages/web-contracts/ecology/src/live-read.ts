/**
 * The live-state read adapter (Work Order P10) — the ONLY impure module of
 * the ecology subpath, and it is I/O only: it READS records through
 * @sos-2/live-store repositories (the durable, provider-neutral ports
 * delivered by Work Order P2) and returns them for the PURE projections.
 * It contains ZERO domain logic: no validation, no interpretation, no
 * mutation — the store validates writes through the owning packages' own
 * asserts (consumed), and this adapter only reads.
 *
 * spec/productization-work-orders/P10-package-history-evolution.md
 * acceptance: "self-evolution reads canonical live state". The evolution,
 * history and packages surfaces read their records through THESE
 * repository calls — never from fixture objects directly. In this build
 * the console composes the deterministic in-memory REFERENCE backend
 * (seeded once with the clearly-labelled DEMO dataset through the very
 * same repository `put` calls — every seed write is validated by the
 * owning package's assert); a real provider-backed store attaches behind
 * the same ports in a later wave WITHOUT changing any read or projection.
 *
 * Artifact families that are NOT live-store repository families at this
 * base (PackageComposition, MetaProcess, MetaChange — the P2 support list
 * does not include them) are read from the DEMO-labelled fixture and
 * surfaced with an explicit state block; they are never passed off as
 * live state.
 */

import type { ArchitectureGraphArtifact } from '@sos-2/architecture';
import type { AssuranceCaseArtifact } from '@sos-2/assurance';
import type { AuthorityGrantArtifact } from '@sos-2/authority';
import type { CausalHypothesisArtifact } from '@sos-2/causal';
import type { ContextArtifact } from '@sos-2/context';
import type { DecisionRecord } from '@sos-2/decision';
import type { EvidenceRecordW3 } from '@sos-2/evidence';
import type { CandidateStateFixture, ExperimentArtifact } from '@sos-2/experiments';
import type { ArchitectureMemoryArtifact } from '@sos-2/memory';
import type { MissionArtifact } from '@sos-2/mission';
import type { PackageArtifact } from '@sos-2/packages';
import type { SystemStateArtifact } from '@sos-2/system-state';
import { createInMemoryLiveStore } from '@sos-2/live-store';
import type {
  DevelopmentStateRecord,
  LiveStore,
} from '@sos-2/live-store';
import type { DemoEcologyWorld } from './demo/demo-ecology-world.js';

/** The read result: every family the ecology/history/evolution surfaces consume. */
export interface EcologyLiveReadResult {
  /** The durable-store reference the records were read from (never a queue). */
  store_ref: string;
  /** The repository families that were read, with their record counts. */
  families_read: { family: string; count: number }[];
  /** The read instant/revision token (caller-supplied; never a hidden clock). */
  as_of: string;
  missions: MissionArtifact[];
  contexts: ContextArtifact[];
  system_states: SystemStateArtifact[];
  evidence: EvidenceRecordW3[];
  architecture: ArchitectureGraphArtifact[];
  candidates: CandidateStateFixture[];
  assurance: AssuranceCaseArtifact[];
  experiments: ExperimentArtifact[];
  decisions: DecisionRecord[];
  authority_grants: AuthorityGrantArtifact[];
  packages: PackageArtifact[];
  memories: ArchitectureMemoryArtifact[];
  hypotheses: CausalHypothesisArtifact[];
  development_state: DevelopmentStateRecord[];
}

/** The reference store id of the demo-seeded backend (honest provenance). */
export const DEMO_ECOLOGY_STORE_REF = 'in-memory-reference://demo-ecology-seed';

async function putAll<R>(repository: { put(record: R): Promise<unknown> }, records: readonly R[]): Promise<void> {
  for (const record of records) {
    const result = await repository.put(record);
    if (!('kind' in (result as Record<string, unknown>))) {
      throw new Error('live-store seed write returned an untyped result');
    }
  }
}

/**
 * Seed the DEMO ecology dataset into a live store through the repositories'
 * own `put` calls (every write is validated by the owning package's assert —
 * the seed itself proves the records are store-shaped). Deterministic: the
 * same world always produces the same store state.
 */
export async function seedDemoEcologyStore(store: LiveStore, world: DemoEcologyWorld): Promise<LiveStore> {
  await putAll(store.missions, world.base.missions);
  await putAll(store.systemStates, world.base.system_states);
  await putAll(store.evidence, [
    ...world.base.evidence,
    ...world.composition_evidence,
    ...world.evolution_evidence,
  ]);
  await putAll(store.packages, [...world.packages, world.meta_strategy_package]);
  await putAll(store.history.memories, [world.failure_memory]);
  await putAll(store.history.hypotheses, [world.hypothesis]);
  await putAll(store.developmentState, [world.development_state]);
  await putAll(store.experiments, [world.base.experiment.artifact]);
  await putAll(store.candidates, world.base.candidates);
  await putAll(store.decisions, [world.base.ask.decision]);
  await putAll(store.authorityGrants, [
    world.base.grants.mission_revision,
    world.base.grants.promotion,
    world.base.grants.retirement,
  ]);
  return store;
}

/**
 * Build the DEMO-backed live store: the deterministic in-memory reference
 * backend seeded through the repository writes (validated by the owning
 * packages). Real provider adapters attach behind the same ports later
 * WITHOUT contract change.
 */
export async function createDemoEcologyLiveStore(world: DemoEcologyWorld): Promise<LiveStore> {
  const store = createInMemoryLiveStore();
  return seedDemoEcologyStore(store, world);
}

/**
 * Read the ecology/history/evolution record families through the
 * @sos-2/live-store repositories (the ONLY read path of the P10 surfaces).
 * Deterministic: repository lists are ordered by record id; `as_of` is
 * caller-supplied (the demo passes the fixture instant; a live deployment
 * passes its read revision token) — never a hidden clock.
 */
export async function readEcologyLiveState(
  store: LiveStore,
  options: { store_ref: string; as_of: string },
): Promise<EcologyLiveReadResult> {
  const [missions, contexts, systemStates, evidence, architecture, candidates, assurance, experiments, decisions, authorityGrants, packages, memories, hypotheses, developmentState] =
    await Promise.all([
      store.missions.list(),
      store.contexts.list(),
      store.systemStates.list(),
      store.evidence.list(),
      store.architecture.list(),
      store.candidates.list(),
      store.assurance.list(),
      store.experiments.list(),
      store.decisions.list(),
      store.authorityGrants.list(),
      store.packages.list(),
      store.history.memories.list(),
      store.history.hypotheses.list(),
      store.developmentState.list(),
    ]);
  return {
    store_ref: options.store_ref,
    as_of: options.as_of,
    families_read: [
      { family: 'missions', count: missions.items.length },
      { family: 'contexts', count: contexts.items.length },
      { family: 'systemStates', count: systemStates.items.length },
      { family: 'evidence', count: evidence.items.length },
      { family: 'architecture', count: architecture.items.length },
      { family: 'candidates', count: candidates.items.length },
      { family: 'assurance', count: assurance.items.length },
      { family: 'experiments', count: experiments.items.length },
      { family: 'decisions', count: decisions.items.length },
      { family: 'authorityGrants', count: authorityGrants.items.length },
      { family: 'packages', count: packages.items.length },
      { family: 'history.memories', count: memories.items.length },
      { family: 'history.hypotheses', count: hypotheses.items.length },
      { family: 'developmentState', count: developmentState.items.length },
    ],
    missions: missions.items,
    contexts: contexts.items,
    system_states: systemStates.items,
    evidence: evidence.items,
    architecture: architecture.items,
    candidates: candidates.items,
    assurance: assurance.items,
    experiments: experiments.items,
    decisions: decisions.items,
    authority_grants: authorityGrants.items,
    packages: packages.items,
    memories: memories.items,
    hypotheses: hypotheses.items,
    development_state: developmentState.items,
  };
}
