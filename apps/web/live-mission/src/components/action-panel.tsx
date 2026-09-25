/**
 * The consequential action panel (Work Order P17-C): every action the
 * live-mission surface offers goes through the merged authority-gated
 * action gateway — the UI NEVER mutates state directly. Each action is a
 * form whose hidden inputs are the EXACT typed action envelope built by
 * the pure envelope builders (../actions/envelopes); the form POSTs to
 * the gateway endpoint the architect wires (LIVE_ACTION_ENDPOINT), the
 * gateway re-evaluates CURRENT authority at action time and answers with
 * an evidence-bound receipt.
 *
 * Honest scope:
 *   - ASK resolution flows through the merged AskQueue (resolution
 *     authority = the HUMAN resolver; the queue mints the Decision record).
 *   - execution (summon body), promotion and rollback flow through the
 *     action gateway families body-lifecycle / promotion / rollback.
 *   - package composition has NO merged action-gateway family — the
 *     surface links to the Packages workspace instead of fabricating an
 *     action (recorded for the architect's P18 pass).
 */

import type { LiveObservationData } from '../view-state/live-mission-dto';
import { dataSourceOf } from '../view-state/live-mission-view';
import { shortSha } from '../view-state/live-mission-view';
import { LIVE_ACTION_ENDPOINT } from '../actions/envelopes';
import { Card } from '../../../shell/components/card';
import { ValueChip } from '../../../shell/components/chips';
import { AuthorityGateNote, LiveBadge, SourceStateChip } from './shared';

function ActionForm({
  actionKey,
  title,
  description,
  envelope,
  submitLabel,
  requiredGrant,
  family,
  disabledReason,
}: {
  actionKey: string;
  title: string;
  description: string;
  envelope: Record<string, unknown>;
  submitLabel: string;
  requiredGrant: string;
  family: string;
  disabledReason?: string;
}) {
  return (
    <li className="rounded-lg border border-line bg-surface p-3">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-soft">{description}</p>
      <form method="post" action={LIVE_ACTION_ENDPOINT} data-action-form={actionKey} className="mt-3">
        <input type="hidden" name="action" value={JSON.stringify(envelope)} />
        <button
          type="submit"
          disabled={disabledReason !== undefined}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          title={disabledReason}
        >
          {submitLabel}
        </button>
        {disabledReason !== undefined ? (
          <p className="mt-2 text-xs text-ink-soft" role="note">
            {disabledReason}
          </p>
        ) : null}
      </form>
      <AuthorityGateNote requiredGrant={requiredGrant} family={family} />
    </li>
  );
}

