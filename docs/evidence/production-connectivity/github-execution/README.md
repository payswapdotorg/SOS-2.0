# P17-B Evidence — Real GitHub + Execution Connectivity

Machine-readable records for Work Order **P17-B** (branch
`wo/p17b-real-github-execution`). Every record was produced by the
env-gated REAL-provider integration suites (`RUN_REAL=1`) or by honest
probes; nothing here is simulated or fabricated.

| Record | What it proves |
| --- | --- |
| [`github-integration.json`](./github-integration.json) | The REAL GitHub journey through the frozen `GitHubPort` contract: PAT-backed real handshake (login `payswapdotorg`, API revision `2022-11-28`), private scratch repository `payswapdotorg/sos-connectivity-scratch` (created → discovered with empty detection → initial commit → snapshot import at the exact SHA → probe branch → Git Data API single-commit → pull request #1 → state read → close → repository deleted). 27 real API requests, exact SHAs, URLs and timestamps; credentials are env NAMES only. |
| [`real-body-execution.json`](./real-body-execution.json) | The REAL cloud execution body behind the frozen §9 HarnessContract: a durable bounded task (lease → work program → REAL OpenRouter model calls (`qwen/qwen3-coder-flash`, 296 prompt + 268 completion tokens) → §9 evidence collection (git status, workspace reads, durable content-addressed artifacts, checkpoint) → NON-AUTHORITATIVE body completion report (task stays RUNNING) → INDEPENDENT evaluation that EXECUTED the generated test under node (exit 0, verdict PASS) → Spirit-side completion. `user_computer_required: false` (placement cloud; egress allowlist carries only the model provider; zero device probes). |
| [`provider-states.json`](./provider-states.json) | The honest provider states: GitHub CONNECTED, hosted-harness-body CONNECTED, Composio UNAVAILABLE (the optional stretch was not reached — the Composio endpoints are network-unreachable from the execution environment; recorded honestly, never fabricated). Includes the honest model-selection notes (in-region routing constraints). |
| [`ARCHITECTURE-DELTA.json`](./ARCHITECTURE-DELTA.json) | The architecture delta for the lane (validates against `spec/contracts/architecture-delta.schema.json`; work_order `P17-B`). |

The deterministic reference-mode suites (offline, fixed seed 424242)
live in `tests/real-github` and `tests/real-bodies`; they pin the
frozen-contract compliance (the P4 structural vocabulary alignment, the
honest connection discipline, the error/state mapping, body
replaceability, the lease/checkpoint interplay and the §10
self-certification ban) without any network.
