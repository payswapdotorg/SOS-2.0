# @sos-2/live-store — durable, provider-neutral live state (Work Order P2)

Durable, provider-neutral repositories for the live SOS 2.0 product state,
plus the provider PORTS for the free-tier reference stack and a complete
in-memory reference implementation.

## Repository ports + in-memory reference

Support list (spec/productization-work-orders/P2-live-data-api.md):

| Repository | Record (verbatim shape of the owning package) | id | revision |
| --- | --- | --- | --- |
| `missions` | `MissionArtifact` (@sos-2/mission) | `envelope.id` | `envelope.version` |
| `contexts` | `ContextArtifact` (@sos-2/context) | `envelope.id` | `envelope.version` |
| `systemStates` | `SystemStateArtifact` (@sos-2/system-state) | `envelope.id` | `envelope.version` |
| `evidence` | `EvidenceRecordW3` (@sos-2/evidence) — immutable | `id` | none (content-addressed) |
| `architecture` | `ArchitectureGraphArtifact` (@sos-2/architecture) | `envelope.id` | `envelope.version` |
| `candidates` | `CandidateStateFixture` (@sos-2/experiments) | `envelope.id` | `envelope.version` |
| `assurance` | `AssuranceCaseArtifact` (@sos-2/assurance) | `envelope.id` | `envelope.version` |
| `experiments` | `ExperimentArtifact` (@sos-2/experiments) | `envelope.id` | `envelope.version` |
| `decisions` | `DecisionRecord` (@sos-2/decision) | `envelope.id` | `envelope.version` |
| `authorityGrants` | `AuthorityGrantArtifact` (@sos-2/authority) | `envelope.id` | `envelope.version` |
| `packages` | `PackageArtifact` (@sos-2/packages) | `envelope.id` | `envelope.version` |
| `history.memories` | `ArchitectureMemoryArtifact` (@sos-2/memory) | `envelope.id` | `envelope.version` |
| `history.hypotheses` | `CausalHypothesisArtifact` (@sos-2/causal) | `envelope.id` | `envelope.version` |
| `developmentState` | `DevelopmentStateRecord` (execution fabric) | `state_id` | `revision` |
| `tasks` | `TaskRecord` (the §6 task-durability shape) | `task_id` | `revision` |
| `bodyLeases` | `BodyLeaseRecord` (execution fabric) | `lease_id` | `revision` |
| `observationEvents` | `ObservationEventRecord` (execution fabric) — immutable | `id` | none |

DOMAIN RECORD SHAPES ARE NEVER REDEFINED: every put/get validates through
the OWNING PACKAGE's own assert (consumed verbatim) and the store returns
the record it was given — semantic ids and exact revisions preserved,
never re-minted, never rewritten. Round-trip equality is pinned on the
spine's canonical serialization.

## Semantic discipline (each rule pinned by tests)

- **Idempotent writes** — replaying a byte-identical write (canonical
  equality) is a no-op returning the STORED record (`IDENTICAL`), not an
  error, not a duplicate.
- **Stale-revision detection** — a write whose revision is older than the
  stored revision fails with a typed `CONFLICT` carrying the CURRENT
  revision (optimistic concurrency). `expected_revision` adds
  compare-and-set; a lost durable race surfaces typed, never silently.
- **Same-revision lifecycle transitions** — the spine's id-preserving
  `withStatus` semantics store without a version bump.
- **Immutable flat records** — different content under a stored id is a
  typed `IMMUTABLE_COLLISION` (deterministic content addressing makes that
  a tamper or forced collision).
- **Durable task/checkpoint records** — the full §6 shape:
  task identity + mission link, plan/work graph, owned revisions, authority
  context, body lease ref, checkpoints, artifacts (content-addressed in the
  object store), observations, unresolved uncertainty, retries/recovery,
  resource usage, final verification. A body crash, provider outage or user
  computer shutdown never erases the task (pinned: the lease ends, the task
  survives).
- **Event ingestion with replay protection** — every event carries an id;
  duplicate delivery is detected against the DURABLE event index and
  answered with a typed `DUPLICATE` (with the FIRST receipt), never
  double-applied. The coordination layer's idempotency keys are a fast path
  only — a "seen" answer is never trusted for rejection without the durable
  index (that would make Redis canonical).

## Provider ports (docs/deployment/free-tier-plan.md roles)

| Port | Target | Role |
| --- | --- | --- |
| `PostgresStoreAdapter` | Neon | **durable-canonical-state** — every semantic row lives here and only here |
| `RedisCoordinationAdapter` | Upstash | **coordination-only-never-canonical** — cache, leases, idempotency ONLY; flushable at any time |
| `ObjectStoreAdapter` | Cloudflare R2 | **large-immutable-artifacts** — content-addressed (sha-256) immutable blobs |

No vendor SDK is added in this Work Order: the in-memory reference
implementation satisfies all three ports, and real Neon/Upstash/R2 adapters
attach in later waves as optional peers WITHOUT contract change. Domain
packages never import provider specifics — the boundary is one-directional
(live-store consumes the frozen domain packages; nothing consumes
live-store at this base).

**Redis is never canonical** (pinned by the flush test): after
`flushAll()` — or with the coordination layer removed or FAILING — every
semantic fact remains intact and queryable from the durable store, replay
protection stays correct, lease truth is recomputed from durable records +
the injected clock, and the cache merely repopulates.

## Failure model

`health()` returns typed per-provider availability records —
`AVAILABLE` (probed), `UNAVAILABLE` (configured and failing — never
fabricated success) or `UNKNOWN` (not configured / cannot determine; the
honest state of the in-memory reference backend). Failing provider
operations throw typed `ProviderUnavailableError`.

## Determinism

No `Date.now` / `Math.random` / `fetch` / `process.env` in package src:
clocks are INJECTED (`Clock` port, `ManualClock` for tests,
`formatRfc3339` for deterministic rendering of given instants); listing
order is deterministic (by record id); all tests are offline.

## Usage

```ts
import { createInMemoryLiveStore, ManualClock } from '@sos-2/live-store';

const store = createInMemoryLiveStore({ clock: new ManualClock(Date.parse('2026-01-01T00:00:00Z')) });
const result = await store.missions.put(missionArtifact);
// -> { kind: 'STORED', record } | { kind: 'IDENTICAL', record } | { kind: 'CONFLICT', ... }
```
