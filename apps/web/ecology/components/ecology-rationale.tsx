/**
 * The ecology rationale section — answers the six product review questions
 * for a P10 subject (compositions, process revisions, package revisions,
 * retained memory), with the typed trace links and the exact evidence
 * records. Renders the same RationaleViewVM shape as the P1 rationale
 * page (the view model comes from the frozen core projector; only the
 * layout is owned here).
 */

import Link from 'next/link';
import type { RationaleViewVM } from '@sos-2/web-contracts';
import { productReviewQuestionLabel } from '@sos-2/web-contracts';
import { revisionHrefOf } from '@sos-2/web-contracts/ecology';
import { TruthStateChip } from '../../shell/components/chips';
import { DemoBadge } from '../../shell/components/demo-badge';
import { ecologyViews } from '../view-state/ecology-data';

const LINK_TYPE_LABELS: Record<string, string> = {
  SATISFIES: 'satisfies',
  REALIZES: 'realizes',
  REFINES: 'refines',
  CONSTRAINS: 'constrains',
  IMPLEMENTS: 'implements',
  VERIFIES: 'verifies',
  OBSERVES: 'observes',
  SUPPORTS: 'supports',
  CONTRADICTS: 'contradicts',
  CAUSED_BY: 'caused by',
  CAUSED: 'caused',
  DERIVED_FROM: 'derived from',
  COMPATIBLE_WITH: 'compatible with',
  CONFLICTS_WITH: 'conflicts with',
  COMPOSES: 'composes',
  SPECIALIZES: 'specializes',
  GENERALIZES: 'generalizes',
};

/** A link row (the target routes to the subject's own deep view). */
function LinkRow({ source, target, type, href }: { source: string; target: string; type: string; href: (id: string) => string }) {
  return (
    <li className="text-ink-soft">
      <Link href={href(source)} className="min-h-[44px] font-mono text-xs underline-offset-2 hover:underline">
        {source}
      </Link>{' '}
      {LINK_TYPE_LABELS[type] ?? type}{' '}
      <Link href={href(target)} className="min-h-[44px] font-mono text-xs underline-offset-2 hover:underline">
        {target}
      </Link>
    </li>
  );
}

export async function EcologyRationale({ vm }: { vm: RationaleViewVM }) {
  const views = await ecologyViews();
  const href = (subjectId: string) =>
    views.world.base.links.some((link) => link.source === subjectId || link.target === subjectId)
      ? views.rationaleHref(subjectId)
      : revisionHrefOf(subjectId);
  return (
    <article aria-label={`Rationale: ${vm.subject_label}`} data-rationale-subject={vm.subject_id}>
      <p className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-line bg-surface-warm px-2 py-0.5 font-mono text-xs text-ink-soft">{vm.subject_id}</span>
        <DemoBadge revision={views.world.fixture_revision} />
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {(
          [
            ['WHAT_IS_HAPPENING', vm.answers.WHAT_IS_HAPPENING],
            ['WHY_DOES_SOS_BELIEVE_THIS', vm.answers.WHY_DOES_SOS_BELIEVE_THIS],
            ['WHAT_EVIDENCE_SUPPORTS_IT', vm.answers.WHAT_EVIDENCE_SUPPORTS_IT],
            ['WHAT_UNCERTAINTY_REMAINS', vm.answers.WHAT_UNCERTAINTY_REMAINS],
            ['WHAT_AUTHORITY_IS_REQUIRED', vm.answers.WHAT_AUTHORITY_IS_REQUIRED],
            ['WHAT_CAN_HAPPEN_NEXT', vm.answers.WHAT_CAN_HAPPEN_NEXT],
          ] as const
        ).map(([question, answer]) => (
          <section key={question} aria-labelledby={`rationale-${question}`} className="rounded-xl border border-line bg-surface p-4">
            <h3 id={`rationale-${question}`} className="text-sm font-semibold text-ink">
              {productReviewQuestionLabel(question)}
            </h3>
            <p className="mt-1 text-sm text-ink">{answer}</p>
          </section>
        ))}
      </div>
      {vm.upstream_links.length > 0 ? (
        <details className="mt-4 rounded-xl border border-line bg-surface p-4" open>
          <summary className="min-h-[44px] cursor-pointer list-none text-sm font-semibold text-ink">
            Why (upstream, {String(vm.upstream_links.length)} typed links)
          </summary>
          <ul className="mt-2 space-y-1 text-sm">
            {vm.upstream_links.map((link) => (
              <LinkRow key={`up-${link.source}-${link.target}-${link.type}`} source={link.source} target={link.target} type={link.type} href={href} />
            ))}
          </ul>
        </details>
      ) : null}
      {vm.downstream_links.length > 0 ? (
        <details className="mt-3 rounded-xl border border-line bg-surface p-4">
          <summary className="min-h-[44px] cursor-pointer list-none text-sm font-semibold text-ink">
            Consequences (downstream, {String(vm.downstream_links.length)} typed links)
          </summary>
          <ul className="mt-2 space-y-1 text-sm">
            {vm.downstream_links.map((link) => (
              <LinkRow key={`down-${link.source}-${link.target}-${link.type}`} source={link.source} target={link.target} type={link.type} href={href} />
            ))}
          </ul>
        </details>
      ) : null}
      {vm.evidence.length > 0 ? (
        <section aria-label="Evidence" className="mt-4 rounded-xl border border-line bg-surface p-4">
          <h3 className="text-sm font-semibold text-ink">Evidence ({String(vm.evidence.length)} records, exact truth states)</h3>
          <ul className="mt-2 space-y-2">
            {vm.evidence.map((record) => (
              <li key={record.evidence_id} className="flex flex-wrap items-center gap-2 text-sm">
                <TruthStateChip state={record.availability} />
                <span className="font-mono text-xs text-ink-soft">{record.evidence_id}</span>
                <span className="text-ink-soft">
                  {record.kind}
                  {record.llm_output ? ' — model output, never authoritative' : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
