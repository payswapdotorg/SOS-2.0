/**
 * The Overview page — the dominant hero (mission outcome health, system
 * condition, shortfall/opportunity, next allowed action), the below-hero
 * cards, and the active autonomous work surface (tasks, body leases,
 * observation status).
 */

import { PageShell } from '../page-shell';
import { HeroPanel } from '../hero';
import {
  CurrentChangeCard,
  EvidenceQualityCard,
  ExperimentStatusCard,
  PackageReuseCard,
  RecentLearningCard,
} from '../overview-cards';
import { ActiveTasksCard, BodyLeasesCard, ObservationStatusCard } from '../autonomous-work';
import { views } from '../../view-state/demo-data';

export function OverviewPage() {
  return (
    <PageShell section="overview">
      <h1 className="sr-only">Overview</h1>
      <HeroPanel
        hero={views.hero}
        systemCondition={views.systemCondition}
        shortfall={views.shortfall}
        nextAction={views.nextAction}
      />
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <CurrentChangeCard vm={views.currentChange} />
        <EvidenceQualityCard vm={views.evidenceQuality} />
        <ExperimentStatusCard vm={views.experimentStatus} />
        <PackageReuseCard vm={views.packageReuse} />
        <div className="md:col-span-2">
          <RecentLearningCard vm={views.recentLearning} />
        </div>
      </div>
      <section aria-labelledby="autonomous-work-heading" className="mt-8">
        <h2 id="autonomous-work-heading" className="mb-3 text-lg font-semibold text-ink">
          Active autonomous work
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <ActiveTasksCard />
          <BodyLeasesCard />
          <div className="md:col-span-2">
            <ObservationStatusCard vm={views.observation} />
          </div>
        </div>
      </section>
    </PageShell>
  );
}
