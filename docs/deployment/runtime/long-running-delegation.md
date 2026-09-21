# Long-Running Work Delegation

The free-tier plan states it as a hard rule: the control-plane web
deployment must not be used as the hidden long-running worker. The
machine-checked contract is `infra/deployment/src/execution/delegation.ts`
(consumed by the Vercel request budget constants from
`providers/vercel.ts`), pinned by `infra/deployment/test/delegation.test.ts`.

## The rule

**Vercel request lifetime must NEVER own long-running autonomous work.**
The web tier hosts the console and lightweight request/response APIs —
it records task intent, reads state, reports progress. Durable tasks are
delegated to an external worker/body provider; autonomous execution is a
replaceable external body concern (Spirit/Body architecture). The request
runtime is bounded: a conservative **10,000 ms request budget** and the
**60,000 ms Hobby hard cap**.

## The boundary gate

`assertDelegationBoundary(plan)` TYPE-REJECTS, before any work starts:

- a `durable-long-running` task targeting `vercel-request` — the rule
  itself, rejected with the task id and the delegation requirement;
- ANY task targeting `vercel-request` estimated above the request budget;
- any estimate above the Hobby hard cap targeting the request runtime
  (impossible by platform limit — a configuration error, not delegated
  by silence);
- delegated long-running work without a `bodyProviderRef` — delegated
  work must name its body provider (capability-based selection happens
  at summon time).

The policy function `delegationDecision(plan)` is deterministic and
refuses to even express the violation: `durable-long-running` +
`vercel-request` throws; durable work targeting an external body
provider decides `delegate`; durable work targeting the local companion
decides `queue-until-reconnect` (local-only work remains durable and
queues until the local companion reconnects — the user's device is
optional, and its absence is never a silent failure).

## Workload classes

| Class | Definition | Where it may run |
| --- | --- | --- |
| `request-scoped` | Completes well within the request budget; failure simply returns an error to the caller | Inline in the request runtime (within budget), or delegated if the caller prefers |
| `durable-long-running` | Autonomous work whose state must survive request/worker death: builds, migrations of scale, observation sweeps, repair loops | External body provider (cloud/remote) or queued local companion — never the request runtime |

Every durable task persists task identity, plan/work graph, workspace
revision, authority context, body lease, checkpoints, artifacts,
evidence, uncertainty and cost (the task-durability contract of the
execution architecture) — a body crash, provider outage or device
shutdown must not erase the task.

## Scheduled work

Low-frequency maintenance may use Vercel Hobby Cron — as a TRIGGER that
records intent and summons/activates the external worker, not as a
worker itself. Long-running or high-frequency observation and
orchestration belong to the external worker/body provider from the
start.

## Status

NOT_YET_DEPLOYED: no external body provider is provisioned yet. What
exists is the encoded boundary (typed rejections for every violation
class), the deterministic policy, and the body-provider configuration
contract that later waves (P9/P10) will use to register real providers.
The web console waves (P1) consume `assertDelegationBoundary` before
accepting any task-creation intent.
