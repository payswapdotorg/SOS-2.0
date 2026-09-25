# @sos-2/deployment-providers — Real Deployment Providers (Work Order P17-A)

The real **Vercel** deployment provider surface wired through the
**existing deployment contracts** (the frozen `@sos-2/deployment`
surface + the P3 registrar contract shape):

- **Real API operations** (`src/vercel-api.ts`): the token probe
  (`GET /v2/user`), team discovery (`GET /v2/teams`), project
  discovery/creation (`GET /v9/projects`, `POST /v10/projects` with the
  git repository link + the `apps/web` rootDirectory + the `nextjs`
  preset per the P3 vercel contract), project profile patches
  (`PATCH /v9/projects`), deployments from an **exact git ref**
  (`POST /v13/deployments` with `gitSource {type:'github', repoId,
  ref:<40-hex sha>}` — the protocol verified against the real API: the
  response echoes `gitSource.sha`), deployment state reads
  (`GET /v13/deployments/{id}`) and the deployments list
  (`GET /v6/deployments`).
- **Records minted through the frozen contracts**
  (`src/vercel-provider.ts`): every deployment mints a
  `DeploymentRecord` through the frozen `createDeployment`
  (`artifact_revision` = `ExactRevision` kind `git-sha` bound to the
  EXACT `source_revision_sha` of the deployed head — verified against
  the provider's observed commit sha; a mismatch is a FAILURE outcome,
  never a fabricated binding), a `DeploymentRevisionRecord` per the P3
  registrar shape (rollback pointers), and a truthful
  `DeploymentOutcome` (READY → SUCCESS; ERROR/CANCELED → FAILURE;
  still building at timeout → UNKNOWN — never fabricated either
  direction).
- **Honest provider states**: `CONNECTED/UNKNOWN/UNAVAILABLE/DEGRADED`
  from REAL probes only (the P17 lane vocabulary); a fabricated
  CONNECTED report is a typed violation.
- **The P17-A connectivity profile** (verified against the real API on
  this lane's provisioned project): the monorepo dependency-closure
  build command (`pnpm --filter @sos-2/web^... run build && pnpm run
  build` — the workspace packages ship no dist to git) and public
  preview URLs (`ssoProtection: null`).

## Discipline

- **One HTTP seam** (`src/http.ts`): every network call goes through
  the injectable FetchPort; the transcript-recording wrapper
  (`src/recording-fetch.ts`) captures every real round-trip redacted
  (Authorization → the `VERCEL_TOKEN` env-name reference).
- **Env-only credentials** (`src/environment.ts`): P3 registry names
  (`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID`); values never
  appear in outcomes, notes, transcripts or evidence.
- **P3 contracts carried structurally** (`src/infra-vocabulary.ts`):
  the vercel project scope + regions + the revision-record contract,
  mirrored field-for-field; alignment pinned by test in
  `tests/real-persistence` (non-literal dynamic imports — the P17-B
  pinning precedent).
- **Rollback declarations follow the W12 fixture discipline**:
  `ROLLBACK_DEPLOYMENT` to the previous revision when one exists, else
  a documented `CUSTOM_PROCEDURE` (the Vercel redeploy-previous-revision
  procedure) — never an UNSPECIFIED mechanism; a MANUAL trigger with a
  deterministically-minted AuthorityGrant spine id
  (`VERCEL_ROLLBACK_AUTHORITY`).
- **Zero external dependencies**; no ambient env/clock/network in
  package src (pinned by `test/structure.test.ts`).

The deterministic suites live in `tests/real-persistence`; the
env-gated real deployment journey (`RUN_REAL=1`) deploys `apps/web`
from the exact branch head and records honest evidence.
