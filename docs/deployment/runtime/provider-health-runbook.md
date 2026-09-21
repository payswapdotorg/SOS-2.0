# Provider Health Diagnostics Runbook

Provider outages remain truthful unknown/unavailable states — a provider
with no observation is UNKNOWN, never optimistically HEALTHY. The
machine-checked contract is `infra/deployment/src/health/diagnostics.ts`,
pinned by `infra/deployment/test/health.test.ts`.

## The four statuses (frozen vocabulary)

| Status | Meaning | When it may appear |
| --- | --- | --- |
| `UNKNOWN` | No observation yet — the default state | Always the initial state; the aggregate whenever no probe ran or any probe is UNKNOWN |
| `UNAVAILABLE` | Reachability-checked and not usable | Any UNAVAILABLE probe report |
| `DEGRADED` | Usable with impairments (latency, partial capability loss) | Any DEGRADED probe report (no UNAVAILABLE) |
| `HEALTHY` | Observed working — complete positive evidence | ONLY with at least one probe report AND every probe HEALTHY |

The aggregation is deterministic and fail-closed:
`UNAVAILABLE > DEGRADED > HEALTHY`, with UNKNOWN sticky — any UNKNOWN
probe keeps the aggregate UNKNOWN even alongside HEALTHY probes. A
fabricated HEALTHY (a health record claiming HEALTHY without complete
supporting reports) is a typed contract violation rejected by
`validateProviderHealth`, not a warning.

## Probes are injected, never ambient

The probe runner (`runProviderHealthCheck`) takes caller-supplied probe
functions and an injected clock. The library itself performs **zero**
network operations. Today, with no validation accounts, the only honest
probe results are fixture-based (offline tests with fake providers); the
real probes — REST pings, quota checks, connectivity checks — arrive with
real credentials in later waves, wired as injectable probe functions,
never as ambient calls inside the library.

Current honest default: `unprobedProviderHealth(provider)` returns
UNKNOWN with the note "validation account pending (NOT_YET_DEPLOYED)".

## Runbook

**Routine (once real probes exist):** observation-plane probes run on a
schedule (low frequency — Vercel Hobby Cron or the external worker,
respecting the delegation boundary) and feed the health tracker. Each
provider carries at least two independent probes where possible
(e.g. Neon: TCP reachability + a trivial read query) so a single
transient failure does not silently mask a real outage.

**On provider incident:**

1. Record the observed probe outcomes into the tracker — status becomes
   UNAVAILABLE or DEGRADED from evidence, never from assumption.
2. System State reflects the provider's status truthfully; features
   depending on the provider surface the uncertainty (the product rules
   forbid hiding outage states).
3. Do NOT "fix" a status by editing records — statuses change only
   through new probe observations (the tracker API has no other path).
4. For Redis (never canonical): an UNAVAILABLE Upstash degrades
   performance, never correctness — verify no component treats Redis as
   the source of truth (the never-canonical gate rejects such
   declarations at configuration time).

**On recovery:** probes observe the recovery; the tracker appends the new
observation (history is retained — the transition sequence itself is
evidence). HEALTHY returns only when every probe reports HEALTHY.

**On unknown-ness:** partial evidence (one probe HEALTHY, one UNKNOWN)
aggregates to UNKNOWN — treat UNKNOWN as "not currently vouched for",
and investigate before relying on the provider.
