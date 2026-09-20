# @sos-2/deployment

SOS 2.0 Deployment (Work Order W12, parallel slot C). The **deployment
contract**: typed deployment records with a validated lifecycle and
truthful outcome bookkeeping, plus a deterministic simulator for
evaluation.

## What lives here

| Export | Purpose |
| --- | --- |
| `DeploymentRecord` | a Semantic Spine envelope (extension kind `DeploymentRecord`, registered through the spine's add-only API — the W3/W8 precedent) + the exact content: `deployment_id`, `environment`, **exact `artifact_revision`** (an `ExactRevision` consumed from `@sos-2/system-state`; kind `git-sha` or `config-version`), `target_runtime` (typed ref: id + kind + version, structurally compatible with `@sos-2/runtimes`), `configuration` (JSON object) and the **declared `rollback`** |
| `DeploymentRollbackDeclaration` | mechanism + trigger + authority **MIRRORING the recovery-control declarations by CONSUMING them**: the mechanism/trigger validators, the governed-exception record and the boundedness policy are `@sos-2/recovery-control`'s own — an `UNSPECIFIED` mechanism without a governed exception is REJECTED exactly as W8 rejects it (§13) |
| `DEPLOYMENT_LIFECYCLE` | `PLANNED -> DEPLOYED -> ROLLED_BACK`, carried by the envelope statuses (`DRAFT -> ACTIVE -> RETIRED`), a strictly narrower subset of the spine's legal transitions: `PLANNED -> ROLLED_BACK` is forbidden (you cannot roll back what was never deployed); `ROLLED_BACK` is terminal; identity is preserved across transitions |
| `DeploymentStore` | records + validated `deploy()`/`rollback()` transitions (logged with caller-supplied instant + provenance) + outcome bookkeeping + `statusOf()` |
| `DeploymentOutcome` | failures **preserve truth states**: outcomes carry the frozen 6 states; `statusOf` is the documented severity-lattice aggregation — `FAILURE > PARTIAL > UNKNOWN > UNAVAILABLE > UNSUPPORTED > SUCCESS` — and a deployment with no outcomes is `UNAVAILABLE` (a gap) |
| `simulateDeployment` | the deterministic deployment simulator: fixed seed, `mulberry32` **consumed from `@sos-2/experiments`**, fixed draw order (three draws per step, always drawn), bit-identical runs for identical input |
| `asInterventionEvidenceInput` | deploying IS an intervention: REAL outcomes mint `INTERVENTIONAL` evidence inputs with verbatim availability; **simulated outcomes are NEVER intervention evidence** (refused loudly — the W9 discipline) |

## Failures preserve truth states

`statusOf(deployment)` reports the truthful availability:

- no recorded outcomes → `UNAVAILABLE` — a gap; never zero, never
  absence-of-failure (the architecture-lock forbidden shortcut);
- any `UNKNOWN` observation keeps the deployment `UNKNOWN` — **never
  reported as SUCCESS or FAILURE** (pinned by tests using the spine's own
  `assertTruthStateIs`);
- a known `FAILURE` dominates; `SUCCESS` is the aggregation identity.

Simulated outcomes are **refused** by the store as real deployment status
and **refused** by the intervention-evidence bridge — simulation is
evaluation infrastructure, marked `simulated: true` with the simulator
version and the exact seed in provenance.

## Layering

```
@sos-2/semantic-spine    ─┐
@sos-2/provenance        ─┤
@sos-2/system-state      ─┼──  @sos-2/deployment  (this package)
@sos-2/recovery-control  ─┤     (dev-only: @sos-2/evidence for the
@sos-2/experiments       ─┘      intervention-evidence bridge tests)
```