export function ActionPanel({ data }: { data: LiveObservationData }) {
  const source = dataSourceOf(data);
  const head = data.repository.branchHeads.find((branch) => branch.branch === 'main') ?? data.repository.branchHeads[0];
  const deployment = data.deployments.byEnvironment.find((entry) => entry.environment === 'production') ?? data.deployments.byEnvironment[0];
  const deployedAt = deployment !== undefined ? ` (currently deployed: ${shortSha(deployment.revision)})` : '';
  return (
    <Card id="live-mission-actions" title="Consequential actions" chip={<LiveBadge storeRef={source.store_ref} asOf={source.as_of} />}>
      <p className="text-sm text-ink-soft">
        Every action below goes through the authority-gated action gateway — the UI never mutates state directly. Authority is re-evaluated at action time; a revoked,
        expired or never-held grant fails CLOSED. Replay is idempotent (the same idempotency key returns the recorded original receipt).
      </p>
      <ul className="mt-3 space-y-3">
        <ActionForm
          actionKey="summon-body"
          title="Summon an execution body"
          description={`Lease a body for the current work on ${head !== undefined ? head.branch : 'the repository'}${head !== undefined ? ` (head ${shortSha(head.head)})` : ''}. The lease is ephemeral; the task, checkpoints and evidence survive body replacement.`}
          envelope={{
            family: 'body-lifecycle',
            actor: { kind: 'human', id: 'console-user' },
            targetRevision: { kind: 'source', sha: head?.head ?? 'unknown-head' },
            payload: { family: 'body-lifecycle', bodyLifecycle: { bodyId: 'cloud-sandbox-1', operation: 'start' } },
          }}
          submitLabel="Summon body"
          requiredGrant="body-lifecycle start for the chosen body"
          family="body-lifecycle"
          disabledReason={
            head === undefined
              ? 'No observed repository head yet — the envelope needs the exact source revision to act on (never fabricated).'
              : undefined
          }
        />
        <ActionForm
          actionKey="promotion"
          title="Promote the verified revision"
          description={`Promote ${head !== undefined ? shortSha(head.head) : 'the observed revision'} from staging to production${deployedAt}.`}
          envelope={{
            family: 'promotion',
            actor: { kind: 'human', id: 'console-user' },
            targetRevision: { kind: 'source', sha: head?.head ?? 'unknown-head' },
            payload: { family: 'promotion', promotion: { fromEnvironment: 'staging', toEnvironment: 'production', sourceSha: head?.head ?? 'unknown-head' } },
          }}
          submitLabel="Promote"
          requiredGrant="promotion into the target environment"
          family="promotion"
          disabledReason={
            head === undefined
              ? 'No observed repository head yet — promotion needs the exact verified source revision.'
              : undefined
          }
        />
        <ActionForm
          actionKey="rollback"
          title="Roll back production"
          description={`Roll the production environment back to the last known-good revision${deployment !== undefined ? ` (currently ${shortSha(deployment.revision)})` : ''}. The gateway's rollback verifier records what it actually observed — UNKNOWN stays UNKNOWN.`}
          envelope={{
            family: 'rollback',
            actor: { kind: 'human', id: 'console-user' },
            targetRevision: { kind: 'source', sha: deployment?.revision ?? 'unknown-deployment' },
            payload: {
              family: 'rollback',
              rollback: {
                deploymentId: 'current-production',
                fromSourceSha: deployment?.revision ?? 'unknown-deployment',
                toSourceSha: head?.head ?? 'unknown-head',
                reason: { code: 'MANUAL_DIRECTIVE', detail: 'Console-initiated rollback from the live-mission surface' },
              },
            },
          }}
          submitLabel="Roll back"
          requiredGrant="rollback for the affected deployment"
          family="rollback"
          disabledReason={
            deployment === undefined
              ? 'No observed production deployment yet — rollback needs the exact deployment to roll back.'
              : undefined
          }
        />
      </ul>

      <div className="mt-4 rounded-lg border border-line bg-surface p-3">
        <p className="text-sm font-medium text-ink">Resolve a pending ASK</p>
        <p className="mt-1 text-sm text-ink-soft">
          Pending asks are resolved by HUMAN authority through the merged ASK queue — the resolution becomes a Decision record bound to the ask&apos;s exact input digest.
          The endpoint is wired by the architect&apos;s integration pass (the same gateway mount).
        </p>
        <p className="mt-2 flex flex-wrap gap-1.5">
          <ValueChip label="authority" value="human resolver" />
          <ValueChip label="outcome" value="Decision record (minted by the queue)" />
        </p>
      </div>

      <div className="mt-3 rounded-lg border border-line bg-surface p-3">
        <p className="text-sm font-medium text-ink">Package composition</p>
        <p className="mt-1 text-sm text-ink-soft">
          Package composition has no action-gateway family in the merged contracts — rather than fabricate an action, this surface links the existing Packages
          workspace (compositions carry their own independent evidence there).
        </p>
        <p className="mt-3">
          <a href="/packages" className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-surface-warm">
            Open the Packages workspace
          </a>
        </p>
      </div>

      <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        Observation feeds these actions: <SourceStateChip state={data.sources.some((entry) => entry.state === 'CONNECTED') ? 'CONNECTED' : 'UNKNOWN'} />
        <span>the acted-on revisions above come from the live projections{data.drainedAt !== null ? ` (drained ${data.drainedAt})` : ' (no drain yet — actions stay disabled until observed)'}</span>
      </p>
    </Card>
  );
}
