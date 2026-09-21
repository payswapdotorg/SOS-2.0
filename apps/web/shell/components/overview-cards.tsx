/**
 * The below-hero overview cards: current change, evidence quality,
 * experiment status, package reuse, recent learning. Each card is a
 * consequential surface: DEMO badge, status chips with labels (never
 * color-only), and a rationale deep-link.
 */

import Link from 'next/link';
import { evidenceTruthStateLabel } from '@sos-2/web-contracts';
import type { CurrentChangeSummaryVM, EvidenceQualitySummaryVM, ExperimentStatusSummaryVM, PackageReuseSummaryVM, RecentLearningVM } from '@sos-2/web-contracts';
import { allTruthStates } from '@sos-2/web-contracts';
import { Card, Row } from './card';
import { ConditionChip, TruthStateChip, ValueChip } from './chips';
import { StateBlockView } from './state-block';
import { rationaleHref, views } from '../view-state/demo-data';

const fixtureRevision = views.source.kind === 'DEMO' ? views.source.fixture_revision : undefined;

export function CurrentChangeCard({ vm }: { vm: CurrentChangeSummaryVM }) {
  return (
    <Card
      id="card-current-change"
      title="Current change"
      chip={<ConditionChip condition={vm.rollback_rehearsed ? 'HEALTHY' : 'DEGRADED'} basis={vm.rollback_rehearsed ? 'A timed rollback rehearsal succeeded.' : 'No successful rollback rehearsal is on record.'} />}
      demoRevision={fixtureRevision}
      rationaleHref={rationaleHref(vm.candidate_id)}
    >
      <p className="text-sm font-medium text-ink">{vm.title}</p>
      <ul className="mt-2 list-inside list-disc text-sm text-ink-soft">
        {vm.predicted_effects.map((effect) => (
          <li key={effect}>{effect}</li>
        ))}
      </ul>
      <p className="mt-3 flex flex-wrap gap-1.5">
        <ValueChip label="confidence" value={vm.confidence_class} title={vm.core.uncertainty.statement} />
        <ValueChip label="rollback rehearsed" value={vm.rollback_rehearsed ? 'yes' : 'no'} />
        {vm.experiment_ref !== null ? <ValueChip label="experiment" value="canary at 10%" title="Open the Experiments page for stages and guardrails." /> : null}
      </p>
      <p className="mt-3">
        <Link href="/changes" className="inline-flex min-h-[44px] items-center rounded-md px-1 text-sm font-medium text-epistemic underline-offset-2 hover:underline">
          Open the change story
        </Link>
      </p>
    </Card>
  );
}

export function EvidenceQualityCard({ vm }: { vm: EvidenceQualitySummaryVM }) {
  return (
    <Card
      id="card-evidence-quality"
      title="Evidence quality"
      chip={<ValueChip label="records" value={String(vm.total)} />}
      demoRevision={fixtureRevision}
      rationaleHref={rationaleHref(vm.core.subject_id)}
    >
      <ul className="flex flex-wrap gap-1.5" aria-label="Counts per truth state">
        {allTruthStates().map((state) => (
          <li key={state} className="flex items-center gap-1.5">
            <TruthStateChip state={state} />
            <span className="text-sm font-semibold text-ink">{String(vm.counts[state])}</span>
          </li>
        ))}
      </ul>
      {vm.llm_analysis_count > 0 ? (
        <p className="mt-3 text-xs text-ink-soft">
          {String(vm.llm_analysis_count)} analysis record{vm.llm_analysis_count === 1 ? ' is' : 's are'} model output — retained, never authoritative.
        </p>
      ) : null}
      {vm.coverage_block !== null ? <div className="mt-3"><StateBlockView block={vm.coverage_block} /></div> : null}
      <p className="mt-3">
        <Link href="/evidence" className="inline-flex min-h-[44px] items-center rounded-md px-1 text-sm font-medium text-epistemic underline-offset-2 hover:underline">
          Open Evidence
        </Link>
      </p>
    </Card>
  );
}

export function ExperimentStatusCard({ vm }: { vm: ExperimentStatusSummaryVM }) {
  return (
    <Card
      id="card-experiment-status"
      title="Experiment status"
      chip={<ValueChip label={vm.phase} value={`${String(vm.exposure_percent)}% exposure`} />}
      demoRevision={fixtureRevision}
      rationaleHref={rationaleHref(vm.experiment_id)}
    >
      <p className="text-sm font-medium text-ink">{vm.title}</p>
      <p className="mt-2 flex flex-wrap gap-1.5">
        <ValueChip label="ladder" value={vm.canary_ladder.map((step) => `${String(step)}%`).join(' → ')} />
        <ValueChip label="guardrails" value={String(vm.metrics.filter((metric) => metric.role === 'GUARDRAIL').length)} />
      </p>
      <p className="mt-3 text-xs text-ink-soft" data-simulated="true">
        The evaluated run is SIMULATED (seed {vm.simulator !== null ? String(vm.simulator.seed) : 'unknown'}) — evaluation infrastructure, never intervention evidence.
      </p>
      <p className="mt-3">
        <Link href="/experiments" className="inline-flex min-h-[44px] items-center rounded-md px-1 text-sm font-medium text-epistemic underline-offset-2 hover:underline">
          Open Experiments
        </Link>
      </p>
    </Card>
  );
}

export function PackageReuseCard({ vm }: { vm: PackageReuseSummaryVM }) {
  return (
    <Card
      id="card-package-reuse"
      title="Package reuse"
      chip={<ValueChip label="validated" value={String(vm.package_count)} />}
      demoRevision={fixtureRevision}
      rationaleHref={rationaleHref(vm.core.subject_id)}
    >
      <ul className="space-y-2 text-sm">
        {vm.packages.map((pkg) => (
          <li key={pkg.package_id} className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{pkg.capability}</span>
            <ValueChip label="family" value={pkg.family} title="Diversity family — the repertoire deliberately keeps different families." />
            <ValueChip label="maturity" value={pkg.maturity} />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-soft">{vm.composition_note}</p>
      <p className="mt-3">
        <Link href="/packages" className="inline-flex min-h-[44px] items-center rounded-md px-1 text-sm font-medium text-epistemic underline-offset-2 hover:underline">
          Open Packages
        </Link>
      </p>
    </Card>
  );
}

const LEARNING_LABELS: Record<string, string> = {
  AMBIGUITY_RESOLUTION: 'Ambiguity resolved',
  MISSION_REVISION: 'Mission revised',
  OBJECTION_RESOLUTION: 'Objection resolved',
  PACKAGE_LIMITATION: 'Package limitation learned',
};

export function RecentLearningCard({ vm }: { vm: RecentLearningVM }) {
  return (
    <Card
      id="card-recent-learning"
      title="Recent learning"
      chip={<ValueChip label="as of" value={vm.as_of} />}
      demoRevision={fixtureRevision}
      rationaleHref={rationaleHref(vm.core.subject_id)}
    >
      <ol className="space-y-2 text-sm">
        {vm.entries.map((entry) => (
          <li key={entry.entry_id} className="border-l-2 border-line pl-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              {LEARNING_LABELS[entry.kind] ?? entry.kind}
            </p>
            <p className="text-ink">{entry.statement}</p>
          </li>
        ))}
      </ol>
      <p className="mt-3">
        <Link href="/history" className="inline-flex min-h-[44px] items-center rounded-md px-1 text-sm font-medium text-epistemic underline-offset-2 hover:underline">
          Open History
        </Link>
      </p>
    </Card>
  );
}
