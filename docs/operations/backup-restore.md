# Backup and restore

Durable state is backed up on a declared schedule; Redis/queues are
coordination-only and NEVER backup subjects (never canonical — §13).
Losing the cache/coordination layer costs a cold cache, never semantic
state.

## Backup subjects and schedules (the declarations)

| Subject | Role | Frequency | Retention | Restore drills |
| --- | --- | --- | --- | --- |
| `neon-database` | the durable semantic store (missions, tasks, evidence, authority grants, audit events) | every 24h | 14 days | every 7 days |
| `r2-artifacts` | the immutable artifact store (content-addressed artifacts) | every 24h | 30 days | every 14 days |

The schedules are typed declarations (`infra/production-hardening/src/
backup-restore.ts`): a schedule without a declared restore drill is a
typed violation — an untested restore path is a liability.

**Honest status**: the schedules are contracts verified offline; the
real backup jobs (provider APIs) are NOT_YET_CONNECTED. A real
deployment must wire the provider backup adapters and run the drills
before claiming this page as operational.

## The restore procedure (typed, ordered)

Every restore follows the same seven-step procedure — the typed
`RestorationRecord` carries exactly these steps in order:

1. **declare-incident** — record the restoration (who, why, when).
2. **freeze-writes** — stop writers to the damaged store (no split-brain).
3. **select-recovery-point** — pick the recovery snapshot; record its
   identity and the point-in-time it represents.
4. **restore-snapshot** — execute the provider restore.
5. **verify-restored-state** — run the verification battery against the restored store.
   An unverified restore is a claim, not a recovery: `verifiedAfterRestore: true` is REQUIRED by the
   record contract; a record claiming success without verification is a typed violation and must not exist.
6. **resume-writes** — unfreeze writers.
7. **record-restoration** — persist the typed restoration record
   (evidence discipline: exact instants, exact snapshot identity).

## Restore drills

Drills exercise the procedure against a scratch copy on the declared
cadence. A drill is a REAL procedure run with a VERIFIED outcome — it
is recorded as a restoration record with the drill declared in its
provenance. A skipped drill is an operational liability the schedule
contract makes unrepresentable.

## What restores never do

- They never restore Redis/queue state as semantic state (it is
  coordination-only; it rebuilds).
- They never unfreeze writes before verification.
- They never overwrite history: the restoration record is append-only
  evidence.
- They never treat demo fixture data as a recovery source.
