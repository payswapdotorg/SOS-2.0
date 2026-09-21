/**
 * The rationale view — answers the six product review questions
 * (ARCHITECT_START_HERE.md) for any spine subject, with the typed trace
 * links and the exact evidence records (each with its distinct truth
 * state). Unknown or unlinked subjects render an honest state block,
 * never a blank page.
 */

import Link from 'next/link';
import type { RationaleViewVM } from '@sos-2/web-contracts';
import { productReviewQuestionLabel } from '@sos-2/web-contracts';
import { TruthStateChip } from './chips';
import { DemoBadge } from './demo-badge';
import { rationaleHref, views } from '../view-state/demo-data';

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

export function RationaleView({ vm }: { vm: RationaleViewVM }) {
  return (
    <article aria-label={`Rationale: ${vm.subject_label}`} data-rationale-subject={vm.subject_id}>
      <p className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-line bg-surface-warm px-2 py-0.5 font-mono text-xs text-ink-soft">{vm.subject_id}</span>
        <DemoBadge revision={views.source.kind === 'DEMO' ? views.source.fixture_revision : undefined} />
      </p>

      <div className="mt-4 space-y-3">
        <section aria-labelledby="rationale-what-is-happening" className="rounded-xl border border-line bg-surface p-4 sm:p-5">
          <h2 id="rationale-what-is-happening" className="text-sm font-semibold text-ink">
            {productReviewQuestionLabel('WHAT_IS_HAPPENING')}
          </h2>
          <p className="mt-1 text-sm text-ink">{vm.answers.WHAT_IS_HAPPENING}</p>
        </section>

        <section aria-labelledby="rationale-why" className="rounded-xl border border-line bg-surface p-4 sm:p-5">
          <h2 id="rationale-why" className="text-sm font-semibold text-ink">
            {productReviewQuestionLabel('WHY_DOES_SOS_BELIEVE_THIS')}
          </h2>
          <p className="mt-1 text-sm text-ink">{vm.answers.WHY_DOES_SOS_BELIEVE_THIS}</p>
          {vm.upstream_links.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm">
              {vm.upstream_links.map((link) => (
                <li key={`${link.source}-${link.target}-${link.type}`} className="text-ink-soft">
                  <Link href={rationaleHref(link.source)} className="font-mono text-xs underline-offset-2 hover:underline">
                    {link.source}
                  </Link>{' '}
                  {LINK_TYPE_LABELS[link.type] ?? link.type}{' '}
                  <Link href={rationaleHref(link.target)} className="font-mono text-xs underline-offset-2 hover:underline">
                    {link.target}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {vm.downstream_links.length > 0 ? (
            <details className="mt-3">
              <summary className="min-h-[44px] cursor-pointer list-none text-sm font-medium text-epistemic">
                Consequences ({String(vm.downstream_links.length)})
              </summary>
              <ul className="mt-2 space-y-1 text-sm">
                {vm.downstream_links.map((link) => (
                  <li key={`${link.source}-${link.target}-${link.type}`} className="text-ink-soft">
                    <Link href={rationaleHref(link.source)} className="font-mono text-xs underline-offset-2 hover:underline">
                      {link.source}
                    </Link>{' '}
                    {LINK_TYPE_LABELS[link.type] ?? link.type}{' '}
                    <Link href={rationaleHref(link.target)} className="font-mono text-xs underline-offset-2 hover:underline">
                      {link.target}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        <section aria-labelledby="rationale-evidence" className="rounded-xl border border-line bg-surface p-4 sm:p-5">
          <h2 id="rationale-evidence" className="text-sm font-semibold text-ink">
            {productReviewQuestionLabel('WHAT_EVIDENCE_SUPPORTS_IT')}
          </h2>
          <p className="mt-1 text-sm text-ink">{vm.answers.WHAT_EVIDENCE_SUPPORTS_IT}</p>
          {vm.evidence.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {vm.evidence.map((record) => (
                <li key={record.evidence_id} className="flex flex-wrap items-center gap-2 text-sm">
                  <TruthStateChip state={record.availability} />
                  <span className="text-ink">{record.kind}</span>
                  <Link href={rationaleHref(record.evidence_id)} className="font-mono text-xs text-ink-soft underline-offset-2 hover:underline">
                    {record.evidence_id}
                  </Link>
                  {record.llm_output ? <span className="text-xs text-warn">model output — never authoritative</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">No evidence records are linked to this subject yet — that is the truthful state.</p>
          )}
        </section>

        <div className="grid gap-3 md:grid-cols-3">
          <section aria-labelledby="rationale-uncertainty" className="rounded-xl border border-dashed border-epistemic/40 bg-epistemic-soft p-4">
            <h2 id="rationale-uncertainty" className="text-sm font-semibold text-epistemic">
              {productReviewQuestionLabel('WHAT_UNCERTAINTY_REMAINS')}
            </h2>
            <p className="mt-1 text-sm text-ink">{vm.answers.WHAT_UNCERTAINTY_REMAINS}</p>
          </section>
          <section aria-labelledby="rationale-authority" className="rounded-xl border border-line bg-surface p-4">
            <h2 id="rationale-authority" className="text-sm font-semibold text-ink">
              {productReviewQuestionLabel('WHAT_AUTHORITY_IS_REQUIRED')}
            </h2>
            <p className="mt-1 text-sm text-ink">{vm.answers.WHAT_AUTHORITY_IS_REQUIRED}</p>
          </section>
          <section aria-labelledby="rationale-next" className="rounded-xl border border-line bg-surface p-4">
            <h2 id="rationale-next" className="text-sm font-semibold text-ink">
              {productReviewQuestionLabel('WHAT_CAN_HAPPEN_NEXT')}
            </h2>
            <p className="mt-1 text-sm text-ink">{vm.answers.WHAT_CAN_HAPPEN_NEXT}</p>
          </section>
        </div>
      </div>
    </article>
  );
}
